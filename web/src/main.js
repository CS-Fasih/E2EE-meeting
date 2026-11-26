import './styles.css';
import { h, clear } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { dialog, toast, closeDialog } from './ui/overlay.js';
import { renderHome } from './ui/home.js';
import { renderCall } from './ui/call.js';
import { openSettings } from './ui/settings-view.js';
import { openAbout } from './ui/about.js';
import { LocalMedia, LevelMeter } from './lib/media.js';
import { Meeting } from './lib/meeting.js';
import { loadSettings, saveSettings, iceServers } from './lib/settings.js';
import { newMeetingCode, parseMeetingCode } from './lib/crypto.js';
import { platform } from './lib/platform.js';

const root = document.getElementById('app');
const settings = loadSettings();
const media = new LocalMedia(settings);
const meter = new LevelMeter();

const app = {
  settings,
  media,
  meter,
  meeting: null,
  view: null,
  save: () => saveSettings(settings),
  openSettings: (tab) => openSettings(app, tab),
  openAbout: () => openAbout(),
  startMeeting,
  joinMeeting,
  leaveMeeting,
  applySpeaker() {
    document.querySelectorAll('audio').forEach((el) => el.setSinkId && el.setSinkId(settings.speakerId || '').catch(() => {}));
  },
};

platform.setSecureScreen(settings.secureScreen !== false);

// Opt-in hook for automated tests only (set by the test harness on this device).
try {
  if (localStorage.getItem('baithak.debug') === '1') {
    window.__baithak = app;
    import('./lib/e2ee.js').then((m) => (window.__frameStats = m.lastFrameStats));
  }
} catch {}

function showHome() {
  if (app.view && app.view.destroy) app.view.destroy();
  app.view = renderHome(root, app);
  platform.onBack(() => false);
  // Turn devices on as they were last time, so the preview works right away.
  if (settings.joinWithCam && !media.get('cam')) media.startCam().catch(() => {});
  if (settings.joinWithMic && !media.get('audio')) media.startMic().catch(() => {});
  return app.view;
}

async function begin({ code, name, password, isNew, lobby }) {
  settings.name = name;
  if (typeof lobby === 'boolean') settings.lobby = lobby;
  app.save();
  const m = new Meeting({
    code,
    password,
    name,
    isNew,
    media,
    settings: {
      relays: settings.relays,
      iceServers: iceServers(settings),
      relayOnly: settings.relayOnly && !!settings.turnUrl,
      lobby: settings.lobby,
      frameEncryption: settings.frameEncryption,
    },
  });
  app.meeting = m;
  const home = app.view;
  let entered = false;

  m.addEventListener('phase', (e) => {
    const phase = e.detail.phase;
    if (app.meeting !== m) return;
    if (phase === 'searching') home.setStatus && home.setStatus('Looking for the meeting', () => leaveMeeting());
    else if (phase === 'waiting') home.setStatus && home.setStatus('Asking to join. Someone in the meeting will let you in.', () => leaveMeeting());
    else if (phase === 'in-call') {
      entered = true;
      enterCall(m);
    } else if (phase === 'left' && !entered) {
      // Cancelled before getting in: just go back to the form.
      app.meeting = null;
      if (home.setStatus) home.setStatus(null);
    } else endScreen(m, phase);
  });
  m.addEventListener('password-problem', (e) => {
    if (app.meeting !== m || m.connected.length) return;
    const msg = e.detail.hasPassword
      ? 'That password does not match this meeting. Check it and try again.'
      : 'This meeting has a password. Enter it to join.';
    leaveMeeting(false, true);
    const v = showHome();
    v.setCode(code);
    v.showPassword(msg);
  });

  try {
    await m.join();
  } catch (err) {
    console.error(err);
    toast('Could not start the meeting.', { kind: 'warn' });
    app.meeting = null;
  }
}

function startMeeting({ name, password, lobby }) {
  begin({ code: newMeetingCode(), name, password, isNew: true, lobby });
}

function joinMeeting({ code, name, password }) {
  begin({ code, name, password, isNew: false });
}

function enterCall(m) {
  if (app.view && app.view.destroy) app.view.destroy();
  closeDialog();
  app.view = renderCall(root, app, m);
  platform.setCallActive(true);
  if (m.isNew) {
    dialog({
      title: 'Your meeting is ready',
      body: h(
        'div',
        { class: 'ready' },
        h('p', {}, 'Share this code with the people you want to meet. Anyone who has it can ask to join, so send it privately.'),
        h('div', { class: 'code-box big' }, m.code),
        m.password ? h('p', { class: 'muted' }, 'Send the password separately, for example by phone.') : null,
      ),
      actions: [
        { label: 'Close' },
        {
          label: 'Copy invite',
          kind: 'primary',
          onClick: async () => {
            const lines = [
              'Join my Baithak meeting.',
              '',
              'Meeting code: ' + m.code,
              m.password ? 'It has a password. I will send it to you separately.' : null,
              settings.inviteBase ? 'Join in your browser: ' + settings.inviteBase + '#' + m.code : null,
              'Open in the app: baithak://join/' + m.code,
              '',
              'Get Baithak (free, no account): https://github.com/CS-Fasih/E2EE-meeting',
            ].filter((x) => x !== null);
            const ok = await platform.copy(lines.join('\n'));
            toast(ok ? 'Invite copied.' : 'Could not copy. Select the code and copy it yourself.');
          },
        },
      ],
    });
  }
}

