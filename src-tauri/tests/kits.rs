//! The Desktop kits, encoded the same way a Squeeze does.
//! Ignored by `cargo test --lib`. Run them with:
//! CARGO_TARGET_DIR=/tmp/squeasel-kits-target cargo test --manifest-path src-tauri/Cargo.toml --test kits -- --ignored --test-threads=1
//!
//! The unusual-file folder is a sibling of the counted kits, so those stay at 7, 10, and 200.
//! Build it with `python3 scripts/make-edge-cases.py`.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use little_exif::exif_tag::ExifTag;
use little_exif::filetype::FileExtension;
use little_exif::ifd::ExifTagGroup;
use little_exif::metadata::Metadata;
use squeasel_lib::kit::{self, Previewed, Squeezed};

const PHASE1_STRESS: &str = "/Users/ericbaldoni/Desktop/squeasel-phase1-test-kit/squeasel-stress-test/stress-200";
const PHASE1_MIXED: &str = "/Users/ericbaldoni/Desktop/squeasel-phase1-test-kit/squeasel-test-images";
const PHASE2: &str = "/Users/ericbaldoni/Desktop/squeasel-phase2-test-images";
const PHASE4: &str = "/Users/ericbaldoni/Desktop/squeasel-phase4-test-kit/squeasel-phase4-test-images";
const EDGE: &str = "/Users/ericbaldoni/Desktop/squeasel-phase1-test-kit/squeasel-edge-cases";

/// Blog hero is 1920×800, Fill, never upscale. A frame the photo cannot cover falls back to Fit.
fn expected_frame(name: &str) -> (u32, u32) {
    match name {
        "01-tiny-300x200.jpg" => (300, 200),
        "02-wide-6000x800.jpg" => (1920, 800),
        "03-tall-800x6000.jpg" => (107, 800),
        "04-large-6000x4000.jpg" | "04-photo-large-6000x4000.jpg" => (1920, 800),
        "05-logo-soft-alpha-1000x1000.png" | "06-logo-flat-transparent-1000x1000.png" => (800, 800),
        "06-flat-graphic-2000x1000.png" | "08-illustration-gradient-2000x1000.png" => (1920, 800),
        "07-portrait-EXIF-rotated.jpg" => (1920, 800),
        "01-photo-landscape-3000x2000.jpg" => (1920, 800),
        "02-photo-detailed-2400x1600.jpg" | "09-photo-display-p3-2400x1600.jpg" | "10-photo-exif-gps-copyright-2400x1600.jpg" => {
            (1920, 800)
        }
        "03-photo-soft-portrait-1600x2000.jpg" => (640, 800),
        "05-screenshot-ui-1800x1100.png" => (1309, 800),
        "07-cutout-soft-shadow-1200x900.png" => (1067, 800),
        other => panic!("no expected frame for {other}"),
    }
}

fn kit_dir(path: &str) -> Option<PathBuf> {
    let path = PathBuf::from(path);
    if path.is_dir() {
        Some(path)
    } else {
        eprintln!("skipped: {path:?} is not on this machine");
        None
    }
}

fn images_in(dir: &Path) -> Vec<PathBuf> {
    let mut files = fs::read_dir(dir)
        .unwrap_or_else(|err| panic!("read {dir:?}: {err}"))
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            matches!(
                path.extension().and_then(|ext| ext.to_str()).map(|ext| ext.to_ascii_lowercase()).as_deref(),
                Some("jpg" | "jpeg" | "png" | "webp" | "gif" | "tif" | "tiff")
            )
        })
        .collect::<Vec<_>>();
    files.sort();
    files
}

fn temp_dir(label: &str) -> PathBuf {
    let nanos = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_nanos();
    let path = std::env::temp_dir().join(format!("squeasel-kit-{label}-{}-{nanos}", std::process::id()));
    fs::create_dir_all(&path).unwrap();
    path
}

