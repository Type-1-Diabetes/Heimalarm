package de.heimalarm.plugin

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject

/**
 * Was ohne laufende App gebraucht wird: Filter für Alarm-Benachrichtigungen (kommen aus den
 * Einstellungen der App, `configure`) und ein Puffer für Alarme, die erkannt wurden, bevor die
 * App offen war (z. B. nach einem Neustart). Die App holt sie beim Start ab.
 */
object Native {
    private const val PREFS = "heimalarm"
    private const val MAX_AGE_MS = 24 * 3600 * 1000L   // ältere Alarme verfallen; spät abgeholte ergänzen nur noch den Einsatz

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun configure(ctx: Context, packages: List<String>, words: List<String>, service: Boolean, silent: Boolean = false,
                  mode: String = "heimalarm", dnd: Boolean = false, torch: Boolean = false, wake: Boolean = false,
                  dndMin: Int = 15, torchSec: Int = 30, wakeSec: Int = 30, restart: Boolean = true, notify: Boolean = true) {
        prefs(ctx).edit()
            .putBoolean("restart", restart)
            .putBoolean("notify", notify)
            .putInt("dndMin", dndMin)
            .putInt("torchSec", torchSec)
            .putInt("wakeSec", wakeSec)
            .putString("mode", mode)
            .putBoolean("dnd", dnd)
            .putBoolean("torch", torch)
            .putBoolean("wake", wake)
            .putString("packages", JSONArray(packages.map { it.lowercase() }).toString())
            .putString("words", JSONArray(words.map { it.lowercase() }).toString())
            .putBoolean("service", service)
            .putBoolean("silent", silent)
            .apply()
    }

    /** Zuletzt gesehene Apps mit Benachrichtigungen (neueste zuletzt, höchstens 12) – für „App erkennen“. */
    @Synchronized
    fun rememberApp(ctx: Context, app: String) {
        val pkg = app.lowercase()
        val old = JSONArray(prefs(ctx).getString("recentApps", "[]"))
        val keep = JSONArray()
        for (i in 0 until old.length()) if (old.optString(i) != pkg) keep.put(old.optString(i))
        keep.put(pkg)
        val out = JSONArray()
        for (i in maxOf(0, keep.length() - 12) until keep.length()) out.put(keep.optString(i))
        prefs(ctx).edit().putString("recentApps", out.toString()).putLong("lastNotification", System.currentTimeMillis()).apply()
    }

    fun recentApps(ctx: Context): JSONArray = JSONArray(prefs(ctx).getString("recentApps", "[]"))
    fun lastNotification(ctx: Context) = prefs(ctx).getLong("lastNotification", 0L)
    fun listenerSeen(ctx: Context) { prefs(ctx).edit().putLong("listenerConnected", System.currentTimeMillis()).apply() }

    fun silent(ctx: Context) = prefs(ctx).getBoolean("silent", false)

    /** Bei Alarm am Handy: heimalarm (Vollbild wie am PC) · app (Alarm-App öffnen) · off (nichts) */
    fun mode(ctx: Context): String = prefs(ctx).getString("mode", null) ?: if (silent(ctx)) "off" else "heimalarm"

    /** Zusatzaktionen (Nicht stören, Taschenlampe, Bildschirm) – nur wenn das Handy bei Alarm etwas tut. */
    fun runExtras(ctx: Context) {
        if (mode(ctx) == "off") return
        val p = prefs(ctx)
        PhoneActions.extras(ctx, p.getBoolean("dnd", false), p.getBoolean("torch", false), p.getBoolean("wake", false),
            p.getInt("dndMin", 15), p.getInt("torchSec", 30), p.getInt("wakeSec", 30))
    }

    fun serviceWanted(ctx: Context) = prefs(ctx).getBoolean("service", true)
    fun restartWanted(ctx: Context) = prefs(ctx).getBoolean("restart", true)
    fun notifyWanted(ctx: Context) = prefs(ctx).getBoolean("notify", true)

    const val EXTRA_BACKGROUND = "heimalarm_background"

    /** Heimalarm starten, ohne es nach vorn zu holen (Auto-Neustart). Android erlaubt das aus dem
     *  Hintergrund nur mit „Über anderen Apps einblenden“. Gibt false zurück, wenn es nicht ging. */
    fun launchSelf(ctx: Context): Boolean {
        if (HeimalarmPlugin.instance?.alive() == true || !PhoneActions.canOverlay(ctx)) return false
        val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return false
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
        launch.putExtra(EXTRA_BACKGROUND, true)
        return try { ctx.startActivity(launch); true } catch (_: Exception) { false }
    }

    private fun list(ctx: Context, key: String): List<String> {
        val a = JSONArray(prefs(ctx).getString(key, "[]"))
        return (0 until a.length()).map { a.getString(it) }.filter { it.isNotBlank() }
    }

    /** Gleiche Regel wie alarmFromNotification in engine.js (grob vorab, genau prüft die App). */
    fun matches(ctx: Context, app: String, title: String, text: String): Boolean {
        val pkgs = list(ctx, "packages")
        if (pkgs.isEmpty() || pkgs.none { app.lowercase().contains(it) }) return false
        val words = list(ctx, "words")
        val body = "$title $text".lowercase()
        return words.isEmpty() || words.any { body.contains(it) }
    }

    @Synchronized
    fun buffer(ctx: Context, app: String, title: String, text: String, ts: Long, handled: Boolean = false) {
        val now = System.currentTimeMillis()
        val old = JSONArray(prefs(ctx).getString("pending", "[]"))
        val keep = JSONArray()
        for (i in 0 until old.length()) {
            val o = old.getJSONObject(i)
            if (now - o.optLong("ts") < MAX_AGE_MS) keep.put(o)
        }
        keep.put(JSONObject().put("app", app).put("title", title).put("text", text).put("ts", ts).put("handled", handled))
        prefs(ctx).edit().putString("pending", keep.toString()).apply()
    }

    /** Gepufferte Alarme abholen und leeren. */
    @Synchronized
    fun takePending(ctx: Context): JSONArray {
        val now = System.currentTimeMillis()
        val all = JSONArray(prefs(ctx).getString("pending", "[]"))
        prefs(ctx).edit().remove("pending").apply()
        val out = JSONArray()
        for (i in 0 until all.length()) {
            val o = all.getJSONObject(i)
            if (now - o.optLong("ts") < MAX_AGE_MS) out.put(o)
        }
        return out
    }

    fun startService(ctx: Context) {
        if (KeepAliveService.running) return
        val intent = Intent(ctx, KeepAliveService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent) else ctx.startService(intent)
    }
}

/** Nach dem Einschalten des Handys: Hintergrund-Dienst wieder starten (wenn er an war). */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val a = intent.action ?: return
        if (a != Intent.ACTION_BOOT_COMPLETED && a != Intent.ACTION_MY_PACKAGE_REPLACED && a != "android.intent.action.QUICKBOOT_POWERON") return
        if (!Native.serviceWanted(context)) return
        try { Native.startService(context) } catch (_: Exception) { /* Android verbietet es manchmal – App öffnet sich dann beim Alarm */ }
        if (Native.restartWanted(context)) Native.launchSelf(context)
    }
}
