// Relay transport.
//
// Baithak does not run a server of its own. Signalling messages (who is in
// the meeting, connection offers and answers) travel through Nostr relays as
// short-lived "ephemeral" events that relays forward but do not store. Every
// message is sealed with the meeting key before it leaves the device, so a
// relay sees only an opaque topic tag and ciphertext. Several relays are used
// at once so one going down does not break a call; duplicates are dropped.
//
// Each session signs with a throwaway key pair that is never reused, so
// sessions cannot be linked to each other through the relay protocol.

import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

export const EVENT_KIND = 25051; // ephemeral range (20000-29999): not stored by relays
const te = new TextEncoder();

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.mom',
  'wss://relay.nostr.net',
];

function serialise(ev) {
  return JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]);
}

export class RelayPool {
  /**
   * @param {string[]} urls
   * @param {string} topic opaque routing tag
   * @param {(content:string)=>void} onContent
   * @param {(status:{open:number,total:number})=>void} onStatus
   */
  constructor(urls, topic, onContent, onStatus) {
    this.urls = [...new Set(urls.filter(Boolean))];
    this.topic = topic;
    this.onContent = onContent;
    this.onStatus = onStatus || (() => {});
    this.sockets = new Map();
    this.seen = new Map(); // event id -> time
    this.secret = schnorr.utils.randomSecretKey();
    this.pubkey = bytesToHex(schnorr.getPublicKey(this.secret));
    this.subId = bytesToHex(crypto.getRandomValues(new Uint8Array(8)));
    this.closed = false;
    this.pending = [];
    this.startedAt = Math.floor(Date.now() / 1000);
    this.lastErrors = new Map();
  }

  start() {
    for (const url of this.urls) this._open(url, 0);
    this._gc = setInterval(() => this._sweep(), 30000);
  }

  get openCount() {
    let n = 0;
    for (const s of this.sockets.values()) if (s.ws && s.ws.readyState === WebSocket.OPEN && s.ready) n++;
    return n;
  }

  _report() {
    this.onStatus({ open: this.openCount, total: this.urls.length });
  }

  _open(url, attempt) {
    if (this.closed) return;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      this.lastErrors.set(url, String(err && err.message || err));
      return;
    }
    const state = { ws, ready: false, attempt, url };
    this.sockets.set(url, state);
    ws.onopen = () => {
      state.ready = true;
      state.attempt = 0;
      const filter = { kinds: [EVENT_KIND], '#x': [this.topic], since: Math.floor(Date.now() / 1000) - 30 };
      ws.send(JSON.stringify(['REQ', this.subId, filter]));
      for (const ev of this.pending) ws.send(JSON.stringify(['EVENT', ev]));
      this._report();
    };
    ws.onmessage = (msg) => this._onMessage(url, msg.data);
    ws.onerror = () => {};
    ws.onclose = () => {
      state.ready = false;
      this._report();
      if (this.closed) return;
      const delay = Math.min(30000, 1000 * 2 ** Math.min(state.attempt, 5)) + Math.random() * 500;
      setTimeout(() => this._open(url, state.attempt + 1), delay);
    };
  }

  _onMessage(url, data) {
    if (typeof data !== 'string' || data.length > 256 * 1024) return;
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!Array.isArray(msg)) return;
    if (msg[0] === 'EVENT' && msg[1] === this.subId) {
      const ev = msg[2];
      if (!ev || typeof ev.id !== 'string' || typeof ev.content !== 'string') return;
      if (ev.kind !== EVENT_KIND) return;
      if (this.seen.has(ev.id)) return;
      if (!Array.isArray(ev.tags) || !ev.tags.some((t) => t[0] === 'x' && t[1] === this.topic)) return;
      // Relays are untrusted: check the event id and signature ourselves.
      try {
        const id = bytesToHex(sha256(te.encode(serialise(ev))));
        if (id !== ev.id) return;
        if (!schnorr.verify(hexToBytes(ev.sig), hexToBytes(ev.id), hexToBytes(ev.pubkey))) return;
      } catch {
        return;
      }
      this.seen.set(ev.id, Date.now());
      if (ev.pubkey === this.pubkey) return; // our own echo
      this.onContent(ev.content);
    } else if (msg[0] === 'OK' && msg[2] === false) {
      this.lastErrors.set(url, String(msg[3] || 'rejected'));
    } else if (msg[0] === 'CLOSED' && msg[1] === this.subId) {
      this.lastErrors.set(url, String(msg[2] || 'closed'));
    }
  }

  publish(content) {
    const ev = {
      pubkey: this.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: EVENT_KIND,
      tags: [['x', this.topic]],
      content,
    };
    const idBytes = sha256(te.encode(serialise(ev)));
    ev.id = bytesToHex(idBytes);
    ev.sig = bytesToHex(schnorr.sign(idBytes, this.secret));
    this.seen.set(ev.id, Date.now());
    const frame = JSON.stringify(['EVENT', ev]);
    let sent = 0;
    for (const s of this.sockets.values()) {
      if (s.ready && s.ws.readyState === WebSocket.OPEN) {
        try {
          s.ws.send(frame);
          sent++;
        } catch {}
      }
    }
    if (!sent) {
      // Nothing is connected yet: keep a few recent messages to replay on connect.
      this.pending.push(ev);
      if (this.pending.length > 20) this.pending.shift();
    }
    return sent;
  }

  _sweep() {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [id, t] of this.seen) if (t < cutoff) this.seen.delete(id);
    const pendingCutoff = Math.floor(Date.now() / 1000) - 60;
    this.pending = this.pending.filter((e) => e.created_at > pendingCutoff);
  }

  close() {
    this.closed = true;
    clearInterval(this._gc);
    for (const s of this.sockets.values()) {
      try {
        if (s.ws.readyState === WebSocket.OPEN) s.ws.send(JSON.stringify(['CLOSE', this.subId]));
        s.ws.close();
      } catch {}
    }
    this.sockets.clear();
    this.secret.fill(0);
  }
}
