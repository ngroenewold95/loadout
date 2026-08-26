package com.groenewold.loadout;

import android.view.WindowManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Keep the screen on while training.
 *
 * FLAG_KEEP_SCREEN_ON is a window flag, so it can only be set on the activity's
 * own window and only from the UI thread. A wake lock would be the wrong tool:
 * this is scoped to the screen being visible, and the flag is released the
 * moment the activity goes away, which is exactly the behaviour wanted if the
 * phone is pocketed mid-workout.
 *
 * Turned on when a session is live and the setting is on, and off on both the
 * setting going off and the session ending. Nothing here persists: the setting
 * lives in SQLite and is re-applied on launch.
 */
@CapacitorPlugin(name = "AppScreen")
public class AppScreenPlugin extends Plugin {

    @PluginMethod
    public void setKeepAwake(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        final android.app.Activity activity = getActivity();
        if (activity == null) {
            call.reject("no activity");
            return;
        }
        activity.runOnUiThread(() -> {
            if (on) {
                activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            } else {
                activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
        });
        call.resolve();
    }
}
