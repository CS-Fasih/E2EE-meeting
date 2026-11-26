// One direct, encrypted connection to one other participant.
//
// Each connection is negotiated once with four fixed media slots (mic,
// camera, screen, screen audio) plus a data channel. Turning things on and
// off later only swaps tracks in those slots, so there is no renegotiation
// mid-call.

import { deriveFrameKey, extractFingerprint, safetyNumber } from './crypto.js';
import { attachTransform, onFrameStats, offFrameStats } from './e2ee.js';

export const SLOTS = ['audio', 'cam', 'screen', 'screenAudio'];
const KIND = { audio: 'audio', cam: 'video', screen: 'video', screenAudio: 'audio' };

function preferVp8(transceiver) {
  if (!transceiver.setCodecPreferences || !window.RTCRtpReceiver || !RTCRtpReceiver.getCapabilities) return;
  const caps = RTCRtpReceiver.getCapabilities('video');
  if (!caps) return;
  const codecs = caps.codecs.filter((c) => /^video\/(vp8|rtx|red|ulpfec)$/i.test(c.mimeType));
  if (!codecs.some((c) => /vp8/i.test(c.mimeType))) return;
  try {
    transceiver.setCodecPreferences(codecs);
  } catch {}
}

export class Peer extends EventTarget {
  /**
   * @param {object} o
   * @param {string} o.selfId
   * @param {string} o.remoteId
   * @param {boolean} o.offerer
   * @param {object} o.meeting derived meeting keys
   * @param {RTCIceServer[]} o.iceServers
   * @param {boolean} o.relayOnly
   * @param {'script'|'legacy'|null} o.frameMode
   * @param {(type:string, body:object)=>void} o.signal sends a sealed message to this peer
   * @param {(slot:string)=>MediaStreamTrack|null} o.getTrack
   */
  constructor(o) {
    super();
    Object.assign(this, o);
    this.tx = {};
    this.midToSlot = {};
    this.sentSdp = false;
    this.lateCandidates = [];
    this.pendingRemote = [];
    this.attached = new WeakSet();
    this.restarts = 0;
    this.closed = false;
    this.safety = null;
    this.frameStats = { sentOk: 0, recvOk: 0, recvFailed: 0 };
    this.lastStats = null;
    this.ready = this._init();
  }

