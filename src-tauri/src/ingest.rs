//! Scan dropped paths and build in-memory thumbnails.
//!
//! Nothing in this module creates, writes, or renames files. Originals stay as they are.

use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{BufReader, Cursor};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use base64::Engine;
use image::codecs::jpeg::JpegEncoder;
use image::{AnimationDecoder, DynamicImage, ImageDecoder, ImageFormat, ImageReader};
use rayon::ThreadPoolBuilder;
use serde::Serialize;
use tauri::ipc::Channel;

const THUMB_LONG_SIDE: u32 = 320;
/// Four decodes at a time. A 6000×4000 JPEG expands to about 72 MB
/// (24 megapixels × 3 bytes), so four in flight is ~288 MB before the
/// thumbnail copy. Six would be ~432 MB, which is the high end of the cap.
const THUMB_THREADS: usize = 4;
const TIMING_SAMPLES: u32 = 5;

/// Set `SQUEASEL_THUMB_TIMING=1` to log decode, resize, and encode for the
/// first five thumbnails of this process. Off unless that variable is set.
fn thumb_timing_enabled() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(|| std::env::var("SQUEASEL_THUMB_TIMING").as_deref() == Ok("1"))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScannedFile {
    pub(crate) id: String,
    pub(crate) path: String,
    pub(crate) name: String,
    pub(crate) bytes: u64,
}

#[derive(Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum IngestEvent {
    Scanned {
        files: Vec<ScannedFile>,
        skipped: u32,
    },
    Ready {
        id: String,
        width: u32,
        height: u32,
        format: String,
        thumbnail_url: String,
    },
    Error {
        id: String,
    },
    Done,
}

struct LoadedImage {
    width: u32,
    height: u32,
    format: &'static str,
    thumbnail_url: String,
}

/// One drop. `cancelled` stops every file that has not started decoding.
/// `removed` stops individual cards the same way. A decode already running
/// may finish; its result is then discarded.
struct BatchCancel {
    generation: u64,
    cancelled: AtomicBool,
    removed: Mutex<HashSet<String>>,
}

impl BatchCancel {
    fn new(generation: u64) -> Self {
        Self {
            generation,
            cancelled: AtomicBool::new(false),
            removed: Mutex::new(HashSet::new()),
        }
    }

    fn stopped(&self) -> bool {
        self.cancelled.load(Ordering::Acquire) || generation_cancelled(self.generation)
    }

    fn skips(&self, id: &str) -> bool {
        if self.stopped() {
            return true;
        }
        self.removed
            .lock()
            .map(|removed| removed.contains(id))
            .unwrap_or(false)
    }
}

/// Generations strictly below this value are cancelled.
/// Clear all advances it, so a later drop (a higher generation) is untouched
/// even if the cancel command arrives after that drop has started.
fn cancel_before() -> &'static AtomicU64 {
    static CANCEL_BEFORE: OnceLock<AtomicU64> = OnceLock::new();
    CANCEL_BEFORE.get_or_init(|| AtomicU64::new(0))
}

fn generation_cancelled(generation: u64) -> bool {
    generation < cancel_before().load(Ordering::Acquire)
}

fn active_batches() -> &'static Mutex<Vec<Arc<BatchCancel>>> {
    static BATCHES: OnceLock<Mutex<Vec<Arc<BatchCancel>>>> = OnceLock::new();
    BATCHES.get_or_init(|| Mutex::new(Vec::new()))
}

fn lock_batches() -> std::sync::MutexGuard<'static, Vec<Arc<BatchCancel>>> {
    active_batches()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

struct BatchGuard(Arc<BatchCancel>);

impl Drop for BatchGuard {
    fn drop(&mut self) {
        lock_batches().retain(|batch| !Arc::ptr_eq(batch, &self.0));
    }
}

/// Stops thumbnail work that has not started for this drop.
/// A later drop uses a new generation and keeps running.
#[tauri::command]
pub fn cancel_ingest(generation: u64) {
    cancel_before().fetch_max(generation.saturating_add(1), Ordering::AcqRel);
    for batch in lock_batches().iter() {
        if batch.generation <= generation {
            batch.cancelled.store(true, Ordering::Release);
        }
    }
}

/// Stops thumbnail work that has not started for one file.
#[tauri::command]
pub fn cancel_image(id: String) {
    for batch in lock_batches().iter() {
        if let Ok(mut removed) = batch.removed.lock() {
            removed.insert(id.clone());
        }
    }
}

