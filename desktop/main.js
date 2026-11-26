// Handshake for desktop.
//
// A small, locked-down Electron shell around the same web app. The app is
// loaded from inside the package (never from the internet), renderer
// processes are sandboxed with no Node access, only camera, microphone and
// screen capture permissions are ever granted, and navigation away from the
// app is blocked. There is no telemetry, crash reporting or auto-update.

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const {
  app,
  BrowserWindow,
  Menu,
  desktopCapturer,
  ipcMain,
  protocol,
  session,
  shell,
  powerSaveBlocker,
} = require('electron');

const SCHEME = 'app';
const HOST = 'handshake';
const ORIGIN = `${SCHEME}://${HOST}`;
const WEB_ROOT = path.join(__dirname, 'app');
const ALLOWED_PERMISSIONS = new Set(['media', 'display-capture', 'clipboard-sanitized-write', 'fullscreen', 'speaker-selection']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; font-src 'self'; connect-src 'self' wss: ws://localhost:* ws://127.0.0.1:*; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'";

app.enableSandbox();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

let win = null;
let pendingLink = null;
let pickResolver = null;
let blockerId = null;

function linkFromArgs(argv) {
  return argv.find((a) => typeof a === 'string' && a.toLowerCase().startsWith('handshake://')) || null;
}

function sendLink(link) {
  if (!link) return;
  if (win && !win.webContents.isLoading()) win.webContents.send('open-link', link);
  else pendingLink = link;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    sendLink(linkFromArgs(argv));
  });
}

app.on('open-url', (e, url) => {
  e.preventDefault();
  sendLink(url);
});

if (process.defaultApp) {
  if (process.argv.length >= 2) app.setAsDefaultProtocolClient('handshake', process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient('handshake');
}

function isAppUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === SCHEME + ':' && u.host === HOST;
  } catch {
    return false;
  }
}

function serve(request) {
  let rel;
  try {
    const u = new URL(request.url);
    if (u.host !== HOST) return new Response('Not found', { status: 404 });
    rel = decodeURIComponent(u.pathname);
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(WEB_ROOT, rel));
  if (!file.startsWith(WEB_ROOT + path.sep)) return new Response('Forbidden', { status: 403 });
  try {
    const data = fs.readFileSync(file);
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Content-Security-Policy': CSP,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cross-Origin-Opener-Policy': 'same-origin',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

function lockDownSession(ses) {
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && isAppUrl(details.requestingUrl || wc.getURL()));
  });
  ses.setPermissionCheckHandler((_wc, permission, origin) => ALLOWED_PERMISSIONS.has(permission) && isAppUrl(origin));
  ses.setDevicePermissionHandler(() => false); // no USB/HID/serial access
  ses.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 320, height: 200 },
          fetchWindowIcons: false,
        });
        const choice = await pickSource(sources);
        const source = choice && sources.find((s) => s.id === choice.id);
        if (!source) return callback({});
        const audio = choice.audio && process.platform === 'win32' ? 'loopback' : undefined;
        callback(audio ? { video: source, audio } : { video: source });
      } catch {
        callback({});
      }
    },
    { useSystemPicker: true },
  );
  // Strip any referrer or tracking headers on outgoing requests (relays).
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    const headers = { ...details.requestHeaders };
    delete headers.Referer;
    cb({ requestHeaders: headers });
  });
}

function pickSource(sources) {
  return new Promise((resolve) => {
    if (!win) return resolve(null);
    if (pickResolver) pickResolver(null);
    pickResolver = resolve;
    win.webContents.send(
      'pick-source',
      sources.map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() })),
    );
  });
}

ipcMain.on('source-picked', (e, id, audio) => {
  if (!win || e.sender !== win.webContents) return;
  const r = pickResolver;
  pickResolver = null;
  if (r) r(typeof id === 'string' ? { id, audio: !!audio } : null);
});

ipcMain.on('app-version', (e) => {
  e.returnValue = app.getVersion();
});

ipcMain.on('open-external', (e, url) => {
  if (!win || e.sender !== win.webContents) return;
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') shell.openExternal(u.toString());
  } catch {}
});

ipcMain.on('call-active', (e, on) => {
  if (!win || e.sender !== win.webContents) return;
  // Keep the screen awake during a call.
  if (on && blockerId === null) blockerId = powerSaveBlocker.start('prevent-display-sleep');
  if (!on && blockerId !== null) {
    powerSaveBlocker.stop(blockerId);
    blockerId = null;
  }
});

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 380,
    minHeight: 560,
    title: 'Handshake',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false, // the spellchecker would download dictionaries
      devTools: !app.isPackaged,
      backgroundThrottling: false, // keep calls running when the window is hidden
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (new URL(url).protocol === 'https:') shell.openExternal(url);
    } catch {}
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault();
  });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  win.webContents.on('did-finish-load', () => {
    if (pendingLink) {
      win.webContents.send('open-link', pendingLink);
      pendingLink = null;
    }
  });
  win.on('closed', () => {
    win = null;
  });
  win.loadURL(ORIGIN + '/index.html');
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('app.handshake.desktop');
  protocol.handle(SCHEME, serve);
  lockDownSession(session.defaultSession);
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]),
    );
  } else {
    Menu.setApplicationMenu(null);
  }
  pendingLink = linkFromArgs(process.argv);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

app.on('window-all-closed', () => {
  app.quit();
});
