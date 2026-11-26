#!/usr/bin/env node
// Handshake relay: a tiny, forward-only Nostr relay for ephemeral events.
//
// It keeps nothing: no database, no logs of addresses or messages. An event
// is checked, handed to whoever is subscribed right now, and forgotten.
// Handshake clients only ever send sealed, end-to-end encrypted envelopes, so
// the relay could not read them anyway.
//
// It can also serve the Handshake web app from a folder, so one process gives
// you a complete self-hosted setup:
//
//   node relay.js --port 8080 --web ../web/dist
//
// Put it behind HTTPS (for example Caddy or nginx) and use wss://your-host in
// the app's Network settings.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : process.env[name.toUpperCase()] || fallback;
};

const PORT = Number(arg('port', 8080));
const HOST = arg('host', '0.0.0.0');
const WEB_DIR = arg('web', '');
const MAX_EVENT = 128 * 1024;
const MAX_SUBS = 16;
const MAX_CONN_PER_IP = Number(arg('max-per-ip', 64));
const RATE_EVENTS = 60; // per 10 seconds per connection
const te = new TextEncoder();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; font-src 'self'; connect-src 'self' wss: ws:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(self), microphone=(self), display-capture=(self), geolocation=(), interest-cohort=()',
};

const INFO = {
  name: 'Handshake relay',
  description: 'Forward-only relay for ephemeral events. Stores nothing.',
  supported_nips: [1, 11],
  software: 'https://github.com/CS-Fasih/E2EE-meeting',
  version: '1.2.0',
  limitation: { max_message_length: MAX_EVENT, max_subscriptions: MAX_SUBS, payment_required: false, auth_required: false },
};

function serveStatic(req, res) {
  if (!WEB_DIR) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    res.end('Handshake relay is running. Use this address with wss:// in the app.\n');
    return;
  }
  const root = path.resolve(WEB_DIR);
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(root, '.' + rel);
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.stat(file, (err, st) => {
    const target = !err && st.isFile() ? file : path.join(root, 'index.html');
    fs.readFile(target, (e2, data) => {
      if (e2) {
        res.writeHead(404).end();
        return;
      }
      const ext = path.extname(target);
      const cache = target.includes(path.sep + 'assets' + path.sep) ? 'public, max-age=31536000, immutable' : 'no-cache';
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache, ...SECURITY_HEADERS });
      res.end(data);
    });
  });
}

