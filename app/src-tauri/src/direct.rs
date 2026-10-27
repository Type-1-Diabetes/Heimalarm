//! Direktverbindung ohne Zentrale: Der PC nimmt Alarme und Einstellungen vom Handy im Heimnetz an.
//! Minimaler HTTP-Empfänger (nur Heimnetz), Kopfzeile X-Heimalarm-Key:
//!   Kopplungscode (am PC angezeigt): GET /ping, POST /pair  → liefert einen eigenen Code für dieses Handy
//!   Eigener Code des Handys:          GET /ping, POST /alarm, GET /config, POST /config,
//!                                     GET /events?since=N (wartet bis 25 s auf Neues vom PC), POST /event
//!   aPager-Webhook (Schlüssel im Pfad): GET|POST /apager/<schlüssel>?keyword=&unit=[&event=]
//! Ein Handy entkoppeln = seinen Code aus der Liste nehmen (direct_server erneut aufrufen).
use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Default)]
struct Keys {
    pairing: String,
    phones: Vec<String>,
    name: String,
    config: String,
    hook: String,
}

static KEYS: OnceLock<Mutex<Keys>> = OnceLock::new();
static STARTED: OnceLock<u16> = OnceLock::new();

// ── Live-Ereignisse PC → Handy (lange Abfrage) ─────────────────────────────
// Das Handy fragt GET /events?since=<rev>. Gibt es nichts Neues, wartet der PC bis zu 25 s
// und antwortet sofort, sobald etwas kommt (Einstellungen geändert, Antwort „Ich fahre“ …).
struct Events { rev: u64, list: Vec<(u64, String)> }
static EVENTS: OnceLock<(Mutex<Events>, Condvar)> = OnceLock::new();
fn events() -> &'static (Mutex<Events>, Condvar) {
    EVENTS.get_or_init(|| (Mutex::new(Events { rev: 0, list: Vec::new() }), Condvar::new()))
}
fn wait_events(since: Option<u64>) -> String {
    let (lock, cv) = events();
    let mut ev = match lock.lock() { Ok(e) => e, Err(_) => return r#"{"rev":0,"events":[]}"#.into() };
    // Erster Aufruf oder PC neu gestartet: nur den Stand melden
    let since = match since { Some(n) if n <= ev.rev => n, _ => return format!(r#"{{"rev":{},"events":[]}}"#, ev.rev) };
    let until = Instant::now() + Duration::from_secs(25);
    while ev.rev == since {
        let left = until.saturating_duration_since(Instant::now());
        if left.is_zero() { break; }
        ev = match cv.wait_timeout(ev, left) { Ok((e, _)) => e, Err(_) => return r#"{"rev":0,"events":[]}"#.into() };
    }
    let items: Vec<&str> = ev.list.iter().filter(|(r, _)| *r > since).map(|(_, j)| j.as_str()).collect();
    format!(r#"{{"rev":{},"events":[{}]}}"#, ev.rev, items.join(","))
}

/// Ereignis an alle wartenden Handys (JSON-Objekt). Die letzten 50 bleiben für kurze Lücken.
#[tauri::command]
pub fn direct_push(json: String) -> Result<(), String> {
    if !json.trim_start().starts_with('{') { return Err("Daten vom Handy nicht lesbar".into()); }
    let (lock, cv) = events();
    let mut ev = lock.lock().map_err(|e| e.to_string())?;
    ev.rev += 1;
    let rev = ev.rev;
    ev.list.push((rev, json));
    if ev.list.len() > 50 { ev.list.remove(0); }
    cv.notify_all();
    Ok(())
}

fn keys() -> &'static Mutex<Keys> {
    KEYS.get_or_init(|| Mutex::new(Keys::default()))
}

/// IP-Adresse dieses Geräts im Heimnetz (ohne dass etwas gesendet wird).
pub fn local_ip() -> String {
    UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| s.connect("192.168.0.1:9").map(|_| s))
        .and_then(|s| s.local_addr())
        .map(|a| a.ip().to_string())
        .unwrap_or_default()
}

/// Zufälliger 8-stelliger Code (ohne zusätzliche Abhängigkeit).
fn new_code() -> String {
    let mut h = RandomState::new().build_hasher();
    h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    format!("{:08}", h.finish() % 100_000_000)
}

fn esc(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

fn reply(stream: &mut TcpStream, code: &str, body: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 {code}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
}

// ── Schutz gegen Durchprobieren ───────────────────────────────────────────
// Nach MAX_FAILS falschen Codes von einer Adresse ist sie für LOCK gesperrt.
// Koppeln (POST /pair) geht nur, solange am PC „Koppeln erlauben“ läuft.
const MAX_FAILS: u32 = 10;
/// Größter Body eines gekoppelten Handys (Einstellungen mit Logbuch und Protokollen).
const BODY_MAX: usize = 8_388_608;
/// Gleichzeitige Verbindungen (wartende /events-Abfragen eingeschlossen).
const MAX_CONN: usize = 64;
static CONN: AtomicUsize = AtomicUsize::new(0);
const LOCK: Duration = Duration::from_secs(300);
static FAILS: OnceLock<Mutex<HashMap<IpAddr, (u32, Instant)>>> = OnceLock::new();
static PAIR_UNTIL: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();

fn fails() -> &'static Mutex<HashMap<IpAddr, (u32, Instant)>> {
    FAILS.get_or_init(|| Mutex::new(HashMap::new()))
}
fn locked(ip: IpAddr) -> bool {
    let mut f = match fails().lock() {
        Ok(f) => f,
        Err(_) => return true,
    };
    let (n, since) = match f.get(&ip) {
        Some(&entry) => entry,
        None => return false,
    };
    if since.elapsed() > LOCK {
        f.remove(&ip);
        return false;
    }
    n >= MAX_FAILS
}
/// Vergleich in fester Zeit: Die Antwortzeit verrät nicht, wie viele Zeichen eines Schlüssels stimmen.
fn same(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |d, (x, y)| d | (x ^ y)) == 0
}
fn record_fail(ip: IpAddr) {
    if let Ok(mut f) = fails().lock() {
        if f.len() > 1_000 { f.retain(|_, (_, since)| since.elapsed() <= LOCK); }
        let e = f.entry(ip).or_insert((0, Instant::now()));
        e.0 += 1;
        e.1 = Instant::now();
    }
}
fn pairing_open() -> bool {
    PAIR_UNTIL.get_or_init(|| Mutex::new(None)).lock().map(|u| u.map_or(false, |t| Instant::now() < t)).unwrap_or(false)
}

fn handle(app: &AppHandle, mut stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
    let _ = stream.set_nodelay(true);
    let ip = match stream.peer_addr() { Ok(a) => a.ip(), Err(_) => return };
    if locked(ip) {
        return reply(&mut stream, "429 Too Many Requests", r#"{"ok":false,"error":"Zu viele falsche Versuche – 5 Minuten warten"}"#);
    }
    let mut reader = BufReader::new(match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    });
    let mut line = String::new();
    if reader.read_line(&mut line).is_err() {
        return;
    }
    let mut parts = line.split_whitespace();
    let (method, path) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    let (mut len, mut got_key) = (0usize, String::new());
    loop {
        let mut h = String::new();
        if reader.read_line(&mut h).is_err() || h.trim().is_empty() {
            break;
        }
        let lower = h.to_ascii_lowercase();
        if let Some(v) = lower.strip_prefix("content-length:") {
            len = v.trim().parse().unwrap_or(0).min(BODY_MAX);
        } else if lower.starts_with("x-heimalarm-key:") {
            got_key = h[16..].trim().to_string();
        }
    }
    // Den Body erst lesen, wenn der Schlüssel stimmt (sonst könnte jeder im WLAN bis zu 8 MB schicken).
    let read_body = |reader: &mut BufReader<TcpStream>, max: usize| -> String {
        let mut body = vec![0u8; len.min(max)];
        let _ = reader.read_exact(&mut body);
        String::from_utf8_lossy(&body).to_string()
    };

    // aPager-PRO-Webhook direkt an diesen PC: /apager/<schlüssel>?keyword=..&unit=..[&event=recall|clear]
    // (aPager auf dem Handy ruft die Adresse selbst auf – geht ohne Zentrale, solange das Handy im WLAN ist)
    if let Some(rest) = path.strip_prefix("/apager/") {
        let (key, query) = rest.split_once('?').unwrap_or((rest, ""));
        let hook = keys().lock().map(|k| k.hook.clone()).unwrap_or_default();
        if hook.is_empty() || !same(key, &hook) {
            record_fail(ip);
            let _ = read_body(&mut reader, 4_096);   // kleinen Rest lesen, damit die Antwort ankommt
            return reply(&mut stream, "403 Forbidden", r#"{"ok":false,"error":"Schlüssel falsch"}"#);
        }
        let body = read_body(&mut reader, 100_000);
        let _ = app.emit("direct-webhook", format!("{query}\n{body}"));
        return reply(&mut stream, "200 OK", r#"{"ok":true}"#);
    }

    let (pairing, phone, name, config) = {
        let k = match keys().lock() {
            Ok(k) => k,
            Err(_) => return,
        };
        let pairing = !got_key.is_empty() && same(&got_key, &k.pairing);
        let phone = !got_key.is_empty() && k.phones.iter().any(|c| same(&got_key, c));
        (pairing, phone, k.name.clone(), k.config.clone())
    };
    if !pairing && !phone {
        record_fail(ip);
        let _ = read_body(&mut reader, 4_096);
        return reply(&mut stream, "403 Forbidden", r#"{"ok":false,"error":"Code falsch"}"#);
    }
    if phone {
        let _ = app.emit("direct-seen", got_key.clone());
    }
    // Koppeln schickt nur Name und ID; gekoppelte Handys dürfen große Einstellungen (Logbuch, Protokolle) senden.
    let body = read_body(&mut reader, if phone { BODY_MAX } else { 4_096 });
    match (method, path) {
        ("GET", "/ping") => reply(
            &mut stream,
            "200 OK",
            &format!(r#"{{"ok":true,"app":"heimalarm","name":"{}","paired":{}}}"#, esc(&name), phone),
        ),
        ("POST", "/pair") if !pairing_open() => {
            reply(&mut stream, "403 Forbidden", r#"{"ok":false,"error":"Koppeln am PC erlauben"}"#)
        }
        ("POST", "/pair") => {
            let code = new_code();
            if let Ok(mut k) = keys().lock() {
                k.phones.push(code.clone());
            }
            // Nur id und name übernehmen (gekürzt), statt den Body ungeprüft ins Ereignis zu kopieren
            let info: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
            let field = |k: &str| info.get(k).and_then(|v| v.as_str()).map(|v| v.chars().take(64).collect::<String>());
            let event = serde_json::json!({ "code": code, "info": { "id": field("id"), "name": field("name") } });
            let _ = app.emit("direct-pair", event.to_string());
            reply(&mut stream, "200 OK", &format!(r#"{{"ok":true,"code":"{code}","name":"{}"}}"#, esc(&name)));
        }
        ("POST", "/alarm") if phone => {
            let _ = app.emit("direct-alarm", body);
            reply(&mut stream, "200 OK", r#"{"ok":true}"#);
        }
        ("GET", p) if phone && p.starts_with("/events") => {
            let since = p.split_once("since=").and_then(|(_, v)| v.split('&').next()).and_then(|v| v.parse::<u64>().ok());
            let body = wait_events(since);
            reply(&mut stream, "200 OK", &body);
        }
        ("POST", "/event") if phone => {
            let _ = app.emit("direct-event", body);
            reply(&mut stream, "200 OK", r#"{"ok":true}"#);
        }
        ("GET", "/config") if phone => reply(&mut stream, "200 OK", if config.is_empty() { "{}" } else { &config }),
        ("POST", "/config") if phone => {
            let _ = app.emit("direct-config", body);
            reply(&mut stream, "200 OK", r#"{"ok":true}"#);
        }
        (_, "/alarm" | "/config" | "/event") => reply(&mut stream, "403 Forbidden", r#"{"ok":false,"error":"Nicht gekoppelt"}"#),
        _ => reply(&mut stream, "404 Not Found", r#"{"ok":false}"#),
    }
}

/// Empfänger starten (einmalig) bzw. Codes und Namen ändern. Liefert die eigene IP.
/// `code` = Kopplungscode, `phones` = eigene Codes der gekoppelten Handys.
#[tauri::command]
pub fn direct_server(app: AppHandle, port: u16, code: String, phones: Option<Vec<String>>, name: Option<String>, hook: Option<String>) -> Result<String, String> {
    {
        let mut k = keys().lock().map_err(|e| e.to_string())?;
        k.hook = hook.unwrap_or_default();
        k.pairing = code;
        k.phones = phones.unwrap_or_default();
        k.name = name.unwrap_or_default();
    }
    if STARTED.get().is_none() {
        let listener = TcpListener::bind(("0.0.0.0", port)).map_err(|e| format!("Port {port} belegt: {e}"))?;
        let _ = STARTED.set(port);
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                if CONN.fetch_add(1, Ordering::SeqCst) >= MAX_CONN {
                    CONN.fetch_sub(1, Ordering::SeqCst);
                    continue;   // zu viele offene Verbindungen: diese sofort schließen
                }
                let app = app.clone();
                std::thread::spawn(move || {
                    handle(&app, stream);
                    CONN.fetch_sub(1, Ordering::SeqCst);
                });
            }
        });
    }
    Ok(local_ip())
}

/// Koppeln für `minutes` Minuten erlauben (0 = sofort beenden).
#[tauri::command]
pub fn direct_pairing(minutes: u64) -> Result<(), String> {
    let mut u = PAIR_UNTIL.get_or_init(|| Mutex::new(None)).lock().map_err(|e| e.to_string())?;
    *u = if minutes == 0 { None } else { Some(Instant::now() + Duration::from_secs(minutes * 60)) };
    Ok(())
}

/// Aktuellen Stand der Einstellungen hinterlegen, den Handys mit GET /config abholen.
#[tauri::command]
pub fn direct_set_config(json: String) -> Result<(), String> {
    keys().lock().map_err(|e| e.to_string())?.config = json;
    Ok(())
}
