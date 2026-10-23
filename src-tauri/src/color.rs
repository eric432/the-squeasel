//! Display P3, Adobe RGB, and gray profiles become sRGB when a preview is decoded.
//! Thumbnails do not come through here, and nothing writes a profile back out.
//! A profile that cannot be applied never fails the image: the pixels stay as they are.

use image::{DynamicImage, ImageBuffer, Rgb, Rgba};
use moxcms::{
    CicpColorPrimaries, ColorProfile, DataColorSpace, Layout, ProfileText, TransformOptions,
    TransferCharacteristics,
};

pub(crate) struct SrgbImage {
    pub image: DynamicImage,
    /// The file had a profile, and it could not be applied.
    pub profile_unread: bool,
}

pub(crate) fn to_srgb(image: DynamicImage, profile: Option<&[u8]>) -> SrgbImage {
    let Some(bytes) = profile else {
        return SrgbImage { image, profile_unread: false };
    };
    let Ok(source) = ColorProfile::new_from_slice(bytes) else {
        return SrgbImage { image, profile_unread: true };
    };
    if is_srgb(&source) {
        return SrgbImage { image, profile_unread: false };
    }
    match apply_profile(&source, &image) {
        Ok(converted) => SrgbImage { image: converted, profile_unread: false },
        Err(_) => SrgbImage { image, profile_unread: true },
    }
}

fn apply_profile(source: &ColorProfile, image: &DynamicImage) -> Result<DynamicImage, String> {
    let destination = ColorProfile::new_srgb();
    let options = TransformOptions::default();
    if source.color_space == DataColorSpace::Gray {
        return apply_gray(source, &destination, options, image);
    }
    if image.color().has_alpha() {
        let rgba = image.to_rgba8();
        let mut converted = vec![0u8; rgba.as_raw().len()];
        let transform = source
            .create_transform_8bit(Layout::Rgba, &destination, Layout::Rgba, options)
            .map_err(|err| format!("Could not convert this image to sRGB: {err:?}"))?;
        transform
            .transform(rgba.as_raw(), &mut converted)
            .map_err(|err| format!("Could not convert this image to sRGB: {err:?}"))?;
        let buffer = ImageBuffer::<Rgba<u8>, _>::from_raw(rgba.width(), rgba.height(), converted)
            .ok_or_else(|| "Converted pixels did not fit the image".to_string())?;
        return Ok(DynamicImage::ImageRgba8(buffer));
    }

    let rgb = image.to_rgb8();
    let mut converted = vec![0u8; rgb.as_raw().len()];
    let transform = source
        .create_transform_8bit(Layout::Rgb, &destination, Layout::Rgb, options)
        .map_err(|err| format!("Could not convert this image to sRGB: {err:?}"))?;
    transform
        .transform(rgb.as_raw(), &mut converted)
        .map_err(|err| format!("Could not convert this image to sRGB: {err:?}"))?;
    let buffer = ImageBuffer::<Rgb<u8>, _>::from_raw(rgb.width(), rgb.height(), converted)
        .ok_or_else(|| "Converted pixels did not fit the image".to_string())?;
    Ok(DynamicImage::ImageRgb8(buffer))
}

/// A gray profile's tone curve (gamma or a sampled curve such as dot gain) maps the
/// single channel into sRGB. The result is three equal channels.
fn apply_gray(
    source: &ColorProfile,
    destination: &ColorProfile,
    options: TransformOptions,
    image: &DynamicImage,
) -> Result<DynamicImage, String> {
    if image.color().has_alpha() {
        let gray = image.to_luma_alpha8();
        let pixels = gray
            .as_raw()
            .len()
            .checked_mul(2)
            .ok_or_else(|| "Converted pixels did not fit the image".to_string())?;
        let mut converted = vec![0u8; pixels];
        let transform = source
            .create_transform_8bit(Layout::GrayAlpha, destination, Layout::Rgba, options)
            .map_err(|err| format!("Could not convert this image to sRGB: {err:?}"))?;
        transform
            .transform(gray.as_raw(), &mut converted)
            .map_err(|err| format!("Could not convert this image to sRGB: {err:?}"))?;
        let buffer = ImageBuffer::<Rgba<u8>, _>::from_raw(gray.width(), gray.height(), converted)
            .ok_or_else(|| "Converted pixels did not fit the image".to_string())?;
        return Ok(DynamicImage::ImageRgba8(buffer));
    }

    let gray = image.to_luma8();
    let pixels = gray
        .as_raw()
        .len()
        .checked_mul(3)
        .ok_or_else(|| "Converted pixels did not fit the image".to_string())?;
    let mut converted = vec![0u8; pixels];
    let transform = source
        .create_transform_8bit(Layout::Gray, destination, Layout::Rgb, options)
        .map_err(|err| format!("Could not convert this image to sRGB: {err:?}"))?;
    transform
        .transform(gray.as_raw(), &mut converted)
        .map_err(|err| format!("Could not convert this image to sRGB: {err:?}"))?;
    let buffer = ImageBuffer::<Rgb<u8>, _>::from_raw(gray.width(), gray.height(), converted)
        .ok_or_else(|| "Converted pixels did not fit the image".to_string())?;
    Ok(DynamicImage::ImageRgb8(buffer))
}

