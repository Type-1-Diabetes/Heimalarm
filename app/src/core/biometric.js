// App-Sperre mit Fingerabdruck: Android über das Tauri-Biometrie-Plugin,
// Windows über Windows Hello (Fingerabdruck, Gesicht oder Windows-PIN; Rust-Befehl windows_hello).
// Die App-PIN bleibt immer als Rückfall bestehen.
import { isTauri, isAndroid, isWindows } from "./platform.js";

const REASON = "Heimalarm entsperren";

/** Name, wie der Nutzer es kennt – oder "" wenn auf diesem Gerät nicht verfügbar. */
export async function biometricLabel() {
  if (!isTauri) return "";
  try {
    if (isAndroid) {
      const { checkStatus } = await import("@tauri-apps/plugin-biometric");
      const s = await checkStatus();
      return s.isAvailable ? "Fingerabdruck" : "";
    }
    if (isWindows) {
      const { invoke } = await import("@tauri-apps/api/core");
      return (await invoke("windows_hello", { reason: REASON, check: true })) ? "Windows Hello" : "";
    }
  } catch { /* Plugin fehlt oder Gerät ohne Sensor */ }
  return "";
}

/** Fragt Fingerabdruck / Windows Hello ab. true = erkannt. */
export async function biometricUnlock() {
  try {
    if (isAndroid) {
      const { authenticate } = await import("@tauri-apps/plugin-biometric");
      await authenticate(REASON, { allowDeviceCredential: false, cancelTitle: "PIN eingeben" });
      return true;
    }
    if (isWindows) {
      const { invoke } = await import("@tauri-apps/api/core");
      return Boolean(await invoke("windows_hello", { reason: REASON, check: false }));
    }
  } catch { /* abgebrochen oder nicht erkannt */ }
  return false;
}
