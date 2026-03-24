#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod backend;

use backend::{
    AppSnapshot, CaptureCurrentInput, ProfileInput, ProfileStore, SetCodexHomeInput,
    SwitchProfileResult, UpdateProfileInput,
};
use tauri::{AppHandle, Manager};

fn store_from_app(app: &AppHandle) -> Result<ProfileStore, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    ProfileStore::new(app_data_dir).map_err(|error| error.to_string())
}

#[tauri::command]
fn load_snapshot(app: AppHandle) -> Result<AppSnapshot, String> {
    store_from_app(&app)?
        .load_snapshot()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn create_profile(app: AppHandle, payload: ProfileInput) -> Result<AppSnapshot, String> {
    store_from_app(&app)?
        .create_profile(payload)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn capture_current_profile(
    app: AppHandle,
    payload: CaptureCurrentInput,
) -> Result<AppSnapshot, String> {
    store_from_app(&app)?
        .capture_current_profile(payload)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn update_profile(app: AppHandle, payload: UpdateProfileInput) -> Result<AppSnapshot, String> {
    store_from_app(&app)?
        .update_profile(payload)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_profile(app: AppHandle, profile_id: String) -> Result<AppSnapshot, String> {
    store_from_app(&app)?
        .delete_profile(&profile_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn switch_profile(app: AppHandle, profile_id: String) -> Result<SwitchProfileResult, String> {
    store_from_app(&app)?
        .switch_profile(&profile_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_codex_home(app: AppHandle, payload: SetCodexHomeInput) -> Result<AppSnapshot, String> {
    store_from_app(&app)?
        .set_codex_home(payload)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn open_codex_home(app: AppHandle) -> Result<(), String> {
    store_from_app(&app)?
        .open_codex_home()
        .map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_snapshot,
            create_profile,
            capture_current_profile,
            update_profile,
            delete_profile,
            switch_profile,
            set_codex_home,
            open_codex_home
        ])
        .run(tauri::generate_context!())
        .expect("error while running Codex Profile Switcher");
}
