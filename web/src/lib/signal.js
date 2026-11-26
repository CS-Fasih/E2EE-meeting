// Sealed signalling on top of the relay pool.
//
// Every message carries the sender id, an optional recipient, a timestamp and
// a random nonce inside the sealed payload. Replays (the same nonce twice, or
// anything older than ten minutes) are dropped, and messages for someone else
// are ignored. Relays only ever see ciphertext.

import { RelayPool } from './relay.js';
import { seal, open, randomBytes, b64encode } from './crypto.js';

const MAX_SKEW_MS = 10 * 60 * 1000;

export class Signal {
  constructor({ meeting, selfId, relays, onMessage, onLocked, onStatus }) {
    this.meeting = meeting;
    this.selfId = selfId;
    this.onMessage = onMessage;
    this.onLocked = onLocked || (() => {});
    this.nonces = new Map();
    this.undecryptable = 0;
    this.pool = new RelayPool(relays, meeting.topic, (c) => this._receive(c), onStatus);
  }

  start() {
    this.pool.start();
    this._gc = setInterval(() => {
      const cutoff = Date.now() - MAX_SKEW_MS * 2;
      for (const [n, t] of this.nonces) if (t < cutoff) this.nonces.delete(n);
    }, 60000);
  }

  get relayStatus() {
    return { open: this.pool.openCount, total: this.pool.urls.length };
  }

  async send(type, body = {}, to = null) {
    const msg = { t: type, f: this.selfId, to, ts: Date.now(), n: b64encode(randomBytes(12)), b: body };
    const sealed = await seal(this.meeting, msg);
    const wire = JSON.stringify({ v: 1, p: this.meeting.hasPassword ? 1 : 0, d: sealed });
    return this.pool.publish(wire);
  }

  async _receive(content) {
    let env;
    try {
      env = JSON.parse(content);
    } catch {
      return;
    }
    if (!env || env.v !== 1 || typeof env.d !== 'string' || env.d.length > 200000) return;
    let msg;
    try {
      msg = await open(this.meeting, env.d);
    } catch {
      // Someone is using this meeting's topic but we cannot open it: almost
      // always a password we do not have (or a different password).
      this.undecryptable++;
      this.onLocked({ passwordHint: env.p === 1, count: this.undecryptable });
      return;
    }
    if (!msg || typeof msg.t !== 'string' || typeof msg.f !== 'string' || typeof msg.n !== 'string') return;
    if (msg.f === this.selfId) return;
    if (msg.to && msg.to !== this.selfId) return;
    if (typeof msg.ts !== 'number' || Math.abs(Date.now() - msg.ts) > MAX_SKEW_MS) return;
    if (this.nonces.has(msg.n)) return;
    this.nonces.set(msg.n, Date.now());
    try {
      this.onMessage(msg.t, msg.f, msg.b || {}, msg);
    } catch (err) {
      console.error('signal handler failed', err);
    }
  }

  close() {
    clearInterval(this._gc);
    this.pool.close();
  }
}
