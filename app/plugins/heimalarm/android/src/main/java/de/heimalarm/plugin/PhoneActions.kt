package de.heimalarm.plugin

import android.app.ActivityOptions
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings

/**
 * Handy-Aktionen bei Alarm (laufen nativ, auch wenn die WebView schläft):
 * Alarm-App öffnen, „Nicht stören“ durchbrechen, Taschenlampe blinken, Bildschirm an, Navigation.
 *
 * Android erlaubt das Öffnen fremder Apps aus dem Hintergrund nur, wenn Heimalarm gerade sichtbar ist
 * oder „Über anderen Apps einblenden“ erlaubt ist. Sonst öffnet die Vollbild-Meldung zuerst Heimalarm,
 * und Heimalarm reicht dann an die Alarm-App weiter (HeimalarmPlugin.onNewIntent / onResume).
 */
object PhoneActions {
    const val EXTRA_OPEN_APP = "de.heimalarm.plugin.OPEN_APP"
    private const val MAX_AGE_MS = 10 * 60 * 1000L

    private val handler = Handler(Looper.getMainLooper())
    private data class Remembered(val intent: PendingIntent?, val ts: Long)
    private val last = HashMap<String, Remembered>()

    /** Heimalarm ist gerade im Vordergrund (vom Plugin gesetzt). */
    @Volatile var visible = false
    /** Wartet darauf, dass Heimalarm sichtbar wird, um dann diese App zu öffnen. */
    @Volatile var pendingOpen: String? = null
        set(v) { field = v; pendingAt = System.currentTimeMillis() }
    @Volatile private var pendingAt = 0L

    /** Tipp-Ziel der Alarm-Benachrichtigung merken (öffnet den Einsatz direkt in der App). */
    @Synchronized
    fun remember(pkg: String, intent: PendingIntent?) {
        last[pkg.lowercase()] = Remembered(intent, System.currentTimeMillis())
    }

    @Synchronized
    private fun intentFor(pkg: String): PendingIntent? {
        val now = System.currentTimeMillis()
        val key = pkg.lowercase()
        last[key]?.let { if (now - it.ts < MAX_AGE_MS) return it.intent }
        // Teil des Paketnamens (z. B. Einstellung „divera“) oder zuletzt gesehene App
        return last.entries.filter { now - it.value.ts < MAX_AGE_MS && (key.isEmpty() || it.key.contains(key)) }
            .maxByOrNull { it.value.ts }?.value?.intent
    }

    @Synchronized
    private fun lastPkg(): String = last.maxByOrNull { it.value.ts }?.key ?: ""

    fun canOverlay(ctx: Context) = Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(ctx)

    /** Darf Heimalarm jetzt eine andere App nach vorn holen? */
    fun canStartNow(ctx: Context) = visible || canOverlay(ctx)

