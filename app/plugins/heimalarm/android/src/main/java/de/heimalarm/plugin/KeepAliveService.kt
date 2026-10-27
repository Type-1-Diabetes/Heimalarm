package de.heimalarm.plugin

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/** Vordergrund-Dienst mit dauerhafter Mitteilung, damit Android die App nicht beendet. */
class KeepAliveService : Service() {
    companion object {
        var running = false
        private const val CHANNEL = "heimalarm_dienst_still"
        private const val OLD_CHANNEL = "heimalarm_dienst"
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Alter Kanal (IMPORTANCE_LOW) konnte als Pop-up erscheinen; Wichtigkeit lässt sich nicht nachträglich ändern.
            nm.deleteNotificationChannel(OLD_CHANNEL)
            val ch = NotificationChannel(CHANNEL, "Heimalarm im Hintergrund", NotificationManager.IMPORTANCE_MIN)
            ch.setShowBadge(false)
            ch.setSound(null, null)
            ch.enableVibration(false)
            nm.createNotificationChannel(ch)
        }
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
        val notification = builder
            .setContentTitle("Heimalarm ist bereit")
            .setContentText("Empfängt Alarme im Hintergrund")
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setPriority(Notification.PRIORITY_MIN)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setVisibility(Notification.VISIBILITY_SECRET)
            .apply { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_DEFERRED) }
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(1, notification)
        }
        running = true
        return START_STICKY
    }

    /** App aus der Übersicht gewischt: Auto-Neustart startet sie gleich wieder im Hintergrund. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        if (Native.restartWanted(this)) android.os.Handler(mainLooper).postDelayed({ Native.launchSelf(this) }, 1500)
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        running = false
        super.onDestroy()
    }
}
