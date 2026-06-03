// ============================================
// Phim.tv — Tauri Backend (Rust)
// Commands + CORS Proxy Server
// ============================================

use tauri::AppHandle;

/// Exit the application gracefully
#[tauri::command]
fn exit_app(app: AppHandle) {
    println!("[App] Exit requested");
    app.exit(0);
}

/// Get the current platform string
#[tauri::command]
fn get_platform() -> String {
    #[cfg(target_os = "android")]
    { "android".to_string() }
    #[cfg(target_os = "ios")]
    { "ios".to_string() }
    #[cfg(target_os = "windows")]
    { "desktop".to_string() }
    #[cfg(target_os = "macos")]
    { "desktop".to_string() }
    #[cfg(target_os = "linux")]
    { "desktop".to_string() }
    #[cfg(not(any(target_os = "android", target_os = "ios", target_os = "windows", target_os = "macos", target_os = "linux")))]
    { "web".to_string() }
}

/// Get app version from Cargo.toml
#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Start proxy server on desktop
    #[cfg(desktop)]
    start_proxy();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            exit_app,
            get_platform,
            get_app_version
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ==================== DESKTOP: CORS Proxy Server ====================
// This proxy server bypasses CORS restrictions for HLS/DASH streams
// Running on 127.0.0.1:1420, it rewrites M3U8 URLs to use the proxy

#[cfg(desktop)]
mod desktop_proxy {
    use url::Url;
    use std::io::Read;
    use std::sync::atomic::{AtomicU64, Ordering};
    use tiny_http::{Server, Response, Header};
    use urlencoding::decode;

    const USER_AGENTS: &[&str] = &[
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    ];

    // Global request counter for round-robin User-Agent rotation
    static REQ_COUNT: AtomicU64 = AtomicU64::new(0);

    /// Add CORS headers to a response
    fn add_cors_headers(response: Response<impl Read>) -> Response<impl Read> {
        response
            .with_header(Header::from_bytes(b"Access-Control-Allow-Origin", b"*").unwrap())
            .with_header(Header::from_bytes(b"Access-Control-Allow-Headers", b"*").unwrap())
            .with_header(Header::from_bytes(b"Access-Control-Allow-Methods", b"GET, OPTIONS, HEAD").unwrap())
            .with_header(Header::from_bytes(b"Access-Control-Max-Age", b"86400").unwrap())
    }

    /// Start the proxy server in a background thread
    pub fn start() {
        std::thread::spawn(|| {
            let server = match Server::http("127.0.0.1:1420") {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[Proxy] Failed to start on 127.0.0.1:1420: {}", e);
                    return;
                }
            };

            println!("[Proxy] CORS Proxy started on 127.0.0.1:1420");

            // Build HTTP client with connection pooling
            let client = match reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(20))
                .redirect(reqwest::redirect::Policy::limited(10))
                .pool_max_idle_per_host(8)
                .tcp_keepalive(std::time::Duration::from_secs(30))
                .user_agent(USER_AGENTS[0])
                .build() {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!("[Proxy] Failed to build HTTP client: {}", e);
                        return;
                    }
                };