    /**
     * Alarm-App öffnen: erst die Alarm-Benachrichtigung „antippen“ (öffnet den Einsatz),
     * sonst die App normal starten. Gibt false zurück, wenn Android es gerade nicht erlaubt.
     */
    fun openApp(ctx: Context, pkg: String): Boolean {
        if (!canStartNow(ctx)) return false
        val pi = intentFor(pkg)
        if (pi != null) {
            try {
                val opts = ActivityOptions.makeBasic()
                if (Build.VERSION.SDK_INT >= 34) {
                    @Suppress("DEPRECATION")
                    opts.setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED)
                }
                pi.send(ctx, 0, null, null, null, null, opts.toBundle())
                return true
            } catch (_: Exception) { /* Benachrichtigung schon weg → App normal starten */ }
        }
        val target = pkg.ifEmpty { lastPkg() }
        if (target.isEmpty()) return false
        val launch = ctx.packageManager.getLaunchIntentForPackage(target) ?: return false
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
        return try { ctx.startActivity(launch); true } catch (_: Exception) { false }
    }

    /** Wenn Heimalarm sichtbar wird und noch eine App geöffnet werden soll: jetzt öffnen. */
    fun flushPending(ctx: Context) {
        val pkg = pendingOpen ?: return
        val fresh = System.currentTimeMillis() - pendingAt < MAX_AGE_MS
        pendingOpen = null
        if (!fresh) return   // Alarm ist zu alt – nicht mehr die Alarm-App aufreißen
        handler.postDelayed({
            if (openApp(ctx, pkg)) ctx.getSystemService(NotificationManager::class.java).cancel(AlarmSound.NOTIFY_ID)
        }, 250)
    }

    // ── „Nicht stören“ durchbrechen ─────────────────────────
    private var savedFilter: Int? = null
    private val restoreDnd = Runnable { restoreDnd(null) }

    fun hasDndAccess(ctx: Context) =
        Build.VERSION.SDK_INT < 23 || ctx.getSystemService(NotificationManager::class.java).isNotificationPolicyAccessGranted

    /** „Nicht stören“ für `minutes` aufheben, danach wieder wie vorher. */
    @Synchronized
    fun breakDnd(ctx: Context, minutes: Int) {
        if (Build.VERSION.SDK_INT < 23 || !hasDndAccess(ctx)) return
        val nm = ctx.getSystemService(NotificationManager::class.java)
        val cur = nm.currentInterruptionFilter
        if (cur != NotificationManager.INTERRUPTION_FILTER_ALL) {
            if (savedFilter == null) savedFilter = cur
            try { nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL) } catch (_: Exception) { return }
        }
        handler.removeCallbacks(restoreDnd)
        if (savedFilter != null) handler.postDelayed({ restoreDnd(ctx.applicationContext) }, minutes.coerceIn(1, 120) * 60_000L)
    }

    @Synchronized
    private fun restoreDnd(ctx: Context?) {
        val f = savedFilter ?: return
        savedFilter = null
        if (ctx == null || Build.VERSION.SDK_INT < 23) return
        try { ctx.getSystemService(NotificationManager::class.java).setInterruptionFilter(f) } catch (_: Exception) {}
    }

    // ── Taschenlampe blinken ────────────────────────────────
    private var torchOn = false
    private var torchUntil = 0L
    private var torchCtx: Context? = null
    private val blink = object : Runnable {
        override fun run() {
            val ctx = torchCtx ?: return
            if (System.currentTimeMillis() > torchUntil) { setTorch(ctx, false); torchCtx = null; return }
            torchOn = !torchOn
            if (!setTorch(ctx, torchOn)) { torchCtx = null; return }
            handler.postDelayed(this, if (torchOn) 120L else 380L)
        }
    }

    private fun torchCamera(cm: CameraManager): String? = cm.cameraIdList.firstOrNull {
        cm.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
    }

    private fun setTorch(ctx: Context, on: Boolean): Boolean {
        if (Build.VERSION.SDK_INT < 23) return false
        return try {
            val cm = ctx.getSystemService(Context.CAMERA_SERVICE) as CameraManager
            val id = torchCamera(cm) ?: return false
            cm.setTorchMode(id, on)
            true
        } catch (_: Exception) { false }   // Kamera belegt oder keine Lampe
    }

    fun hasTorch(ctx: Context): Boolean = try {
        Build.VERSION.SDK_INT >= 23 && torchCamera(ctx.getSystemService(Context.CAMERA_SERVICE) as CameraManager) != null
    } catch (_: Exception) { false }

    fun blinkTorch(ctx: Context, seconds: Int) {
        handler.removeCallbacks(blink)
        torchCtx = ctx.applicationContext
        torchUntil = System.currentTimeMillis() + seconds.coerceIn(3, 300) * 1000L
        torchOn = false
        handler.post(blink)
    }

    fun stopTorch(ctx: Context) {
        handler.removeCallbacks(blink)
        if (torchCtx != null || torchOn) setTorch(ctx, false)
        torchCtx = null
        torchOn = false
    }

    // ── Bildschirm einschalten ──────────────────────────────
    @Suppress("DEPRECATION")
    fun wakeScreen(ctx: Context, seconds: Int = 30) {
        try {
            val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
            val wl = pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE, "heimalarm:wake")
            wl.acquire(seconds.coerceIn(5, 300) * 1000L)
        } catch (_: Exception) {}
    }

    // ── Navigation ──────────────────────────────────────────
    /** Navigation zum Ziel starten (Adresse oder „52.1,10.2“). Google Maps, sonst jede Karten-App. */
    fun navigate(ctx: Context, target: String): Boolean {
        val q = Uri.encode(target.trim())
        if (q.isEmpty()) return false
        val tries = listOf("google.navigation:q=$q", "geo:0,0?q=$q")
        for (u in tries) {
            try {
                ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                return true
            } catch (_: ActivityNotFoundException) {
            } catch (_: Exception) { return false }
        }
        return false
    }

    /** Was bei jedem Alarm am Handy zusätzlich passiert (Einstellungen „Bei Alarm zusätzlich“). */
    fun extras(ctx: Context, dnd: Boolean, torch: Boolean, wake: Boolean, dndMin: Int = 15, torchSec: Int = 30, wakeSec: Int = 30) {
        if (dnd) breakDnd(ctx, dndMin)
        if (wake) wakeScreen(ctx, wakeSec)
        if (torch) blinkTorch(ctx, torchSec)
    }
}
