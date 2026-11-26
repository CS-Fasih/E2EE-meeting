// The meeting: who is here, who may come in, and the connections between
// everyone. There is no server-side state: every participant keeps the same
// picture of the room and connects directly to every other participant.
//
// Host: the person who has been in the meeting longest. If they leave, the
// next longest-standing person takes over automatically.

import { deriveMeeting, randomId, randomBytes, toHex } from './crypto.js';
import { Signal } from './signal.js';
import { Peer, SLOTS } from './peer.js';
import { frameEncryptionMode } from './e2ee.js';

export const MAX_PARTICIPANTS = 8;
const FILE_CHUNK = 16 * 1024;
const MAX_FILE = 512 * 1024 * 1024;

const clampText = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const cleanName = (v) => clampText(v, 40).replace(/[\u0000-\u001f\u007f]/g, '').trim() || 'Guest';

export class Meeting extends EventTarget {
  /**
   * @param {object} o
   * @param {string} o.code
   * @param {string} o.password
   * @param {string} o.name
   * @param {boolean} o.isNew true when this person just created the meeting
   * @param {object} o.settings app settings (relays, ICE servers, lobby default)
   * @param {import('./media.js').LocalMedia} o.media
   */
  constructor(o) {
    super();
    this.code = o.code;
    this.password = o.password || '';
    this.name = cleanName(o.name);
    this.isNew = !!o.isNew;
    this.settings = o.settings;
    this.media = o.media;
    this.selfId = randomId();
    this.joinedAt = Date.now();
    this.phase = 'idle'; // idle | searching | waiting | in-call | locked | full | denied | removed | ended | left
    this.participants = new Map();
    this.admitted = new Set();
    this.blocked = new Set();
    this.knocks = new Map();
    this.pendingOffers = new Map();
    this.room = { lobby: o.settings.lobby !== false, locked: false };
    this.hostId = null;
    this.hand = false;
    this.recording = false;
    this.frameMode = o.settings.frameEncryption === false ? null : frameEncryptionMode();
    this.chat = [];
    this.files = new Map(); // fid -> outgoing File
    this.incoming = new Map(); // fid -> { meta, from, chunks, received }
    this.passwordProblem = false;
    this._timers = [];
    this._onMediaChange = (e) => this._localTrackChanged(e.detail.slot, e.detail.track);
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  get inCall() {
    return this.phase === 'in-call';
  }

  get isHost() {
    return this.inCall && this.hostId === this.selfId;
  }

  get connected() {
    return [...this.participants.values()].filter((p) => p.status === 'connected' || p.status === 'connecting');
  }

  async join() {
    this.meeting = await deriveMeeting(this.code, this.password);
    this.signal = new Signal({
      meeting: this.meeting,
      selfId: this.selfId,
      relays: this.settings.relays,
      onMessage: (t, f, b) => this._onSignal(t, f, b),
      onLocked: (info) => this._onUndecryptable(info),
      onStatus: (s) => this.emit('relays', s),
    });
    this.signal.start();
    this.media.addEventListener('change', this._onMediaChange);
    this._setPhase('searching');
    this._hello();
    this._timers.push(setInterval(() => this._tick(), 3000));
    if (this.isNew) {
      this._enterCall();
    } else {
      // Give people already in the meeting a moment to answer.
      this._timers.push(
        setTimeout(() => {
          if (this.phase === 'searching') this._enterCall();
        }, 6000),
      );
    }
  }

  _setPhase(p, info) {
    if (this.phase === p) return;
    this.phase = p;
    this.emit('phase', { phase: p, ...info });
  }

  _enterCall() {
    if (this.phase === 'in-call') return;
    this._setPhase('in-call');
    this.admitted.add(this.selfId);
    this._recomputeHost();
    this._hello();
  }

  _tick() {
    // Keep announcing while we are alone or waiting, so people who arrive at
    // the same moment still find each other.
    if (this.phase === 'searching' || this.phase === 'waiting' || (this.inCall && this.connected.length === 0)) {
      this._hello();
    }
    const now = Date.now();
    for (const [id, k] of this.knocks) {
      if (now - k.at > 20000) {
        this.knocks.delete(id);
        this.emit('knocks', [...this.knocks.values()]);
      }
    }
    for (const [id, o] of this.pendingOffers) {
      if (now - o.at > 15000) this.pendingOffers.delete(id);
    }
  }

  _caps() {
    return { frame: !!this.frameMode };
  }

  _hello() {
    this.signal.send('hello', { name: this.name, joinedAt: this.joinedAt, inCall: this.inCall, caps: this._caps() });
  }

  _onUndecryptable(info) {
    const lonely = this.phase === 'searching' || (this.inCall && !this.isNew && this.connected.length === 0);
    if (!lonely) return;
    if (!this.passwordProblem && info.count >= 2) {
      this.passwordProblem = true;
      this.emit('password-problem', { hasPassword: this.meeting.hasPassword, hint: info.passwordHint });
    }
  }

  _participant(id, info = {}) {
    let p = this.participants.get(id);
    if (!p) {
      p = {
        id,
        name: 'Guest',
        joinedAt: Number.MAX_SAFE_INTEGER,
        status: 'known',
        inCall: false,
        caps: {},
        peer: null,
        tracks: { audio: null, cam: null, screen: null, screenAudio: null },
        state: { mic: false, cam: false, screen: false, hand: false, recording: false },
        safety: null,
        verified: false,
        e2ee: null,
        connectionState: 'new',
      };
      this.participants.set(id, p);
    }
    if (info.name !== undefined) p.name = cleanName(info.name);
    if (typeof info.joinedAt === 'number' && isFinite(info.joinedAt)) p.joinedAt = info.joinedAt;
    if (info.caps && typeof info.caps === 'object') p.caps = { frame: !!info.caps.frame };
    if (typeof info.inCall === 'boolean') p.inCall = info.inCall;
    return p;
  }

  /** True when `a` joined after `b` (ties broken by id). The newer side starts the connection. */
  _isNewer(aJoined, aId, bJoined, bId) {
    return aJoined > bJoined || (aJoined === bJoined && aId > bId);
  }

  _onSignal(type, from, body) {
    if (this.blocked.has(from)) return;
    switch (type) {
      case 'hello':
        return this._onHello(from, body);
      case 'here':
        return this._onHere(from, body);
      case 'admit': {
        // In the call, only the host's decision counts. While waiting, accept
        // it from anyone already inside.
        const sender = this.participants.get(from);
        if (this.inCall ? from !== this.hostId : !(sender && sender.inCall)) return;
        return this._onAdmit(from, body.id);
      }
      case 'deny':
        if (body.id === this.selfId && this.phase === 'waiting') this._end('denied');
        return;
      case 'kick':
        if (body.id === this.selfId && from === this.hostId) this._end('removed');
        return;
      case 'offer':
        return this._onOffer(from, body);
      case 'answer': {
        const p = this.participants.get(from);
        if (p && p.peer) p.peer.handleAnswer(body).catch((e) => console.warn(e));
        return;
      }
      case 'ice': {
        const p = this.participants.get(from);
        if (p && p.peer) p.peer.handleIce(body).catch(() => {});
        return;
      }
      case 'bye':
        return this._drop(from, 'left');
      default:
        return;
    }
  }

  _roomFull() {
    return this.connected.length + 1 >= MAX_PARTICIPANTS;
  }

  _onHello(from, body) {
    const p = this._participant(from, body);
    if (!this.inCall) return;
    const full = this._roomFull() && !p.peer;
    this.signal.send(
      'here',
      {
        name: this.name,
        joinedAt: this.joinedAt,
        caps: this._caps(),
        room: this.room,
        hostId: this.hostId,
        full,
      },
      from,
    );
    if (p.peer) return;
    if (body.inCall && (this.connected.length === 0 || !this.room.lobby)) {
      // Two people who started at the same moment: join them up.
      this.admitted.add(from);
      p.trusted = true;
      if (!this._isNewer(p.joinedAt, from, this.joinedAt, this.selfId)) this._connect(p, true);
      return;
    }
    if (this.room.locked || full) return;
    if (this.room.lobby && !this.admitted.has(from)) {
      if (this.isHost) {
        const isNew = !this.knocks.has(from);
        this.knocks.set(from, { id: from, name: p.name, at: Date.now() });
        if (isNew) this.emit('knock', { id: from, name: p.name });
        this.emit('knocks', [...this.knocks.values()]);
      }
    } else if (this.room.lobby && this.isHost) {
      this.signal.send('admit', { id: from });
    }
  }

  _onHere(from, body) {
    const p = this._participant(from, { ...body, inCall: true });
    const fromHost = body.hostId === from || !this.hostId;
    if (fromHost && body.room && typeof body.room === 'object') {
      this.room = { lobby: !!body.room.lobby, locked: !!body.room.locked };
    }
    if (this.phase === 'searching' || this.phase === 'waiting') {
      if (body.full) return this._end('full');
      if (this.room.locked) return this._end('locked');
      if (this.room.lobby && !this.admitted.has(this.selfId)) {
        this._setPhase('waiting');
        return;
      }
      this._enterCall();
    }
    if (this.inCall && !p.peer && this._isNewer(this.joinedAt, this.selfId, p.joinedAt, from)) {
      this._connect(p, true);
    }
  }

  _onAdmit(from, id) {
    if (typeof id !== 'string') return;
    this.admitted.add(id);
    this.knocks.delete(id);
    this.emit('knocks', [...this.knocks.values()]);
    if (id === this.selfId && this.phase === 'waiting') {
      this._enterCall();
      for (const p of this.participants.values()) {
        if (p.inCall && !p.peer && this._isNewer(this.joinedAt, this.selfId, p.joinedAt, p.id)) this._connect(p, true);
      }
    }
    const pending = this.pendingOffers.get(id);
    if (pending) {
      this.pendingOffers.delete(id);
      this._onOffer(id, pending.body);
    }
  }

  _onOffer(from, body) {
    if (!this.inCall) return;
    const p = this._participant(from);
    if (p.peer) {
      p.peer.handleOffer(body).catch((e) => console.warn(e));
      return;
    }
    const allowed = !this.room.lobby || this.admitted.has(from) || p.trusted;
    if (this.room.locked && !p.trusted) return;
    if (!allowed) {
      this.pendingOffers.set(from, { body, at: Date.now() });
      return;
    }
    if (this._roomFull()) return;
    this._connect(p, false);
    p.peer.handleOffer(body).catch((e) => console.warn(e));
  }

  _connect(p, offerer) {
    if (p.peer) return;
    const frameMode = this.frameMode && p.caps.frame ? this.frameMode : null;
    p.e2ee = frameMode ? 'frame' : 'transport';
    p.status = 'connecting';
    p.inCall = true;
    const peer = new Peer({
      selfId: this.selfId,
      remoteId: p.id,
      offerer,
      meeting: this.meeting,
      iceServers: this.settings.iceServers,
      relayOnly: !!this.settings.relayOnly,
      frameMode,
      signal: (type, body) => this.signal.send(type, body, p.id),
      getTrack: (slot) => this.media.get(slot),
    });
    p.peer = peer;
    peer.addEventListener('open', () => {
      p.status = 'connected';
      peer.send(this._statePayload());
      if (this.isHost) peer.send({ t: 'room', room: this.room });
      this._recomputeHost();
      this._tuneBitrates();
      this.emit('participants');
      this.emit('joined', { id: p.id, name: p.name });
    });
    peer.addEventListener('state', (e) => {
      p.connectionState = e.detail;
      if (e.detail === 'closed') this._drop(p.id, 'left');
      this.emit('participant', p);
    });
    peer.addEventListener('dc-close', () => {
      if (p.status === 'connected') this._drop(p.id, 'left');
    });
    peer.addEventListener('track', (e) => {
      p.tracks[e.detail.slot] = e.detail.track;
      this.emit('track', { participant: p, slot: e.detail.slot, track: e.detail.track });
    });
    peer.addEventListener('safety', (e) => {
      const was = p.safety;
      p.safety = e.detail.digits;
      if (was && was.join('') !== p.safety.join('')) p.verified = false;
      this.emit('participant', p);
    });
    peer.addEventListener('decrypt-failing', () => this.emit('decrypt-failing', p));
    peer.addEventListener('message', (e) => this._onData(p, e.detail));
    peer.addEventListener('binary', (e) => this._onBinary(p, e.detail));
    if (offerer) peer.start().catch((e) => console.warn('start failed', e));
    this.emit('participants');
    // Tell the person if a direct path cannot be found.
    setTimeout(() => {
      if (p.peer === peer && p.status === 'connecting') this.emit('slow', p);
    }, 20000);
  }

  _drop(id, reason) {
    const p = this.participants.get(id);
    if (!p) return;
    const wasConnected = p.status === 'connected';
    if (p.peer) p.peer.close();
    p.peer = null;
    p.status = 'left';
    this.participants.delete(id);
    this.knocks.delete(id);
    for (const [fid, f] of this.incoming) if (f.from === id) this.incoming.delete(fid);
    this._recomputeHost();
    this._tuneBitrates();
    this.emit('participants');
    if (wasConnected) this.emit('left', { id, name: p.name, reason });
  }

  _recomputeHost() {
    if (!this.inCall) return;
    let best = { id: this.selfId, joinedAt: this.joinedAt };
    for (const p of this.participants.values()) {
      if (p.status !== 'connected') continue;
      if (this._isNewer(best.joinedAt, best.id, p.joinedAt, p.id)) best = { id: p.id, joinedAt: p.joinedAt };
    }
    if (best.id !== this.hostId) {
      const before = this.hostId;
      this.hostId = best.id;
      this.emit('host', { hostId: best.id, isMe: best.id === this.selfId, before });
    }
  }

  _tuneBitrates() {
    const n = Math.max(1, this.connected.length);
    const cam = n <= 1 ? 1500000 : n <= 2 ? 1000000 : n <= 4 ? 600000 : 350000;
    const screen = n <= 2 ? 2500000 : 1500000;
    for (const p of this.connected) {
      if (!p.peer) continue;
      p.peer.setMaxBitrate('cam', cam);
      p.peer.setMaxBitrate('screen', screen);
    }
  }

  _localTrackChanged(slot, track) {
    for (const p of this.participants.values()) if (p.peer) p.peer.replaceTrack(slot, track);
    this.broadcastState();
  }

  _statePayload() {
    return {
      t: 'state',
      name: this.name,
      joinedAt: this.joinedAt,
      mic: !!this.media.get('audio'),
      cam: !!this.media.get('cam'),
      screen: !!this.media.get('screen'),
      hand: this.hand,
      recording: this.recording,
    };
  }

  broadcast(obj) {
    for (const p of this.participants.values()) if (p.peer && p.status === 'connected') p.peer.send(obj);
  }

  broadcastState() {
    if (this.inCall) this.broadcast(this._statePayload());
    this.emit('self');
  }

  _onData(p, m) {
    if (!m || typeof m.t !== 'string') return;
    const fromHost = p.id === this.hostId;
    switch (m.t) {
      case 'state': {
        p.name = cleanName(m.name);
        if (typeof m.joinedAt === 'number') p.joinedAt = m.joinedAt;
        const before = p.state.hand;
        p.state = { mic: !!m.mic, cam: !!m.cam, screen: !!m.screen, hand: !!m.hand, recording: !!m.recording };
        if (!before && p.state.hand) this.emit('hand', p);
        this._recomputeHost();
        this.emit('participant', p);
        return;
      }
      case 'chat': {
        const text = clampText(m.text, 4000);
        if (!text.trim()) return;
        const msg = { id: clampText(m.id, 40) || randomId(), from: p.id, name: p.name, text, at: Date.now() };
        this.chat.push(msg);
        this.emit('chat', msg);
        return;
      }
      case 'react': {
        const e = clampText(m.e, 8);
        if (REACTIONS.includes(e)) this.emit('reaction', { participant: p, emoji: e });
        return;
      }
      case 'room':
        if (fromHost && m.room) {
          const next = { lobby: !!m.room.lobby, locked: !!m.room.locked };
          const changed = next.lobby !== this.room.lobby || next.locked !== this.room.locked;
          this.room = next;
          if (changed) this.emit('room', { ...this.room, changed: true });
        }
        return;
      case 'admit':
        if (fromHost) this._onAdmit(p.id, m.id);
        return;
      case 'kick':
        if (!fromHost || typeof m.id !== 'string') return;
        if (m.id === this.selfId) return this._end('removed');
        this.blocked.add(m.id);
        this._drop(m.id, 'removed');
        return;
      case 'mute':
        if (fromHost && this.media.get('audio')) {
          this.media.stopMic();
          this.emit('muted-by-host', p);
        }
        return;
      case 'lower-hand':
        if (fromHost && this.hand) this.setHand(false);
        return;
      case 'end':
        if (fromHost) this._end('ended');
        return;
      case 'file-offer': {
        const fid = clampText(m.fid, 32);
        const size = Number(m.size);
        if (!/^[0-9a-f]{16}$/.test(fid) || !(size >= 0 && size <= MAX_FILE)) return;
        const meta = { fid, name: clampText(m.name, 200) || 'file', size, mime: clampText(m.mime, 100) };
        const msg = { id: 'f' + fid, from: p.id, name: p.name, file: meta, at: Date.now() };
        this.chat.push(msg);
        this.emit('chat', msg);
        return;
      }
      case 'file-req':
        this._sendFile(p, clampText(m.fid, 32));
        return;
      case 'file-done': {
        const f = this.incoming.get(m.fid);
        if (!f || f.from !== p.id) return;
        this.incoming.delete(m.fid);
        const blob = new Blob(f.chunks, { type: f.meta.mime || 'application/octet-stream' });
        this.emit('file-progress', { fid: m.fid, received: f.received, size: f.meta.size, done: true, blob });
        return;
      }
      case 'bye':
        this._drop(p.id, 'left');
        return;
      default:
        return;
    }
  }

  _onBinary(p, buf) {
    if (!(buf instanceof ArrayBuffer) || buf.byteLength < 8) return;
    const fid = toHex(new Uint8Array(buf, 0, 8));
    const f = this.incoming.get(fid);
    if (!f || f.from !== p.id) return;
    f.chunks.push(buf.slice(8));
    f.received += buf.byteLength - 8;
    if (f.received > f.meta.size) {
      this.incoming.delete(fid);
      return;
    }
    const now = performance.now();
    if (now - f.lastEmit > 200) {
      f.lastEmit = now;
      this.emit('file-progress', { fid, received: f.received, size: f.meta.size, done: false });
    }
  }

  // ---- actions -------------------------------------------------------

  sendChat(text) {
    text = clampText(text, 4000);
    if (!text.trim()) return;
    const msg = { id: randomId(), from: this.selfId, name: this.name, text, at: Date.now(), mine: true };
    this.chat.push(msg);
    this.broadcast({ t: 'chat', id: msg.id, text });
    this.emit('chat', msg);
  }

  react(emoji) {
    if (!REACTIONS.includes(emoji)) return;
    this.broadcast({ t: 'react', e: emoji });
    this.emit('reaction', { participant: null, emoji });
  }

  setHand(up) {
    this.hand = !!up;
    this.broadcastState();
  }

  setRecording(on) {
    this.recording = !!on;
    this.broadcastState();
  }

  rename(name) {
    this.name = cleanName(name);
    this.broadcastState();
  }

  shareFile(file) {
    if (!file || file.size > MAX_FILE) return null;
    const fid = toHex(randomBytes(8));
    this.files.set(fid, file);
    const meta = { fid, name: file.name.slice(0, 200), size: file.size, mime: file.type };
    this.broadcast({ t: 'file-offer', ...meta });
    const msg = { id: 'f' + fid, from: this.selfId, name: this.name, file: meta, at: Date.now(), mine: true, local: file };
    this.chat.push(msg);
    this.emit('chat', msg);
    return msg;
  }

  requestFile(fid, fromId) {
    const p = this.participants.get(fromId);
    if (!p || !p.peer) return false;
    const msg = this.chat.find((m) => m.file && m.file.fid === fid);
    if (!msg) return false;
    this.incoming.set(fid, { meta: msg.file, from: fromId, chunks: [], received: 0, lastEmit: 0 });
    p.peer.send({ t: 'file-req', fid });
    return true;
  }

  async _sendFile(p, fid) {
    const file = this.files.get(fid);
    if (!file || !p.peer) return;
    const head = new Uint8Array(8);
    for (let i = 0; i < 8; i++) head[i] = parseInt(fid.substr(i * 2, 2), 16);
    try {
      for (let off = 0; off < file.size; off += FILE_CHUNK) {
        const part = new Uint8Array(await file.slice(off, off + FILE_CHUNK).arrayBuffer());
        const buf = new Uint8Array(8 + part.byteLength);
        buf.set(head, 0);
        buf.set(part, 8);
        await p.peer.sendBinary(buf.buffer);
      }
      p.peer.send({ t: 'file-done', fid });
    } catch {}
  }

  admit(id) {
    this.admitted.add(id);
    this.knocks.delete(id);
    this.signal.send('admit', { id });
    this.broadcast({ t: 'admit', id });
    this.emit('knocks', [...this.knocks.values()]);
  }

  deny(id) {
    this.knocks.delete(id);
    this.signal.send('deny', { id }, id);
    this.emit('knocks', [...this.knocks.values()]);
  }

  setRoom(changes) {
    if (!this.isHost) return;
    this.room = { ...this.room, ...changes };
    this.broadcast({ t: 'room', room: this.room });
    this.emit('room', this.room);
    if (!this.room.lobby) {
      for (const k of [...this.knocks.keys()]) this.admit(k);
    }
  }

  remove(id) {
    if (!this.isHost) return;
    this.blocked.add(id);
    this.broadcast({ t: 'kick', id });
    this.signal.send('kick', { id }, id);
    this._drop(id, 'removed');
  }

  askToMute(id) {
    if (!this.isHost) return;
    const p = this.participants.get(id);
    if (p && p.peer) p.peer.send({ t: 'mute' });
  }

  muteAll() {
    if (!this.isHost) return;
    this.broadcast({ t: 'mute' });
  }

  lowerHand(id) {
    if (!this.isHost) return;
    const p = this.participants.get(id);
    if (p && p.peer) p.peer.send({ t: 'lower-hand' });
  }

  endForAll() {
    if (!this.isHost) return;
    this.broadcast({ t: 'end' });
    this.leave();
  }

  setVerified(id, v) {
    const p = this.participants.get(id);
    if (p) {
      p.verified = !!v;
      this.emit('participant', p);
    }
  }

  _end(reason) {
    this.leave(reason);
  }

  leave(reason = 'left') {
    if (this.phase === 'left' || this.phase === reason) return;
    try {
      this.broadcast({ t: 'bye' });
      if (this.signal) this.signal.send('bye', {});
    } catch {}
    for (const t of this._timers) {
      clearInterval(t);
      clearTimeout(t);
    }
    this._timers = [];
    for (const p of this.participants.values()) if (p.peer) p.peer.close();
    this.participants.clear();
    this.media.removeEventListener('change', this._onMediaChange);
    const sig = this.signal;
    // Give the goodbye a moment to reach the relays.
    setTimeout(() => sig && sig.close(), 400);
    this.files.clear();
    this.incoming.clear();
    this.chat = [];
    if (this.meeting) this.meeting.frameKey.fill(0);
    this._setPhase(reason === 'left' ? 'left' : reason);
  }
}

export const REACTIONS = ['👍', '👏', '😂', '❤️', '🎉', '😮', '🤔', '🙏'];
export { SLOTS };
