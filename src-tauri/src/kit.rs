//! Runs one batch the same way the app does, for the kit checks.
//! The app never calls this. Output goes only where the caller asks.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use crate::batch::{self, BatchEvent, BatchFile, BatchOutput, BatchRequest};
use crate::encode;
use crate::preview::{self, ExportOutput, PreviewSettings};
use crate::recipe::{ConflictRule, FolderMode, PngColors};
use crate::resize::{Anchor, FitMode, OutputFormat};

pub struct SqueezeOptions {
    pub output_dir: PathBuf,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub pattern: String,
    pub retina: bool,
    pub strip_metadata: bool,
    pub keep_copyright: bool,
}

#[derive(Debug)]
pub struct Squeezed {
    pub name: String,
    pub source: PathBuf,
    pub status: String,
    pub path: Option<PathBuf>,
    pub reason: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub format: Option<String>,
    pub bytes: Option<u64>,
    pub kept_native: bool,
}

/// Blog hero, written into `output_dir` and nowhere else.
pub fn squeeze(sources: &[PathBuf], options: &SqueezeOptions) -> Result<Vec<Squeezed>, String> {
    if sources.is_empty() {
        return Err("Add an image before squeezing.".into());
    }
    let settings = settings_of(options);
    let request = BatchRequest {
        files: sources
            .iter()
            .enumerate()
            .map(|(index, source)| BatchFile {
                id: source
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("image")
                    .to_string(),
                path: source.to_string_lossy().into_owned(),
                sequence: (index as u32).saturating_add(1),
                settings: settings.clone(),
            })
            .collect(),
        output: BatchOutput {
            folder_mode: FolderMode::Chosen,
            subfolder_name: String::new(),
            chosen_folder: Some(options.output_dir.to_string_lossy().into_owned()),
            name_pattern: options.pattern.clone(),
            recipe_name: "Blog hero".into(),
            conflict: ConflictRule::Rename,
            retina2x: options.retina,
        },
    };
    let cancel = AtomicBool::new(false);
    let finished = batch::run_batch(&request, &cancel, &|_| {}, &|| {});
    let BatchEvent::Finished { results, .. } = finished else {
        return Err("The batch did not finish.".into());
    };
    Ok(sources
        .iter()
        .zip(results)
        .map(|(source, result)| Squeezed {
            name: result.id,
            source: source.clone(),
            status: result.status,
            path: result.path.map(PathBuf::from),
            reason: result.reason,
            width: result.width,
            height: result.height,
            format: result.format,
            bytes: result.bytes,
            kept_native: result.kept_native,
        })
        .collect())
}

pub fn blog_hero(output_dir: &Path) -> SqueezeOptions {
    SqueezeOptions {
        output_dir: output_dir.to_path_buf(),
        width: Some(1920),
        height: Some(800),
        pattern: "{name}-{width}x{height}".into(),
        retina: false,
        strip_metadata: true,
        keep_copyright: false,
    }
}

#[derive(Debug)]
pub struct Previewed {
    pub width: u32,
    pub height: u32,
    pub profile_unread: bool,
    pub rgb: [u8; 3],
}

/// One preview, using the same decode and resize as the single-image screen.
pub fn preview(source: &Path, options: &SqueezeOptions) -> Result<Previewed, String> {
    let checked = preview::preview_file(source, &settings_of(options))?;
    Ok(Previewed {
        width: checked.width,
        height: checked.height,
        profile_unread: checked.profile_unread,
        rgb: checked.rgb,
    })
}

/// One export, using the same writer as Export. This does not go through the batch pool.
pub fn export_one(source: &Path, options: &SqueezeOptions) -> Result<Squeezed, String> {
    let fresh = preview::export_fresh(source, &settings_of(options), &export_output(options, 1))?;
    Ok(Squeezed {
        name: source
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("image")
            .to_string(),
        source: source.to_path_buf(),
        status: "written".into(),
        path: Some(PathBuf::from(fresh.path)),
        reason: None,
        width: Some(fresh.width),
        height: Some(fresh.height),
        format: Some(fresh.format),
        bytes: Some(fresh.bytes),
        kept_native: fresh.kept_native,
    })
}

/// Names a drop would keep, and how many files it would skip as unsupported.
pub fn scan(dir: &Path) -> (Vec<String>, u32) {
    let (files, skipped) = crate::ingest::scan_inputs(
        &[dir.to_string_lossy().into_owned()],
        &HashSet::new(),
    );
    let mut names: Vec<String> = files.into_iter().map(|file| file.name).collect();
    names.sort();
    (names, skipped)
}

fn settings_of(options: &SqueezeOptions) -> PreviewSettings {
    PreviewSettings {
        width: options.width,
        height: options.height,
        mode: FitMode::Fill,
        never_upscale: true,
        pad_color: "#F3F1EC".into(),
        transparent_pad: false,
        format: OutputFormat::Webp,
        quality: 78,
        anchor: Anchor::Center,
        crop: None,
        include_source: false,
        png_colors: PngColors::Full,
        png_dither: true,
        target_max_kb: None,
        strip_metadata: options.strip_metadata,
        keep_copyright: options.keep_copyright,
        quality_floor: encode::QUALITY_FLOOR,
    }
}

fn export_output(options: &SqueezeOptions, sequence: u32) -> ExportOutput {
    ExportOutput {
        folder_mode: FolderMode::Chosen,
        subfolder_name: String::new(),
        chosen_folder: Some(options.output_dir.to_string_lossy().into_owned()),
        name_pattern: options.pattern.clone(),
        sequence,
        recipe_name: "Blog hero".into(),
        conflict: ConflictRule::Rename,
        retina2x: options.retina,
        force_rename: false,
    }
}