            for request in server.incoming_requests() {
                let count = REQ_COUNT.fetch_add(1, Ordering::Relaxed);
                let ua = USER_AGENTS[(count as usize) % USER_AGENTS.len()];

                // Handle CORS preflight
                if request.method().as_str() == "OPTIONS" {
                    let response = add_cors_headers(Response::empty(204));
                    let _ = request.respond(response);
                    continue;
                }

                // Only serve /proxy?url= requests
                let url_path = request.url().to_string();
                if !url_path.starts_with("/proxy?url=") {
                    let _ = request.respond(Response::from_string("Phim.tv CORS Proxy - Use /proxy?url=<encoded_url>")
                        .with_status_code(200));
                    continue;
                }

                // Decode and validate URL
                let encoded = &url_path["/proxy?url=".len()..];
                let decoded = match decode(encoded) {
                    Ok(v) => v.to_string(),
                    Err(_) => {
                        let _ = request.respond(
                            add_cors_headers(Response::from_string("Bad URL encoding")
                                .with_status_code(400))
                        );
                        continue;
                    }
                };

                let parsed = match Url::parse(&decoded) {
                    Ok(u) => u,
                    Err(_) => {
                        let _ = request.respond(
                            add_cors_headers(Response::from_string("Invalid URL")
                                .with_status_code(400))
                        );
                        continue;
                    }
                };

                // Security: block localhost/127.0.0.1
                if let Some(host) = parsed.host_str() {
                    if host == "127.0.0.1" || host == "localhost" || host == "::1" {
                        let _ = request.respond(
                            add_cors_headers(Response::from_string("Forbidden: localhost access blocked")
                                .with_status_code(403))
                        );
                        continue;
                    }
                }

                // Log every 50th request
                if count % 50 == 0 {
                    let display_url = if decoded.len() > 80 {
                        format!("{}...", &decoded[..80])
                    } else {
                        decoded.clone()
                    };
                    println!("[Proxy] #{} {}", count, display_url);
                }

                // Forward request
                let origin = decoded.split('/').take(3).collect::<Vec<_>>().join("/");
                let resp = client.get(&decoded)
                    .header("User-Agent", ua)
                    .header("Referer", &origin)
                    .header("Origin", &origin)
                    .header("Accept", "*/*")
                    .header("Accept-Encoding", "identity")
                    .send();

                match resp {
                    Ok(mut res) => {
                        let status = res.status().as_u16();
                        let content_type = res.headers()
                            .get("content-type")
                            .and_then(|v| v.to_str().ok())
                            .unwrap_or("application/octet-stream")
                            .to_string();

                        let is_m3u8 = decoded.contains(".m3u8") 
                            || content_type.contains("mpegurl") 
                            || content_type.contains("m3u");

                        if !is_m3u8 {
                            // Stream non-M3U8 content directly
                            let response = Response::new(
                                tiny_http::StatusCode(status),
                                vec![
                                    Header::from_bytes(b"Content-Type", content_type.as_bytes()).unwrap(),
                                    Header::from_bytes(b"Access-Control-Allow-Origin", b"*").unwrap(),
                                ],
                                res,
                                None,
                                None,
                            );
                            let _ = request.respond(response);
                            continue;
                        }

                        // M3U8: read body and rewrite relative URLs
                        let mut body = Vec::new();
                        if res.read_to_end(&mut body).is_err() {
                            let _ = request.respond(
                                add_cors_headers(Response::from_string("Failed to read M3U8 body")
                                    .with_status_code(502))
                            );
                            continue;
                        }

                        let text = String::from_utf8_lossy(&body);
                        let base_url = match Url::parse(&decoded) {
                            Ok(u) => u,
                            Err(_) => {
                                let _ = request.respond(
                                    add_cors_headers(Response::from_string("Invalid base URL")
                                        .with_status_code(400))
                                );
                                continue;
                            }
                        };

                        // Rewrite all URLs in M3U8 to go through proxy
                        let new_text = text.lines().map(|line| {
                            let line = line.trim();
                            if line.is_empty() { return String::new(); }

                            if line.starts_with('#') {
                                // Rewrite URI="" in EXT-X-KEY lines
                                if let Some(start) = line.find("URI=\"") {
                                    let start = start + 5;
                                    if let Some(end_rel) = line[start..].find('"') {
                                        let end = start + end_rel;
                                        let key_url = &line[start..end];
                                        let full = if key_url.starts_with("http") {
                                            key_url.to_string()
                                        } else {
                                            match base_url.join(key_url) {
                                                Ok(u) => u.to_string(),
                                                Err(_) => return line.to_string()
                                            }
                                        };
                                        let new_key = format!("/proxy?url={}", urlencoding::encode(&full));
                                        return line.replace(key_url, &new_key);
                                    }
                                }
                                return line.to_string();
                            }

                            // Rewrite stream/segment URLs
                            let full = if line.starts_with("http") {
                                line.to_string()
                            } else {
                                match base_url.join(line) {
                                    Ok(u) => u.to_string(),
                                    Err(_) => return String::new()
                                }
                            };

                            format!("/proxy?url={}", urlencoding::encode(&full))
                        }).collect::<Vec<_>>().join("\n");

                        let _ = request.respond(
                            Response::from_string(new_text)
                                .with_header(Header::from_bytes(b"Content-Type", b"application/vnd.apple.mpegurl").unwrap())
                                .with_header(Header::from_bytes(b"Access-Control-Allow-Origin", b"*").unwrap())
                                .with_header(Header::from_bytes(b"Access-Control-Allow-Headers", b"*").unwrap())
                                .with_header(Header::from_bytes(b"Access-Control-Allow-Methods", b"GET, OPTIONS, HEAD").unwrap())
                        );
                    }
                    Err(e) => {
                        eprintln!("[Proxy] Error fetching {}: {}", &decoded[..decoded.len().min(80)], e);
                        let _ = request.respond(
                            add_cors_headers(
                                Response::from_string(format!("Proxy error: {}", e))
                                    .with_status_code(502)
                            )
                        );
                    }
                }
            }
        });
    }
}

#[cfg(desktop)]
fn start_proxy() {
    desktop_proxy::start();
}