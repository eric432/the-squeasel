//! JPEG, PNG, and WebP encoding. JPEG and PNG go through mozjpeg and oxipng.
//! AVIF can be added as another arm here without changing the UI.
//! sRGB conversion happens when the preview decodes the file, not here.

use std::cell::Cell;
use std::collections::HashMap;
use std::io::Cursor;
use std::panic::AssertUnwindSafe;
use std::path::PathBuf;

use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
use little_exif::exif_tag::ExifTag;
use little_exif::filetype::FileExtension;
use little_exif::ifd::ExifTagGroup;
use little_exif::metadata::Metadata;
use rayon::prelude::*;

use crate::recipe::PngColors;
use crate::resize::OutputFormat;

/// oxipng preset 1. Preset 2 took 28s on a 6000×4000 photo and preset 1 took
/// 18s there; the default 1920-wide preview is a couple of seconds at preset 1.
const PNG_EFFORT: u8 = 1;
/// 1 is imagequant's full dither. 0 turns it off.
const PNG_DITHER: f32 = 1.0;
/// A target size never drops below this quality.
pub(crate) const QUALITY_FLOOR: u8 = 40;
const MAX_QUALITY_PROBES: u8 = 8;

pub(crate) struct Encoded {
    pub bytes: Vec<u8>,
    pub format: OutputFormat,
    pub quality: u8,
    pub alternative_format: Option<OutputFormat>,
    pub alternative_bytes: Option<u64>,
    pub target_missed: bool,
}

#[derive(Clone, Default)]
pub(crate) struct Credit {
    pub copyright: Option<String>,
    pub artist: Option<String>,
}

#[derive(Clone)]
pub(crate) enum MetadataWrite {
    None,
    Credit(Credit),
    /// Copy the source tags little_exif understands, except orientation.
    Preserve(PathBuf),
}

#[derive(Clone)]
pub(crate) struct EncodeOptions {
    pub format: OutputFormat,
    pub quality: u8,
    /// Palette size. Full color skips imagequant. Ignored unless `format` is PNG.
    pub png_colors: PngColors,
    /// Imagequant dither. Ignored for full color. 1 is on, 0 is off.
    pub png_dither: bool,
    /// File size to land at or under. PNG ignores this.
    pub target_bytes: Option<u64>,
    pub metadata: MetadataWrite,
    /// Lowest quality a size search may use. The batch stays at 40.
    pub quality_floor: u8,
}

impl EncodeOptions {
    pub(crate) fn plain(format: OutputFormat, quality: u8) -> Self {
        Self {
            format,
            quality,
            png_colors: PngColors::Full,
            png_dither: true,
            target_bytes: None,
            metadata: MetadataWrite::None,
            quality_floor: QUALITY_FLOOR,
        }
    }
}

pub(crate) fn encode(image: &DynamicImage, mut options: EncodeOptions) -> Result<Encoded, String> {
    options.quality = options.quality.clamp(1, 100);
    if let Some(target) = options.target_bytes.filter(|_| options.format != OutputFormat::Png) {
        options.target_bytes = None;
        return encode_for_target(image, &options, target);
    }
    encode_at(image, &options, options.quality)
}

fn encode_at(image: &DynamicImage, options: &EncodeOptions, quality: u8) -> Result<Encoded, String> {
    let mut options = options.clone();
    options.quality = quality;
    options.target_bytes = None;
    if options.format == OutputFormat::Smallest {
        encode_smallest(image, &options)
    } else {
        encode_one(image, &options)
    }
}

fn encode_one(image: &DynamicImage, options: &EncodeOptions) -> Result<Encoded, String> {
    let quality = options.quality.clamp(1, 100);
    let mut encoded = match options.format {
        OutputFormat::Jpeg => tagged(encode_jpeg(image, quality)?, OutputFormat::Jpeg, quality),
        OutputFormat::Png => match options.png_colors {
            PngColors::Count(colors) => encode_palette_png(image, colors, options.png_dither, quality)?,
            PngColors::Full => tagged(encode_png(image)?, OutputFormat::Png, quality),
        },
        OutputFormat::Webp => tagged(encode_webp(image, quality)?, OutputFormat::Webp, quality),
        OutputFormat::Smallest => return Err("Smallest has to be resolved before encoding".into()),
    };
    apply_metadata(&mut encoded.bytes, encoded.format, &options.metadata)?;
    Ok(encoded)
}

