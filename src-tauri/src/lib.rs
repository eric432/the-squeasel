mod batch;
mod color;
mod encode;
mod heic;
mod ingest;
pub mod kit;
mod name;
mod preview;
mod recipe;
mod resize;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            ingest::ingest_images,
            ingest::cancel_ingest,
            ingest::cancel_image,
            preview::preview_image,
            preview::export_image,
            preview::rerun_file,
            preview::close_preview,
            preview::begin_png_estimates,
            preview::png_color_estimate,
            preview::png_photo_facts,
            preview::reveal_in_finder,
            name::render_export_name,
            batch::start_batch,
            batch::cancel_batch,
            recipe::load_recipe_library,
            recipe::save_recipe_library,
            recipe::import_recipe_file,
            recipe::restore_starter_recipes,
            recipe::write_recipe_export
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
