// Landing page: start a new meeting or join one with a code.
// Phones get an app-style layout; larger screens a two-column page.

import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { wordmark } from './brand.js';
import { sheet } from './overlay.js';
import { stagger, reduced, EASE } from './motion.js';
import { parseMeetingCode } from '../lib/crypto.js';

const SLIDES = [
  {
    title: 'Get a code you can share',
    text: 'Tap New meeting to get a code, then send it to the people you want to meet.',
    art: () => `
      <circle class="il-bg" cx="160" cy="160" r="150"/>
      <circle class="il-ring" cx="160" cy="160" r="128"/>
      <g class="il-float-a">
        <rect class="il-card il-shadow" x="52" y="86" width="216" height="96" rx="16"/>
        <circle class="il-accent-soft" cx="90" cy="122" r="18"/>
        <path class="il-accent-stroke" d="M84 122h12M80 116a6 6 0 0 0 0 12h4M100 116a6 6 0 0 1 0 12h-4" fill="none" stroke-width="3.5" stroke-linecap="round"/>
        <rect class="il-line" x="118" y="113" width="118" height="9" rx="4.5"/>
        <rect class="il-line-soft" x="118" y="128" width="80" height="9" rx="4.5"/>
        <rect class="il-accent" x="172" y="152" width="78" height="20" rx="10"/>
        <rect class="il-on-accent" x="186" y="160" width="50" height="4" rx="2"/>
      </g>
      <g class="il-float-b">
        <circle class="il-p1" cx="116" cy="232" r="28"/><circle class="il-card" cx="116" cy="225" r="9"/><path class="il-card" d="M99 249a17 13 0 0 1 34 0Z"/>
      </g>
      <g class="il-float-c">
        <circle class="il-p2" cx="160" cy="236" r="28"/><circle class="il-card" cx="160" cy="229" r="9"/><path class="il-card" d="M143 253a17 13 0 0 1 34 0Z"/>
      </g>
      <g class="il-float-a">
        <circle class="il-p3" cx="204" cy="232" r="28"/><circle class="il-card" cx="204" cy="225" r="9"/><path class="il-card" d="M187 249a17 13 0 0 1 34 0Z"/>
      </g>`,
  },
  {
    title: 'Encrypted from end to end',
    text: 'Voice, video, chat and files are locked on your device. Only the people in the call can unlock them.',
    art: () => `
      <circle class="il-bg" cx="160" cy="160" r="150"/>
      <circle class="il-ring" cx="160" cy="160" r="128"/>
      <g class="il-float-b">
        <rect class="il-tile" x="60" y="80" width="96" height="70" rx="12"/>
        <rect class="il-tile" x="164" y="80" width="96" height="70" rx="12"/>
        <rect class="il-tile" x="60" y="158" width="96" height="70" rx="12"/>
        <rect class="il-tile" x="164" y="158" width="96" height="70" rx="12"/>
        <circle class="il-p1" cx="108" cy="110" r="15"/><circle class="il-p2" cx="212" cy="110" r="15"/>
        <circle class="il-p3" cx="108" cy="188" r="15"/><circle class="il-p4" cx="212" cy="188" r="15"/>
      </g>
      <g class="il-float-a">
        <path class="il-shield il-shadow" d="M160 146l50 18v35c0 32-21 55-50 66-29-11-50-34-50-66v-35z"/>
        <rect class="il-on-accent" x="144" y="196" width="32" height="26" rx="5"/>
        <path class="il-lock" d="M150 196v-8a10 10 0 0 1 20 0v8" fill="none" stroke-width="5" stroke-linecap="round"/>
        <circle class="il-accent" cx="160" cy="209" r="3.5"/>
      </g>`,
  },
  {
    title: 'No account. Nothing stored.',
    text: 'Devices connect directly to each other. There is no sign-up, and the chat is gone when the call ends.',
    art: () => `
      <circle class="il-bg" cx="160" cy="160" r="150"/>
      <circle class="il-ring" cx="160" cy="160" r="128"/>
      <g class="il-float-b">
        <rect class="il-device" x="42" y="100" width="132" height="88" rx="9"/>
        <rect class="il-tile" x="50" y="108" width="116" height="72" rx="5"/>
        <path class="il-device" d="M30 196h156l-9 11H39Z"/>
        <circle class="il-p2" cx="108" cy="144" r="17"/>
      </g>
      <g class="il-float-a">
        <rect class="il-device" x="214" y="94" width="70" height="124" rx="13"/>
        <rect class="il-tile" x="220" y="104" width="58" height="100" rx="7"/>
        <circle class="il-p1" cx="249" cy="146" r="15"/>
      </g>
      <path class="il-dash" d="M118 240c32 26 84 26 116-8" fill="none" stroke-width="4" stroke-dasharray="2 11" stroke-linecap="round"/>
      <g class="il-float-c">
        <circle class="il-accent il-shadow" cx="176" cy="256" r="20"/>
        <rect class="il-on-accent" x="167" y="254" width="18" height="13" rx="2.5"/>
        <path class="il-lock-small" d="M170 254v-4a6 6 0 0 1 12 0v4" fill="none" stroke-width="3" stroke-linecap="round"/>
      </g>`,
  },
];

