//! HEIC and HEIF are decoded by `/usr/bin/sips`, not by a new library.
//!
//! sips writes a temporary JPEG. JPEG keeps the color profile, the orientation
//! tag, and the copyright, which is what the rest of the pipeline already reads.
//! The original is only an input. The temp file is removed when this value is
//! dropped, including when the caller fails or stops early.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

#[derive(Debug)]
pub(crate) struct Opened {
    decode: PathBuf,
    temp: Option<PathBuf>,
}

impl Opened {
    pub(crate) fn path(&self) -> &Path {
        &self.decode
    }
}

impl Drop for Opened {
    fn drop(&mut self) {
        if let Some(temp) = self.temp.take() {
            let _ = std::fs::remove_file(temp);
        }
    }
}

pub(crate) fn is_heic(path: &Path) -> bool {
    matches!(extension(path).as_deref(), Some("heic" | "heif"))
}

/// The path to decode. A HEIC or HEIF becomes a temp JPEG. Anything else is unchanged.
pub(crate) fn open(path: &Path) -> Result<Opened, String> {
    if !is_heic(path) {
        return Ok(Opened {
            decode: path.to_path_buf(),
            temp: None,
        });
    }
    let temp = temp_jpeg();
    let converted = std::process::Command::new("/usr/bin/sips")
        .args(["-s", "format", "jpeg"])
        .arg(path)
        .arg("--out")
        .arg(&temp)
        .output();
    let ok = matches!(&converted, Ok(output) if output.status.success())
        && std::fs::metadata(&temp).map(|meta| meta.len() > 0).unwrap_or(false);
    if ok {
        return Ok(Opened {
            decode: temp.clone(),
            temp: Some(temp),
        });
    }
    let _ = std::fs::remove_file(&temp);
    Err(read_error(path))
}

fn extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
}

fn read_error(path: &Path) -> String {
    if extension(path).as_deref() == Some("heif") {
        "Could not read this HEIF file.".into()
    } else {
        "Could not read this HEIC file.".into()
    }
}

fn temp_jpeg() -> PathBuf {
    let seq = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!(
        "squeasel-heic-{}-{}-{seq}.jpg",
        std::process::id(),
        nanos
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn the_temp_jpeg_is_removed_on_drop_and_a_corrupt_file_leaves_nothing() {
        let dir = std::env::temp_dir().join(format!(
            "squeasel-heic-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let jpeg = dir.join("plain.jpg");
        image::RgbImage::from_pixel(8, 8, image::Rgb([40, 120, 200]))
            .save(&jpeg)
            .unwrap();
        let heic = dir.join("photo.heic");
        let converted = std::process::Command::new("/usr/bin/sips")
            .args(["-s", "format", "heic"])
            .arg(&jpeg)
            .arg("--out")
            .arg(&heic)
            .status()
            .expect("sips");
        assert!(converted.success(), "sips could not write a HEIC");

        let before = leftover_temps();
        {
            let opened = open(&heic).expect("a real HEIC should convert");
            assert!(opened.path().exists());
            assert_ne!(opened.path(), heic.as_path());
            assert!(opened.temp.is_some());
        }
        assert_eq!(leftover_temps(), before, "dropping the conversion left a temp JPEG");

        let junk = dir.join("notes.heic");
        fs::write(&junk, b"this is not a heic file").unwrap();
        let err = open(&junk).expect_err("a corrupt HEIC should fail");
        assert_eq!(err, "Could not read this HEIC file.");
        assert_eq!(leftover_temps(), before, "a failed conversion left a temp JPEG");

        let heif = dir.join("photo.heif");
        fs::copy(&heic, &heif).unwrap();
        let opened = open(&heif).expect("a HEIF container should convert");
        assert!(opened.path().extension().and_then(|ext| ext.to_str()) == Some("jpg"));
        drop(opened);
        assert_eq!(leftover_temps(), before);

        let _ = fs::remove_dir_all(dir);
    }

    fn leftover_temps() -> usize {
        fs::read_dir(std::env::temp_dir())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_str()
                    .is_some_and(|name| name.starts_with("squeasel-heic-") && name.ends_with(".jpg"))
            })
            .count()
    }
}
