// Main-thread side of media frame encryption: picks whichever browser API is
// available and hands senders/receivers to the worker.

let worker = null;
const listeners = new Map();
export const lastFrameStats = new Map(); // tag -> latest counts, for the info panel and tests

export function frameEncryptionMode() {
  if (typeof window === 'undefined') return null;
  if (typeof window.RTCRtpScriptTransform === 'function') return 'script';
  if (typeof RTCRtpSender !== 'undefined' && typeof RTCRtpSender.prototype.createEncodedStreams === 'function') {
    return 'legacy';
  }
  return null;
}

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./frame-worker.js', import.meta.url), { type: 'module', name: 'handshake-frames' });
    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg && msg.type === 'stats') {
        lastFrameStats.set(msg.tag, { ok: msg.ok, failed: msg.failed });
        const fn = listeners.get(msg.tag);
        if (fn) fn(msg);
      }
    };
  }
  return worker;
}

export function onFrameStats(tag, fn) {
  listeners.set(tag, fn);
}

export function offFrameStats(prefix) {
  for (const tag of [...listeners.keys()]) if (tag.startsWith(prefix)) listeners.delete(tag);
}

/**
 * @param {'script'|'legacy'} mode
 * @param {RTCRtpSender|RTCRtpReceiver} endpoint
 * @param {'encrypt'|'decrypt'} direction
 */
export function attachTransform(mode, endpoint, direction, key, kind, tag) {
  const w = getWorker();
  const options = { direction, key, kind, tag };
  if (mode === 'script') {
    endpoint.transform = new window.RTCRtpScriptTransform(w, options);
  } else {
    const { readable, writable } = endpoint.createEncodedStreams();
    w.postMessage({ op: 'stream', readable, writable, ...options }, [readable, writable]);
  }
}
