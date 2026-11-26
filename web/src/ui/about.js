import { h } from './dom.js';
import { dialog } from './overlay.js';
import { platform } from '../lib/platform.js';

export function openAbout() {
  const step = (title, text) => h('li', {}, h('strong', {}, title), h('p', {}, text));
  dialog({
    title: 'How Baithak keeps a meeting private',
    wide: true,
    body: h(
      'div',
      { class: 'about' },
      h(
        'ol',
        { class: 'how' },
        step(
          'The code is the key',
          'Starting a meeting makes a random 120-bit code on your device. Every key for the meeting is worked out from that code (and the password, if you set one). The code is never sent anywhere by the app.',
        ),
        step(
          'Finding each other through sealed envelopes',
          'To connect, devices exchange short messages through public relays. Each message is encrypted and signed with the meeting key first, so relays cannot read, change or fake them. They see only an anonymous tag.',
        ),
        step(
          'A direct line between devices',
          'Voice, video, chat and files flow directly between devices over WebRTC, which encrypts everything with DTLS-SRTP. Because the connection offers were sealed with the meeting key, nobody without the code can slip into the middle.',
        ),
        step(
          'A second lock on every frame',
          'Each audio and video frame is encrypted again with AES-256-GCM before it is sent, using a separate key for each direction of each connection. If a TURN server relays your call, it carries only locked frames.',
        ),
        step(
          'You can check',
          'The Encryption panel shows a safety number and pattern for every connection. If both people see the same one, the connection is end to end.',
        ),
      ),
      h(
        'p',
        { class: 'muted' },
        'What Baithak cannot hide: relays and STUN servers can see your IP address, and the people in the call can see it too unless you use a TURN server with "Hide my IP address". Anyone you give the code to can ask to join, so keep the waiting room on for meetings you start.',
      ),
      h(
        'p',
        { class: 'muted small' },
        `Version ${platform.version}. Free for personal and other non-commercial use under the PolyForm Noncommercial License 1.0.0. Source code: github.com/CS-Fasih/E2EE-meeting`,
      ),
    ),
    actions: [{ label: 'Close', kind: 'primary' }],
  });
}