fn is_srgb(profile: &ColorProfile) -> bool {
    if profile
        .description
        .as_ref()
        .is_some_and(|text| profile_text(text).to_ascii_lowercase().contains("srgb"))
    {
        return true;
    }
    profile.cicp.as_ref().is_some_and(|cicp| {
        cicp.color_primaries == CicpColorPrimaries::Bt709
            && cicp.transfer_characteristics == TransferCharacteristics::Srgb
    })
}

fn profile_text(text: &ProfileText) -> String {
    match text {
        ProfileText::PlainString(value) => value.clone(),
        ProfileText::Localizable(items) => items
            .iter()
            .map(|item| item.value.clone())
            .collect::<Vec<_>>()
            .join(" "),
        ProfileText::Description(value) => format!("{} {}", value.ascii_string, value.unicode_string),
    }
}

#[cfg(test)]
pub(crate) fn gray_gamma_profile(gamma: f32) -> Vec<u8> {
    let gamma_u88 = (gamma * 256.0).round() as u16;
    let mut curve = Vec::new();
    curve.extend_from_slice(b"curv");
    curve.extend_from_slice(&[0, 0, 0, 0]);
    curve.extend_from_slice(&1u32.to_be_bytes());
    curve.extend_from_slice(&gamma_u88.to_be_bytes());
    icc_profile(b"GRAY", &[(*b"desc", text_desc("Gray Gamma")), (*b"wtpt", d50_white()), (*b"kTRC", curve)])
}

/// A gray profile with no tone curve. It parses, and the transform cannot be built.
#[cfg(test)]
pub(crate) fn gray_profile_without_curve() -> Vec<u8> {
    icc_profile(b"GRAY", &[(*b"desc", text_desc("Gray")), (*b"wtpt", d50_white())])
}

#[cfg(test)]
pub(crate) fn gray_jpeg_bytes(value: u8, profile: Option<Vec<u8>>) -> Vec<u8> {
    use image::codecs::jpeg::JpegEncoder;
    use image::{ExtendedColorType, ImageEncoder};
    let mut bytes = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut bytes, 95);
    if let Some(profile) = profile {
        encoder.set_icc_profile(profile).unwrap();
    }
    encoder
        .write_image(&[value; 64], 8, 8, ExtendedColorType::L8)
        .unwrap();
    bytes
}

#[cfg(test)]
fn text_desc(name: &str) -> Vec<u8> {
    let mut ascii = name.as_bytes().to_vec();
    ascii.push(0);
    let mut tag = Vec::new();
    tag.extend_from_slice(b"desc");
    tag.extend_from_slice(&[0, 0, 0, 0]);
    tag.extend_from_slice(&(ascii.len() as u32).to_be_bytes());
    tag.extend_from_slice(&ascii);
    tag.extend_from_slice(&0u32.to_be_bytes());
    tag.extend_from_slice(&0u32.to_be_bytes());
    tag.extend_from_slice(&0u16.to_be_bytes());
    tag.push(0);
    tag.extend(std::iter::repeat(0).take(67));
    tag
}

#[cfg(test)]
fn d50_white() -> Vec<u8> {
    let mut tag = Vec::new();
    tag.extend_from_slice(b"XYZ ");
    tag.extend_from_slice(&[0, 0, 0, 0]);
    tag.extend_from_slice(&0x0000F6D6u32.to_be_bytes());
    tag.extend_from_slice(&0x00010000u32.to_be_bytes());
    tag.extend_from_slice(&0x0000D32Du32.to_be_bytes());
    tag
}

