// Screen sharing inside the Android app.
//
// Android's WebView has no getDisplayMedia, so the app captures the screen
// natively (MediaProjection, after the system's consent dialog) and keeps the
// newest frame in memory. This module draws those frames onto a canvas and
// turns the canvas into an ordinary video track, which is then end-to-end
// encrypted and sent exactly like a camera or desktop screen share.

const android = typeof window !== 'undefined' ? window.HandshakeAndroid : null;
let session = null;

export function androidCanShare() {
  return !!(android && android.startScreenShare);
}

/**
 * Asks Android for permission and starts capturing.
 * @param {() => void} onStopped called if sharing ends from outside the app
 * @returns {Promise<MediaStreamTrack>}
 */
export function startAndroidScreen(onStopped) {
  return new Promise((resolve, reject) => {
    if (session) return reject(new Error('already sharing'));
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    let track = null;
    let busy = false;
    let queued = 0;
    let lastDraw = 0;
    let keepAlive = 0;
    let settled = false;

    const draw = async (n) => {
      if (busy) {
        queued = n;
        return;
      }
      busy = true;
      try {
        const res = await fetch('/__screen/frame?n=' + n, { cache: 'no-store' });
        if (res.status === 200) {
          const bmp = await createImageBitmap(await res.blob());
          if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
            canvas.width = bmp.width;
            canvas.height = bmp.height;
          }
          ctx.drawImage(bmp, 0, 0);
          bmp.close();
          lastDraw = performance.now();
          if (track && track.requestFrame) track.requestFrame();
        }
      } catch {}
      busy = false;
      if (queued) {
        const next = queued;
        queued = 0;
        draw(next);
      }
    };

    const cleanup = () => {
      clearInterval(keepAlive);
      session = null;
      window.__handshakeScreen = null;
    };

    const stop = () => {
      try {
        android.stopScreenShare();
      } catch {}
      cleanup();
      if (track) track.stop();
    };

    window.__handshakeScreen = (event, a, b) => {
      if (event === 'started' && !settled) {
        settled = true;
        canvas.width = a || 1280;
        canvas.height = b || 720;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const stream = canvas.captureStream(0);
        track = stream.getVideoTracks()[0];
        track.contentHint = 'detail';
        // A still screen produces no new frames; resend the last one now and
        // then so people who join later still see it.
        keepAlive = setInterval(() => {
          if (track && performance.now() - lastDraw > 900 && track.requestFrame) track.requestFrame();
        }, 1000);
        session = { stop };
        resolve(track);
      } else if (event === 'denied' && !settled) {
        settled = true;
        cleanup();
        const err = new Error('Screen sharing was not allowed');
        err.name = 'NotAllowedError';
        reject(err);
      } else if (event === 'frame') {
        draw(a);
      } else if (event === 'stopped') {
        cleanup();
        if (!settled) {
          settled = true;
          reject(new Error('stopped'));
        } else if (onStopped) onStopped();
      }
    };

    try {
      android.startScreenShare();
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

export function stopAndroidScreen() {
  if (session) session.stop();
}
