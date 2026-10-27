//! Dashboard: randloses Vollbildfenster (`tv.html#<id>`) auf einem weiteren Monitor am PC.
//! (Dateien und Events heißen historisch „tv“.)
//! Inhalt und Bedienung laufen über Events mit dem Hauptfenster (src/core/tvlink.js) –
//! das Fenster startet selbst keine Verbindung und keine Alarm-Logik.
#[cfg(desktop)]
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(desktop)]
const PREFIX: &str = "tv-";

/// Bildschirm für die Auswahl im Editor.
#[derive(serde::Serialize)]
pub struct Screen {
    /// Fester Schlüssel aus Position und Größe (bleibt gleich, solange der Bildschirm gleich angeschlossen ist).
    key: String,
    name: String,
    width: u32,
    height: u32,
    primary: bool,
}

#[tauri::command]
pub fn tv_screens(app: tauri::AppHandle) -> Result<Vec<Screen>, String> {
    #[cfg(desktop)]
    {
        let primary = app.primary_monitor().ok().flatten();
        let list = app.available_monitors().map_err(|e| e.to_string())?;
        let names = monitor_names();
        return Ok(list
            .into_iter()
            .enumerate()
            .map(|(i, m)| {
                // „\\.\DISPLAY4“ → Herstellername („DELL U2719D“), sonst „Monitor 4“; dazu die Lage zum Hauptmonitor
                let gdi = m.name().cloned().unwrap_or_default();
                let nr = gdi.trim_start_matches(|c: char| !c.is_ascii_digit()).to_string();
                let label = names.get(&gdi).cloned().unwrap_or_else(|| format!("Monitor {}", if nr.is_empty() { (i + 1).to_string() } else { nr }));
                let is_primary = primary.as_ref().is_some_and(|p| p.position() == m.position());
                let place = match &primary {
                    Some(p) if !is_primary => {
                        let (dx, dy) = (m.position().x - p.position().x, m.position().y - p.position().y);
                        if dx.abs() >= dy.abs() { if dx > 0 { " · rechts" } else { " · links" } } else if dy > 0 { " · unten" } else { " · oben" }
                    }
                    _ => "",
                };
                Screen {
                    key: format!("{},{}", m.position().x, m.position().y),
                    name: format!("{label}{place}"),
                    width: m.size().width,
                    height: m.size().height,
                    primary: is_primary,
                }
            })
            .collect());
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        Ok(vec![])
    }
}

/// Fenster für ein Dashboard öffnen (`on`) oder schließen. `screen` = Schlüssel aus `tv_screens`;
/// fehlt der Bildschirm, nimmt es den ersten, der nicht der Hauptbildschirm ist.
/// Muss async sein: Ein Fenster aus einem synchronen Befehl zu bauen, blockiert unter Windows den Hauptthread
/// (WebView2-Deadlock, siehe Doku von `WebviewWindowBuilder`). Das Fenster blieb dann schwarz und alles hing.
#[tauri::command]
pub async fn tv_open(app: tauri::AppHandle, id: String, screen: String, on: bool) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let label = format!("{PREFIX}{}", id.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>());
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.destroy();
        }
        if !on {
            return Ok(());
        }
        let monitors = app.available_monitors().map_err(|e| e.to_string())?;
        let primary = app.primary_monitor().ok().flatten().map(|m| *m.position());
        let m = monitors
            .iter()
            .find(|m| format!("{},{}", m.position().x, m.position().y) == screen)
            .or_else(|| monitors.iter().find(|m| Some(*m.position()) != primary))
            .or_else(|| monitors.first())
            .ok_or("Kein Bildschirm gefunden")?;
        let scale = m.scale_factor();
        let pos = m.position().to_logical::<f64>(scale);
        let size = m.size().to_logical::<f64>(scale);
        let w = WebviewWindowBuilder::new(&app, label, WebviewUrl::App(format!("tv.html#{id}").into()))
            .title("Heimalarm – Dashboard")
            .position(pos.x, pos.y)
            .inner_size(size.width, size.height)
            .decorations(false)
            .skip_taskbar(true)
            .resizable(false)
            .focused(false)
            .background_color(tauri::window::Color(14, 16, 19, 255))
            .additional_browser_args(crate::takeover::BROWSER_ARGS)
            .build()
            .map_err(|e| e.to_string())?;
        let _ = w.set_fullscreen(true);
        return Ok(());
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, id, screen, on);
        Ok(())
    }
}

/// Windows: Anzeigenamen der Monitore (z. B. „DELL U2719D“) je GDI-Gerätename („\\.\DISPLAY4“).
#[cfg(target_os = "windows")]
fn monitor_names() -> std::collections::HashMap<String, String> {
    use windows::Win32::Devices::Display::{
        DisplayConfigGetDeviceInfo, GetDisplayConfigBufferSizes, QueryDisplayConfig, DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME,
        DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME, DISPLAYCONFIG_MODE_INFO, DISPLAYCONFIG_PATH_INFO, DISPLAYCONFIG_SOURCE_DEVICE_NAME,
        DISPLAYCONFIG_TARGET_DEVICE_NAME, QDC_ONLY_ACTIVE_PATHS,
    };
    let mut out = std::collections::HashMap::new();
    let wide = |s: &[u16]| String::from_utf16_lossy(&s[..s.iter().position(|&c| c == 0).unwrap_or(s.len())]);
    unsafe {
        let (mut np, mut nm) = (0u32, 0u32);
        if GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut np, &mut nm).is_err() { return out; }
        let mut paths = vec![DISPLAYCONFIG_PATH_INFO::default(); np as usize];
        let mut modes = vec![DISPLAYCONFIG_MODE_INFO::default(); nm as usize];
        if QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, &mut np, paths.as_mut_ptr(), &mut nm, modes.as_mut_ptr(), None).is_err() { return out; }
        for p in &paths[..np as usize] {
            let mut src = DISPLAYCONFIG_SOURCE_DEVICE_NAME::default();
            src.header.r#type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
            src.header.size = std::mem::size_of::<DISPLAYCONFIG_SOURCE_DEVICE_NAME>() as u32;
            src.header.adapterId = p.sourceInfo.adapterId;
            src.header.id = p.sourceInfo.id;
            let mut tgt = DISPLAYCONFIG_TARGET_DEVICE_NAME::default();
            tgt.header.r#type = DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME;
            tgt.header.size = std::mem::size_of::<DISPLAYCONFIG_TARGET_DEVICE_NAME>() as u32;
            tgt.header.adapterId = p.targetInfo.adapterId;
            tgt.header.id = p.targetInfo.id;
            if DisplayConfigGetDeviceInfo(&mut src.header) != 0 || DisplayConfigGetDeviceInfo(&mut tgt.header) != 0 { continue; }
            let name = wide(&tgt.monitorFriendlyDeviceName);
            if !name.trim().is_empty() { out.insert(wide(&src.viewGdiDeviceName), name.trim().to_string()); }
        }
    }
    out
}

#[cfg(all(desktop, not(target_os = "windows")))]
fn monitor_names() -> std::collections::HashMap<String, String> {
    std::collections::HashMap::new()
}
