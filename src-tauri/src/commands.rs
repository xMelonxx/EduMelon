use serde::Serialize;
use std::env;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;
use sysinfo::System;
use tauri::Emitter;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct OllamaChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct OllamaImageMessage {
    pub role: String,
    pub content: String,
    pub images: Option<Vec<String>>,
}

#[derive(Debug, serde::Deserialize)]
pub struct OllamaChatOptionsPayload {
    pub stream: Option<bool>,
    pub format: Option<serde_json::Value>,
    pub temperature: Option<f64>,
    pub num_predict: Option<i64>,
}

#[derive(Debug, Serialize, Clone)]
pub struct SlideChunk {
    pub slide_index: u32,
    pub text: String,
}

/// Extract plain text from a PDF file.
#[tauri::command]
pub fn extract_pdf_text(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Plik nie istnieje: {}", path));
    }
    let mut file = File::open(p).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    pdf_extract::extract_text_from_mem(&buf).map_err(|e| e.to_string())
}

/// Extract text per page from a PDF file.
#[tauri::command]
pub fn extract_pdf_pages_text(path: String) -> Result<Vec<SlideChunk>, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Plik nie istnieje: {}", path));
    }
    let pages = pdf_extract::extract_text_by_pages(p).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for (idx, text) in pages.into_iter().enumerate() {
        let trimmed = text.split_whitespace().collect::<Vec<_>>().join(" ");
        out.push(SlideChunk {
            slide_index: (idx + 1) as u32,
            text: trimmed,
        });
    }
    Ok(out)
}

/// Zapis tekstu UTF-8 (np. eksport fiszek do pliku wybranego w oknie dialogowym).
#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(p, contents.as_bytes()).map_err(|e| e.to_string())
}

/// Read raw bytes from a local file (for in-app PDF preview).
#[tauri::command]
pub fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Plik nie istnieje: {}", path));
    }
    let mut file = File::open(p).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
}

/// Extract text per slide from PPTX (Office Open XML).
#[tauri::command]
pub fn extract_pptx_slides(path: String) -> Result<Vec<SlideChunk>, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Plik nie istnieje: {}", path));
    }

    let file = File::open(p).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Nieprawidłowy plik ZIP/PPTX: {}", e))?;

    let mut slide_names: Vec<String> = (0..archive.len())
        .filter_map(|i| {
            let name = archive.by_index(i).ok()?.name().to_string();
            if name.starts_with("ppt/slides/slide") && name.ends_with(".xml") {
                Some(name)
            } else {
                None
            }
        })
        .collect();

    slide_names.sort_by(|a, b| natural_slide_cmp(a, b));

    let file2 = File::open(p).map_err(|e| e.to_string())?;
    let mut archive2 = zip::ZipArchive::new(file2).map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for (idx, name) in slide_names.iter().enumerate() {
        let mut zf = archive2.by_name(name).map_err(|e| e.to_string())?;
        let mut xml = String::new();
        zf.read_to_string(&mut xml).map_err(|e| e.to_string())?;
        let text = extract_text_from_slide_xml(&xml);
        let trimmed = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if !trimmed.is_empty() {
            out.push(SlideChunk {
                slide_index: (idx + 1) as u32,
                text: trimmed,
            });
        }
    }

    Ok(out)
}

fn natural_slide_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let na = slide_num_from_name(a);
    let nb = slide_num_from_name(b);
    na.cmp(&nb)
}

fn slide_num_from_name(name: &str) -> u32 {
    name.strip_prefix("ppt/slides/slide")
        .and_then(|s| s.strip_suffix(".xml"))
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}

