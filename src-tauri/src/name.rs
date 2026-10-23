//! One renderer for recipe names, the live example, and the file that gets written.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::encode;
use crate::recipe::RecipeResize;
use crate::resize::{plan_resize, Anchor, FitMode, OutputFormat};

const PATTERN_LIMIT: usize = 200;
const STEM_LIMIT: usize = 200;

pub(crate) struct NameParts<'a> {
    pub name: &'a str,
    pub width: u32,
    pub height: u32,
    pub format: &'a str,
    pub recipe: &'a str,
    pub date: &'a str,
    pub n: u32,
}

/// The pattern an empty suffix used to build, written out so the field shows it.
pub(crate) fn automatic_pattern(resize: &RecipeResize) -> String {
    if resize.no_resize {
        return "{name}-{width}x{height}".into();
    }
    match resize.mode {
        FitMode::Scale => match (positive(resize.width), positive(resize.height)) {
            (Some(_), _) => "{name}-{width}w".into(),
            (None, Some(_)) => "{name}-{height}h".into(),
            (None, None) => "{name}-{width}x{height}".into(),
        },
        _ => "{name}-{width}x{height}".into(),
    }
}

/// A saved `namePattern` wins. A typed suffix stays literal. A blank suffix becomes the automatic pattern.
pub(crate) fn pattern_from_saved(suffix: &str, name_pattern: Option<&str>, resize: &RecipeResize) -> String {
    if let Some(pattern) = name_pattern.map(str::trim).filter(|pattern| !pattern.is_empty()) {
        return pattern.to_string();
    }
    let suffix = suffix.trim();
    if suffix.is_empty() {
        automatic_pattern(resize)
    } else {
        format!("{{name}}{suffix}")
    }
}

pub(crate) fn check_pattern(pattern: &str) -> Result<(), String> {
    if pattern.trim().is_empty() {
        return Err("Enter a name pattern.".into());
    }
    if pattern.chars().count() > PATTERN_LIMIT {
        return Err(format!("A name pattern can be at most {PATTERN_LIMIT} characters."));
    }
    expand(pattern, &NameParts {
        name: "photo",
        width: 1,
        height: 1,
        format: "jpg",
        recipe: "Recipe",
        date: "2000-01-01",
        n: 1,
    })?;
    Ok(())
}

pub(crate) fn render_stem(pattern: &str, parts: &NameParts) -> Result<String, String> {
    let expanded = expand(pattern, parts)?;
    Ok(sanitize_stem(&expanded))
}

pub(crate) fn local_iso_date() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0);
    #[cfg(target_os = "macos")]
    if let Some(date) = macos_local_date(secs) {
        return date;
    }
    utc_iso_date(secs)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NameExampleRequest {
    pub pattern: String,
    pub sequence_start: u32,
    pub source_name: String,
    pub source_width: u32,
    pub source_height: u32,
    pub recipe_name: String,
    pub format: OutputFormat,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub mode: FitMode,
    pub never_upscale: bool,
    pub no_resize: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NameExample {
    pub before: String,
    pub after: String,
    pub error: Option<String>,
    pub note: Option<String>,
}

pub(crate) fn example_name(request: &NameExampleRequest, date: &str) -> NameExample {
    let before = request.source_name.clone();
    let failed = |error: String| NameExample {
        before: before.clone(),
        after: String::new(),
        error: Some(error),
        note: None,
    };
    let (width, height, mode) = if request.no_resize {
        (None, None, FitMode::Fit)
    } else {
        (request.width, request.height, request.mode)
    };
    let plan = match plan_resize(
        request.source_width,
        request.source_height,
        width,
        height,
        mode,
        request.never_upscale,
        Anchor::Center,
    ) {
        Ok(plan) => plan,
        Err(()) => return failed("This image has no size yet.".into()),
    };
    let smallest = request.format == OutputFormat::Smallest;
    let extension = encode::extension(request.format);
    let format_token = if smallest { "…" } else { extension };
    let stem_name = Path::new(&request.source_name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("image");
    match render_stem(
        &request.pattern,
        &NameParts {
            name: stem_name,
            width: plan.output_width,
            height: plan.output_height,
            format: format_token,
            recipe: &request.recipe_name,
            date,
            n: request.sequence_start,
        },
    ) {
        Ok(stem) => NameExample {
            before,
            after: if smallest { stem } else { format!("{stem}.{extension}") },
            error: None,
            note: smallest.then(|| "The extension is chosen when the file is written.".into()),
        },
        Err(error) => failed(error),
    }
}

#[tauri::command]
pub fn render_export_name(request: NameExampleRequest) -> NameExample {
    example_name(&request, &local_iso_date())
}

fn expand(pattern: &str, parts: &NameParts) -> Result<String, String> {
    if pattern.trim().is_empty() {
        return Err("Enter a name pattern.".into());
    }
    if pattern.chars().count() > PATTERN_LIMIT {
        return Err(format!("A name pattern can be at most {PATTERN_LIMIT} characters."));
    }
    let chars: Vec<char> = pattern.chars().collect();
    let mut out = String::new();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] != '{' {
            out.push(chars[index]);
            index += 1;
            continue;
        }
        let token_at = index + 1;
        let mut end = token_at;
        while end < chars.len() && chars[end] != '}' {
            end += 1;
        }
        if end >= chars.len() {
            return Err("A name token is missing its closing brace.".into());
        }
        let token: String = chars[token_at..end].iter().collect();
        out.push_str(&token_value(&token, parts)?);
        index = end + 1;
    }
    Ok(out)
}