fn tagged(bytes: Vec<u8>, format: OutputFormat, quality: u8) -> Encoded {
    Encoded {
        bytes,
        format,
        quality,
        alternative_format: None,
        alternative_bytes: None,
        target_missed: false,
    }
}

pub(crate) fn mime(format: OutputFormat) -> &'static str {
    match format {
        OutputFormat::Jpeg => "image/jpeg",
        OutputFormat::Png => "image/png",
        OutputFormat::Webp => "image/webp",
        OutputFormat::Smallest => "image/webp",
    }
}

pub(crate) fn extension(format: OutputFormat) -> &'static str {
    match format {
        OutputFormat::Jpeg => "jpg",
        OutputFormat::Png => "png",
        OutputFormat::Webp => "webp",
        // Callers use the winning format. This arm only keeps the match exhaustive.
        OutputFormat::Smallest => "webp",
    }
}

fn encode_jpeg(image: &DynamicImage, quality: u8) -> Result<Vec<u8>, String> {
    let rgb = flatten_jpeg(image);
    if rgb.width() == 0 || rgb.height() == 0 {
        return Err("This image has no pixels".into());
    }
    let width = rgb.width() as usize;
    let height = rgb.height() as usize;
    let pixels = rgb.into_raw();
    std::panic::catch_unwind(AssertUnwindSafe(|| {
        let mut comp = mozjpeg::Compress::new(mozjpeg::ColorSpace::JCS_RGB);
        comp.set_size(width, height);
        comp.set_quality(f32::from(quality));
        // mozjpeg picks 4:4:4 at high quality unless this is set afterwards.
        comp.set_chroma_sampling_pixel_sizes((2, 2), (2, 2));
        comp.set_optimize_coding(true);
        comp.set_progressive_mode();
        comp.set_optimize_scans(true);
        let mut started = comp.start_compress(Vec::new())?;
        started.write_scanlines(&pixels)?;
        started.finish()
    }))
    .map_err(|_| "Could not encode this JPEG".to_string())?
    .map_err(|err| err.to_string())
}

fn flatten_jpeg(image: &DynamicImage) -> image::RgbImage {
    if image.color().has_alpha() {
        let mut background =
            RgbaImage::from_pixel(image.width(), image.height(), Rgba([255, 255, 255, 255]));
        image::imageops::overlay(&mut background, &image.to_rgba8(), 0, 0);
        DynamicImage::ImageRgba8(background).into_rgb8()
    } else {
        image.to_rgb8()
    }
}

fn encode_png(image: &DynamicImage) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
        .map_err(|err| err.to_string())?;
    optimize_png(bytes)
}

/// The chosen color count is the file. A smaller full-color PNG is not substituted.
fn encode_palette_png(image: &DynamicImage, colors: u16, dither: bool, quality: u8) -> Result<Encoded, String> {
    let rgba = image.to_rgba8();
    let width = rgba.width() as usize;
    let height = rgba.height() as usize;
    if width == 0 || height == 0 {
        return Err("This image has no pixels".into());
    }
    let pixels: Vec<imagequant::RGBA> = rgba
        .pixels()
        .map(|pixel| imagequant::RGBA::new(pixel[0], pixel[1], pixel[2], pixel[3]))
        .collect();
    let level = if dither { PNG_DITHER } else { 0.0 };
    let (palette, indexes) = quantize_max_colors(&pixels, width, height, colors, level)?;
    let indexed = write_indexed_png(width as u32, height as u32, &palette, &indexes)?;
    let bytes = optimize_png(indexed)?;
    Ok(tagged(bytes, OutputFormat::Png, quality))
}

