package app.handshake.android;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ComponentCallbacks;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.view.WindowManager;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

/**
 * Keeps a meeting running while the app is in the background, as Android
 * requires for using the microphone and camera when not on screen, and
 * captures the screen when the person chooses to present.
 *
 * Screen frames stay in memory only. The newest frame is handed to the web
 * app through a private address that only the app's own page can load; from
 * there it is encrypted and sent like any other video.
 */
public class CallService extends Service {

    private static final String CHANNEL = "meeting";
    private static final int ID = 1;
    private static final int MAX_SIDE = 1280;
    private static final long FRAME_INTERVAL_MS = 90;

    static volatile CallService instance;

    private MediaProjection projection;
    private VirtualDisplay display;
    private ImageReader reader;
    private HandlerThread thread;
    private Handler handler;
    private long lastFrame;
    private int seq;
    private boolean presenting;
    private ComponentCallbacks rotationWatcher;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!updateForeground()) stopSelf();
        return START_NOT_STICKY;
    }

    private Notification buildNotification() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Meeting in progress", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while you are in a meeting");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_meeting)
                .setContentTitle(presenting ? "You are presenting your screen" : "You are in a meeting")
                .setContentText(presenting ? "Everyone in the meeting can see your screen. Tap to go back." : "Tap to go back to Handshake")
                .setContentIntent(pi)
                .setOngoing(true)
                .setCategory(Notification.CATEGORY_CALL)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .build();
    }

    /** (Re)declares what the service is doing: microphone, camera and, while presenting, screen capture. */
    private boolean updateForeground() {
        int types = 0;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
        }
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA;
        }
        if (presenting) types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION;
        if (types == 0) return false;
        try {
            if (Build.VERSION.SDK_INT >= 30) startForeground(ID, buildNotification(), types);
            else if (Build.VERSION.SDK_INT == 29 && presenting) {
                // Android 10 knows only the screen-capture type.
                startForeground(ID, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            } else startForeground(ID, buildNotification());
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    // ------------------------------------------------------------ screen sharing

    /** Called on the main thread with the result of the system's screen capture consent dialog. */
    void startScreen(int resultCode, Intent data) {
        if (projection != null) stopScreen(false);
        // Android requires the service to be running as a screen-capture service first.
        presenting = true;
        if (!updateForeground()) {
            presenting = false;
            ScreenFrames.emit("denied", 0, 0);
            return;
        }
        MediaProjectionManager mpm = getSystemService(MediaProjectionManager.class);
        try {
            projection = mpm.getMediaProjection(resultCode, data);
        } catch (Exception e) {
            projection = null;
        }
        if (projection == null) {
            presenting = false;
            updateForeground();
            ScreenFrames.emit("denied", 0, 0);
            return;
        }
        thread = new HandlerThread("handshake-screen");
        thread.start();
        handler = new Handler(thread.getLooper());
        projection.registerCallback(new MediaProjection.Callback() {
            @Override
            public void onStop() {
                // Stopped from the system (status bar chip, notification or lock screen).
                new Handler(getMainLooper()).post(() -> stopScreen(true));
            }
        }, handler);
        try {
            createDisplay();
        } catch (Exception e) {
            stopScreen(false);
            ScreenFrames.emit("denied", 0, 0);
            return;
        }
        rotationWatcher = new ComponentCallbacks() {
            @Override
            public void onConfigurationChanged(Configuration newConfig) {
                if (handler != null && projection != null) {
                    handler.post(() -> {
                        try {
                            createDisplay();
                            ScreenFrames.emit("resized", ScreenFrames.width, ScreenFrames.height);
                        } catch (Exception ignored) {
                        }
                    });
                }
            }

            @Override
            public void onLowMemory() {
            }
        };
        registerComponentCallbacks(rotationWatcher);
        ScreenFrames.emit("started", ScreenFrames.width, ScreenFrames.height);
    }

    @SuppressWarnings("deprecation")
    private void createDisplay() {
        int sw;
        int sh;
        int dpi = getResources().getDisplayMetrics().densityDpi;
        WindowManager wm = getSystemService(WindowManager.class);
        if (Build.VERSION.SDK_INT >= 30) {
            Rect b = wm.getMaximumWindowMetrics().getBounds();
            sw = b.width();
            sh = b.height();
        } else {
            DisplayMetrics m = new DisplayMetrics();
            wm.getDefaultDisplay().getRealMetrics(m);
            sw = m.widthPixels;
            sh = m.heightPixels;
        }
        float scale = Math.min(1f, (float) MAX_SIDE / Math.max(sw, sh));
        int w = Math.max(2, Math.round(sw * scale) & ~1);
        int h = Math.max(2, Math.round(sh * scale) & ~1);
        ImageReader old = reader;
        reader = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2);
        reader.setOnImageAvailableListener(this::onImage, handler);
        if (display == null) {
            display = projection.createVirtualDisplay("HandshakeScreen", w, h, dpi,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader.getSurface(), null, handler);
        } else {
            display.resize(w, h, dpi);
            display.setSurface(reader.getSurface());
        }
        if (old != null) old.close();
        ScreenFrames.width = w;
        ScreenFrames.height = h;
    }

    private void onImage(ImageReader r) {
        Image img = null;
        try {
            img = r.acquireLatestImage();
            if (img == null) return;
            long now = SystemClock.uptimeMillis();
            if (now - lastFrame < FRAME_INTERVAL_MS) return;
            lastFrame = now;
            Image.Plane plane = img.getPlanes()[0];
            ByteBuffer buf = plane.getBuffer();
            int pixelStride = plane.getPixelStride();
            int rowStride = plane.getRowStride();
            int w = img.getWidth();
            int h = img.getHeight();
            Bitmap padded = Bitmap.createBitmap(rowStride / pixelStride, h, Bitmap.Config.ARGB_8888);
            padded.copyPixelsFromBuffer(buf);
            Bitmap frame = padded.getWidth() == w ? padded : Bitmap.createBitmap(padded, 0, 0, w, h);
            ByteArrayOutputStream out = new ByteArrayOutputStream(w * h / 5);
            frame.compress(Bitmap.CompressFormat.JPEG, 75, out);
            if (frame != padded) frame.recycle();
            padded.recycle();
            ScreenFrames.latest = out.toByteArray();
            ScreenFrames.emit("frame", ++seq, 0);
        } catch (Exception ignored) {
        } finally {
            if (img != null) img.close();
        }
    }

    /** Stops presenting. Safe to call more than once. */
    void stopScreen(boolean bySystem) {
        boolean was = projection != null;
        if (rotationWatcher != null) {
            unregisterComponentCallbacks(rotationWatcher);
            rotationWatcher = null;
        }
        if (display != null) {
            display.release();
            display = null;
        }
        if (reader != null) {
            reader.close();
            reader = null;
        }
        if (projection != null) {
            MediaProjection p = projection;
            projection = null;
            if (!bySystem) {
                try {
                    p.stop();
                } catch (Exception ignored) {
                }
            }
        }
        if (thread != null) {
            thread.quitSafely();
            thread = null;
            handler = null;
        }
        ScreenFrames.latest = null;
        presenting = false;
        if (!updateForeground()) {
            // Could not change the service type from the background: at least fix the notification.
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.notify(ID, buildNotification());
        }
        if (was) ScreenFrames.emit("stopped", 0, 0);
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopScreen(false);
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        stopScreen(false);
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
