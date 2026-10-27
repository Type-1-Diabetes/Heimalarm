//! Vor dem Ruhezustand: Programme nach vorn holen und eine Tastenkombination senden (z. B. Strg+S in Blender).
//! `window_list` liefert die sichtbaren Programmfenster für die Auswahl in der Oberfläche.
//! Tasten-Schreibweise: "Ctrl+Shift+S", "Alt+F4", "F5", "Ctrl+Enter" … (siehe `vk`).

use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct WinInfo {
    /// Dateiname klein, z. B. "blender.exe"
    pub exe: String,
    /// Fenstertitel des Hauptfensters
    pub title: String,
    /// Läuft mit Administratorrechten? Dann kommen Tasten aus Heimalarm nicht an.
    pub elevated: bool,
}

#[derive(Serialize, Clone)]
pub struct SendResult {
    /// sent | not_running | elevated | no_focus | bad_keys
    pub status: String,
    pub title: String,
}

/// Taste → virtueller Tastencode (Windows VK_*). None = unbekannt.
#[cfg_attr(not(windows), allow(dead_code))]
fn vk(name: &str) -> Option<u16> {
    let n = name.trim().to_ascii_lowercase();
    Some(match n.as_str() {
        "ctrl" | "strg" | "control" => 0x11,
        "shift" | "umschalt" => 0x10,
        "alt" => 0x12,
        "win" | "meta" => 0x5B,
        "enter" | "eingabe" | "return" => 0x0D,
        "esc" | "escape" => 0x1B,
        "space" | "leertaste" => 0x20,
        "tab" => 0x09,
        "backspace" => 0x08,
        "delete" | "entf" => 0x2E,
        "insert" | "einfg" => 0x2D,
        "home" | "pos1" => 0x24,
        "end" | "ende" => 0x23,
        "pageup" | "bildauf" => 0x21,
        "pagedown" | "bildab" => 0x22,
        "up" => 0x26,
        "down" => 0x28,
        "left" => 0x25,
        "right" => 0x27,
        _ => {
            if n.len() == 1 {
                let c = n.as_bytes()[0];
                if c.is_ascii_alphanumeric() {
                    return Some(c.to_ascii_uppercase() as u16);
                }
                return None;
            }
            if let Some(num) = n.strip_prefix('f').and_then(|x| x.parse::<u16>().ok()) {
                if (1..=24).contains(&num) {
                    return Some(0x70 + num - 1);
                }
            }
            return None;
        }
    })
}

#[cfg_attr(not(windows), allow(dead_code))]
fn parse(keys: &str) -> Option<Vec<u16>> {
    let parts: Vec<&str> = keys.split('+').map(str::trim).filter(|s| !s.is_empty()).collect();
    if parts.is_empty() || parts.len() > 4 {
        return None;
    }
    parts.into_iter().map(vk).collect()
}

#[cfg(windows)]
mod win {
    use super::WinInfo;
    use windows_sys::Win32::Foundation::{CloseHandle, BOOL, HANDLE, HWND, LPARAM};
    use windows_sys::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
    use windows_sys::Win32::System::Threading::{
        AttachThreadInput, GetCurrentProcessId, GetCurrentThreadId, OpenProcess, OpenProcessToken, QueryFullProcessImageNameW,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        keybd_event, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_MENU,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, EnumWindows, GetForegroundWindow, GetWindow, GetWindowLongW, GetWindowTextLengthW, GetWindowTextW,
        GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow, GWL_EXSTYLE, GW_OWNER, SW_RESTORE,
        WS_EX_TOOLWINDOW,
    };

    pub struct Found {
        pub hwnd: HWND,
        pub info: WinInfo,
    }