fn extract_text_from_slide_xml(xml: &str) -> String {
    let mut reader = quick_xml::Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut texts: Vec<String> = Vec::new();
    let mut in_text = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(quick_xml::events::Event::Start(e)) => {
                if e.name().as_ref() == b"a:t" {
                    in_text = true;
                }
            }
            Ok(quick_xml::events::Event::Text(e)) => {
                if in_text {
                    if let Ok(s) = std::str::from_utf8(e.as_ref()) {
                        texts.push(s.to_string());
                    }
                }
            }
            Ok(quick_xml::events::Event::End(e)) => {
                if e.name().as_ref() == b"a:t" {
                    in_text = false;
                }
            }
            Ok(quick_xml::events::Event::Eof) => break,
            Err(e) => {
                texts.push(format!("[błąd XML: {}]", e));
                break;
            }
            _ => {}
        }
        buf.clear();
    }

    texts.join(" ")
}

#[tauri::command]
pub async fn ollama_health() -> Result<bool, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;
    match client.get("http://127.0.0.1:11434/api/tags").send().await {
        Ok(r) => Ok(r.status().is_success()),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
pub async fn ollama_pull_model(model: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(7200))
        .build()
        .map_err(|e| e.to_string())?;
    let body = serde_json::json!({ "name": model });
    let res = client
        .post("http://127.0.0.1:11434/api/pull")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama nie odpowiada: {}", e))?;
    if !res.status().is_success() {
        return Err(format!("pull zwrócił status {}", res.status()));
    }
    let _ = res.text().await;
    Ok(format!("Model {} — pobieranie zakończone.", model))
}

#[tauri::command]
pub async fn ollama_list_models() -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .get("http://127.0.0.1:11434/api/tags")
        .send()
        .await
        .map_err(|e| format!("Ollama nie odpowiada: {}", e))?;
    if !res.status().is_success() {
        return Err(format!("tags zwrócił status {}", res.status()));
    }
    let data = res
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Nieprawidłowa odpowiedź tags: {}", e))?;
    let mut out: Vec<String> = Vec::new();
    if let Some(models) = data.get("models").and_then(|v| v.as_array()) {
        for model in models {
            if let Some(name) = model.get("name").and_then(|n| n.as_str()) {
                out.push(name.to_string());
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn ollama_pull_model_stream(
    app: tauri::AppHandle,
    model: String,
    request_id: String,
) -> Result<String, String> {
    let event_name = format!("ollama-pull-progress-{}", request_id);
    let _ = app.emit(&event_name, r#"{"status":"Łączę z Ollamą...","completed":0,"total":0}"#);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(7200))
        .build()
        .map_err(|e| e.to_string())?;
    let body = serde_json::json!({ "name": model, "stream": true });
    let mut res = client
        .post("http://127.0.0.1:11434/api/pull")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama nie odpowiada: {}", e))?;
    if !res.status().is_success() {
        return Err(format!("pull zwrócił status {}", res.status()));
    }

    let mut pending = String::new();
    while let Some(chunk) = res
        .chunk()
        .await
        .map_err(|e| format!("Błąd odczytu strumienia pull: {}", e))?
    {
        pending.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = pending.find('\n') {
            let line = pending[..pos].trim().to_string();
            pending = pending[(pos + 1)..].to_string();
            if !line.is_empty() {
                let _ = app.emit(&event_name, line);
            }
        }
    }

    let tail = pending.trim();
    if !tail.is_empty() {
        let _ = app.emit(&event_name, tail);
    }
    let _ = app.emit(
        &event_name,
        r#"{"status":"Pobieranie zakończone","completed":1,"total":1}"#,
    );
    Ok(format!("Model {} — pobieranie zakończone.", model))
}

#[tauri::command]
pub async fn ollama_embeddings(model: String, prompt: String) -> Result<Vec<f64>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let body = serde_json::json!({ "model": model, "prompt": prompt });
    let res = client
        .post("http://127.0.0.1:11434/api/embeddings")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama embeddings nie odpowiada: {}", e))?;
    if !res.status().is_success() {
        return Err(format!("embeddings zwrócił status {}", res.status()));
    }
    let data = res
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Nieprawidłowa odpowiedź embeddings: {}", e))?;
    let embedding = data
        .get("embedding")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Brak pola embedding w odpowiedzi Ollamy".to_string())?;
    let mut out = Vec::with_capacity(embedding.len());
    for val in embedding {
        let num = val
            .as_f64()
            .ok_or_else(|| "Embedding zawiera nieprawidłową wartość".to_string())?;
        out.push(num);
    }
    if out.is_empty() {
        return Err("Brak wektora embedding".to_string());
    }
    Ok(out)
}

#[tauri::command]
pub async fn ollama_chat_backend(
    model: String,
    messages: Vec<OllamaChatMessage>,
    options: Option<OllamaChatOptionsPayload>,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let mut body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": options.as_ref().and_then(|o| o.stream).unwrap_or(false),
    });
    if let Some(opts) = options {
        if let Some(format) = opts.format {
            body["format"] = format;
        }
        if opts.temperature.is_some() || opts.num_predict.is_some() {
            let mut o = serde_json::Map::new();
            if let Some(t) = opts.temperature {
                o.insert("temperature".to_string(), serde_json::json!(t));
            }
            if let Some(n) = opts.num_predict {
                o.insert("num_predict".to_string(), serde_json::json!(n));
            }
            body["options"] = serde_json::Value::Object(o);
        }
    }

    let res = client
        .post("http://127.0.0.1:11434/api/chat")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama chat nie odpowiada: {}", e))?;
    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("chat: {} {}", status, text));
    }
    let data = res
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Nieprawidłowa odpowiedź chat: {}", e))?;
    Ok(data
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string())
}

