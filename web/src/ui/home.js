// Landing page: start a new meeting or join one with a code.

import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { wordmark } from './brand.js';
import { parseMeetingCode } from '../lib/crypto.js';

const SLIDES = [
  {
    title: 'Get a code you can share',
    text: 'Click New meeting to get a code, then send it to the people you want to meet.',
    art: () => `
      <circle class="il-bg" cx="160" cy="160" r="150"/>
      <rect class="il-card" x="52" y="92" width="216" height="92" rx="14"/>
      <circle class="il-accent-soft" cx="88" cy="126" r="16"/>
      <path class="il-accent" d="M81 126a7 7 0 0 1 7-7h4v4h-4a3 3 0 0 0 0 6h4v4h-4a7 7 0 0 1-7-7Zm14-7h4a7 7 0 0 1 0 14h-4v-4h4a3 3 0 0 0 0-6h-4Zm-9 5h10v4H86Z"/>
      <rect class="il-line" x="114" y="118" width="120" height="8" rx="4"/>
      <rect class="il-line-soft" x="114" y="132" width="82" height="8" rx="4"/>
      <rect class="il-accent" x="176" y="156" width="74" height="18" rx="9"/>
      <rect class="il-on-accent" x="190" y="163" width="46" height="4" rx="2"/>
      <circle class="il-p1" cx="118" cy="232" r="26"/>
      <circle class="il-p2" cx="160" cy="232" r="26"/>
      <circle class="il-p3" cx="202" cy="232" r="26"/>
      <circle class="il-card" cx="118" cy="226" r="8"/><path class="il-card" d="M102 248a16 12 0 0 1 32 0Z"/>
      <circle class="il-card" cx="160" cy="226" r="8"/><path class="il-card" d="M144 248a16 12 0 0 1 32 0Z"/>
      <circle class="il-card" cx="202" cy="226" r="8"/><path class="il-card" d="M186 248a16 12 0 0 1 32 0Z"/>`,
  },
  {
    title: 'Your meeting is end-to-end encrypted',
    text: 'Voice, video, chat and files are locked on your device. Only the people in the call can unlock them.',
    art: () => `
      <circle class="il-bg" cx="160" cy="160" r="150"/>
      <rect class="il-tile" x="62" y="82" width="94" height="68" rx="10"/>
      <rect class="il-tile" x="164" y="82" width="94" height="68" rx="10"/>
      <rect class="il-tile" x="62" y="158" width="94" height="68" rx="10"/>
      <rect class="il-tile" x="164" y="158" width="94" height="68" rx="10"/>
      <circle class="il-p1" cx="109" cy="110" r="14"/><circle class="il-p2" cx="211" cy="110" r="14"/>
      <circle class="il-p3" cx="109" cy="186" r="14"/><circle class="il-p4" cx="211" cy="186" r="14"/>
      <path class="il-shield" d="M160 150l46 17v33c0 30-20 52-46 62-26-10-46-32-46-62v-33z"/>
      <rect class="il-on-accent" x="145" y="198" width="30" height="24" rx="4"/>
      <path class="il-lock" d="M151 198v-7a9 9 0 0 1 18 0v7" fill="none" stroke-width="5"/>`,
  },
  {
    title: 'No account. Nothing stored.',
    text: 'Devices connect directly to each other. There is no sign-up, and the chat is gone when the call ends.',
    art: () => `
      <circle class="il-bg" cx="160" cy="160" r="150"/>
      <rect class="il-device" x="44" y="104" width="128" height="84" rx="8"/>
      <rect class="il-tile" x="52" y="112" width="112" height="68" rx="4"/>
      <path class="il-device" d="M32 196h152l-8 10H40Z"/>
      <rect class="il-device" x="214" y="98" width="68" height="120" rx="12"/>
      <rect class="il-tile" x="220" y="108" width="56" height="96" rx="6"/>
      <circle class="il-p2" cx="108" cy="146" r="16"/>
      <circle class="il-p1" cx="248" cy="148" r="14"/>
      <path class="il-dash" d="M120 238c30 24 80 24 110-6" fill="none" stroke-width="4" stroke-dasharray="2 10" stroke-linecap="round"/>
      <circle class="il-accent" cx="174" cy="252" r="18"/>
      <rect class="il-on-accent" x="166" y="250" width="16" height="12" rx="2"/>
      <path class="il-lock-small" d="M169 250v-4a5 5 0 0 1 10 0v4" fill="none" stroke-width="3"/>`,
  },
];

