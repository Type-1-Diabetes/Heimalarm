//! Discord Rich Presence über die lokale RPC-Schnittstelle des Discord-Programms
//! (Named Pipe `\\.\pipe\discord-ipc-0` … `-9`). Offiziell erlaubt, kein Token, kein Internet.
//! Die Aktivität baut die Oberfläche (core/discord.js); hier wird nur verbunden und gesendet.
//!
//! Rahmen: u32 LE Opcode, u32 LE Länge, JSON. Opcodes: 0 Handshake, 1 Frame, 2 Close, 3 Ping, 4 Pong.

#[cfg(windows)]
use serde_json::json;
use serde_json::Value;
use std::sync::Mutex;

#[cfg(windows)]
mod pipe {
    use std::fs::{File, OpenOptions};
    use std::io::{Read, Write};

    pub struct Conn {
        pub file: File,
        pub client_id: String,
    }

    pub fn open() -> Result<File, String> {
        for i in 0..10 {
            if let Ok(f) = OpenOptions::new().read(true).write(true).open(format!(r"\\.\pipe\discord-ipc-{i}")) {
                return Ok(f);
            }
        }
        Err("Discord läuft nicht (oder ist nicht angemeldet)".into())
    }

    pub fn write(f: &mut File, op: u32, data: &str) -> Result<(), String> {
        let mut buf = Vec::with_capacity(8 + data.len());
        buf.extend_from_slice(&op.to_le_bytes());
        buf.extend_from_slice(&(data.len() as u32).to_le_bytes());
        buf.extend_from_slice(data.as_bytes());
        f.write_all(&buf).map_err(|e| format!("Discord-Status nicht gesendet ({e})"))
    }

    pub fn read(f: &mut File) -> Result<(u32, String), String> {
        let mut head = [0u8; 8];
        f.read_exact(&mut head).map_err(|e| format!("Keine Antwort von Discord ({e})"))?;
        let op = u32::from_le_bytes([head[0], head[1], head[2], head[3]]);
        let len = u32::from_le_bytes([head[4], head[5], head[6], head[7]]) as usize;
        if len > 1 << 20 {
            return Err("Antwort von Discord zu groß".into());
        }
        let mut body = vec![0u8; len];
        f.read_exact(&mut body).map_err(|e| format!("Keine Antwort von Discord ({e})"))?;
        Ok((op, String::from_utf8_lossy(&body).into_owned()))
    }
}

#[cfg(windows)]
static CONN: Mutex<Option<pipe::Conn>> = Mutex::new(None);
#[cfg(not(windows))]
static CONN: Mutex<Option<()>> = Mutex::new(None);

#[cfg_attr(not(windows), allow(dead_code))]
/// Fehlermeldung aus einer Discord-Antwort lesen (evt: "ERROR" bzw. Opcode 2).
fn discord_error(op: u32, body: &str) -> Option<String> {
    let v: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    if op == 2 || v.get("evt").and_then(Value::as_str) == Some("ERROR") {
        let msg = v.pointer("/data/message").or_else(|| v.get("message")).and_then(Value::as_str).unwrap_or("unbekannter Fehler");
        let code = v.pointer("/data/code").or_else(|| v.get("code")).and_then(Value::as_i64).unwrap_or(0);
        // Gleiche Nummern bedeuten je nach Art etwas anderes: CLOSE (op 2) = Verbindung, ERROR-Ereignis = Inhalt
        return Some(match (op, code) {
            (2, 4000) => "Application-ID ungültig – bitte prüfen".into(),
            (2, 4002) => "Zu viele Anfragen an Discord – kurz warten".into(),
            _ if msg.contains("client_id") || msg.contains("Invalid Client ID") => "Application-ID ungültig – bitte prüfen".into(),
            (_, 4000) => format!("Discord lehnt die Angaben ab ({msg}) – Bild-Namen, Knopf-Links und Texte prüfen"),
            _ => format!("Discord: {msg}"),
        });
    }
    None
}

#[cfg(windows)]
fn connect(client_id: &str) -> Result<pipe::Conn, String> {
    let mut file = pipe::open()?;
    pipe::write(&mut file, 0, &json!({ "v": 1, "client_id": client_id }).to_string())?;
    let (op, body) = pipe::read(&mut file)?;
    if let Some(e) = discord_error(op, &body) {
        return Err(e);
    }
    Ok(pipe::Conn { file, client_id: client_id.to_string() })
}

#[cfg(windows)]
fn send(conn: &mut pipe::Conn, activity: &Value) -> Result<Value, String> {
    let nonce = format!("{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    let frame = json!({ "cmd": "SET_ACTIVITY", "args": { "pid": std::process::id(), "activity": activity }, "nonce": nonce });
    pipe::write(&mut conn.file, 1, &frame.to_string())?;
    // Antworten lesen, bis die zu unserem Befehl kommt (Discord schickt evtl. vorher Ereignisse)
    for _ in 0..5 {
        let (op, body) = pipe::read(&mut conn.file)?;
        if op == 3 {
            pipe::write(&mut conn.file, 4, &body)?;
            continue;
        }
        if let Some(e) = discord_error(op, &body) {
            return Err(e);
        }
        let v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
        if v.get("nonce").and_then(Value::as_str) == Some(nonce.as_str()) {
            return Ok(v.get("data").cloned().unwrap_or(Value::Null));
        }
    }
    Ok(Value::Null)
}

#[cfg(windows)]
fn set_blocking(client_id: String, activity: Value) -> Result<Value, String> {
    let mut guard = CONN.lock().map_err(|_| "Discord-Verbindung blockiert".to_string())?;
    // Andere Application-ID: neu verbinden
    if guard.as_ref().map(|c| c.client_id != client_id).unwrap_or(false) {
        *guard = None;
    }
    for attempt in 0..2 {
        if guard.is_none() {
            *guard = Some(connect(&client_id)?);
        }
        let conn = guard.as_mut().expect("verbunden");
        match send(conn, &activity) {
            Ok(v) => return Ok(v),
            Err(e) => {
                *guard = None; // Discord neu gestartet o. Ä. → einmal neu verbinden
                if attempt == 1 || e.contains("ungültig") {
                    return Err(e);
                }
            }
        }
    }
    Err("Discord nicht erreichbar".into())
}

/// Aktivität setzen. `activity` = Discord-Activity-Objekt (details, state, timestamps, assets, buttons, type).
#[tauri::command]
pub async fn discord_set(client_id: String, activity: Value) -> Result<Value, String> {
    let id = client_id.trim().to_string();
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
        return Err("Application-ID fehlt oder ist keine Zahl".into());
    }
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || set_blocking(id, activity)).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (id, activity);
        Err("Discord-Status gibt es nur unter Windows".into())
    }
}

/// Aktivität entfernen und Verbindung schließen.
#[tauri::command]
pub async fn discord_clear() -> Result<(), String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(|| {
            let mut guard = CONN.lock().map_err(|_| "Discord-Verbindung blockiert".to_string())?;
            if let Some(conn) = guard.as_mut() {
                let _ = send(conn, &Value::Null);
            }
            *guard = None;
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        drop(CONN.lock());
        Ok(())
    }
}

/// Läuft Discord? (Pipe vorhanden)
#[tauri::command]
pub fn discord_running() -> bool {
    #[cfg(windows)]
    {
        if CONN.lock().map(|g| g.is_some()).unwrap_or(false) {
            return true;
        }
        (0..10).any(|i| std::path::Path::new(&format!(r"\\.\pipe\discord-ipc-{i}")).exists())
    }
    #[cfg(not(windows))]
    {
        false
    }
}