fn token_value(token: &str, parts: &NameParts) -> Result<String, String> {
    Ok(match token {
        "name" => parts.name.to_string(),
        "width" => parts.width.to_string(),
        "height" => parts.height.to_string(),
        "format" => parts.format.to_string(),
        "recipe" => parts.recipe.to_string(),
        "date" => parts.date.to_string(),
        "n" => parts.n.to_string(),
        "nn" => format!("{:02}", parts.n),
        "nnn" => format!("{:03}", parts.n),
        other => return Err(format!("Unknown name token {{{other}}}.")),
    })
}

fn sanitize_stem(raw: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for ch in raw.chars() {
        if unsafe_name_char(ch) {
            if !out.is_empty() {
                dash = true;
            }
            continue;
        }
        if dash {
            if !out.ends_with('-') {
                out.push('-');
            }
            dash = false;
        }
        out.push(ch);
    }
    let trimmed = out.trim_matches(|ch: char| ch == '.' || ch == ' ' || ch == '-');
    let limited = limit_bytes(trimmed, STEM_LIMIT);
    if limited.is_empty() { "image".into() } else { limited }
}

fn unsafe_name_char(ch: char) -> bool {
    ch.is_control() || matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
}

fn limit_bytes(stem: &str, max: usize) -> String {
    if stem.len() <= max {
        return stem.to_string();
    }
    let mut end = max;
    while !stem.is_char_boundary(end) {
        end -= 1;
    }
    stem[..end]
        .trim_end_matches(|ch: char| ch == '.' || ch == ' ' || ch == '-')
        .to_string()
}

fn positive(value: Option<u32>) -> Option<u32> {
    value.filter(|side| *side > 0)
}

fn utc_iso_date(secs: i64) -> String {
    let z = secs.div_euclid(86_400) + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let mut year = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    if month <= 2 {
        year += 1;
    }
    format!("{year:04}-{month:02}-{day:02}")
}