fn stamp(dir: &Path) -> Vec<(PathBuf, SystemTime, u64)> {
    let mut found = Vec::new();
    let mut pending = vec![dir.to_path_buf()];
    while let Some(current) = pending.pop() {
        let entries = fs::read_dir(&current).unwrap_or_else(|err| panic!("read {current:?}: {err}"));
        for entry in entries.filter_map(|entry| entry.ok()) {
            let path = entry.path();
            if path.file_name().and_then(|name| name.to_str()) == Some(".DS_Store") {
                continue;
            }
            let meta = entry.metadata().unwrap_or_else(|err| panic!("stat {path:?}: {err}"));
            if meta.is_dir() {
                pending.push(path);
            } else {
                found.push((path, meta.modified().unwrap(), meta.len()));
            }
        }
    }
    found.sort();
    found
}

fn assert_untouched(before: &[(PathBuf, SystemTime, u64)], after: &[(PathBuf, SystemTime, u64)]) {
    assert_eq!(before, after, "the kit folder changed");
}

fn assert_webp(item: &Squeezed) {
    assert_eq!(item.status, "written", "{} failed: {:?}", item.name, item.reason);
    assert_eq!(item.format.as_deref(), Some("webp"), "{}", item.name);
    let path = item.path.as_ref().unwrap_or_else(|| panic!("{} has no file", item.name));
    assert_eq!(path.extension().and_then(|ext| ext.to_str()), Some("webp"), "{path:?}");
    let (width, height) = expected_frame(&item.name);
    assert_eq!((item.width, item.height), (Some(width), Some(height)), "{}", item.name);
    let opened = image::open(path).unwrap_or_else(|err| panic!("open {path:?}: {err}"));
    assert_eq!((opened.width(), opened.height()), (width, height), "{}", item.name);
    let source_dir = item.source.parent().unwrap();
    assert!(!path.starts_with(source_dir), "{path:?} was written beside the original");
}

fn tag_text(metadata: &Metadata, sample: ExifTag) -> Option<String> {
    let tag = metadata.get_tag(&sample).next()?;
    let bytes = tag.value_as_u8_vec(&metadata.get_endian());
    let text = String::from_utf8_lossy(&bytes);
    let trimmed = text.trim_end_matches('\0').trim();
    if trimmed.is_empty() { None } else { Some(trimmed.to_string()) }
}

#[test]
#[ignore]
fn phase2_matches_the_blog_hero_frame_and_a_second_pass_renames() {
    let Some(dir) = kit_dir(PHASE2) else { return };
    let sources = images_in(&dir);
    assert_eq!(sources.len(), 7, "the phase 2 kit should have 7 images");
    let before = stamp(&dir);
    let output = temp_dir("phase2");
    let written = kit::squeeze(&sources, &kit::blog_hero(&output)).unwrap();
    for item in &written {
        assert_webp(item);
        assert!(item.path.as_ref().unwrap().starts_with(&output));
    }
    assert!(written.iter().any(|item| item.name == "01-tiny-300x200.jpg" && item.kept_native));
    assert!(written.iter().any(|item| item.name == "03-tall-800x6000.jpg" && !item.kept_native));

    let tiny = written.iter().find(|item| item.name == "01-tiny-300x200.jpg").unwrap();
    let first = tiny.path.clone().unwrap();
    let first_bytes = fs::read(&first).unwrap();
    let again = kit::squeeze(std::slice::from_ref(&tiny.source), &kit::blog_hero(&output)).unwrap();
    let renamed = again[0].path.clone().unwrap();
    assert!(renamed.ends_with("01-tiny-300x200-300x200-1.webp"), "{renamed:?}");
    assert_eq!(fs::read(&first).unwrap(), first_bytes, "the first file was overwritten");
    assert_untouched(&before, &stamp(&dir));
    let _ = fs::remove_dir_all(output);
}

