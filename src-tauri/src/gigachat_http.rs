use futures_util::{
    future::{AbortHandle, Abortable},
    StreamExt,
};
use once_cell::sync::Lazy;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION};
use reqwest::multipart::{Form, Part};
use reqwest::{redirect::Policy, Certificate, Client, Method, Url};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::future::Future;
use std::str::FromStr;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::ipc::Channel;

static GIGACHAT_CLIENT: Lazy<Result<Client, String>> = Lazy::new(build_client);
static REQUEST_REGISTRY: Lazy<Mutex<RequestRegistry>> =
    Lazy::new(|| Mutex::new(RequestRegistry::default()));
const MAX_RESPONSE_BODY_BYTES: usize = 8 * 1024 * 1024;
const MAX_PRE_CANCELLED_REQUESTS: usize = 1_024;
const PRE_CANCEL_TTL: Duration = Duration::from_secs(30);

#[derive(Default)]
struct RequestRegistry {
    active: HashMap<String, AbortHandle>,
    pre_cancelled: HashMap<String, Instant>,
}

enum RegisterRequest {
    Started,
    PreCancelled,
    Duplicate,
}

impl RequestRegistry {
    fn register(
        &mut self,
        request_id: String,
        handle: AbortHandle,
        now: Instant,
    ) -> RegisterRequest {
        self.prune(now);
        if self.pre_cancelled.remove(&request_id).is_some() {
            return RegisterRequest::PreCancelled;
        }
        if self.active.contains_key(&request_id) {
            return RegisterRequest::Duplicate;
        }
        self.active.insert(request_id, handle);
        RegisterRequest::Started
    }

    fn cancel(&mut self, request_id: &str, now: Instant) -> Option<AbortHandle> {
        self.prune(now);
        if let Some(handle) = self.active.remove(request_id) {
            return Some(handle);
        }
        if self.pre_cancelled.len() >= MAX_PRE_CANCELLED_REQUESTS {
            if let Some(oldest) = self
                .pre_cancelled
                .iter()
                .min_by_key(|(_, created_at)| *created_at)
                .map(|(request_id, _)| request_id.clone())
            {
                self.pre_cancelled.remove(&oldest);
            }
        }
        self.pre_cancelled.insert(request_id.to_string(), now);
        None
    }

    fn finish(&mut self, request_id: &str) {
        self.active.remove(request_id);
    }

    fn prune(&mut self, now: Instant) {
        self.pre_cancelled
            .retain(|_, created_at| now.saturating_duration_since(*created_at) <= PRE_CANCEL_TTL);
    }
}

fn build_client() -> Result<Client, String> {
    let mut builder = Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(120));

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
    GIGACHAT_CLIENT.as_ref().map_err(|error| error.clone())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GigaChatHttpRequest {
    pub url: String,
    pub method: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    pub request_id: Option<String>,
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
    pub request_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GigaChatStreamEvent {
    pub kind: String,
    pub status: Option<u16>,
    pub data_base64: Option<String>,
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

    let request_id = request.request_id.clone();
    run_cancellable(request_id, async move {
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
        let body = read_bounded_body(response).await?;

        Ok(GigaChatHttpResponse { status, body })
    })
    .await
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
        let header_name =
            HeaderName::from_str(&name).map_err(|_| format!("Некорректный заголовок: {name}"))?;
        let header_value = HeaderValue::from_str(&value)
            .map_err(|_| format!("Некорректное значение заголовка: {name}"))?;
        header_map.insert(header_name, header_value);
    }

    let request_id = request.request_id.clone();
    run_cancellable(request_id, async move {
        let http = client()?;
        let mut builder = http.request(method, &request.url).headers(header_map);

        if let Some(body) = request.body {
            builder = builder.body(body);
        }

        let response = builder.send().await.map_err(map_transport_error)?;

        let status = response.status().as_u16();
        let body = read_bounded_body(response).await?;

        Ok(GigaChatHttpResponse { status, body })
    })
    .await
}

#[tauri::command]
pub async fn gigachat_stream_request(
    request: GigaChatHttpRequest,
    on_event: Channel<GigaChatStreamEvent>,
) -> Result<u16, String> {
    use base64::Engine;

    if !is_gigachat_url(&request.url) {
        return Err("Запрос разрешён только к доменам GigaChat/Sber.".into());
    }
    let method = Method::from_str(request.method.to_uppercase().as_str())
        .map_err(|_| format!("Неподдерживаемый HTTP-метод: {}", request.method))?;
    let mut header_map = HeaderMap::new();
    for (name, value) in request.headers {
        let header_name =
            HeaderName::from_str(&name).map_err(|_| format!("Некорректный заголовок: {name}"))?;
        let header_value = HeaderValue::from_str(&value)
            .map_err(|_| format!("Некорректное значение заголовка: {name}"))?;
        header_map.insert(header_name, header_value);
    }

    let request_id = request.request_id.clone();
    run_cancellable(request_id, async move {
        let mut builder = client()?.request(method, &request.url).headers(header_map);
        if let Some(body) = request.body {
            builder = builder.body(body);
        }
        let response = builder.send().await.map_err(map_transport_error)?;
        let status = response.status().as_u16();
        on_event
            .send(GigaChatStreamEvent {
                kind: "head".into(),
                status: Some(status),
                data_base64: None,
            })
            .map_err(|error| format!("Не удалось открыть IPC-поток GigaChat: {error}"))?;

        let mut received = 0usize;
        let mut stream = response.bytes_stream();
        while let Some(next) = stream.next().await {
            let chunk = next.map_err(map_transport_error)?;
            received = received.saturating_add(chunk.len());
            if received > 8 * 1024 * 1024 {
                return Err("Поток GigaChat превысил лимит 8 MiB.".into());
            }
            on_event
                .send(GigaChatStreamEvent {
                    kind: "chunk".into(),
                    status: None,
                    data_base64: Some(base64::engine::general_purpose::STANDARD.encode(chunk)),
                })
                .map_err(|error| format!("Не удалось передать IPC-чанк GigaChat: {error}"))?;
        }
        on_event
            .send(GigaChatStreamEvent {
                kind: "done".into(),
                status: Some(status),
                data_base64: None,
            })
            .map_err(|error| format!("Не удалось завершить IPC-поток GigaChat: {error}"))?;
        Ok(status)
    })
    .await
}

