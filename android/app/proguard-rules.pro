# Methods called from JavaScript must keep their names.
-keepclassmembers class app.handshake.android.MainActivity$Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
