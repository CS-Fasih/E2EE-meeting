// Small differences between the browser, the desktop app and the Android app.

const desktop = typeof window !== 'undefined' ? window.handshakeNative : null;
const android = typeof window !== 'undefined' ? window.HandshakeAndroid : null;

export const platform = {
  kind: desktop ? 'desktop' : android ? 'android' : 'web',

  get canShareScreen() {
    // Android: the app captures the screen natively (see android-screen.js).
    if (android) return !!android.startScreenShare;
    return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  },

  get canPip() {
    return !android && 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled;
  },

  get canPickSpeaker() {
    return !android && typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
  },

  async copy(text) {
    if (android && android.copyText) {
      android.copyText(text);
      return true;
    }
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {}
      ta.remove();
      return ok;
    }
  },

  async share(text) {
    if (android && android.shareText) {
      android.shareText(text);
      return true;
    }
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  },

  async saveFile(blob, filename) {
    if (android && android.saveBegin) {
      const id = android.saveBegin(filename, blob.type || 'application/octet-stream');
      const step = 384 * 1024;
      for (let off = 0; off < blob.size; off += step) {
        const buf = new Uint8Array(await blob.slice(off, off + step).arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        android.saveChunk(id, btoa(bin));
      }
      return android.saveEnd(id); // returns where it was saved, or '' on failure
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return 'downloads';
  },

  setCallActive(on) {
    if (android && android.setCallActive) android.setCallActive(!!on);
    if (desktop && desktop.setCallActive) desktop.setCallActive(!!on);
  },

  /** Short vibration for important taps (Android only, follows system haptics setting). */
  haptic(kind) {
    if (android && android.haptic) {
      try {
        android.haptic(String(kind || 'tap'));
      } catch {}
    }
  },

  /** Android picture-in-picture: called with true/false when the call shrinks to a floating window. */
  onPip(fn) {
    window.__handshakePip = (on) => fn(!!on);
  },

  get isPhone() {
    return !!android || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches && window.innerWidth <= 720);
  },

  setDarkBars(dark) {
    if (android && android.setDarkBars) android.setDarkBars(!!dark);
  },

  setSecureScreen(on) {
    if (android && android.setSecureScreen) android.setSecureScreen(!!on);
  },

  get hasSpeakerToggle() {
    return !!(android && android.setSpeaker);
  },

  setSpeaker(on) {
    if (android && android.setSpeaker) android.setSpeaker(!!on);
  },

  /** Desktop: lets the person choose which screen or window to share. */
  onPickSource(fn) {
    if (desktop && desktop.onPickSource) desktop.onPickSource(fn);
  },

  pickSource(id, audio) {
    if (desktop && desktop.pickSource) desktop.pickSource(id, !!audio);
  },

  /** Meeting links opened from outside the app (handshake://join/...). */
  onOpenLink(fn) {
    if (desktop && desktop.onOpenLink) desktop.onOpenLink(fn);
    window.__handshakeOpen = (link) => fn(String(link || ''));
    if (android && android.initialLink) {
      const link = android.initialLink();
      if (link) setTimeout(() => fn(link), 0);
    }
  },

  /** Android back button: return true when the app handled it. */
  onBack(fn) {
    window.__handshakeBack = () => !!fn();
  },

  openExternal(url) {
    if (desktop && desktop.openExternal) desktop.openExternal(url);
    else if (android && android.openExternal) android.openExternal(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  },

  get version() {
    return (desktop && desktop.version) || (android && android.version && android.version()) || __APP_VERSION__;
  },
};