#[test]
#[ignore]
fn phase4_matches_the_frame_strips_gps_and_keeps_copyright() {
    let Some(dir) = kit_dir(PHASE4) else { return };
    let sources = images_in(&dir);
    assert_eq!(sources.len(), 10, "the phase 4 kit should have 10 images");
    let before = stamp(&dir);
    let output = temp_dir("phase4");
    let written = kit::squeeze(&sources, &kit::blog_hero(&output)).unwrap();
    for item in &written {
        assert_webp(item);
        assert!(item.path.as_ref().unwrap().starts_with(&output));
    }

    let photo = sources.iter().find(|path| path.ends_with("10-photo-exif-gps-copyright-2400x1600.jpg")).unwrap();
    let stripped = written.iter().find(|item| item.source == *photo).unwrap();
    let stripped_bytes = fs::read(stripped.path.as_ref().unwrap()).unwrap();
    assert!(!stripped_bytes.windows(7).any(|window| window == b"TestCam"));
    assert!(!stripped_bytes.windows(11).any(|window| window == b"Test Artist"));
    assert!(!stripped_bytes.windows(22).any(|window| window == b"(c) 2026 Bitclone Test"));

    let mut keep = kit::blog_hero(&output);
    keep.keep_copyright = true;
    let kept = kit::squeeze(std::slice::from_ref(photo), &keep).unwrap();
    assert_eq!(kept[0].status, "written");
    let kept_path = kept[0].path.clone().unwrap();
    assert!(kept_path.ends_with("10-photo-exif-gps-copyright-2400x1600-1920x800-1.webp"), "{kept_path:?}");
    let kept_bytes = fs::read(&kept_path).unwrap();
    assert!(!kept_bytes.windows(7).any(|window| window == b"TestCam"));
    let metadata = Metadata::new_from_vec(&kept_bytes, FileExtension::WEBP).expect("copyright webp should open");
    assert!(metadata.get_tag_by_hex(0x0002, Some(ExifTagGroup::GPS)).next().is_none());
    assert!(metadata.get_tag_by_hex(0x8825, None).next().is_none());
    assert_eq!(tag_text(&metadata, ExifTag::Copyright(String::new())).as_deref(), Some("(c) 2026 Bitclone Test"));
    assert_eq!(tag_text(&metadata, ExifTag::Artist(String::new())).as_deref(), Some("Test Artist"));
    assert_untouched(&before, &stamp(&dir));
    let _ = fs::remove_dir_all(output);
}

#[test]
#[ignore]
fn retina_is_written_only_when_the_source_can_cover_it() {
    let Some(phase2) = kit_dir(PHASE2) else { return };
    let Some(phase4) = kit_dir(PHASE4) else { return };
    let tiny = phase2.join("01-tiny-300x200.jpg");
    let large = phase2.join("04-large-6000x4000.jpg");
    let short = phase4.join("01-photo-landscape-3000x2000.jpg");
    let before = [stamp(&phase2), stamp(&phase4)].concat();
    let output = temp_dir("retina");
    let mut options = kit::blog_hero(&output);
    options.retina = true;
    let written = kit::squeeze(&[tiny, large.clone(), short], &options).unwrap();
    for item in &written {
        assert_webp(item);
    }
    let doubles: Vec<_> = fs::read_dir(&output)
        .unwrap()
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.file_name().and_then(|name| name.to_str()).unwrap_or("").contains("@2x"))
        .collect();
    assert_eq!(doubles.len(), 1, "{doubles:?}");
    let doubled = image::open(&doubles[0]).unwrap();
    assert_eq!((doubled.width(), doubled.height()), (3840, 1600));
    assert!(doubles[0].ends_with("04-large-6000x4000-1920x800@2x.webp"), "{:?}", doubles[0]);
    let after = [stamp(&phase2), stamp(&phase4)].concat();
    assert_untouched(&before, &after);
    let _ = fs::remove_dir_all(output);
}

