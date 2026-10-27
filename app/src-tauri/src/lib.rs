//! Rust-Kern von Heimalarm: nur das, was die Web-Oberfläche nicht selbst kann.

#[cfg(target_os = "windows")]
mod win {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Output};
    const NO_WINDOW: u32 = 0x0800_0000;

    pub fn spawn(prog: &str, args: &[&str]) -> Result<(), String> {
        Command::new(prog).args(args).creation_flags(NO_WINDOW).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
    pub fn output(prog: &str, args: &[&str]) -> Result<Output, String> {
        Command::new(prog).args(args).creation_flags(NO_WINDOW).output().map_err(|e| e.to_string())
    }
}

/// D1 – PC-Aktion nach der Abfrage "Fährst du?".
#[tauri::command]
fn pc_action(action: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use win::spawn;
        match action.as_str() {
            "hibernate" => spawn("shutdown", &["/h"]),
            // Ist der Ruhezustand aktiv, legt SetSuspendState den PC ebenfalls in den Ruhezustand.
            "sleep" => spawn("rundll32.exe", &["powrprof.dll,SetSuspendState", "0,1,0"]),
            "lock" => spawn("rundll32.exe", &["user32.dll,LockWorkStation"]),
            "shutdown" => spawn("shutdown", &["/s", "/t", "0"]),
            // Sanft herunterfahren; hängt ein Programm, nach 120 s Ruhezustand.
            "mixed" => {
                spawn("shutdown", &["/s", "/t", "0"])?;
                std::thread::spawn(|| {
                    std::thread::sleep(std::time::Duration::from_secs(120));
                    let _ = spawn("shutdown", &["/h"]);
                });
                Ok(())
            }
            "none" => Ok(()),
            other => Err(format!("Unbekannte Aktion: {other}")),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = action;
        Err("Nur unter Windows verfügbar".into())
    }
}

/// D7 – Welche der angegebenen Programme (z. B. "obs64.exe") laufen gerade?
#[tauri::command]
fn running_processes(names: Vec<String>) -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    {
        let out = win::output("tasklist", &["/fo", "csv", "/nh"])?;
        let list = String::from_utf8_lossy(&out.stdout).to_lowercase();
        Ok(names.into_iter().filter(|n| list.contains(&format!("\"{}\"", n.to_lowercase()))).collect())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = names;
        Ok(vec![])
    }
}

/// D8 – Medienwiedergabe stoppen (Medientaste "Stopp").
#[tauri::command]
fn stop_media() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{keybd_event, KEYEVENTF_KEYUP, VK_MEDIA_STOP};
        unsafe {
            keybd_event(VK_MEDIA_STOP as u8, 0, 0, 0);
            keybd_event(VK_MEDIA_STOP as u8, 0, KEYEVENTF_KEYUP, 0);
        }
    }
    Ok(())
}

/// D10 – Ist der Ruhezustand aktiviert? (Registry, sprachunabhängig)
#[tauri::command]
fn hibernate_enabled() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let out = win::output("reg", &["query", r"HKLM\SYSTEM\CurrentControlSet\Control\Power", "/v", "HibernateEnabled"])?;
        Ok(String::from_utf8_lossy(&out.stdout).contains("0x1"))
    }
    #[cfg(not(target_os = "windows"))]
    Ok(false)
}

/// D10 – Ruhezustand einschalten (Windows fragt nach Admin-Rechten).
#[tauri::command]
fn enable_hibernate() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        win::spawn("powershell", &["-NoProfile", "-Command", "Start-Process powercfg -ArgumentList '/h on' -Verb RunAs"])
    }
    #[cfg(not(target_os = "windows"))]
    Err("Nur unter Windows verfügbar".into())
}

/// D11 – MAC-Adresse des aktiven Netzwerkadapters.
#[tauri::command]
fn mac_address() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let out = win::output("getmac", &["/fo", "csv", "/nh"])?;
        let text = String::from_utf8_lossy(&out.stdout);
        text.lines()
            .filter(|l| !l.contains("N/A") && !l.to_lowercase().contains("disconnected") && !l.contains("getrennt"))
            .find_map(|l| l.split(',').next().map(|s| s.trim_matches('"').to_string()))
            .filter(|s| s.len() == 17)
            .ok_or_else(|| "Keine MAC-Adresse gefunden".into())
    }
    #[cfg(not(target_os = "windows"))]
    Err("Nur unter Windows verfügbar".into())
}

