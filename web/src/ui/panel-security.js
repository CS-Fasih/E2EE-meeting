import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { safetyGlyph } from './jaali.js';

function fmtRate(bps) {
  if (!bps) return '0 kbps';
  if (bps > 1e6) return (bps / 1e6).toFixed(1) + ' Mbps';
  return Math.round(bps / 1000) + ' kbps';
}

export function securityPanel(app, meeting) {
  const el = h('div', { class: 'panel-body security' });
  let visible = false;
  let timer = 0;
  const cards = new Map();

  function summary() {
    const people = [...meeting.participants.values()].filter((p) => p.status === 'connected');
    const relays = meeting.signal ? meeting.signal.relayStatus : { open: 0, total: 0 };
    const allFrame = people.length > 0 && people.every((p) => p.e2ee === 'frame');
    const verified = people.filter((p) => p.verified).length;
    return h(
      'section',
      { class: 'panel-section' },
      h(
        'div',
        { class: 'sec-summary' },
        icon('shield', 'ico big'),
        h(
          'div',
          {},
          h('p', { class: 'sec-lead' }, people.length ? 'This meeting is end-to-end encrypted.' : 'Encryption starts as soon as someone joins.'),
          h(
            'p',
            { class: 'muted' },
            people.length
              ? `${verified} of ${people.length} ${people.length === 1 ? 'connection' : 'connections'} verified by safety number.`
              : 'Keys are made on this device from the meeting code and never leave it.',
          ),
        ),
      ),
      h(
        'ul',
        { class: 'sec-facts' },
        h('li', {}, 'Media travels directly between devices over DTLS-SRTP, with keys checked against offers that only people with the meeting code can seal.'),
        allFrame || (!people.length && meeting.frameMode)
          ? h('li', {}, 'Every audio and video frame is also sealed with AES-256-GCM, using a separate key for each direction of each connection.')
          : null,
        h('li', {}, 'Chat and files go over the same encrypted connection and are never stored.'),
        h(
          'li',
          {},
          `Connection messages pass through ${relays.total} public relays as sealed envelopes (${relays.open} connected now). Relays see that a meeting exists, never what is said or who is in it by name.`,
        ),
        meeting.meeting && meeting.meeting.hasPassword ? h('li', {}, 'This meeting also needs a password, which is mixed into every key.') : null,
      ),
    );
  }

  function card(p) {
    const glyphBox = h('div', { class: 'glyph-box' });
    const digits = h('div', { class: 'digits', 'aria-label': 'Safety number' });
    const path = h('dd', {}, '–');
    const quality = h('dd', {}, '–');
    const layers = h('dd', {}, p.e2ee === 'frame' ? 'Transport and frame encryption' : 'Transport encryption');
    const frames = h('dd', {}, '–');
    const verifyBtn = h('button', { class: 'btn btn-quiet btn-small', type: 'button' });
    verifyBtn.addEventListener('click', () => meeting.setVerified(p.id, !p.verified));
    const node = h(
      'section',
      { class: 'panel-section sec-card' },
      h('h3', {}, p.name),
      h(
        'div',
        { class: 'sec-compare' },
        glyphBox,
        h(
          'div',
          {},
          digits,
          h('p', { class: 'muted small' }, `Ask ${p.name} to open this panel. If the pattern and the numbers match on both screens, nobody is in between.`),
          verifyBtn,
        ),
      ),
      h(
        'dl',
        { class: 'sec-stats' },
        h('dt', {}, 'Encryption'),
        layers,
        h('dt', {}, 'Route'),
        path,
        h('dt', {}, 'Network'),
        quality,
        p.e2ee === 'frame' ? h('dt', {}, 'Frames') : null,
        p.e2ee === 'frame' ? frames : null,
      ),
    );
    return { node, glyphBox, digits, path, quality, frames, verifyBtn, safetyKey: '' };
  }

  function paintCard(c, p) {
    const key = p.safety ? p.safety.join('') : '';
    if (c.safetyKey !== key) {
      c.safetyKey = key;
      clear(c.glyphBox);
      clear(c.digits);
      if (p.peer && p.peer.safety) {
        c.glyphBox.appendChild(safetyGlyph(p.peer.safety.bytes, 64));
        p.safety.forEach((g) => c.digits.appendChild(h('span', {}, g)));
      } else {
        c.digits.appendChild(h('span', { class: 'muted' }, 'Waiting for the connection'));
      }
    }
    clear(c.verifyBtn).append(icon(p.verified ? 'check' : 'shield'), h('span', {}, p.verified ? 'Verified. Undo' : 'Mark as verified'));
    c.verifyBtn.classList.toggle('ok', p.verified);
  }

  function render() {
    if (!visible) return;
    clear(el);
    el.appendChild(summary());
    const people = [...meeting.participants.values()].filter((p) => p.status === 'connected' || p.status === 'connecting');
    for (const id of [...cards.keys()]) if (!people.find((p) => p.id === id)) cards.delete(id);
    for (const p of people) {
      let c = cards.get(p.id);
      if (!c) {
        c = card(p);
        cards.set(p.id, c);
      }
      paintCard(c, p);
      el.appendChild(c.node);
    }
  }

  async function refreshStats() {
    for (const [id, c] of cards) {
      const p = meeting.participants.get(id);
      if (!p || !p.peer) continue;
      const st = await p.peer.stats().catch(() => null);
      if (!st) continue;
      c.path.textContent = st.path
        ? (st.path === 'relay' ? 'Through a TURN relay (still encrypted)' : 'Direct, device to device') + (st.protocol ? `, ${st.protocol.toUpperCase()}` : '')
        : 'Finding a route';
      const parts = [];
      if (st.rtt != null) parts.push(`${st.rtt} ms delay`);
      parts.push(`${fmtRate(st.inBps)} in`, `${fmtRate(st.outBps)} out`);
      if (st.lossPct > 0.5) parts.push(`${st.lossPct.toFixed(1)}% loss`);
      c.quality.textContent = parts.join(', ');
      const fs = p.peer.frameStats;
      c.frames.textContent = `${fs.sentOk.toLocaleString()} sealed, ${fs.recvOk.toLocaleString()} opened` + (fs.recvFailed ? `, ${fs.recvFailed} rejected` : '');
    }
  }

  const events = ['participants', 'participant', 'relays'];
  events.forEach((t) => meeting.addEventListener(t, render));

  return {
    title: 'Encryption',
    el,
    show() {
      visible = true;
      render();
      refreshStats();
      timer = setInterval(refreshStats, 2000);
    },
    hide() {
      visible = false;
      clearInterval(timer);
    },
    destroy() {
      clearInterval(timer);
      events.forEach((t) => meeting.removeEventListener(t, render));
    },
  };
}
