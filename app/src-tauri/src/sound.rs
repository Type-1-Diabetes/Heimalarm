//! D5 – Alarmton nativ (Windows). Spielt auch, wenn das Fenster versteckt ist und die WebView
//! gedrosselt wird. Eigener Ton: Datei im App-Ordner `sounds/`, sonst der eingebaute Melder-Zweiklang.
//! Dazu: Windows-Lautstärke lesen und bei Alarm anheben (Stummschaltung aufheben).
use serde::Serialize;
use std::path::PathBuf;
use tauri::Manager;

/// Ordner für eigene Alarmtöne (wird angelegt).
fn sounds_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("sounds");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Nur einfache Dateinamen zulassen (kein Pfad, keine versteckten Dateien).
fn clean_name(name: &str) -> Result<String, String> {
    let base: String = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .chars()
        .map(|c| if c.is_alphanumeric() || " ._-()".contains(c) { c } else { '_' })
        .collect();
    let base = base.trim().trim_start_matches('.').to_string();
    let ext = base.rsplit('.').next().unwrap_or("").to_lowercase();
    if base.is_empty() || !["mp3", "wav", "ogg", "flac"].contains(&ext.as_str()) {
        return Err("Bitte eine MP3-, WAV-, OGG- oder FLAC-Datei wählen".into());
    }
    Ok(base)
}

/// Eigenen Ton speichern. Die Datei kommt als Rohdaten, der Name in der Kopfzeile `name`.
#[tauri::command]
pub fn sound_save(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("Keine Datei empfangen".into());
    };
    if data.len() > 15 * 1024 * 1024 {
        return Err("Datei ist zu groß (höchstens 15 MB)".into());
    }
    let raw = request.headers().get("name").and_then(|v| v.to_str().ok()).unwrap_or("");
    let name = clean_name(&urlish_decode(raw))?;
    std::fs::write(sounds_dir(&app)?.join(&name), data).map_err(|e| e.to_string())?;
    Ok(name)
}

/// Dateiname wird von der Oberfläche mit encodeURIComponent geschickt (Umlaute in Kopfzeilen).
fn urlish_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Some(v) = s.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[tauri::command]
pub fn sound_list(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let mut list: Vec<String> = std::fs::read_dir(sounds_dir(&app)?)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|n| clean_name(n).is_ok())
        .collect();
    list.sort();
    Ok(list)
}

#[tauri::command]
pub fn sound_delete(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let name = clean_name(&name)?;
    std::fs::remove_file(sounds_dir(&app)?.join(name)).map_err(|e| e.to_string())
}

/// Ton abspielen: `file` leer = Melder-Zweiklang. `volume` 0–100. `ms` = höchstens so lange (0 = Dauerschleife bis `sound_stop`).
#[tauri::command]
pub fn sound_play(app: tauri::AppHandle, file: Option<String>, volume: u8, ms: u64) -> Result<(), String> {
    let path = match file.filter(|f| !f.is_empty()) {
        Some(f) => {
            let p = sounds_dir(&app)?.join(clean_name(&f)?);
            if !p.exists() {
                return Err("Ton-Datei fehlt – Melder-Ton wird genutzt".into());
            }
            Some(p)
        }
        None => None,
    };
    player::send(player::Cmd::Play { path, volume: f32::from(volume.min(100)) / 100.0, ms })
}

#[tauri::command]
pub fn sound_stop() -> Result<(), String> {
    player::send(player::Cmd::Stop)
}

#[derive(Serialize, Default)]
pub struct SystemVolume {
    /// 0–100
    level: u8,
    muted: bool,
    supported: bool,
}

/// Lautstärke des Standard-Ausgabegeräts von Windows.
#[tauri::command]
pub fn system_volume() -> Result<SystemVolume, String> {
    #[cfg(target_os = "windows")]
    {
        let (level, muted) = endpoint::get()?;
        Ok(SystemVolume { level, muted, supported: true })
    }
    #[cfg(not(target_os = "windows"))]
    Ok(SystemVolume::default())
}

/// Windows-Lautstärke setzen (`level` 0–100) und/oder Stummschaltung ändern.
#[tauri::command]
pub fn system_volume_set(level: Option<u8>, muted: Option<bool>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return endpoint::set(level, muted);
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (level, muted);
        Ok(())
    }
}

#[cfg(target_os = "windows")]
mod endpoint {
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

