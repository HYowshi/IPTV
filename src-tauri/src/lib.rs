#[tauri::command]
fn exit_app() {
    std::process::exit(0);
}

// HÀM QUAN TRỌNG: Khởi chạy ứng dụng Tauri
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        // Không còn đăng ký proxy_fetch ở đây
        .invoke_handler(tauri::generate_handler![exit_app]) 
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}