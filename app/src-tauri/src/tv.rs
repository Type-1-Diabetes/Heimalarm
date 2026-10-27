//! TV-Dashboard: randloses Vollbildfenster (`tv.html#<id>`) auf einem gewählten Bildschirm.
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
        let primary = app.primary_monitor().ok().flatten().map(|m| *m.position());
        let list = app.available_monitors().map_err(|e| e.to_string())?;
        return Ok(list
            .into_iter()
            .enumerate()
            .map(|(i, m)| Screen {
                key: format!("{},{}", m.position().x, m.position().y),
                name: m.name().cloned().unwrap_or_else(|| format!("Bildschirm {}", i + 1)),
                width: m.size().width,
                height: m.size().height,
                primary: Some(*m.position()) == primary,
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
#[tauri::command]
pub fn tv_open(app: tauri::AppHandle, id: String, screen: String, on: bool) -> Result<(), String> {
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