#[cfg(target_os = "macos")]
fn macos_local_date(secs: i64) -> Option<String> {
    #[repr(C)]
    struct LibcTm {
        tm_sec: i32,
        tm_min: i32,
        tm_hour: i32,
        tm_mday: i32,
        tm_mon: i32,
        tm_year: i32,
        tm_wday: i32,
        tm_yday: i32,
        tm_isdst: i32,
        tm_gmtoff: i64,
        tm_zone: *const i8,
    }
    unsafe extern "C" {
        fn localtime_r(clock: *const i64, result: *mut LibcTm) -> *mut LibcTm;
    }
    unsafe {
        let mut tm = std::mem::zeroed();
        if localtime_r(&secs, &mut tm).is_null() {
            return None;
        }
        Some(format!("{:04}-{:02}-{:02}", tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parts(name: &str, n: u32) -> NameParts<'_> {
        NameParts {
            name,
            width: 1920,
            height: 800,
            format: "webp",
            recipe: "Blog hero",
            date: "2026-10-22",
            n,
        }
    }

    fn resize(width: Option<u32>, height: Option<u32>, mode: FitMode, no_resize: bool) -> RecipeResize {
        RecipeResize {
            width,
            height,
            mode,
            anchor: Anchor::Center,
            pad_color: None,
            never_upscale: true,
            retina2x: false,
            no_resize,
        }
    }

    #[test]
    fn every_token_renders() {
        let stem = render_stem(
            "{date}-{recipe}-{name}-{width}x{height}.{format}-{n}-{nn}-{nnn}",
            &parts("photo", 7),
        )
        .unwrap();
        assert_eq!(stem, "2026-10-22-Blog hero-photo-1920x800.webp-7-07-007");
    }

    #[test]
    fn an_unknown_token_is_rejected() {
        let error = render_stem("{foo}", &parts("photo", 1)).unwrap_err();
        assert_eq!(error, "Unknown name token {foo}.");
        assert!(render_stem("photo-{width", &parts("photo", 1))
            .unwrap_err()
            .contains("closing brace"));
    }

    #[test]
    fn unsafe_characters_are_stripped_and_the_stem_is_capped() {
        let stem = render_stem("{name}", &parts("../photo:shot", 1)).unwrap();
        assert_eq!(stem, "photo-shot");
        let long = "a".repeat(250);
        assert_eq!(render_stem("{name}", &parts(&long, 1)).unwrap().len(), STEM_LIMIT);
        assert!(render_stem(&"b".repeat(201), &parts("photo", 1))
            .unwrap_err()
            .contains("200"));
        assert_eq!(render_stem("///", &parts("photo", 1)).unwrap(), "image");
    }

    #[test]
    fn padding_uses_the_sequence_number_it_is_given() {
        assert_eq!(render_stem("product-{nnn}", &parts("photo", 5)).unwrap(), "product-005");
        assert_eq!(render_stem("{nn}", &parts("photo", 1000)).unwrap(), "1000");
        assert_eq!(render_stem("{n}", &parts("photo", 5)).unwrap(), "5");
    }

    #[test]
    fn a_typed_suffix_stays_literal_and_a_blank_one_becomes_the_automatic_pattern() {
        let fill = resize(Some(1920), Some(800), FitMode::Fill, false);
        assert_eq!(pattern_from_saved("-1920x800", None, &fill), "{name}-1920x800");
        let stem = render_stem(&pattern_from_saved("-hero", None, &fill), &parts("photo", 1)).unwrap();
        assert_eq!(stem, "photo-hero");
        assert_eq!(pattern_from_saved("", None, &fill), "{name}-{width}x{height}");
        let wide = resize(Some(2000), None, FitMode::Scale, false);
        assert_eq!(pattern_from_saved("  ", None, &wide), "{name}-{width}w");
        let tall = resize(None, Some(800), FitMode::Scale, false);
        assert_eq!(pattern_from_saved("", None, &tall), "{name}-{height}h");
        let kept = resize(None, None, FitMode::Fit, true);
        assert_eq!(pattern_from_saved("", None, &kept), "{name}-{width}x{height}");
        assert_eq!(
            pattern_from_saved("-old", Some(" {date}-{name} "), &fill),
            "{date}-{name}"
        );
    }

    #[test]
    fn the_example_uses_the_planned_size_and_does_not_invent_a_smallest_extension() {
        let request = NameExampleRequest {
            pattern: "{name}-{width}x{height}".into(),
            sequence_start: 1,
            source_name: "photo.jpg".into(),
            source_width: 3000,
            source_height: 2000,
            recipe_name: "Blog hero".into(),
            format: OutputFormat::Webp,
            width: Some(1920),
            height: Some(800),
            mode: FitMode::Fill,
            never_upscale: true,
            no_resize: false,
        };
        let example = example_name(&request, "2026-10-22");
        assert_eq!(example.after, "photo-1920x800.webp");
        assert_eq!(example.error, None);

        let mut smallest = request;
        smallest.format = OutputFormat::Smallest;
        smallest.pattern = "{name}-{width}w".into();
        smallest.height = None;
        smallest.mode = FitMode::Scale;
        let example = example_name(&smallest, "2026-10-22");
        assert_eq!(example.after, "photo-1920w");
        assert!(example.note.unwrap().contains("extension is chosen"));
    }

    #[test]
    fn utc_dates_round_trip() {
        assert_eq!(utc_iso_date(0), "1970-01-01");
        assert_eq!(utc_iso_date(1_792_627_200), "2026-10-22");
        assert!(local_iso_date().len() == 10);
    }
}
