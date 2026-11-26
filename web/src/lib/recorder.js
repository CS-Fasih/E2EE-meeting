// Records the meeting on this device only. Everyone in the call is told
// while a recording is running; the file never leaves this device unless the
// person who recorded it shares it.

export class Recorder {
  /**
   * @param {() => Array<{video: HTMLVideoElement|null, name: string, screen?: boolean}>} getTiles
   */
  constructor(getTiles) {
    this.getTiles = getTiles;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.ctx2d = this.canvas.getContext('2d');
    this.audio = new (window.AudioContext || window.webkitAudioContext)();
    this.dest = this.audio.createMediaStreamDestination();
    this.sources = new Map();
    this.chunks = [];
    this.startedAt = 0;
  }

  static supported() {
    return typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;
  }

  setAudioTracks(tracks) {
    const live = new Set(tracks.filter((t) => t && t.readyState === 'live'));
    for (const [t, node] of this.sources) {
      if (!live.has(t)) {
        try {
          node.disconnect();
        } catch {}
        this.sources.delete(t);
      }
    }
    for (const t of live) {
      if (this.sources.has(t)) continue;
      try {
        const node = this.audio.createMediaStreamSource(new MediaStream([t]));
        node.connect(this.dest);
        this.sources.set(t, node);
      } catch {}
    }
  }

  start() {
    const video = this.canvas.captureStream(25);
    const stream = new MediaStream([...video.getVideoTracks(), ...this.dest.stream.getAudioTracks()]);
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
    this.mime = mimeType || 'video/webm';
    this.rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2500000 });
    this.rec.ondataavailable = (e) => e.data && e.data.size && this.chunks.push(e.data);
    this.rec.start(1000);
    this.startedAt = Date.now();
    // setInterval rather than requestAnimationFrame so drawing continues when
    // the window is in the background.
    this.timer = setInterval(() => this._draw(), 40);
  }

  _draw() {
    const ctx = this.ctx2d;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.fillStyle = '#0f1226';
    ctx.fillRect(0, 0, W, H);
    const tiles = this.getTiles();
    const screen = tiles.find((t) => t.screen && t.video);
    const rest = tiles.filter((t) => t !== screen);
    if (screen) {
      this._tile(screen, 0, 0, W - 260, H, true);
      const each = Math.min(146, H / Math.max(rest.length, 1));
      rest.slice(0, 5).forEach((t, i) => this._tile(t, W - 252, 8 + i * (each + 4), 244, each));
      return;
    }
    const n = Math.max(rest.length, 1);
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const tw = W / cols;
    const th = H / rows;
    rest.forEach((t, i) => this._tile(t, (i % cols) * tw + 4, Math.floor(i / cols) * th + 4, tw - 8, th - 8));
  }

  _tile(t, x, y, w, h, contain) {
    const ctx = this.ctx2d;
    ctx.save();
    ctx.fillStyle = '#1f2547';
    ctx.fillRect(x, y, w, h);
    const v = t.video;
    if (v && v.videoWidth && !t.camOff) {
      const vr = v.videoWidth / v.videoHeight;
      const r = w / h;
      let dw = w, dh = h;
      if (contain ? vr > r : vr < r) dh = w / vr;
      else dw = h * vr;
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.drawImage(v, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    } else {
      ctx.fillStyle = '#f0efe7';
      ctx.font = `600 ${Math.round(h / 4)}px "Atkinson Hyperlegible Next", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((t.name || '?').slice(0, 1).toUpperCase(), x + w / 2, y + h / 2);
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(15,18,38,0.85)';
    ctx.font = '600 15px "Atkinson Hyperlegible Next", sans-serif';
    const label = t.name || '';
    const lw = ctx.measureText(label).width + 16;
    ctx.fillRect(x + 8, y + h - 32, lw, 24);
    ctx.fillStyle = '#f0efe7';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 16, y + h - 20);
  }

  /** @returns {Promise<Blob>} */
  stop() {
    clearInterval(this.timer);
    return new Promise((resolve) => {
      if (!this.rec || this.rec.state === 'inactive') return resolve(new Blob(this.chunks, { type: this.mime }));
      this.rec.onstop = () => resolve(new Blob(this.chunks, { type: this.mime }));
      this.rec.stop();
    }).finally(() => {
      this.setAudioTracks([]);
      this.audio.close().catch(() => {});
    });
  }
}
