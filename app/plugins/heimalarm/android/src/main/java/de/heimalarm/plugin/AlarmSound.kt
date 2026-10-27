package de.heimalarm.plugin

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import java.io.File

/**
 * Alarm am Handy: Ton als Wecker (hörbar auch im Lautlos-Modus, Lautstärke „Wecker“),
 * Vibration und Vollbild-Meldung, die auch auf dem Sperrbildschirm erscheint.
 * Läuft unabhängig von der WebView weiter, bis „Stopp“ oder die Zeit abgelaufen ist.
 */
object AlarmSound {
    private const val CHANNEL = "heimalarm_alarm"
    const val NOTIFY_ID = 2
    const val ACTION_STOP = "de.heimalarm.plugin.STOP_ALARM"

    private var player: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private val handler = Handler(Looper.getMainLooper())
    private val stopLater = Runnable { stopSound() }

    fun soundsDir(ctx: Context): File = File(ctx.filesDir, "sounds").apply { mkdirs() }

    /** Eingebauter Melder-Zweiklang als WAV (einmal erzeugt). */
    private fun melder(ctx: Context): File {
        val f = File(ctx.filesDir, "melder.wav")
        if (f.exists()) return f
        val rate = 44100
        val n = rate * 3
        val pcm = ShortArray(n)
        for (i in 0 until n) {
            val t = i.toDouble() / rate
            val c = t % 0.6
            val on = t < 1.8 && (c < 0.28 || (c >= 0.3 && c < 0.58))
            if (on) {
                val freq = if (c < 0.3) 880.0 else 660.0
                val local = c % 0.3
                val edge = minOf(local, 0.28 - local).coerceIn(0.0, 0.01) / 0.01
                val sq = if ((t * freq) % 1.0 < 0.5) 1.0 else -1.0
                pcm[i] = (sq * 0.6 * edge * Short.MAX_VALUE).toInt().toShort()
            }
        }
        val data = java.nio.ByteBuffer.allocate(44 + n * 2).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        data.put("RIFF".toByteArray()).putInt(36 + n * 2).put("WAVE".toByteArray())
        data.put("fmt ".toByteArray()).putInt(16).putShort(1).putShort(1).putInt(rate).putInt(rate * 2).putShort(2).putShort(16)
        data.put("data".toByteArray()).putInt(n * 2)
        pcm.forEach { data.putShort(it) }
        f.writeBytes(data.array())
        return f
    }

    /** Ton-Datei: eigener Ton (id = Dateiname in sounds/) oder Melder-Ton. */
    private fun toneFile(ctx: Context, tone: String): File {
        if (tone.isNotEmpty() && !tone.contains('/')) {
            val f = File(soundsDir(ctx), tone)
            if (f.exists()) return f
        }
        return melder(ctx)
    }

    /** Ton spielen. volume 0–100 (innerhalb der Wecker-Lautstärke), ms = Dauer, 0 = bis stop. */
    @Synchronized
    fun play(ctx: Context, tone: String, volume: Int, ms: Long) {
        stopSound()
        val mp = MediaPlayer()
        mp.setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
        )
        try {
            mp.setDataSource(ctx, Uri.fromFile(toneFile(ctx, tone)))
            mp.prepare()
        } catch (e: Exception) {
            // Datei kaputt oder Format unbekannt → Melder-Ton
            mp.reset()
            mp.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build())
            mp.setDataSource(ctx, Uri.fromFile(melder(ctx)))
            mp.prepare()
        }
        val v = (volume.coerceIn(0, 100) / 100f)
        mp.setVolume(v, v)
        mp.isLooping = true
        mp.start()
        player = mp
        if (ms > 0) handler.postDelayed(stopLater, ms)
    }

    @Synchronized
    fun stopSound() {
        handler.removeCallbacks(stopLater)
        player?.let { try { it.stop() } catch (_: Exception) {}; it.release() }
        player = null
        vibrator?.cancel()
        vibrator = null
    }

    fun vibrate(ctx: Context) {
        val vib = if (Build.VERSION.SDK_INT >= 31) {
            (ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION") ctx.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        val pattern = longArrayOf(0, 600, 300, 600, 300, 1200, 800)
        if (Build.VERSION.SDK_INT >= 26) vib.vibrate(VibrationEffect.createWaveform(pattern, 0))
        else @Suppress("DEPRECATION") vib.vibrate(pattern, 0)
        vibrator = vib
    }

    /** Mitteilung mit hoher Priorität. fullscreen = öffnet die App auch auf dem Sperrbildschirm. */
    fun notifyAlarm(ctx: Context, title: String, text: String, fullscreen: Boolean) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            val ch = NotificationChannel(CHANNEL, "Alarm", NotificationManager.IMPORTANCE_HIGH)
            ch.description = "Einsatz-Alarm von Heimalarm"
            ch.setSound(null, null)          // Ton spielt Heimalarm selbst (Wecker-Lautstärke)
            ch.enableVibration(false)        // Vibration ebenfalls selbst, abhängig von der Einstellung
            ch.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            ch.setBypassDnd(true)
            nm.createNotificationChannel(ch)
        }
        val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)!!.apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val open = PendingIntent.getActivity(ctx, 10, launch, flags)
        val stop = PendingIntent.getBroadcast(ctx, 11, Intent(ctx, StopReceiver::class.java).setAction(ACTION_STOP), flags)
        val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(ctx, CHANNEL) else @Suppress("DEPRECATION") Notification.Builder(ctx).setPriority(Notification.PRIORITY_MAX)
        b.setContentTitle(title)
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setCategory(Notification.CATEGORY_ALARM)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setContentIntent(open)
            .setDeleteIntent(stop)
            .setAutoCancel(true)
            .setOngoing(true)
        if (Build.VERSION.SDK_INT >= 23) {
            b.addAction(Notification.Action.Builder(null, "Stopp", stop).build())
        }
        if (fullscreen) b.setFullScreenIntent(open, true)
        nm.notify(NOTIFY_ID, b.build())
    }

    fun cancel(ctx: Context) {
        stopSound()
        ctx.getSystemService(NotificationManager::class.java).cancel(NOTIFY_ID)
    }

    /** Wecker-Lautstärke des Handys in Prozent. */
    fun alarmVolume(ctx: Context): Int {
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val max = am.getStreamMaxVolume(AudioManager.STREAM_ALARM).coerceAtLeast(1)
        return Math.round(am.getStreamVolume(AudioManager.STREAM_ALARM) * 100f / max)
    }

    fun setAlarmVolume(ctx: Context, percent: Int) {
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val max = am.getStreamMaxVolume(AudioManager.STREAM_ALARM)
        am.setStreamVolume(AudioManager.STREAM_ALARM, Math.round(percent.coerceIn(0, 100) * max / 100f), 0)
    }
}

/** Knopf „Stopp“ oder Wegwischen der Mitteilung. */
class StopReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        AlarmSound.cancel(context)
    }
}