fn quantize_max_colors(
    pixels: &[imagequant::RGBA],
    width: usize,
    height: usize,
    colors: u16,
    dither: f32,
) -> Result<(Vec<imagequant::RGBA>, Vec<u8>), String> {
    let mut attributes = imagequant::new();
    attributes
        .set_max_colors(u32::from(colors))
        .map_err(|err| err.to_string())?;
    let mut image = attributes
        .new_image(pixels, width, height, 0.0)
        .map_err(|err| err.to_string())?;
    let mut result = attributes.quantize(&mut image).map_err(|err| err.to_string())?;
    result.set_dithering_level(dither).map_err(|err| err.to_string())?;
    result.remapped(&mut image).map_err(|err| err.to_string())
}

fn write_indexed_png(
    width: u32,
    height: u32,
    palette: &[imagequant::RGBA],
    indexes: &[u8],
) -> Result<Vec<u8>, String> {
    let mut colors = Vec::with_capacity(palette.len() * 3);
    let mut alpha = Vec::with_capacity(palette.len());
    for entry in palette {
        colors.extend_from_slice(&[entry.r, entry.g, entry.b]);
        alpha.push(entry.a);
    }
    let mut bytes = Vec::new();
    let mut encoder = png::Encoder::new(&mut bytes, width, height);
    encoder.set_color(png::ColorType::Indexed);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_palette(colors);
    if alpha.iter().any(|channel| *channel < 255) {
        encoder.set_trns(alpha);
    }
    let mut writer = encoder.write_header().map_err(|err| err.to_string())?;
    writer
        .write_image_data(indexes)
        .map_err(|err| err.to_string())?;
    drop(writer);
    Ok(bytes)
}

fn optimize_png(bytes: Vec<u8>) -> Result<Vec<u8>, String> {
    let options = oxipng::Options::from_preset(PNG_EFFORT);
    oxipng::optimize_from_memory(&bytes, &options).map_err(|err| err.to_string())
}

fn encode_webp(image: &DynamicImage, quality: u8) -> Result<Vec<u8>, String> {
    let rgba = image.to_rgba8();
    let encoder = webp::Encoder::from_rgba(rgba.as_raw(), rgba.width(), rgba.height());
    let encoded = encoder.encode(f32::from(quality));
    Ok(encoded.to_vec())
}

pub(crate) struct QualityChoice {
    pub quality: u8,
    pub missed: bool,
}

/// Highest quality at or under `target`. Quality 100 is kept when it already fits.
/// `floor` is the lowest quality this search may use. The batch passes 40.
/// The search stops after 8 probes.
pub(crate) fn search_quality(
    mut size_at: impl FnMut(u8) -> u64,
    target: u64,
    floor: u8,
) -> QualityChoice {
    let floor = floor.clamp(1, QUALITY_FLOOR);
    let mut probes = 0u8;
    let mut measure = |probes: &mut u8, quality: u8| -> u64 {
        *probes = probes.saturating_add(1);
        size_at(quality)
    };
    if measure(&mut probes, 100) <= target {
        return QualityChoice {
            quality: 100,
            missed: false,
        };
    }
    if measure(&mut probes, floor) > target {
        return QualityChoice {
            quality: floor,
            missed: true,
        };
    }
    let mut best = floor;
    let mut low = floor.saturating_add(1);
    let mut high = 99u8;
    while low <= high && probes < MAX_QUALITY_PROBES {
        let mid = low + (high - low) / 2;
        if measure(&mut probes, mid) <= target {
            best = mid;
            low = mid.saturating_add(1);
        } else {
            high = mid.saturating_sub(1);
        }
    }
    QualityChoice {
        quality: best,
        missed: false,
    }
}

fn encode_for_target(image: &DynamicImage, options: &EncodeOptions, target: u64) -> Result<Encoded, String> {
    let mut cache: HashMap<u8, Encoded> = HashMap::new();
    let mut failure: Option<String> = None;
    let choice = search_quality(
        |quality| match encode_at(image, options, quality) {
            Ok(encoded) => {
                let size = encoded.bytes.len() as u64;
                cache.insert(quality, encoded);
                size
            }
            Err(err) => {
                failure = Some(err);
                u64::MAX
            }
        },
        target,
        options.quality_floor,
    );
    if let Some(err) = failure {
        return Err(err);
    }
    let mut encoded = cache.remove(&choice.quality).ok_or_else(|| "The size search did not keep its result".to_string())?;
    encoded.target_missed = choice.missed;
    encoded.quality = choice.quality;
    Ok(encoded)
}

