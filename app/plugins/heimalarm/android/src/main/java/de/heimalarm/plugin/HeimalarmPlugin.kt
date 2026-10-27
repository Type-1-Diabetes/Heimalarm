package de.heimalarm.plugin

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class UpdateArgs {
    var url: String = ""
    var shaUrl: String = ""
}

@InvokeArg
class ServiceArgs {
    var enabled: Boolean = false
}

@InvokeArg
class ConfigArgs {
    var packages: Array<String> = arrayOf()
    var words: Array<String> = arrayOf()
    var service: Boolean = true
    var silent: Boolean = false
    var mode: String = "heimalarm"
    var dnd: Boolean = false
    var torch: Boolean = false
    var wake: Boolean = false
    var dndMin: Int = 15
    var torchSec: Int = 30
    var wakeSec: Int = 30
    var restart: Boolean = true
    var notify: Boolean = true
}

@InvokeArg
class OpenAppArgs {
    var app: String = ""
    var dnd: Boolean = false
    var torch: Boolean = false
    var wake: Boolean = false
    var dndMin: Int = 15
    var torchSec: Int = 30
    var wakeSec: Int = 30
}

@InvokeArg
class NavArgs {
    var target: String = ""
}

@InvokeArg
class AlarmArgs {
    var title: String = ""
    var text: String = ""
    var fullscreen: Boolean = true
    var vibrate: Boolean = true
    var sound: Boolean = false
    var tone: String = ""
    var volume: Int = 80
    var ms: Long = 60000
    var dnd: Boolean = false
    var torch: Boolean = false
    var wake: Boolean = false
    var dndMin: Int = 15
    var torchSec: Int = 30
    var wakeSec: Int = 30
    var notify: Boolean = true
}

@InvokeArg
class SoundArgs {
    var tone: String = ""
    var volume: Int = 80
    var ms: Long = 4000
}

@InvokeArg
class IdArgs {
    var id: String = ""
}

@InvokeArg
class LevelArgs {
    var level: Int = 80
}

@TauriPlugin
class HeimalarmPlugin(private val activity: Activity) : Plugin(activity) {

    companion object {
        var instance: HeimalarmPlugin? = null
    }

    // Abstand zu Status- und Navigationsleiste in CSS-Pixeln (Android-WebView liefert env(safe-area-inset-*) oft als 0)
    private var insetTop = 0
    private var insetBottom = 0

    /** Läuft die App (WebView) noch? Sonst puffert der Listener Alarme. */
    fun alive(): Boolean = !activity.isFinishing && !activity.isDestroyed

