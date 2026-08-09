package com.groenewold.loadout;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.Settings;
import android.view.Gravity;
import android.view.WindowManager;

import androidx.core.app.NotificationCompat;

/**
 * Hosts the floating rest-timer bubble and its haptics.
 *
 * A foreground service is required for two reasons: it keeps the overlay alive
 * while the app is backgrounded, and it exempts the tick loop from Doze so the
 * vibration lands on time. This is the same shape Progression uses
 * (FOREGROUND_SERVICE_SPECIAL_USE + SYSTEM_ALERT_WINDOW).
 */
public class RestTimerService extends Service {

    public static final String ACTION_START = "loadout.timer.START";
    public static final String ACTION_STOP = "loadout.timer.STOP";
    public static final String ACTION_EXTEND = "loadout.timer.EXTEND";
    /** The app came to the front - the in-app header owns the timer now. */
    public static final String ACTION_APP_FOREGROUND = "loadout.timer.APP_FG";
    /** The app went away - hand the timer back to the floating bubble. */
    public static final String ACTION_APP_BACKGROUND = "loadout.timer.APP_BG";

    public static final String EXTRA_ENDS_AT = "endsAt";
    public static final String EXTRA_TOTAL_MS = "totalMs";
    public static final String EXTRA_EXTEND_MS = "extendMs";

    private static final String CHANNEL_ID = "rest_timer_v2";
    private static final int NOTIFICATION_ID = 1;
    private static final long TICK_MS = 100;

    /** Vibration begins this far before zero. */
    private static final long LEAD_IN_MS = 5000;
    /** Spacing between countdown pulses. */
    private static final long PULSE_INTERVAL_MS = 1000;
    /** Length of each countdown pulse. Long enough to feel like a thump. */
    private static final long PULSE_MS = 90;
    /** The "time's up" buzz. */
    private static final long FINAL_MS = 900;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private WindowManager windowManager;
    private TimerOverlayView overlay;

    private long endsAt;
    private long totalMs;
    private boolean vibrationFired;

