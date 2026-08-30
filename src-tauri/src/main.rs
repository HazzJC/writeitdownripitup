// Ritual — desktop shell.
//
// There is deliberately nothing here. The whole app is the web build in
// dist/app, running in a WebView2 window; Rust's only job is to open that
// window and get out of the way. No commands are registered and no capabilities
// are granted, because the app asks the host for nothing at all.

// Without this, releasing the app on Windows opens a console window behind it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("failed to start Ritual");
}