export function renderHome(root, app) {
  clear(root);
  root.className = 'view view-home';

  const clock = h('span', { class: 'clock' });
  const tick = () => {
    const now = new Date();
    clock.textContent = `${now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}   ${now.toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })}`;
  };
  tick();
  const clockTimer = setInterval(tick, 15000);

  const header = h(
    'header',
    { class: 'topbar' },
    wordmark(),
    h(
      'div',
      { class: 'topbar-actions' },
      clock,
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'How it works', title: 'How it works', onclick: () => app.openAbout() }, icon('help')),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Settings', title: 'Settings', onclick: () => app.openSettings() }, icon('gear')),
    ),
  );

  const codeInput = h('input', {
    id: 'code',
    class: 'code-input',
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: false,
    placeholder: 'Enter a code or link',
    'aria-label': 'Meeting code or link',
  });
  const joinBtn = h('button', { class: 'btn btn-text', type: 'submit', disabled: true }, 'Join');
  const error = h('p', { class: 'form-error', hidden: true, role: 'alert' });
  codeInput.addEventListener('input', () => {
    joinBtn.disabled = !codeInput.value.trim();
    error.hidden = true;
  });

  const joinForm = h(
    'form',
    {
      class: 'join-form',
      onsubmit: (e) => {
        e.preventDefault();
        const code = parseMeetingCode(codeInput.value);
        if (!code) {
          error.textContent = 'That code is not complete. A meeting code has 24 letters and numbers.';
          error.hidden = false;
          codeInput.focus();
          return;
        }
        app.showPrejoin({ mode: 'join', code });
      },
    },
    h('label', { class: 'code-field' }, icon('keyboard'), codeInput),
    joinBtn,
  );

  const newBtn = h(
    'button',
    { class: 'btn btn-primary btn-lg', type: 'button', onclick: () => app.showPrejoin({ mode: 'new' }) },
    icon('newMeeting'),
    h('span', {}, 'New meeting'),
  );

  const intro = h(
    'section',
    { class: 'home-intro' },
    h('h1', {}, 'Secure video meetings for everyone'),
    h(
      'p',
      { class: 'lede' },
      'End-to-end encrypted calls with screen sharing and chat. No account, no sign-up, and nothing is stored.',
    ),
    h('div', { class: 'home-actions' }, newBtn, joinForm),
    error,
    h('hr', { class: 'home-rule' }),
    h(
      'p',
      { class: 'home-more' },
      h('button', { class: 'link-btn', type: 'button', onclick: () => app.openAbout() }, 'Learn how Handshake protects your meetings'),
    ),
  );

  // Illustration carousel
  let slide = 0;
  const art = h('div', { class: 'slide-art' });
  const title = h('h2', { class: 'slide-title' });
  const text = h('p', { class: 'slide-text' });
  const dots = h('div', { class: 'slide-dots', role: 'tablist' });
  const show = (i) => {
    slide = (i + SLIDES.length) % SLIDES.length;
    art.innerHTML = `<svg viewBox="0 0 320 320" aria-hidden="true">${SLIDES[slide].art()}</svg>`;
    title.textContent = SLIDES[slide].title;
    text.textContent = SLIDES[slide].text;
    clear(dots);
    SLIDES.forEach((_, n) =>
      dots.appendChild(
        h('button', {
          class: 'dot' + (n === slide ? ' active' : ''),
          type: 'button',
          role: 'tab',
          'aria-selected': String(n === slide),
          'aria-label': `Slide ${n + 1}`,
          onclick: () => show(n),
        }),
      ),
    );
  };
  const carousel = h(
    'section',
    { class: 'home-carousel', 'aria-label': 'About Handshake' },
    h(
      'div',
      { class: 'slide-stage' },
      h('button', { class: 'icon-btn slide-nav', type: 'button', 'aria-label': 'Previous', onclick: () => show(slide - 1) }, icon('back')),
      art,
      h('button', { class: 'icon-btn slide-nav next', type: 'button', 'aria-label': 'Next', onclick: () => show(slide + 1) }, icon('back')),
    ),
    title,
    text,
    dots,
  );
  show(0);

  root.append(header, h('main', { class: 'home-main' }, intro, carousel));
  setTimeout(() => codeInput.focus(), 0);

  return {
    isHome: true,
    setCode(code) {
      codeInput.value = code;
      joinBtn.disabled = false;
    },
    destroy() {
      clearInterval(clockTimer);
    },
  };
}
