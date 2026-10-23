//! One open image: decode once, resize on each settings change, export those bytes.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use base64::Engine;
use image::{DynamicImage, Rgb, RgbImage, Rgba, RgbaImage};
use serde::{Deserialize, Serialize};

use crate::encode::{self, encode};
use crate::ingest::decode_oriented;
use crate::name::{self, NameParts};
use crate::recipe::PngColors;
use crate::resize::{self, Anchor, CropRect, FitMode, OutputFormat, ResizePlan};

const PREVIEW_LONG_SIDE: u32 = 2000;
const JPEG_PAD_FALLBACK: [u8; 3] = [0xF3, 0xF1, 0xEC];
/// One claim at a time, so two batch files cannot take the same name.
static EXPORT_WRITE: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreviewSettings {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub mode: FitMode,
    pub never_upscale: bool,
    pub pad_color: String,
    pub transparent_pad: bool,
    pub format: OutputFormat,
    pub quality: u8,
    #[serde(default)]
    pub anchor: Anchor,
    #[serde(default)]
    pub crop: Option<CropRect>,
    /// When true, the response includes a display copy of the upright original.
    #[serde(default)]
    pub include_source: bool,
    /// `"full"` or 2–256. Omitted stays full color.
    #[serde(default)]
    pub png_colors: PngColors,
    /// Ignored until colors are reduced. Omitted means on.
    #[serde(default = "default_dither")]
    pub png_dither: bool,
    /// Empty means no size target. PNG ignores it.
    #[serde(default)]
    pub target_max_kb: Option<u32>,
    /// Re-encoding already drops metadata. On keeps that, and can copy copyright.
    #[serde(default = "default_strip")]
    pub strip_metadata: bool,
    #[serde(default)]
    pub keep_copyright: bool,
    /// Lowest quality for this file's size search. Omitted stays at 40.
    #[serde(default = "default_quality_floor")]
    pub quality_floor: u8,
}

fn default_quality_floor() -> u8 {
    encode::QUALITY_FLOOR
}

fn default_strip() -> bool {
    true
}

