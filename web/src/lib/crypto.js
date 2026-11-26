// Key handling for Handshake.
//
// A meeting is identified by a random 120-bit secret, shown to people as a
// 24-character code (Crockford base32, grouped in fours). Everything is
// derived from that secret on the device:
//
//   topic     - an opaque tag the relays use to route messages. It reveals
//               nothing about the secret.
//   sigKey    - AES-256-GCM key that seals every signalling message, so the
//               relays can neither read nor forge offers, answers or chat.
//   frameKey  - base key for the extra media-frame encryption layer.
//
// An optional meeting password is stretched with PBKDF2 and mixed into the
// key material, so the code alone is not enough to read the meeting.

const te = new TextEncoder();
const td = new TextDecoder();

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // Crockford base32, no i l o u
export const CODE_BYTES = 15; // 120 bits -> 24 base32 chars

export function randomBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export function toHex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export function b64encode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64decode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base32encode(bytes) {
  let bits = 0, value = 0, out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of str) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('bad code');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function formatCode(raw) {
  return raw.match(/.{1,4}/g).join('-');
}

/** Creates a fresh meeting code, e.g. "k7f2-9qxm-3bd0-wv8t-hp4c-ezr6". */
export function newMeetingCode() {
  return formatCode(base32encode(randomBytes(CODE_BYTES)));
}

/**
 * Pulls a meeting code out of whatever the person pasted: the bare code,
 * the code with spaces, or a full invite link. Returns the formatted code
 * or null.
 */
export function parseMeetingCode(input) {
  if (!input) return null;
  let text = String(input).trim();
  const hashAt = text.indexOf('#');
  if (hashAt >= 0) text = text.slice(hashAt + 1);
  text = text.replace(/^join[=/]/i, '').replace(/^handshake:\/\/join\/?/i, '');
  const cleaned = text
    .toLowerCase()
    .replace(/[il]/g, '1')
    .replace(/o/g, '0')
    .replace(/u/g, 'v')
    .replace(/[^0-9a-z]/g, '');
  if (cleaned.length !== 24) return null;
  for (const ch of cleaned) if (!ALPHABET.includes(ch)) return null;
  return formatCode(cleaned);
}

async function hkdf(ikm, salt, info, length = 32) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: te.encode(salt), info: te.encode(info) },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

async function stretchPassword(password, topic) {
  const key = await crypto.subtle.importKey('raw', te.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: te.encode('handshake/v1/password/' + topic), iterations: 600000 },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/**
 * Derives every key for a meeting. `password` may be empty.
 * @returns {Promise<{code:string, topic:string, hasPassword:boolean, sigKey:CryptoKey, frameKey:Uint8Array, fingerprint:string}>}
 */
export async function deriveMeeting(code, password = '') {
  const raw = code.replace(/-/g, '');
  const secret = base32decode(raw);
  if (secret.length < CODE_BYTES) throw new Error('bad code');
  const topic = toHex(await hkdf(secret, 'handshake/v1', 'relay-topic', 16));
  let ikm = secret;
  if (password) {
    const pw = await stretchPassword(password, topic);
    ikm = new Uint8Array(secret.length + pw.length);
    ikm.set(secret);
    ikm.set(pw, secret.length);
  }
  const sigRaw = await hkdf(ikm, 'handshake/v1', 'signalling-key');
  const frameKey = await hkdf(ikm, 'handshake/v1', 'frame-key');
  const sigKey = await crypto.subtle.importKey('raw', sigRaw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  sigRaw.fill(0);
  return { code, topic, hasPassword: !!password, sigKey, frameKey };
}

/** Per-direction key for media frames, so each sender->receiver path has its own key. */
export async function deriveFrameKey(frameKey, fromId, toId) {
  return hkdf(frameKey, 'handshake/v1/frame', fromId + '>' + toId);
}

const AAD_PREFIX = 'handshake/v1/signal/';

/** Seals a JSON-able object for the meeting. Output is base64url text. */
export async function seal(meeting, obj) {
  const iv = randomBytes(12);
  const pt = te.encode(JSON.stringify(obj));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(AAD_PREFIX + meeting.topic) }, meeting.sigKey, pt),
  );
  const out = new Uint8Array(1 + iv.length + ct.length);
  out[0] = 1;
  out.set(iv, 1);
  out.set(ct, 13);
  return b64encode(out);
}

/** Opens a sealed message. Throws if it was not sealed with this meeting's key. */
export async function open(meeting, text) {
  const data = b64decode(text);
  if (data[0] !== 1 || data.length < 13 + 16) throw new Error('bad envelope');
  const iv = data.subarray(1, 13);
  const ct = data.subarray(13);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: te.encode(AAD_PREFIX + meeting.topic) },
    meeting.sigKey,
    ct,
  );
  return JSON.parse(td.decode(pt));
}

export async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

/**
 * Safety number for one connection: a hash of both sides' DTLS certificate
 * fingerprints. Both people see the same digits only if nobody sits in the
 * middle of the connection.
 */
export async function safetyNumber(fpA, fpB) {
  const [x, y] = [fpA.toUpperCase(), fpB.toUpperCase()].sort();
  const digest = await sha256(te.encode('handshake/v1/safety|' + x + '|' + y));
  // 8 groups of 5 digits, each from 4 bytes of the hash (~133 bits total).
  const groups = [];
  const view = new DataView(digest.buffer);
  for (let i = 0; i < 8; i++) {
    const n = view.getUint32(i * 4) % 100000;
    groups.push(String(n).padStart(5, '0'));
  }
  return { digits: groups, bytes: digest };
}

export function extractFingerprint(sdp) {
  const m = /a=fingerprint:(\S+)\s+([0-9A-Fa-f:]+)/.exec(sdp || '');
  return m ? m[1].toLowerCase() + ' ' + m[2].toUpperCase() : null;
}

export function randomId() {
  return toHex(randomBytes(8));
}
