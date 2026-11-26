'use strict';

// The only bridge between the web app and the desktop shell: a handful of
// narrow functions, no Node or Electron objects exposed.

const { contextBridge, ipcRenderer } = require('electron');

let version = '';
try {
  version = ipcRenderer.sendSync('app-version');
} catch {}

contextBridge.exposeInMainWorld('handshakeNative', {
  kind: 'desktop',
  version,
  onPickSource(fn) {
    ipcRenderer.on('pick-source', (_e, sources) => fn(sources));
  },
  pickSource(id, audio) {
    ipcRenderer.send('source-picked', typeof id === 'string' ? id : null, !!audio);
  },
  onOpenLink(fn) {
    ipcRenderer.on('open-link', (_e, link) => fn(String(link)));
  },
  openExternal(url) {
    ipcRenderer.send('open-external', String(url));
  },
  setCallActive(on) {
    ipcRenderer.send('call-active', !!on);
  },
});