fn is_gigachat_url(url: &str) -> bool {
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };
    if parsed.scheme() != "https" || !parsed.username().is_empty() || parsed.password().is_some() {
        return false;
    }
    let Some(host) = parsed.host_str() else {
        return false;
    };
    match host.to_ascii_lowercase().as_str() {
        "gigachat.devices.sberbank.ru" | "api.giga.chat" => {
            parsed.port().is_none() || parsed.port() == Some(443)
        }
        "ngw.devices.sberbank.ru" => {
            parsed.port().is_none() || parsed.port() == Some(443) || parsed.port() == Some(9443)
        }
        _ => false,
    }
}

async fn read_bounded_body(mut response: reqwest::Response) -> Result<String, String> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BODY_BYTES as u64)
    {
        return Err(response_too_large_error());
    }

    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Не удалось прочитать ответ GigaChat: {error}"))?
    {
        append_bounded_chunk(&mut body, &chunk, MAX_RESPONSE_BODY_BYTES)?;
    }
    Ok(String::from_utf8_lossy(&body).into_owned())
}

fn append_bounded_chunk(body: &mut Vec<u8>, chunk: &[u8], limit: usize) -> Result<(), String> {
    if body.len().saturating_add(chunk.len()) > limit {
        return Err(response_too_large_error());
    }
    body.extend_from_slice(chunk);
    Ok(())
}

fn response_too_large_error() -> String {
    format!(
        "Ответ GigaChat превысил лимит {} MiB.",
        MAX_RESPONSE_BODY_BYTES / (1024 * 1024)
    )
}

async fn run_cancellable<T, F>(request_id: Option<String>, future: F) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    let Some(request_id) = request_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return future.await;
    };
    if request_id.len() > 128 {
        return Err("Некорректный идентификатор запроса GigaChat.".into());
    }

    let (abort_handle, abort_registration) = AbortHandle::new_pair();
    let registration = {
        let mut registry = REQUEST_REGISTRY
            .lock()
            .map_err(|_| "Не удалось открыть реестр запросов GigaChat.".to_string())?;
        registry.register(request_id.clone(), abort_handle, Instant::now())
    };
    match registration {
        RegisterRequest::Started => {}
        RegisterRequest::PreCancelled => return Err("Запрос GigaChat отменён.".into()),
        RegisterRequest::Duplicate => {
            return Err("Запрос GigaChat с таким идентификатором уже выполняется.".into());
        }
    }

    let result = Abortable::new(future, abort_registration).await;
    if let Ok(mut registry) = REQUEST_REGISTRY.lock() {
        registry.finish(&request_id);
    }
    match result {
        Ok(value) => value,
        Err(_) => Err("Запрос GigaChat отменён.".into()),
    }
}

#[tauri::command]
pub fn gigachat_cancel_request(request_id: String) -> Result<bool, String> {
    let request_id = request_id.trim();
    if request_id.is_empty() || request_id.len() > 128 {
        return Err("Некорректный идентификатор запроса GigaChat.".into());
    }
    let handle = REQUEST_REGISTRY
        .lock()
        .map_err(|_| "Не удалось открыть реестр запросов GigaChat.".to_string())?
        .cancel(request_id, Instant::now());
    if let Some(handle) = handle {
        handle.abort();
    }
    Ok(true)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_expected_gigachat_origins() {
        assert!(is_gigachat_url(
            "https://gigachat.devices.sberbank.ru/api/v1/models"
        ));
        assert!(is_gigachat_url(
            "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
        ));
        assert!(!is_gigachat_url(
            "https://gigachat.devices.sberbank.ru.evil.example/api"
        ));
        assert!(!is_gigachat_url(
            "https://gigachat.devices.sberbank.ru:8443/api"
        ));
        assert!(!is_gigachat_url(
            "https://gigachat.devices.sberbank.ru@evil.example/api"
        ));
    }

    #[test]
    fn bounds_non_stream_response_bodies() {
        let mut body = Vec::new();
        append_bounded_chunk(&mut body, b"1234", 5).expect("chunk within limit");
        assert!(append_bounded_chunk(&mut body, b"56", 5).is_err());
        assert_eq!(body, b"1234");
    }

    #[test]
    fn preserves_a_bounded_pre_cancel_until_request_registration() {
        let mut registry = RequestRegistry::default();
        let now = Instant::now();
        assert!(registry.cancel("request-before-register", now).is_none());

        let (handle, _registration) = AbortHandle::new_pair();
        assert!(matches!(
            registry.register("request-before-register".into(), handle, now),
            RegisterRequest::PreCancelled
        ));
        assert!(registry.active.is_empty());
        assert!(registry.pre_cancelled.is_empty());

        for index in 0..=MAX_PRE_CANCELLED_REQUESTS {
            registry.cancel(&format!("request-{index}"), now);
        }
        assert!(registry.pre_cancelled.len() <= MAX_PRE_CANCELLED_REQUESTS);
    }
}
