use reqwest::header::{HeaderMap, HeaderName, HeaderValue, LOCATION};
use reqwest::{redirect::Policy, Client, Method, Url};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::str::FromStr;
use std::time::Duration;

const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
const MAX_REQUEST_BODY_BYTES: usize = 256 * 1024;
const MAX_REDIRECTS: usize = 5;

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

struct ResolvedUrl {
    url: Url,
    host: String,
    addresses: Vec<SocketAddr>,
}

fn validate_fetch_url(url_str: &str) -> Result<Url, String> {
    let parsed = Url::parse(url_str.trim()).map_err(|_| "Некорректный URL.".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Разрешены только HTTP и HTTPS.".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("URL с учётными данными запрещены.".into());
    }

    let host = parsed.host_str().ok_or("URL без хоста.")?;
    let host_lower = host.to_ascii_lowercase();
    if host_lower == "localhost" || host_lower.ends_with(".localhost") {
        return Err("Запросы к localhost запрещены.".into());
    }

    let port = parsed.port_or_known_default().ok_or("URL без порта.")?;
    let expected_port = if parsed.scheme() == "https" { 443 } else { 80 };
    if port != expected_port {
        return Err("Разрешён только стандартный порт выбранного HTTP-протокола.".into());
    }

    let literal_host = host.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = literal_host.parse::<IpAddr>() {
        ensure_public_ip(ip)?;
    }

    Ok(parsed)
}

async fn resolve_public_url(url_str: &str) -> Result<ResolvedUrl, String> {
    let url = validate_fetch_url(url_str)?;
    let host = url
        .host_str()
        .ok_or("URL без хоста.")?
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    let port = url.port_or_known_default().ok_or("URL без порта.")?;
    let lookup_host = host.clone();
    let addresses = tauri::async_runtime::spawn_blocking(move || {
        (lookup_host.as_str(), port)
            .to_socket_addrs()
            .map(|items| items.collect::<Vec<_>>())
            .map_err(|error| format!("Не удалось разрешить DNS-имя: {error}"))
    })
    .await
    .map_err(|error| format!("Не удалось дождаться DNS-проверки: {error}"))??;

    if addresses.is_empty() {
        return Err("DNS не вернул ни одного адреса.".into());
    }
    for address in &addresses {
        ensure_public_ip(address.ip())?;
    }

    Ok(ResolvedUrl {
        url,
        host,
        addresses,
    })
}

fn ensure_public_ip(ip: IpAddr) -> Result<(), String> {
    if is_non_public(ip) {
        return Err(format!(
            "Запросы к локальным, приватным и служебным адресам запрещены ({ip})."
        ));
    }
    Ok(())
}

fn is_non_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let octets = v4.octets();
            v4.is_unspecified()
                || v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_multicast()
                || v4.is_broadcast()
                || octets[0] == 0
                || (octets[0] == 100 && (64..=127).contains(&octets[1]))
                || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
                || (octets[0] == 192 && octets[1] == 0 && octets[2] == 2)
                || (octets[0] == 198 && (octets[1] == 18 || octets[1] == 19))
                || (octets[0] == 198 && octets[1] == 51 && octets[2] == 100)
                || (octets[0] == 203 && octets[1] == 0 && octets[2] == 113)
                || octets[0] >= 240
        }
        IpAddr::V6(v6) => {
            let octets = v6.octets();
            v6.is_unspecified()
                || v6.is_loopback()
                || v6.is_multicast()
                || (octets[0] & 0xfe) == 0xfc
                || (octets[0] == 0xfe && (octets[1] & 0xc0) == 0x80)
                || (octets[0] == 0xfe && (octets[1] & 0xc0) == 0xc0)
                || (octets[0] == 0x20
                    && octets[1] == 0x01
                    && octets[2] == 0x0d
                    && octets[3] == 0xb8)
                || v6
                    .to_ipv4_mapped()
                    .is_some_and(|mapped| is_non_public(IpAddr::V4(mapped)))
        }
    }
}

fn build_pinned_client(resolved: &ResolvedUrl) -> Result<Client, String> {
    Client::builder()
        // A proxy would resolve the origin independently and bypass the
        // public-address validation and DNS pinning performed above.
        .no_proxy()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(20))
        .resolve_to_addrs(&resolved.host, &resolved.addresses)
        .build()
        .map_err(|error| format!("Не удалось создать защищённый HTTP-клиент: {error}"))
}

fn parse_method(value: &str) -> Result<Method, String> {
    let method = Method::from_str(value.to_uppercase().as_str())
        .map_err(|_| format!("Неподдерживаемый HTTP-метод: {value}"))?;
    if method != Method::GET && method != Method::HEAD && method != Method::POST {
        return Err("Web tool разрешает только GET, HEAD и POST.".into());
    }
    Ok(method)
}