/// Starts a scan on a background thread and streams results back on `on_event`.
/// The command returns immediately so a large drop cannot block the window.
#[tauri::command]
pub fn ingest_images(
    paths: Vec<String>,
    known_ids: Vec<String>,
    generation: u64,
    on_event: Channel<IngestEvent>,
) {
    let batch = Arc::new(BatchCancel::new(generation));
    lock_batches().push(Arc::clone(&batch));

    std::thread::spawn(move || {
        let _guard = BatchGuard(Arc::clone(&batch));
        let known: HashSet<String> = known_ids.into_iter().collect();
        let (files, skipped) = scan_inputs(&paths, &known);
        if batch.stopped() {
            let _ = on_event.send(IngestEvent::Done);
            return;
        }
        if on_event
            .send(IngestEvent::Scanned {
                files: files.clone(),
                skipped,
            })
            .is_err()
        {
            return;
        }

        // Cap the pool so a folder of large photos is not decoded all at once.
        // scope blocks until every queued thumbnail has been considered.
        match ThreadPoolBuilder::new().num_threads(THUMB_THREADS).build() {
            Ok(pool) => {
                pool.scope(|scope| {
                    for file in files {
                        let on_event = on_event.clone();
                        let batch = Arc::clone(&batch);
                        scope.spawn(move |_| send_thumbnail(file, &on_event, &batch));
                    }
                });
            }
            Err(_) => {
                for file in files {
                    send_thumbnail(file, &on_event, &batch);
                }
            }
        }

        let _ = on_event.send(IngestEvent::Done);
    });
}

fn send_thumbnail(file: ScannedFile, on_event: &Channel<IngestEvent>, batch: &BatchCancel) {
    if batch.skips(&file.id) {
        return;
    }
    let event = match load_image(Path::new(&file.path)) {
        Ok(loaded) => IngestEvent::Ready {
            id: file.id,
            width: loaded.width,
            height: loaded.height,
            format: loaded.format.to_string(),
            thumbnail_url: loaded.thumbnail_url,
        },
        Err(_) => IngestEvent::Error { id: file.id },
    };
    // A decode that was already running may finish. Ignore it after Clear or Remove.
    if batch.skips(&event_id(&event)) {
        return;
    }
    let _ = on_event.send(event);
}

fn event_id(event: &IngestEvent) -> &str {
    match event {
        IngestEvent::Ready { id, .. } | IngestEvent::Error { id } => id,
        IngestEvent::Scanned { .. } | IngestEvent::Done => "",
    }
}

pub(crate) fn scan_inputs(paths: &[String], known_ids: &HashSet<String>) -> (Vec<ScannedFile>, u32) {
    let mut files = Vec::new();
    let mut skipped = 0;
    let mut seen_ids = HashSet::new();
    let mut seen_dirs = HashSet::new();
    for raw in paths {
        scan_one(
            Path::new(raw),
            known_ids,
            &mut seen_ids,
            &mut seen_dirs,
            &mut files,
            &mut skipped,
        );
    }
    (files, skipped)
}

fn scan_one(
    path: &Path,
    known_ids: &HashSet<String>,
    seen_ids: &mut HashSet<String>,
    seen_dirs: &mut HashSet<PathBuf>,
    files: &mut Vec<ScannedFile>,
    skipped: &mut u32,
) {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return;
    };

    // A symlink to a folder is not followed. A symlink to a file is the file itself.
    if meta.file_type().is_symlink() {
        match fs::metadata(path) {
            Ok(target) if target.is_file() => {
                consider_file(path, known_ids, seen_ids, files, skipped);
            }
            _ => {}
        }
        return;
    }

    if meta.is_dir() {
        if is_hidden(path) {
            return;
        }
        walk_dir(path, known_ids, seen_ids, seen_dirs, files, skipped);
        return;
    }

    if meta.is_file() {
        consider_file(path, known_ids, seen_ids, files, skipped);
    }
}

fn walk_dir(
    dir: &Path,
    known_ids: &HashSet<String>,
    seen_ids: &mut HashSet<String>,
    seen_dirs: &mut HashSet<PathBuf>,
    files: &mut Vec<ScannedFile>,
    skipped: &mut u32,
) {
    let canonical = fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
    if !seen_dirs.insert(canonical) {
        return;
    }

    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let name = entry.file_name();
        // Dotfiles and hidden folders (including .DS_Store) are ignored and not counted.
        if is_hidden_name(&name) {
            continue;
        }

        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let path = entry.path();

        if file_type.is_symlink() {
            match fs::metadata(&path) {
                Ok(target) if target.is_file() => {
                    consider_file(&path, known_ids, seen_ids, files, skipped);
                }
                _ => {}
            }
            continue;
        }

        if file_type.is_dir() {
            walk_dir(&path, known_ids, seen_ids, seen_dirs, files, skipped);
            continue;
        }

        if file_type.is_file() {
            consider_file(&path, known_ids, seen_ids, files, skipped);
        }
    }
}