#[tauri::command]
pub async fn ollama_chat_with_images_backend(
    model: String,
    messages: Vec<OllamaImageMessage>,
    options: Option<OllamaChatOptionsPayload>,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let mut body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": options.as_ref().and_then(|o| o.stream).unwrap_or(false),
    });
    if let Some(opts) = options {
        if let Some(format) = opts.format {
            body["format"] = format;
        }
        if opts.temperature.is_some() || opts.num_predict.is_some() {
            let mut o = serde_json::Map::new();
            if let Some(t) = opts.temperature {
                o.insert("temperature".to_string(), serde_json::json!(t));
            }
            if let Some(n) = opts.num_predict {
                o.insert("num_predict".to_string(), serde_json::json!(n));
            }
            body["options"] = serde_json::Value::Object(o);
        }
    }

    let res = client
        .post("http://127.0.0.1:11434/api/chat")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama chat(vision) nie odpowiada: {}", e))?;
    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("chat(vision): {} {}", status, text));
    }
    let data = res
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Nieprawidłowa odpowiedź chat(vision): {}", e))?;
    Ok(data
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string())
}

#[tauri::command]
pub async fn configure_ollama_models_dir(path: String) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Pusty katalog modeli.".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let escaped = trimmed.replace('\'', "''");
        let ps = format!(
            "[Environment]::SetEnvironmentVariable('OLLAMA_MODELS', '{}', 'User')",
            escaped
        );
        let out = Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps])
            .output()
            .map_err(|e| format!("Nie udało się ustawić OLLAMA_MODELS: {}", e))?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(format!("Błąd ustawiania OLLAMA_MODELS: {}", err.trim()));
        }

        // Restart Ollamy, aby natychmiast wczytała nową zmienną użytkownika.
        let _ = Command::new("taskkill")
            .args(["/IM", "ollama.exe", "/F"])
            .output();
        let _ = Command::new("taskkill")
            .args(["/IM", "Ollama app.exe", "/F"])
            .output();

        if let Some(launcher) = find_ollama_windows_launcher() {
            let _ = Command::new(launcher).spawn();
        } else if let Some(bin) = can_run_ollama_cli() {
            let _ = Command::new(bin).arg("serve").spawn();
        }

        return Ok("Ustawiono OLLAMA_MODELS i zrestartowano Ollamę.".to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = trimmed;
        Err("Automatyczna konfiguracja OLLAMA_MODELS jest dostępna tylko na Windows.".to_string())
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct OllamaDiagnosis {
    pub ok: bool,
    pub code: String,
    pub message: String,
    pub suggestion: String,
}

async fn ollama_api_ok() -> bool {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    for url in [
        "http://127.0.0.1:11434/api/tags",
        "http://localhost:11434/api/tags",
    ] {
        if let Ok(r) = client.get(url).send().await {
            if r.status().is_success() {
                return true;
            }
        }
    }
    false
}

fn find_ollama_executable() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let where_out = Command::new("where")
            .arg("ollama.exe")
            .output()
            .ok()
            .filter(|o| o.status.success())?;
        let stdout = String::from_utf8_lossy(&where_out.stdout).into_owned();
        let first = stdout
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())?
            .to_string();
        return Some(PathBuf::from(first));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let which_out = Command::new("which")
            .arg("ollama")
            .output()
            .ok()
            .filter(|o| o.status.success())?;
        let stdout = String::from_utf8_lossy(&which_out.stdout).into_owned();
        let first = stdout
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())?
            .to_string();
        return Some(PathBuf::from(first));
    }
}