/// D11 – Wake-on-LAN-Paket ins Heimnetz senden (Handy und PC).
#[tauri::command]
fn wake_on_lan(mac: String) -> Result<(), String> {
    let hex: String = mac.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if hex.len() != 12 {
        return Err("MAC-Adresse ungültig".into());
    }
    let bytes: Vec<u8> = (0..6).map(|i| u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap_or(0)).collect();
    let mut packet = vec![0xffu8; 6];
    for _ in 0..16 {
        packet.extend_from_slice(&bytes);
    }
    let sock = std::net::UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    sock.set_broadcast(true).map_err(|e| e.to_string())?;
    sock.send_to(&packet, "255.255.255.255:9").map_err(|e| e.to_string())?;
    Ok(())
}

mod direct;
mod discord;
mod hotkeys;
mod sound;
mod takeover;

/// Nur Dateien aus den eigenen GitHub-Releases werden geladen.
/// Alter Accountname (vor der Umbenennung) bleibt erlaubt.
const RELEASE_PREFIXES: [&str; 2] = [
    "https://github.com/Type-1-Diabetes/Heimalarm/releases/download/",
    "https://github.com/DanieldamHH112/Heimalarm/releases/download/",
];

fn is_release_url(u: &str) -> bool {
    RELEASE_PREFIXES.iter().any(|p| u.starts_with(p))
}

/// Update (Windows): Setup aus dem GitHub-Release laden, SHA256 mit `<datei>.sha256` vergleichen,
/// Setup still (`/P`, nur Fortschrittsbalken) ausführen und danach Heimalarm neu starten.
/// Die App beendet sich selbst, damit das Setup die Dateien ersetzen kann.
#[tauri::command]
async fn install_update(app: tauri::AppHandle, url: String, sha_url: String) -> Result<(), String> {
    if !is_release_url(&url) || !is_release_url(&sha_url) {
        return Err("Update nur aus den Heimalarm-Releases auf GitHub (mit Prüfsumme)".into());
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        const NO_WINDOW: u32 = 0x0800_0000;
        const DETACHED: u32 = 0x0000_0008;

        let dir = std::env::temp_dir().join("Heimalarm-Update");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let setup = dir.join("Heimalarm-setup.exe");
        let sha = dir.join("Heimalarm-setup.exe.sha256");

        // Laden in Rust (Fortschritt als Ereignis „update-progress“), Prüfsumme mit Bordmitteln (PowerShell).
        use tauri::Emitter;
        let prog = |stage: &str, loaded: u64, total: u64| {
            let _ = app.emit("update-progress", serde_json::json!({ "stage": stage, "loaded": loaded, "total": total }));
        };
        let client = tauri_plugin_http::reqwest::Client::builder().user_agent("Heimalarm-Updater").build().map_err(|e| e.to_string())?;
        let sha_text = client.get(&sha_url).send().await.and_then(|r| r.error_for_status()).map_err(|e| format!("Download fehlgeschlagen: {e}"))?
            .text().await.map_err(|e| e.to_string())?;
        std::fs::write(&sha, sha_text).map_err(|e| e.to_string())?;
        let mut resp = client.get(&url).send().await.and_then(|r| r.error_for_status()).map_err(|e| format!("Download fehlgeschlagen: {e}"))?;
        let total = resp.content_length().unwrap_or(0);
        let mut file = std::fs::File::create(&setup).map_err(|e| e.to_string())?;
        let (mut loaded, mut last) = (0u64, std::time::Instant::now());
        prog("download", 0, total);
        while let Some(chunk) = resp.chunk().await.map_err(|e| format!("Download fehlgeschlagen: {e}"))? {
            std::io::Write::write_all(&mut file, &chunk).map_err(|e| e.to_string())?;
            loaded += chunk.len() as u64;
            if last.elapsed().as_millis() >= 200 { prog("download", loaded, total); last = std::time::Instant::now(); }
        }
        drop(file);
        prog("verify", loaded, total);
        let script = "$ErrorActionPreference='Stop'; \
            $exp=((Get-Content -Raw $env:HA_SHA).Trim() -split '\\s+')[0]; \
            $act=(Get-FileHash -Algorithm SHA256 $env:HA_SETUP).Hash; \
            if ($act -ne $exp) { Remove-Item $env:HA_SETUP -Force; exit 3 }";
        let out = tauri::async_runtime::spawn_blocking({
            let (setup, sha) = (setup.clone(), sha.clone());
            move || {
                Command::new("powershell")
                    .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
                    .env("HA_SETUP", &setup).env("HA_SHA", &sha)
                    .creation_flags(NO_WINDOW)
                    .output()
            }
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(if out.status.code() == Some(3) {
                "Prüfsumme stimmt nicht – Download verworfen".into()
            } else {
                format!("Prüfung fehlgeschlagen: {}", String::from_utf8_lossy(&out.stderr).lines().next().unwrap_or("unbekannt"))
            });
        }
        prog("install", loaded, total);

        // Setup direkt starten (ohne Zwischenschritt über PowerShell, der beim Beenden der App
        // verloren ging): /P = ohne Fragen mit Fortschrittsfenster, /UPDATE = über die vorhandene
        // Installation, /R = Heimalarm danach wieder starten. Das Setup schließt die laufende App selbst.
        Command::new(&setup)
            .args(["/P", "/UPDATE", "/R"])
            .creation_flags(DETACHED)
            .spawn()
            .map_err(|e| format!("Setup nicht gestartet: {e}"))?;
        app.exit(0);
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("Nur unter Windows".into())
    }
}

/// Startargument des Autostarts: Fenster bleibt verborgen, nur das Symbol im Infobereich erscheint.
#[cfg(desktop)]
const HIDDEN_ARG: &str = "--im-hintergrund";

/// Windows: Symbol im Infobereich (Taskleiste) mit Menü „Öffnen“ / „Beenden“.
#[cfg(desktop)]
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let open = MenuItem::with_id(app, "open", "Heimalarm öffnen", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Beenden – danach keine Alarme", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Heimalarm – empfängt Alarme")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// App-Sperre: Windows Hello (Fingerabdruck, Gesicht oder Windows-PIN).
/// `check = true` fragt nur, ob Windows Hello eingerichtet ist.
#[tauri::command]
async fn windows_hello(window: tauri::WebviewWindow, reason: String, check: bool) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        tauri::async_runtime::spawn_blocking(move || hello::verify(hwnd, &reason, check))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, reason, check);
        Ok(false)
    }
}

