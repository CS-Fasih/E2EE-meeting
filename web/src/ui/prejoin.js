// "Ready to join?": check camera, microphone and name before entering.

import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { wordmark } from './brand.js';
import { avatar, paintAvatar } from './avatar.js';
import { listDevices } from '../lib/media.js';
import { newMeetingCode } from '../lib/crypto.js';
import { platform } from '../lib/platform.js';
import { toast } from './overlay.js';

export function renderPrejoin(root, app, { mode, code }) {
  const s = app.settings;
  const isNew = mode === 'new';
  const meetingCode = code || newMeetingCode();
  clear(root);
  root.className = 'view view-prejoin';

  // ---- preview ----
  const video = h('video', { class: 'pj-video' + (s.mirrorSelf ? ' mirrored' : ''), autoplay: true, muted: true, playsinline: true });
  video.muted = true;
  const circle = avatar(s.name || '?', 'avatar avatar-xl');
  const camOffText = h('p', { class: 'pj-off-text' }, 'Camera is off');
  const placeholder = h('div', { class: 'pj-placeholder' }, circle, camOffText);
  const nameTag = h('span', { class: 'pj-name' }, s.name || '');
  const levelBars = h('span', { class: 'pj-level', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
  const micBtn = h('button', { class: 'round-btn', type: 'button' });
  const camBtn = h('button', { class: 'round-btn', type: 'button' });
  const note = h('p', { class: 'pj-error', hidden: true, role: 'alert' });

  const preview = h(
    'div',
    { class: 'pj-preview' },
    video,
    placeholder,
    nameTag,
    levelBars,
    h('div', { class: 'pj-controls' }, micBtn, camBtn),
  );

  function paint() {
    const mic = !!app.media.get('audio');
    const cam = !!app.media.get('cam');
    clear(micBtn).append(icon(mic ? 'mic' : 'micOff'));
    clear(camBtn).append(icon(cam ? 'cam' : 'camOff'));
    micBtn.classList.toggle('off', !mic);
    camBtn.classList.toggle('off', !cam);
    micBtn.setAttribute('aria-label', mic ? 'Turn off microphone' : 'Turn on microphone');
    camBtn.setAttribute('aria-label', cam ? 'Turn off camera' : 'Turn on camera');
    micBtn.title = micBtn.getAttribute('aria-label');
    camBtn.title = camBtn.getAttribute('aria-label');
    const track = app.media.get('cam');
    if (track) {
      if (!video.srcObject || video.srcObject.getVideoTracks()[0] !== track) video.srcObject = new MediaStream([track]);
      video.hidden = false;
      placeholder.hidden = true;
    } else {
      video.srcObject = null;
      video.hidden = true;
      placeholder.hidden = false;
    }
    levelBars.hidden = !mic;
    note.textContent = app.media.lastError || '';
    note.hidden = !app.media.lastError;
  }

  micBtn.addEventListener('click', async () => {
    if (app.media.get('audio')) app.media.stopMic();
    else await app.media.startMic().catch(() => {});
    s.joinWithMic = !!app.media.get('audio');
    app.save();
    paint();
  });
  camBtn.addEventListener('click', async () => {
    if (app.media.get('cam')) app.media.stopCam();
    else await app.media.startCam().catch(() => {});
    s.joinWithCam = !!app.media.get('cam');
    app.save();
    paint();
  });
  const onMedia = () => {
    paint();
    fillDevices();
  };
  app.media.addEventListener('change', onMedia);

  // Live microphone level as three small bars, like a speaking indicator.
  let raf = 0;
  const bars = [...levelBars.children];
  const loop = () => {
    const track = app.media.get('audio');
    if (track) {
      if (app.meter.watchedTrack !== track) {
        app.meter.watch('prejoin', track);
        app.meter.watchedTrack = track;
      }
      const v = Math.min(1, app.meter.level('prejoin') * 7);
      bars.forEach((b, i) => (b.style.transform = `scaleY(${(0.25 + v * (i === 1 ? 1 : 0.7)).toFixed(2)})`));
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  // ---- device pickers ----
  const mkSelect = (label, ic) => {
    const sel = h('select', { 'aria-label': label });
    return { sel, el: h('label', { class: 'device-pill', title: label }, icon(ic), sel, icon('chevron', 'ico chev')) };
  };
  const micSel = mkSelect('Microphone', 'mic');
  const spkSel = mkSelect('Speaker', 'speaker');
  const camSel = mkSelect('Camera', 'cam');
  async function fillDevices() {
    const d = await listDevices();
    const fill = (sel, list, key, fallback) => {
      const cur = s[key];
      clear(sel).append(
        h('option', { value: '' }, 'Default ' + fallback),
        ...list.filter((x) => x.deviceId !== 'default').map((x, i) => h('option', { value: x.deviceId, selected: x.deviceId === cur }, x.label || `${fallback} ${i + 1}`)),
      );
    };
    fill(micSel.sel, d.mics, 'micId', 'microphone');
    fill(camSel.sel, d.cams, 'camId', 'camera');
    fill(spkSel.sel, d.speakers, 'speakerId', 'speaker');
  }
  micSel.sel.addEventListener('change', () => {
    s.micId = micSel.sel.value;
    app.save();
    app.media.refresh();
  });
  camSel.sel.addEventListener('change', () => {
    s.camId = camSel.sel.value;
    app.save();
    app.media.refresh();
  });
  spkSel.sel.addEventListener('change', () => {
    s.speakerId = spkSel.sel.value;
    app.save();
  });
  fillDevices();
  const devicesRow = h(
    'div',
    { class: 'device-row' },
    micSel.el,
    platform.canPickSpeaker ? spkSel.el : null,
    camSel.el,
  );

  // ---- right side ----
  const nameInput = h('input', {
    id: 'name',
    class: 'field',
    type: 'text',
    maxlength: 40,
    autocomplete: 'name',
    placeholder: 'Your name',
    value: s.name || '',
  });
  nameInput.addEventListener('input', () => {
    s.name = nameInput.value.trim();
    app.save();
    nameTag.textContent = s.name;
    paintAvatar(circle, s.name || '?');
  });

  const pwInput = h('input', { class: 'field', type: 'password', autocomplete: isNew ? 'new-password' : 'off', placeholder: isNew ? 'Password (optional)' : 'Meeting password' });
  const pwRow = h('div', { class: 'field-group', hidden: !isNew }, h('label', { class: 'label' }, isNew ? 'Meeting password' : 'Password'), pwInput, isNew ? h('span', { class: 'hint' }, 'If set, people need the code and this password to join.') : null);
  const pwLink = h(
    'button',
    {
      class: 'link-btn',
      type: 'button',
      hidden: isNew,
      onclick: () => {
        pwRow.hidden = false;
        pwLink.hidden = true;
        pwInput.focus();
      },
    },
    'This meeting has a password',
  );

  const lobbyBox = h('input', { type: 'checkbox', role: 'switch', checked: s.lobby !== false });
  lobbyBox.addEventListener('change', () => {
    s.lobby = lobbyBox.checked;
    app.save();
  });
  const lobbyRow = isNew
    ? h('label', { class: 'switch-row' }, h('span', {}, h('strong', {}, 'Waiting room'), h('span', { class: 'hint' }, 'You admit each person before they can join.')), lobbyBox)
    : null;

  const error = h('p', { class: 'form-error', hidden: true, role: 'alert' });
  const goBtn = h('button', { class: 'btn btn-primary btn-lg pj-go', type: 'submit' }, isNew ? 'Start meeting' : 'Join now');

  const codeChip = h(
    'button',
    {
      class: 'pj-code',
      type: 'button',
      title: 'Copy meeting code',
      onclick: async () => toast((await platform.copy(meetingCode)) ? 'Meeting code copied' : 'Could not copy the code'),
    },
    icon('link'),
    h('span', { class: 'pj-code-text' }, meetingCode),
    icon('copy'),
  );

  const form = h(
    'form',
    {
      class: 'pj-form',
      onsubmit: (e) => {
        e.preventDefault();
        if (!nameInput.value.trim()) {
          nameInput.focus();
          nameInput.classList.add('invalid');
          error.textContent = 'Enter your name so others know who you are.';
          error.hidden = false;
          return;
        }
        error.hidden = true;
        nameInput.classList.remove('invalid');
        const opts = { code: meetingCode, name: nameInput.value.trim(), password: pwInput.value };
        if (isNew) app.startMeeting({ ...opts, lobby: lobbyBox.checked });
        else app.joinMeeting(opts);
      },
    },
    h('h1', {}, isNew ? 'Ready to start?' : 'Ready to join?'),
    codeChip,
    h('div', { class: 'field-group' }, h('label', { class: 'label', for: 'name' }, 'Your name'), nameInput),
    lobbyRow,
    pwRow,
    pwLink,
    error,
    goBtn,
    h('p', { class: 'pj-secure' }, icon('lock'), h('span', {}, 'End-to-end encrypted. No account needed.')),
  );

  const status = h('div', { class: 'pj-status', hidden: true, role: 'status' });
  const side = h('section', { class: 'pj-side' }, form, status);

  const header = h(
    'header',
    { class: 'topbar' },
    h(
      'div',
      { class: 'topbar-start' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Back', title: 'Back', onclick: () => app.showHome() }, icon('back')),
      wordmark(),
    ),
    h(
      'div',
      { class: 'topbar-actions' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Settings', title: 'Settings', onclick: () => app.openSettings() }, icon('gear')),
    ),
  );

  root.append(
    header,
    h('main', { class: 'pj-main' }, h('section', { class: 'pj-left' }, preview, devicesRow, note), side),
  );

  // Turn devices on as they were last time.
  if (s.joinWithCam && !app.media.get('cam')) app.media.startCam().catch(() => {});
  if (s.joinWithMic && !app.media.get('audio')) app.media.startMic().catch(() => {});
  paint();
  if (!nameInput.value) setTimeout(() => nameInput.focus(), 0);

  return {
    isPrejoin: true,
    code: meetingCode,
    showPassword(message) {
      pwRow.hidden = false;
      pwLink.hidden = true;
      error.textContent = message;
      error.hidden = false;
      pwInput.value = '';
      pwInput.focus();
    },
    setStatus(text, onCancel) {
      if (!text) {
        status.hidden = true;
        form.hidden = false;
        return;
      }
      clear(status).append(
        h('span', { class: 'spinner', 'aria-hidden': 'true' }),
        h('h2', {}, text),
        h('p', { class: 'muted' }, mode === 'new' ? 'Setting up an encrypted meeting.' : 'Your camera and microphone stay as you set them.'),
        onCancel ? h('button', { class: 'btn btn-outlined', type: 'button', onclick: onCancel }, 'Cancel') : null,
      );
      status.hidden = false;
      form.hidden = true;
    },
    destroy() {
      cancelAnimationFrame(raf);
      app.media.removeEventListener('change', onMedia);
      app.meter.unwatch('prejoin');
      app.meter.watchedTrack = null;
      video.srcObject = null;
    },
  };
}
