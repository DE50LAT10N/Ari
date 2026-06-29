use once_cell::sync::Lazy;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION};
use reqwest::multipart::{Form, Part};
use reqwest::{Certificate, Client, Method};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;
use std::time::Duration;

static GIGACHAT_CLIENT: Lazy<Result<Client, String>> = Lazy::new(build_client);

fn build_client() -> Result<Client, String> {
    let mut builder = Client::builder().timeout(Duration::from_secs(120));

    #[cfg(gigachat_embedded_certs)]
    {
        for pem in [
            include_bytes!("../certs/russian_trusted_root_ca.pem").as_slice(),
            include_bytes!("../certs/russian_trusted_sub_ca.pem").as_slice(),
        ] {
            match Certificate::from_pem(pem) {
                Ok(cert) => {
                    builder = builder.add_root_certificate(cert);
                }
                Err(error) => {
                    log::warn!("GigaChat embedded CA parse failed: {error}");
                }
            }
        }
    }

    builder
        .build()
        .map_err(|error| format!("Не удалось создать HTTP-клиент GigaChat: {error}"))
}

fn client() -> Result<&'static Client, String> {
    GIGACHAT_CLIENT
        .as_ref()
        .map_err(|error| error.clone())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GigaChatHttpRequest {
    pub url: String,
    pub method: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GigaChatHttpResponse {
    pub status: u16,
    pub body: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GigaChatFileUploadRequest {
    pub url: String,
    pub authorization: String,
    pub file_name: String,
    pub file_base64: String,
    #[serde(default = "default_purpose")]
    pub purpose: String,
}

fn default_purpose() -> String {
    "general".to_string()
}

#[tauri::command]
pub async fn gigachat_upload_file(
    request: GigaChatFileUploadRequest,
) -> Result<GigaChatHttpResponse, String> {
    if !is_gigachat_url(&request.url) {
        return Err("Запрос разрешён только к доменам GigaChat/Sber.".into());
    }

    let bytes = base64_decode(&request.file_base64)?;
    let http = client()?;

    let file_part = Part::bytes(bytes)
        .file_name(request.file_name.clone())
        .mime_str("image/png")
        .map_err(|error| format!("Не удалось подготовить файл: {error}"))?;

    let form = Form::new()
        .part("file", file_part)
        .text("purpose", request.purpose);

    let response = http
        .post(&request.url)
        .header(AUTHORIZATION, request.authorization)
        .header("Accept", "application/json")
        .multipart(form)
        .send()
        .await
        .map_err(map_transport_error)?;

    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Не удалось прочитать ответ GigaChat: {error}"))?;

    Ok(GigaChatHttpResponse { status, body })
}

fn base64_decode(value: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(value.trim())
        .map_err(|error| format!("Некорректный base64 файла: {error}"))
}

#[tauri::command]
pub async fn gigachat_http_request(
    request: GigaChatHttpRequest,
) -> Result<GigaChatHttpResponse, String> {
    if !is_gigachat_url(&request.url) {
        return Err("Запрос разрешён только к доменам GigaChat/Sber.".into());
    }

    let method = Method::from_str(request.method.to_uppercase().as_str())
        .map_err(|_| format!("Неподдерживаемый HTTP-метод: {}", request.method))?;

    let mut header_map = HeaderMap::new();
    for (name, value) in request.headers {
        let header_name = HeaderName::from_str(&name)
            .map_err(|_| format!("Некорректный заголовок: {name}"))?;
        let header_value = HeaderValue::from_str(&value)
            .map_err(|_| format!("Некорректное значение заголовка: {name}"))?;
        header_map.insert(header_name, header_value);
    }

    let http = client()?;
    let mut builder = http.request(method, &request.url).headers(header_map);

    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let response = builder.send().await.map_err(map_transport_error)?;

    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Не удалось прочитать ответ GigaChat: {error}"))?;

    Ok(GigaChatHttpResponse { status, body })
}

fn is_gigachat_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    if !lower.starts_with("https://") {
        return false;
    }
    let rest = &lower["https://".len()..];
    for host in [
        "gigachat.devices.sberbank.ru",
        "ngw.devices.sberbank.ru",
        "api.giga.chat",
    ] {
        if !rest.starts_with(host) {
            continue;
        }
        match rest.chars().nth(host.len()) {
            None | Some('/') | Some(':') => return true,
            _ => continue,
        }
    }
    false
}

fn map_transport_error(error: reqwest::Error) -> String {
    let message = error.to_string();
    if message.contains("certificate")
        || message.contains("Certificate")
        || message.contains("TLS")
        || message.contains("ssl")
    {
        return format!(
            "{message}. Для GigaChat нужен корневой сертификат НУЦ Минцифры: \
            установи его в Windows (https://www.gosuslugi.ru/crt) или выполни \
            npm run fetch-gigachat-certs и пересобери приложение."
        );
    }
    message
}
