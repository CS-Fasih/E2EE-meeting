// Preferences, kept only on this device.

import { DEFAULT_RELAYS } from './relay.js';

const KEY = 'baithak.settings.v1';

export const DEFAULT_STUN = ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'];

export const DEFAULTS = {
  name: '',
  rememberName: true,
  micId: '',
  camId: '',
  speakerId: '',
  joinWithMic: true,
  joinWithCam: true,
  videoQuality: 'standard',
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  mirrorSelf: true,
  relays: DEFAULT_RELAYS,
  stun: DEFAULT_STUN,
  turnUrl: '',
  turnUser: '',
  turnPass: '',
  relayOnly: false,
  lobby: true,
  frameEncryption: true,
  secureScreen: true,
  inviteBase: '',
};

function safeStorage() {
  try {
    const k = '__baithak';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    return null;
  }
}

export function loadSettings() {
  const store = safeStorage();
  let saved = {};
  if (store) {
    try {
      saved = JSON.parse(store.getItem(KEY) || '{}') || {};
    } catch {
      saved = {};
    }
  }
  const s = { ...DEFAULTS, ...saved };
  if (!Array.isArray(s.relays) || !s.relays.length) s.relays = DEFAULT_RELAYS;
  if (!Array.isArray(s.stun)) s.stun = DEFAULT_STUN;
  return s;
}

export function saveSettings(s) {
  const store = safeStorage();
  if (!store) return;
  const copy = { ...s };
  if (!copy.rememberName) copy.name = '';
  delete copy.iceServers;
  try {
    store.setItem(KEY, JSON.stringify(copy));
  } catch {}
}

export function iceServers(s) {
  const list = [];
  const stun = (s.stun || []).filter((u) => /^stuns?:/.test(u));
  if (stun.length && !s.relayOnly) list.push({ urls: stun });
  if (s.turnUrl) {
    const urls = s.turnUrl
      .split(/[\s,]+/)
      .map((u) => u.trim())
      .filter((u) => /^turns?:/.test(u));
    if (urls.length) list.push({ urls, username: s.turnUser || undefined, credential: s.turnPass || undefined });
  }
  return list;
}

export function validRelay(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'wss:' || (u.protocol === 'ws:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname));
  } catch {
    return false;
  }
}