function carousel({ compact = false } = {}) {
  let slide = 0;
  let timer = 0;
  const art = h('div', { class: 'slide-art' });
  const title = h('h2', { class: 'slide-title' });
  const text = h('p', { class: 'slide-text' });
  const dots = h('div', { class: 'slide-dots', role: 'tablist' });
  const words = h('div', { class: 'slide-words' }, title, text);

  const show = (i, dir = 1) => {
    slide = (i + SLIDES.length) % SLIDES.length;
    art.innerHTML = `<svg viewBox="0 0 320 320" aria-hidden="true">${SLIDES[slide].art()}</svg>`;
    title.textContent = SLIDES[slide].title;
    text.textContent = SLIDES[slide].text;
    if (!reduced()) {
      art.firstChild.animate(
        [
          { opacity: 0, transform: `translateX(${dir * 28}px) scale(0.97)` },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 420, easing: EASE.decel },
      );
      words.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], {
        duration: 360,
        easing: EASE.decel,
      });
    }
    clear(dots);
    SLIDES.forEach((_, n) =>
      dots.appendChild(
        h('button', {
          class: 'dot' + (n === slide ? ' active' : ''),
          type: 'button',
          role: 'tab',
          'aria-selected': String(n === slide),
          'aria-label': `Slide ${n + 1}`,
          onclick: () => {
            show(n, n > slide ? 1 : -1);
            restart();
          },
        }),
      ),
    );
  };
  const restart = () => {
    clearInterval(timer);
    if (!reduced()) timer = setInterval(() => show(slide + 1, 1), 6000);
  };

  const prev = h('button', { class: 'icon-btn slide-nav', type: 'button', 'aria-label': 'Previous', onclick: () => (show(slide - 1, -1), restart()) }, icon('back'));
  const next = h('button', { class: 'icon-btn slide-nav next', type: 'button', 'aria-label': 'Next', onclick: () => (show(slide + 1, 1), restart()) }, icon('back'));
  const stage = h('div', { class: 'slide-stage' }, compact ? null : prev, art, compact ? null : next);
  const el = h('section', { class: 'home-carousel' + (compact ? ' compact' : ''), 'aria-label': 'About Handshake' }, stage, words, dots);

  // Swipe between slides on touch screens.
  let x0 = null;
  el.addEventListener('pointerdown', (e) => (x0 = e.clientX), { passive: true });
  el.addEventListener('pointerup', (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 40) {
      show(slide + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
      restart();
    }
  });
  el.addEventListener('mouseenter', () => clearInterval(timer));
  el.addEventListener('mouseleave', restart);

  show(0);
  restart();
  return { el, destroy: () => clearInterval(timer) };
}

function codeForm(app, { id, autofocus }) {
  const input = h('input', {
    id,
    class: 'code-input',
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: false,
    enterkeyhint: 'go',
    placeholder: 'Enter a code or link',
    'aria-label': 'Meeting code or link',
  });
  const error = h('p', { class: 'form-error', hidden: true, role: 'alert' });
  const submit = (e) => {
    e.preventDefault();
    const code = parseMeetingCode(input.value);
    if (!code) {
      error.textContent = 'That code is not complete. A meeting code has 24 letters and numbers.';
      error.hidden = false;
      input.focus();
      input.parentElement.classList.add('invalid');
      return false;
    }
    app.showPrejoin({ mode: 'join', code });
    return true;
  };
  input.addEventListener('input', () => {
    error.hidden = true;
    input.parentElement.classList.remove('invalid');
  });
  if (autofocus) setTimeout(() => input.focus(), 0);
  return { input, error, submit };
}

