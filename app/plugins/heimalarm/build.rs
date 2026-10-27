const COMMANDS: &[&str] = &["status", "open_battery_settings", "open_notification_access", "set_service", "registerListener", "remove_listener", "install_apk", "configure", "pending_notifications", "show_alarm", "stop_alarm", "play_sound", "stop_sound", "pick_sound", "list_sounds", "delete_sound", "alarm_volume", "set_alarm_volume", "open_full_screen_settings", "request_local_network", "open_alarm_app", "navigate", "stop_torch", "test_torch", "open_overlay_settings", "open_dnd_settings", "open_app_details"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
