package app.handshake.android;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Handshake for Android.
 *
 * The interface is the same web app as on desktop, bundled inside the APK
 * and served from a private https origin so camera and microphone work.
 * Nothing is loaded from the internet except the encrypted relay
 * connections the app opens itself; any other request is refused.
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String ORIGIN = "https://" + HOST;
    private static final int REQ_MEDIA = 10;
    private static final int REQ_FILE = 11;
    private static final int REQ_NOTIFY = 12;

    private static final String CSP = "default-src 'self'; script-src 'self'; style-src 'self'; "
            + "img-src 'self' data: blob:; media-src 'self' blob: mediastream:; font-src 'self'; "
            + "connect-src 'self' wss:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; "
            + "form-action 'none'; frame-src 'none'; frame-ancestors 'none'";

    private WebView web;
    private PermissionRequest pendingPermission;
    private ValueCallback<Uri[]> fileCallback;
    private volatile String initialLink;
    private boolean inCall = false;
    private boolean askedNotifications = false;
    private SharedPreferences prefs;
    private final Map<String, Save> saves = new HashMap<>();

    private static final class Save {
        OutputStream out;
        Uri uri;
        String label;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("handshake", MODE_PRIVATE);
        if (prefs.getBoolean("secure", true)) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
        setVolumeControlStream(AudioManager.STREAM_VOICE_CALL);

        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debuggable);
        CookieManager.getInstance().setAcceptCookie(false);

        web = new WebView(this);
        web.setBackgroundColor(0xFFFFFFFF);
        web.setFitsSystemWindows(true);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setGeolocationEnabled(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSafeBrowsingEnabled(false);
        s.setSupportZoom(false);

        web.addJavascriptInterface(new Bridge(), "HandshakeAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        initialLink = linkFrom(getIntent());
        web.loadUrl(ORIGIN + "/index.html");
    }

    private static String linkFrom(Intent intent) {
        if (intent == null || intent.getData() == null) return null;
        Uri data = intent.getData();
        return "handshake".equals(data.getScheme()) ? data.toString() : null;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String link = linkFrom(intent);
        if (link != null && web != null) {
            web.evaluateJavascript("window.__handshakeOpen && window.__handshakeOpen(" + JSONObject.quote(link) + ")", null);
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript("window.__handshakeBack ? window.__handshakeBack() : false", value -> {
            if (!"true".equals(value)) moveTaskToBack(true);
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (!inCall && web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onDestroy() {
        stopService(new Intent(this, CallService.class));
        if (web != null) {
            web.removeJavascriptInterface("HandshakeAndroid");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    // ---------------------------------------------------------------- web

    private class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (!HOST.equals(url.getHost()) || !"https".equals(url.getScheme())) {
                // The app never fetches anything else over http(s).
                return blocked();
            }
            String path = url.getPath();
            if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
            if (path.contains("..")) return blocked();
            try {
                InputStream in = getAssets().open("www" + path);
                WebResourceResponse res = new WebResourceResponse(mimeType(path), null, in);
                Map<String, String> headers = new HashMap<>();
                headers.put("Content-Security-Policy", CSP);
                headers.put("X-Content-Type-Options", "nosniff");
                headers.put("Referrer-Policy", "no-referrer");
                headers.put("Cache-Control", "no-cache");
                res.setResponseHeaders(headers);
                return res;
            } catch (IOException e) {
                return notFound();
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (HOST.equals(url.getHost())) return false;
            if ("https".equals(url.getScheme())) openExternal(url);
            return true;
        }
    }

    private static WebResourceResponse blocked() {
        WebResourceResponse r = new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0]));
        r.setStatusCodeAndReasonPhrase(403, "Blocked");
        return r;
    }

    private static WebResourceResponse notFound() {
        WebResourceResponse r = new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0]));
        r.setStatusCodeAndReasonPhrase(404, "Not found");
        return r;
    }

    private static String mimeType(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "text/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".woff2")) return "font/woff2";
        if (path.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    private class Chrome extends WebChromeClient {
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> handlePermission(request));
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest request) {
            if (pendingPermission == request) pendingPermission = null;
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
            pick.addCategory(Intent.CATEGORY_OPENABLE);
            pick.setType("*/*");
            try {
                startActivityForResult(Intent.createChooser(pick, "Share a file"), REQ_FILE);
            } catch (Exception e) {
                fileCallback = null;
                return false;
            }
            return true;
        }
    }

    private void handlePermission(PermissionRequest request) {
        Uri origin = request.getOrigin();
        if (origin == null || !HOST.equals(origin.getHost())) {
            request.deny();
            return;
        }
        List<String> missing = new ArrayList<>();
        for (String r : request.getResources()) {
            String p = androidPermission(r);
            if (p != null && checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED && !missing.contains(p)) missing.add(p);
        }
        if (missing.isEmpty()) {
            grantAllowed(request);
            return;
        }
        if (pendingPermission != null) pendingPermission.deny();
        pendingPermission = request;
        requestPermissions(missing.toArray(new String[0]), REQ_MEDIA);
    }

    private static String androidPermission(String resource) {
        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) return Manifest.permission.CAMERA;
        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) return Manifest.permission.RECORD_AUDIO;
        return null;
    }

    private void grantAllowed(PermissionRequest request) {
        List<String> ok = new ArrayList<>();
        for (String r : request.getResources()) {
            String p = androidPermission(r);
            if (p != null && checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED) ok.add(r);
        }
        if (ok.isEmpty()) request.deny();
        else request.grant(ok.toArray(new String[0]));
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == REQ_MEDIA && pendingPermission != null) {
            PermissionRequest r = pendingPermission;
            pendingPermission = null;
            grantAllowed(r);
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        }
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
        }
    }

    // ---------------------------------------------------------------- bridge

    /** Methods the web app can call. Only the bundled app is ever loaded. */
    private class Bridge {
        @JavascriptInterface
        public String version() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public String initialLink() {
            String l = initialLink;
            initialLink = null;
            return l == null ? "" : l;
        }

        @JavascriptInterface
        public void copyText(String text) {
            runOnUiThread(() -> {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("Handshake invite", text));
            });
        }

        @JavascriptInterface
        public void shareText(String text) {
            runOnUiThread(() -> {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_TEXT, text);
                try {
                    startActivity(Intent.createChooser(send, "Send invite"));
                } catch (Exception ignored) {
                }
            });
        }

        @JavascriptInterface
        public void openExternal(String url) {
            Uri u = Uri.parse(url);
            if ("https".equals(u.getScheme())) runOnUiThread(() -> MainActivity.this.openExternal(u));
        }

        @JavascriptInterface
        public void setDarkBars(boolean dark) {
            runOnUiThread(() -> applyBars(dark));
        }

        @JavascriptInterface
        public void setSecureScreen(boolean on) {
            prefs.edit().putBoolean("secure", on).apply();
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            });
        }

        @JavascriptInterface
        public void setCallActive(boolean on) {
            runOnUiThread(() -> {
                inCall = on;
                Intent svc = new Intent(MainActivity.this, CallService.class);
                if (on) {
                    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    if (Build.VERSION.SDK_INT >= 33 && !askedNotifications
                            && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                        askedNotifications = true;
                        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY);
                    }
                    try {
                        startForegroundService(svc);
                    } catch (Exception ignored) {
                    }
                    setSpeakerInternal(true);
                } else {
                    getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    stopService(svc);
                    AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                    if (am != null && Build.VERSION.SDK_INT >= 31) am.clearCommunicationDevice();
                }
            });
        }

        @JavascriptInterface
        public void setSpeaker(boolean on) {
            runOnUiThread(() -> setSpeakerInternal(on));
        }

        @JavascriptInterface
        public String saveBegin(String name, String mime) {
            String safe = name == null ? "file" : name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
            if (safe.isEmpty()) safe = "file";
            if (safe.length() > 120) safe = safe.substring(safe.length() - 120);
            Save save = new Save();
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                    v.put(MediaStore.Downloads.MIME_TYPE, mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
                    v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Handshake");
                    v.put(MediaStore.Downloads.IS_PENDING, 1);
                    ContentResolver cr = getContentResolver();
                    save.uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (save.uri == null) return "";
                    save.out = cr.openOutputStream(save.uri);
                    save.label = "Downloads/Handshake/" + safe;
                } else {
                    File dir = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "Handshake");
                    if (!dir.exists() && !dir.mkdirs()) return "";
                    File f = new File(dir, safe);
                    save.out = new FileOutputStream(f);
                    save.label = f.getAbsolutePath();
                }
            } catch (Exception e) {
                return "";
            }
            String id = UUID.randomUUID().toString();
            synchronized (saves) {
                saves.put(id, save);
            }
            return id;
        }

        @JavascriptInterface
        public boolean saveChunk(String id, String base64) {
            Save save;
            synchronized (saves) {
                save = saves.get(id);
            }
            if (save == null) return false;
            try {
                save.out.write(Base64.decode(base64, Base64.DEFAULT));
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public String saveEnd(String id) {
            Save save;
            synchronized (saves) {
                save = saves.remove(id);
            }
            if (save == null) return "";
            try {
                save.out.close();
                if (save.uri != null && Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.IS_PENDING, 0);
                    getContentResolver().update(save.uri, v, null, null);
                }
                return save.label;
            } catch (Exception e) {
                return "";
            }
        }
    }

    /** Status and navigation bars follow the app's light or dark theme. */
    @SuppressWarnings("deprecation")
    private void applyBars(boolean dark) {
        int color = dark ? 0xFF1F1F1F : 0xFFFFFFFF;
        getWindow().setStatusBarColor(color);
        getWindow().setNavigationBarColor(color);
        if (web != null) web.setBackgroundColor(color);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                c.setSystemBarsAppearance(dark ? 0 : mask, mask);
            }
        } else {
            View decor = getWindow().getDecorView();
            int light = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            int flags = decor.getSystemUiVisibility();
            decor.setSystemUiVisibility(dark ? (flags & ~light) : (flags | light));
        }
    }

    private void setSpeakerInternal(boolean on) {
        AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return;
        if (Build.VERSION.SDK_INT >= 31) {
            int wanted = on ? AudioDeviceInfo.TYPE_BUILTIN_SPEAKER : AudioDeviceInfo.TYPE_BUILTIN_EARPIECE;
            for (AudioDeviceInfo d : am.getAvailableCommunicationDevices()) {
                if (d.getType() == wanted) {
                    am.setCommunicationDevice(d);
                    return;
                }
            }
        } else {
            setSpeakerphoneLegacy(am, on);
        }
    }

    @SuppressWarnings("deprecation")
    private static void setSpeakerphoneLegacy(AudioManager am, boolean on) {
        am.setSpeakerphoneOn(on);
    }
}
