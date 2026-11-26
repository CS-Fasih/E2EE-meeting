// Home: check your camera and microphone, then start or join a meeting.

import { h, clear, initials } from './dom.js';
import { icon } from './icons.js';
import { jaaliTile } from './jaali.js';
import { parseMeetingCode } from '../lib/crypto.js';
import { platform } from '../lib/platform.js';
import { wordmark } from './brand.js';

export function renderHome(root, app) {
  const s = app.settings;
  clear(root);
  root.className = 'view view-home';

  const video = h('video', { class: 'preview-video' + (s.mirrorSelf ? ' mirrored' : ''), autoplay: true, muted: true, playsinline: true });
  video.muted = true;
  const avatar = h('div', { class: 'preview-avatar' }, h('span', {}, initials(s.name || '?')));
  const meterFill = h('span', { class: 'meter-fill' });
  const camNote = h('p', { class: 'preview-note' });

  const micBtn = h('button', { class: 'toggle', type: 'button' });
  const camBtn = h('button', { class: 'toggle', type: 'button' });
  const deviceBtn = h('button', { class: 'toggle toggle-plain', type: 'button', onclick: () => app.openSettings('devices') }, icon('gear'), h('span', {}, 'Devices'));

  function paintToggles() {
    const mic = !!app.media.get('audio');
    const cam = !!app.media.get('cam');
    clear(micBtn).append(icon(mic ? 'mic' : 'micOff'), h('span', {}, mic ? 'Mic on' : 'Mic off'));
    clear(camBtn).append(icon(cam ? 'cam' : 'camOff'), h('span', {}, cam ? 'Camera on' : 'Camera off'));
    micBtn.classList.toggle('off', !mic);
    camBtn.classList.toggle('off', !cam);
    micBtn.setAttribute('aria-pressed', String(mic));
    camBtn.setAttribute('aria-pressed', String(cam));
    const track = app.media.get('cam');
    if (track) {
      video.srcObject = new MediaStream([track]);
      video.hidden = false;
      avatar.hidden = true;
    } else {
      video.srcObject = null;
      video.hidden = true;
      avatar.hidden = false;
    }
    camNote.textContent = app.media.lastError || '';
    camNote.hidden = !app.media.lastError;
  }

  micBtn.addEventListener('click', async () => {
    if (app.media.get('audio')) app.media.stopMic();
    else await app.media.startMic().catch(() => {});
    s.joinWithMic = !!app.media.get('audio');
    app.save();
    paintToggles();
  });
  camBtn.addEventListener('click', async () => {
    if (app.media.get('cam')) app.media.stopCam();
    else await app.media.startCam().catch(() => {});
    s.joinWithCam = !!app.media.get('cam');
    app.save();
    paintToggles();
  });

  const onMedia = () => paintToggles();
  app.media.addEventListener('change', onMedia);

  // Mic level, so people can see the microphone works before joining.
  let raf = 0;
  const meterLoop = () => {
    const track = app.media.get('audio');
    if (track) {
      if (app.meter.watchedTrack !== track) {
        app.meter.watch('home', track);
        app.meter.watchedTrack = track;
      }
      const v = Math.min(1, app.meter.level('home') * 6);
      meterFill.style.transform = `scaleX(${v.toFixed(3)})`;
    } else {
      meterFill.style.transform = 'scaleX(0)';
    }
    raf = requestAnimationFrame(meterLoop);
  };
  raf = requestAnimationFrame(meterLoop);

  // ---- form ----
  const nameInput = h('input', {
    id: 'name',
    class: 'field',
    type: 'text',
    maxlength: 40,
    autocomplete: 'nickname',
    placeholder: 'What should people call you?',
    value: s.name || '',
  });
  nameInput.addEventListener('input', () => {
    s.name = nameInput.value.trim();
    app.save();
    avatar.firstChild.textContent = initials(s.name || '?');
  });

  const codeInput = h('input', {
    id: 'code',
    class: 'field field-code',
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: false,
    placeholder: 'xxxx-xxxx-xxxx-xxxx-xxxx-xxxx',
    'aria-label': 'Meeting code or link',
  });
  const joinBtn = h('button', { class: 'btn btn-secondary', type: 'submit', disabled: true }, 'Join');
  codeInput.addEventListener('input', () => {
    joinBtn.disabled = !parseMeetingCode(codeInput.value);
    joinError.hidden = true;
  });

  const joinPw = h('input', { class: 'field', type: 'password', autocomplete: 'off', placeholder: 'Meeting password' });
  const joinPwRow = h('label', { class: 'pw-row', hidden: true }, h('span', { class: 'label' }, 'Password'), joinPw);
  const pwToggle = h(
    'button',
    {
      class: 'link-btn',
      type: 'button',
      onclick: () => {
        joinPwRow.hidden = !joinPwRow.hidden;
        pwToggle.textContent = joinPwRow.hidden ? 'This meeting has a password' : 'No password';
        if (!joinPwRow.hidden) joinPw.focus();
        else joinPw.value = '';
      },
    },
    'This meeting has a password',
  );
  const joinError = h('p', { class: 'form-error', hidden: true, role: 'alert' });

  const startPw = h('input', { class: 'field', type: 'password', autocomplete: 'new-password', placeholder: 'Optional' });
  const lobbyBox = h('input', { type: 'checkbox', checked: s.lobby !== false });
  lobbyBox.addEventListener('change', () => {
    s.lobby = lobbyBox.checked;
    app.save();
  });

  function needName() {
    if (nameInput.value.trim()) return false;
    nameInput.focus();
    nameInput.classList.add('shake');
    setTimeout(() => nameInput.classList.remove('shake'), 400);
    return true;
  }

  const startBtn = h(
    'button',
    {
      class: 'btn btn-primary btn-big',
      type: 'button',
      onclick: () => {
        if (needName()) return;
        app.startMeeting({ name: nameInput.value.trim(), password: startPw.value, lobby: lobbyBox.checked });
      },
    },
    'Start a meeting',
  );

  const joinForm = h(
    'form',
    {
      class: 'join-form',
      onsubmit: (e) => {
        e.preventDefault();
        const code = parseMeetingCode(codeInput.value);
        if (!code) {
          joinError.textContent = 'That code is not complete. It has 24 letters and numbers.';
          joinError.hidden = false;
          return;
        }
        if (needName()) return;
        app.joinMeeting({ code, name: nameInput.value.trim(), password: joinPw.value });
      },
    },
    h('label', { class: 'label', for: 'code' }, 'Have a code? Paste it or the invite link'),
    h('div', { class: 'join-row' }, codeInput, joinBtn),
    joinError,
    h('div', { class: 'join-extra' }, pwToggle),
    joinPwRow,
  );

  const options = h(
    'details',
    { class: 'options' },
    h('summary', {}, 'Meeting options'),
    h(
      'div',
      { class: 'options-body' },
      h('label', { class: 'check' }, lobbyBox, h('span', {}, 'Ask me before letting people in')),
      h(
        'label',
        { class: 'pw-row' },
        h('span', { class: 'label' }, 'Password'),
        startPw,
        h('span', { class: 'hint' }, 'People will need the code and this password to get in.'),
      ),
    ),
  );

  const status = h('div', { class: 'join-status', hidden: true, role: 'status' });

  const form = h(
    'section',
    { class: 'home-form', 'aria-label': 'Start or join' },
    h('h1', { class: 'headline' }, 'Talk privately, face to face.'),
    h(
      'p',
      { class: 'lede' },
      'Video meetings that go straight from your device to the people you invite. Nothing in between can watch, listen, or keep a copy.',
    ),
    h('div', { class: 'field-group' }, h('label', { class: 'label', for: 'name' }, 'Your name'), nameInput),
    h('div', { class: 'start-row' }, startBtn),
    options,
    h('div', { class: 'or' }, h('span', {}, 'or')),
    joinForm,
    status,
  );

  const preview = h(
    'section',
    { class: 'home-preview', 'aria-label': 'Camera preview', style: { '--jaali': jaaliTile('#283063') } },
    h(
      'div',
      { class: 'arch-frame' },
      h('div', { class: 'arch' }, video, avatar),
      h('span', { class: 'arch-line', 'aria-hidden': 'true', html: ARCH_LINE }),
    ),
    h('div', { class: 'meter', 'aria-hidden': 'true', title: 'Microphone level' }, meterFill),
    h('div', { class: 'preview-controls' }, micBtn, camBtn, deviceBtn),
    camNote,
  );

  const facts = h(
    'section',
    { class: 'facts', 'aria-label': 'How Baithak keeps calls private' },
    fact('lock', 'Locked before it leaves', 'Voice, video, chat and files are encrypted on your device and can only be opened by the people in the call.'),
    fact('door', 'No accounts, no history', 'Nothing to sign up for and nothing stored. When the meeting ends, the chat and shared files are gone.'),
    fact('shield', 'Check who is listening', 'Each connection has a safety number. Read it out loud with the other person to be sure no one sits in between.'),
  );

  const header = h(
    'header',
    { class: 'topbar' },
    wordmark(),
    h(
      'div',
      { class: 'topbar-actions' },
      h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => app.openAbout() }, 'How it works'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Settings', title: 'Settings', onclick: () => app.openSettings() }, icon('gear')),
    ),
  );

  root.append(header, h('main', { class: 'home-main' }, preview, form), facts);

  paintToggles();

  return {
    setCode(code) {
      codeInput.value = code;
      joinBtn.disabled = !parseMeetingCode(code);
      if (!nameInput.value.trim()) nameInput.focus();
      else joinBtn.focus();
    },
    showPassword(message) {
      joinPwRow.hidden = false;
      pwToggle.textContent = 'No password';
      joinError.textContent = message;
      joinError.hidden = false;
      joinPw.focus();
    },
    setStatus(text, onCancel) {
      if (!text) {
        status.hidden = true;
        form.classList.remove('busy');
        return;
      }
      clear(status).append(
        h('div', { class: 'pulse-arch', 'aria-hidden': 'true' }),
        h('p', {}, text),
        onCancel ? h('button', { class: 'btn btn-quiet', type: 'button', onclick: onCancel }, 'Cancel') : null,
      );
      status.hidden = false;
      form.classList.add('busy');
    },
    destroy() {
      cancelAnimationFrame(raf);
      app.media.removeEventListener('change', onMedia);
      app.meter.unwatch('home');
      app.meter.watchedTrack = null;
      video.srcObject = null;
    },
  };
}

const ARCH_LINE =
  '<svg viewBox="0 0 100 125" preserveAspectRatio="none"><path d="M1 125V52.5C1 21 30 6 50 1c20 5 49 20 49 51.5V125" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>';

function fact(ic, title, text) {
  return h('div', { class: 'fact' }, icon(ic), h('h3', {}, title), h('p', {}, text));
}

export { platform };