fn consider_file(
    path: &Path,
    known_ids: &HashSet<String>,
    seen_ids: &mut HashSet<String>,
    files: &mut Vec<ScannedFile>,
    skipped: &mut u32,
) {
    let Some(ext) = extension_of(path) else {
        *skipped += 1;
        return;
    };
    if !is_supported_extension(&ext) {
        *skipped += 1;
        return;
    }
    // Animated GIFs are out of scope. Count them with the other unsupported files.
    if ext == "gif" && is_animated_gif(path) {
        *skipped += 1;
        return;
    }

    let id = fs::canonicalize(path)
        .map(|canonical| canonical.to_string_lossy().into_owned())
        .unwrap_or_else(|_| path.to_string_lossy().into_owned());
    if known_ids.contains(&id) || !seen_ids.insert(id.clone()) {
        return;
    }

    let name = path
        .file_name()
        .map(|file_name| file_name.to_string_lossy().into_owned())
        .unwrap_or_else(|| id.clone());
    let bytes = fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
    files.push(ScannedFile {
        id: id.clone(),
        path: id,
        name,
        bytes,
    });
}

fn is_hidden(path: &Path) -> bool {
    path.file_name().is_some_and(|name| is_hidden_name(name))
}

fn is_hidden_name(name: &std::ffi::OsStr) -> bool {
    name.to_str().is_some_and(|text| text.starts_with('.'))
}

fn extension_of(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
}

fn is_supported_extension(ext: &str) -> bool {
    matches!(
        ext,
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "tif" | "tiff" | "heic" | "heif"
    )
}

/// True only when a second GIF frame exists. A read failure is left for the error card.
pub(crate) fn is_animated_gif(path: &Path) -> bool {
    let Ok(file) = File::open(path) else {
        return false;
    };
    let Ok(decoder) = image::codecs::gif::GifDecoder::new(BufReader::new(file)) else {
        return false;
    };
    let mut frames = decoder.into_frames();
    if frames.next().is_none() {
        return false;
    }
    matches!(frames.next(), Some(Ok(_)))
}

fn load_image(path: &Path) -> Result<LoadedImage, ()> {
    let timed = thumb_timing_enabled();
    let decode_started = timed.then(Instant::now);
    // A HEIC is converted first. The temp JPEG is removed when this function returns,
    // including when the thumbnail is then discarded because the drop was cancelled.
    let opened = crate::heic::open(path).map_err(|_| ())?;
    let (image, decoded_format, _profile) = decode_oriented(opened.path())?;
    let format = if crate::heic::is_heic(path) { "heic" } else { decoded_format };
    let decode = decode_started.map(|start| start.elapsed());

    if image.width() == 0 || image.height() == 0 {
        return Err(());
    }

    let resize_started = timed.then(Instant::now);
    let thumb = downscale_thumbnail(&image);
    let resize = resize_started.map(|start| start.elapsed());

    let encode_started = timed.then(Instant::now);
    let thumbnail_url = encode_thumbnail_bytes(&thumb).map_err(|_| ())?;
    if let (Some(decode), Some(resize), Some(encode_started)) = (decode, resize, encode_started) {
        log_thumb_timing(path, decode, resize, encode_started.elapsed());
    }

    Ok(LoadedImage {
        width: image.width(),
        height: image.height(),
        format,
        thumbnail_url,
    })
}

pub(crate) fn decode_oriented(path: &Path) -> Result<(DynamicImage, &'static str, Option<Vec<u8>>), ()> {
    let reader = ImageReader::open(path)
        .map_err(|_| ())?
        .with_guessed_format()
        .map_err(|_| ())?;
    let format = match reader.format() {
        Some(ImageFormat::Jpeg) => "jpeg",
        Some(ImageFormat::Png) => "png",
        Some(ImageFormat::WebP) => "webp",
        Some(ImageFormat::Gif) => "gif",
        Some(ImageFormat::Tiff) => "tiff",
        _ => return Err(()),
    };

    let mut decoder = reader.into_decoder().map_err(|_| ())?;
    // Pixel buffers ignore EXIF orientation. Apply it before measuring or resizing
    // so a portrait photo is not sideways and its width and height are not swapped.
    let orientation = decoder
        .orientation()
        .unwrap_or(image::metadata::Orientation::NoTransforms);
    // Read the profile before from_decoder consumes the decoder. Thumbnails ignore it.
    let profile = decoder.icc_profile().ok().flatten();
    let mut image = DynamicImage::from_decoder(decoder).map_err(|_| ())?;
    image.apply_orientation(orientation);
    Ok((image, format, profile))
}

