package com.groenewold.loadout;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS-facing control surface for the rest timer.
 *
 * All the real work lives in RestTimerService; this just starts, stops and
 * extends it, and brokers the overlay permission.
 */
@CapacitorPlugin(name = "RestTimer")
public class RestTimerPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        Long endsAt = call.getLong("endsAt");
        if (endsAt == null) {
            call.reject("endsAt (epoch millis) is required");
            return;
        }
        long totalMs = call.getLong("totalMs", Math.max(1, endsAt - System.currentTimeMillis()));

        Intent i = new Intent(getContext(), RestTimerService.class)
            .setAction(RestTimerService.ACTION_START)
            .putExtra(RestTimerService.EXTRA_ENDS_AT, endsAt.longValue())
            .putExtra(RestTimerService.EXTRA_TOTAL_MS, totalMs);
        getContext().startForegroundService(i);

        JSObject result = new JSObject();
        result.put("endsAt", endsAt);
        result.put("overlay", canDrawOverlays());
        call.resolve(result);
    }

    @PluginMethod
    public void extend(PluginCall call) {
        long by = call.getLong("ms", 30_000L);
        Intent i = new Intent(getContext(), RestTimerService.class)
            .setAction(RestTimerService.ACTION_EXTEND)
            .putExtra(RestTimerService.EXTRA_EXTEND_MS, by);
        getContext().startForegroundService(i);
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        Intent i = new Intent(getContext(), RestTimerService.class)
            .setAction(RestTimerService.ACTION_STOP);
        getContext().startService(i);
        call.resolve();
    }

    /**
     * The running timer, if there is one.
     *
     * Read on mount so a cold start recovers the countdown. The JS side holds
     * `endsAt` in memory, so killing the app used to lose the in-app countdown
     * while the service kept counting and the bubble kept drawing.
     *
     * Reads the service's static fields rather than binding to it: this is one
     * long, and a bind/unbind dance around it would be far more lifecycle than
     * the question deserves.
     */
    @PluginMethod
    public void state(PluginCall call) {
        long endsAt = RestTimerService.sEndsAt;
        JSObject result = new JSObject();
        result.put("running", endsAt > 0);
        result.put("endsAt", endsAt);
        result.put("totalMs", RestTimerService.sTotalMs);
        call.resolve(result);
    }

    // ------------------------------------------------------------ permissions

    private boolean canDrawOverlays() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(getContext());
    }

    @PluginMethod
    public void permissionState(PluginCall call) {
        JSObject result = new JSObject();
        result.put("notifications", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        result.put("overlay", canDrawOverlays());
        result.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(result);
    }

    /**
     * Opens the system overlay-permission screen.
     *
     * Since Android 11 this cannot be deep-linked to a toggle, so the user
     * lands on the app's entry in the "Display over other apps" list and flips
     * it themselves. There is no way to grant it silently.
     */
    @PluginMethod
    public void requestOverlayPermission(PluginCall call) {
        if (canDrawOverlays()) {
            JSObject r = new JSObject();
            r.put("granted", true);
            call.resolve(r);
            return;
        }
        Intent intent = new Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:" + getContext().getPackageName())
        );
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);

        JSObject r = new JSObject();
        r.put("granted", false);
        r.put("opened", true);
        call.resolve(r);
    }
}
