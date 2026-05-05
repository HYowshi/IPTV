#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    start_proxy();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![exit_app]) 
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

use url::Url;
use std::io::Read;
use tiny_http::{Server, Response, Header};
use urlencoding::decode;

fn start_proxy() {
    std::thread::spawn(|| {
        let server = Server::http("127.0.0.1:1420").unwrap();

        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .unwrap();

        for request in server.incoming_requests() {
                if request.method().as_str() == "OPTIONS" {
                    let _ = request.respond(
                        Response::empty(204)
                            .with_header(Header::from_bytes(b"Access-Control-Allow-Origin", b"*").unwrap())
                            .with_header(Header::from_bytes(b"Access-Control-Allow-Headers", b"*").unwrap())
                            .with_header(Header::from_bytes(b"Access-Control-Allow-Methods", b"GET, OPTIONS").unwrap())
                    );
                    continue;
                }

                let url = request.url().to_string();

            if !url.starts_with("/proxy?url=") {
                let _ = request.respond(
                    Response::from_string("Not found").with_status_code(404)
                );
                continue;
            }

            let encoded = url.strip_prefix("/proxy?url=").unwrap();
            let decoded = match decode(&encoded) {
                Ok(v) => v.to_string(),
                Err(_) => {
                    let _ = request.respond(Response::from_string("Bad URL").with_status_code(400));
                    continue;
                }
            };

            let parsed = match Url::parse(&decoded) {
                Ok(u) => u,
                Err(_) => {
                    let _ = request.respond(Response::from_string("Invalid URL").with_status_code(400));
                    continue;
                }
            };

            if let Some(host) = parsed.host_str() {
                if host == "127.0.0.1" || host == "localhost" {
                    let _ = request.respond(Response::from_string("Forbidden").with_status_code(403));
                    continue;
                }
            }

            println!("Proxy: {}", decoded);

            let origin = decoded.split('/').take(3).collect::<Vec<_>>().join("/");

            let resp = client.get(&decoded)
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
                .header("Referer", &origin)
                .header("Origin", &origin)
                .header("Accept", "*/*")
                .header("Accept-Encoding", "identity")
                .header("Connection", "keep-alive")
                .send();

            if let Ok(mut res) = resp {
                let status = res.status().as_u16();
                let content_type = res.headers()
                    .get("content-type")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("application/octet-stream")
                    .to_string();

                let is_m3u8 = decoded.contains(".m3u8") || content_type.contains("mpegurl");

                if !is_m3u8 {
                    let response = Response::new(
                        tiny_http::StatusCode(status),
                        vec![
                            Header::from_bytes(
                                b"Content-Type",
                                content_type.as_bytes()
                            ).unwrap(),
                            Header::from_bytes(
                                b"Access-Control-Allow-Origin",
                                b"*"
                            ).unwrap(),
                        ],
                        res,
                        None,
                        None,
                    );

                    let _ = request.respond(response);
                    continue;
                }

                    // 👉 từ đây chắc chắn là m3u8 → PHẢI đọc body
                    let mut body = Vec::new();
                    if res.read_to_end(&mut body).is_err() {
                        let _ = request.respond(
                            Response::from_string("Read error").with_status_code(500)
                        );
                        continue;
                    }

                    let text = String::from_utf8_lossy(&body);

                    let base_url = match Url::parse(&decoded) {
                        Ok(u) => u,
                        Err(_) => {
                            let _ = request.respond(
                                Response::from_string("Invalid URL").with_status_code(400)
                            );
                            continue;
                        }
                    };

                    let new_text = text.lines().map(|line| {
                        let line = line.trim();

                        if line.is_empty() {
                            return "".to_string();
                        }

                        if line.starts_with("#") {
                            if let Some(start) = line.find("URI=\"") {
                                let start = start + 5;
                                if let Some(end_rel) = line[start..].find('"') {
                                    let end = start + end_rel;
                                    let key_url = &line[start..end];

                                    let full = if key_url.starts_with("http://") || key_url.starts_with("https://") {
                                        key_url.to_string()
                                    } else {
                                        match base_url.join(key_url) {
                                            Ok(u) => u.to_string(),
                                            Err(_) => return line.to_string()
                                        }
                                    };

                                    let new_key = format!(
                                        "/proxy?url={}",
                                        urlencoding::encode(&full)
                                    );

                                    return line.replace(key_url, &new_key);
                                }
                            }
                            return line.to_string();
                        }

                        let full = if line.starts_with("http") {
                            line.to_string()
                        } else {
                            match base_url.join(line) {
                                Ok(u) => u.to_string(),
                                Err(_) => return "".to_string()
                            }
                        };

                        format!(
                            "/proxy?url={}",
                            urlencoding::encode(&full)
                        )
                    }).collect::<Vec<_>>().join("\n");

                    let _ = request.respond(
                        Response::from_string(new_text)
                            .with_header(Header::from_bytes(b"Content-Type", b"application/vnd.apple.mpegurl").unwrap())
                            .with_header(Header::from_bytes(b"Access-Control-Allow-Origin", b"*").unwrap())
                            .with_header(Header::from_bytes(b"Access-Control-Allow-Headers", b"*").unwrap())
                            .with_header(Header::from_bytes(b"Access-Control-Allow-Methods", b"GET, OPTIONS").unwrap())
                    );
            } else {
                let _ = request.respond(
                    Response::from_string("Error").with_status_code(500)
                );
            }
        }
    });
}