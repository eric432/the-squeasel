//! One batch at a time. Encodes share a small pool. Names are claimed one at a time.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use rayon::ThreadPoolBuilder;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

use crate::name;
use crate::preview::{self, ExportOutput, PreviewSettings};
use crate::recipe::{ConflictRule, FolderMode};

const PROGRESS_GAP: Duration = Duration::from_millis(250);

static RUNNING: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);

/// `min(cores - 1, 4)`, and at least 1. Separate from the thumbnail pool.
pub(crate) fn batch_threads() -> usize {
    let cores = std::thread::available_parallelism().map(|count| count.get()).unwrap_or(1);
    cores.saturating_sub(1).clamp(1, 4)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BatchFile {
    pub id: String,
    pub path: String,
    pub sequence: u32,
    pub settings: PreviewSettings,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BatchRequest {
    pub files: Vec<BatchFile>,
    pub output: BatchOutput,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BatchOutput {
    pub folder_mode: FolderMode,
    pub subfolder_name: String,
    pub chosen_folder: Option<String>,
    pub name_pattern: String,
    pub recipe_name: String,
    pub conflict: ConflictRule,
    pub retina2x: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BatchFileResult {
    pub id: String,
    pub sequence: u32,
    pub status: String,
    pub path: Option<String>,
    pub reason: Option<String>,
    pub bytes: Option<u64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub format: Option<String>,
    pub target_missed: bool,
    pub kept_native: bool,
    pub cropped_heavily: bool,
    pub profile_unread: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum BatchEvent {
    Progress { done: u32, total: u32, name: String },
    Finished {
        done: u32,
        total: u32,
        cancelled: bool,
        failed: u32,
        skipped: u32,
        written: u32,
        results: Vec<BatchFileResult>,
    },
}

#[tauri::command]
pub fn start_batch(request: BatchRequest, on_event: Channel<BatchEvent>) -> Result<(), String> {
    if request.files.is_empty() {
        return Err("Add an image before squeezing.".into());
    }
    name::check_pattern(&request.output.name_pattern)?;
    if RUNNING.swap(true, Ordering::AcqRel) {
        return Err("A batch is already running.".into());
    }
    CANCEL.store(false, Ordering::Release);
    std::thread::spawn(move || {
        struct RunningGuard;
        impl Drop for RunningGuard {
            fn drop(&mut self) {
                RUNNING.store(false, Ordering::Release);
            }
        }
        let _running = RunningGuard;
        let outcome = run_batch(&request, &CANCEL, &|event| {
            let _ = on_event.send(event);
        }, &|| {});
        let _ = on_event.send(outcome);
    });
    Ok(())
}

#[tauri::command]
pub fn cancel_batch() {
    CANCEL.store(true, Ordering::Release);
}

struct ProgressGate {
    last: Option<Instant>,
    pending: Option<BatchEvent>,
}

pub(crate) fn run_batch(
    request: &BatchRequest,
    cancel: &AtomicBool,
    emit: &(impl Fn(BatchEvent) + Sync),
    before_file: &(impl Fn() + Sync),
) -> BatchEvent {
    let total = request.files.len() as u32;
    let done = AtomicU32::new(0);
    let results: Mutex<Vec<Option<BatchFileResult>>> = Mutex::new(vec![None; request.files.len()]);
    let gate = Mutex::new(ProgressGate { last: None, pending: None });
    let output = &request.output;

    let work = |index: usize, file: &BatchFile| {
        if cancel.load(Ordering::Acquire) {
            return;
        }
        before_file();
        let name = Path::new(&file.path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("image")
            .to_string();
        send_progress(&gate, emit, done.load(Ordering::Acquire), total, name.clone());
        let export = ExportOutput {
            folder_mode: output.folder_mode,
            subfolder_name: output.subfolder_name.clone(),
            chosen_folder: output.chosen_folder.clone(),
            name_pattern: output.name_pattern.clone(),
            sequence: file.sequence,
            recipe_name: output.recipe_name.clone(),
            conflict: output.conflict,
            retina2x: output.retina2x,
            force_rename: false,
        };
        let result = match preview::export_fresh(Path::new(&file.path), &file.settings, &export) {
            Ok(written) if written.skipped => {
                file_result(file, "skipped", Some("Skipped (name exists)".into()), None, &written)
            }
            Ok(written) => file_result(file, "written", None, Some(written.bytes), &written),
            Err(reason) => BatchFileResult {
                id: file.id.clone(),
                sequence: file.sequence,
                status: "failed".into(),
                path: None,
                reason: Some(reason),
                bytes: None,
                width: None,
                height: None,
                format: None,
                target_missed: false,
                kept_native: false,
                cropped_heavily: false,
                profile_unread: false,
            },
        };
        if let Ok(mut slot) = results.lock() {
            slot[index] = Some(result);
        }
        let finished = done.fetch_add(1, Ordering::AcqRel) + 1;
        send_progress(&gate, emit, finished, total, name);
    };
    let work = &work;

    match ThreadPoolBuilder::new().num_threads(batch_threads()).build() {
        Ok(pool) => {
            pool.scope(|scope| {
                for (index, file) in request.files.iter().enumerate() {
                    scope.spawn(move |_| work(index, file));
                }
            });
        }
        Err(_) => {
            for (index, file) in request.files.iter().enumerate() {
                work(index, file);
            }
        }
    }

    flush_progress(&gate, emit);
    let results: Vec<BatchFileResult> = results
        .lock()
        .map(|slot| slot.iter().filter_map(|item| item.clone()).collect())
        .unwrap_or_default();
    let failed = results.iter().filter(|item| item.status == "failed").count() as u32;
    let skipped = results.iter().filter(|item| item.status == "skipped").count() as u32;
    let written = results.iter().filter(|item| item.status == "written").count() as u32;
    BatchEvent::Finished {
        done: done.load(Ordering::Acquire),
        total,
        cancelled: cancel.load(Ordering::Acquire),
        failed,
        skipped,
        written,
        results,
    }
}

fn send_progress(
    gate: &Mutex<ProgressGate>,
    emit: &impl Fn(BatchEvent),
    done: u32,
    total: u32,
    name: String,
) {
    let Ok(mut gate) = gate.lock() else {
        return;
    };
    let event = BatchEvent::Progress { done, total, name };
    let due = gate.last.is_none_or(|last| last.elapsed() >= PROGRESS_GAP);
    if due {
        gate.last = Some(Instant::now());
        gate.pending = None;
        drop(gate);
        emit(event);
    } else {
        gate.pending = Some(event);
    }
}

fn file_result(
    file: &BatchFile,
    status: &str,
    reason: Option<String>,
    bytes: Option<u64>,
    written: &preview::FreshFile,
) -> BatchFileResult {
    BatchFileResult {
        id: file.id.clone(),
        sequence: file.sequence,
        status: status.into(),
        path: Some(written.path.clone()),
        reason,
        bytes,
        width: Some(written.width),
        height: Some(written.height),
        format: Some(written.format.clone()),
        target_missed: written.target_missed,
        kept_native: written.kept_native,
        cropped_heavily: written.cropped_heavily,
        profile_unread: written.profile_unread,
    }
}

fn flush_progress(gate: &Mutex<ProgressGate>, emit: &impl Fn(BatchEvent)) {
    let Ok(mut gate) = gate.lock() else {
        return;
    };
    if let Some(event) = gate.pending.take() {
        drop(gate);
        emit(event);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::AtomicUsize;

    use image::DynamicImage;

    use crate::preview::PreviewSettings;
    use crate::recipe::PngColors;
    use crate::resize::{Anchor, FitMode, OutputFormat};

    fn settings() -> PreviewSettings {
        PreviewSettings {
            width: Some(4),
            height: Some(2),
            mode: FitMode::Fill,
            never_upscale: true,
            pad_color: "#F3F1EC".into(),
            transparent_pad: false,
            format: OutputFormat::Png,
            quality: 78,
            anchor: Anchor::Center,
            crop: None,
            include_source: false,
            png_colors: PngColors::Full,
            png_dither: true,
            target_max_kb: None,
            strip_metadata: true,
            keep_copyright: false,
            quality_floor: crate::encode::QUALITY_FLOOR,
        }
    }

    fn output(pattern: &str) -> BatchOutput {
        BatchOutput {
            folder_mode: FolderMode::Subfolder,
            subfolder_name: "squeasel".into(),
            chosen_folder: None,
            name_pattern: pattern.into(),
            recipe_name: "Blog hero".into(),
            conflict: ConflictRule::Rename,
            retina2x: false,
        }
    }

    fn file(root: &Path, name: &str, sequence: u32) -> BatchFile {
        let path = root.join(name);
        DynamicImage::new_rgb8(8, 4)
            .save_with_format(&path, image::ImageFormat::Png)
            .unwrap();
        BatchFile {
            id: name.into(),
            path: path.to_string_lossy().into_owned(),
            sequence,
            settings: settings(),
        }
    }

    fn temp_root(label: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "squeasel-batch-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn the_pool_stays_between_one_and_four() {
        let threads = batch_threads();
        assert!((1..=4).contains(&threads));
        let cores = std::thread::available_parallelism().map(|count| count.get()).unwrap_or(1);
        if cores > 1 {
            assert!(threads < cores);
        }
    }

    #[test]
    fn a_batch_writes_each_file_and_a_bad_file_does_not_stop_it() {
        let root = temp_root("write");
        let request = BatchRequest {
            files: vec![
                file(&root, "a.png", 1),
                BatchFile {
                    id: "missing".into(),
                    path: root.join("missing.png").to_string_lossy().into_owned(),
                    sequence: 2,
                    settings: settings(),
                },
                file(&root, "b.png", 3),
            ],
            output: output("{name}-{nn}"),
        };
        let cancel = AtomicBool::new(false);
        let events = Mutex::new(Vec::new());
        let finished = run_batch(&request, &cancel, &|event| events.lock().unwrap().push(event), &|| {});
        match finished {
            BatchEvent::Finished { written, failed, skipped, done, total, cancelled, results } => {
                assert_eq!((written, failed, skipped, done, total, cancelled), (2, 1, 0, 3, 3, false));
                assert_eq!(results[0].status, "written");
                assert_eq!(results[0].sequence, 1);
                assert_eq!(results[0].format.as_deref(), Some("png"));
                assert!(!results[0].cropped_heavily);
                assert!(!results[0].kept_native);
                assert!(results[0].path.as_deref().unwrap().ends_with("a-01.png"));
                assert_eq!(results[1].status, "failed");
                assert!(results[1].reason.as_deref().unwrap().contains("Could not read"));
                assert!(results[2].path.as_deref().unwrap().ends_with("b-03.png"));
            }
            BatchEvent::Progress { .. } => panic!("the run should finish"),
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn identical_names_are_numbered_and_skip_stays_skip() {
        let root = temp_root("names");
        let mut request = BatchRequest {
            files: vec![file(&root, "a.png", 1), file(&root, "b.png", 2)],
            output: output("shared"),
        };
        let cancel = AtomicBool::new(false);
        let finished = run_batch(&request, &cancel, &|_| {}, &|| {});
        let BatchEvent::Finished { results, .. } = finished else { panic!("finish") };
        let names: Vec<_> = results.iter().map(|item| item.path.as_deref().unwrap().to_string()).collect();
        assert!(names.iter().any(|name| name.ends_with("shared.png")));
        assert!(names.iter().any(|name| name.ends_with("shared-1.png")));

        request.output.conflict = ConflictRule::Skip;
        let finished = run_batch(&request, &cancel, &|_| {}, &|| {});
        let BatchEvent::Finished { written, skipped, .. } = finished else { panic!("finish") };
        assert_eq!((written, skipped), (0, 2));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cancel_finishes_what_started_and_starts_no_more() {
        let root = temp_root("cancel");
        let files = (0..6).map(|index| file(&root, &format!("{index}.png"), index + 1)).collect();
        let request = BatchRequest { files, output: output("{name}") };
        let cancel = AtomicBool::new(false);
        let started = AtomicUsize::new(0);
        let finished = run_batch(&request, &cancel, &|_| {}, &|| {
            if started.fetch_add(1, Ordering::AcqRel) == 0 {
                cancel.store(true, Ordering::Release);
            }
            std::thread::sleep(Duration::from_millis(40));
        });
        let BatchEvent::Finished { done, total, cancelled, .. } = finished else { panic!("finish") };
        assert!(cancelled);
        assert!(done >= 1 && done < total);
        assert!(done as usize <= batch_threads().max(started.load(Ordering::Acquire)));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn progress_payloads_use_camel_case() {
        let event = BatchEvent::Progress { done: 2, total: 5, name: "a.png".into() };
        let value = serde_json::to_value(&event).unwrap();
        assert_eq!(value["type"], "progress");
        assert_eq!(value["done"], 2);
        assert!(value.get("total").is_some());
        let finished = BatchEvent::Finished {
            done: 1,
            total: 1,
            cancelled: false,
            failed: 0,
            skipped: 0,
            written: 1,
            results: vec![],
        };
        let value = serde_json::to_value(&finished).unwrap();
        assert_eq!(value["type"], "finished");
        assert!(value.get("results").is_some());
        assert!(value.get("cancelled").is_some());
        let row = BatchFileResult {
            id: "a".into(),
            sequence: 1,
            status: "written".into(),
            path: Some("a.png".into()),
            reason: None,
            bytes: Some(10),
            width: Some(4),
            height: Some(2),
            format: Some("png".into()),
            target_missed: false,
            kept_native: true,
            cropped_heavily: false,
            profile_unread: false,
        };
        let row = serde_json::to_value(&row).unwrap();
        assert_eq!(row["targetMissed"], false);
        assert_eq!(row["keptNative"], true);
        assert_eq!(row["croppedHeavily"], false);
        assert_eq!(row["profileUnread"], false);
        assert_eq!(row["format"], "png");
    }

    #[test]
    fn a_gray_profile_is_written_and_a_broken_profile_is_not_a_failure() {
        let root = temp_root("gray");
        let gamma = root.join("gamma.jpg");
        let broken = root.join("broken.jpg");
        fs::write(&gamma, crate::color::gray_jpeg_bytes(128, Some(crate::color::gray_gamma_profile(1.0)))).unwrap();
        fs::write(
            &broken,
            crate::color::gray_jpeg_bytes(90, Some(crate::color::gray_profile_without_curve())),
        )
        .unwrap();
        let request = BatchRequest {
            files: vec![
                BatchFile {
                    id: "gamma".into(),
                    path: gamma.to_string_lossy().into_owned(),
                    sequence: 1,
                    settings: settings(),
                },
                BatchFile {
                    id: "broken".into(),
                    path: broken.to_string_lossy().into_owned(),
                    sequence: 2,
                    settings: settings(),
                },
            ],
            output: output("{name}"),
        };
        let finished = run_batch(&request, &AtomicBool::new(false), &|_| {}, &|| {});
        let BatchEvent::Finished { written, failed, results, .. } = finished else { panic!("finish") };
        assert_eq!((written, failed), (2, 0));
        let gamma_row = results.iter().find(|row| row.id == "gamma").unwrap();
        let broken_row = results.iter().find(|row| row.id == "broken").unwrap();
        assert_eq!(gamma_row.status, "written");
        assert!(!gamma_row.profile_unread);
        assert_eq!(broken_row.status, "written");
        assert!(broken_row.profile_unread);
        let _ = fs::remove_dir_all(root);
    }
}
