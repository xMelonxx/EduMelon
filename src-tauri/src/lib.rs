mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::extract_pdf_text,
            commands::extract_pdf_pages_text,
            commands::extract_pptx_slides,
            commands::read_file_bytes,
            commands::write_text_file,
            commands::ollama_health,
            commands::ollama_list_models,
            commands::ollama_pull_model,
            commands::ollama_pull_model_stream,
            commands::ollama_embeddings,
            commands::ollama_chat_backend,
            commands::ollama_chat_with_images_backend,
            commands::configure_ollama_models_dir,
            commands::diagnose_ollama,
            commands::get_system_specs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
