use crate::gemini_store;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const GEMINI_BASE: &str = "https://generativelanguage.googleapis.com/v1beta";
const RATE_LIMIT_MSG: &str = "GEMINI_RATE_LIMIT: Wyczerpano chwilowy limit zapytań konta Google. Twój darmowy asystent musi odpocząć przez około 60 sekund. Poczekaj chwilę i spróbuj ponownie.";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeminiChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeminiImageMessage {
    pub role: String,
    pub content: String,
    pub images: Option<Vec<String>>,
    #[serde(default)]
    pub image_mime_types: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeminiChatOptionsPayload {
    pub temperature: Option<f64>,
    pub num_predict: Option<i64>,
    pub format: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiUsageMetadata {
    pub total_token_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiGenerateResult {
    pub content: String,
    pub usage_metadata: Option<GeminiUsageMetadata>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiEmbedResult {
    pub values: Vec<f64>,
    pub usage_metadata: Option<GeminiUsageMetadata>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GeminiStreamDeltaPayload {
    pub kind: String,
    pub delta: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GeminiStreamDonePayload {
    pub usage_metadata: Option<GeminiUsageMetadata>,
}

fn classify_gemini_http(status: reqwest::StatusCode, body: &str) -> String {
    if status.as_u16() == 429 {
        return RATE_LIMIT_MSG.to_string();
    }
    format!("Gemini API: {} {}", status, body)
}

fn build_generation_config(options: &Option<GeminiChatOptionsPayload>) -> serde_json::Value {
    let mut cfg = serde_json::Map::new();
    if let Some(opts) = options {
        if let Some(t) = opts.temperature {
            cfg.insert("temperature".to_string(), serde_json::json!(t));
        }
        if let Some(n) = opts.num_predict {
            cfg.insert("maxOutputTokens".to_string(), serde_json::json!(n));
        }
        if let Some(format) = &opts.format {
            cfg.insert(
                "responseMimeType".to_string(),
                serde_json::json!("application/json"),
            );
            if !format.is_string() {
                cfg.insert("responseSchema".to_string(), format.clone());
            }
        }
    }
    serde_json::Value::Object(cfg)
}

fn map_role(role: &str) -> &str {
    match role {
        "assistant" => "model",
        "system" => "user",
        _ => role,
    }
}

fn text_part(text: &str) -> serde_json::Value {
    serde_json::json!({ "text": text })
}

fn inline_image_part(mime: &str, data: &str) -> serde_json::Value {
    serde_json::json!({
        "inlineData": {
            "mimeType": mime,
            "data": data
        }
    })
}

async fn gemini_post_timed(
    app: &AppHandle,
    model: &str,
    method: &str,
    body: serde_json::Value,
    timeout_secs: u64,
) -> Result<serde_json::Value, String> {
    let key = gemini_store::get_api_key(app)?;
    let url = format!(
        "{}/models/{}:{}?key={}",
        GEMINI_BASE, model, method, key
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Gemini API [transport]: {}", e))?;

    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(classify_gemini_http(status, &text));
    }
    serde_json::from_str(&text).map_err(|e| format!("Nieprawidłowa odpowiedź Gemini: {} — {}", e, text))
}

async fn gemini_post(
    app: &AppHandle,
    model: &str,
    method: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    gemini_post_timed(app, model, method, body, 300).await
}

fn build_contents_from_text(messages: &[GeminiChatMessage]) -> (Option<serde_json::Value>, Vec<serde_json::Value>) {
    let mut system_parts: Vec<serde_json::Value> = Vec::new();
    let mut contents: Vec<serde_json::Value> = Vec::new();

    for m in messages {
        if m.role == "system" {
            system_parts.push(text_part(&m.content));
            continue;
        }
        contents.push(serde_json::json!({
            "role": map_role(&m.role),
            "parts": [ text_part(&m.content) ]
        }));
    }

    let system_instruction = if system_parts.is_empty() {
        None
    } else {
        Some(serde_json::json!({ "parts": system_parts }))
    };

    (system_instruction, contents)
}

fn build_contents_from_images(messages: &[GeminiImageMessage]) -> (Option<serde_json::Value>, Vec<serde_json::Value>) {
    let mut system_parts: Vec<serde_json::Value> = Vec::new();
    let mut contents: Vec<serde_json::Value> = Vec::new();

    for m in messages.iter() {
        if m.role == "system" {
            system_parts.push(text_part(&m.content));
            continue;
        }
        let mut parts: Vec<serde_json::Value> = Vec::new();
        if !m.content.is_empty() {
            parts.push(text_part(&m.content));
        }
        if let Some(images) = &m.images {
            for (i, img) in images.iter().enumerate() {
                let mime = m
                    .image_mime_types
                    .as_ref()
                    .and_then(|v| v.get(i))
                    .map(|s| s.as_str())
                    .unwrap_or("image/jpeg");
                parts.push(inline_image_part(mime, img));
            }
        }
        if parts.is_empty() {
            continue;
        }
        contents.push(serde_json::json!({
            "role": map_role(&m.role),
            "parts": parts
        }));
    }

    let system_instruction = if system_parts.is_empty() {
        None
    } else {
        Some(serde_json::json!({ "parts": system_parts }))
    };

    (system_instruction, contents)
}

fn extract_text_from_response(v: &serde_json::Value) -> String {
    v.get("candidates")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|c| c.get("content"))
        .and_then(|c| c.get("parts"))
        .and_then(|p| p.as_array())
        .map(|parts| {
            parts
                .iter()
                .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default()
}

fn extract_usage(v: &serde_json::Value) -> Option<GeminiUsageMetadata> {
    v.get("usageMetadata").and_then(|u| {
        serde_json::from_value::<GeminiUsageMetadata>(u.clone()).ok()
    })
}

fn build_request_body(
    system_instruction: Option<serde_json::Value>,
    contents: Vec<serde_json::Value>,
    options: &Option<GeminiChatOptionsPayload>,
) -> serde_json::Value {
    let mut body = serde_json::json!({ "contents": contents });
    if let Some(si) = system_instruction {
        body["systemInstruction"] = si;
    }
    let gen = build_generation_config(options);
    if gen.as_object().map(|o| !o.is_empty()).unwrap_or(false) {
        body["generationConfig"] = gen;
    }
    body
}

#[tauri::command]
pub async fn save_gemini_key(app: AppHandle, key: String) -> Result<(), String> {
    gemini_store::save_api_key(&app, key)
}

#[tauri::command]
pub async fn has_gemini_key(app: AppHandle) -> Result<bool, String> {
    gemini_store::has_api_key(&app)
}

#[tauri::command]
pub async fn delete_gemini_key(app: AppHandle) -> Result<(), String> {
    gemini_store::delete_api_key(&app)
}

#[tauri::command]
pub async fn test_gemini_key(app: AppHandle, model: Option<String>) -> Result<(), String> {
    let model = model.unwrap_or_else(|| "gemini-3.5-flash".to_string());
    let body = serde_json::json!({
        "contents": [{
            "role": "user",
            "parts": [{ "text": "ping" }]
        }],
        "generationConfig": { "maxOutputTokens": 8 }
    });
    let v = gemini_post(&app, &model, "generateContent", body).await?;
    if extract_text_from_response(&v).is_empty() && v.get("candidates").is_none() {
        return Err("Gemini nie zwróciło odpowiedzi testowej.".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn gemini_generate_content(
    app: AppHandle,
    model: String,
    messages: Vec<GeminiChatMessage>,
    options: Option<GeminiChatOptionsPayload>,
) -> Result<GeminiGenerateResult, String> {
    let (si, contents) = build_contents_from_text(&messages);
    let body = build_request_body(si, contents, &options);
    let v = gemini_post(&app, &model, "generateContent", body).await?;
    Ok(GeminiGenerateResult {
        content: extract_text_from_response(&v),
        usage_metadata: extract_usage(&v),
    })
}

#[tauri::command]
pub async fn gemini_generate_content_with_images(
    app: AppHandle,
    model: String,
    messages: Vec<GeminiImageMessage>,
    options: Option<GeminiChatOptionsPayload>,
) -> Result<GeminiGenerateResult, String> {
    let (si, contents) = build_contents_from_images(&messages);
    let body = build_request_body(si, contents, &options);
    let v = gemini_post(&app, &model, "generateContent", body).await?;
    Ok(GeminiGenerateResult {
        content: extract_text_from_response(&v),
        usage_metadata: extract_usage(&v),
    })
}

const MAX_PDF_BYTES: usize = 20 * 1024 * 1024;

#[tauri::command]
pub async fn gemini_generate_content_with_pdf(
    app: AppHandle,
    model: String,
    system: String,
    user: String,
    pdf_path: String,
    options: Option<GeminiChatOptionsPayload>,
) -> Result<GeminiGenerateResult, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let bytes = std::fs::read(&pdf_path)
        .map_err(|e| format!("Nie można odczytać pliku PDF: {}", e))?;
    if bytes.is_empty() {
        return Err("Plik PDF jest pusty.".to_string());
    }
    if bytes.len() > MAX_PDF_BYTES {
        return Err(format!(
            "Plik PDF jest za duży ({} MB). Maksimum to 20 MB.",
            bytes.len() / 1024 / 1024
        ));
    }
    let b64 = STANDARD.encode(bytes);

    let system_instruction = Some(serde_json::json!({
        "parts": [ text_part(&system) ]
    }));
    let contents = vec![serde_json::json!({
        "role": "user",
        "parts": [
            text_part(&user),
            inline_image_part("application/pdf", &b64)
        ]
    })];
    let body = build_request_body(system_instruction, contents, &options);
    let v = gemini_post_timed(&app, &model, "generateContent", body, 600).await?;
    Ok(GeminiGenerateResult {
        content: extract_text_from_response(&v),
        usage_metadata: extract_usage(&v),
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiBatchEmbedResult {
    pub embeddings: Vec<Vec<f64>>,
    pub usage_metadata: Option<GeminiUsageMetadata>,
}

#[tauri::command]
pub async fn gemini_batch_embed_content(
    app: AppHandle,
    model: String,
    texts: Vec<String>,
) -> Result<GeminiBatchEmbedResult, String> {
    if texts.is_empty() {
        return Ok(GeminiBatchEmbedResult {
            embeddings: vec![],
            usage_metadata: None,
        });
    }

    let key = gemini_store::get_api_key(&app)?;
    let url = format!(
        "{}/models/{}:batchEmbedContents?key={}",
        GEMINI_BASE, model, key
    );
    let model_ref = if model.starts_with("models/") {
        model.clone()
    } else {
        format!("models/{}", model)
    };
    let requests: Vec<serde_json::Value> = texts
        .iter()
        .map(|text| {
            serde_json::json!({
                "model": model_ref,
                "content": { "parts": [{ "text": text }] }
            })
        })
        .collect();
    let body = serde_json::json!({ "requests": requests });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let raw = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(classify_gemini_http(status, &raw));
    }

    let v: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("Nieprawidłowa odpowiedź Gemini: {}", e))?;
    let embeddings_arr = v
        .get("embeddings")
        .and_then(|a| a.as_array())
        .ok_or_else(|| "Brak wektorów embedding Gemini (batch).".to_string())?;

    let mut embeddings: Vec<Vec<f64>> = Vec::with_capacity(embeddings_arr.len());
    for item in embeddings_arr {
        let values = item
            .get("values")
            .and_then(|v| v.as_array())
            .ok_or_else(|| "Brak wektora w odpowiedzi batch.".to_string())?;
        let nums: Vec<f64> = values.iter().filter_map(|x| x.as_f64()).collect();
        if nums.is_empty() {
            return Err("Pusty wektor embedding Gemini.".to_string());
        }
        embeddings.push(nums);
    }

    if embeddings.len() != texts.len() {
        return Err(format!(
            "Gemini zwróciło {} embeddingów z {} żądań.",
            embeddings.len(),
            texts.len()
        ));
    }

    Ok(GeminiBatchEmbedResult {
        embeddings,
        usage_metadata: extract_usage(&v),
    })
}

#[tauri::command]
pub async fn gemini_embed_content(
    app: AppHandle,
    model: String,
    text: String,
) -> Result<GeminiEmbedResult, String> {
    let key = gemini_store::get_api_key(&app)?;
    let url = format!(
        "{}/models/{}:embedContent?key={}",
        GEMINI_BASE, model, key
    );
    let body = serde_json::json!({
        "content": { "parts": [{ "text": text }] }
    });
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client.post(&url).json(&body).send().await.map_err(|e| e.to_string())?;
    let status = res.status();
    let raw = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(classify_gemini_http(status, &raw));
    }
    let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let values = v
        .get("embedding")
        .and_then(|e| e.get("values"))
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Brak wektora embedding Gemini.".to_string())?;
    let nums: Vec<f64> = values
        .iter()
        .filter_map(|x| x.as_f64())
        .collect();
    Ok(GeminiEmbedResult {
        values: nums,
        usage_metadata: extract_usage(&v),
    })
}

#[tauri::command]
pub async fn gemini_stream_generate_content(
    app: AppHandle,
    model: String,
    messages: Vec<GeminiChatMessage>,
    options: Option<GeminiChatOptionsPayload>,
    request_id: String,
    with_images: bool,
    image_messages: Option<Vec<GeminiImageMessage>>,
) -> Result<(), String> {
    let event_delta = format!("gemini-stream-{}", request_id);
    let event_done = format!("gemini-stream-done-{}", request_id);

    let (si, contents) = if with_images {
        build_contents_from_images(image_messages.as_ref().unwrap_or(&vec![]))
    } else {
        build_contents_from_text(&messages)
    };
    let body = build_request_body(si, contents, &options);

    let key = gemini_store::get_api_key(&app)?;
    let url = format!(
        "{}/models/{}:streamGenerateContent?alt=sse&key={}",
        GEMINI_BASE, model, key
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Gemini stream [transport]: {}", e))?;

    let status = res.status();
    if !status.is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(classify_gemini_http(status, &text));
    }

    let mut stream = res.bytes_stream();
    use futures_util::StreamExt;
    let mut buffer = String::new();
    let mut last_usage: Option<GeminiUsageMetadata> = None;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Gemini stream read: {}", e))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim().to_string();
            buffer = buffer[pos + 1..].to_string();
            if line.is_empty() {
                continue;
            }
            let json_str = line.strip_prefix("data:").unwrap_or(&line).trim();
            if json_str.is_empty() || json_str == "[DONE]" {
                continue;
            }
            let v: serde_json::Value = match serde_json::from_str(json_str) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if let Some(u) = extract_usage(&v) {
                last_usage = Some(u);
            }
            let text = extract_text_from_response(&v);
            if !text.is_empty() {
                let _ = app.emit(
                    &event_delta,
                    GeminiStreamDeltaPayload {
                        kind: "content".into(),
                        delta: text,
                    },
                );
            }
        }
    }

    let _ = app.emit(
        &event_done,
        GeminiStreamDonePayload {
            usage_metadata: last_usage,
        },
    );
    Ok(())
}