const server = http.createServer((req, res) => {
  if ((req.headers.accept || '').includes('application/nostr+json')) {
    res.writeHead(200, { 'Content-Type': 'application/nostr+json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(INFO));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  serveStatic(req, res);
});

const wss = new WebSocketServer({ server, maxPayload: MAX_EVENT + 1024 });
const clients = new Set();
const perIp = new Map();

function serialise(ev) {
  return JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]);
}

function validEvent(ev) {
  if (!ev || typeof ev !== 'object') return 'invalid: not an object';
  if (typeof ev.id !== 'string' || !/^[0-9a-f]{64}$/.test(ev.id)) return 'invalid: id';
  if (typeof ev.pubkey !== 'string' || !/^[0-9a-f]{64}$/.test(ev.pubkey)) return 'invalid: pubkey';
  if (typeof ev.sig !== 'string' || !/^[0-9a-f]{128}$/.test(ev.sig)) return 'invalid: sig';
  if (!Number.isInteger(ev.kind) || ev.kind < 20000 || ev.kind >= 30000) return 'blocked: only ephemeral events are relayed';
  if (!Number.isInteger(ev.created_at) || Math.abs(ev.created_at - Date.now() / 1000) > 600) return 'invalid: created_at';
  if (!Array.isArray(ev.tags) || ev.tags.length > 20 || !ev.tags.every((t) => Array.isArray(t) && t.every((x) => typeof x === 'string'))) {
    return 'invalid: tags';
  }
  if (typeof ev.content !== 'string') return 'invalid: content';
  const id = bytesToHex(sha256(te.encode(serialise(ev))));
  if (id !== ev.id) return 'invalid: id does not match';
  try {
    if (!schnorr.verify(hexToBytes(ev.sig), hexToBytes(ev.id), hexToBytes(ev.pubkey))) return 'invalid: bad signature';
  } catch {
    return 'invalid: bad signature';
  }
  return null;
}

function matches(filter, ev) {
  if (filter.ids && !filter.ids.includes(ev.id)) return false;
  if (filter.kinds && !filter.kinds.includes(ev.kind)) return false;
  if (filter.authors && !filter.authors.includes(ev.pubkey)) return false;
  if (filter.since && ev.created_at < filter.since) return false;
  if (filter.until && ev.created_at > filter.until) return false;
  for (const key of Object.keys(filter)) {
    if (key[0] !== '#' || key.length !== 2) continue;
    const wanted = filter[key];
    if (!Array.isArray(wanted)) return false;
    if (!ev.tags.some((t) => t[0] === key[1] && wanted.includes(t[1]))) return false;
  }
  return true;
}

wss.on('connection', (ws, req) => {
  // The address is used only to limit connections and is never written down.
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
  const count = (perIp.get(ip) || 0) + 1;
  if (count > MAX_CONN_PER_IP) {
    ws.close(1008, 'too many connections');
    return;
  }
  perIp.set(ip, count);
  const client = { ws, subs: new Map(), window: Date.now(), events: 0, alive: true };
  clients.add(client);

  const send = (msg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  ws.on('pong', () => (client.alive = true));
  ws.on('message', (raw, isBinary) => {
    if (isBinary || raw.length > MAX_EVENT + 1024) return;
    let msg;
    try {
      msg = JSON.parse(raw.toString('utf8'));
    } catch {
      send(['NOTICE', 'invalid: not JSON']);
      return;
    }
    if (!Array.isArray(msg)) return;
    const [type] = msg;
    if (type === 'REQ') {
      const subId = msg[1];
      if (typeof subId !== 'string' || subId.length > 64) return send(['NOTICE', 'invalid: subscription id']);
      if (!client.subs.has(subId) && client.subs.size >= MAX_SUBS) return send(['CLOSED', subId, 'blocked: too many subscriptions']);
      const filters = msg.slice(2).filter((f) => f && typeof f === 'object').slice(0, 10);
      client.subs.set(subId, filters);
      send(['EOSE', subId]); // nothing is stored, so there is never history to send
    } else if (type === 'CLOSE') {
      client.subs.delete(msg[1]);
    } else if (type === 'EVENT') {
      const ev = msg[1];
      const now = Date.now();
      if (now - client.window > 10000) {
        client.window = now;
        client.events = 0;
      }
      if (++client.events > RATE_EVENTS) return send(['OK', ev && ev.id, false, 'rate-limited: slow down']);
      const problem = validEvent(ev);
      if (problem) return send(['OK', ev && ev.id, false, problem]);
      send(['OK', ev.id, true, '']);
      const frame = JSON.stringify(['EVENT', null, ev]);
      for (const other of clients) {
        for (const [subId, filters] of other.subs) {
          if (filters.some((f) => matches(f, ev))) {
            if (other.ws.readyState === other.ws.OPEN) other.ws.send(frame.replace('["EVENT",null,', '["EVENT",' + JSON.stringify(subId) + ','));
          }
        }
      }
    }
  });
  ws.on('close', () => {
    clients.delete(client);
    const n = (perIp.get(ip) || 1) - 1;
    if (n <= 0) perIp.delete(ip);
    else perIp.set(ip, n);
  });
  ws.on('error', () => {});
});

const heartbeat = setInterval(() => {
  for (const c of clients) {
    if (!c.alive) {
      c.ws.terminate();
      continue;
    }
    c.alive = false;
    try {
      c.ws.ping();
    } catch {}
  }
}, 30000);

server.listen(PORT, HOST, () => {
  console.log(`Handshake relay listening on ${HOST}:${PORT}${WEB_DIR ? `, serving ${path.resolve(WEB_DIR)}` : ''}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    clearInterval(heartbeat);
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
