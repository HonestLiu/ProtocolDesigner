mod commands;
mod file_io;
mod generator;
mod parser;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::save_protocol,
            commands::load_protocol,
            commands::export_code,
            commands::validate_protocol,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
