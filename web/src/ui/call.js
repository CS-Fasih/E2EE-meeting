// The meeting screen: video tiles, the control bar and side panels.

import { h, clear, initials, formatDuration } from './dom.js';
import { icon } from './icons.js';
import { toast, menu, popover, dialog } from './overlay.js';
import { REACTIONS } from '../lib/meeting.js';
import { Recorder } from '../lib/recorder.js';
import { platform } from '../lib/platform.js';
import { peoplePanel } from './panel-people.js';
import { chatPanel } from './panel-chat.js';
import { securityPanel } from './panel-security.js';
import { chime } from './sound.js';
import { avatar, paintAvatar } from './avatar.js';

const SPEAK_THRESHOLD = 0.018;

export function renderCall(root, app, meeting) {
  clear(root);
  root.className = 'view view-call';
  const s = app.settings;
  const media = app.media;
  const meter = app.meter;

  const tiles = new Map(); // key -> tile
  const audioEls = new Map(); // key -> <audio>
  let layout = 'auto'; // auto | grid | spotlight
  let pinned = null;
  let activeSpeaker = null;
  let speakerSince = 0;
  let panelName = null;
  let unread = 0;
  let recorder = null;
  let speakerOn = true;
  const startedAt = Date.now();

  // ---- structure ----
  const stageMain = h('div', { class: 'stage-main' });
  const strip = h('div', { class: 'tiles' });
  const emptyCard = h('div', { class: 'empty-card', hidden: true });
  const stage = h('div', { class: 'stage', 'data-layout': 'grid' }, stageMain, strip, emptyCard);
  const panel = h('aside', { class: 'panel', hidden: true, 'aria-label': 'Side panel' });
  const notices = h('div', { class: 'notices', 'aria-live': 'polite' });
  const audioBox = h('div', { hidden: true });
  const reactionLayer = h('div', { class: 'reaction-layer', 'aria-hidden': 'true' });

  const timeEl = h('span', { class: 'call-time' }, '0:00');
  const secureBtn = h(
    'button',
    { class: 'secure-chip', type: 'button', onclick: () => togglePanel('security'), title: 'Encryption and safety numbers' },
    icon('lock'),
    h('span', { class: 'secure-text' }, 'End-to-end encrypted'),
  );
  const codeBtn = h(
    'button',
    { class: 'code-chip', type: 'button', title: 'Copy invite', onclick: () => copyInvite() },
    h('span', {}, meeting.code),
  );

  const btn = (name, label, onclick, cls = '') =>
    h('button', { class: 'ctl ' + cls, type: 'button', 'aria-label': label, title: label, onclick }, icon(name));

  const micBtn = btn('mic', 'Microphone', () => toggleMic());
  const camBtn = btn('cam', 'Camera', () => toggleCam());
  const screenBtn = platform.canShareScreen ? btn('screen', 'Share screen', () => toggleScreen()) : null;
  const handBtn = btn('hand', 'Raise hand', () => meeting.setHand(!meeting.hand));
  const reactBtn = btn('smile', 'Send a reaction', () => openReactions());
  const moreBtn = btn('more', 'More options', () => openMore());
  const leaveBtn = h(
    'button',
    { class: 'ctl ctl-leave', type: 'button', 'aria-label': 'Leave call', title: 'Leave call', onclick: () => onLeave() },
    icon('leave'),
  );

  const peopleCount = h('span', { class: 'count-badge' }, '1');
  const chatBadge = h('span', { class: 'badge', hidden: true });
  const peopleBtn = h(
    'button',
    { class: 'ctl ctl-side', type: 'button', 'aria-label': 'People', title: 'People', onclick: () => togglePanel('people') },
    icon('people'),
    peopleCount,
  );
  const chatBtn = h(
    'button',
    { class: 'ctl ctl-side', type: 'button', 'aria-label': 'Chat', title: 'Chat', onclick: () => togglePanel('chat') },
    icon('chat'),
    chatBadge,
  );

  const bar = h(
    'footer',
    { class: 'callbar' },
    h('div', { class: 'callbar-left' }, timeEl, h('span', { class: 'bar-sep', 'aria-hidden': 'true' }), codeBtn, secureBtn),
    h('div', { class: 'callbar-center' }, micBtn, camBtn, screenBtn, handBtn, reactBtn, moreBtn, leaveBtn),
    h('div', { class: 'callbar-right' }, peopleBtn, chatBtn),
  );

  root.append(h('div', { class: 'call-body' }, stage, panel), notices, reactionLayer, bar, audioBox);

  // ---- panels ----
  const panels = {
    people: peoplePanel(app, meeting, { onPin: (key) => pin(key), copyInvite, shareInvite }),
    chat: chatPanel(app, meeting),
    security: securityPanel(app, meeting),
  };

  function togglePanel(name) {
    if (panelName === name) return closePanel();
    if (panelName) panels[panelName].hide();
    panelName = name;
    clear(panel).append(
      h(
        'div',
        { class: 'panel-head' },
        h('h2', {}, panels[name].title),
        h('button', { class: 'icon-btn', 'aria-label': 'Close panel', onclick: () => closePanel() }, icon('close')),
      ),
      panels[name].el,
    );
    panel.hidden = false;
    root.classList.add('with-panel');
    panels[name].show();
    if (name === 'chat') {
      unread = 0;
      paintBadges();
    }
    peopleBtn.classList.toggle('active', name === 'people');
    chatBtn.classList.toggle('active', name === 'chat');
    secureBtn.classList.toggle('active', name === 'security');
    requestAnimationFrame(doLayout);
  }

  function closePanel() {
    if (panelName) panels[panelName].hide();
    panelName = null;
    panel.hidden = true;
    root.classList.remove('with-panel');
    peopleBtn.classList.remove('active');
    chatBtn.classList.remove('active');
    secureBtn.classList.remove('active');
    requestAnimationFrame(doLayout);
  }

  // ---- invite ----
  function inviteText() {
    const lines = ['Join my Handshake meeting.', '', 'Meeting code: ' + meeting.code];
    if (meeting.password) lines.push('It has a password. I will send it to you separately.');
    if (s.inviteBase) lines.push('', 'Join in your browser: ' + s.inviteBase.replace(/#.*$/, '') + '#' + meeting.code);
    lines.push('Open in the app: handshake://join/' + meeting.code);
    lines.push('', 'Get Handshake (free, no account): https://github.com/CS-Fasih/E2EE-meeting');
    return lines.join('\n');
  }

  async function copyInvite() {
    const ok = await platform.copy(inviteText());
    toast(ok ? 'Invite copied. Send it to the people you want in this meeting.' : 'Could not copy. Select the code and copy it yourself.');
  }

  async function shareInvite() {
    const ok = await platform.share(inviteText());
    if (!ok) copyInvite();
  }

  // ---- tiles ----
  function tileKeyList() {
    const list = [];
    list.push({ key: 'self:cam', self: true, slot: 'cam' });
    if (media.get('screen')) list.push({ key: 'self:screen', self: true, slot: 'screen' });
    for (const p of meeting.participants.values()) {
      if (p.status !== 'connected' && p.status !== 'connecting') continue;
      list.push({ key: p.id + ':cam', p, slot: 'cam' });
      if (p.state.screen) list.push({ key: p.id + ':screen', p, slot: 'screen' });
    }
    return list;
  }

  function makeTile(spec) {
    const video = h('video', { autoplay: true, playsinline: true, muted: true });
    video.muted = true;
    const circle = avatar('?', 'avatar avatar-tile');
    const avatarBox = h('div', { class: 'tile-avatar' }, circle);
    const name = h('span', { class: 'tile-name' });
    const micIco = h('span', { class: 'tile-mic', hidden: true, title: 'Microphone off' }, icon('micOff'));
    const hand = h('span', { class: 'tile-hand', hidden: true, title: 'Hand raised' }, icon('handFill'), h('span', {}, 'Hand raised'));
    const status = h('span', { class: 'tile-status', hidden: true });
    const pinBtn = h('button', { class: 'tile-pin', type: 'button', 'aria-label': 'Pin', title: 'Pin to the main view' }, icon('pin'));
    const el = h(
      'div',
      { class: 'tile' + (spec.slot === 'screen' ? ' tile-screen' : '') + (spec.self ? ' tile-self' : ''), 'data-key': spec.key },
      video,
      avatarBox,
      status,
      h('div', { class: 'tile-label' }, name),
      h('div', { class: 'tile-corner' }, micIco, pinBtn),
      hand,
    );
    const tile = { ...spec, el, video, avatar: avatarBox, circle, name, micIco, hand, status, pinBtn, track: null };
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      pin(pinned === spec.key ? null : spec.key);
    });
    el.addEventListener('dblclick', () => pin(pinned === spec.key ? null : spec.key));
    return tile;
  }

  function setVideo(tile, track, show) {
    if (tile.track !== track) {
      tile.track = track;
      tile.video.srcObject = track ? new MediaStream([track]) : null;
    }
    const visible = !!track && show;
    tile.video.hidden = !visible;
    tile.avatar.hidden = visible || tile.slot === 'screen';
    tile.el.classList.toggle('no-video', !visible);
  }

  function paintTile(tile) {
    if (tile.self) {
      const track = media.get(tile.slot);
      setVideo(tile, track, !!track);
      tile.video.classList.toggle('mirrored', tile.slot === 'cam' && s.mirrorSelf);
      tile.name.textContent = tile.slot === 'screen' ? 'You are presenting' : 'You';
      paintAvatar(tile.circle, meeting.name);
      tile.micIco.hidden = tile.slot === 'screen' || !!media.get('audio');
      tile.hand.hidden = tile.slot === 'screen' || !meeting.hand;
      tile.status.hidden = true;
    } else {
      const p = tile.p;
      const track = p.tracks[tile.slot];
      setVideo(tile, track, tile.slot === 'screen' ? p.state.screen : p.state.cam);
      tile.name.textContent = tile.slot === 'screen' ? p.name + ' (presenting)' : p.name;
      paintAvatar(tile.circle, p.name);
      tile.micIco.hidden = tile.slot === 'screen' || p.state.mic;
      tile.hand.hidden = tile.slot === 'screen' || !p.state.hand;
      const connecting = p.status !== 'connected';
      const reconnecting = p.connectionState === 'disconnected' || p.connectionState === 'failed';
      tile.status.hidden = !(connecting || reconnecting);
      tile.status.textContent = connecting ? 'Connecting…' : 'Reconnecting…';
    }
    tile.el.classList.toggle('pinned', pinned === tile.key);
  }

  function sync() {
    const specs = tileKeyList();
    const keys = new Set(specs.map((x) => x.key));
    for (const [key, tile] of tiles) {
      if (!keys.has(key)) {
        tile.video.srcObject = null;
        tile.el.remove();
        tiles.delete(key);
        if (pinned === key) pinned = null;
      }
    }
    for (const spec of specs) {
      let tile = tiles.get(spec.key);
      if (!tile) {
        tile = makeTile(spec);
        tiles.set(spec.key, tile);
      } else if (spec.p) tile.p = spec.p;
      paintTile(tile);
    }
    syncAudio();
    paintCounts();
    paintControls();
    doLayout();
  }

  function syncAudio() {
    const wanted = new Map();
    for (const p of meeting.participants.values()) {
      if (p.status !== 'connected') continue;
      if (p.tracks.audio) wanted.set(p.id + ':audio', p.tracks.audio);
      if (p.tracks.screenAudio) wanted.set(p.id + ':screenAudio', p.tracks.screenAudio);
    }
    for (const [key, el] of audioEls) {
      if (!wanted.has(key)) {
        el.srcObject = null;
        el.remove();
        audioEls.delete(key);
        meter.unwatch(key);
      }
    }
    for (const [key, track] of wanted) {
      let el = audioEls.get(key);
      if (!el) {
        el = h('audio', { autoplay: true });
        audioBox.appendChild(el);
        audioEls.set(key, el);
      }
      if (!el.srcObject || el.srcObject.getAudioTracks()[0] !== track) {
        el.srcObject = new MediaStream([track]);
        if (s.speakerId && el.setSinkId) el.setSinkId(s.speakerId).catch(() => {});
        el.play().catch(() => {});
        if (key.endsWith(':audio')) meter.watch(key, track);
      }
    }
    if (media.get('audio')) meter.watch('self', media.get('audio'));
    else meter.unwatch('self');
    if (recorder) recorder.setAudioTracks([...wanted.values(), media.get('audio')]);
  }

  // ---- layout ----
  function currentLayout(list) {
    const screens = list.filter((t) => t.slot === 'screen');
    if (pinned && tiles.has(pinned)) return { mode: 'spotlight', main: tiles.get(pinned) };
    if (layout === 'grid') return { mode: list.length === 2 ? 'duo' : 'grid' };
    if (screens.length) return { mode: 'spotlight', main: screens.find((t) => !t.self) || screens[0] };
    if (layout === 'spotlight') {
      const main = (activeSpeaker && tiles.get(activeSpeaker + ':cam')) || list.find((t) => !t.self) || list[0];
      return { mode: 'spotlight', main };
    }
    if (list.length === 2) return { mode: 'duo' };
    return { mode: 'grid' };
  }

  function doLayout() {
    const list = [...tiles.values()];
    const L = currentLayout(list);
    stage.dataset.layout = L.mode;
    const alone = meeting.connected.length === 0;
    emptyCard.hidden = !alone || emptyCard.dataset.dismissed === '1';
    if (alone) paintEmpty();

    if (L.mode === 'spotlight') {
      if (L.main.el.parentNode !== stageMain) stageMain.appendChild(L.main.el);
      for (const t of list) if (t !== L.main && t.el.parentNode !== strip) strip.appendChild(t.el);
      for (const t of list) t.el.style.width = t.el.style.height = '';
      return;
    }
    for (const t of list) if (t.el.parentNode !== strip) strip.appendChild(t.el);
    if (L.mode === 'duo') {
      // The other person fills the stage; you sit in the corner.
      for (const t of list) {
        t.el.style.width = t.el.style.height = '';
        t.el.classList.toggle('duo-small', !!t.self);
      }
      return;
    }
    for (const t of list) t.el.classList.remove('duo-small');
    const rect = strip.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;
    const n = list.length;
    const gap = 10;
    const ratio = W < 560 && n > 1 ? 3 / 4 : 16 / 9;
    let best = { w: 0, h: 0 };
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      let w = (W - gap * (cols - 1)) / cols;
      let hgt = w / ratio;
      if (hgt * rows + gap * (rows - 1) > H) {
        hgt = (H - gap * (rows - 1)) / rows;
        w = hgt * ratio;
      }
      if (w > best.w) best = { w, h: hgt };
    }
    for (const t of list) {
      t.el.style.width = Math.floor(best.w) + 'px';
      t.el.style.height = Math.floor(best.h) + 'px';
    }
  }

  function pin(key) {
    pinned = key;
    for (const t of tiles.values()) t.el.classList.toggle('pinned', pinned === t.key);
    doLayout();
  }

  function paintEmpty() {
    if (emptyCard.dataset.painted === meeting.phase) return;
    emptyCard.dataset.painted = meeting.phase;
    clear(emptyCard).append(
      h(
        'div',
        { class: 'empty-head' },
        h('h2', {}, 'Your meeting is ready'),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Dismiss', onclick: () => (emptyCard.dataset.dismissed = '1', emptyCard.hidden = true) }, icon('close')),
      ),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => shareInvite() }, icon('addPerson'), h('span', {}, 'Add others')),
      h('p', {}, 'Or share this meeting code with the people you want in the meeting'),
      h(
        'div',
        { class: 'code-copy' },
        h('span', { class: 'code-copy-text' }, meeting.code),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Copy invite', title: 'Copy invite', onclick: () => copyInvite() }, icon('copy')),
      ),
      h('p', { class: 'empty-note' }, icon('lock'), h('span', {}, 'People who use this code must be let in by you, and the call is end-to-end encrypted.')),
    );
  }

  const ro = new ResizeObserver(() => doLayout());
  ro.observe(stage);

  // ---- controls ----
  function paintControls() {
    const mic = !!media.get('audio');
    const cam = !!media.get('cam');
    const scr = !!media.get('screen');
    setCtl(micBtn, mic ? 'mic' : 'micOff', !mic, mic ? 'Turn off microphone (Ctrl+D)' : 'Turn on microphone (Ctrl+D)');
    setCtl(camBtn, cam ? 'cam' : 'camOff', !cam, cam ? 'Turn off camera (Ctrl+E)' : 'Turn on camera (Ctrl+E)');
    if (screenBtn) {
      setCtl(screenBtn, scr ? 'screenOff' : 'screen', false, scr ? 'Stop presenting' : 'Share screen');
      screenBtn.classList.toggle('on', scr);
    }
    handBtn.classList.toggle('on', meeting.hand);
    handBtn.title = meeting.hand ? 'Lower hand' : 'Raise hand';
    handBtn.setAttribute('aria-pressed', String(meeting.hand));
  }

  function setCtl(b, ic, off, label) {
    const cur = b.dataset.icon;
    if (cur !== ic) {
      b.replaceChild(icon(ic), b.firstChild);
      b.dataset.icon = ic;
    }
    b.classList.toggle('off', off);
    b.title = label;
    b.setAttribute('aria-label', label);
  }

  function paintCounts() {
    const n = meeting.connected.length + 1;
    peopleCount.textContent = String(n);
    const knocks = meeting.knocks.size;
    peopleBtn.classList.toggle('attention', knocks > 0 && meeting.isHost);
  }

  function paintBadges() {
    chatBadge.hidden = unread === 0;
    chatBadge.textContent = unread > 9 ? '9+' : String(unread);
  }

  async function toggleMic() {
    if (media.get('audio')) media.stopMic();
    else {
      try {
        await media.startMic();
      } catch {
        toast(media.lastError || 'Could not start the microphone.', { kind: 'warn' });
      }
    }
    paintControls();
  }

  async function toggleCam() {
    if (media.get('cam')) media.stopCam();
    else {
      try {
        await media.startCam();
      } catch {
        toast(media.lastError || 'Could not start the camera.', { kind: 'warn' });
      }
    }
    paintControls();
  }

  async function toggleScreen() {
    if (media.get('screen')) {
      media.stopScreen();
    } else {
      try {
        await media.startScreen();
        toast('You are presenting. Everyone in the meeting can see what you share.');
      } catch (err) {
        if (err && err.name !== 'NotAllowedError' && err.name !== 'AbortError') toast('Could not share the screen.', { kind: 'warn' });
      }
    }
    sync();
  }

  function openReactions(anchor = reactBtn) {
    const row = h(
      'div',
      { class: 'reactions' },
      REACTIONS.map((e) =>
        h('button', { class: 'reaction-btn', type: 'button', 'aria-label': 'React ' + e, onclick: () => meeting.react(e) }, e),
      ),
    );
    popover(anchor, row, { autoclose: true });
  }

  function openMore() {
    const cur = currentLayout([...tiles.values()]).mode;
    const narrow = window.innerWidth <= 720;
    const items = [
      narrow ? { label: meeting.hand ? 'Lower hand' : 'Raise hand', icon: 'hand', run: () => meeting.setHand(!meeting.hand) } : null,
      narrow ? { label: 'Send a reaction', icon: 'smile', run: () => setTimeout(() => openReactions(moreBtn), 0) } : null,
      narrow ? '-' : null,
      { label: 'Grid view', icon: 'grid', checked: layout === 'grid' || (layout === 'auto' && cur !== 'spotlight'), run: () => setLayout('grid') },
      { label: 'Spotlight view', icon: 'spotlight', checked: layout === 'spotlight' || (layout === 'auto' && cur === 'spotlight'), run: () => setLayout('spotlight') },
      '-',
      { label: 'Share a file', icon: 'clip', run: () => pickFile() },
      Recorder.supported() && platform.kind !== 'android'
        ? { label: recorder ? 'Stop recording' : 'Record on this device', icon: 'record', run: () => toggleRecording() }
        : null,
      platform.canPip ? { label: 'Picture in picture', icon: 'pip', run: () => startPip() } : null,
      document.fullscreenEnabled ? { label: document.fullscreenElement ? 'Exit full screen' : 'Full screen', icon: 'expand', run: () => toggleFullscreen() } : null,
      platform.hasSpeakerToggle ? { label: speakerOn ? 'Use earpiece' : 'Use speaker', icon: speakerOn ? 'earpiece' : 'speaker', run: () => toggleSpeaker() } : null,
      '-',
      { label: 'Settings', icon: 'gear', run: () => app.openSettings() },
      platform.kind !== 'android' ? { label: 'Keyboard shortcuts', icon: 'keyboard', hint: '?', run: () => showShortcuts() } : null,
    ];
    menu(moreBtn, items);
  }

  function setLayout(l) {
    layout = l;
    pinned = null;
    doLayout();
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else root.requestFullscreen().catch(() => {});
  }

  function toggleSpeaker() {
    speakerOn = !speakerOn;
    platform.setSpeaker(speakerOn);
    toast(speakerOn ? 'Sound is coming from the speaker.' : 'Sound is coming from the earpiece.');
  }

  async function startPip() {
    const list = [...tiles.values()];
    const main =
      (activeSpeaker && tiles.get(activeSpeaker + ':cam')) ||
      list.find((t) => !t.self && t.slot === 'screen' && !t.video.hidden) ||
      list.find((t) => !t.self && !t.video.hidden);
    if (!main) return toast('There is no video from others to show yet.');
    try {
      await main.video.requestPictureInPicture();
    } catch {
      toast('Picture in picture is not available here.');
    }
  }

  function pickFile() {
    const input = h('input', { type: 'file', hidden: true });
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      input.remove();
      if (!f) return;
      if (meeting.connected.length === 0) return toast('There is no one to share with yet.');
      if (!meeting.shareFile(f)) return toast('Files up to 512 MB can be shared.');
      if (panelName !== 'chat') togglePanel('chat');
    });
    document.body.appendChild(input);
    input.click();
  }

  async function toggleRecording() {
    if (recorder) {
      const r = recorder;
      recorder = null;
      meeting.setRecording(false);
      const blob = await r.stop();
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const where = await platform.saveFile(blob, `handshake-${stamp}.webm`);
      toast(where ? 'Recording saved to this device.' : 'Could not save the recording.');
      return;
    }
    const d = dialog({
      title: 'Record this meeting?',
      body: h(
        'div',
        {},
        h('p', {}, 'The recording is made and saved on this device only. Everyone in the meeting will see that you are recording.'),
        h('p', { class: 'muted' }, 'Ask the others first. Recording people without their consent may be against the law where you live.'),
      ),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Start recording',
          kind: 'primary',
          onClick: () => {
            recorder = new Recorder(recordTiles);
            syncAudio();
            recorder.start();
            meeting.setRecording(true);
          },
        },
      ],
    });
    return d;
  }

  function recordTiles() {
    return [...tiles.values()].map((t) => ({
      video: t.video.hidden ? null : t.video,
      name: t.self ? meeting.name : t.slot === 'screen' ? t.p.name + ' (screen)' : t.p.name,
      screen: t.slot === 'screen',
      camOff: t.video.hidden,
    }));
  }

  function showShortcuts() {
    const row = (k, v) => h('div', { class: 'shortcut' }, h('kbd', {}, k), h('span', {}, v));
    dialog({
      title: 'Keyboard shortcuts',
      body: h(
        'div',
        { class: 'shortcuts' },
        row('Ctrl + D', 'Microphone on or off'),
        row('Ctrl + E', 'Camera on or off'),
        row('Ctrl + Alt + H', 'Raise or lower your hand'),
        row('Ctrl + Alt + C', 'Open or close chat'),
        row('Ctrl + Alt + P', 'Open or close people'),
        row('Ctrl + Alt + S', 'Open encryption details'),
        row('?', 'Show this list'),
      ),
      actions: [{ label: 'Close' }],
    });
  }

  function onLeave() {
    const others = meeting.connected.length > 0;
    if (meeting.isHost && others) {
      menu(leaveBtn, [
        { label: 'Leave meeting', icon: 'leave', run: () => app.leaveMeeting() },
        { label: 'End meeting for everyone', icon: 'close', danger: true, run: () => app.leaveMeeting(true) },
      ], { align: 'end' });
    } else {
      app.leaveMeeting();
    }
  }

  // ---- notices: people asking to join, recording ----
  function paintNotices() {
    clear(notices);
    if (meeting.isHost) {
      for (const k of meeting.knocks.values()) {
        notices.appendChild(
          h(
            'div',
            { class: 'notice notice-knock' },
            avatar(k.name, 'avatar avatar-md'),
            h('div', { class: 'notice-text' }, h('strong', {}, k.name), h('span', {}, 'wants to join this call')),
            h('button', { class: 'btn btn-text btn-small', type: 'button', onclick: () => meeting.deny(k.id) }, 'Deny'),
            h('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: () => meeting.admit(k.id) }, 'Admit'),
          ),
        );
      }
    }
    const recorders = [...meeting.participants.values()].filter((p) => p.status === 'connected' && p.state.recording).map((p) => p.name);
    if (recorder) recorders.unshift('You');
    if (recorders.length) {
      const who = recorders.length === 1 ? recorders[0] : recorders.slice(0, -1).join(', ') + ' and ' + recorders[recorders.length - 1];
      notices.appendChild(
        h('div', { class: 'notice notice-rec' }, h('span', { class: 'rec-dot' }), h('span', {}, `${who} ${recorders.length === 1 && who !== 'You' ? 'is' : 'are'} recording this meeting`)),
      );
    }
  }

  // ---- speaking indicator ----
  const levels = new Map();
  const speakTimer = setInterval(() => {
    let loudest = null;
    let loudestLevel = SPEAK_THRESHOLD;
    const check = (key, tileKey) => {
      const v = meter.level(key);
      const prev = levels.get(key) || 0;
      const smooth = Math.max(v, prev * 0.7);
      levels.set(key, smooth);
      const t = tiles.get(tileKey);
      if (t) t.el.classList.toggle('speaking', smooth > SPEAK_THRESHOLD);
      if (smooth > loudestLevel) {
        loudestLevel = smooth;
        loudest = tileKey.split(':')[0];
      }
    };
    if (media.get('audio')) check('self', 'self:cam');
    else tiles.get('self:cam') && tiles.get('self:cam').el.classList.remove('speaking');
    for (const p of meeting.participants.values()) {
      if (p.status === 'connected' && p.state.mic) check(p.id + ':audio', p.id + ':cam');
      else tiles.get(p.id + ':cam') && tiles.get(p.id + ':cam').el.classList.remove('speaking');
    }
    const now = Date.now();
    if (loudest && loudest !== 'self' && loudest !== activeSpeaker && now - speakerSince > 1500) {
      activeSpeaker = loudest;
      speakerSince = now;
      if (layout === 'spotlight' && !pinned) doLayout();
    }
    timeEl.textContent = formatDuration(now - startedAt);
  }, 200);

  // ---- reactions ----
  function floatReaction(emoji, who) {
    const node = h(
      'div',
      { class: 'reaction-float', style: { left: 10 + Math.random() * 30 + '%' } },
      h('span', { class: 'reaction-emoji' }, emoji),
      h('span', { class: 'reaction-who' }, who),
    );
    reactionLayer.appendChild(node);
    setTimeout(() => node.remove(), 3200);
  }

  // ---- meeting events ----
  const on = (type, fn) => {
    meeting.addEventListener(type, fn);
    offs.push(() => meeting.removeEventListener(type, fn));
  };
  const offs = [];

  on('participants', () => {
    sync();
    paintNotices();
  });
  on('participant', (e) => {
    const p = e.detail;
    const hadScreen = tiles.has(p.id + ':screen');
    if (!!p.state.screen !== hadScreen) sync();
    else {
      for (const t of tiles.values()) if (t.p === p) paintTile(t);
      syncAudio();
    }
    paintNotices();
  });
  on('track', () => sync());
  on('self', () => {
    sync();
    paintNotices();
  });
  on('joined', (e) => {
    toast(`${e.detail.name} joined`);
    chime('join');
  });
  on('left', (e) => {
    toast(e.detail.reason === 'removed' ? `${e.detail.name} was removed` : `${e.detail.name} left`);
    chime('leave');
  });
  on('knock', (e) => {
    chime('knock');
    toast(`${e.detail.name} is asking to join`);
  });
  on('knocks', () => {
    paintNotices();
    paintCounts();
  });
  on('hand', (e) => toast(`${e.detail.name} raised a hand`));
  on('reaction', (e) => floatReaction(e.detail.emoji, e.detail.participant ? e.detail.participant.name : 'You'));
  on('chat', (e) => {
    const m = e.detail;
    if (!m.mine && panelName !== 'chat') {
      unread++;
      paintBadges();
      toast(m.file ? `${m.name} shared ${m.file.name}` : `${m.name}: ${m.text.slice(0, 80)}`, {
        action: { label: 'Open', run: () => togglePanel('chat') },
      });
      chime('message');
    }
  });
  on('room', (e) => {
    paintCounts();
    if (!meeting.isHost) toast(e.detail.locked ? 'The host locked the meeting.' : 'The host changed who can join.');
  });
  on('host', (e) => {
    if (e.detail.isMe && e.detail.before) toast('You are now the host of this meeting.');
    paintNotices();
  });
  on('muted-by-host', () => toast('The host turned off your microphone.'));
  on('slow', (e) =>
    toast(`Still trying to connect to ${e.detail.name}. Some networks block direct calls; a TURN server in Settings can help.`, {
      timeout: 9000,
      action: { label: 'Settings', run: () => app.openSettings('network') },
    }),
  );
  on('decrypt-failing', (e) =>
    toast(`Media from ${e.detail.name} could not be decrypted. You may be using different passwords.`, { kind: 'warn', timeout: 8000 }),
  );
  on('relays', (e) => {
    secureBtn.classList.toggle('degraded', e.detail.open === 0);
  });

  const onMedia = () => sync();
  media.addEventListener('change', onMedia);

  // ---- keyboard ----
  const onKey = (e) => {
    const typing = /^(input|textarea|select)$/i.test(e.target.tagName) || e.target.isContentEditable;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && !e.altKey && k === 'd') {
      e.preventDefault();
      toggleMic();
    } else if (mod && !e.altKey && k === 'e') {
      e.preventDefault();
      toggleCam();
    } else if (mod && e.altKey && k === 'h') {
      e.preventDefault();
      meeting.setHand(!meeting.hand);
    } else if (mod && e.altKey && k === 'c') {
      e.preventDefault();
      togglePanel('chat');
    } else if (mod && e.altKey && k === 'p') {
      e.preventDefault();
      togglePanel('people');
    } else if (mod && e.altKey && k === 's') {
      e.preventDefault();
      togglePanel('security');
    } else if (!typing && e.key === '?') {
      showShortcuts();
    }
  };
  document.addEventListener('keydown', onKey);

  platform.onBack(() => {
    if (panelName) {
      closePanel();
      return true;
    }
    onLeave();
    return true;
  });

  sync();
  paintNotices();

  return {
    openPanel: togglePanel,
    destroy() {
      clearInterval(speakTimer);
      ro.disconnect();
      document.removeEventListener('keydown', onKey);
      media.removeEventListener('change', onMedia);
      for (const off of offs) off();
      for (const p of Object.values(panels)) p.destroy && p.destroy();
      if (recorder) {
        const r = recorder;
        recorder = null;
        r.stop().then((blob) => {
          if (blob.size) platform.saveFile(blob, `handshake-${Date.now()}.webm`);
        });
      }
      for (const t of tiles.values()) t.video.srcObject = null;
      for (const el of audioEls.values()) el.srcObject = null;
      if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      meter.unwatch('self');
      for (const k of audioEls.keys()) meter.unwatch(k);
    },
  };
}
