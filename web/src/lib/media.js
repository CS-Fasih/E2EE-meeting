// Local camera, microphone and screen.

import { androidCanShare, startAndroidScreen, stopAndroidScreen } from './android-screen.js';
//
// Turning the camera or microphone off stops the device entirely (the
// hardware light goes out); nothing keeps listening in the background.

const QUALITY = {
  low: { width: 640, height: 360, frameRate: 20 },
  standard: { width: 1280, height: 720, frameRate: 24 },
  high: { width: 1920, height: 1080, frameRate: 30 },
};

export class LocalMedia extends EventTarget {
  constructor(settings) {
    super();
    this.settings = settings;
    this.tracks = { audio: null, cam: null, screen: null, screenAudio: null };
    this.wantMic = true;
    this.wantCam = true;
    this.lastError = null;
    this.facing = 'user'; // which way the camera points, for mirroring
  }

  get(slot) {
    return this.tracks[slot];
  }

  _set(slot, track) {
    const old = this.tracks[slot];
    if (old && old !== track) old.stop();
    this.tracks[slot] = track;
    this.dispatchEvent(new CustomEvent('change', { detail: { slot, track } }));
  }

  audioConstraints() {
    const s = this.settings;
    return {
      deviceId: s.micId ? { ideal: s.micId } : undefined,
      echoCancellation: s.echoCancellation !== false,
      noiseSuppression: s.noiseSuppression !== false,
      autoGainControl: s.autoGainControl !== false,
      channelCount: 1,
    };
  }

  videoConstraints() {
    const q = QUALITY[this.settings.videoQuality] || QUALITY.standard;
    return {
      deviceId: this.settings.camId ? { ideal: this.settings.camId } : undefined,
      width: { ideal: q.width },
      height: { ideal: q.height },
      frameRate: { ideal: q.frameRate, max: 30 },
      facingMode: this.settings.camId ? undefined : 'user',
    };
  }

  async startMic() {
    this.wantMic = true;
    if (this.tracks.audio && this.tracks.audio.readyState === 'live') return this.tracks.audio;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: this.audioConstraints() });
      const track = s.getAudioTracks()[0];
      track.contentHint = 'speech';
      track.addEventListener('ended', () => {
        if (this.tracks.audio === track) this._set('audio', null);
      });
      this._set('audio', track);
      this.lastError = null;
      return track;
    } catch (err) {
      this.wantMic = false;
      this.lastError = describeError(err, 'microphone');
      this._set('audio', null);
      throw err;
    }
  }

  stopMic() {
    this.wantMic = false;
    this._set('audio', null);
  }

  async startCam() {
    this.wantCam = true;
    if (this.tracks.cam && this.tracks.cam.readyState === 'live') return this.tracks.cam;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: this.videoConstraints() });
      const track = s.getVideoTracks()[0];
      const fm = track.getSettings ? track.getSettings().facingMode : null;
      this.facing = fm || 'user';
      track.contentHint = 'motion';
      track.addEventListener('ended', () => {
        if (this.tracks.cam === track) this._set('cam', null);
      });
      this._set('cam', track);
      this.lastError = null;
      return track;
    } catch (err) {
      this.wantCam = false;
      this.lastError = describeError(err, 'camera');
      this._set('cam', null);
      throw err;
    }
  }

  stopCam() {
    this.wantCam = false;
    this._set('cam', null);
  }

  /** Switches between front and back camera (or to the next camera). */
  async switchCamera() {
    const cur = this.tracks.cam;
    const st = cur && cur.getSettings ? cur.getSettings() : {};
    const { cams } = await listDevices();
    const base = this.videoConstraints();
    delete base.deviceId;
    delete base.facingMode;
    let constraints;
    let nextFacing = this.facing;
    if (st.facingMode || cams.length <= 2) {
      nextFacing = (st.facingMode || this.facing) === 'environment' ? 'user' : 'environment';
      constraints = { ...base, facingMode: { exact: nextFacing } };
    } else {
      const i = cams.findIndex((d) => d.deviceId === st.deviceId);
      const next = cams[(i + 1) % cams.length];
      constraints = { ...base, deviceId: { exact: next.deviceId } };
    }
    // Phones cannot open two cameras at once: release the current one first.
    this._set('cam', null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: constraints });
      const track = s.getVideoTracks()[0];
      const got = track.getSettings ? track.getSettings().facingMode : null;
      this.facing = got || nextFacing;
      track.contentHint = 'motion';
      track.addEventListener('ended', () => {
        if (this.tracks.cam === track) this._set('cam', null);
      });
      this._set('cam', track);
      return true;
    } catch {
      this.facing = 'user';
      await this.startCam().catch(() => {});
      return false;
    }
  }

  get mirrored() {
    return this.facing !== 'environment';
  }

  /** Restart whichever devices are on, e.g. after picking a different one. */
  async refresh() {
    if (this.tracks.audio) {
      this._set('audio', null);
      await this.startMic().catch(() => {});
    }
    if (this.tracks.cam) {
      this._set('cam', null);
      await this.startCam().catch(() => {});
    }
  }

  static canShareScreen() {
    return androidCanShare() || !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  }

  async startScreen() {
    if (androidCanShare()) {
      const track = await startAndroidScreen(() => {
        if (this.tracks.screen === track) this.stopScreen();
      });
      this.androidScreen = true;
      this._set('screen', track);
      this._set('screenAudio', null);
      return track;
    }
    const s = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 15, max: 30 }, width: { max: 1920 }, height: { max: 1080 } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      systemAudio: 'include',
    });
    const video = s.getVideoTracks()[0];
    const audio = s.getAudioTracks()[0] || null;
    video.contentHint = 'detail';
    video.addEventListener('ended', () => {
      if (this.tracks.screen === video) this.stopScreen();
    });
    this._set('screen', video);
    this._set('screenAudio', audio);
    return video;
  }

  stopScreen() {
    if (this.androidScreen) {
      this.androidScreen = false;
      stopAndroidScreen();
    }
    this._set('screen', null);
    this._set('screenAudio', null);
  }

  stopAll() {
    for (const slot of Object.keys(this.tracks)) this._set(slot, null);
  }
}