fn windows_ollama_dir_candidates() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
        dirs.push(Path::new(&local_app_data).join("Programs\\Ollama"));
    }
    if let Ok(user_profile) = env::var("USERPROFILE") {
        dirs.push(Path::new(&user_profile).join("AppData\\Local\\Programs\\Ollama"));
    }
    if let Ok(program_files) = env::var("ProgramFiles") {
        dirs.push(Path::new(&program_files).join("Ollama"));
    }
    if let Ok(program_files_x86) = env::var("ProgramFiles(x86)") {
        dirs.push(Path::new(&program_files_x86).join("Ollama"));
    }
    dirs
}

fn can_run_ollama_cli() -> Option<PathBuf> {
    if Command::new("ollama")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        return Some(PathBuf::from("ollama"));
    }

    if let Some(path) = find_ollama_executable() {
        if Command::new(&path)
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            return Some(path);
        }
    }

    #[cfg(target_os = "windows")]
    {
        let candidates = windows_ollama_dir_candidates()
            .into_iter()
            .map(|dir| dir.join("ollama.exe"))
            .collect::<Vec<_>>();
        for candidate in candidates {
            if candidate.exists()
                && Command::new(&candidate)
                    .arg("--version")
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false)
            {
                return Some(candidate);
            }
        }
    }

    None
}

#[cfg(target_os = "windows")]
fn find_ollama_windows_launcher() -> Option<PathBuf> {
    let candidates = windows_ollama_dir_candidates()
        .into_iter()
        .map(|dir| dir.join("Ollama app.exe"))
        .collect::<Vec<_>>();
    candidates.into_iter().find(|p| p.exists())
}

#[cfg(target_os = "windows")]
fn try_start_ollama_via_windows_shell() -> bool {
    // Fallback for installs discoverable by ShellExecute/App Paths but not PATH.
    Command::new("cmd")
        .args(["/C", "start", "", "ollama"])
        .spawn()
        .is_ok()
}

fn is_port_11434_open() -> bool {
    std::net::TcpStream::connect_timeout(
        &"127.0.0.1:11434".parse().unwrap(),
        Duration::from_millis(700),
    )
    .is_ok()
}