/// Opaque results try JPEG and WebP. Any pixel below full opacity tries PNG and WebP.
pub(crate) fn candidate_formats(transparent: bool) -> [OutputFormat; 2] {
    if transparent {
        [OutputFormat::Png, OutputFormat::Webp]
    } else {
        [OutputFormat::Jpeg, OutputFormat::Webp]
    }
}

fn has_transparency(image: &DynamicImage) -> bool {
    image.color().has_alpha() && image.to_rgba8().pixels().any(|pixel| pixel[3] < 255)
}

/// Turns off Smallest's extra rayon fan-out while a batch worker is encoding.
pub(crate) struct BatchEncode;

thread_local! {
    static BATCH_ENCODE: Cell<bool> = const { Cell::new(false) };
}

impl BatchEncode {
    pub(crate) fn enter() -> Self {
        BATCH_ENCODE.with(|flag| flag.set(true));
        Self
    }

    fn active() -> bool {
        BATCH_ENCODE.with(|flag| flag.get())
    }
}

impl Drop for BatchEncode {
    fn drop(&mut self) {
        BATCH_ENCODE.with(|flag| flag.set(false));
    }
}

fn encode_candidate(
    image: &DynamicImage,
    options: &EncodeOptions,
    index: usize,
    format: OutputFormat,
) -> Result<(usize, Encoded), String> {
    let mut one = options.clone();
    one.format = format;
    one.target_bytes = None;
    if format == OutputFormat::Png {
        one.png_colors = PngColors::Full;
    }
    Ok((index, encode_one(image, &one)?))
}

fn encode_smallest(image: &DynamicImage, options: &EncodeOptions) -> Result<Encoded, String> {
    let formats = candidate_formats(has_transparency(image));
    let encoded: Result<Vec<(usize, Encoded)>, String> = if BatchEncode::active() {
        formats
            .into_iter()
            .enumerate()
            .map(|(index, format)| encode_candidate(image, options, index, format))
            .collect()
    } else {
        formats
            .into_par_iter()
            .enumerate()
            .map(|(index, format)| encode_candidate(image, options, index, format))
            .collect()
    };
    let mut encoded = encoded?;
    encoded.sort_by_key(|(index, item)| (item.bytes.len(), *index));
    let (_, winner) = encoded.remove(0);
    let alternative = encoded.into_iter().next().map(|(_, item)| item);
    Ok(Encoded {
        alternative_format: alternative.as_ref().map(|item| item.format),
        alternative_bytes: alternative.map(|item| item.bytes.len() as u64),
        ..winner
    })
}

pub(crate) fn read_credit(path: &std::path::Path) -> Credit {
    let read = std::panic::catch_unwind(AssertUnwindSafe(|| Metadata::new_from_path(path)));
    if let Ok(Ok(metadata)) = read {
        let credit = Credit {
            copyright: tag_text(&metadata, ExifTag::Copyright(String::new())),
            artist: tag_text(&metadata, ExifTag::Artist(String::new())),
        };
        if credit.copyright.is_some() || credit.artist.is_some() {
            return credit;
        }
    }
    // little_exif rejects some real files (this kit's ExposureTime is a DOUBLE).
    // The copyright and artist lines are still plain ASCII in the first IFD.
    std::fs::read(path)
        .ok()
        .map(|bytes| credit_from_exif_bytes(&bytes))
        .unwrap_or_default()
}

