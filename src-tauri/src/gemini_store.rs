use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "gemini-secrets.json";
const KEY_API: &str = "gemini_api_key";

pub fn save_api_key(app: &AppHandle, key: String) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("Klucz API nie może być pusty.".to_string());
    }
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Nie można otworzyć magazynu klucza: {}", e))?;
    store.set(KEY_API, trimmed);
    store
        .save()
        .map_err(|e| format!("Nie można zapisać klucza: {}", e))?;
    Ok(())
}

pub fn has_api_key(app: &AppHandle) -> Result<bool, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Nie można otworzyć magazynu klucza: {}", e))?;
    Ok(store.get(KEY_API).is_some())
}

pub fn delete_api_key(app: &AppHandle) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Nie można otworzyć magazynu klucza: {}", e))?;
    store.delete(KEY_API);
    store
        .save()
        .map_err(|e| format!("Nie można usunąć klucza: {}", e))?;
    Ok(())
}

pub fn get_api_key(app: &AppHandle) -> Result<String, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Nie można otworzyć magazynu klucza: {}", e))?;
    store
        .get(KEY_API)
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .ok_or_else(|| "Brak zapisanego klucza Gemini.".to_string())
}