#[tauri::command]
pub async fn diagnose_ollama() -> Result<OllamaDiagnosis, String> {
    if ollama_api_ok().await {
        return Ok(OllamaDiagnosis {
            ok: true,
            code: "ok".to_string(),
            message: "Ollama działa poprawnie (localhost:11434).".to_string(),
            suggestion: "Możesz przejść dalej.".to_string(),
        });
    }

    let ollama_bin = can_run_ollama_cli();
    if ollama_bin.is_none() {
        #[cfg(target_os = "windows")]
        {
            if try_start_ollama_via_windows_shell() {
                for _ in 0..12 {
                    if ollama_api_ok().await {
                        return Ok(OllamaDiagnosis {
                            ok: true,
                            code: "started_via_shell".to_string(),
                            message: "Uruchomiłem Ollamę przez shell systemowy.".to_string(),
                            suggestion: "API odpowiada, możesz przejść dalej.".to_string(),
                        });
                    }
                    std::thread::sleep(Duration::from_millis(900));
                }
            }
        }

        #[cfg(target_os = "windows")]
        {
            if let Some(launcher) = find_ollama_windows_launcher() {
                let _ = Command::new(launcher).spawn();
                for _ in 0..12 {
                    if ollama_api_ok().await {
                        return Ok(OllamaDiagnosis {
                            ok: true,
                            code: "started_via_launcher".to_string(),
                            message: "Uruchomiłem Ollamę przez launcher systemowy.".to_string(),
                            suggestion: "API odpowiada, możesz przejść dalej.".to_string(),
                        });
                    }
                    std::thread::sleep(Duration::from_millis(900));
                }
                return Ok(OllamaDiagnosis {
                    ok: false,
                    code: "installed_but_not_ready".to_string(),
                    message: "Ollama wygląda na zainstalowaną, ale API nadal nie odpowiada."
                        .to_string(),
                    suggestion:
                        "Uruchom ręcznie aplikację Ollama z menu Start i po 10-15 sekundach kliknij „Sprawdź ponownie”."
                            .to_string(),
                });
            }
        }
        return Ok(OllamaDiagnosis {
            ok: false,
            code: "not_installed".to_string(),
            message: "Nie wykryto Ollamy (ani jej pliku wykonywalnego) w systemie.".to_string(),
            suggestion:
                "Zainstaluj lub przeinstaluj Ollamę. Po instalacji zamknij i uruchom ponownie EduMelon."
                    .to_string(),
        });
    }

    let _ = Command::new(ollama_bin.unwrap()).arg("serve").spawn();
    for _ in 0..10 {
        if ollama_api_ok().await {
            return Ok(OllamaDiagnosis {
                ok: true,
                code: "started".to_string(),
                message: "Uruchomiłem Ollamę automatycznie.".to_string(),
                suggestion: "API odpowiada, możesz przejść dalej.".to_string(),
            });
        }
        std::thread::sleep(Duration::from_millis(900));
    }

    if is_port_11434_open() {
        return Ok(OllamaDiagnosis {
            ok: false,
            code: "port_busy".to_string(),
            message: "Port 11434 jest zajęty przez inny proces.".to_string(),
            suggestion: "Zamknij proces używający portu 11434 i uruchom Ollamę ponownie."
                .to_string(),
        });
    }

    Ok(OllamaDiagnosis {
        ok: false,
        code: "not_running".to_string(),
        message: "Ollama jest zainstalowana, ale API nie odpowiada.".to_string(),
        suggestion: "Uruchom `ollama serve` ręcznie lub zrestartuj komputer i spróbuj ponownie."
            .to_string(),
    })
}

#[derive(Debug, Serialize, Clone)]
pub struct SystemSpecs {
    pub total_ram_gb: f64,
    pub cpu_threads: usize,
    pub gpu_names: Vec<String>,
}

#[tauri::command]
pub fn get_system_specs() -> Result<SystemSpecs, String> {
    let mut sys = System::new_all();
    sys.refresh_memory();
    sys.refresh_cpu_all();
    let total_ram_bytes = sys.total_memory();
    let total_ram_gb = (total_ram_bytes as f64) / (1024.0 * 1024.0 * 1024.0);
    let cpu_threads = sys.cpus().len();
    let gpu_names = detect_gpu_names();
    Ok(SystemSpecs {
        total_ram_gb,
        cpu_threads,
        gpu_names,
    })
}

fn detect_gpu_names() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
            ])
            .output();
        if let Ok(out) = output {
            if out.status.success() {
                let text = String::from_utf8_lossy(&out.stdout);
                let list = text
                    .lines()
                    .map(|l| l.trim())
                    .filter(|l| !l.is_empty())
                    .map(ToOwned::to_owned)
                    .collect::<Vec<_>>();
                if !list.is_empty() {
                    return list;
                }
            }
        }
    }
    Vec::new()
}
