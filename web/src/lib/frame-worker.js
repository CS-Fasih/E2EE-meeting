// Media frame encryption, run off the main thread.
//
// On top of WebRTC's own DTLS-SRTP encryption, every encoded audio and video
// frame is sealed with AES-256-GCM using a key that only meeting members can
// derive. A few leading codec header bytes stay readable (and are
// authenticated as associated data) because the browser's RTP packetiser
// needs them; the media itself never is.
//
// Frame layout: [header n bytes][ciphertext + 16-byte tag][12-byte IV][n]

const stats = new Map(); // tag -> { ok, failed, lastReport }

function headerLength(frame, kind) {
  if (kind === 'audio') return 1;
  // VP8: keyframes carry a 10-byte header, other frames 3 bytes.
  return frame.type === 'key' ? 10 : 3;
}

function report(tag, force) {
  const s = stats.get(tag);
  if (!s) return;
  const now = Date.now();
  if (force || now - s.lastReport > 2000) {
    s.lastReport = now;
    self.postMessage({ type: 'stats', tag, ok: s.ok, failed: s.failed });
  }
}

function makeTransform(direction, cryptoKey, kind, tag) {
  stats.set(tag, { ok: 0, failed: 0, lastReport: 0 });
  const s = stats.get(tag);
  if (direction === 'encrypt') {
    return new TransformStream({
      async transform(frame, controller) {
        const data = new Uint8Array(frame.data);
        if (data.byteLength === 0) {
          controller.enqueue(frame);
          return;
        }
        const n = Math.min(headerLength(frame, kind), data.byteLength);
        const header = data.subarray(0, n);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = new Uint8Array(
          await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: header }, cryptoKey, data.subarray(n)),
        );
        const out = new Uint8Array(n + ct.byteLength + 13);
        out.set(header, 0);
        out.set(ct, n);
        out.set(iv, n + ct.byteLength);
        out[out.byteLength - 1] = n;
        frame.data = out.buffer;
        s.ok++;
        report(tag);
        controller.enqueue(frame);
      },
    });
  }
  return new TransformStream({
    async transform(frame, controller) {
      const data = new Uint8Array(frame.data);
      if (data.byteLength === 0) {
        controller.enqueue(frame);
        return;
      }
      const n = data[data.byteLength - 1];
      if (data.byteLength < n + 16 + 13) {
        s.failed++;
        report(tag);
        return; // drop: not one of ours
      }
      const header = data.subarray(0, n);
      const iv = data.subarray(data.byteLength - 13, data.byteLength - 1);
      try {
        const pt = new Uint8Array(
          await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv, additionalData: header },
            cryptoKey,
            data.subarray(n, data.byteLength - 13),
          ),
        );
        const out = new Uint8Array(n + pt.byteLength);
        out.set(header, 0);
        out.set(pt, n);
        frame.data = out.buffer;
        s.ok++;
        report(tag);
        controller.enqueue(frame);
      } catch {
        s.failed++;
        report(tag, s.failed === 1);
      }
    },
  });
}

async function setup({ readable, writable, direction, key, kind, tag }) {
  const cryptoKey = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, [direction]);
  readable
    .pipeThrough(makeTransform(direction, cryptoKey, kind, tag))
    .pipeTo(writable)
    .catch(() => {})
    .finally(() => stats.delete(tag));
}

// Chromium's older API: streams are transferred in a message.
self.onmessage = (event) => {
  const msg = event.data;
  if (msg && msg.op === 'stream') setup(msg);
};

// Standard API (RTCRtpScriptTransform).
self.onrtctransform = (event) => {
  const t = event.transformer;
  setup({ readable: t.readable, writable: t.writable, ...t.options });
};