/// Fast integer downscale. Each source pixel lands in one output pixel.
/// Lanczos (and the slower Triangle filter) are not used on the full image.
fn downscale_thumbnail(image: &DynamicImage) -> DynamicImage {
    if image.width().max(image.height()) <= THUMB_LONG_SIDE {
        image.clone()
    } else {
        image.thumbnail(THUMB_LONG_SIDE, THUMB_LONG_SIDE)
    }
}

fn encode_thumbnail_bytes(thumb: &DynamicImage) -> image::ImageResult<String> {
    let mut bytes = Vec::new();
    if thumb.color().has_alpha() {
        thumb.write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)?;
        Ok(data_url("image/png", &bytes))
    } else {
        let mut encoder = JpegEncoder::new_with_quality(Cursor::new(&mut bytes), 75);
        encoder.encode_image(thumb)?;
        Ok(data_url("image/jpeg", &bytes))
    }
}

fn log_thumb_timing(
    path: &Path,
    decode: std::time::Duration,
    resize: std::time::Duration,
    encode: std::time::Duration,
) {
    static LOGGED: AtomicU32 = AtomicU32::new(0);
    let index = LOGGED.fetch_add(1, Ordering::Relaxed);
    if index >= TIMING_SAMPLES {
        return;
    }
    eprintln!(
        "squeasel thumb {} {} decode={:.1}ms resize={:.1}ms encode={:.1}ms",
        index + 1,
        path.display(),
        decode.as_secs_f64() * 1000.0,
        resize.as_secs_f64() * 1000.0,
        encode.as_secs_f64() * 1000.0
    );
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
    use image::metadata::Orientation;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn ingest_events_match_typescript_keys() {
        let scanned = IngestEvent::Scanned {
            files: vec![ScannedFile {
                id: "id".to_string(),
                path: "/tmp/photo-2.jpg".to_string(),
                name: "photo-2.jpg".to_string(),
                bytes: 12,
            }],
            skipped: 3,
        };
        let scanned_json = serde_json::to_value(&scanned).unwrap();
        assert_eq!(scanned_json["type"], "scanned");
        assert_eq!(scanned_json["skipped"], 3);
        assert_keys(&scanned_json, &["files", "skipped", "type"]);
        assert_keys(&scanned_json["files"][0], &["bytes", "id", "name", "path"]);

        let ready = IngestEvent::Ready {
            id: "id".to_string(),
            width: 3000,
            height: 4000,
            format: "jpeg".to_string(),
            thumbnail_url: "data:image/jpeg;base64,abc".to_string(),
        };
        let ready_json = serde_json::to_value(&ready).unwrap();
        assert_eq!(ready_json["type"], "ready");
        assert_eq!(ready_json["width"], 3000);
        assert_eq!(ready_json["height"], 4000);
        assert_eq!(ready_json["thumbnailUrl"], "data:image/jpeg;base64,abc");
        assert!(ready_json.get("thumbnail_url").is_none());
        assert_keys(
            &ready_json,
            &["format", "height", "id", "thumbnailUrl", "type", "width"],
        );

        let error = IngestEvent::Error {
            id: "id".to_string(),
        };
        let error_json = serde_json::to_value(&error).unwrap();
        assert_eq!(error_json["type"], "error");
        assert_eq!(error_json["id"], "id");
        assert_keys(&error_json, &["id", "type"]);
    }

    #[test]
    fn cancel_skips_unstarted_files_and_a_fresh_batch_does_not() {
        let batch = BatchCancel::new(u64::MAX);
        assert!(!batch.skips("photo-2.jpg"));

        batch
            .removed
            .lock()
            .unwrap()
            .insert("photo-2.jpg".to_string());
        assert!(batch.skips("photo-2.jpg"));
        assert!(!batch.skips("photo-10.jpg"));

        batch.cancelled.store(true, Ordering::Release);
        assert!(batch.skips("photo-10.jpg"));

        let fresh = BatchCancel::new(u64::MAX);
        assert!(!fresh.skips("photo-2.jpg"));
    }

    fn assert_keys(value: &serde_json::Value, expected: &[&str]) {
        let mut keys: Vec<&str> = value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        let mut expected = expected.to_vec();
        expected.sort_unstable();
        assert_eq!(keys, expected);
    }

    #[test]
    fn rotate90_swaps_width_and_height() {
        let mut image = DynamicImage::new_rgb8(8, 3);
        image.apply_orientation(Orientation::Rotate90);
        assert_eq!((image.width(), image.height()), (3, 8));
    }

    #[test]
    fn exif_orientation_is_applied_before_dimensions() {
        let path = scratch_dir().join("portrait.jpg");
        let mut wide = Vec::new();
        JpegEncoder::new_with_quality(Cursor::new(&mut wide), 80)
            .encode_image(&DynamicImage::new_rgb8(6, 2))
            .unwrap();
        // Orientation 6 is "rotate 90 clockwise", so a 6×2 buffer is displayed as 2×6.
        let bytes = inject_exif_orientation(&wide, 6);
        fs::write(&path, bytes).unwrap();

        let loaded = load_image(&path).expect("oriented jpeg should load");
        assert_eq!((loaded.width, loaded.height), (2, 6));
        assert_eq!(loaded.format, "jpeg");
        assert!(loaded.thumbnail_url.starts_with("data:image/jpeg;base64,"));
        let encoded = loaded.thumbnail_url.split_once(',').unwrap().1;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .unwrap();
        assert!(
            bytes.starts_with(&[0xFF, 0xD8, 0xFF]),
            "thumbnail bytes are a JPEG"
        );

        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn oriented_portrait_is_planned_upright() {
        let path = scratch_dir().join("portrait.jpg");
        let mut wide = Vec::new();
        JpegEncoder::new_with_quality(Cursor::new(&mut wide), 80)
            .encode_image(&DynamicImage::new_rgb8(6, 2))
            .unwrap();
        fs::write(&path, inject_exif_orientation(&wide, 6)).unwrap();

        let (image, format, _) = decode_oriented(&path).unwrap();
        assert_eq!(format, "jpeg");
        assert_eq!((image.width(), image.height()), (2, 6));
        let plan = crate::resize::plan_resize(
            image.width(),
            image.height(),
            Some(4),
            Some(4),
            crate::resize::FitMode::Fill,
            false,
            crate::resize::Anchor::Center,
        )
        .unwrap();
        assert_eq!((plan.output_width, plan.output_height), (4, 4));
        assert_eq!(plan.crop_width, 2);
        assert!(plan.crop_height < 6);

        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn scan_skips_hidden_folders_symlinks_and_unsupported_files() {
        let root = scratch_dir();
        fs::write(root.join("photo.jpg"), b"placeholder").unwrap();
        fs::write(root.join("notes.txt"), b"hello").unwrap();
        fs::write(root.join(".DS_Store"), b"junk").unwrap();

        let hidden = root.join(".hidden");
        fs::create_dir(&hidden).unwrap();
        fs::write(hidden.join("secret.jpg"), b"nope").unwrap();

        let elsewhere = scratch_dir();
        fs::write(elsewhere.join("linked.jpg"), b"nope").unwrap();
        std::os::unix::fs::symlink(&elsewhere, root.join("linked-folder")).unwrap();

        let (files, skipped) = scan_inputs(&[root.to_string_lossy().into_owned()], &HashSet::new());
        assert_eq!(files.len(), 1, "only the real photo should be listed");
        assert_eq!(files[0].name, "photo.jpg");
        assert_eq!(
            skipped, 1,
            "notes.txt is unsupported; dotfiles are not counted"
        );

        let (again, skipped_again) = scan_inputs(
            &[root.to_string_lossy().into_owned()],
            &HashSet::from([files[0].id.clone()]),
        );
        assert!(again.is_empty());
        assert_eq!(skipped_again, 1);

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&elsewhere);
    }

    fn scratch_dir() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("squeasel-{}-{}", std::process::id(), nanos));
        fs::create_dir_all(&path).unwrap();
        path
    }

    /// Insert a one-tag Exif APP1 segment after the JPEG start marker.
    fn inject_exif_orientation(jpeg: &[u8], orientation: u16) -> Vec<u8> {
        let mut exif = vec![
            0xFF, 0xE1, 0x00, 0x22, b'E', b'x', b'i', b'f', 0x00, 0x00, b'I', b'I', 0x2A, 0x00,
            0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00,
        ];
        exif.extend_from_slice(&orientation.to_le_bytes());
        exif.extend_from_slice(&[0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

        let mut out = Vec::with_capacity(jpeg.len() + exif.len());
        out.extend_from_slice(&jpeg[..2]);
        out.extend_from_slice(&exif);
        out.extend_from_slice(&jpeg[2..]);
        out
    }
}
