//! Android-Funktionen für Heimalarm (E6, A1/A6, zuverlässiger Empfang im Hintergrund).
//! Auf Windows liefern die Befehle neutrale Werte.
use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};
#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(target_os = "android")]
struct Mobile<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    supported: bool,
    battery_optimized: bool,
    notification_access: bool,
    service: bool,
}

#[derive(Serialize, Deserialize)]
struct ServiceArgs {
    enabled: bool,
}

#[derive(Serialize, Deserialize, Default)]
#[allow(dead_code)]
struct Empty {}

#[cfg(target_os = "android")]
fn call<R: Runtime, T: serde::de::DeserializeOwned>(app: &tauri::AppHandle<R>, cmd: &str, args: impl Serialize) -> Result<T, String> {
    app.state::<Mobile<R>>().0.run_mobile_plugin::<T>(cmd, args).map_err(|e| e.to_string())
}

#[tauri::command]
async fn status<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Status, String> {
    #[cfg(target_os = "android")]
    return call(&app, "status", Empty::default());
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(Status::default())
    }
}

#[tauri::command]
async fn open_battery_settings<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return call::<R, Empty>(&app, "openBatterySettings", Empty::default()).map(|_| ());
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
async fn open_notification_access<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return call::<R, Empty>(&app, "openNotificationAccess", Empty::default()).map(|_| ());
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
async fn set_service<R: Runtime>(app: tauri::AppHandle<R>, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return call::<R, Empty>(&app, "setService", ServiceArgs { enabled }).map(|_| ());
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, ServiceArgs { enabled });
        Ok(())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("heimalarm")
        .invoke_handler(tauri::generate_handler![status, open_battery_settings, open_notification_access, set_service])
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin("de.heimalarm.plugin", "HeimalarmPlugin")?;
                app.manage(Mobile(handle));
            }
            #[cfg(not(target_os = "android"))]
            let _ = (app, api);
            Ok(())
        })
        .build()
}
