package de.heimalarm.plugin

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager

/**
 * Abgleich im Hintergrund (Einsätze, Einstellungen, Protokolle → PC bzw. Zentrale).
 *
 * Ohne das schläft das Handy bei ausgeschaltetem Bildschirm: Der Vordergrund-Dienst hält zwar den
 * Prozess am Leben, aber nicht die CPU, und die WebView läuft nach onPause nur noch gebremst.
 * Der Abgleich passierte darum erst, wenn man die App öffnete.
 *
 * - Wecker (AlarmManager, darf auch im Doze-Modus wecken; Android legt ihn dort auf höchstens
 *   alle ~10 Minuten) → kurz wach halten → App bekommt „background-sync“ und gleicht ab.
 * - Bei einem erkannten Alarm: 90 s wach halten, damit Einsatz speichern, an PCs senden,
 *   Routinen und Abgleich sicher durchlaufen.
 */
object BgSync {
    private const val PREFS = "heimalarm"
    private const val ACTION = "de.heimalarm.plugin.BG_SYNC"
    private const val SYNC_HOLD_MS = 45_000L
    private const val ALARM_HOLD_MS = 90_000L

    private var syncLock: PowerManager.WakeLock? = null
    private var alarmLock: PowerManager.WakeLock? = null

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    fun minutes(ctx: Context) = prefs(ctx).getInt("bgSyncMin", 0)

    /** Abstand in Minuten speichern und den Wecker stellen (0 = aus). */
    fun setup(ctx: Context, minutes: Int) {
        prefs(ctx).edit().putInt("bgSyncMin", minutes.coerceIn(0, 24 * 60)).apply()
        schedule(ctx)
    }

    private fun pending(ctx: Context): PendingIntent {
        val i = Intent(ctx, BgSyncReceiver::class.java).setAction(ACTION)
        return PendingIntent.getBroadcast(ctx, 7, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /** Nächsten Wecker stellen (ersetzt einen schon gestellten). */
    fun schedule(ctx: Context) {
        val am = ctx.getSystemService(AlarmManager::class.java) ?: return
        val min = minutes(ctx)
        if (min <= 0) { am.cancel(pending(ctx)); return }
        val at = System.currentTimeMillis() + min * 60_000L
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(ctx))
            else am.set(AlarmManager.RTC_WAKEUP, at, pending(ctx))
        } catch (_: Exception) { /* sehr selten: zu viele Wecker – nächster Versuch beim Öffnen */ }
    }

    private fun lock(ctx: Context, tag: String): PowerManager.WakeLock =
        ctx.getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, tag).apply { setReferenceCounted(false) }

    /** Wecker abgelaufen: CPU wach halten und die App abgleichen lassen. */
    @Synchronized
    fun wake(ctx: Context) {
        val plugin = HeimalarmPlugin.instance?.takeIf { it.alive() } ?: return   // App läuft nicht – nichts abzugleichen
        val l = syncLock ?: lock(ctx.applicationContext, "heimalarm:sync").also { syncLock = it }
        try { l.acquire(SYNC_HOLD_MS) } catch (_: Exception) {}
        plugin.emitBackgroundSync()
    }

    /** Die App ist mit dem Abgleich fertig – wieder schlafen lassen. */
    @Synchronized
    fun done() {
        syncLock?.let { if (it.isHeld) try { it.release() } catch (_: Exception) {} }
    }

    /** Alarm erkannt: kurz wach halten, damit die App ihn vollständig verarbeitet. */
    @Synchronized
    fun holdForAlarm(ctx: Context) {
        val l = alarmLock ?: lock(ctx.applicationContext, "heimalarm:alarm").also { alarmLock = it }
        try { l.acquire(ALARM_HOLD_MS) } catch (_: Exception) {}
    }
}

/** Wecker für den Hintergrund-Abgleich. */
class BgSyncReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        BgSync.schedule(context)   // zuerst den nächsten stellen – falls unten etwas schiefgeht
        BgSync.wake(context)
    }
}