fn parse_headers(headers: HashMap<String, String>) -> Result<HeaderMap, String> {
    let mut result = HeaderMap::new();
    for (name, value) in headers {
        let lower = name.to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "authorization"
                | "cookie"
                | "host"
                | "connection"
                | "content-length"
                | "proxy-authorization"
                | "proxy-connection"
                | "te"
                | "trailer"
                | "transfer-encoding"
                | "upgrade"
        ) {
            return Err(format!("Заголовок {name} запрещён для web tool."));
        }
        let header_name =
            HeaderName::from_str(&name).map_err(|_| format!("Некорректный заголовок: {name}"))?;
        let header_value = HeaderValue::from_str(&value)
            .map_err(|_| format!("Некорректное значение заголовка: {name}"))?;
        result.insert(header_name, header_value);
    }
    Ok(result)
}

fn is_followable_redirect(status: reqwest::StatusCode) -> bool {
    matches!(status.as_u16(), 301 | 302 | 303 | 307 | 308)
}

fn redirected_method(status: reqwest::StatusCode, method: &Method) -> Method {
    if status.as_u16() == 303
        || ((status.as_u16() == 301 || status.as_u16() == 302) && *method == Method::POST)
    {
        Method::GET
    } else {
        method.clone()
    }
}

#[tauri::command]
pub async fn http_fetch(request: HttpFetchRequest) -> Result<HttpFetchResponse, String> {
    let mut url = request.url;
    let mut method = parse_method(&request.method)?;
    let headers = parse_headers(request.headers)?;
    let mut body = request.body;
    if body
        .as_ref()
        .is_some_and(|value| value.len() > MAX_REQUEST_BODY_BYTES)
    {
        return Err(format!(
            "Тело запроса слишком большое (>{MAX_REQUEST_BODY_BYTES} байт)."
        ));
    }

    for redirect_count in 0..=MAX_REDIRECTS {
        let resolved = resolve_public_url(&url).await?;
        let http = build_pinned_client(&resolved)?;
        let mut builder = http
            .request(method.clone(), resolved.url.clone())
            .headers(headers.clone())
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
            )
            .header("Accept-Language", "ru-RU,ru;q=0.9,en;q=0.8");
        if let Some(value) = body.as_ref() {
            builder = builder.body(value.clone());
        }

        let mut response = builder
            .send()
            .await
            .map_err(|error| format!("Сетевой запрос не удался: {error}"))?;
        let status = response.status();

        if is_followable_redirect(status) {
            if redirect_count >= MAX_REDIRECTS {
                return Err("Превышен лимит безопасных перенаправлений.".into());
            }
            let location = response
                .headers()
                .get(LOCATION)
                .ok_or("Redirect без заголовка Location.")?
                .to_str()
                .map_err(|_| "Некорректный заголовок Location.".to_string())?;
            let next = resolved
                .url
                .join(location)
                .map_err(|_| "Некорректный redirect URL.".to_string())?;
            let next_method = redirected_method(status, &method);
            if next_method == Method::GET && method != Method::GET {
                body = None;
            }
            method = next_method;
            url = next.to_string();
            continue;
        }

        if response
            .content_length()
            .is_some_and(|length| length > MAX_BODY_BYTES as u64)
        {
            return Err(format!("Ответ слишком большой (>{MAX_BODY_BYTES} байт)."));
        }

        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| format!("Не удалось прочитать ответ: {error}"))?
        {
            if bytes.len() + chunk.len() > MAX_BODY_BYTES {
                return Err(format!("Ответ слишком большой (>{MAX_BODY_BYTES} байт)."));
            }
            bytes.extend_from_slice(&chunk);
        }

        return Ok(HttpFetchResponse {
            status: status.as_u16(),
            body: String::from_utf8_lossy(&bytes).into_owned(),
        });
    }

    Err("Превышен лимит безопасных перенаправлений.".into())
}

#[cfg(test)]
mod tests {
    use super::{is_non_public, parse_method, validate_fetch_url};
    use reqwest::Method;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    #[test]
    fn rejects_local_private_and_non_web_urls() {
        for url in [
            "http://localhost/test",
            "http://127.0.0.1/test",
            "http://10.0.0.1/test",
            "http://169.254.169.254/latest/meta-data",
            "http://[::1]/test",
            "file:///etc/passwd",
            "https://example.com:8443/test",
            "https://user:secret@example.com/test",
        ] {
            assert!(validate_fetch_url(url).is_err(), "accepted {url}");
        }
    }

    #[test]
    fn classifies_reserved_dns_answers_as_non_public() {
        for ip in [
            IpAddr::V4(Ipv4Addr::new(100, 64, 0, 1)),
            IpAddr::V4(Ipv4Addr::new(192, 0, 2, 1)),
            IpAddr::V4(Ipv4Addr::new(198, 18, 0, 1)),
            IpAddr::V6(Ipv6Addr::LOCALHOST),
            "fc00::1".parse().expect("ULA parses"),
            "fe80::1".parse().expect("link-local parses"),
            "::ffff:127.0.0.1".parse().expect("mapped address parses"),
        ] {
            assert!(is_non_public(ip), "accepted {ip}");
        }
        assert!(!is_non_public(IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))));
    }

    #[test]
    fn limits_generic_web_tool_methods() {
        assert_eq!(parse_method("get").expect("GET"), Method::GET);
        assert_eq!(parse_method("post").expect("POST"), Method::POST);
        assert!(parse_method("put").is_err());
        assert!(parse_method("delete").is_err());
    }
}