#[cfg(target_os = "windows")]
mod hello {
    use windows::core::{factory, HSTRING};
    use windows::Security::Credentials::UI::{UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::WinRT::IUserConsentVerifierInterop;

    pub fn verify(hwnd: isize, reason: &str, check: bool) -> Result<bool, String> {
        let available = UserConsentVerifier::CheckAvailabilityAsync()
            .and_then(|op| op.join())
            .map(|a| a == UserConsentVerifierAvailability::Available)
            .unwrap_or(false);
        if check || !available {
            return Ok(available);
        }
        let interop = factory::<UserConsentVerifier, IUserConsentVerifierInterop>().map_err(|e| e.message().to_string())?;
        let op: windows_future::IAsyncOperation<UserConsentVerificationResult> =
            unsafe { interop.RequestVerificationForWindowAsync(HWND(hwnd as _), &HSTRING::from(reason)) }.map_err(|e| e.message().to_string())?;
        let result = op.join().map_err(|e| e.message().to_string())?;
        Ok(result == UserConsentVerificationResult::Verified)
    }
}

#[cfg(desktop)]
fn show_main(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
    let builder = tauri::Builder::default()
        // Zweiter Start (z. B. Doppelklick aufs Symbol) holt das laufende Fenster nach vorn.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        // Größe und Position des Hauptfensters merken (nicht Sichtbarkeit/Vollbild: Autostart bleibt verborgen)
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(tauri_plugin_window_state::StateFlags::all() - tauri_plugin_window_state::StateFlags::VISIBLE - tauri_plugin_window_state::StateFlags::FULLSCREEN)
                .with_filter(|label| label == "main")
                .build(),
        );
    #[cfg(not(desktop))]
    let builder = tauri::Builder::default().plugin(tauri_plugin_biometric::init());   // App-Sperre per Fingerabdruck (Android)
    let builder = builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())   // Links (https://…) im Standard-Browser öffnen
        .plugin(tauri_plugin_heimalarm::init());
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_dialog::init())   // Bestätigungen als echtes Windows-Fenster (ui/form.js → ask)
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![HIDDEN_ARG]),
        ))
        .setup(|app| {
            use tauri::Manager;
            setup_tray(app)?;
            if std::env::args().any(|a| a == HIDDEN_ARG) {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            Ok(())
        })
        // Schließen (X) beendet die App nicht, sie läuft im Infobereich weiter.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        });
    builder
        .invoke_handler(tauri::generate_handler![
            pc_action,
            running_processes,
            stop_media,
            hibernate_enabled,
            enable_hibernate,
            mac_address,
            wake_on_lan,
            install_update,
            windows_hello,
            direct::direct_server,
            direct::direct_set_config,
            direct::direct_pairing,
            direct::direct_push,
            sound::sound_play,
            sound::sound_stop,
            sound::sound_save,
            sound::sound_list,
            sound::sound_delete,
            sound::system_volume,
            sound::system_volume_set,
            takeover::takeover_open,
            takeover::tray_status,
            discord::discord_set,
            discord::discord_clear,
            discord::discord_running,
            hotkeys::window_list,
            hotkeys::send_hotkey
        ])
        .run(tauri::generate_context!())
        .expect("Heimalarm konnte nicht starten");
}