#[cfg(test)]
fn icc_profile(space: &[u8; 4], tags: &[([u8; 4], Vec<u8>)]) -> Vec<u8> {
    let header = 128usize;
    let table = 4 + tags.len() * 12;
    let mut body = Vec::new();
    let mut placed = Vec::new();
    for (sig, data) in tags {
        placed.push((*sig, header + table + body.len(), data.len()));
        body.extend_from_slice(data);
        while (header + table + body.len()) % 4 != 0 {
            body.push(0);
        }
    }
    let total = header + table + body.len();
    let mut profile = vec![0u8; header + table];
    profile.extend_from_slice(&body);
    profile[0..4].copy_from_slice(&(total as u32).to_be_bytes());
    profile[8..12].copy_from_slice(&[0x02, 0x20, 0x00, 0x00]);
    profile[12..16].copy_from_slice(b"mntr");
    profile[16..20].copy_from_slice(space);
    profile[20..24].copy_from_slice(b"XYZ ");
    profile[36..40].copy_from_slice(b"acsp");
    profile[68..72].copy_from_slice(&0x0000F6D6u32.to_be_bytes());
    profile[72..76].copy_from_slice(&0x00010000u32.to_be_bytes());
    profile[76..80].copy_from_slice(&0x0000D32Du32.to_be_bytes());
    profile[128..132].copy_from_slice(&(tags.len() as u32).to_be_bytes());
    for (index, (sig, offset, len)) in placed.iter().enumerate() {
        let at = 132 + index * 12;
        profile[at..at + 4].copy_from_slice(sig);
        profile[at + 4..at + 8].copy_from_slice(&(*offset as u32).to_be_bytes());
        profile[at + 8..at + 12].copy_from_slice(&(*len as u32).to_be_bytes());
    }
    profile
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile_needs_conversion(profile: Option<&[u8]>) -> bool {
        let Some(bytes) = profile else {
            return false;
        };
        let Ok(parsed) = ColorProfile::new_from_slice(bytes) else {
            return false;
        };
        !is_srgb(&parsed)
    }

    #[test]
    fn missing_and_srgb_profiles_pass_through() {
        assert!(!profile_needs_conversion(None));
        let srgb = ColorProfile::new_srgb().encode().unwrap();
        assert!(!profile_needs_conversion(Some(&srgb)));
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(2, 2, Rgb([40, 80, 120])));
        let untouched = to_srgb(image.clone(), None);
        assert!(!untouched.profile_unread);
        assert_eq!(untouched.image.to_rgb8().as_raw(), image.to_rgb8().as_raw());
        let still = to_srgb(image.clone(), Some(&srgb));
        assert!(!still.profile_unread);
        assert_eq!(still.image.to_rgb8().as_raw(), image.to_rgb8().as_raw());
    }

    #[test]
    fn display_p3_and_adobe_rgb_need_conversion_and_no_profile_is_written() {
        let display_p3 = ColorProfile::new_display_p3().encode().unwrap();
        let adobe = ColorProfile::new_adobe_rgb().encode().unwrap();
        assert!(profile_needs_conversion(Some(&display_p3)));
        assert!(profile_needs_conversion(Some(&adobe)));

        let image = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(2, 2, Rgb([200, 80, 40])));
        let converted = to_srgb(image.clone(), Some(&display_p3));
        assert!(!converted.profile_unread);
        assert_ne!(converted.image.to_rgb8().as_raw(), image.to_rgb8().as_raw());

        let encoded = crate::encode::encode(
            &converted.image,
            crate::encode::EncodeOptions::plain(crate::resize::OutputFormat::Jpeg, 80),
        )
        .unwrap();
        assert!(encoded.bytes.windows(11).all(|window| window != b"ICC_PROFILE"));
    }

    #[test]
    fn a_gray_gamma_jpeg_uses_the_tone_curve() {
        let profile = gray_gamma_profile(1.0);
        let parsed = ColorProfile::new_from_slice(&profile).unwrap();
        assert_eq!(parsed.color_space, DataColorSpace::Gray);
        let decoded = decode_gray_jpeg(gray_jpeg_bytes(128, Some(profile)));
        assert_eq!(decoded.0.color(), image::ColorType::L8);
        let converted = to_srgb(decoded.0, decoded.1.as_deref());
        assert!(!converted.profile_unread);
        let pixel = converted.image.to_rgb8().get_pixel(0, 0).0;
        assert_eq!(pixel[0], pixel[1]);
        assert_eq!(pixel[1], pixel[2]);
        // Linear gray 128 is about sRGB 188. Leaving the bytes alone would stay at 128.
        assert!((170..=210).contains(&pixel[0]), "pixel {}", pixel[0]);
    }

    #[test]
    fn a_gray_jpeg_without_a_profile_stays_as_it_is() {
        let decoded = decode_gray_jpeg(gray_jpeg_bytes(128, None));
        assert!(decoded.1.is_none());
        let converted = to_srgb(decoded.0, decoded.1.as_deref());
        assert!(!converted.profile_unread);
        assert_eq!(converted.image.to_luma8().get_pixel(0, 0).0, [128]);
    }

    #[test]
    fn a_gray_profile_that_cannot_be_applied_falls_back_to_the_pixels() {
        let profile = gray_profile_without_curve();
        assert!(ColorProfile::new_from_slice(&profile).is_ok());
        let decoded = decode_gray_jpeg(gray_jpeg_bytes(128, Some(profile)));
        let converted = to_srgb(decoded.0, decoded.1.as_deref());
        assert!(converted.profile_unread);
        assert_eq!(converted.image.to_luma8().get_pixel(0, 0).0, [128]);
    }

    fn decode_gray_jpeg(bytes: Vec<u8>) -> (DynamicImage, Option<Vec<u8>>) {
        let path = std::env::temp_dir().join(format!(
            "squeasel-gray-{}-{}.jpg",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(&path, bytes).unwrap();
        let (image, _, profile) = crate::ingest::decode_oriented(&path).unwrap();
        let _ = std::fs::remove_file(path);
        (image, profile)
    }
}
