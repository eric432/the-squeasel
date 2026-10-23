//! Saved recipes. The file in the app data directory is the library.
//! A shared export uses the same JSON shape with one recipe or many.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;

use crate::resize::{Anchor, FitMode, OutputFormat};

const LIBRARY_VERSION: u32 = 1;
const FILE_NAME: &str = "recipes.json";
/// Selected in the list, but not a recipe and never written into `recipes`.
const NO_RECIPE_ID: &str = "no-recipe";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecipeLibrary {
    pub version: u32,
    pub selected_id: String,
    pub recipes: Vec<Recipe>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Recipe {
    pub version: u32,
    pub id: String,
    pub name: String,
    pub resize: RecipeResize,
    pub optimize: RecipeOptimize,
    pub output: RecipeOutput,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecipeResize {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub mode: FitMode,
    pub anchor: Anchor,
    pub pad_color: Option<String>,
    pub never_upscale: bool,
    pub retina2x: bool,
    /// Each image keeps its own pixel size. Width and height are ignored.
    /// Older recipes omit this, which serde reads as false, so they still resize.
    /// A later batch uses the same flag per file.
    #[serde(default)]
    pub no_resize: bool,
}

/// `"full"` or a palette size from 2 to 256. Not a separate Custom flag.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PngColors {
    Full,
    Count(u16),
}

impl Default for PngColors {
    /// A preview that omits the field stays full color, matching the old lossy switch default.
    fn default() -> Self {
        PngColors::Full
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecipeOptimize {
    pub format: OutputFormat,
    pub quality: u8,
    pub png_colors: PngColors,
    pub png_dither: bool,
    pub target_max_kb: Option<u32>,
    pub strip_metadata: bool,
    pub keep_copyright: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum FolderMode {
    Subfolder,
    Chosen,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ConflictRule {
    Rename,
    Skip,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecipeOutput {
    pub folder_mode: FolderMode,
    pub subfolder_name: String,
    pub chosen_folder: Option<String>,
    pub name_pattern: String,
    pub sequence_start: u32,
    pub conflict: ConflictRule,
}

/// Reads a current pattern or an older suffix. `namePattern` wins when both are present.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OutputFile {
    folder_mode: FolderMode,
    subfolder_name: String,
    #[serde(default)]
    chosen_folder: Option<String>,
    #[serde(default)]
    suffix: String,
    #[serde(default)]
    name_pattern: Option<String>,
    #[serde(default)]
    sequence_start: Option<u32>,
    conflict: ConflictRule,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecipeFile {
    version: u32,
    id: String,
    name: String,
    resize: RecipeResize,
    optimize: RecipeOptimize,
    output: OutputFile,
}

impl<'de> Deserialize<'de> for Recipe {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let file = RecipeFile::deserialize(deserializer)?;
        Ok(Recipe {
            version: file.version,
            id: file.id,
            name: file.name,
            resize: file.resize.clone(),
            optimize: file.optimize,
            output: RecipeOutput {
                folder_mode: file.output.folder_mode,
                subfolder_name: file.output.subfolder_name,
                chosen_folder: file.output.chosen_folder,
                name_pattern: crate::name::pattern_from_saved(
                    &file.output.suffix,
                    file.output.name_pattern.as_deref(),
                    &file.resize,
                ),
                sequence_start: file.output.sequence_start.unwrap_or(1),
                conflict: file.output.conflict,
            },
        })
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadedLibrary {
    pub library: RecipeLibrary,
    pub warning: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportFile {
    version: u32,
    recipes: Vec<Value>,
}

pub(crate) fn starter_library() -> RecipeLibrary {
    let recipes = starters();
    RecipeLibrary {
        version: LIBRARY_VERSION,
        selected_id: recipes[0].id.clone(),
        recipes,
    }
}

pub(crate) fn starters() -> Vec<Recipe> {
    vec![blog_hero(), web_photo(), thumbnail()]
}

fn blog_hero() -> Recipe {
    Recipe {
        version: 1,
        id: "starter-blog-hero".into(),
        name: "Blog hero".into(),
        resize: resize(Some(1920), Some(800), FitMode::Fill, false),
        optimize: optimize(OutputFormat::Webp, None),
        output: output("{name}-{width}x{height}"),
    }
}

fn web_photo() -> Recipe {
    Recipe {
        version: 1,
        id: "starter-web-photo".into(),
        name: "Web photo".into(),
        resize: resize(Some(2000), None, FitMode::Scale, false),
        optimize: optimize(OutputFormat::Smallest, Some(250)),
        output: output("{name}-{width}w"),
    }
}

fn thumbnail() -> Recipe {
    Recipe {
        version: 1,
        id: "starter-thumbnail".into(),
        name: "Thumbnail".into(),
        resize: resize(Some(400), Some(400), FitMode::Fill, false),
        optimize: optimize(OutputFormat::Webp, None),
        output: output("{name}-{width}x{height}"),
    }
}

fn resize(width: Option<u32>, height: Option<u32>, mode: FitMode, retina2x: bool) -> RecipeResize {
    RecipeResize {
        width,
        height,
        mode,
        anchor: Anchor::Center,
        pad_color: Some("#F3F1EC".into()),
        never_upscale: true,
        retina2x,
        no_resize: false,
    }
}

fn optimize(format: OutputFormat, target_max_kb: Option<u32>) -> RecipeOptimize {
    RecipeOptimize {
        format,
        quality: 78,
        png_colors: PngColors::Count(256),
        png_dither: true,
        target_max_kb,
        strip_metadata: true,
        keep_copyright: false,
    }
}

impl Serialize for PngColors {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            PngColors::Full => serializer.serialize_str("full"),
            PngColors::Count(count) => serializer.serialize_u16(*count),
        }
    }
}

impl<'de> Deserialize<'de> for PngColors {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = Value::deserialize(deserializer)?;
        match value {
            Value::String(text) if text == "full" => Ok(PngColors::Full),
            Value::Number(number) => {
                let count = number.as_u64().filter(|count| (2..=256).contains(count)).ok_or_else(|| {
                    serde::de::Error::custom("PNG colors must be from 2 to 256.")
                })?;
                Ok(PngColors::Count(count as u16))
            }
            _ => Err(serde::de::Error::custom("PNG colors must be \"full\" or a number from 2 to 256.")),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptimizeFile {
    format: OutputFormat,
    quality: u8,
    #[serde(default = "default_true")]
    lossless_png: bool,
    #[serde(default)]
    lossy_png: bool,
    #[serde(default)]
    png_colors: Option<PngColors>,
    #[serde(default)]
    png_dither: Option<bool>,
    #[serde(default)]
    target_max_kb: Option<u32>,
    #[serde(default = "default_true")]
    strip_metadata: bool,
    #[serde(default)]
    keep_copyright: bool,
}

fn default_true() -> bool {
    true
}

/// Old files stored lossyPng. A PNG with it off stays full color. Everything else,
/// including WebP and JPEG recipes, starts at 256 colors so choosing PNG later does too.
fn migrate_png(format: OutputFormat, lossy_png: bool, colors: Option<PngColors>, dither: Option<bool>) -> (PngColors, bool) {
    if let Some(colors) = colors {
        return (colors, dither.unwrap_or(true));
    }
    if format == OutputFormat::Png && !lossy_png {
        (PngColors::Full, dither.unwrap_or(true))
    } else {
        (PngColors::Count(256), true)
    }
}

impl<'de> Deserialize<'de> for RecipeOptimize {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let file = OptimizeFile::deserialize(deserializer)?;
        if file.png_colors.is_none() && file.lossy_png && file.lossless_png {
            return Err(serde::de::Error::custom(
                "A recipe can't be lossy and lossless PNG at the same time.",
            ));
        }
        let (png_colors, png_dither) = migrate_png(file.format, file.lossy_png, file.png_colors, file.png_dither);
        Ok(RecipeOptimize {
            format: file.format,
            quality: file.quality,
            png_colors,
            png_dither,
            target_max_kb: file.target_max_kb,
            strip_metadata: file.strip_metadata,
            keep_copyright: file.keep_copyright,
        })
    }
}

fn output(name_pattern: &str) -> RecipeOutput {
    RecipeOutput {
        folder_mode: FolderMode::Subfolder,
        subfolder_name: "squeasel".into(),
        chosen_folder: None,
        name_pattern: name_pattern.into(),
        sequence_start: 1,
        conflict: ConflictRule::Rename,
    }
}

pub(crate) fn load_library(dir: &Path) -> LoadedLibrary {
    let path = dir.join(FILE_NAME);
    if !path.exists() {
        return LoadedLibrary {
            library: starter_library(),
            warning: None,
        };
    }
    match fs::read(&path) {
        Ok(bytes) => match serde_json::from_slice::<RecipeLibrary>(&bytes) {
            Ok(library) => match validate_library(&library) {
                Ok(()) => LoadedLibrary {
                    library,
                    warning: None,
                },
                Err(err) => quarantine(dir, &path, &err),
            },
            Err(err) => quarantine(dir, &path, &err.to_string()),
        },
        Err(err) => quarantine(dir, &path, &err.to_string()),
    }
}

fn quarantine(dir: &Path, path: &Path, reason: &str) -> LoadedLibrary {
    let broken = unique_broken_path(dir);
    let copied = fs::copy(path, &broken);
    if copied.is_ok() {
        let _ = fs::remove_file(path);
    }
    let where_kept = broken
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("recipes.json.broken");
    LoadedLibrary {
        library: starter_library(),
        warning: Some(format!(
            "Couldn't read the saved recipes ({reason}). The starter recipes were loaded, and the unreadable file was kept as {where_kept}."
        )),
    }
}

fn unique_broken_path(dir: &Path) -> PathBuf {
    let first = dir.join("recipes.json.broken");
    if !first.exists() {
        return first;
    }
    let mut number = 1u32;
    loop {
        let path = dir.join(format!("recipes.json.broken-{number}"));
        if !path.exists() {
            return path;
        }
        number = number.saturating_add(1);
    }
}

pub(crate) fn save_library(dir: &Path, library: &RecipeLibrary) -> Result<(), String> {
    validate_library(library)?;
    fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    let target = dir.join(FILE_NAME);
    let temp = dir.join("recipes.json.tmp");
    let bytes = serde_json::to_vec_pretty(library).map_err(|err| err.to_string())?;
    fs::write(&temp, &bytes).map_err(|err| err.to_string())?;
    fs::rename(&temp, &target).map_err(|err| {
        let _ = fs::remove_file(&temp);
        err.to_string()
    })?;
    Ok(())
}

pub(crate) fn validate_library(library: &RecipeLibrary) -> Result<(), String> {
    if library.version != LIBRARY_VERSION {
        return Err(version_message(library.version));
    }
    if library.recipes.is_empty() && library.selected_id != NO_RECIPE_ID {
        return Err("A recipe library needs at least one recipe.".into());
    }
    let mut ids = Vec::new();
    for recipe in &library.recipes {
        validate_recipe(recipe)?;
        if ids.iter().any(|id: &String| id == &recipe.id) {
            return Err(format!("Two recipes use the same id {}.", recipe.id));
        }
        ids.push(recipe.id.clone());
    }
    if library.selected_id != NO_RECIPE_ID && !ids.iter().any(|id| id == &library.selected_id) {
        return Err("The selected recipe is not in the library.".into());
    }
    Ok(())
}

pub(crate) fn validate_recipe(recipe: &Recipe) -> Result<(), String> {
    if recipe.version != LIBRARY_VERSION {
        return Err(version_message(recipe.version));
    }
    if recipe.id == NO_RECIPE_ID {
        return Err("No recipe is built in and is not saved in the library.".into());
    }
    let name = recipe.name.trim();
    if name.is_empty() {
        return Err("A recipe needs a name.".into());
    }
    if name.chars().count() > 80 {
        return Err("A recipe name can be at most 80 characters.".into());
    }
    validate_side(recipe.resize.width, "Width")?;
    validate_side(recipe.resize.height, "Height")?;
    if recipe.optimize.quality == 0 || recipe.optimize.quality > 100 {
        return Err("Quality must be from 1 to 100.".into());
    }
    if let PngColors::Count(count) = recipe.optimize.png_colors {
        if !(2..=256).contains(&count) {
            return Err("PNG colors must be from 2 to 256.".into());
        }
    }
    if let Some(target) = recipe.optimize.target_max_kb {
        if target == 0 || target > 2_000_000 {
            return Err("Max file size must be from 1 to 2000000 KB.".into());
        }
    }
    validate_plain_name(&recipe.output.subfolder_name, "The output folder name")?;
    crate::name::check_pattern(&recipe.output.name_pattern)?;
    if recipe.output.folder_mode == FolderMode::Chosen {
        let folder = recipe.output.chosen_folder.as_deref().unwrap_or("").trim();
        if folder.is_empty() {
            return Err("Choose an output folder, or switch back to a subfolder.".into());
        }
    }
    Ok(())
}

fn validate_side(value: Option<u32>, label: &str) -> Result<(), String> {
    if matches!(value, Some(0)) {
        return Err(format!("{label} must be at least 1, or empty."));
    }
    Ok(())
}

fn validate_plain_name(name: &str, label: &str) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err(format!("{label} can't be empty."));
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(format!("{label} can't include a folder."));
    }
    Ok(())
}

fn version_message(version: u32) -> String {
    if version > LIBRARY_VERSION {
        "This recipe file is from a newer Squeasel.".into()
    } else {
        "This recipe file has an unknown version.".into()
    }
}

pub(crate) fn import_recipes(text: &str, existing_names: &[String]) -> Result<Vec<Recipe>, String> {
    let file: ImportFile = serde_json::from_str(text).map_err(|_| {
        "This file isn't a Squeasel recipe. It needs a version and a list of recipes.".to_string()
    })?;
    if file.version != LIBRARY_VERSION {
        return Err(version_message(file.version));
    }
    if file.recipes.is_empty() {
        return Err("This recipe file doesn't contain any recipes.".into());
    }
    let mut names: Vec<String> = existing_names.to_vec();
    let mut imported = Vec::with_capacity(file.recipes.len());
    for value in &file.recipes {
        reject_unsupported(value)?;
        let mut recipe: Recipe = serde_json::from_value(value.clone()).map_err(|err| {
            format!("This recipe file is missing something it needs ({err}).")
        })?;
        validate_recipe(&recipe)?;
        recipe.id = fresh_id();
        recipe.name = disambiguate_name(recipe.name.trim(), &names);
        names.push(recipe.name.clone());
        imported.push(recipe);
    }
    Ok(imported)
}

fn reject_unsupported(recipe: &Value) -> Result<(), String> {
    if recipe.pointer("/resize/anchor").and_then(Value::as_str) == Some("smart") {
        return Err("Smart anchor isn't in this version.".into());
    }
    if recipe.pointer("/optimize/format").and_then(Value::as_str) == Some("avif") {
        return Err("AVIF isn't in this version.".into());
    }
    Ok(())
}

fn disambiguate_name(name: &str, taken: &[String]) -> String {
    if !taken.iter().any(|existing| existing == name) {
        return name.to_string();
    }
    let mut number = 2u32;
    loop {
        let candidate = format!("{name} {number}");
        if !taken.iter().any(|existing| existing == &candidate) {
            return candidate;
        }
        number = number.saturating_add(1);
    }
}

/// Starters that were deleted or edited. Existing recipes are not changed.
pub(crate) fn starters_to_add(recipes: &[Recipe]) -> Vec<Recipe> {
    let mut additions = Vec::new();
    for starter in starters() {
        if recipes.iter().any(|recipe| same_body(recipe, &starter)) {
            continue;
        }
        let mut starter = starter;
        if recipes.iter().any(|recipe| recipe.id == starter.id)
            || additions.iter().any(|recipe: &Recipe| recipe.id == starter.id)
        {
            starter.id = fresh_id();
        }
        additions.push(starter);
    }
    additions
}

fn same_body(recipe: &Recipe, starter: &Recipe) -> bool {
    recipe.version == starter.version
        && recipe.name == starter.name
        && recipe.resize == starter.resize
        && recipe.optimize == starter.optimize
        && recipe.output == starter.output
}

fn fresh_id() -> String {
    static COUNT: AtomicU64 = AtomicU64::new(1);
    let count = COUNT.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("recipe-{nanos}-{count}")
}

pub(crate) fn write_export(path: &Path, recipes: &[Recipe]) -> Result<(), String> {
    if recipes.is_empty() {
        return Err("There is no recipe to export.".into());
    }
    for recipe in recipes {
        validate_recipe(recipe)?;
    }
    let file = serde_json::json!({
        "version": LIBRARY_VERSION,
        "recipes": recipes,
    });
    let bytes = serde_json::to_vec_pretty(&file).map_err(|err| err.to_string())?;
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
    }
    let mut temp = path.to_path_buf();
    temp.set_extension("json.tmp");
    fs::write(&temp, &bytes).map_err(|err| err.to_string())?;
    fs::rename(&temp, path).map_err(|err| {
        let _ = fs::remove_file(&temp);
        err.to_string()
    })?;
    Ok(())
}

fn library_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn load_recipe_library(app: tauri::AppHandle) -> LoadedLibrary {
    match library_dir(&app) {
        Ok(dir) => load_library(&dir),
        Err(err) => LoadedLibrary {
            library: starter_library(),
            warning: Some(format!("Couldn't open the recipe folder ({err}). The starter recipes were loaded.")),
        },
    }
}

#[tauri::command]
pub fn save_recipe_library(app: tauri::AppHandle, library: RecipeLibrary) -> Result<(), String> {
    let dir = library_dir(&app)?;
    save_library(&dir, &library)
}

#[tauri::command]
pub fn import_recipe_file(path: String, existing_names: Vec<String>) -> Result<Vec<Recipe>, String> {
    let text = fs::read_to_string(&path).map_err(|err| {
        if err.kind() == ErrorKind::NotFound {
            "That recipe file could not be found.".into()
        } else {
            err.to_string()
        }
    })?;
    import_recipes(&text, &existing_names)
}

#[tauri::command]
pub fn restore_starter_recipes(recipes: Vec<Recipe>) -> Vec<Recipe> {
    starters_to_add(&recipes)
}

#[tauri::command]
pub fn write_recipe_export(path: String, recipes: Vec<Recipe>) -> Result<(), String> {
    write_export(Path::new(&path), &recipes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("squeasel-recipes-{label}-{}-{nanos}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn recipe_json_uses_camel_case_and_round_trips() {
        let library = starter_library();
        let value = serde_json::to_value(&library).unwrap();
        assert_eq!(value["version"], 1);
        assert_eq!(value["selectedId"], "starter-blog-hero");
        assert!(value.get("selected_id").is_none());
        let recipe = &value["recipes"][0];
        for key in ["version", "id", "name", "resize", "optimize", "output"] {
            assert!(recipe.get(key).is_some(), "missing {key}");
        }
        assert!(recipe.get("pad_color").is_none());
        assert_eq!(recipe["resize"]["neverUpscale"], true);
        assert_eq!(recipe["resize"]["noResize"], false);
        assert_eq!(recipe["resize"]["retina2x"], false);
        assert_eq!(recipe["optimize"]["targetMaxKb"], Value::Null);
        assert_eq!(recipe["optimize"]["stripMetadata"], true);
        assert_eq!(recipe["optimize"]["pngColors"], 256);
        assert_eq!(recipe["optimize"]["pngDither"], true);
        assert!(recipe["optimize"].get("png_colors").is_none());
        assert!(recipe["optimize"].get("lossyPng").is_none());
        assert!(recipe["optimize"].get("losslessPng").is_none());
        assert_eq!(recipe["output"]["folderMode"], "subfolder");
        assert_eq!(recipe["output"]["conflict"], "rename");
        assert_eq!(recipe["output"]["namePattern"], "{name}-{width}x{height}");
        assert_eq!(recipe["output"]["sequenceStart"], 1);
        assert!(recipe["output"].get("suffix").is_none());
        assert!(recipe["output"].get("name_pattern").is_none());
        let parsed: RecipeLibrary = serde_json::from_value(value).unwrap();
        assert_eq!(parsed, library);
        assert_eq!(library.recipes[1].output.name_pattern, "{name}-{width}w");
        assert_eq!(library.recipes[1].name, "Web photo");
        assert_eq!(library.recipes[1].optimize.format, OutputFormat::Smallest);
        assert_eq!(library.recipes[1].optimize.target_max_kb, Some(250));
        assert_eq!(library.recipes[2].resize.width, Some(400));
    }

    #[test]
    fn import_rejects_a_newer_file_avif_smart_anchor_and_both_png_modes() {
        let err = import_recipes(r#"{"version":2,"recipes":[]}"#, &[]).unwrap_err();
        assert!(err.contains("newer Squeasel"));

        let avif = r##"{"version":1,"recipes":[{"version":1,"id":"a","name":"A","resize":{"width":10,"height":10,"mode":"fill","anchor":"center","padColor":"#fff","neverUpscale":true,"retina2x":false},"optimize":{"format":"avif","quality":78,"losslessPng":true,"lossyPng":false,"targetMaxKb":null,"stripMetadata":true,"keepCopyright":false},"output":{"folderMode":"subfolder","subfolderName":"squeasel","chosenFolder":null,"suffix":"","conflict":"rename"}}]}"##;
        assert!(import_recipes(avif, &[]).unwrap_err().contains("AVIF"));

        let smart = avif.replace("avif", "webp").replace("center", "smart");
        assert!(import_recipes(&smart, &[]).unwrap_err().contains("Smart anchor"));

        let both = avif.replace("avif", "png").replace("\"lossyPng\":false", "\"lossyPng\":true");
        assert!(import_recipes(&both, &[]).unwrap_err().contains("lossy and lossless"));

        let old_lossy = avif
            .replace("avif", "png")
            .replace("\"losslessPng\":true", "\"losslessPng\":false")
            .replace("\"lossyPng\":false", "\"lossyPng\":true");
        let imported = import_recipes(&old_lossy, &[]).unwrap();
        assert_eq!(imported[0].optimize.png_colors, PngColors::Count(256));
        assert!(imported[0].optimize.png_dither);

        let old_full = avif.replace("avif", "png");
        let full = import_recipes(&old_full, &[]).unwrap();
        assert_eq!(full[0].optimize.png_colors, PngColors::Full);
        assert!(full[0].optimize.png_dither);

        let old_webp = avif.replace("avif", "webp");
        let webp = import_recipes(&old_webp, &[]).unwrap();
        assert_eq!(webp[0].optimize.png_colors, PngColors::Count(256));
        assert!(webp[0].optimize.png_dither);
        assert_eq!(webp[0].output.name_pattern, "{name}-{width}x{height}");
        assert_eq!(webp[0].output.sequence_start, 1);

        let low = avif.replace("avif", "webp").replace("\"quality\":78", "\"quality\":0");
        assert!(import_recipes(&low, &[]).unwrap_err().contains("1 to 100"));

        assert!(import_recipes("not json", &[]).unwrap_err().contains("isn't a Squeasel recipe"));
    }

    #[test]
    fn an_old_suffix_migrates_and_an_unknown_token_is_rejected() {
        let old = r##"{"version":1,"id":"a","name":"Hero","resize":{"width":1920,"height":800,"mode":"fill","anchor":"center","padColor":"#fff","neverUpscale":true,"retina2x":false},"optimize":{"format":"webp","quality":78,"targetMaxKb":null,"stripMetadata":true,"keepCopyright":false},"output":{"folderMode":"subfolder","subfolderName":"squeasel","chosenFolder":null,"suffix":"-1920x800","conflict":"rename"}}"##;
        let recipe: Recipe = serde_json::from_str(old).unwrap();
        assert_eq!(recipe.output.name_pattern, "{name}-1920x800");
        assert_eq!(recipe.output.sequence_start, 1);
        let saved = serde_json::to_value(&recipe).unwrap();
        assert!(saved["output"].get("suffix").is_none());
        assert_eq!(saved["output"]["namePattern"], "{name}-1920x800");

        let typed = old.replace("-1920x800", "-hero");
        let recipe: Recipe = serde_json::from_str(&typed).unwrap();
        assert_eq!(recipe.output.name_pattern, "{name}-hero");

        let mut broken = recipe.clone();
        broken.output.name_pattern = "{nope}".into();
        assert!(validate_recipe(&broken).unwrap_err().contains("{nope}"));
    }

    #[test]
    fn import_gives_new_ids_and_numbers_a_taken_name() {
        let text = serde_json::to_string(&serde_json::json!({
            "version": 1,
            "recipes": [blog_hero()],
        }))
        .unwrap();
        let imported = import_recipes(&text, &["Blog hero".into()]).unwrap();
        assert_eq!(imported.len(), 1);
        assert_ne!(imported[0].id, "starter-blog-hero");
        assert_eq!(imported[0].name, "Blog hero 2");
    }

    #[test]
    fn save_replaces_the_file_atomically_and_a_broken_file_is_kept() {
        let dir = temp_dir("save");
        let library = starter_library();
        save_library(&dir, &library).unwrap();
        let saved = dir.join(FILE_NAME);
        assert!(saved.is_file());
        assert!(!dir.join("recipes.json.tmp").exists());
        let loaded = load_library(&dir);
        assert!(loaded.warning.is_none());
        assert_eq!(loaded.library, library);

        let mut renamed = library.clone();
        renamed.recipes[0].name = "Renamed".into();
        save_library(&dir, &renamed).unwrap();
        assert_eq!(load_library(&dir).library.recipes[0].name, "Renamed");

        fs::write(&saved, b"{").unwrap();
        let broken = load_library(&dir);
        assert!(broken.warning.as_ref().unwrap().contains("starter recipes"));
        assert_eq!(broken.library.recipes.len(), 3);
        let kept = fs::read(dir.join("recipes.json.broken")).unwrap();
        assert_eq!(kept, b"{");
        assert!(!saved.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn restore_adds_a_missing_or_changed_starter_and_leaves_other_recipes() {
        let mut recipes = starters();
        recipes.remove(0);
        recipes[0].name = "My web photo".into();
        recipes.push(Recipe {
            id: "mine".into(),
            name: "Client banner".into(),
            ..blog_hero()
        });
        let before = recipes.clone();
        let added = starters_to_add(&recipes);
        let names: Vec<_> = added.iter().map(|recipe| recipe.name.as_str()).collect();
        assert!(names.contains(&"Blog hero"));
        assert!(names.contains(&"Web photo"));
        assert!(!names.contains(&"Thumbnail"));
        assert!(added.iter().all(|recipe| recipe.id != "mine"));
        assert_eq!(recipes, before);
    }

    #[test]
    fn missing_no_resize_still_resizes_and_no_recipe_is_not_stored() {
        let mut value = serde_json::to_value(starter_library()).unwrap();
        value["recipes"][0]["resize"]
            .as_object_mut()
            .unwrap()
            .remove("noResize");
        let library: RecipeLibrary = serde_json::from_value(value).unwrap();
        assert!(!library.recipes[0].resize.no_resize);
        assert!(library.recipes.iter().all(|recipe| recipe.id != NO_RECIPE_ID));

        let mut selected = library.clone();
        selected.selected_id = NO_RECIPE_ID.into();
        validate_library(&selected).unwrap();

        let empty = RecipeLibrary {
            version: LIBRARY_VERSION,
            selected_id: NO_RECIPE_ID.into(),
            recipes: Vec::new(),
        };
        validate_library(&empty).unwrap();

        let mut blocked = library;
        blocked.recipes[0].id = NO_RECIPE_ID.into();
        blocked.selected_id = NO_RECIPE_ID.into();
        assert!(validate_library(&blocked).is_err());
    }
}
