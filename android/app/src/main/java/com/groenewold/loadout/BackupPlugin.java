package com.groenewold.loadout;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;

import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Copy the database out to a folder that survives uninstall.
 *
 * This is the half `backup.ts` cannot do. App-private storage and
 * `Android/data/<pkg>` are both removed when the app is, which is the actual
 * threat to five years of history, and an arbitrary external path is not
 * writable on modern Android. So the destination is a **SAF tree uri the user
 * picks once**, held with a persistable permission, and the bytes are streamed
 * into it through DocumentFile.
 *
 * The tree uri lives in SharedPreferences rather than in `app_settings`. It is
 * a fact about this installation, not about the training data, and putting it
 * in the database would mean a restored backup pointed at whatever folder the
 * old installation used. Re-picking after a reinstall is one tap, and the whole
 * point of the reinstall case is that the files are still there to find.
 */
@CapacitorPlugin(name = "Backup")
public class BackupPlugin extends Plugin {

    private static final String PREFS = "loadout.backup";
    private static final String KEY_TREE = "treeUri";
    /** `YYYY-MM-DD` of the last successful export, for the once-a-day throttle. */
    private static final String KEY_LAST_DAY = "lastExportDay";

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Where exports go, or null when nothing has been picked yet. */
    @PluginMethod
    public void folder(PluginCall call) {
        JSObject result = new JSObject();
        String tree = prefs().getString(KEY_TREE, null);
        result.put("uri", tree);
        result.put("label", tree == null ? null : labelFor(Uri.parse(tree)));
        result.put("lastExportDay", prefs().getString(KEY_LAST_DAY, null));
        call.resolve(result);
    }

    /** Open the system folder picker and keep whatever comes back. */
    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        );
        startActivityForResult(call, intent, "folderPicked");
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("uri", (String) null);
            call.resolve(cancelled);
            return;
        }
        Uri tree = result.getData().getData();
        // Without taking it persistably the grant dies with the process, and
        // the launch export would silently stop working after a reboot.
        getContext()
            .getContentResolver()
            .takePersistableUriPermission(
                tree,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            );
        prefs().edit().putString(KEY_TREE, tree.toString()).apply();

        JSObject out = new JSObject();
        out.put("uri", tree.toString());
        out.put("label", labelFor(tree));
        call.resolve(out);
    }

    /**
     * Move a staging file into the chosen folder.
     *
     * The staging file is deleted afterwards whatever happens: it is a second
     * full copy of the database sitting in app-private storage, and leaving one
     * behind per export would quietly fill the device.
     */
    @PluginMethod
    public void copyOut(PluginCall call) {
        String path = call.getString("path");
        String name = call.getString("name");
        if (path == null || name == null) {
            call.reject("path and name are required");
            return;
        }
        File staged = new File(path);
        DocumentFile dir = treeFolder();
        if (dir == null) {
            staged.delete();
            call.reject("no export folder has been chosen");
            return;
        }

        try {
            DocumentFile existing = dir.findFile(name);
            if (existing != null) existing.delete();
            DocumentFile target = dir.createFile("application/octet-stream", name);
            if (target == null) {
                call.reject("could not create " + name + " in the chosen folder");
                return;
            }
            try (InputStream in = new FileInputStream(staged);
                 OutputStream out = getContext().getContentResolver().openOutputStream(target.getUri())) {
                if (out == null) {
                    call.reject("could not open " + name + " for writing");
                    return;
                }
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
            }
            prefs().edit().putString(KEY_LAST_DAY, call.getString("day", "")).apply();

            JSObject out = new JSObject();
            out.put("name", name);
            out.put("bytes", staged.length());
            call.resolve(out);
        } catch (Exception e) {
            call.reject("export failed: " + e.getMessage(), e);
        } finally {
            staged.delete();
        }
    }

    /** Every export already in the folder, so the pruning policy can run in TS. */
    @PluginMethod
    public void list(PluginCall call) {
        DocumentFile dir = treeFolder();
        JSArray names = new JSArray();
        if (dir != null) {
            for (DocumentFile file : dir.listFiles()) {
                if (file.isFile() && file.getName() != null) names.put(file.getName());
            }
        }
        JSObject out = new JSObject();
        out.put("names", names);
        call.resolve(out);
    }

    /** Delete the names the caller decided are surplus. Never decides itself. */
    @PluginMethod
    public void deleteFiles(PluginCall call) {
        DocumentFile dir = treeFolder();
        int deleted = 0;
        try {
            JSArray names = call.getArray("names", new JSArray());
            if (dir != null && names != null) {
                for (Object name : names.toList()) {
                    DocumentFile file = dir.findFile(String.valueOf(name));
                    if (file != null && file.delete()) deleted++;
                }
            }
        } catch (org.json.JSONException e) {
            call.reject("names must be an array of strings", e);
            return;
        }
        JSObject out = new JSObject();
        out.put("deleted", deleted);
        call.resolve(out);
    }

    private DocumentFile treeFolder() {
        String tree = prefs().getString(KEY_TREE, null);
        if (tree == null) return null;
        DocumentFile dir = DocumentFile.fromTreeUri(getContext(), Uri.parse(tree));
        return dir != null && dir.canWrite() ? dir : null;
    }

    /** Something a person recognises, rather than a content uri. */
    private String labelFor(Uri tree) {
        DocumentFile dir = DocumentFile.fromTreeUri(getContext(), tree);
        String name = dir == null ? null : dir.getName();
        return name != null ? name : tree.getLastPathSegment();
    }
}
