import { h, clear } from './dom.js';
import { dialog, toast } from './overlay.js';
import { listDevices } from '../lib/media.js';
import { DEFAULT_RELAYS } from '../lib/relay.js';
import { DEFAULT_STUN, validRelay } from '../lib/settings.js';
import { platform } from '../lib/platform.js';

const TABS = [
  ['devices', 'Audio and video'],
  ['privacy', 'Privacy'],
  ['network', 'Network'],
];

export function openSettings(app, start = 'devices') {
  const s = app.settings;
  const tabBar = h('div', { class: 'tabs', role: 'tablist' });
  const body = h('div', { class: 'tab-body' });
  let current = start === 'network' || start === 'privacy' ? start : 'devices';

  const paintTabs = () => {
    clear(tabBar);
    for (const [id, label] of TABS) {
      tabBar.appendChild(
        h(
          'button',
          {
            class: 'tab' + (id === current ? ' active' : ''),
            role: 'tab',
            'aria-selected': String(id === current),
            type: 'button',
            onclick: () => {
              current = id;
              paintTabs();
              paint();
            },
          },
          label,
        ),
      );
    }
  };

  const toggle = (key, label, hint, after) => {
    const box = h('input', { type: 'checkbox', checked: !!s[key] });
    box.addEventListener('change', () => {
      s[key] = box.checked;
      app.save();
      if (after) after(box.checked);
    });
    return h('label', { class: 'check' }, box, h('span', {}, h('span', {}, label), hint ? h('span', { class: 'hint' }, hint) : null));
  };

  async function devices() {
    const wrap = h('div', { class: 'settings-grid' }, h('p', { class: 'muted' }, 'Looking for devices'));
    const d = await listDevices();
    clear(wrap);
    const select = (key, list, label, after) => {
      const sel = h(
        'select',
        { class: 'field' },
        h('option', { value: '' }, 'System default'),
        list.map((dev, i) => h('option', { value: dev.deviceId, selected: dev.deviceId === s[key] }, dev.label || `${label} ${i + 1}`)),
      );
      sel.addEventListener('change', async () => {
        s[key] = sel.value;
        app.save();
        if (after) await after();
      });
      return h('label', { class: 'field-group' }, h('span', { class: 'label' }, label), sel);
    };
    wrap.append(
      select('micId', d.mics, 'Microphone', () => app.media.refresh()),
      select('camId', d.cams, 'Camera', () => app.media.refresh()),
      platform.canPickSpeaker ? select('speakerId', d.speakers, 'Speaker', () => app.applySpeaker && app.applySpeaker()) : null,
    );
    const quality = h(
      'select',
      { class: 'field' },
      [
        ['low', 'Data saver (360p)'],
        ['standard', 'Standard (720p)'],
        ['high', 'High (1080p)'],
      ].map(([v, l]) => h('option', { value: v, selected: s.videoQuality === v }, l)),
    );
    quality.addEventListener('change', () => {
      s.videoQuality = quality.value;
      app.save();
      app.media.refresh();
    });
    wrap.append(
      h('label', { class: 'field-group' }, h('span', { class: 'label' }, 'Video quality'), quality),
      toggle('noiseSuppression', 'Reduce background noise', null, () => app.media.refresh()),
      toggle('echoCancellation', 'Cancel echo', 'Turn off only if you use headphones and want the most natural sound.', () => app.media.refresh()),
      toggle('autoGainControl', 'Adjust microphone volume automatically', null, () => app.media.refresh()),
      toggle('mirrorSelf', 'Mirror my video', 'Only changes how you see yourself.'),
    );
    if (!d.mics.length && !d.cams.length) wrap.prepend(h('p', { class: 'muted' }, 'No camera or microphone found. Allow access to see your devices here.'));
    return wrap;
  }

  function privacy() {
    return h(
      'div',
      { class: 'settings-grid' },
      toggle('rememberName', 'Remember my name on this device', 'Nothing else is saved: no meetings, chats or contacts.', (on) => {
        if (!on) {
          const n = s.name;
          s.name = '';
          app.save();
          s.name = n;
        }
      }),
      toggle('lobby', 'Ask before letting people into meetings I start', 'You decide who comes in, even if someone else gets hold of the code.'),
      toggle('frameEncryption', 'Encrypt every audio and video frame', 'A second layer on top of WebRTC encryption. Turn off only to troubleshoot calls with older browsers.'),
      toggle(
        'relayOnly',
        'Hide my IP address from other participants',
        s.turnUrl ? 'All media goes through your TURN server. Calls may be a little slower.' : 'Needs a TURN server. Add one under Network first.',
      ),
      platform.kind === 'android'
        ? toggle('secureScreen', 'Block screenshots and screen recording of this app', 'Also hides the app preview in the recent apps list.', (on) => platform.setSecureScreen(on))
        : null,
      h(
        'div',
        { class: 'settings-note' },
        h('h3', {}, 'What leaves this device'),
        h(
          'p',
          { class: 'muted' },
          'Sealed connection messages to the relays listed under Network, and a STUN request so devices can find each other through home routers. Your name, voice, video, chat and files go only to the people in the meeting.',
        ),
      ),
    );
  }

  function network() {
    const relays = h('textarea', { class: 'field', rows: 5, spellcheck: false }, s.relays.join('\n'));
    const stun = h('textarea', { class: 'field', rows: 2, spellcheck: false }, (s.stun || []).join('\n'));
    const turnUrl = h('input', { class: 'field', value: s.turnUrl, placeholder: 'turn:turn.example.com:3478', spellcheck: false });
    const turnUser = h('input', { class: 'field', value: s.turnUser, placeholder: 'Username', autocomplete: 'off' });
    const turnPass = h('input', { class: 'field', type: 'password', value: s.turnPass, placeholder: 'Password', autocomplete: 'off' });
    const save = () => {
      const list = relays.value.split(/\s+/).map((x) => x.trim()).filter(Boolean);
      const good = list.filter(validRelay);
      if (!good.length) {
        toast('Add at least one relay address starting with wss://', { kind: 'warn' });
        return;
      }
      if (good.length < list.length) toast('Some relay addresses were ignored. They must start with wss://');
      s.relays = good;
      s.stun = stun.value.split(/\s+/).map((x) => x.trim()).filter((u) => /^stuns?:/.test(u));
      s.turnUrl = turnUrl.value.trim();
      s.turnUser = turnUser.value.trim();
      s.turnPass = turnPass.value;
      app.save();
      toast('Network settings saved. They apply to the next meeting you join.');
    };
    const reset = () => {
      relays.value = DEFAULT_RELAYS.join('\n');
      stun.value = DEFAULT_STUN.join('\n');
    };
    return h(
      'div',
      { class: 'settings-grid' },
      h(
        'label',
        { class: 'field-group' },
        h('span', { class: 'label' }, 'Relays'),
        relays,
        h(
          'span',
          { class: 'hint' },
          'One address per line. Everyone in a meeting needs at least one relay in common. You can run your own with the relay included in the source code.',
        ),
      ),
      h(
        'label',
        { class: 'field-group' },
        h('span', { class: 'label' }, 'STUN servers'),
        stun,
        h('span', { class: 'hint' }, 'Used to find a direct route. They learn your public IP address and nothing else. Leave empty for local networks only.'),
      ),
      h(
        'div',
        { class: 'field-group' },
        h('span', { class: 'label' }, 'TURN server'),
        turnUrl,
        h('div', { class: 'row' }, turnUser, turnPass),
        h('span', { class: 'hint' }, 'Optional. Helps when a network blocks direct calls. Media through TURN stays end-to-end encrypted.'),
      ),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: save }, 'Save network settings'),
        h('button', { class: 'btn btn-quiet', type: 'button', onclick: reset }, 'Restore defaults'),
      ),
    );
  }

  async function paint() {
    const which = current;
    clear(body);
    const node = which === 'devices' ? await devices() : which === 'privacy' ? privacy() : network();
    if (which === current) {
      clear(body);
      body.appendChild(node);
    }
  }

  paintTabs();
  paint();
  dialog({ title: 'Settings', body: h('div', { class: 'settings' }, tabBar, body), wide: true, actions: [{ label: 'Done', kind: 'primary' }] });
}
