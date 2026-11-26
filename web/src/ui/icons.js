// Hand-drawn 24px stroke icons. Static, trusted markup.

const svg = (body, extra = '') =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

export const icons = {
  mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/>'),
  micOff: svg(
    '<path d="M15 9.4V6a3 3 0 0 0-5.8-1"/><path d="M9 9v2a3 3 0 0 0 4.6 2.5"/><path d="M5.5 11a6.5 6.5 0 0 0 10.4 5.2"/><path d="M18.5 11a6.4 6.4 0 0 1-.6 2.7"/><path d="M12 17.5V21"/><path d="M3.5 3.5l17 17"/>',
  ),
  cam: svg('<rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="M15.5 10.5l6-3.5v10l-6-3.5"/>'),
  camOff: svg(
    '<path d="M9 6h4a2.5 2.5 0 0 1 2.5 2.5V12"/><path d="M15.5 10.5l6-3.5v10l-4.2-2.4"/><path d="M15.5 15.5a2.5 2.5 0 0 1-2.5 2.5H5a2.5 2.5 0 0 1-2.5-2.5v-7A2.5 2.5 0 0 1 4.6 6"/><path d="M3 3l18 18"/>',
  ),
  screen: svg('<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8.5 21h7M12 17v4"/><path d="M12 13.5V7.5M9.3 10.2 12 7.5l2.7 2.7"/>'),
  screenOff: svg('<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8.5 21h7M12 17v4"/><path d="M9.5 8l5 5M14.5 8l-5 5"/>'),
  hand: svg(
    '<path d="M8 12.5V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5"/><path d="M14 10.5V5.5a1.5 1.5 0 0 1 3 0V14"/><path d="M8 12V9.5a1.5 1.5 0 0 0-3 0v4.5a7 7 0 0 0 7 7h.5A4.5 4.5 0 0 0 17 16.5V14"/>',
  ),
  smile: svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.4"/>'),
  chat: svg('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5z"/>'),
  people: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M15.5 4.8a3.5 3.5 0 0 1 0 6.4"/><path d="M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>'),
  shield: svg('<path d="M12 2.8 4.5 5.6v5.6c0 4.6 3.1 8.4 7.5 10 4.4-1.6 7.5-5.4 7.5-10V5.6z"/><path d="M8.8 11.8l2.3 2.3 4.2-4.4"/>'),
  lock: svg('<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>'),
  unlock: svg('<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 7.7-1.5"/>'),
  more: svg('<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>', ''),
  leave: svg(
    '<path d="M3.2 13.6c4.9-4.4 12.7-4.4 17.6 0l-1.9 3a1 1 0 0 1-1.3.4l-2.6-1.3a1 1 0 0 1-.5-1v-1.8a11 11 0 0 0-5 0v1.8a1 1 0 0 1-.5 1l-2.6 1.3a1 1 0 0 1-1.3-.4z"/>',
  ),
  gear: svg(
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  ),
  copy: svg('<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>'),
  share: svg('<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M5 12.5v6A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5v-6"/>'),
  record: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>'),
  pin: svg('<path d="M9 3.5h6l-1 5.5 3.5 3.5v1.5h-11V12.5L10 9z"/><path d="M12 14v6.5"/>'),
  pip: svg('<rect x="2.5" y="4.5" width="19" height="15" rx="2"/><rect x="12" y="11.5" width="7" height="5.5" rx="1" fill="currentColor" stroke="none"/>'),
  clip: svg('<path d="M20.5 11.5 12.4 19.6a5 5 0 0 1-7-7l8.3-8.3a3.3 3.3 0 0 1 4.7 4.7l-8.3 8.3a1.7 1.7 0 0 1-2.3-2.3l7.6-7.6"/>'),
  send: svg('<path d="M4 12 20 4l-4.5 16-3.8-6.7z"/><path d="M11.7 13.3 20 4"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  check: svg('<path d="M4.5 12.5l4.5 4.5L19.5 6.5"/>'),
  grid: svg('<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>'),
  spotlight: svg('<rect x="3" y="3" width="18" height="12" rx="1.5"/><rect x="3" y="17.5" width="5" height="3.5" rx="1"/><rect x="9.5" y="17.5" width="5" height="3.5" rx="1"/><rect x="16" y="17.5" width="5" height="3.5" rx="1"/>'),
  expand: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  keyboard: svg('<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7 14h10"/>'),
  download: svg('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19.5h14"/>'),
  speaker: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  earpiece: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5"/>'),
  warn: svg('<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.5h.01"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 20.5a8 8 0 0 1 16 0"/>'),
  door: svg('<path d="M5 21V8.5C5 5 8 3 12 3s7 2 7 5.5V21"/><path d="M3 21h18"/><path d="M14.5 13.5h.01" stroke-width="2.4"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
};

/** Builds an element containing an icon. */
export function icon(name, cls = 'ico') {
  const span = document.createElement('span');
  span.className = cls;
  span.innerHTML = icons[name] || '';
  return span;
}