#[test]
#[ignore]
fn a_corrupt_file_is_reported_and_the_rest_are_written() {
    let Some(dir) = kit_dir(PHASE1_MIXED) else { return };
    let good_gif = dir.join("07-static.gif");
    let good_png = dir.join("04-logo-transparent.png");
    let corrupt = dir.join("corrupt-photo.jpg");
    assert!(corrupt.is_file(), "the corrupt JPEG is part of the phase 1 mixed folder");
    let before = stamp(&dir);
    let output = temp_dir("corrupt");
    let written = kit::squeeze(&[good_gif, corrupt, good_png], &kit::blog_hero(&output)).unwrap();
    assert_eq!(written[0].status, "written", "{:?}", written[0].reason);
    assert_eq!(written[2].status, "written", "{:?}", written[2].reason);
    assert_eq!(written[1].status, "failed");
    assert_eq!(written[1].path, None);
    let reason = written[1].reason.as_deref().unwrap_or("");
    assert!(reason.contains("Could not read"), "{reason}");
    assert_eq!(written[0].format.as_deref(), Some("webp"));
    assert_eq!(written[2].format.as_deref(), Some("webp"));
    assert_untouched(&before, &stamp(&dir));
    let _ = fs::remove_dir_all(output);
}

#[test]
#[ignore]
fn stress_folder_writes_two_hundred_files_and_leaves_the_originals() {
    let Some(dir) = kit_dir(PHASE1_STRESS) else { return };
    let sources = images_in(&dir);
    assert_eq!(sources.len(), 200);
    let before = stamp(&dir);
    let output = temp_dir("stress");
    let written = kit::squeeze(&sources, &kit::blog_hero(&output)).unwrap();
    assert_eq!(written.len(), 200);
    let mut names = Vec::new();
    for item in &written {
        assert_eq!(item.status, "written", "{}: {:?}", item.name, item.reason);
        assert_eq!((item.width, item.height, item.format.as_deref()), (Some(1920), Some(800), Some("webp")));
        let path = item.path.clone().unwrap();
        assert!(path.starts_with(&output));
        let opened = image::open(&path).unwrap_or_else(|err| panic!("open {path:?}: {err}"));
        assert_eq!((opened.width(), opened.height()), (1920, 800), "{}", item.name);
        names.push(path);
    }
    names.sort();
    names.dedup();
    assert_eq!(names.len(), 200, "two files took the same name");
    let on_disk = fs::read_dir(&output).unwrap().count();
    assert_eq!(on_disk, 200);
    assert_untouched(&before, &stamp(&dir));
    let _ = fs::remove_dir_all(output);
}

/// Same stem the edge-case script writes. 220 bytes plus "-8x8" is past the 200-byte name limit.
fn long_jpeg_name() -> String {
    format!("{}.jpg", "n".repeat(220))
}

fn max_delta(left: [u8; 3], right: [u8; 3]) -> i32 {
    left.iter()
        .zip(right)
        .map(|(a, b)| (i32::from(*a) - i32::from(b)).abs())
        .max()
        .unwrap()
}

fn assert_near(label: &str, got: [u8; 3], expected: [u8; 3], tol: i32) {
    let delta = max_delta(got, expected);
    assert!(delta <= tol, "{label}: {got:?} vs {expected:?}");
}

fn raw_center(path: &Path) -> [u8; 3] {
    let image = image::open(path).unwrap_or_else(|err| panic!("open {path:?}: {err}"));
    let rgb = image.to_rgb8();
    let pixel = rgb.get_pixel(rgb.width() / 2, rgb.height() / 2);
    [pixel[0], pixel[1], pixel[2]]
}

fn set_readonly(path: &Path, readonly: bool) {
    let mut perms = fs::metadata(path).unwrap().permissions();
    perms.set_readonly(readonly);
    fs::set_permissions(path, perms).unwrap();
}