fn default_dither() -> bool {
    true
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreviewResponse {
    preview_url: String,
    width: u32,
    height: u32,
    bytes: u64,
    kept_native: bool,
    pad_fell_back: bool,
    fell_back_to_fit: bool,
    frame_width: u32,
    frame_height: u32,
    source_preview_url: String,
    chosen_format: OutputFormat,
    chosen_quality: u8,
    alternative_format: Option<OutputFormat>,
    alternative_bytes: Option<u64>,
    target_missed: bool,
    profile_unread: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportResponse {
    pub path: String,
    pub bytes: u64,
    pub width: u32,
    pub height: u32,
    pub skipped: bool,
    pub retina_path: Option<String>,
    pub retina_skipped: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportOutput {
    pub folder_mode: crate::recipe::FolderMode,
    pub subfolder_name: String,
    pub chosen_folder: Option<String>,
    pub name_pattern: String,
    pub sequence: u32,
    pub recipe_name: String,
    pub conflict: crate::recipe::ConflictRule,
    pub retina2x: bool,
    /// Always write `name-1`, even when the plain name is free and the recipe says Skip.
    #[serde(default)]
    pub force_rename: bool,
}

enum Placement {
    Write(PathBuf),
    Skip(PathBuf),
}

struct CachedPreview {
    path: PathBuf,
    image: DynamicImage,
    key: String,
    encoded: Vec<u8>,
    preview_url: String,
    width: u32,
    height: u32,
    kept_native: bool,
    pad_fell_back: bool,
    fell_back_to_fit: bool,
    frame_width: u32,
    frame_height: u32,
    source_preview_url: String,
    chosen_format: OutputFormat,
    chosen_quality: u8,
    alternative_format: Option<OutputFormat>,
    alternative_bytes: Option<u64>,
    target_missed: bool,
    profile_unread: bool,
}

fn generation() -> &'static AtomicU64 {
    static GENERATION: OnceLock<AtomicU64> = OnceLock::new();
    GENERATION.get_or_init(|| AtomicU64::new(0))
}

fn cache() -> &'static Mutex<Option<CachedPreview>> {
    static CACHE: OnceLock<Mutex<Option<CachedPreview>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

fn lock_cache() -> std::sync::MutexGuard<'static, Option<CachedPreview>> {
    cache().lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[tauri::command]
pub async fn preview_image(
    path: String,
    settings: PreviewSettings,
) -> Result<PreviewResponse, String> {
    tauri::async_runtime::spawn_blocking(move || render_preview(PathBuf::from(path), settings))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn rerun_file(
    path: String,
    settings: PreviewSettings,
    mut output: ExportOutput,
) -> Result<FreshFile, String> {
    output.force_rename = true;
    tauri::async_runtime::spawn_blocking(move || export_fresh(Path::new(&path), &settings, &output))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn export_image(
    path: String,
    settings: PreviewSettings,
    output: ExportOutput,
) -> Result<ExportResponse, String> {
    tauri::async_runtime::spawn_blocking(move || export_preview(PathBuf::from(path), settings, output))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub fn close_preview() {
    generation().fetch_add(1, Ordering::AcqRel);
    *lock_cache() = None;
}

#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("open")
            .args(["-R", &path])
            .status()
            .map_err(|err| err.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err("Could not reveal the file in Finder".into())
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err("Reveal in Finder is only available on macOS".into())
    }
}

fn render_preview(path: PathBuf, settings: PreviewSettings) -> Result<PreviewResponse, String> {
    let mine = generation().fetch_add(1, Ordering::AcqRel) + 1;
    let key = settings_key(&path, &settings);
    {
        let slot = lock_cache();
        if let Some(cached) = slot.as_ref() {
            if cached.path == path && cached.key == key {
                remember_estimate(&key, cached.encoded.len() as u64);
                return Ok(PreviewResponse {
                    preview_url: cached.preview_url.clone(),
                    width: cached.width,
                    height: cached.height,
                    bytes: cached.encoded.len() as u64,
                    kept_native: cached.kept_native,
                    pad_fell_back: cached.pad_fell_back,
                    fell_back_to_fit: cached.fell_back_to_fit,
                    frame_width: cached.frame_width,
                    frame_height: cached.frame_height,
                    chosen_format: cached.chosen_format,
                    chosen_quality: cached.chosen_quality,
                    alternative_format: cached.alternative_format,
                    alternative_bytes: cached.alternative_bytes,
                    target_missed: cached.target_missed,
                    profile_unread: cached.profile_unread,
                    source_preview_url: if settings.include_source {
                        cached.source_preview_url.clone()
                    } else {
                        String::new()
                    },
                });
            }
        }
    }

    let fresh = {
        let mut slot = lock_cache();
        match slot.take() {
            Some(cached) if cached.path == path => {
                Err((cached.image, cached.source_preview_url, cached.profile_unread))
            }
            _ => {
                drop(slot);
                Ok(load_source(&path)?)
            }
        }
    };
    // A cached image still needs the HEIC temp JPEG so copyright is read from the
    // converted file. The temp is dropped after produce, including if produce fails.
    let reopened = if fresh.is_err() {
        Some(crate::heic::open(&path)?)
    } else {
        None
    };
    let (source_preview_url, profile_unread, metadata) = match &fresh {
        Ok(loaded) => (
            source_preview_url(&loaded.image)?,
            loaded.profile_unread,
            loaded.source_path().to_path_buf(),
        ),
        Err((_, url, unread)) => (
            url.clone(),
            *unread,
            reopened.as_ref().unwrap().path().to_path_buf(),
        ),
    };
    let produced = {
        let image_ref = match &fresh {
            Ok(loaded) => &loaded.image,
            Err((image, _, _)) => image,
        };
        produce(&metadata, image_ref, &settings)?
    };
    let image = match fresh {
        Ok(loaded) => loaded.image,
        Err((image, _, _)) => image,
    };
    remember_estimate(&key, produced.encoded.len() as u64);
    let display_url = preview_url(
        &produced.output,
        &produced.encoded,
        produced.format,
        produced.quality,
        settings.png_colors,
        settings.png_dither,
    )?;
    let response = PreviewResponse {
        preview_url: display_url.clone(),
        width: produced.plan.output_width,
        height: produced.plan.output_height,
        bytes: produced.encoded.len() as u64,
        kept_native: produced.plan.kept_native,
        pad_fell_back: produced.pad_fell_back,
        fell_back_to_fit: produced.plan.fell_back_to_fit,
        frame_width: produced.plan.frame_width,
        frame_height: produced.plan.frame_height,
        chosen_format: produced.format,
        chosen_quality: produced.quality,
        alternative_format: produced.alternative_format,
        alternative_bytes: produced.alternative_bytes,
        target_missed: produced.target_missed,
        profile_unread,
        source_preview_url: if settings.include_source {
            source_preview_url.clone()
        } else {
            String::new()
        },
    };

    if generation().load(Ordering::Acquire) == mine {
        *lock_cache() = Some(CachedPreview {
            path,
            image,
            key,
            encoded: produced.encoded,
            preview_url: display_url,
            width: response.width,
            height: response.height,
            kept_native: response.kept_native,
            pad_fell_back: response.pad_fell_back,
            fell_back_to_fit: response.fell_back_to_fit,
            frame_width: response.frame_width,
            frame_height: response.frame_height,
            chosen_format: response.chosen_format,
            chosen_quality: response.chosen_quality,
            alternative_format: response.alternative_format,
            alternative_bytes: response.alternative_bytes,
            target_missed: response.target_missed,
            profile_unread: response.profile_unread,
            source_preview_url,
        });
    }
    Ok(response)
}

fn export_preview(path: PathBuf, settings: PreviewSettings, output: ExportOutput) -> Result<ExportResponse, String> {
    let key = settings_key(&path, &settings);
    let cached = {
        let slot = lock_cache();
        slot.as_ref()
            .filter(|cached| cached.path == path && cached.key == key)
            .map(|cached| {
                (
                    cached.encoded.clone(),
                    cached.width,
                    cached.height,
                    cached.chosen_format,
                )
            })
    };
    let (encoded, width, height, format) = if let Some(cached) = cached {
        cached
    } else {
        let loaded = load_source(&path)?;
        let produced = produce(loaded.source_path(), &loaded.image, &settings)?;
        (
            produced.encoded,
            produced.plan.output_width,
            produced.plan.output_height,
            produced.format,
        )
    };

    commit_export(&path, &settings, &output, encoded, width, height, format)
}

/// One batch file after it has been encoded. `skipped` means the name was already taken.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FreshFile {
    pub path: String,
    pub bytes: u64,
    pub width: u32,
    pub height: u32,
    pub skipped: bool,
    pub format: String,
    pub target_missed: bool,
    pub kept_native: bool,
    pub cropped_heavily: bool,
    pub profile_unread: bool,
}

/// Encode and write one file without using the single-image preview cache.
/// Smallest does not fan out onto more threads. The name claim is serialized.
pub(crate) fn export_fresh(
    path: &Path,
    settings: &PreviewSettings,
    output: &ExportOutput,
) -> Result<FreshFile, String> {
    let _batch = encode::BatchEncode::enter();
    let loaded = load_source(path)?;
    let produced = produce(loaded.source_path(), &loaded.image, settings)?;
    let response = commit_export(
        path,
        settings,
        output,
        produced.encoded,
        produced.plan.output_width,
        produced.plan.output_height,
        produced.format,
    )?;
    Ok(FreshFile {
        path: response.path,
        bytes: response.bytes,
        width: response.width,
        height: response.height,
        skipped: response.skipped,
        format: format_name(produced.format),
        target_missed: produced.target_missed,
        kept_native: produced.plan.kept_native,
        cropped_heavily: resize::discards_more_than_half(
            produced.source_width,
            produced.source_height,
            &produced.plan,
            settings.mode,
        ),
        profile_unread: loaded.profile_unread,
    })
}

fn format_name(format: OutputFormat) -> String {
    match format {
        OutputFormat::Jpeg => "jpeg",
        OutputFormat::Png => "png",
        OutputFormat::Webp | OutputFormat::Smallest => "webp",
    }
    .to_string()
}

fn commit_export(
    path: &Path,
    settings: &PreviewSettings,
    output: &ExportOutput,
    encoded: Vec<u8>,
    width: u32,
    height: u32,
    format: OutputFormat,
) -> Result<ExportResponse, String> {
    let _claim = EXPORT_WRITE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let placed = place_export(path, output, format, width, height, false)?;
    let destination = match placed {
        Placement::Skip(existing) => {
            return Ok(ExportResponse {
                path: existing.to_string_lossy().into_owned(),
                bytes: encoded.len() as u64,
                width,
                height,
                skipped: true,
                retina_path: None,
                retina_skipped: None,
            });
        }
        Placement::Write(destination) => {
            if destination == path {
                return Err("Refusing to overwrite the original".into());
            }
            fs::write(&destination, &encoded).map_err(write_error)?;
            destination
        }
    };

    let (retina_path, retina_skipped) = if output.retina2x {
        write_retina(path, settings, output, width, height)?
    } else {
        (None, None)
    };
    Ok(ExportResponse {
        path: destination.to_string_lossy().into_owned(),
        bytes: encoded.len() as u64,
        width,
        height,
        skipped: false,
        retina_path,
        retina_skipped,
    })
}

fn write_retina(
    path: &Path,
    settings: &PreviewSettings,
    output: &ExportOutput,
    width: u32,
    height: u32,
) -> Result<(Option<String>, Option<String>), String> {
    let mut doubled = settings.clone();
    doubled.width = doubled.width.map(|value| value.saturating_mul(2));
    doubled.height = doubled.height.map(|value| value.saturating_mul(2));
    if doubled.width.is_none() && doubled.height.is_none() {
        return Ok((None, Some("The 2× copy was skipped because this recipe has no size.".into())));
    }
    let loaded = load_source(path)?;
    let produced = produce(loaded.source_path(), &loaded.image, &doubled)?;
    if settings.never_upscale && (produced.plan.kept_native || produced.plan.fell_back_to_fit) {
        return Ok((
            None,
            Some("The 2× copy was skipped because it would enlarge this image.".into()),
        ));
    }
    let placed = place_export(path, output, produced.format, width, height, true)?;
    match placed {
        Placement::Skip(_) => Ok((
            None,
            Some("A 2× file with that name already exists, so it was left in place.".into()),
        )),
        Placement::Write(destination) => {
            fs::write(&destination, &produced.encoded).map_err(write_error)?;
            Ok((Some(destination.to_string_lossy().into_owned()), None))
        }
    }
}

struct Produced {
    output: DynamicImage,
    encoded: Vec<u8>,
    format: OutputFormat,
    quality: u8,
    alternative_format: Option<OutputFormat>,
    alternative_bytes: Option<u64>,
    target_missed: bool,
    plan: ResizePlan,
    pad_fell_back: bool,
    source_width: u32,
    source_height: u32,
}

fn produce(path: &Path, image: &DynamicImage, settings: &PreviewSettings) -> Result<Produced, String> {
    let cropped;
    let working = if let Some(crop) = settings.crop {
        cropped = apply_crop(image, crop)?;
        &cropped
    } else {
        image
    };
    let plan = resize::plan_resize(
        working.width(),
        working.height(),
        settings.width,
        settings.height,
        settings.mode,
        settings.never_upscale,
        settings.anchor,
    )
    .map_err(|_| "This image has no pixels".to_string())?;
    let (pad_fell_back, transparent) = pad_choices(settings);
    let output = render(working, &plan, settings, transparent)?;
    let encoded = encode(
        &output,
        encode::EncodeOptions {
            format: settings.format,
            quality: settings.quality,
            png_colors: settings.png_colors,
            png_dither: settings.png_dither,
            target_bytes: target_bytes(settings),
            metadata: metadata_write(path, settings),
            quality_floor: settings.quality_floor,
        },
    )?;
    Ok(Produced {
        source_width: working.width(),
        source_height: working.height(),
        output,
        encoded: encoded.bytes,
        format: encoded.format,
        quality: encoded.quality,
        alternative_format: encoded.alternative_format,
        alternative_bytes: encoded.alternative_bytes,
        target_missed: encoded.target_missed,
        plan,
        pad_fell_back,
    })
}

fn target_bytes(settings: &PreviewSettings) -> Option<u64> {
    if settings.format == OutputFormat::Png {
        return None;
    }
    settings
        .target_max_kb
        .filter(|kb| *kb > 0)
        .map(|kb| u64::from(kb) * 1024)
}

fn metadata_write(path: &Path, settings: &PreviewSettings) -> encode::MetadataWrite {
    if !settings.strip_metadata {
        return encode::MetadataWrite::Preserve(path.to_path_buf());
    }
    if settings.keep_copyright {
        return encode::MetadataWrite::Credit(encode::read_credit(path));
    }
    encode::MetadataWrite::None
}

fn pad_choices(settings: &PreviewSettings) -> (bool, bool) {
    let wants_transparent = settings.transparent_pad && settings.mode == FitMode::Pad;
    let fell_back = wants_transparent && settings.format == OutputFormat::Jpeg;
    (fell_back, wants_transparent && !fell_back)
}

struct LoadedSource {
    image: DynamicImage,
    profile_unread: bool,
    opened: crate::heic::Opened,
}

impl LoadedSource {
    fn source_path(&self) -> &Path {
        self.opened.path()
    }
}

fn write_error(err: std::io::Error) -> String {
    match err.kind() {
        std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::ReadOnlyFilesystem => {
            "The output folder is read-only.".into()
        }
        _ => err.to_string(),
    }
}

/// Animated GIFs are out of scope. HEIC is converted before this check.
fn unsupported_reason(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    if ext == "gif" && crate::ingest::is_animated_gif(path) {
        return Some("Animated GIFs are unsupported.".into());
    }
    None
}

pub(crate) struct SourcePreview {
    pub width: u32,
    pub height: u32,
    pub profile_unread: bool,
    /// Center pixel of the converted source, before the frame is resized.
    pub rgb: [u8; 3],
}

/// Decode and resize the way a preview does, without writing a file.
pub(crate) fn preview_file(path: &Path, settings: &PreviewSettings) -> Result<SourcePreview, String> {
    let loaded = load_source(path)?;
    let rgb = center_rgb(&loaded.image);
    let produced = produce(loaded.source_path(), &loaded.image, settings)?;
    Ok(SourcePreview {
        width: produced.plan.output_width,
        height: produced.plan.output_height,
        profile_unread: loaded.profile_unread,
        rgb,
    })
}

fn center_rgb(image: &DynamicImage) -> [u8; 3] {
    let rgb = image.to_rgb8();
    let pixel = rgb.get_pixel(rgb.width() / 2, rgb.height() / 2);
    [pixel[0], pixel[1], pixel[2]]
}

fn load_source(path: &Path) -> Result<LoadedSource, String> {
    if let Some(message) = unsupported_reason(path) {
        return Err(message);
    }
    let opened = crate::heic::open(path)?;
    let (image, _, profile) = decode_oriented(opened.path()).map_err(|_| "Could not read this file".to_string())?;
    let converted = crate::color::to_srgb(image, profile.as_deref());
    if converted.image.width() == 0 || converted.image.height() == 0 {
        return Err("This image has no pixels".into());
    }
    Ok(LoadedSource {
        image: converted.image,
        profile_unread: converted.profile_unread,
        opened,
    })
}

fn preview_url(
    output: &DynamicImage,
    full_bytes: &[u8],
    format: OutputFormat,
    quality: u8,
    png_colors: PngColors,
    png_dither: bool,
) -> Result<String, String> {
    let long_side = output.width().max(output.height());
    let bytes = if long_side > PREVIEW_LONG_SIDE {
        let preview = downscale_long_side(output, PREVIEW_LONG_SIDE)?;
        encode(
            &preview,
            encode::EncodeOptions {
                format,
                quality,
                png_colors,
                png_dither,
                target_bytes: None,
                metadata: encode::MetadataWrite::None,
                quality_floor: encode::QUALITY_FLOOR,
            },
        )?
        .bytes
    } else {
        full_bytes.to_vec()
    };
    Ok(data_url(encode::mime(format), &bytes))
}

fn settings_key(path: &Path, settings: &PreviewSettings) -> String {
    let mut value = serde_json::to_value(settings).unwrap_or(serde_json::Value::Null);
    if let Some(object) = value.as_object_mut() {
        object.remove("includeSource");
    }
    format!("{}|{value}", path.display())
}

/// Long side of the sample used to count colors. 160×160 can pass 10,000 unique colors.
const PHOTO_SAMPLE_SIDE: u32 = 160;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PhotoFacts {
    pub transparent: bool,
    pub unique_colors: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PngEstimate {
    pub bytes: Option<u64>,
    pub cancelled: bool,
}

fn estimate_generation() -> &'static AtomicU64 {
    static GENERATION: OnceLock<AtomicU64> = OnceLock::new();
    GENERATION.get_or_init(|| AtomicU64::new(0))
}

fn estimate_cache() -> &'static Mutex<HashMap<String, u64>> {
    static CACHE: OnceLock<Mutex<HashMap<String, u64>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn photo_cache() -> &'static Mutex<HashMap<String, PhotoFacts>> {
    static CACHE: OnceLock<Mutex<HashMap<String, PhotoFacts>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock_map<T>(map: &'static Mutex<T>) -> std::sync::MutexGuard<'static, T> {
    map.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn estimate_still_current(generation: u64) -> bool {
    estimate_generation().load(Ordering::Acquire) == generation
}

fn remember_estimate(key: &str, bytes: u64) {
    lock_map(estimate_cache()).insert(key.to_string(), bytes);
}

fn cached_estimate(key: &str) -> Option<u64> {
    lock_map(estimate_cache()).get(key).copied()
}

/// Bumps the estimate generation. An in-flight encode finishes, and the next option stops.
#[tauri::command]
pub fn begin_png_estimates() -> u64 {
    estimate_generation().fetch_add(1, Ordering::AcqRel) + 1
}

#[tauri::command]
pub async fn png_color_estimate(
    path: String,
    settings: PreviewSettings,
    generation: u64,
) -> Result<PngEstimate, String> {
    tauri::async_runtime::spawn_blocking(move || estimate_one(PathBuf::from(path), settings, generation))
        .await
        .map_err(|err| err.to_string())?
}

fn estimate_one(path: PathBuf, settings: PreviewSettings, generation: u64) -> Result<PngEstimate, String> {
    if !estimate_still_current(generation) {
        return Ok(PngEstimate { bytes: None, cancelled: true });
    }
    let key = settings_key(&path, &settings);
    if let Some(bytes) = cached_estimate(&key) {
        return Ok(PngEstimate { bytes: Some(bytes), cancelled: false });
    }
    if !estimate_still_current(generation) {
        return Ok(PngEstimate { bytes: None, cancelled: true });
    }
    let loaded = load_source(&path)?;
    if !estimate_still_current(generation) {
        return Ok(PngEstimate { bytes: None, cancelled: true });
    }
    let produced = produce(loaded.source_path(), &loaded.image, &settings)?;
    let bytes = produced.encoded.len() as u64;
    remember_estimate(&key, bytes);
    let cancelled = !estimate_still_current(generation);
    Ok(PngEstimate {
        bytes: if cancelled { None } else { Some(bytes) },
        cancelled,
    })
}

#[tauri::command]
pub async fn png_photo_facts(path: String) -> Result<PhotoFacts, String> {
    tauri::async_runtime::spawn_blocking(move || photo_facts_for_path(PathBuf::from(path)))
        .await
        .map_err(|err| err.to_string())?
}

fn photo_facts_for_path(path: PathBuf) -> Result<PhotoFacts, String> {
    let key = path.to_string_lossy().into_owned();
    if let Some(facts) = lock_map(photo_cache()).get(&key).cloned() {
        return Ok(facts);
    }
    let loaded = load_source(&path)?;
    let facts = photo_facts_from_image(&loaded.image);
    lock_map(photo_cache()).insert(key, facts.clone());
    Ok(facts)
}

pub(crate) fn photo_facts_from_image(image: &DynamicImage) -> PhotoFacts {
    let rgba = image.to_rgba8();
    let transparent = rgba.pixels().any(|pixel| pixel[3] < 255);
    let long = image.width().max(image.height()).max(1);
    let sample = if long > PHOTO_SAMPLE_SIDE {
        let scale = f64::from(PHOTO_SAMPLE_SIDE) / f64::from(long);
        let width = ((f64::from(image.width()) * scale).round() as u32).max(1);
        let height = ((f64::from(image.height()) * scale).round() as u32).max(1);
        image.resize(width, height, image::imageops::FilterType::Triangle)
    } else {
        image.clone()
    };
    let mut colors = std::collections::HashSet::new();
    for pixel in sample.to_rgba8().pixels() {
        colors.insert(*pixel);
    }
    PhotoFacts {
        transparent,
        unique_colors: colors.len() as u32,
    }
}

fn apply_crop(image: &DynamicImage, crop: CropRect) -> Result<DynamicImage, String> {
    if crop.width == 0 || crop.height == 0 {
        return Err("The crop is empty".into());
    }
    let right = crop
        .x
        .checked_add(crop.width)
        .ok_or("The crop is outside the image")?;
    let bottom = crop
        .y
        .checked_add(crop.height)
        .ok_or("The crop is outside the image")?;
    if right > image.width() || bottom > image.height() {
        return Err("The crop is outside the image".into());
    }
    Ok(image.crop_imm(crop.x, crop.y, crop.width, crop.height))
}

fn source_preview_url(image: &DynamicImage) -> Result<String, String> {
    let long_side = image.width().max(image.height());
    let shown = if long_side > PREVIEW_LONG_SIDE {
        downscale_long_side(image, PREVIEW_LONG_SIDE)?
    } else {
        image.clone()
    };
    let bytes = encode(&shown, encode::EncodeOptions::plain(OutputFormat::Webp, 75))?.bytes;
    Ok(data_url(encode::mime(OutputFormat::Webp), &bytes))
}

fn place_export(
    original: &Path,
    output: &ExportOutput,
    format: OutputFormat,
    width: u32,
    height: u32,
    retina: bool,
) -> Result<Placement, String> {
    let folder = match output.folder_mode {
        crate::recipe::FolderMode::Subfolder => {
            let parent = original
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
                .ok_or_else(|| "This file has no folder".to_string())?;
            let name = output.subfolder_name.trim();
            if name.is_empty() || name.contains('/') || name.contains('\\') {
                return Err("The output folder name can't include a folder.".into());
            }
            parent.join(name)
        }
        crate::recipe::FolderMode::Chosen => {
            let chosen = output.chosen_folder.as_deref().unwrap_or("").trim();
            if chosen.is_empty() {
                return Err("Choose an output folder first.".into());
            }
            PathBuf::from(chosen)
        }
    };
    let source_name = original
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or_else(|| "This file name cannot be used".to_string())?;
    let rendered = name::render_stem(
        &output.name_pattern,
        &NameParts {
            name: source_name,
            width,
            height,
            format: encode::extension(format),
            recipe: &output.recipe_name,
            date: &name::local_iso_date(),
            n: output.sequence,
        },
    )?;
    let stem = if retina { format!("{rendered}@2x") } else { rendered };
    fs::create_dir_all(&folder).map_err(write_error)?;
    let ext = encode::extension(format);
    let first = folder.join(format!("{stem}.{ext}"));
    if first == original {
        return Err("Refusing to overwrite the original".into());
    }
    if output.force_rename {
        return Ok(Placement::Write(numbered_name(&folder, &stem, ext, original)?));
    }
    if !first.exists() {
        return Ok(Placement::Write(first));
    }
    if output.conflict == crate::recipe::ConflictRule::Skip {
        return Ok(Placement::Skip(first));
    }
    Ok(Placement::Write(numbered_name(&folder, &stem, ext, original)?))
}

fn numbered_name(folder: &Path, stem: &str, ext: &str, original: &Path) -> Result<PathBuf, String> {
    let mut number = 1u32;
    loop {
        let candidate = folder.join(format!("{stem}-{number}.{ext}"));
        if candidate == original {
            return Err("Refusing to overwrite the original".into());
        }
        if !candidate.exists() {
            return Ok(candidate);
        }
        number = number.saturating_add(1);
        if number == 0 {
            return Err("Too many existing exports".into());
        }
    }
}

fn render(
    source: &DynamicImage,
    plan: &ResizePlan,
    settings: &PreviewSettings,
    transparent: bool,
) -> Result<DynamicImage, String> {
    let cropped = crop_source(source, plan);
    let content = resize_lanczos(&cropped, plan.content_width, plan.content_height)?;
    if plan.output_width == content.width() && plan.output_height == content.height() {
        return Ok(content);
    }
    pad_canvas(&content, plan, settings, transparent)
}

fn crop_source(source: &DynamicImage, plan: &ResizePlan) -> DynamicImage {
    if plan.crop_x == 0
        && plan.crop_y == 0
        && plan.crop_width == source.width()
        && plan.crop_height == source.height()
    {
        return source.clone();
    }
    source.crop_imm(plan.crop_x, plan.crop_y, plan.crop_width, plan.crop_height)
}

fn resize_lanczos(source: &DynamicImage, width: u32, height: u32) -> Result<DynamicImage, String> {
    if source.width() == width && source.height() == height {
        return Ok(source.clone());
    }
    let has_alpha = source.color().has_alpha();
    let pixel_type = if has_alpha {
        fast_image_resize::PixelType::U8x4
    } else {
        fast_image_resize::PixelType::U8x3
    };
    let pixels = if has_alpha {
        source.to_rgba8().into_raw()
    } else {
        source.to_rgb8().into_raw()
    };
    let mut working = fast_image_resize::images::Image::from_vec_u8(
        source.width(),
        source.height(),
        pixels,
        pixel_type,
    )
    .map_err(|err| err.to_string())?;
    let mul_div = fast_image_resize::MulDiv::default();
    if has_alpha {
        mul_div
            .multiply_alpha_inplace(&mut working)
            .map_err(|err| err.to_string())?;
    }
    let mut dest = fast_image_resize::images::Image::new(width, height, pixel_type);
    let mut resizer = fast_image_resize::Resizer::new();
    // The resizer also premultiplies when this option is left on. We already did it.
    let options = fast_image_resize::ResizeOptions::new().use_alpha(false);
    resizer
        .resize(&working, &mut dest, Some(&options))
        .map_err(|err| err.to_string())?;
    if has_alpha {
        mul_div
            .divide_alpha_inplace(&mut dest)
            .map_err(|err| err.to_string())?;
    }
    let buffer = dest.into_vec();
    if has_alpha {
        RgbaImage::from_raw(width, height, buffer)
            .map(DynamicImage::ImageRgba8)
            .ok_or_else(|| "Could not resize this image".to_string())
    } else {
        RgbImage::from_raw(width, height, buffer)
            .map(DynamicImage::ImageRgb8)
            .ok_or_else(|| "Could not resize this image".to_string())
    }
}

fn downscale_long_side(image: &DynamicImage, long_side: u32) -> Result<DynamicImage, String> {
    let (width, height) = if image.width() >= image.height() {
        (long_side, resize::scale_to(image.height(), long_side, image.width()))
    } else {
        (resize::scale_to(image.width(), long_side, image.height()), long_side)
    };
    resize_lanczos(image, width, height)
}

fn pad_canvas(
    content: &DynamicImage,
    plan: &ResizePlan,
    settings: &PreviewSettings,
    transparent: bool,
) -> Result<DynamicImage, String> {
    let color = parse_color(&settings.pad_color).unwrap_or(JPEG_PAD_FALLBACK);
    if transparent || content.color().has_alpha() {
        let mut canvas = RgbaImage::from_pixel(
            plan.output_width,
            plan.output_height,
            if transparent {
                Rgba([0, 0, 0, 0])
            } else {
                Rgba([color[0], color[1], color[2], 255])
            },
        );
        image::imageops::overlay(
            &mut canvas,
            &content.to_rgba8(),
            i64::from(plan.offset_x),
            i64::from(plan.offset_y),
        );
        Ok(DynamicImage::ImageRgba8(canvas))
    } else {
        let mut canvas = RgbImage::from_pixel(
            plan.output_width,
            plan.output_height,
            Rgb(color),
        );
        image::imageops::overlay(
            &mut canvas,
            &content.to_rgb8(),
            i64::from(plan.offset_x),
            i64::from(plan.offset_y),
        );
        Ok(DynamicImage::ImageRgb8(canvas))
    }
}

fn parse_color(value: &str) -> Option<[u8; 3]> {
    let hex = value.trim().trim_start_matches('#');
    if hex.len() != 6 {
        return None;
    }
    Some([
        u8::from_str_radix(&hex[0..2], 16).ok()?,
        u8::from_str_radix(&hex[2..4], 16).ok()?,
        u8::from_str_radix(&hex[4..6], 16).ok()?,
    ])
}

fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unused_export_path(
        original: &Path,
        format: OutputFormat,
        width: u32,
        height: u32,
    ) -> Result<PathBuf, String> {
        match place_export(original, &standard_output(), format, width, height, false)? {
            Placement::Write(path) | Placement::Skip(path) => Ok(path),
        }
    }

    fn standard_output() -> ExportOutput {
        ExportOutput {
            folder_mode: crate::recipe::FolderMode::Subfolder,
            subfolder_name: "squeasel".into(),
            chosen_folder: None,
            name_pattern: "{name}-{width}x{height}".into(),
            sequence: 1,
            recipe_name: "Recipe".into(),
            conflict: crate::recipe::ConflictRule::Rename,
            retina2x: false,
            force_rename: false,
        }
    }

    #[test]
    fn preview_and_export_json_use_camel_case() {
        let preview = PreviewResponse {
            preview_url: "data:image/jpeg;base64,abc".into(),
            width: 1920,
            height: 800,
            bytes: 169_000,
            kept_native: true,
            pad_fell_back: false,
            fell_back_to_fit: true,
            frame_width: 1920,
            frame_height: 800,
            source_preview_url: String::new(),
            chosen_format: OutputFormat::Jpeg,
            chosen_quality: 78,
            alternative_format: None,
            alternative_bytes: None,
            target_missed: false,
            profile_unread: false,
        };
        let preview_json = serde_json::to_value(&preview).unwrap();
        assert_eq!(preview_json["previewUrl"], "data:image/jpeg;base64,abc");
        assert_eq!(preview_json["keptNative"], true);
        assert_eq!(preview_json["padFellBack"], false);
        assert_eq!(preview_json["fellBackToFit"], true);
        assert_eq!(preview_json["frameWidth"], 1920);
        assert_eq!(preview_json["frameHeight"], 800);
        assert!(preview_json.get("preview_url").is_none());
        assert!(preview_json.get("kept_native").is_none());
        assert!(preview_json.get("fell_back_to_fit").is_none());
        assert_keys(
            &preview_json,
            &[
                "bytes",
                "fellBackToFit",
                "frameHeight",
                "frameWidth",
                "height",
                "keptNative",
                "alternativeBytes",
                "alternativeFormat",
                "chosenFormat",
                "chosenQuality",
                "padFellBack",
                "previewUrl",
                "profileUnread",
                "sourcePreviewUrl",
                "targetMissed",
                "width",
            ],
        );

        let export = ExportResponse {
            path: "/tmp/photo-1920x800.jpg".into(),
            bytes: 169_000,
            width: 1920,
            height: 800,
            skipped: false,
            retina_path: None,
            retina_skipped: None,
        };
        let export_json = serde_json::to_value(&export).unwrap();
        assert_eq!(export_json["path"], "/tmp/photo-1920x800.jpg");
        assert_eq!(export_json["skipped"], false);
        assert!(export_json.get("retina_path").is_none());
        assert!(export_json.get("preview_url").is_none());
        assert_keys(
            &export_json,
            &["bytes", "height", "path", "retinaPath", "retinaSkipped", "skipped", "width"],
        );
    }

    #[test]
    fn png_color_settings_use_camel_case_and_default_to_full() {
        let omitted = serde_json::json!({
            "width": 10,
            "height": 10,
            "mode": "fit",
            "neverUpscale": true,
            "padColor": "#F3F1EC",
            "transparentPad": false,
            "format": "png",
            "quality": 78
        });
        let settings: PreviewSettings = serde_json::from_value(omitted).unwrap();
        assert_eq!(settings.png_colors, PngColors::Full);
        assert!(settings.png_dither);
        let enabled = serde_json::json!({
            "width": null,
            "height": null,
            "mode": "fill",
            "neverUpscale": true,
            "padColor": "#F3F1EC",
            "transparentPad": false,
            "format": "png",
            "quality": 60,
            "pngColors": 64,
            "pngDither": false
        });
        let settings: PreviewSettings = serde_json::from_value(enabled).unwrap();
        assert_eq!(settings.png_colors, PngColors::Count(64));
        assert!(!settings.png_dither);
        let value = serde_json::to_value(&settings).unwrap();
        assert_eq!(value["pngColors"], 64);
        assert_eq!(value["pngDither"], false);
        assert!(value.get("png_colors").is_none());
        assert!(value.get("png_dither").is_none());
        assert!(value.get("lossyPng").is_none());
    }

    #[test]
    fn export_names_do_not_overwrite() {
        let root = std::env::temp_dir().join(format!(
            "squeasel-export-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let original = root.join("photo.jpg");
        fs::write(&original, b"original").unwrap();
        let first = unused_export_path(&original, OutputFormat::Jpeg, 1920, 800).unwrap();
        assert_eq!(first.file_name().unwrap(), "photo-1920x800.jpg");
        assert!(first.starts_with(root.join("squeasel")));
        fs::write(&first, b"one").unwrap();
        let second = unused_export_path(&original, OutputFormat::Jpeg, 1920, 800).unwrap();
        assert_eq!(second.file_name().unwrap(), "photo-1920x800-1.jpg");
        assert_ne!(first, original);
        assert_eq!(fs::read(&original).unwrap(), b"original");

        let other = root.join("other.jpg");
        fs::write(&other, b"other").unwrap();
        let mut shared = standard_output();
        shared.name_pattern = "shared".into();
        let shared_first = match place_export(&original, &shared, OutputFormat::Jpeg, 10, 10, false).unwrap() {
            Placement::Write(path) => path,
            Placement::Skip(_) => panic!("the first shared name should be free"),
        };
        assert_eq!(shared_first.file_name().unwrap(), "shared.jpg");
        fs::write(&shared_first, b"shared").unwrap();
        let shared_second = match place_export(&other, &shared, OutputFormat::Jpeg, 10, 10, false).unwrap() {
            Placement::Write(path) => path,
            Placement::Skip(_) => panic!("rename should number the second file"),
        };
        assert_eq!(shared_second.file_name().unwrap(), "shared-1.jpg");
        fs::write(&shared_second, b"shared-1").unwrap();
        let shared_third = match place_export(&other, &shared, OutputFormat::Jpeg, 10, 10, false).unwrap() {
            Placement::Write(path) => path,
            Placement::Skip(_) => panic!("rename should number the third file"),
        };
        assert_eq!(shared_third.file_name().unwrap(), "shared-2.jpg");
        shared.conflict = crate::recipe::ConflictRule::Skip;
        assert!(matches!(
            place_export(&other, &shared, OutputFormat::Jpeg, 10, 10, false).unwrap(),
            Placement::Skip(_)
        ));
        assert_eq!(fs::read(&original).unwrap(), b"original");
        assert_eq!(fs::read(&other).unwrap(), b"other");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_rerun_starts_at_minus_one_even_when_the_name_is_free_and_skip_is_set() {
        let root = std::env::temp_dir().join(format!(
            "squeasel-rerun-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let original = root.join("photo.jpg");
        fs::write(&original, b"original").unwrap();
        let mut output = standard_output();
        output.name_pattern = "{name}".into();
        output.conflict = crate::recipe::ConflictRule::Skip;
        output.force_rename = true;
        let placed = place_export(&original, &output, OutputFormat::Jpeg, 10, 10, false).unwrap();
        let Placement::Write(path) = placed else {
            panic!("a re-run must not skip");
        };
        assert_eq!(path.file_name().unwrap(), "photo-1.jpg");
        assert!(!root.join("squeasel").join("photo.jpg").exists());
        assert_eq!(fs::read(&original).unwrap(), b"original");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn readout_stays_on_the_full_encode_when_the_preview_is_capped() {
        with_preview_lock(|| {
            let root = temp_root("preview-cap");
            let path = root.join("wide.png");
            DynamicImage::new_rgb8(2100, 20)
                .save_with_format(&path, image::ImageFormat::Png)
                .unwrap();
            let settings = sample_settings(Some(2100), None, FitMode::Scale, OutputFormat::Png, false);
            let response = render_preview(path.clone(), settings.clone()).unwrap();
            assert_eq!((response.width, response.height), (2100, 20));
            let shown = image::load_from_memory(&decode_data_url(&response.preview_url)).unwrap();
            assert!(shown.width() <= PREVIEW_LONG_SIDE);
            assert!(shown.width() < response.width);

            let exported = export_preview(path, settings, standard_output()).unwrap();
            let on_disk = fs::read(&exported.path).unwrap();
            assert_eq!(on_disk.len() as u64, response.bytes);
            assert_eq!(exported.bytes, response.bytes);
            assert_eq!((exported.width, exported.height), (response.width, response.height));
            let _ = fs::remove_dir_all(root);
        });
    }

    #[test]
    fn cache_hit_returns_the_same_preview() {
        with_preview_lock(|| {
            let root = temp_root("preview-hit");
            let path = root.join("dot.png");
            DynamicImage::new_rgba8(8, 4)
                .save_with_format(&path, image::ImageFormat::Png)
                .unwrap();
            let settings = sample_settings(Some(4), Some(2), FitMode::Fit, OutputFormat::Png, false);
            let first = render_preview(path.clone(), settings.clone()).unwrap();
            assert!(first.preview_url.starts_with("data:image/png;base64,"));
            assert!(first.bytes > 0);
            let second = render_preview(path, settings).unwrap();
            assert_eq!(second.preview_url, first.preview_url);
            assert_eq!(second.bytes, first.bytes);
            let _ = fs::remove_dir_all(root);
        });
    }

    #[test]
    fn jpeg_transparent_pad_is_reported_and_soft_png_keeps_alpha() {
        with_preview_lock(|| {
            let root = temp_root("preview-alpha");
            let path = root.join("logo.png");
            let mut logo = RgbaImage::new(4, 4);
            logo.put_pixel(1, 1, Rgba([255, 0, 0, 128]));
            DynamicImage::ImageRgba8(logo)
                .save_with_format(&path, image::ImageFormat::Png)
                .unwrap();

            let mut jpeg = sample_settings(Some(16), Some(16), FitMode::Pad, OutputFormat::Jpeg, false);
            jpeg.transparent_pad = true;
            let jpeg_preview = render_preview(path.clone(), jpeg).unwrap();
            assert!(jpeg_preview.pad_fell_back);
            assert!(jpeg_preview.preview_url.starts_with("data:image/jpeg;base64,"));

            let png = sample_settings(Some(2), Some(2), FitMode::Fit, OutputFormat::Png, false);
            let png_preview = render_preview(path, png).unwrap();
            let decoded = image::load_from_memory(&decode_data_url(&png_preview.preview_url)).unwrap();
            assert!(decoded.color().has_alpha());
            let _ = fs::remove_dir_all(root);
        });
    }

    #[test]
    fn a_crop_outside_the_image_is_rejected_and_a_valid_crop_sets_the_output() {
        with_preview_lock(|| {
            let root = temp_root("preview-crop");
            let path = root.join("dot.png");
            DynamicImage::new_rgb8(40, 20)
                .save_with_format(&path, image::ImageFormat::Png)
                .unwrap();
            let mut outside = sample_settings(Some(10), Some(10), FitMode::Fill, OutputFormat::Png, false);
            outside.crop = Some(CropRect { x: 30, y: 0, width: 20, height: 10 });
            match render_preview(path.clone(), outside) {
                Err(err) => assert!(err.contains("outside"), "{err}"),
                Ok(_) => panic!("expected the crop to be rejected"),
            }

            let mut inside = sample_settings(Some(10), Some(5), FitMode::Fill, OutputFormat::Png, false);
            inside.crop = Some(CropRect { x: 0, y: 0, width: 20, height: 10 });
            let response = render_preview(path, inside).unwrap();
            assert_eq!((response.width, response.height), (10, 5));
            let _ = fs::remove_dir_all(root);
        });
    }

    #[test]
    fn export_of_the_gps_fixture_strips_location_and_can_keep_copyright() {
        use little_exif::exif_tag::ExifTag;
        use little_exif::filetype::FileExtension;
        use little_exif::ifd::ExifTagGroup;
        use little_exif::metadata::Metadata;

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

        with_preview_lock(|| {
            let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures/10-photo-exif-gps-copyright-2400x1600.jpg");
            let root = temp_root("gps-export");
            let source = root.join("photo.jpg");
            fs::copy(&fixture, &source).unwrap();
            let before = fs::read(&source).unwrap();
            // little_exif refuses this file: ExposureTime is stored as a DOUBLE.
            // The GPS IFD pointer (tag 0x8825) and the copyright lines are still in the TIFF.
            assert!(before.windows(4).any(|window| window == [0x88, 0x25, 0x00, 0x04]));
            assert!(before.windows(11).any(|window| window == b"Test Artist"));
            assert!(before.windows(22).any(|window| window == b"(c) 2026 Bitclone Test"));
            let source_copyright = Some("(c) 2026 Bitclone Test".to_string());
            let source_artist = Some("Test Artist".to_string());

            for (format, file_type) in [
                (OutputFormat::Jpeg, FileExtension::JPEG),
                (OutputFormat::Png, FileExtension::PNG { as_zTXt_chunk: false }),
                (OutputFormat::Webp, FileExtension::WEBP),
            ] {
                let mut stripped = sample_settings(Some(80), Some(40), FitMode::Fit, format, true);
                stripped.strip_metadata = true;
                stripped.keep_copyright = false;
                let exported = export_preview(source.clone(), stripped, standard_output()).unwrap();
                assert!(!exported.skipped);
                let file_bytes = fs::read(&exported.path).unwrap();
                assert!(!file_bytes.windows(7).any(|window| window == b"TestCam"));
                assert!(!file_bytes.windows(11).any(|window| window == b"Test Artist"));
                assert!(!file_bytes.windows(22).any(|window| window == b"(c) 2026 Bitclone Test"));
                match Metadata::new_from_vec(&file_bytes, file_type) {
                    Ok(written) => {
                        assert!(written.get_tag_by_hex(0x0002, Some(ExifTagGroup::GPS)).next().is_none());
                        assert!(written.get_tag_by_hex(0x8825, None).next().is_none());
                        assert!(tag_text(&written, ExifTag::Copyright(String::new())).is_none());
                        assert!(tag_text(&written, ExifTag::Artist(String::new())).is_none());
                    }
                    Err(_) => {
                        // A stripped file often has nothing little_exif can open
                        // (lossy WebP is a bare VP8 chunk). The byte checks above
                        // already showed the camera, artist, and copyright are gone.
                    }
                }

                let mut kept = sample_settings(Some(80), Some(40), FitMode::Fit, format, true);
                kept.strip_metadata = true;
                kept.keep_copyright = true;
                let exported = export_preview(source.clone(), kept, standard_output()).unwrap();
                let file_bytes = fs::read(&exported.path).unwrap();
                assert!(!file_bytes.windows(7).any(|window| window == b"TestCam"));
                let written = Metadata::new_from_vec(&file_bytes, file_type).unwrap();
                assert!(written.get_tag_by_hex(0x0002, Some(ExifTagGroup::GPS)).next().is_none());
                assert!(written.get_tag_by_hex(0x8825, None).next().is_none());
                let copyright = tag_text(&written, ExifTag::Copyright(String::new()));
                let artist = tag_text(&written, ExifTag::Artist(String::new()));
                if let Some(expected) = &source_copyright {
                    assert_eq!(copyright.as_ref(), Some(expected));
                }
                if let Some(expected) = &source_artist {
                    assert_eq!(artist.as_ref(), Some(expected));
                }
            }
            assert_eq!(fs::read(&source).unwrap(), before);
            let _ = fs::remove_dir_all(root);
        });
    }

    #[test]
    fn retina_writes_a_double_file_and_skips_when_it_would_enlarge() {
        with_preview_lock(|| {
            let root = temp_root("retina");
            let path = root.join("wide.png");
            DynamicImage::new_rgb8(20, 10)
                .save_with_format(&path, image::ImageFormat::Png)
                .unwrap();
            let settings = sample_settings(Some(4), Some(2), FitMode::Fill, OutputFormat::Png, true);
            let mut output = standard_output();
            output.retina2x = true;
            let exported = export_preview(path.clone(), settings, output).unwrap();
            let retina = exported.retina_path.expect("2x file");
            assert!(retina.ends_with("wide-4x2@2x.png"));
            let image = image::open(&retina).unwrap();
            assert_eq!((image.width(), image.height()), (8, 4));

            let small = root.join("small.png");
            DynamicImage::new_rgb8(4, 2)
                .save_with_format(&small, image::ImageFormat::Png)
                .unwrap();
            let settings = sample_settings(Some(4), Some(2), FitMode::Fill, OutputFormat::Png, true);
            let mut output = standard_output();
            output.retina2x = true;
            let exported = export_preview(small, settings, output).unwrap();
            assert!(exported.retina_path.is_none());
            assert!(exported.retina_skipped.unwrap().contains("enlarge"));
            let _ = fs::remove_dir_all(root);
        });
    }

    fn with_preview_lock(body: impl FnOnce()) {
        static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _guard = LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        close_preview();
        body();
        close_preview();
    }

    fn temp_root(label: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "squeasel-{label}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn sample_settings(
        width: Option<u32>,
        height: Option<u32>,
        mode: FitMode,
        format: OutputFormat,
        never_upscale: bool,
    ) -> PreviewSettings {
        PreviewSettings {
            width,
            height,
            mode,
            never_upscale,
            pad_color: "#F3F1EC".into(),
            transparent_pad: false,
            format,
            quality: 78,
            anchor: Anchor::Center,
            crop: None,
            include_source: false,
            png_colors: PngColors::Full,
            png_dither: true,
            target_max_kb: None,
            strip_metadata: true,
            keep_copyright: false,
            quality_floor: encode::QUALITY_FLOOR,
        }
    }

    #[test]
    fn optimize_settings_default_to_strip_on_and_no_size_target() {
        let settings: PreviewSettings = serde_json::from_str(
            r##"{"width":1,"height":1,"mode":"fit","neverUpscale":true,"padColor":"#fff","transparentPad":false,"format":"webp","quality":78}"##,
        )
        .unwrap();
        assert!(settings.strip_metadata);
        assert!(!settings.keep_copyright);
        assert!(settings.target_max_kb.is_none());
        assert_eq!(settings.png_colors, PngColors::Full);
        assert!(settings.png_dither);
        assert_eq!(settings.quality_floor, encode::QUALITY_FLOOR);
        let value = serde_json::to_value(&settings).unwrap();
        assert_eq!(value["stripMetadata"], true);
        assert_eq!(value["qualityFloor"], encode::QUALITY_FLOOR);
        assert_eq!(value["keepCopyright"], false);
        assert!(value.get("strip_metadata").is_none());
        assert!(value.get("target_max_kb").is_none());
    }

    #[test]
    fn estimate_cache_key_tracks_colors_quality_and_max_size() {
        let path = Path::new("/tmp/squeasel-estimate-key.png");
        let mut full = sample_settings(Some(100), Some(80), FitMode::Fit, OutputFormat::Png, true);
        full.png_colors = PngColors::Full;
        let mut reduced = full.clone();
        reduced.png_colors = PngColors::Count(64);
        reduced.png_dither = false;
        assert_ne!(settings_key(path, &full), settings_key(path, &reduced));

        let mut dithered = reduced.clone();
        dithered.png_dither = true;
        assert_ne!(settings_key(path, &reduced), settings_key(path, &dithered));

        let mut quality = full.clone();
        quality.format = OutputFormat::Webp;
        quality.quality = 60;
        let mut maxed = quality.clone();
        maxed.target_max_kb = Some(80);
        assert_ne!(settings_key(path, &quality), settings_key(path, &maxed));

        let mut sourced = full.clone();
        sourced.include_source = true;
        assert_eq!(settings_key(path, &full), settings_key(path, &sourced));

        let key = settings_key(path, &full);
        remember_estimate(&key, 4096);
        assert_eq!(cached_estimate(&key), Some(4096));
        assert_eq!(cached_estimate(&settings_key(path, &reduced)), None);
    }

    #[test]
    fn a_new_estimate_generation_cancels_the_previous_batch() {
        let first = begin_png_estimates();
        let second = begin_png_estimates();
        assert_ne!(first, second);
        assert!(!estimate_still_current(first));
        assert!(estimate_still_current(second));
        let stale = estimate_one(
            PathBuf::from("/missing-squeasel-estimate.png"),
            sample_settings(Some(10), Some(10), FitMode::Fit, OutputFormat::Png, true),
            first,
        )
        .unwrap();
        assert!(stale.cancelled);
        assert!(stale.bytes.is_none());
    }

    #[test]
    fn photo_facts_count_transparency_and_a_downscaled_sample() {
        let mut flat = RgbaImage::new(40, 20);
        for pixel in flat.pixels_mut() {
            *pixel = Rgba([10, 20, 30, 255]);
        }
        let facts = photo_facts_from_image(&DynamicImage::ImageRgba8(flat));
        assert!(!facts.transparent);
        assert_eq!(facts.unique_colors, 1);
        let value = serde_json::to_value(&facts).unwrap();
        assert_eq!(value["uniqueColors"], 1);
        assert!(value.get("unique_colors").is_none());

        let mut clear = RgbaImage::new(4, 4);
        for pixel in clear.pixels_mut() {
            *pixel = Rgba([1, 2, 3, 255]);
        }
        clear.put_pixel(0, 0, Rgba([0, 0, 0, 0]));
        assert!(photo_facts_from_image(&DynamicImage::ImageRgba8(clear)).transparent);

        let mut noisy = RgbaImage::new(180, 120);
        let mut state = 1u32;
        for pixel in noisy.pixels_mut() {
            state = state.wrapping_mul(1664525).wrapping_add(1013904223);
            *pixel = Rgba([(state >> 16) as u8, (state >> 8) as u8, state as u8, 255]);
        }
        let noisy_facts = photo_facts_from_image(&DynamicImage::ImageRgba8(noisy));
        assert!(!noisy_facts.transparent);
        assert!(
            noisy_facts.unique_colors > 10000,
            "{}",
            noisy_facts.unique_colors
        );
    }

    fn decode_data_url(url: &str) -> Vec<u8> {
        let encoded = url.split_once(',').unwrap().1;
        base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .unwrap()
    }

    fn assert_keys(value: &serde_json::Value, expected: &[&str]) {
        let mut keys: Vec<&str> = value.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort_unstable();
        let mut expected = expected.to_vec();
        expected.sort_unstable();
        assert_eq!(keys, expected);
    }
}
