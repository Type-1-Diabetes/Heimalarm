import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
// Passende Versionen von Zentrale und ESP32-Firmware – die App warnt, wenn ein Gerät älter ist (core/versions.js).
const dienst = JSON.parse(readFileSync(new URL("../zentrale/dienst/package.json", import.meta.url), "utf8"));
const fw = readFileSync(new URL("../esp32/alarm-ich.yaml", import.meta.url), "utf8").match(/HEIMALARM_FW (\d+)/u)?.[1] || "0";

// Tauri erwartet einen festen Port und keine Bildschirm-Löschung im Dev-Modus.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: process.env.TAURI_DEV_HOST || false },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  define: {
    "import.meta.env.PACKAGE_VERSION": JSON.stringify(pkg.version),
    "import.meta.env.ZENTRALE_VERSION": JSON.stringify(dienst.version),
    "import.meta.env.ESP_FW": JSON.stringify(fw),
  },
  // mirror.html = „Fährst du?“ auf weiteren Bildschirmen (src-tauri/src/takeover.rs), tv.html = Dashboard (src-tauri/src/tv.rs)
  build: {
    target: "es2022", outDir: "dist", emptyOutDir: true,
    rollupOptions: { input: { main: "index.html", mirror: "mirror.html", tv: "tv.html" } },
  },
});