    /** Redraws the bubble. Deliberately does NOT drive the haptics. */
    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (overlay != null) overlay.invalidate();
            // Keep counting up past zero; the user dismisses explicitly.
            handler.postDelayed(this, TICK_MS);
        }
    };

    private final Runnable fireVibration = new Runnable() {
        @Override
        public void run() {
            vibrationFired = true;
            playCountdownVibration();
        }
    };

    /**
     * Schedule the haptics on their own timer rather than polling.
     *
     * Driving them off the 100 ms redraw tick meant the pattern inherited that
     * jitter and started up to a tick late, on top of an offset bug. A single
     * postDelayed lands within a few milliseconds, and the foreground service
     * keeps us alive to honour it.
     */
    private void scheduleVibration() {
        handler.removeCallbacks(fireVibration);
        long untilLeadIn = endsAt - LEAD_IN_MS - System.currentTimeMillis();
        if (untilLeadIn <= 0) {
            // Already inside the final five seconds - the waveform's own
            // leading pause absorbs the remainder.
            if (endsAt - System.currentTimeMillis() > 0) handler.post(fireVibration);
            return;
        }
        vibrationFired = false;
        handler.postDelayed(fireVibration, untilLeadIn);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();

        if (ACTION_STOP.equals(action)) {
            stopTimer();
            return START_NOT_STICKY;
        }

        if (ACTION_APP_FOREGROUND.equals(action) || ACTION_APP_BACKGROUND.equals(action)) {
            // Lifecycle pings can arrive with no timer running (the app was
            // simply opened). Do not spin up a foreground service for that.
            if (endsAt == 0) {
                stopSelf();
                return START_NOT_STICKY;
            }
            if (ACTION_APP_FOREGROUND.equals(action)) removeOverlay();
            else showOverlay();
            return START_STICKY;
        }

        if (ACTION_EXTEND.equals(action)) {
            long by = intent.getLongExtra(EXTRA_EXTEND_MS, 30_000);
            endsAt += by;
            totalMs += by;
            // Extending pushes zero back out, so stop any buzz already running
            // and re-arm for the new end time.
            cancelVibration();
            scheduleVibration();
            if (overlay != null) overlay.setTimer(endsAt, totalMs);
            startForegroundNotification();
            return START_STICKY;
        }

        if (intent != null && intent.hasExtra(EXTRA_ENDS_AT)) {
            endsAt = intent.getLongExtra(EXTRA_ENDS_AT, System.currentTimeMillis());
            totalMs = intent.getLongExtra(EXTRA_TOTAL_MS, 1);
            scheduleVibration();
        }

        startForegroundNotification();
        showOverlay();
        handler.removeCallbacks(tick);
        handler.post(tick);
        return START_STICKY;
    }

    // ---------------------------------------------------------------- overlay

    private void showOverlay() {
        // Suppressed while the app is in front; the in-app header shows it.
        if (MainActivity.isForeground) return;
        if (overlay != null) {
            overlay.setTimer(endsAt, totalMs);
            return;
        }
        if (!Settings.canDrawOverlays(this)) return; // no permission; notification still runs

        windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        int size = Math.round(96 * getResources().getDisplayMetrics().density);

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
            size,
            size,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = Math.round(24 * getResources().getDisplayMetrics().density);
        params.y = Math.round(160 * getResources().getDisplayMetrics().density);

        overlay = new TimerOverlayView(this, windowManager, params);
        overlay.setTimer(endsAt, totalMs);
        overlay.onTap = () -> {
            Intent open = new Intent(this, MainActivity.class);
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(open);
        };
        windowManager.addView(overlay, params);
    }

    private void removeOverlay() {
        if (overlay != null && windowManager != null) {
            try {
                windowManager.removeView(overlay);
            } catch (IllegalArgumentException ignored) {
                // already detached
            }
        }
        overlay = null;
    }

    // -------------------------------------------------------------- vibration

    /**
     * The whole final five seconds in ONE waveform.
     *
     * Scheduling a separate alarm per pulse would be the worst possible shape
     * for Doze: setExactAndAllowWhileIdle is throttled to roughly once per nine
     * minutes, so at most one pulse would survive. A single waveform plays the
     * entire pattern from one wake-up, so the throttle never applies.
     *
     *   pulse .. pulse .. pulse .. pulse .. pulse .. LONG
     *   -5s     -4s     -3s     -2s     -1s      0s
     */
    private Vibrator vibrator() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager vm = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            return vm == null ? null : vm.getDefaultVibrator();
        }
        return (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
    }

    private void playCountdownVibration() {
        Vibrator vibrator = vibrator();
        if (vibrator == null || !vibrator.hasVibrator()) return;

        long remaining = Math.max(0, endsAt - System.currentTimeMillis());

        // Waveform timings alternate [wait, buzz, wait, buzz, ...] and every
        // entry consumes real time, so each gap must subtract the pulse that
        // precedes it or the pattern drifts later with every beat.
        //
        //   pulse @ -5s  -4s  -3s  -2s  -1s        LONG @ 0
        long lead = Math.max(0, remaining - LEAD_IN_MS);
        long gap = PULSE_INTERVAL_MS - PULSE_MS;

        long[] timings = {
            lead, PULSE_MS,   // t-5
            gap, PULSE_MS,    // t-4
            gap, PULSE_MS,    // t-3
            gap, PULSE_MS,    // t-2
            gap, PULSE_MS,    // t-1
            gap, FINAL_MS,    // zero
        };
        // Full strength throughout - this has to cut through a gym.
        int[] amplitudes = { 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255 };

        VibrationEffect effect = vibrator.hasAmplitudeControl()
            ? VibrationEffect.createWaveform(timings, amplitudes, -1)
            : VibrationEffect.createWaveform(timings, -1);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // ALARM usage is louder than a notification buzz and is not damped
            // by the notification-vibration setting.
            vibrator.vibrate(
                effect,
                VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM)
            );
        } else {
            vibrator.vibrate(effect);
        }
    }

    // ----------------------------------------------------------- notification

    private void startForegroundNotification() {
        ensureChannel();

        PendingIntent open = PendingIntent.getActivity(
            this,
            0,
            new Intent(this, MainActivity.class),
            PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("Rest")
            .setWhen(endsAt)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(open)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(0, "+30s", servicePendingIntent(ACTION_EXTEND, 1))
            .addAction(0, "Skip", servicePendingIntent(ACTION_STOP, 2));

        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(
                NOTIFICATION_ID,
                b.build(),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            );
        } else {
            startForeground(NOTIFICATION_ID, b.build());
        }
    }

    private PendingIntent servicePendingIntent(String action, int requestCode) {
        Intent i = new Intent(this, RestTimerService.class).setAction(action);
        return PendingIntent.getService(this, requestCode, i, PendingIntent.FLAG_IMMUTABLE);
    }

    private void ensureChannel() {
        NotificationManager mgr = getSystemService(NotificationManager.class);
        if (mgr.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Rest timer",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Countdown between sets");
        channel.setShowBadge(false);
        channel.setSound(null, null);
        channel.enableVibration(false);
        mgr.createNotificationChannel(channel);
    }

    // ------------------------------------------------------------- lifecycle

    /** Skip during the final five seconds must silence the buzz immediately. */
    private void cancelVibration() {
        handler.removeCallbacks(fireVibration);
        Vibrator v = vibrator();
        if (v != null) v.cancel();
    }

    private void stopTimer() {
        handler.removeCallbacks(tick);
        cancelVibration();
        removeOverlay();
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(tick);
        cancelVibration();
        removeOverlay();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