fn check_file(dir: &Path, name: &str, rgb: [u8; 3], tol: i32, width: u32, height: u32, fragment: Option<&str>) {
    let source = dir.join(name);
    let output = temp_dir("edge-one");
    let options = kit::blog_hero(&output);
    let preview = kit::preview(&source, &options).unwrap_or_else(|err| panic!("{name} preview: {err}"));
    assert_eq!((preview.width, preview.height), (width, height), "{name}");
    assert!(!preview.profile_unread, "{name} lost its color profile");
    assert_near(&format!("{name} preview"), preview.rgb, rgb, tol);
    let exported = kit::export_one(&source, &options).unwrap_or_else(|err| panic!("{name} export: {err}"));
    assert_eq!(exported.status, "written", "{name}");
    assert_eq!((exported.width, exported.height), (Some(width), Some(height)), "{name}");
    let path = exported.path.expect("export path");
    assert!(path.starts_with(&output), "{path:?}");
    let opened = image::open(&path).unwrap_or_else(|err| panic!("open {path:?}: {err}"));
    assert_eq!((opened.width(), opened.height()), (width, height), "{name}");
    assert_near(&format!("{name} export"), raw_center(&path), preview.rgb, 12);
    if let Some(fragment) = fragment {
        let file_name = path.file_name().and_then(|item| item.to_str()).unwrap_or("");
        assert!(file_name.contains(fragment), "{file_name} dropped {fragment}");
    }
    if name.len() > 200 {
        let stem = path.file_stem().and_then(|item| item.to_str()).unwrap_or("");
        assert_eq!(stem.len(), 200, "{name} stem is {} bytes", stem.len());
    }
    let _ = fs::remove_dir_all(output);
}

fn check_profiled(dir: &Path, name: &str) -> Previewed {
    let source = dir.join(name);
    let output = temp_dir("edge-profile");
    let options = kit::blog_hero(&output);
    let raw = raw_center(&source);
    assert!(raw[0] > raw[1] && raw[1] > raw[2], "{name} fixture is not warm: {raw:?}");
    let preview = kit::preview(&source, &options).unwrap_or_else(|err| panic!("{name} preview: {err}"));
    assert!(!preview.profile_unread, "{name}");
    assert_eq!((preview.width, preview.height), (8, 8), "{name}");
    assert!(max_delta(preview.rgb, raw) >= 8, "{name} ignored its profile: {:?} vs {raw:?}", preview.rgb);
    assert!(preview.rgb[0] > preview.rgb[1] && preview.rgb[1] > preview.rgb[2], "{name} is no longer warm: {:?}", preview.rgb);
    let exported = kit::export_one(&source, &options).unwrap_or_else(|err| panic!("{name} export: {err}"));
    let path = exported.path.expect("export path");
    let written = raw_center(&path);
    assert!(
        max_delta(written, preview.rgb) < max_delta(written, raw),
        "{name} export {written:?} did not follow the converted color {:?}",
        preview.rgb
    );
    let _ = fs::remove_dir_all(output);
    preview
}