    fn volume() -> Result<IAudioEndpointVolume, String> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let en: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| e.message().to_string())?;
            let dev = en.GetDefaultAudioEndpoint(eRender, eConsole).map_err(|_| "Kein Lautsprecher gefunden".to_string())?;
            dev.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None).map_err(|e| e.message().to_string())
        }
    }

    pub fn get() -> Result<(u8, bool), String> {
        let v = volume()?;
        unsafe {
            let level = v.GetMasterVolumeLevelScalar().map_err(|e| e.message().to_string())?;
            let muted = v.GetMute().map_err(|e| e.message().to_string())?.as_bool();
            Ok(((level * 100.0).round() as u8, muted))
        }
    }

    pub fn set(level: Option<u8>, muted: Option<bool>) -> Result<(), String> {
        let v = volume()?;
        unsafe {
            if let Some(l) = level {
                v.SetMasterVolumeLevelScalar(f32::from(l.min(100)) / 100.0, std::ptr::null()).map_err(|e| e.message().to_string())?;
            }
            if let Some(m) = muted {
                v.SetMute(m, std::ptr::null()).map_err(|e| e.message().to_string())?;
            }
        }
        Ok(())
    }
}

/// Wiedergabe in einem eigenen Thread (der Ausgabe-Stream darf den Thread nicht wechseln).
mod player {
    use std::path::PathBuf;
    use std::sync::mpsc::{channel, Sender};
    use std::sync::{Mutex, OnceLock};

    pub enum Cmd {
        Play { path: Option<PathBuf>, volume: f32, ms: u64 },
        Stop,
    }

    static TX: OnceLock<Mutex<Sender<Cmd>>> = OnceLock::new();

    pub fn send(cmd: Cmd) -> Result<(), String> {
        let tx = TX.get_or_init(|| {
            let (tx, rx) = channel::<Cmd>();
            std::thread::Builder::new()
                .name("heimalarm-ton".into())
                .spawn(move || run(rx))
                .expect("Ton-Thread");
            Mutex::new(tx)
        });
        tx.lock().map_err(|e| e.to_string())?.send(cmd).map_err(|_| "Ton-Ausgabe nicht verfügbar".to_string())
    }

    #[cfg(target_os = "windows")]
    fn run(rx: std::sync::mpsc::Receiver<Cmd>) {
        use rodio::{Decoder, OutputStream, Sink, Source};
        use std::time::Duration;

        let mut out: Option<(OutputStream, rodio::OutputStreamHandle)> = None;
        let mut sink: Option<Sink> = None;
        while let Ok(cmd) = rx.recv() {
            if let Some(s) = sink.take() {
                s.stop();
            }
            let Cmd::Play { path, volume, ms } = cmd else { continue };
            // Ausgabegerät jedes Mal neu öffnen, falls inzwischen gewechselt (z. B. Kopfhörer)
            out = OutputStream::try_default().ok().or(out);
            let Some((_, handle)) = out.as_ref() else { continue };
            let Ok(s) = Sink::try_new(handle) else { continue };
            s.set_volume(volume);
            let limit = |src: Box<dyn Source<Item = f32> + Send>| -> Box<dyn Source<Item = f32> + Send> {
                if ms > 0 { Box::new(src.take_duration(Duration::from_millis(ms))) } else { src }
            };
            let file = path.and_then(|p| std::fs::File::open(p).ok()).and_then(|f| Decoder::new(std::io::BufReader::new(f)).ok());
            match file {
                Some(dec) => s.append(limit(Box::new(dec.convert_samples::<f32>().buffered().repeat_infinite()))),
                None => s.append(limit(Box::new(super::melder().repeat_infinite()))),
            }
            sink = Some(s);
        }
    }

    #[cfg(not(target_os = "windows"))]
    fn run(rx: std::sync::mpsc::Receiver<Cmd>) {
        while rx.recv().is_ok() {}
    }
}

/// Eingebauter Ton: Zweiklang 880/660 Hz wie ein Melder, 3 s je Durchlauf (1,8 s Ton, Pause).
#[cfg(target_os = "windows")]
fn melder() -> rodio::buffer::SamplesBuffer<f32> {
    const RATE: u32 = 44_100;
    let total = (RATE as f32 * 3.0) as usize;
    let mut buf = Vec::with_capacity(total);
    for i in 0..total {
        let t = i as f32 / RATE as f32;
        let in_cycle = t % 0.6;
        let sample = if t < 1.8 && (in_cycle < 0.28 || (0.3..0.58).contains(&in_cycle)) {
            let f = if in_cycle < 0.3 { 880.0 } else { 660.0 };
            let edge = (in_cycle % 0.3).min(0.28 - (in_cycle % 0.3)).clamp(0.0, 0.01) / 0.01;   // weiche Flanken
            let sq = if (t * f).fract() < 0.5 { 1.0 } else { -1.0 };
            sq * 0.35 * edge
        } else {
            0.0
        };
        buf.push(sample);
    }
    rodio::buffer::SamplesBuffer::new(1, RATE, buf)
}
