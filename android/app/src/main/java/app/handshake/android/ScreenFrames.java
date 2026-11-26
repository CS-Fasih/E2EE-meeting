package app.handshake.android;

/**
 * The newest captured screen frame, kept in memory only, and a way to tell
 * the web app what the screen capture is doing.
 */
final class ScreenFrames {

    interface Listener {
        void onScreenEvent(String event, int a, int b);
    }

    static volatile byte[] latest;
    static volatile int width;
    static volatile int height;
    static volatile Listener listener;

    private ScreenFrames() {
    }

    static void emit(String event, int a, int b) {
        Listener l = listener;
        if (l != null) l.onScreenEvent(event, a, b);
    }
}