fn credit_from_exif_bytes(bytes: &[u8]) -> Credit {
    let Some(start) = bytes.windows(6).position(|window| window == b"Exif\0\0") else {
        return Credit::default();
    };
    let tiff = &bytes[start + 6..];
    let big = tiff.starts_with(b"MM");
    if !big && !tiff.starts_with(b"II") {
        return Credit::default();
    }
    let read_u16 = |offset: usize| -> Option<u16> {
        let bytes = tiff.get(offset..offset + 2)?;
        Some(if big {
            u16::from_be_bytes([bytes[0], bytes[1]])
        } else {
            u16::from_le_bytes([bytes[0], bytes[1]])
        })
    };
    let read_u32 = |offset: usize| -> Option<u32> {
        let bytes = tiff.get(offset..offset + 4)?;
        Some(if big {
            u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
        } else {
            u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
        })
    };
    if read_u16(2) != Some(42) {
        return Credit::default();
    }
    let Some(ifd) = read_u32(4).map(|offset| offset as usize) else {
        return Credit::default();
    };
    let Some(count) = read_u16(ifd).map(|count| count as usize) else {
        return Credit::default();
    };
    let mut copyright = None;
    let mut artist = None;
    for index in 0..count {
        let entry = ifd + 2 + index * 12;
        let Some(tag) = read_u16(entry) else {
            break;
        };
        let Some(kind) = read_u16(entry + 2) else {
            break;
        };
        let Some(count) = read_u32(entry + 4).map(|count| count as usize) else {
            break;
        };
        if kind != 2 || (tag != 0x013B && tag != 0x8298) || count == 0 {
            continue;
        }
        let data = if count <= 4 {
            tiff.get(entry + 8..entry + 8 + count)
        } else {
            let Some(offset) = read_u32(entry + 8).map(|offset| offset as usize) else {
                continue;
            };
            tiff.get(offset..offset.saturating_add(count))
        };
        let Some(data) = data else {
            continue;
        };
        let text = String::from_utf8_lossy(data);
        let trimmed = text.trim_end_matches('\0').trim();
        if trimmed.is_empty() {
            continue;
        }
        if tag == 0x013B {
            artist = Some(trimmed.to_string());
        } else {
            copyright = Some(trimmed.to_string());
        }
    }
    Credit { copyright, artist }
}