    unsafe fn exe_of(pid: u32) -> (String, bool) {
        let h: HANDLE = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return (String::new(), false);
        }
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let name = if QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut len) != 0 {
            let full = String::from_utf16_lossy(&buf[..len as usize]);
            full.rsplit('\\').next().unwrap_or("").to_lowercase()
        } else {
            String::new()
        };
        let mut elevated = false;
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(h, TOKEN_QUERY, &mut token) != 0 {
            let mut e = TOKEN_ELEVATION { TokenIsElevated: 0 };
            let mut ret = 0u32;
            if GetTokenInformation(token, TokenElevation, &mut e as *mut _ as *mut _, std::mem::size_of::<TOKEN_ELEVATION>() as u32, &mut ret) != 0 {
                elevated = e.TokenIsElevated != 0;
            }
            CloseHandle(token);
        } else {
            // Token nicht lesbar → läuft meist mit höheren Rechten
            elevated = true;
        }
        CloseHandle(h);
        (name, elevated)
    }

    unsafe extern "system" fn collect(hwnd: HWND, lp: LPARAM) -> BOOL {
        let out = &mut *(lp as *mut Vec<Found>);
        if IsWindowVisible(hwnd) == 0 || !GetWindow(hwnd, GW_OWNER).is_null() {
            return 1;
        }
        if (GetWindowLongW(hwnd, GWL_EXSTYLE) as u32) & WS_EX_TOOLWINDOW != 0 {
            return 1;
        }
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return 1;
        }
        let mut buf = vec![0u16; len as usize + 1];
        let n = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        let title = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 || pid == GetCurrentProcessId() {
            return 1;
        }
        let (exe, elevated) = exe_of(pid);
        if exe.is_empty() || exe == "explorer.exe" || exe == "applicationframehost.exe" || exe == "textinputhost.exe" {
            return 1;
        }
        out.push(Found { hwnd, info: WinInfo { exe, title, elevated } });
        1
    }

    pub fn windows() -> Vec<Found> {
        let mut list: Vec<Found> = Vec::new();
        unsafe {
            EnumWindows(Some(collect), &mut list as *mut _ as LPARAM);
        }
        list
    }

    /// Wie in takeover.rs: kurz an den Eingabe-Thread des aktiven Fensters hängen, sonst lehnt Windows ab.
    pub unsafe fn focus(hwnd: HWND) -> bool {
        if IsIconic(hwnd) != 0 {
            ShowWindow(hwnd, SW_RESTORE);
        }
        let fg = GetForegroundWindow();
        let fg_thread = GetWindowThreadProcessId(fg, std::ptr::null_mut());
        let me = GetCurrentThreadId();
        let attached = fg_thread != 0 && fg_thread != me && AttachThreadInput(me, fg_thread, 1) != 0;
        keybd_event(VK_MENU as u8, 0, 0, 0);
        keybd_event(VK_MENU as u8, 0, KEYEVENTF_KEYUP, 0);
        BringWindowToTop(hwnd);
        SetForegroundWindow(hwnd);
        if attached {
            AttachThreadInput(me, fg_thread, 0);
        }
        std::thread::sleep(std::time::Duration::from_millis(350));
        GetForegroundWindow() == hwnd
    }

    fn key(vk: u16, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: vk, wScan: 0, dwFlags: if up { KEYEVENTF_KEYUP } else { 0 }, time: 0, dwExtraInfo: 0 } },
        }
    }

    pub unsafe fn press(keys: &[u16]) {
        let mut seq: Vec<INPUT> = keys.iter().map(|&k| key(k, false)).collect();
        seq.extend(keys.iter().rev().map(|&k| key(k, true)));
        SendInput(seq.len() as u32, seq.as_ptr(), std::mem::size_of::<INPUT>() as i32);
    }
}

/// Sichtbare Programmfenster (eins je Programm), sortiert nach Name.
#[tauri::command]
pub fn window_list() -> Vec<WinInfo> {
    #[cfg(windows)]
    {
        let mut seen = std::collections::HashSet::new();
        let mut out: Vec<WinInfo> = win::windows().into_iter().filter(|f| seen.insert(f.info.exe.clone())).map(|f| f.info).collect();
        out.sort_by(|a, b| a.exe.cmp(&b.exe));
        out
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// Programm nach vorn holen und Tasten senden. Läuft blockierend (mit kurzer Wartezeit) außerhalb der Oberfläche.
#[tauri::command]
pub async fn send_hotkey(exe: String, keys: String) -> Result<SendResult, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let Some(codes) = parse(&keys) else {
                return SendResult { status: "bad_keys".into(), title: String::new() };
            };
            let want = exe.trim().to_lowercase();
            let Some(f) = win::windows().into_iter().find(|f| f.info.exe == want) else {
                return SendResult { status: "not_running".into(), title: String::new() };
            };
            if f.info.elevated {
                return SendResult { status: "elevated".into(), title: f.info.title };
            }
            unsafe {
                if !win::focus(f.hwnd) {
                    return SendResult { status: "no_focus".into(), title: f.info.title };
                }
                win::press(&codes);
            }
            SendResult { status: "sent".into(), title: f.info.title }
        })
        .await
        .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = (exe, keys);
        Err("Nur unter Windows".into())
    }
}