export function describeError(err, what) {
  const name = err && err.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return `Access to the ${what} was blocked. Allow it in your system or browser settings, then try again.`;
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return `No ${what} was found.`;
  if (name === 'NotReadableError' || name === 'AbortError') {
    return `The ${what} is in use by another app. Close that app and try again.`;
  }
  return `Could not start the ${what}.`;
}

export async function listDevices() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return {
      mics: all.filter((d) => d.kind === 'audioinput'),
      cams: all.filter((d) => d.kind === 'videoinput'),
      speakers: all.filter((d) => d.kind === 'audiooutput'),
    };
  } catch {
    return { mics: [], cams: [], speakers: [] };
  }
}

/**
 * Measures loudness of audio tracks for the speaking indicator. One shared
 * AudioContext; nothing is recorded or sent anywhere.
 */
export class LevelMeter {
  constructor() {
    this.ctx = null;
    this.nodes = new Map();
  }

  _ctx() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  watch(key, track) {
    this.unwatch(key);
    if (!track) return;
    try {
      const ctx = this._ctx();
      const src = ctx.createMediaStreamSource(new MediaStream([track]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      src.connect(analyser);
      this.nodes.set(key, { src, analyser, buf: new Float32Array(analyser.fftSize), track });
    } catch {}
  }

  unwatch(key) {
    const n = this.nodes.get(key);
    if (n) {
      try {
        n.src.disconnect();
      } catch {}
      this.nodes.delete(key);
    }
  }

  level(key) {
    const n = this.nodes.get(key);
    if (!n || n.track.readyState !== 'live') return 0;
    n.analyser.getFloatTimeDomainData(n.buf);
    let sum = 0;
    for (let i = 0; i < n.buf.length; i++) sum += n.buf[i] * n.buf[i];
    return Math.sqrt(sum / n.buf.length);
  }

  close() {
    for (const k of [...this.nodes.keys()]) this.unwatch(k);
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
  }
}