fn tag_text(metadata: &Metadata, sample: ExifTag) -> Option<String> {
    let tag = metadata.get_tag(&sample).next()?;
    let bytes = tag.value_as_u8_vec(&metadata.get_endian());
    let text = String::from_utf8_lossy(&bytes);
    let trimmed = text.trim_end_matches('\0').trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn apply_metadata(bytes: &mut Vec<u8>, format: OutputFormat, write: &MetadataWrite) -> Result<(), String> {
    match write {
        MetadataWrite::None => Ok(()),
        MetadataWrite::Credit(credit) => {
            if credit.copyright.is_none() && credit.artist.is_none() {
                return Ok(());
            }
            let mut metadata = Metadata::new();
            if let Some(text) = &credit.copyright {
                metadata.set_tag(ExifTag::Copyright(text.clone()));
            }
            if let Some(text) = &credit.artist {
                metadata.set_tag(ExifTag::Artist(text.clone()));
            }
            write_metadata(bytes, format, &metadata)
        }
        MetadataWrite::Preserve(path) => {
            let read = std::panic::catch_unwind(AssertUnwindSafe(|| Metadata::new_from_path(path)));
            let Ok(Ok(mut metadata)) = read else {
                return Ok(());
            };
            if metadata.get_ifd(ExifTagGroup::GENERIC, 0).is_some() {
                metadata.get_ifd_mut(ExifTagGroup::GENERIC, 0).remove_tag(0x0112);
            }
            if write_metadata(bytes, format, &metadata).is_err() {
                return Ok(());
            }
            Ok(())
        }
    }
}

fn write_metadata(bytes: &mut Vec<u8>, format: OutputFormat, metadata: &Metadata) -> Result<(), String> {
    let file_type = match format {
        OutputFormat::Jpeg => FileExtension::JPEG,
        OutputFormat::Png => FileExtension::PNG { as_zTXt_chunk: false },
        OutputFormat::Webp => FileExtension::WEBP,
        OutputFormat::Smallest => return Err("Smallest has no file type".into()),
    };
    let wrote = std::panic::catch_unwind(AssertUnwindSafe(|| {
        let mut copy = bytes.clone();
        let result = metadata.write_to_vec(&mut copy, file_type);
        (result, copy)
    }));
    match wrote {
        Ok((Ok(()), copy)) => {
            *bytes = copy;
            Ok(())
        }
        Ok((Err(_), _)) if format == OutputFormat::Webp => write_webp_on_disk(bytes, metadata),
        Ok((Err(err), _)) => Err(err.to_string()),
        Err(_) if format == OutputFormat::Webp => write_webp_on_disk(bytes, metadata),
        Err(_) => Err("Could not write the copyright".into()),
    }
}

/// little_exif can add EXIF to a lossy WebP on disk, where it upgrades the simple
/// VP8 file to the extended format. The in-memory writer still refuses that upgrade.
fn write_webp_on_disk(bytes: &mut Vec<u8>, metadata: &Metadata) -> Result<(), String> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static TEMP_FILES: AtomicU64 = AtomicU64::new(0);
    let name = format!(
        "squeasel-exif-{}-{}.webp",
        std::process::id(),
        TEMP_FILES.fetch_add(1, Ordering::Relaxed)
    );
    let path = std::env::temp_dir().join(name);
    let write_file = std::fs::write(&path, bytes.as_slice());
    let wrote = write_file.and_then(|_| metadata.write_to_file(&path));
    let read = std::fs::read(&path);
    let _ = std::fs::remove_file(&path);
    wrote.map_err(|err| err.to_string())?;
    *bytes = read.map_err(|err| err.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage, Rgba, RgbaImage};
    use little_exif::exif_tag::ExifTag;
    use little_exif::filetype::FileExtension;
    use little_exif::ifd::ExifTagGroup;
    use little_exif::metadata::Metadata;

    #[test]
    fn jpeg_is_progressive_420_and_smaller_than_the_stand_in() {
        let image = DynamicImage::ImageRgb8(pattern(320, 200));
        let moz = encode(&image, EncodeOptions::plain(OutputFormat::Jpeg, 78))
            .unwrap()
            .bytes;
        let stand_in = stand_in_jpeg(&image.to_rgb8(), 78);
        assert!(moz.len() < stand_in.len(), "{} vs {}", moz.len(), stand_in.len());
        assert!(is_progressive(&moz), "expected a progressive SOF2 marker");
        let sampling = sof_sampling(&moz).expect("SOF2");
        assert_eq!(sampling, vec![(2, 2), (1, 1), (1, 1)]);
    }

    #[test]
    fn png_preset_keeps_every_pixel() {
        let mut image = RgbaImage::new(48, 32);
        for (x, y, pixel) in image.enumerate_pixels_mut() {
            *pixel = Rgba([
                (x * 3) as u8,
                (y * 5) as u8,
                180,
                if x < 8 { 0 } else { 255 },
            ]);
        }
        let source = DynamicImage::ImageRgba8(image);
        let encoded = encode(&source, EncodeOptions::plain(OutputFormat::Png, 80))
            .unwrap()
            .bytes;
        let decoded = image::load_from_memory(&encoded).unwrap().to_rgba8();
        assert_eq!(decoded, source.to_rgba8());
    }

    #[test]
    fn palette_png_shrinks_a_flat_graphic() {
        let mut image = RgbaImage::new(180, 120);
        for (x, y, pixel) in image.enumerate_pixels_mut() {
            let dx = x as f32 - 90.0;
            let dy = y as f32 - 60.0;
            let shade = (dx * dx + dy * dy).sqrt().min(255.0) as u8;
            let flat: u8 = if x < 70 { 32 } else { 210 };
            *pixel = Rgba([flat.saturating_add(shade / 6), 70, 180u8.saturating_sub(shade / 4), 255]);
        }
        let source = DynamicImage::ImageRgba8(image);
        let lossless = encode(&source, EncodeOptions::plain(OutputFormat::Png, 30)).unwrap();
        let palette = encode(&source, palette_options(64, true)).unwrap();
        assert!(
            palette.bytes.len() < lossless.bytes.len(),
            "palette {} lossless {}",
            palette.bytes.len(),
            lossless.bytes.len()
        );
        assert!(unique_colors(&palette.bytes) <= 64);
    }

    #[test]
    fn palette_png_keeps_its_colors_when_full_color_is_smaller() {
        let mut image = RgbaImage::new(32, 32);
        let mut state = 0x1234_5678u32;
        for pixel in image.pixels_mut() {
            state = state.wrapping_mul(1664525).wrapping_add(1013904223);
            *pixel = Rgba([(state >> 16) as u8, (state >> 8) as u8, state as u8, 255]);
        }
        let source = DynamicImage::ImageRgba8(image);
        let full = encode(&source, EncodeOptions::plain(OutputFormat::Png, 30)).unwrap();
        let palette = encode(&source, palette_options(2, false)).unwrap();
        assert!(unique_colors(&full.bytes) > 2);
        assert!(unique_colors(&palette.bytes) <= 2);
    }

    fn palette_options(colors: u16, dither: bool) -> EncodeOptions {
        EncodeOptions {
            format: OutputFormat::Png,
            quality: 30,
            png_colors: PngColors::Count(colors),
            png_dither: dither,
            target_bytes: None,
            metadata: MetadataWrite::None,
            quality_floor: QUALITY_FLOOR,
        }
    }

    fn unique_colors(bytes: &[u8]) -> usize {
        let decoded = image::load_from_memory(bytes).unwrap().to_rgba8();
        let mut colors = std::collections::HashSet::new();
        for pixel in decoded.pixels() {
            colors.insert(*pixel);
        }
        colors.len()
    }

    fn fake_size(quality: u8) -> u64 {
        1000 + u64::from(quality) * 10
    }

    #[test]
    fn target_search_hits_under_the_target_at_the_floor_and_at_100() {
        let already = search_quality(fake_size, 2500, QUALITY_FLOOR);
        assert_eq!(already.quality, 100);
        assert!(!already.missed);

        let fitted = search_quality(fake_size, 1500, QUALITY_FLOOR);
        assert_eq!(fitted.quality, 50);
        assert!(!fitted.missed);

        let missed = search_quality(fake_size, 1000, QUALITY_FLOOR);
        assert_eq!(missed.quality, QUALITY_FLOOR);
        assert!(missed.missed);

        let mut lowest = 100u8;
        let mut probes = 0u8;
        let _ = search_quality(
            |quality| {
                probes = probes.saturating_add(1);
                lowest = lowest.min(quality);
                fake_size(quality)
            },
            1500,
            QUALITY_FLOOR,
        );
        assert!(lowest >= QUALITY_FLOOR);
        assert!(probes <= 8);
    }

    #[test]
    fn a_lower_floor_is_used_only_when_that_search_asks_for_it() {
        let size = |quality: u8| if quality <= 35 { 100 } else { 1_000 };
        let lowered = search_quality(size, 150, 30);
        assert_eq!(lowered.quality, 35);
        assert!(!lowered.missed);
        let normal = search_quality(size, 150, QUALITY_FLOOR);
        assert_eq!(normal.quality, QUALITY_FLOOR);
        assert!(normal.missed);
    }

    #[test]
    fn smallest_candidates_skip_jpeg_when_transparent() {
        assert_eq!(
            candidate_formats(false),
            [OutputFormat::Jpeg, OutputFormat::Webp]
        );
        assert_eq!(candidate_formats(true), [OutputFormat::Png, OutputFormat::Webp]);
        assert!(!candidate_formats(true).contains(&OutputFormat::Jpeg));

        let opaque = encode(
            &DynamicImage::new_rgb8(24, 16),
            EncodeOptions::plain(OutputFormat::Smallest, 70),
        )
        .unwrap();
        assert!(matches!(opaque.format, OutputFormat::Jpeg | OutputFormat::Webp));
        assert_ne!(opaque.alternative_format, Some(opaque.format));
        assert!(opaque.bytes.len() as u64 <= opaque.alternative_bytes.unwrap());

        let mut clear = RgbaImage::new(24, 16);
        for pixel in clear.pixels_mut() {
            *pixel = Rgba([20, 40, 200, 0]);
        }
        let transparent = encode(
            &DynamicImage::ImageRgba8(clear),
            EncodeOptions::plain(OutputFormat::Smallest, 70),
        )
        .unwrap();
        assert_ne!(transparent.format, OutputFormat::Jpeg);
        assert_ne!(transparent.alternative_format, Some(OutputFormat::Jpeg));
        assert!(matches!(
            transparent.format,
            OutputFormat::Png | OutputFormat::Webp
        ));
    }

    #[test]
    fn keep_copyright_writes_copyright_and_artist_only() {
        let image = DynamicImage::new_rgb8(16, 12);
        for (format, file_type) in [
            (OutputFormat::Jpeg, FileExtension::JPEG),
            (OutputFormat::Png, FileExtension::PNG { as_zTXt_chunk: false }),
            (OutputFormat::Webp, FileExtension::WEBP),
        ] {
            let encoded = encode(
                &image,
                EncodeOptions {
                    format,
                    quality: 70,
                    png_colors: PngColors::Full,
                    png_dither: true,
                    target_bytes: None,
                    quality_floor: QUALITY_FLOOR,
                    metadata: MetadataWrite::Credit(Credit {
                        copyright: Some("Bitclone".into()),
                        artist: Some("Ada".into()),
                    }),
                },
            )
            .unwrap_or_else(|err| panic!("{format:?}: {err}"));
            let metadata = Metadata::new_from_vec(&encoded.bytes, file_type)
                .unwrap_or_else(|err| panic!("{format:?}: {err}"));
            let copyright = tag_text(&metadata, ExifTag::Copyright(String::new())).unwrap();
            let artist = tag_text(&metadata, ExifTag::Artist(String::new())).unwrap();
            assert!(copyright.contains("Bitclone"), "{format:?}");
            assert!(artist.contains("Ada"), "{format:?}");
            assert!(metadata
                .get_tag_by_hex(0x0002, Some(ExifTagGroup::GPS))
                .next()
                .is_none());
            assert!(metadata.get_tag_by_hex(0x0112, None).next().is_none());
        }
    }

    fn pattern(width: u32, height: u32) -> RgbImage {
        let mut image = RgbImage::new(width, height);
        let mut state = 0x1234_5678u32;
        for pixel in image.pixels_mut() {
            state = state.wrapping_mul(1664525).wrapping_add(1013904223);
            *pixel = Rgb([
                (state >> 16) as u8,
                (state >> 8) as u8,
                state as u8,
            ]);
        }
        image
    }

    fn stand_in_jpeg(rgb: &RgbImage, quality: u8) -> Vec<u8> {
        let mut bytes = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, quality)
            .encode_image(rgb)
            .unwrap();
        bytes
    }

    fn is_progressive(jpeg: &[u8]) -> bool {
        sof_sampling(jpeg).is_some()
    }

    /// Sampling factors from the progressive start-of-frame marker.
    fn sof_sampling(jpeg: &[u8]) -> Option<Vec<(u8, u8)>> {
        let mut i = 0;
        while i + 3 < jpeg.len() {
            if jpeg[i] != 0xFF {
                i += 1;
                continue;
            }
            while i < jpeg.len() && jpeg[i] == 0xFF {
                i += 1;
            }
            if i >= jpeg.len() {
                break;
            }
            let marker = jpeg[i];
            i += 1;
            let standalone = marker == 0xD8 || marker == 0xD9 || (0xD0..=0xD7).contains(&marker);
            if standalone {
                continue;
            }
            if i + 1 >= jpeg.len() {
                break;
            }
            let len = u16::from_be_bytes([jpeg[i], jpeg[i + 1]]) as usize;
            if marker == 0xC2 && i + 8 < jpeg.len() {
                let components = jpeg[i + 7] as usize;
                let mut sampling = Vec::with_capacity(components);
                for component in 0..components {
                    let at = i + 8 + component * 3 + 1;
                    let factor = *jpeg.get(at)?;
                    sampling.push((factor >> 4, factor & 0x0F));
                }
                return Some(sampling);
            }
            i += len;
        }
        None
    }
}