export function renderHome(root, app) {
  const mq = window.matchMedia('(max-width: 720px)');
  let current = null;
  let clockTimer = 0;
  let car = null;

  const build = () => {
    if (car) car.destroy();
    clearInterval(clockTimer);
    clear(root);
    root.className = 'view view-home';
    current = mq.matches ? buildPhone() : buildWide();
  };

  const header = (withClock) => {
    const clock = h('span', { class: 'clock' });
    if (withClock) {
      const tick = () => {
        const now = new Date();
        clock.textContent = `${now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}   ${now.toLocaleDateString([], {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })}`;
      };
      tick();
      clockTimer = setInterval(tick, 15000);
    }
    return h(
      'header',
      { class: 'topbar' },
      wordmark(),
      h(
        'div',
        { class: 'topbar-actions' },
        withClock ? clock : null,
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'How it works', title: 'How it works', onclick: () => app.openAbout() }, icon('help')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Settings', title: 'Settings', onclick: () => app.openSettings() }, icon('gear')),
      ),
    );
  };

  function buildWide() {
    const f = codeForm(app, { id: 'code', autofocus: true });
    const joinBtn = h('button', { class: 'btn btn-text', type: 'submit', disabled: true }, 'Join');
    f.input.addEventListener('input', () => (joinBtn.disabled = !f.input.value.trim()));
    const joinForm = h('form', { class: 'join-form', onsubmit: (e) => f.submit(e) }, h('label', { class: 'code-field' }, icon('keyboard'), f.input), joinBtn);
    const newBtn = h(
      'button',
      { class: 'btn btn-primary btn-lg', type: 'button', onclick: () => app.showPrejoin({ mode: 'new' }) },
      icon('newMeeting'),
      h('span', {}, 'New meeting'),
    );
    const h1 = h('h1', {}, 'Secure video meetings for everyone');
    const lede = h('p', { class: 'lede' }, 'End-to-end encrypted calls with screen sharing and chat. No account, no sign-up, and nothing is stored.');
    const actions = h('div', { class: 'home-actions' }, newBtn, joinForm);
    const rule = h('hr', { class: 'home-rule' });
    const more = h(
      'p',
      { class: 'home-more' },
      h('button', { class: 'link-btn', type: 'button', onclick: () => app.openAbout() }, 'Learn how Handshake protects your meetings'),
    );
    const intro = h('section', { class: 'home-intro' }, h1, lede, actions, f.error, rule, more);
    car = carousel();
    root.append(header(true), h('main', { class: 'home-main' }, intro, car.el));
    stagger([h1, lede, actions, rule, more], { delay: 70 });
    stagger([car.el], { start: 2 });
    return {
      setCode(code) {
        f.input.value = code;
        joinBtn.disabled = false;
      },
    };
  }

  function buildPhone() {
    car = carousel({ compact: true });
    const openJoin = () => {
      const f = codeForm(app, { id: 'code-m', autofocus: true });
      let s;
      const form = h(
        'form',
        {
          class: 'join-sheet',
          onsubmit: (e) => {
            if (f.submit(e)) s.close();
          },
        },
        h('p', { class: 'muted' }, 'Enter the meeting code or paste the invite link you received.'),
        h('label', { class: 'code-field wide' }, icon('keyboard'), f.input),
        f.error,
        h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, 'Join'),
      );
      s = sheet({ title: 'Join with a code', body: form });
      return f;
    };
    const newBtn = h(
      'button',
      { class: 'btn btn-primary btn-lg m-action', type: 'button', onclick: () => app.showPrejoin({ mode: 'new' }) },
      icon('newMeeting'),
      h('span', {}, 'New meeting'),
    );
    const joinBtn = h('button', { class: 'btn btn-secondary btn-lg m-action', type: 'button', onclick: () => openJoin() }, icon('keyboard'), h('span', {}, 'Join with a code'));
    const actions = h('div', { class: 'm-actions' }, newBtn, joinBtn);
    const foot = h('p', { class: 'm-foot' }, icon('lock'), h('span', {}, 'End-to-end encrypted. No account needed.'));
    root.append(header(false), h('main', { class: 'm-home' }, car.el, actions, foot));
    stagger([car.el, newBtn, joinBtn, foot], { delay: 70 });
    return {
      setCode(code) {
        const f = openJoin();
        f.input.value = code;
      },
    };
  }

  mq.addEventListener('change', build);
  build();

  return {
    isHome: true,
    setCode(code) {
      if (current) current.setCode(code);
    },
    destroy() {
      mq.removeEventListener('change', build);
      clearInterval(clockTimer);
      if (car) car.destroy();
    },
  };
}
