//! D6 – „Fährst du?“ auf allen Bildschirmen. Das Hauptfenster zeigt die Abfrage im Vollbild,
//! auf jedem weiteren Monitor öffnet sich ein randloses Fenster (`mirror.html`) mit denselben Knöpfen.
//! Windows verhindert oft, dass sich ein Programm selbst nach vorn holt – darum der Fokus-Trick unten.
#[cfg(desktop)]
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(desktop)]
const MIRROR_PREFIX: &str = "takeover-";

/// Gleiche WebView2-Argumente wie das Hauptfenster (tauri.conf.json → additionalBrowserArgs).
/// Unterschiedliche Argumente im selben Programm lässt WebView2 nicht zu.
#[cfg(desktop)]
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows";

#[tauri::command]
pub async fn takeover_open(app: tauri::AppHandle, on: bool) -> Result<(), String> {
    #[cfg(desktop)]
    return open(app, on);
    #[cfg(not(desktop))]
    {
        let _ = (app, on);
        Ok(())
    }
}

#[cfg(desktop)]
fn open(app: tauri::AppHandle, on: bool) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or("Alarmfenster ließ sich nicht öffnen")?;
    // alte Zusatzfenster immer schließen
    for (label, w) in app.webview_windows() {
        if label.starts_with(MIRROR_PREFIX) {
            let _ = w.destroy();
        }
    }
    if !on {
        let _ = main.set_fullscreen(false);
        let _ = main.set_always_on_top(false);
        return Ok(());
    }

    let _ = main.unminimize();
    let _ = main.show();
    let _ = main.set_always_on_top(true);
    let _ = main.set_fullscreen(true);
    let _ = main.set_focus();
    force_foreground(&main);

    let here = main.current_monitor().ok().flatten().map(|m| *m.position());
    for (i, m) in app.available_monitors().map_err(|e| e.to_string())?.into_iter().enumerate() {
        if Some(*m.position()) == here {
            continue;
        }
        let scale = m.scale_factor();
        let pos = m.position().to_logical::<f64>(scale);
        let size = m.size().to_logical::<f64>(scale);
        let w = WebviewWindowBuilder::new(&app, format!("{MIRROR_PREFIX}{i}"), WebviewUrl::App("mirror.html".into()))
            .title("Heimalarm – Alarm")
            .position(pos.x, pos.y)
            .inner_size(size.width, size.height)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .focused(false)
            .background_color(tauri::window::Color(14, 16, 19, 255))
            .additional_browser_args(BROWSER_ARGS)
            .build()
            .map_err(|e| e.to_string())?;
        let _ = w.set_fullscreen(true);
    }
    Ok(())
}

/// Fenster wirklich nach vorn holen. Windows erlaubt `SetForegroundWindow` nur dem Programm,
/// das gerade den Fokus hat – kurz an dessen Eingabe-Thread anhängen und eine Alt-Taste senden.
#[cfg(target_os = "windows")]
fn force_foreground(w: &tauri::WebviewWindow) {
    use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{keybd_event, KEYEVENTF_KEYUP, VK_MENU};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow, ShowWindow, SW_SHOW,
    };
    let Ok(hwnd) = w.hwnd() else { return };
    let hwnd = hwnd.0 as _;
    unsafe {
        let fg = GetForegroundWindow();
        let fg_thread = GetWindowThreadProcessId(fg, std::ptr::null_mut());
        let me = GetCurrentThreadId();
        let attached = fg_thread != 0 && fg_thread != me && AttachThreadInput(me, fg_thread, 1) != 0;
        keybd_event(VK_MENU as u8, 0, 0, 0);
        keybd_event(VK_MENU as u8, 0, KEYEVENTF_KEYUP, 0);
        ShowWindow(hwnd, SW_SHOW);
        BringWindowToTop(hwnd);
        SetForegroundWindow(hwnd);
        if attached {
            AttachThreadInput(me, fg_thread, 0);
        }
    }
}

#[cfg(all(desktop, not(target_os = "windows")))]
fn force_foreground(_: &tauri::WebviewWindow) {}

/// Infobereich: Tooltip zeigt, ob Heimalarm bereit ist (z. B. „verbunden“ / „keine Verbindung“).
#[tauri::command]
pub fn tray_status(app: tauri::AppHandle, text: String) -> Result<(), String> {
    #[cfg(desktop)]
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_tooltip(Some(format!("Heimalarm – {text}"))).map_err(|e| e.to_string())?;
    }
    #[cfg(not(desktop))]
    let _ = (app, text);
    Ok(())
}