const END_TEXT = {
  left: ['You left the meeting', null],
  ended: ['The host ended the meeting', null],
  removed: ['You were removed from the meeting', 'The host removed you. You can only come back if they let you in again.'],
  denied: ['You were not let in', 'Someone in the meeting declined your request to join.'],
  locked: ['This meeting is locked', 'The host has locked the meeting, so no one else can join right now.'],
  full: ['This meeting is full', 'Meetings have room for 8 people, because everyone connects to everyone directly.'],
};

function endScreen(m, phase) {
  platform.setCallActive(false);
  if (app.meeting === m) app.meeting = null;
  const [title, text] = END_TEXT[phase] || END_TEXT.left;
  if (app.view && app.view.destroy) app.view.destroy();
  app.view = null;
  clear(root);
  root.className = 'view view-end';
  const canRejoin = phase === 'left' || phase === 'denied' || phase === 'locked' || phase === 'full';
  root.append(
    h(
      'div',
      { class: 'end-card' },
      h('div', { class: 'end-arch', 'aria-hidden': 'true' }, icon('door', 'ico big')),
      h('h1', {}, title),
      text ? h('p', {}, text) : null,
      h('p', { class: 'muted' }, 'Nothing from this meeting was saved on this device.'),
      h(
        'div',
        { class: 'row' },
        canRejoin
          ? h(
              'button',
              { class: 'btn btn-quiet', type: 'button', onclick: () => {
                showHome();
                joinMeeting({ code: m.code, name: m.name, password: m.password });
              } },
              phase === 'left' ? 'Rejoin' : 'Try again',
            )
          : null,
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => showHome() }, 'Back to home'),
      ),
    ),
  );
}

function leaveMeeting(endForAll = false, silent = false) {
  const m = app.meeting;
  if (!m) return;
  if (silent) app.meeting = null;
  if (endForAll) m.endForAll();
  else m.leave();
}

// Open links like baithak://join/<code> or https://host/#<code>.
function openLink(link) {
  const code = parseMeetingCode(link);
  if (!code) return;
  if (app.meeting) {
    toast('Leave this meeting before joining another one.');
    return;
  }
  const v = app.view && app.view.setCode ? app.view : showHome();
  v.setCode(code);
}

showHome();
platform.onOpenLink(openLink);
if (location.hash.length > 1) {
  const code = parseMeetingCode(location.hash);
  // Remove the code from the address bar and history right away.
  history.replaceState(null, '', location.pathname + location.search);
  if (code) app.view.setCode(code);
}

// Desktop app: choose a screen or window to share.
platform.onPickSource((sources) => {
  let shareAudio = true;
  const grid = h(
    'div',
    { class: 'source-grid' },
    sources.map((src) =>
      h(
        'button',
        {
          class: 'source',
          type: 'button',
          onclick: () => {
            picked = true;
            platform.pickSource(src.id, shareAudio);
            d.close();
          },
        },
        h('img', { src: src.thumbnail, alt: '' }),
        h('span', {}, src.name),
      ),
    ),
  );
  const audioBox = h('input', { type: 'checkbox', checked: true });
  audioBox.addEventListener('change', () => (shareAudio = audioBox.checked));
  let picked = false;
  const d = dialog({
    title: 'Choose what to share',
    wide: true,
    body: h(
      'div',
      {},
      grid,
      navigator.userAgent.includes('Windows') ? h('label', { class: 'check' }, audioBox, h('span', {}, 'Also share computer sound')) : null,
    ),
    actions: [{ label: 'Cancel' }],
    onClose: () => {
      if (!picked) platform.pickSource(null, false);
    },
  });
});

// Outside a meeting, never keep the camera or microphone running in the background.
document.addEventListener('visibilitychange', () => {
  if (app.meeting) return;
  if (document.hidden) {
    if (media.get('cam')) media.stopCam();
    if (media.get('audio')) media.stopMic();
  } else if (app.view && app.view.setCode) {
    if (settings.joinWithCam && !media.get('cam')) media.startCam().catch(() => {});
    if (settings.joinWithMic && !media.get('audio')) media.startMic().catch(() => {});
  }
});

window.addEventListener('beforeunload', () => {
  if (app.meeting) app.meeting.leave();
});
