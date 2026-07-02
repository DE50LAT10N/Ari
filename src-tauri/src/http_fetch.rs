use once_cell::sync::Lazy;
use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::IpAddr;
use std::str::FromStr;
use std::time::Duration;

const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;

static HTTP_FETCH_CLIENT: Lazy<Result<Client, String>> = Lazy::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("Не удалось создать HTTP-клиент: {error}"))
});

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpFetchRequest {
    pub url: String,
    #[serde(default = "default_method")]
    pub method: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
}

fn default_method() -> String {
    "GET".to_string()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpFetchResponse {
    pub status: u16,
    pub body: String,
}

fn validate_fetch_url(url_str: &str) -> Result<String, String> {
    let parsed = reqwest::Url::parse(url_str.trim())
        .map_err(|_| "Некорректный URL.".to_string())?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err("Разрешены только HTTP и HTTPS.".into());
    }

    let host = parsed.host_str().ok_or("URL без хоста.")?;
    let host_lower = host.to_lowercase();

    if host_lower == "localhost" || host_lower.ends_with(".localhost") {
        return Err("Запросы к localhost запрещены.".into());
    }
    if host_lower == "::1" || host_lower == "[::1]" {
        return Err("Запросы к loopback запрещены.".into());
    }
    if host_lower.starts_with("127.") {
        return Err("Запросы к loopback запрещены.".into());
    }

    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_private_or_loopback(ip) {
            return Err("Запросы к локальным и приватным адресам запрещены.".into());
        }
    }

    Ok(parsed.to_string())
}

fn is_private_or_loopback(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local(),
        IpAddr::V6(v6) => v6.is_loopback(),
    }
}

#[tauri::command]
pub async fn http_fetch(request: HttpFetchRequest) -> Result<HttpFetchResponse, String> {
    let url = validate_fetch_url(&request.url)?;
    let method = Method::from_str(request.method.to_uppercase().as_str())
        .map_err(|_| format!("Неподдерживаемый HTTP-метод: {}", request.method))?;

    let http = HTTP_FETCH_CLIENT
        .as_ref()
        .map_err(|error| error.clone())?;

    let mut builder = http
        .request(method, &url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
        )
        .header("Accept-Language", "ru-RU,ru;q=0.9,en;q=0.8");
    for (name, value) in request.headers {
        builder = builder.header(name, value);
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let response = builder
        .send()
        .await
        .map_err(|error| format!("Сетевой запрос не удался: {error}"))?;

    let status = response.status().as_u16();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Не удалось прочитать ответ: {error}"))?;

    if bytes.len() > MAX_BODY_BYTES {
        return Err(format!(
            "Ответ слишком большой (>{MAX_BODY_BYTES} байт)."
        ));
    }

    let body = String::from_utf8_lossy(&bytes).into_owned();
    Ok(HttpFetchResponse { status, body })
}