  async _init() {
    if (this.frameMode) {
      this.sendKey = await deriveFrameKey(this.meeting.frameKey, this.selfId, this.remoteId);
      this.recvKey = await deriveFrameKey(this.meeting.frameKey, this.remoteId, this.selfId);
    }
    const config = {
      iceServers: this.iceServers,
      iceTransportPolicy: this.relayOnly ? 'relay' : 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    };
    if (this.frameMode === 'legacy') config.encodedInsertableStreams = true;
    const pc = (this.pc = new RTCPeerConnection(config));

    this.dc = pc.createDataChannel('baithak', { negotiated: true, id: 0, ordered: true });
    this.dc.binaryType = 'arraybuffer';
    this.dc.bufferedAmountLowThreshold = 256 * 1024;
    this.dc.onopen = () => this._emit('open');
    this.dc.onclose = () => this._emit('dc-close');
    this.dc.onmessage = (e) => {
      if (typeof e.data === 'string') {
        if (e.data.length > 64 * 1024) return;
        try {
          this._emit('message', JSON.parse(e.data));
        } catch {}
      } else {
        this._emit('binary', e.data);
      }
    };

    pc.ontrack = (e) => {
      const slot = this.midToSlot[e.transceiver.mid];
      if (!slot) return;
      // Chromium only applies an encryption transform that is set while the
      // transceiver is being created, i.e. right here on the answering side.
      // Set later, it is silently ignored and frames would leave unsealed.
      this._attachReceiver(slot, e.receiver);
      this._attachSender(slot, e.transceiver.sender);
      this._emit('track', { slot, track: e.track });
    };
    pc.onicecandidate = (e) => {
      if (!e.candidate || !this.sentSdp) return;
      this.lateCandidates.push(e.candidate.toJSON());
      if (!this._candTimer) {
        this._candTimer = setTimeout(() => {
          this._candTimer = null;
          const c = this.lateCandidates.splice(0);
          if (c.length) this.signal('ice', { c });
        }, 300);
      }
    };
    pc.onconnectionstatechange = () => this._onConnectionState();
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _tag(dir, slot) {
    return `${this.remoteId}:${dir}:${slot}`;
  }

  _attachSender(slot, sender) {
    if (!this.frameMode || this.attached.has(sender)) return;
    this.attached.add(sender);
    const tag = this._tag('send', slot);
    onFrameStats(tag, (s) => {
      this.frameStats.sentOk = Math.max(this.frameStats.sentOk, s.ok);
    });
    attachTransform(this.frameMode, sender, 'encrypt', this.sendKey, KIND[slot], tag);
  }

  _attachReceiver(slot, receiver) {
    if (!this.frameMode || this.attached.has(receiver)) return;
    this.attached.add(receiver);
    const tag = this._tag('recv', slot);
    const per = { ok: 0, failed: 0 };
    onFrameStats(tag, (s) => {
      this.frameStats.recvOk += s.ok - per.ok;
      this.frameStats.recvFailed += s.failed - per.failed;
      per.ok = s.ok;
      per.failed = s.failed;
      if (s.failed > 30 && s.ok === 0) this._emit('decrypt-failing', { slot });
    });
    attachTransform(this.frameMode, receiver, 'decrypt', this.recvKey, KIND[slot], tag);
  }

  _gathered(timeout = 2500) {
    const pc = this.pc;
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(t);
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      };
      const check = () => {
        if (pc.iceGatheringState === 'complete') done();
      };
      const t = setTimeout(done, timeout);
      pc.addEventListener('icegatheringstatechange', check);
    });
  }

  /** Called on the side that starts the connection. */
  async start() {
    await this.ready;
    const pc = this.pc;
    for (const slot of SLOTS) {
      const t = pc.addTransceiver(this.getTrack(slot) || KIND[slot], { direction: 'sendrecv' });
      this.tx[slot] = t;
      if (KIND[slot] === 'video' && this.frameMode) preferVp8(t);
      this._attachSender(slot, t.sender);
      this._attachReceiver(slot, t.receiver);
    }
    await this._sendOffer(false);
  }

  async _sendOffer(iceRestart) {
    const pc = this.pc;
    const offer = await pc.createOffer({ iceRestart });
    await pc.setLocalDescription(offer);
    for (const slot of SLOTS) this.midToSlot[this.tx[slot].mid] = slot;
    this.sentSdp = false;
    await this._gathered();
    if (this.closed) return;
    const mids = Object.fromEntries(SLOTS.map((s) => [s, this.tx[s].mid]));
    this.signal('offer', { sdp: pc.localDescription.sdp, mids, restart: !!iceRestart });
    this.sentSdp = true;
  }

  async handleOffer({ sdp, mids }) {
    await this.ready;
    const pc = this.pc;
    if (typeof sdp !== 'string' || !mids || typeof mids !== 'object') return;
    const first = !pc.remoteDescription;
    if (first) {
      for (const slot of SLOTS) if (typeof mids[slot] === 'string') this.midToSlot[mids[slot]] = slot;
    }
    await pc.setRemoteDescription({ type: 'offer', sdp });
    if (first) {
      const byMid = new Map(pc.getTransceivers().map((t) => [t.mid, t]));
      for (const slot of SLOTS) {
        const t = byMid.get(mids[slot]);
        if (!t) continue;
        this.tx[slot] = t;
        t.direction = 'sendrecv';
        if (KIND[slot] === 'video' && this.frameMode) preferVp8(t);
        this._attachReceiver(slot, t.receiver);
        this._attachSender(slot, t.sender);
        await t.sender.replaceTrack(this.getTrack(slot) || null);
      }
    }
    await this._drainRemoteCandidates();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.sentSdp = false;
    await this._gathered();
    if (this.closed) return;
    this.signal('answer', { sdp: pc.localDescription.sdp });
    this.sentSdp = true;
    this._computeSafety();
  }

  async handleAnswer({ sdp }) {
    await this.ready;
    if (typeof sdp !== 'string' || this.pc.signalingState !== 'have-local-offer') return;
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
    await this._drainRemoteCandidates();
    this._computeSafety();
  }

  async handleIce({ c }) {
    await this.ready;
    if (!Array.isArray(c)) return;
    for (const cand of c.slice(0, 50)) {
      if (!this.pc.remoteDescription) this.pendingRemote.push(cand);
      else await this.pc.addIceCandidate(cand).catch(() => {});
    }
  }

  async _drainRemoteCandidates() {
    const list = this.pendingRemote.splice(0);
    for (const cand of list) await this.pc.addIceCandidate(cand).catch(() => {});
  }

  async _computeSafety() {
    const local = extractFingerprint(this.pc.localDescription && this.pc.localDescription.sdp);
    const remote = extractFingerprint(this.pc.remoteDescription && this.pc.remoteDescription.sdp);
    if (!local || !remote) return;
    const s = await safetyNumber(local, remote);
    const changed = !this.safety || this.safety.digits.join('') !== s.digits.join('');
    this.safety = s;
    if (changed) this._emit('safety', s);
  }

  _onConnectionState() {
    const st = this.pc.connectionState;
    this._emit('state', st);
    clearTimeout(this._discTimer);
    if (st === 'connected') {
      this.restarts = 0;
    } else if (st === 'failed') {
      this._restart();
    } else if (st === 'disconnected') {
      this._discTimer = setTimeout(() => {
        if (this.pc.connectionState === 'disconnected') this._restart();
      }, 5000);
    }
  }

  async _restart() {
    if (this.closed || !this.offerer || this.restarts >= 4) return;
    this.restarts++;
    try {
      this.pc.restartIce();
      await this._sendOffer(true);
    } catch {}
  }

  get state() {
    return this.pc ? this.pc.connectionState : 'new';
  }

  async replaceTrack(slot, track) {
    await this.ready;
    const t = this.tx[slot];
    if (!t) return;
    try {
      await t.sender.replaceTrack(track || null);
    } catch {}
  }

  async setMaxBitrate(slot, bps) {
    const t = this.tx[slot];
    if (!t) return;
    try {
      const p = t.sender.getParameters();
      if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      p.encodings[0].maxBitrate = bps;
      if (slot === 'screen') p.degradationPreference = 'maintain-resolution';
      await t.sender.setParameters(p);
    } catch {}
  }

  send(obj) {
    if (this.dc && this.dc.readyState === 'open') {
      try {
        this.dc.send(JSON.stringify(obj));
        return true;
      } catch {}
    }
    return false;
  }

  async sendBinary(buf) {
    const dc = this.dc;
    if (!dc || dc.readyState !== 'open') throw new Error('closed');
    if (dc.bufferedAmount > 4 * 1024 * 1024) {
      await new Promise((resolve) => {
        const fn = () => {
          dc.removeEventListener('bufferedamountlow', fn);
          resolve();
        };
        dc.addEventListener('bufferedamountlow', fn);
      });
    }
    dc.send(buf);
  }

  /** Connection details for the info panel. */
  async stats() {
    if (!this.pc) return null;
    const report = await this.pc.getStats();
    const out = { rtt: null, path: null, protocol: null, inBps: 0, outBps: 0, codecs: new Set(), lossPct: 0 };
    const byId = new Map();
    report.forEach((r) => byId.set(r.id, r));
    let bytesIn = 0, bytesOut = 0, lost = 0, received = 0;
    report.forEach((r) => {
      if (r.type === 'candidate-pair' && (r.nominated || r.selected) && r.state === 'succeeded') {
        if (r.currentRoundTripTime != null) out.rtt = Math.round(r.currentRoundTripTime * 1000);
        const local = byId.get(r.localCandidateId);
        const remote = byId.get(r.remoteCandidateId);
        if (local && remote) {
          out.path = local.candidateType === 'relay' || remote.candidateType === 'relay' ? 'relay' : 'direct';
          out.protocol = local.protocol;
        }
      } else if (r.type === 'inbound-rtp') {
        bytesIn += r.bytesReceived || 0;
        lost += r.packetsLost || 0;
        received += r.packetsReceived || 0;
        const c = r.codecId && byId.get(r.codecId);
        if (c) out.codecs.add(c.mimeType.split('/')[1]);
      } else if (r.type === 'outbound-rtp') {
        bytesOut += r.bytesSent || 0;
      }
    });
    const now = performance.now();
    if (this.lastStats) {
      const dt = (now - this.lastStats.t) / 1000;
      if (dt > 0) {
        out.inBps = Math.max(0, ((bytesIn - this.lastStats.bytesIn) * 8) / dt);
        out.outBps = Math.max(0, ((bytesOut - this.lastStats.bytesOut) * 8) / dt);
      }
      const dl = lost - this.lastStats.lost;
      const dr = received - this.lastStats.received;
      out.lossPct = dl + dr > 0 ? (100 * dl) / (dl + dr) : 0;
    }
    this.lastStats = { t: now, bytesIn, bytesOut, lost, received };
    out.codecs = [...out.codecs];
    return out;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this._discTimer);
    clearTimeout(this._candTimer);
    offFrameStats(this.remoteId + ':');
    try {
      this.dc && this.dc.close();
    } catch {}
    try {
      this.pc && this.pc.close();
    } catch {}
  }
}