    override fun load(webView: WebView) {
        if (hasNotificationAccess()) AlarmListener.rebind(activity)
        instance = this
        PhoneActions.visible = true
        takeOpenIntent(activity.intent)
        ViewCompat.setOnApplyWindowInsetsListener(webView) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val d = activity.resources.displayMetrics.density
            insetTop = Math.round(bars.top / d)
            insetBottom = Math.round(bars.bottom / d)
            applyInsets(webView)
            insets
        }
        ViewCompat.requestApplyInsets(webView)
    }

    /** Insets direkt vom Fenster lesen – der Listener feuert oft, bevor die Seite geladen ist,
     *  oder gar nicht, wenn eine übergeordnete View die Insets schon verbraucht hat. */
    private fun readInsets() {
        val root = ViewCompat.getRootWindowInsets(activity.window.decorView) ?: return
        val bars = root.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        val d = activity.resources.displayMetrics.density
        if (bars.top > 0) insetTop = Math.round(bars.top / d)
        if (bars.bottom > 0) insetBottom = Math.round(bars.bottom / d)
    }

    private fun applyInsets(webView: WebView) {
        val js = "document.documentElement.style.setProperty('--inset-top','${insetTop}px');" +
            "document.documentElement.style.setProperty('--inset-bottom','${insetBottom}px');"
        webView.post { webView.evaluateJavascript(js, null) }
    }

    private fun hasNotificationAccess(): Boolean {
        val enabled = Settings.Secure.getString(activity.contentResolver, "enabled_notification_listeners") ?: return false
        val me = ComponentName(activity, AlarmListener::class.java).flattenToString()
        return enabled.split(":").any { it == me }
    }

    /** Android 17+: Zugriff aufs Heimnetz (Zentrale, PC, WLAN-Geräte) ist eine Laufzeit-Berechtigung,
     *  sobald die App auf SDK 37 zielt. Vorher erteilt Android sie automatisch. */
    private val LOCAL_NETWORK = "android.permission.ACCESS_LOCAL_NETWORK"
    private fun localNetworkNeedsAsk(): Boolean =
        Build.VERSION.SDK_INT >= 37 && activity.applicationInfo.targetSdkVersion >= 37
    private fun hasLocalNetwork(): Boolean = !localNetworkNeedsAsk() ||
        androidx.core.content.ContextCompat.checkSelfPermission(activity, LOCAL_NETWORK) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED

    @Command
    fun requestLocalNetwork(invoke: Invoke) {
        if (!hasLocalNetwork()) {
            activity.runOnUiThread {
                androidx.core.app.ActivityCompat.requestPermissions(activity, arrayOf(LOCAL_NETWORK), 4711)
            }
        }
        val ret = JSObject()
        ret.put("granted", hasLocalNetwork())
        invoke.resolve(ret)
    }

    @Command
    fun status(invoke: Invoke) {
        readInsets()
        val pm = activity.getSystemService(Context.POWER_SERVICE) as PowerManager
        val ret = JSObject()
        ret.put("supported", true)
        ret.put("batteryOptimized", !pm.isIgnoringBatteryOptimizations(activity.packageName))
        val access = hasNotificationAccess()
        ret.put("notificationAccess", access)
        // Zugriff erlaubt, Dienst aber getrennt: neu verbinden lassen
        if (access && !AlarmListener.connected) AlarmListener.rebind(activity)
        ret.put("listenerConnected", AlarmListener.connected)
        ret.put("recentApps", Native.recentApps(activity))
        ret.put("lastNotification", Native.lastNotification(activity))
        ret.put("localNetwork", hasLocalNetwork())
        ret.put("service", KeepAliveService.running)
        ret.put("insetTop", insetTop)
        ret.put("insetBottom", insetBottom)
        val nm = activity.getSystemService(android.app.NotificationManager::class.java)
        ret.put("fullScreenAllowed", Build.VERSION.SDK_INT < 34 || nm.canUseFullScreenIntent())
        ret.put("overlayAllowed", PhoneActions.canOverlay(activity))
        ret.put("dndAccess", PhoneActions.hasDndAccess(activity))
        ret.put("torch", PhoneActions.hasTorch(activity))
        ret.put("samsung", Build.MANUFACTURER.equals("samsung", ignoreCase = true))
        // Schlafende App (Samsung „Tiefschlaf“, Android „Eingeschränkt“): Bucket ab „selten“ oder Hintergrund gesperrt
        if (Build.VERSION.SDK_INT >= 28) {
            val usm = activity.getSystemService(android.app.usage.UsageStatsManager::class.java)
            ret.put("standbyBucket", usm.appStandbyBucket)
            val am = activity.getSystemService(android.app.ActivityManager::class.java)
            ret.put("backgroundRestricted", am.isBackgroundRestricted)
        }
        invoke.resolve(ret)
    }

    /** E6 – Ausnahme von der Akku-Optimierung anfragen */
    @Command
    fun openBatterySettings(invoke: Invoke) {
        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
        intent.data = Uri.parse("package:" + activity.packageName)
        activity.startActivity(intent)
        invoke.resolve(JSObject())
    }

    /** A1/A6 – Zugriff auf Benachrichtigungen freigeben */
    @Command
    fun openNotificationAccess(invoke: Invoke) {
        activity.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        invoke.resolve(JSObject())
    }

    /** Hintergrund-Dienst ein-/ausschalten */
    @Command
    fun setService(invoke: Invoke) {
        val args = invoke.parseArgs(ServiceArgs::class.java)
        val intent = Intent(activity, KeepAliveService::class.java)
        if (args.enabled) {
            // Läuft schon: nicht neu starten, sonst sendet Android die Mitteilung erneut.
            if (KeepAliveService.running) { invoke.resolve(JSObject()); return }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) activity.startForegroundService(intent)
            else activity.startService(intent)
        } else {
            activity.stopService(intent)
        }
        invoke.resolve(JSObject())
    }

    /**
     * Update: APK aus dem GitHub-Release laden, SHA256 mit <datei>.sha256 vergleichen und den
     * Android-Installationsdialog öffnen. Fehlt die Erlaubnis „Apps aus dieser Quelle“, öffnet
     * sich zuerst diese Einstellung ({ needsPermission: true }).
     */
    @Command
    fun installApk(invoke: Invoke) {
        val args = invoke.parseArgs(UpdateArgs::class.java)
        // Alter Accountname (vor der Umbenennung) bleibt erlaubt.
        val prefixes = listOf(
            "https://github.com/Type-1-Diabetes/Heimalarm/releases/download/",
            "https://github.com/DanieldamHH112/Heimalarm/releases/download/"
        )
        if (prefixes.none { args.url.startsWith(it) } || prefixes.none { args.shaUrl.startsWith(it) }) {
            invoke.reject("Update nur aus den Heimalarm-Releases auf GitHub (mit Prüfsumme)")
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
            val i = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.packageName))
            activity.startActivity(i)
            val ret = JSObject(); ret.put("needsPermission", true); invoke.resolve(ret)
            return
        }
        Thread {
            try {
                val dir = java.io.File(activity.cacheDir, "update").apply { mkdirs() }
                val apk = java.io.File(dir, "Heimalarm-update.apk")
                download(args.url, apk)
                progress("verify", apk.length(), apk.length())
                val expected = String(fetchBytes(args.shaUrl)).trim().split(Regex("\\s+"))[0]
                val actual = sha256(apk)
                if (!actual.equals(expected, ignoreCase = true)) {
                    apk.delete()
                    invoke.reject("Prüfsumme stimmt nicht – Download verworfen")
                    return@Thread
                }
                val uri = androidx.core.content.FileProvider.getUriForFile(activity, activity.packageName + ".heimalarm.update", apk)
                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/vnd.android.package-archive")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                // Direkt an den Paketinstaller von Android – sonst fragt Android „Öffnen mit“, sobald eine
                // andere App (z. B. ein Dateimanager) APK-Dateien öffnen kann. Ohne Treffer bleibt die Auswahl.
                @Suppress("DEPRECATION")
                activity.packageManager.queryIntentActivities(intent, 0)
                    .map { it.activityInfo.packageName }
                    .firstOrNull { it.contains("packageinstaller") }
                    ?.let { intent.setPackage(it) }
                progress("install", apk.length(), apk.length())
                activity.runOnUiThread { activity.startActivity(intent) }
                val ret = JSObject(); ret.put("needsPermission", false); invoke.resolve(ret)
            } catch (e: Exception) {
                invoke.reject("Download fehlgeschlagen: " + (e.message ?: e.javaClass.simpleName))
            }
        }.start()
    }

    private fun open(url: String): java.net.HttpURLConnection {
        val c = java.net.URL(url).openConnection() as java.net.HttpURLConnection
        c.instanceFollowRedirects = true
        c.connectTimeout = 15000
        c.readTimeout = 60000
        c.setRequestProperty("User-Agent", "Heimalarm-Updater")
        if (c.responseCode !in 200..299) throw java.io.IOException("HTTP " + c.responseCode)
        return c
    }

    private fun fetchBytes(url: String): ByteArray = open(url).inputStream.use { it.readBytes() }

    /** Fortschritt an die Oberfläche (core/update.js): stage download | verify | install */
    private fun progress(stage: String, loaded: Long, total: Long) {
        val d = JSObject(); d.put("stage", stage); d.put("loaded", loaded); d.put("total", total)
        trigger("update-progress", d)
    }

    private fun download(url: String, target: java.io.File) {
        val c = open(url)
        val total = c.contentLengthLong.coerceAtLeast(0)
        var loaded = 0L
        var last = 0L
        progress("download", 0, total)
        c.inputStream.use { input -> target.outputStream().use { out ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf); if (n <= 0) break
                out.write(buf, 0, n); loaded += n
                val now = System.currentTimeMillis()
                if (now - last >= 200) { progress("download", loaded, total); last = now }
            }
        } }
    }

    private fun sha256(file: java.io.File): String {
        val md = java.security.MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) { val n = input.read(buf); if (n <= 0) break; md.update(buf, 0, n) }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    /** Filter für Alarme, solange die App nicht läuft (Neustart) */
    @Command
    fun configure(invoke: Invoke) {
        val a = invoke.parseArgs(ConfigArgs::class.java)
        Native.configure(activity, a.packages.toList(), a.words.toList(), a.service, a.silent, a.mode, a.dnd, a.torch, a.wake, a.dndMin, a.torchSec, a.wakeSec, a.restart, a.notify)
        invoke.resolve(JSObject())
    }

    /** Alarme, die erkannt wurden, bevor die App lief */
    @Command
    fun pendingNotifications(invoke: Invoke) {
        val ret = JSObject()
        ret.put("items", Native.takePending(activity))
        invoke.resolve(ret)
    }

    /** Alarm anzeigen: Vollbild-Meldung (auch Sperrbildschirm), Vibration, Wecker-Ton */
    @Command
    fun showAlarm(invoke: Invoke) {
        val a = invoke.parseArgs(AlarmArgs::class.java)
        activity.runOnUiThread {
            if (Build.VERSION.SDK_INT >= 27) { activity.setShowWhenLocked(true); activity.setTurnScreenOn(true) }
        }
        AlarmSound.stopSound()
        if (a.notify) AlarmSound.notifyAlarm(activity, a.title, a.text, a.fullscreen)
        if (a.sound) AlarmSound.play(activity, a.tone, a.volume, a.ms)
        if (a.vibrate) AlarmSound.vibrate(activity)
        PhoneActions.extras(activity, a.dnd, a.torch, a.wake, a.dndMin, a.torchSec, a.wakeSec)
        invoke.resolve(JSObject())
    }

    @Command
    fun stopAlarm(invoke: Invoke) {
        AlarmSound.cancel(activity)
        PhoneActions.stopTorch(activity)
        activity.runOnUiThread {
            if (Build.VERSION.SDK_INT >= 27) { activity.setShowWhenLocked(false); activity.setTurnScreenOn(false) }
        }
        invoke.resolve(JSObject())
    }

    /** Ton testen */
    @Command
    fun playSound(invoke: Invoke) {
        val a = invoke.parseArgs(SoundArgs::class.java)
        try { AlarmSound.play(activity, a.tone, a.volume, a.ms); invoke.resolve(JSObject()) }
        catch (e: Exception) { invoke.reject("Ton nicht abspielbar: " + (e.message ?: "")) }
    }

    @Command
    fun stopSound(invoke: Invoke) {
        AlarmSound.stopSound()
        invoke.resolve(JSObject())
    }

    /** Eigener Ton: Android-Dateiauswahl, Datei wird in die App kopiert */
    @Command
    fun pickSound(invoke: Invoke) {
        val i = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "audio/*"
        }
        startActivityForResult(invoke, i, "pickSoundResult")
    }

    @ActivityCallback
    fun pickSoundResult(invoke: Invoke, result: ActivityResult) {
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) { invoke.resolve(JSObject()); return }
        try {
            var name = "ton"
            activity.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                if (it.moveToFirst()) name = it.getString(0) ?: name
            }
            val safe = name.replace(Regex("[^A-Za-z0-9 ._()\\-äöüÄÖÜß]"), "_").trimStart('.').ifEmpty { "ton" }
            val size = activity.contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1L
            if (size > 15L * 1024 * 1024) { invoke.reject("Datei ist zu groß (höchstens 15 MB)"); return }
            val target = java.io.File(AlarmSound.soundsDir(activity), safe)
            activity.contentResolver.openInputStream(uri)!!.use { input -> target.outputStream().use { input.copyTo(it) } }
            val ret = JSObject()
            ret.put("id", safe)
            ret.put("name", safe.substringBeforeLast('.'))
            invoke.resolve(ret)
        } catch (e: Exception) {
            invoke.reject("Ton nicht übernommen: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    @Command
    fun listSounds(invoke: Invoke) {
        val arr = org.json.JSONArray()
        AlarmSound.soundsDir(activity).listFiles()?.sortedBy { it.name }?.forEach {
            arr.put(org.json.JSONObject().put("id", it.name).put("name", it.name.substringBeforeLast('.')))
        }
        val ret = JSObject(); ret.put("items", arr); invoke.resolve(ret)
    }

    @Command
    fun deleteSound(invoke: Invoke) {
        val a = invoke.parseArgs(IdArgs::class.java)
        if (a.id.isNotEmpty() && !a.id.contains('/')) java.io.File(AlarmSound.soundsDir(activity), a.id).delete()
        invoke.resolve(JSObject())
    }

    /** Wecker-Lautstärke lesen / setzen (0–100) */
    @Command
    fun alarmVolume(invoke: Invoke) {
        val ret = JSObject()
        ret.put("supported", true)
        val level = AlarmSound.alarmVolume(activity)
        ret.put("level", level)
        ret.put("muted", level == 0)
        invoke.resolve(ret)
    }

    @Command
    fun setAlarmVolume(invoke: Invoke) {
        val a = invoke.parseArgs(LevelArgs::class.java)
        try { AlarmSound.setAlarmVolume(activity, a.level); invoke.resolve(JSObject()) }
        catch (e: Exception) { invoke.reject("Lautstärke nicht änderbar: " + (e.message ?: "")) }
    }

    /** Android 14+: Erlaubnis für Vollbild-Meldungen */
    @Command
    fun openFullScreenSettings(invoke: Invoke) {
        val i = if (Build.VERSION.SDK_INT >= 34) Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + activity.packageName))
                else Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
        activity.startActivity(i)
        invoke.resolve(JSObject())
    }

    /** App-Infos von Heimalarm: dort unter „Akku“ auf „Nicht eingeschränkt“ (Samsung: nimmt die App aus dem Standby) */
    @Command
    fun openAppDetails(invoke: Invoke) {
        activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + activity.packageName)))
        invoke.resolve(JSObject())
    }

    // ── Alarm-App öffnen, Navigation, Erlaubnisse ─────────────

    /** Alarm-App öffnen (Einsatz aus der Benachrichtigung). Darf Android das gerade nicht,
     *  öffnet eine Vollbild-Meldung zuerst Heimalarm, und Heimalarm reicht beim Sichtbarwerden weiter. */
    @Command
    fun openAlarmApp(invoke: Invoke) {
        val a = invoke.parseArgs(OpenAppArgs::class.java)
        PhoneActions.extras(activity, a.dnd, a.torch, a.wake, a.dndMin, a.torchSec, a.wakeSec)
        val ret = JSObject()
        if (PhoneActions.openApp(activity, a.app)) {
            ret.put("opened", true)
        } else {
            PhoneActions.pendingOpen = a.app
            AlarmSound.notifyAlarm(activity, "Heimalarm: Alarm", "Tippen öffnet die Alarm-App", true)
            ret.put("opened", false)
        }
        invoke.resolve(ret)
    }

    @Command
    fun navigate(invoke: Invoke) {
        val a = invoke.parseArgs(NavArgs::class.java)
        if (PhoneActions.navigate(activity, a.target)) invoke.resolve(JSObject())
        else invoke.reject("Keine Karten-App gefunden oder kein Ziel eingetragen")
    }

    @Command
    fun stopTorch(invoke: Invoke) {
        PhoneActions.stopTorch(activity)
        invoke.resolve(JSObject())
    }

    @Command
    fun testTorch(invoke: Invoke) {
        if (!PhoneActions.hasTorch(activity)) { invoke.reject("Dieses Handy hat keine Taschenlampe"); return }
        PhoneActions.blinkTorch(activity, 4)
        invoke.resolve(JSObject())
    }

    /** „Über anderen Apps einblenden“ – damit sich die Alarm-App auch aus dem Hintergrund öffnet */
    @Command
    fun openOverlaySettings(invoke: Invoke) {
        activity.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + activity.packageName)))
        invoke.resolve(JSObject())
    }

    /** Zugriff auf „Nicht stören“ */
    @Command
    fun openDndSettings(invoke: Invoke) {
        activity.startActivity(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS))
        invoke.resolve(JSObject())
    }

    private fun takeOpenIntent(intent: Intent?) {
        // Von selbst neu gestartet (Auto-Neustart): gleich wieder in den Hintergrund, die App soll nur laufen
        if (intent?.getBooleanExtra(Native.EXTRA_BACKGROUND, false) == true) {
            intent.removeExtra(Native.EXTRA_BACKGROUND)
            activity.moveTaskToBack(true)
        }
        val pkg = intent?.getStringExtra(PhoneActions.EXTRA_OPEN_APP) ?: return
        intent.removeExtra(PhoneActions.EXTRA_OPEN_APP)
        PhoneActions.pendingOpen = pkg
    }

    override fun onNewIntent(intent: Intent) {
        takeOpenIntent(intent)
        if (PhoneActions.visible) PhoneActions.flushPending(activity)
    }

    @Suppress("OVERRIDE_DEPRECATION", "DEPRECATION")
    override fun onResume() {
        PhoneActions.visible = true
        PhoneActions.flushPending(activity)
    }

    @Suppress("OVERRIDE_DEPRECATION", "DEPRECATION")
    override fun onPause() {
        PhoneActions.visible = false
    }

    fun emitNotification(app: String, title: String, text: String, ts: Long) {
        val data = JSObject()
        data.put("app", app)
        data.put("title", title)
        data.put("text", text)
        data.put("ts", ts)   // Zeitpunkt der Benachrichtigung, nicht der Verarbeitung
        trigger("notification", data)
    }
}
