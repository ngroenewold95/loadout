package com.groenewold.loadout;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Source of truth for "is loadout on screen right now".
     *
     * The service reads this directly rather than inferring it from the order
     * of lifecycle pings - otherwise starting a timer from inside the app
     * flashes the bubble over the very screen that is already showing it.
     */
    public static volatile boolean isForeground = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins living in the app package must be registered before the
        // bridge starts; auto-discovery only covers installed plugin packages.
        registerPlugin(RestTimerPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /**
     * The floating bubble is only for when you have left the app. While we are
     * in front, the active-workout header renders the countdown instead, so
     * these two hand the timer back and forth.
     *
     * The service ignores these pings when no timer is running, so opening the
     * app normally does not start a foreground service.
     */
    @Override
    public void onResume() {
        super.onResume();
        isForeground = true;
        pingTimerService(RestTimerService.ACTION_APP_FOREGROUND);
    }

    @Override
    public void onPause() {
        super.onPause();
        isForeground = false;
        pingTimerService(RestTimerService.ACTION_APP_BACKGROUND);
    }

    private void pingTimerService(String action) {
        try {
            startService(new Intent(this, RestTimerService.class).setAction(action));
        } catch (IllegalStateException ignored) {
            // Background-start restrictions; the timer keeps running either way.
        }
    }
}
