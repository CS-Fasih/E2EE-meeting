import { h, clear, initials } from './dom.js';
import { icon } from './icons.js';
import { menu } from './overlay.js';
import { platform } from '../lib/platform.js';
import { avatar } from './avatar.js';

export function peoplePanel(app, meeting, { onPin, copyInvite, shareInvite }) {
  const el = h('div', { class: 'panel-body people' });
  let visible = false;

  function render() {
    if (!visible) return;
    clear(el);
    // Invite
    el.appendChild(
      h(
        'section',
        { class: 'panel-section' },
        h('h3', {}, 'Add people'),
        h('p', { class: 'muted' }, 'Share the meeting code with people you trust. They can ask to join and you decide who gets in.'),
        h('div', { class: 'code-box' }, meeting.code),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn btn-quiet', type: 'button', onclick: copyInvite }, icon('copy'), h('span', {}, 'Copy invite')),
          navigator.share || platform.kind === 'android'
            ? h('button', { class: 'btn btn-quiet', type: 'button', onclick: shareInvite }, icon('share'), h('span', {}, 'Share'))
            : null,
        ),
      ),
    );

    // Host controls
    if (meeting.isHost) {
      const lobby = h('input', { type: 'checkbox', role: 'switch', checked: meeting.room.lobby });
      lobby.addEventListener('change', () => meeting.setRoom({ lobby: lobby.checked }));
      const locked = h('input', { type: 'checkbox', role: 'switch', checked: meeting.room.locked });
      locked.addEventListener('change', () => meeting.setRoom({ locked: locked.checked }));
      el.appendChild(
        h(
          'section',
          { class: 'panel-section' },
          h('h3', {}, 'Host controls'),
          h('label', { class: 'switch-row' }, h('span', {}, h('strong', {}, 'Waiting room'), h('span', { class: 'hint' }, 'Admit each person before they join')), lobby),
          h('label', { class: 'switch-row' }, h('span', {}, h('strong', {}, 'Lock meeting'), h('span', { class: 'hint' }, 'No one else can ask to join')), locked),
          meeting.connected.length
            ? h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => meeting.muteAll() }, icon('micOff'), h('span', {}, 'Turn off everyone’s microphone'))
            : null,
        ),
      );
      if (meeting.knocks.size) {
        el.appendChild(
          h(
            'section',
            { class: 'panel-section' },
            h('h3', {}, 'Waiting to be admitted'),
            [...meeting.knocks.values()].map((k) =>
              h(
                'div',
                { class: 'person' },
                avatar(k.name, 'avatar avatar-sm'),
                h('span', { class: 'person-name' }, k.name),
                h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: () => meeting.deny(k.id) }, 'Deny'),
                h('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: () => meeting.admit(k.id) }, 'Admit'),
              ),
            ),
          ),
        );
      }
    } else if (meeting.room.locked) {
      el.appendChild(h('p', { class: 'panel-note' }, icon('lock'), h('span', {}, 'The host has locked this meeting.')));
    }

    // In the meeting
    const people = [...meeting.participants.values()].filter((p) => p.status === 'connected' || p.status === 'connecting');
    el.appendChild(
      h(
        'section',
        { class: 'panel-section' },
        h('h3', {}, `In the call (${people.length + 1})`),
        row({ self: true, name: meeting.name + ' (You)', mic: !!app.media.get('audio'), cam: !!app.media.get('cam'), hand: meeting.hand, host: meeting.isHost }),
        people
          .sort((a, b) => a.joinedAt - b.joinedAt)
          .map((p) =>
            row({
              p,
              name: p.name,
              mic: p.state.mic,
              cam: p.state.cam,
              hand: p.state.hand,
              host: p.id === meeting.hostId,
              verified: p.verified,
              connecting: p.status !== 'connected',
            }),
          ),
      ),
    );
  }

  function row(r) {
    const more =
      !r.self &&
      h('button', {
        class: 'icon-btn',
        type: 'button',
        'aria-label': 'Options for ' + r.name,
        onclick: (e) => {
          const p = r.p;
          const items = [
            { label: 'Pin to the main view', icon: 'pin', run: () => onPin(p.id + ':cam') },
            meeting.isHost && p.state.mic ? { label: 'Turn off their microphone', icon: 'micOff', run: () => meeting.askToMute(p.id) } : null,
            meeting.isHost && p.state.hand ? { label: 'Lower their hand', icon: 'hand', run: () => meeting.lowerHand(p.id) } : null,
            meeting.isHost ? '-' : null,
            meeting.isHost ? { label: 'Remove from meeting', icon: 'close', danger: true, run: () => meeting.remove(p.id) } : null,
          ].filter(Boolean);
          menu(e.currentTarget, items, { align: 'end', above: false });
        },
      }, icon('more'));
    return h(
      'div',
      { class: 'person' },
      avatar(r.self ? meeting.name : r.name, 'avatar avatar-sm'),
      h(
        'span',
        { class: 'person-name' },
        r.name,
        r.host ? h('span', { class: 'tag' }, 'Host') : null,
        r.verified ? h('span', { class: 'tag tag-ok', title: 'Safety number checked' }, 'Verified') : null,
        r.connecting ? h('span', { class: 'tag' }, 'Connecting') : null,
      ),
      r.hand ? h('span', { class: 'person-ico hand', title: 'Hand raised' }, icon('hand')) : null,
      h('span', { class: 'person-ico' + (r.mic ? '' : ' off'), title: r.mic ? 'Microphone on' : 'Microphone off' }, icon(r.mic ? 'mic' : 'micOff')),
      h('span', { class: 'person-ico' + (r.cam ? '' : ' off'), title: r.cam ? 'Camera on' : 'Camera off' }, icon(r.cam ? 'cam' : 'camOff')),
      more || null,
    );
  }

  const events = ['participants', 'participant', 'knocks', 'room', 'host', 'self'];
  events.forEach((t) => meeting.addEventListener(t, render));

  return {
    title: 'People',
    el,
    show() {
      visible = true;
      render();
    },
    hide() {
      visible = false;
    },
    destroy() {
      events.forEach((t) => meeting.removeEventListener(t, render));
    },
  };
}