#[test]
#[ignore]
fn edge_cases_preview_export_and_batch() {
    let Some(dir) = kit_dir(EDGE) else { return };
    let long_name = long_jpeg_name();
    let before = stamp(&dir);
    let (names, skipped) = kit::scan(&dir);
    assert!(skipped >= 1, "the animated GIF should be skipped, skipped {skipped}");
    assert!(names.iter().any(|name| name.eq_ignore_ascii_case("photo.heic")), "scan dropped the HEIC");
    assert!(names.iter().any(|name| name == "credit-p3.heic"), "scan dropped the profiled HEIC");
    assert!(!names.iter().any(|name| name == "animation.gif"));
    for name in [
        "display-p3.jpg",
        "adobe-rgb.jpg",
        "cmyk.jpg",
        "depth-16.png",
        "depth-16.tif",
        "indexed.png",
        "gray.png",
        "panorama-12000x3000.jpg",
        "cafe photo.jpg",
        "café.jpg",
        "sunset 🌅.jpg",
    ] {
        assert!(names.iter().any(|found| found == name), "scan dropped {name}");
    }
    assert!(names.iter().any(|found| found == &long_name), "scan dropped the long name");

    let p3 = check_profiled(&dir, "display-p3.jpg");
    let adobe = check_profiled(&dir, "adobe-rgb.jpg");
    assert!(
        max_delta(p3.rgb, adobe.rgb) >= 8,
        "Display P3 {:?} and Adobe RGB {:?} converted to the same color",
        p3.rgb,
        adobe.rgb
    );

    let blue = [40, 120, 200];
    check_file(&dir, "cmyk.jpg", [255, 0, 0], 8, 8, 8, None);
    check_file(&dir, "depth-16.png", [128, 128, 128], 1, 8, 8, None);
    check_file(&dir, "depth-16.tif", [128, 128, 128], 1, 8, 8, None);
    check_file(&dir, "indexed.png", [20, 140, 220], 0, 8, 8, None);
    check_file(&dir, "gray.png", [140, 140, 140], 0, 8, 8, None);
    check_file(&dir, "cafe photo.jpg", blue, 2, 8, 8, Some("cafe photo"));
    check_file(&dir, "café.jpg", blue, 2, 8, 8, Some("café"));
    check_file(&dir, "sunset 🌅.jpg", blue, 2, 8, 8, Some("🌅"));
    check_file(&dir, &long_name, blue, 2, 8, 8, None);
    check_file(&dir, "panorama-12000x3000.jpg", blue, 2, 1920, 800, None);
    check_file(&dir, "photo.heic", blue, 12, 8, 8, Some("photo-"));

    let gif = dir.join("animation.gif");
    let unsupported_dir = temp_dir("edge-unsupported");
    let options = kit::blog_hero(&unsupported_dir);
    let gif_err = kit::preview(&gif, &options).expect_err("an animated GIF should fail");
    assert!(gif_err.contains("Animated GIF") && gif_err.to_ascii_lowercase().contains("unsupported"), "{gif_err}");

    let credit = dir.join("credit-p3.heic");
    let credit_preview = kit::preview(&credit, &options).unwrap_or_else(|err| panic!("HEIC preview: {err}"));
    // Orientation 6 turns the stored 32×16 landscape into a 16×32 portrait.
    assert_eq!((credit_preview.width, credit_preview.height), (16, 32), "HEIC rotation");
    assert!(!credit_preview.profile_unread, "HEIC profile was not read");
    assert!(
        max_delta(credit_preview.rgb, p3.rgb) <= 12,
        "HEIC Display P3 {:?} did not match the JPEG {:?}",
        credit_preview.rgb,
        p3.rgb
    );
    let colorsync = colorsync_center(&credit);
    assert_near("HEIC vs Preview.app", credit_preview.rgb, colorsync, 12);

    let credit_out = temp_dir("edge-heic");
    let stripped = kit::export_one(&credit, &kit::blog_hero(&credit_out)).unwrap();
    let stripped_path = stripped.path.expect("stripped heic export");
    assert!(stripped_path.file_name().unwrap().to_str().unwrap().starts_with("credit-p3-"));
    assert!(!stripped_path.file_name().unwrap().to_str().unwrap().contains("squeasel-heic"));
    assert_eq!((stripped.width, stripped.height), (Some(16), Some(32)));
    let stripped_bytes = fs::read(&stripped_path).unwrap();
    assert!(!stripped_bytes.windows(22).any(|window| window == b"(c) 2026 Bitclone Test"));

    let mut keep = kit::blog_hero(&credit_out);
    keep.keep_copyright = true;
    let kept = kit::export_one(&credit, &keep).unwrap();
    let kept_bytes = fs::read(kept.path.expect("copyright heic export")).unwrap();
    let metadata = Metadata::new_from_vec(&kept_bytes, FileExtension::WEBP).expect("copyright webp");
    assert_eq!(tag_text(&metadata, ExifTag::Copyright(String::new())).as_deref(), Some("(c) 2026 Bitclone Test"));
    assert_eq!(tag_text(&metadata, ExifTag::Artist(String::new())).as_deref(), Some("Test Artist"));

    let garbage_dir = temp_dir("edge-garbage");
    let garbage = garbage_dir.join("notes.heic");
    fs::write(&garbage, b"this is not a heic file").unwrap();
    let garbage_err = kit::preview(&garbage, &options).expect_err("a broken HEIC should not crash");
    assert_eq!(garbage_err, "Could not read this HEIC file.");

    let batch_dir = temp_dir("edge-batch");
    let heic = dir.join("photo.heic");
    let sources = vec![
        heic,
        dir.join("gray.png"),
        gif,
        garbage,
        dir.join("panorama-12000x3000.jpg"),
        dir.join("cmyk.jpg"),
        dir.join("indexed.png"),
        dir.join(&long_name),
    ];
    let written = kit::squeeze(&sources, &kit::blog_hero(&batch_dir)).expect("the batch should finish");
    assert_eq!(written.len(), sources.len());
    let failed: Vec<_> = written.iter().filter(|item| item.status == "failed").collect();
    let succeeded: Vec<_> = written.iter().filter(|item| item.status == "written").collect();
    assert_eq!(
        failed.len(),
        2,
        "{:?}",
        failed.iter().map(|item| (&item.name, &item.reason)).collect::<Vec<_>>()
    );
    assert_eq!(succeeded.len(), 6);
    let heic_row = written.iter().find(|item| item.name == "photo.heic").unwrap();
    let gif_row = written.iter().find(|item| item.name == "animation.gif").unwrap();
    let junk_row = written.iter().find(|item| item.name == "notes.heic").unwrap();
    assert_eq!(heic_row.status, "written", "{:?}", heic_row.reason);
    let heic_name = heic_row.path.as_ref().unwrap().file_name().unwrap().to_str().unwrap();
    assert!(heic_name.starts_with("photo-"), "{heic_name}");
    assert!(gif_row.reason.as_deref().unwrap_or("").contains("Animated GIF"), "{:?}", gif_row.reason);
    assert_eq!(junk_row.reason.as_deref(), Some("Could not read this HEIC file."));
    let gray = written.iter().find(|item| item.name == "gray.png").unwrap();
    assert_eq!(gray.status, "written", "{:?}", gray.reason);
    assert!(gray.path.as_ref().unwrap().is_file(), "a failed neighbor stopped the gray file");
    let wide = written.iter().find(|item| item.name == "panorama-12000x3000.jpg").unwrap();
    assert_eq!((wide.width, wide.height), (Some(1920), Some(800)), "{:?}", wide.reason);

    let readonly = temp_dir("edge-readonly");
    set_readonly(&readonly, true);
    let blocked = kit::squeeze(&[dir.join("gray.png"), dir.join("indexed.png")], &kit::blog_hero(&readonly));
    set_readonly(&readonly, false);
    let blocked = blocked.expect("a read-only folder should fail each file and still finish");
    assert_eq!(blocked.len(), 2);
    for item in &blocked {
        assert_eq!(item.status, "failed", "{} was written into a read-only folder", item.name);
        let reason = item.reason.as_deref().unwrap_or("");
        assert!(reason.contains("read-only"), "{reason}");
    }
    assert_eq!(fs::read_dir(&readonly).unwrap().count(), 0);

    assert_untouched(&before, &stamp(&dir));
    assert!(
        !heic_temps().iter().any(|path| path.file_name().unwrap().to_str().unwrap().contains(&std::process::id().to_string())),
        "a HEIC temp file was left behind: {:?}",
        heic_temps()
    );
    let _ = fs::remove_dir_all(unsupported_dir);
    let _ = fs::remove_dir_all(credit_out);
    let _ = fs::remove_dir_all(batch_dir);
    let _ = fs::remove_dir_all(garbage_dir);
    let _ = fs::remove_dir_all(readonly);
}

fn colorsync_center(path: &Path) -> [u8; 3] {
    let output = temp_dir("colorsync").join("matched.png");
    let status = std::process::Command::new("/usr/bin/sips")
        .args(["-s", "format", "png", "-m", "/System/Library/ColorSync/Profiles/sRGB Profile.icc"])
        .arg(path)
        .arg("--out")
        .arg(&output)
        .output()
        .expect("sips");
    assert!(status.status.success(), "ColorSync could not convert {path:?}");
    let rgb = raw_center(&output);
    let _ = fs::remove_dir_all(output.parent().unwrap());
    rgb
}

fn heic_temps() -> Vec<PathBuf> {
    fs::read_dir(std::env::temp_dir())
        .unwrap()
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("squeasel-heic-") && name.ends_with(".jpg"))
        })
        .collect()
}
