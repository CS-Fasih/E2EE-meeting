// Toasts, dialogs, menus and bottom sheets, with enter and exit motion.

import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { leave, dragToDismiss, reduced } from './motion.js';

const isNarrow = () => window.innerWidth <= 720;

let toastRoot;

export function toast(text, opts = {}) {
  if (!toastRoot) {
    toastRoot = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastRoot);
  }
  const dismiss = () => {
    if (!node.isConnected || node.classList.contains('out')) return;
    node.classList.add('out');
    if (reduced()) node.remove();
    else node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 400);
  };
  const node = h(
    'div',
    { class: 'toast' + (opts.kind ? ' toast-' + opts.kind : '') },
    h('span', { class: 'toast-text' }, text),
    opts.action
      ? h(
          'button',
          {
            class: 'btn btn-quiet btn-small',
            onclick: () => {
              opts.action.run();
              dismiss();
            },
          },
          opts.action.label,
        )
      : null,
  );
  toastRoot.appendChild(node);
  const live = [...toastRoot.children].filter((n) => !n.classList.contains('out'));
  const max = isNarrow() ? 2 : 3;
  live.slice(0, Math.max(0, live.length - max)).forEach((n) => n.remove());
  setTimeout(dismiss, opts.timeout || 4500);
  return node;
}

let openDialog = null;

export function dialog({ title, body, actions = [], wide = false, onClose, dismissable = true }) {
  closeDialog();
  const previous = document.activeElement;
  let closing = false;
  const close = () => {
    if (closing || !backdrop.isConnected) return;
    closing = true;
    document.removeEventListener('keydown', onKey, true);
    if (openDialog === api) openDialog = null;
    backdrop.classList.add('closing');
    const done = () => backdrop.remove();
    if (reduced()) done();
    else {
      box.addEventListener('animationend', done, { once: true });
      setTimeout(done, 300);
    }
    if (onClose) onClose();
    if (previous && previous.focus && previous.isConnected) previous.focus();
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && dismissable) {
      e.stopPropagation();
      close();
    }
  };
  const box = h(
    'div',
    { class: 'dialog' + (wide ? ' dialog-wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h(
      'div',
      { class: 'dialog-head' },
      h('h2', {}, title),
      dismissable ? h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon('close')) : null,
    ),
    h('div', { class: 'dialog-body' }, body),
    actions.length
      ? h(
          'div',
          { class: 'dialog-actions' },
          actions.map((a) =>
            h(
              'button',
              {
                class: 'btn ' + (a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger' : 'btn-quiet'),
                onclick: async () => {
                  const keep = a.onClick ? await a.onClick() : false;
                  if (keep !== true) close();
                },
              },
              a.label,
            ),
          ),
        )
      : null,
  );
  const backdrop = h('div', {
    class: 'backdrop',
    onmousedown: (e) => {
      if (e.target === backdrop && dismissable) close();
    },
  });
  backdrop.appendChild(box);
  document.body.appendChild(backdrop);
  document.addEventListener('keydown', onKey, true);
  // Focus the first field or the main action, never the close button.
  const focusable = box.querySelector('.dialog-body input, .dialog-body select, .dialog-body textarea, .dialog-actions .btn-primary');
  box.tabIndex = -1;
  setTimeout(() => (focusable || box).focus(), 0);
  const api = { close, box };
  openDialog = api;
  return api;
}

export function closeDialog() {
  if (openDialog) openDialog.close();
}

/**
 * Bottom sheet (phones). Slides up, can be dragged down to close.
 */
export function sheet({ title, body, onClose, className = '' }) {
  closeMenu();
  const previous = document.activeElement;
  let closing = false;
  const handle = h('div', { class: 'sheet-handle', 'aria-hidden': 'true' }, h('span'));
  const box = h(
    'div',
    { class: 'sheet ' + className, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Options', tabindex: '-1' },
    handle,
    title ? h('h2', { class: 'sheet-title' }, title) : null,
    h('div', { class: 'sheet-body' }, body),
  );
  const scrim = h('div', { class: 'sheet-scrim' });
  const close = () => {
    if (closing) return;
    closing = true;
    document.removeEventListener('keydown', onKey, true);
    scrim.classList.add('closing');
    box.classList.add('closing');
    const done = () => {
      scrim.remove();
      box.remove();
    };
    if (reduced()) done();
    else {
      box.addEventListener('animationend', done, { once: true });
      setTimeout(done, 350);
    }
    if (onClose) onClose();
    if (previous && previous.focus && previous.isConnected) previous.focus();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  document.body.append(scrim, box);
  dragToDismiss(box, handle, close);
  const first = box.querySelector('input, .sheet-body button');
  setTimeout(() => (first && first.tagName === 'INPUT' ? first : box).focus(), 0);
  const api = { close, box };
  openMenu = api;
  return api;
}

let openMenu = null;

/**
 * @param {HTMLElement} anchor
 * @param {Array<{label:string, icon?:string, run:()=>void, checked?:boolean, danger?:boolean, hint?:string}|'-'>} items
 */
export function menu(anchor, items, { align = 'center', above = true } = {}) {
  closeMenu();
  const buttons = [];
  for (const it of items) {
    if (it === '-') {
      buttons.push(h('div', { class: 'menu-sep', role: 'separator' }));
      continue;
    }
    if (!it) continue;
    buttons.push(
      h(
        'button',
        {
          class: 'menu-item' + (it.danger ? ' danger' : ''),
          role: 'menuitem',
          onclick: () => {
            closeMenu();
            it.run();
          },
        },
        it.icon ? icon(it.icon) : h('span', { class: 'ico' }),
        h('span', { class: 'menu-label' }, it.label),
        it.hint ? h('span', { class: 'menu-hint' }, it.hint) : null,
        it.checked ? icon('check', 'ico menu-check') : null,
      ),
    );
  }
  // On phones, options open as a bottom sheet like native apps.
  if (isNarrow()) {
    return sheet({ body: h('div', { class: 'sheet-menu', role: 'menu' }, buttons) });
  }
  const list = h('div', { class: 'menu', role: 'menu' }, buttons);
  document.body.appendChild(list);
  const r = anchor.getBoundingClientRect();
  const mw = list.offsetWidth;
  const mh = list.offsetHeight;
  let left = align === 'end' ? r.right - mw : align === 'start' ? r.left : r.left + r.width / 2 - mw / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
  let top = above ? r.top - mh - 8 : r.bottom + 8;
  let fromBelow = above;
  if (top < 8) {
    top = r.bottom + 8;
    fromBelow = false;
  }
  if (top + mh > window.innerHeight - 8) {
    top = Math.max(8, r.top - mh - 8);
    fromBelow = true;
  }
  list.style.left = left + 'px';
  list.style.top = top + 'px';
  list.style.transformOrigin = `${Math.min(mw, Math.max(0, r.left + r.width / 2 - left))}px ${fromBelow ? '100%' : '0'}`;
  const onDown = (e) => {
    if (!list.contains(e.target) && !anchor.contains(e.target)) closeMenu();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') closeMenu();
  };
  setTimeout(() => {
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('touchstart', onDown, true);
  }, 0);
  document.addEventListener('keydown', onKey, true);
  const first = list.querySelector('button');
  if (first) first.focus();
  openMenu = {
    close() {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('touchstart', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      leave(list, [{ opacity: 1 }, { opacity: 0, transform: 'scale(0.96)' }], 120);
      if (anchor.focus) anchor.focus();
    },
    list,
  };
  return openMenu;
}

export function closeMenu() {
  if (openMenu) {
    const m = openMenu;
    openMenu = null;
    m.close();
  }
}

export function popover(anchor, content, opts = {}) {
  closeMenu();
  const box = h('div', { class: 'menu popover' }, content);
  document.body.appendChild(box);
  const r = anchor.getBoundingClientRect();
  const w = box.offsetWidth;
  const ht = box.offsetHeight;
  const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
  box.style.left = left + 'px';
  box.style.top = Math.max(8, r.top - ht - 8) + 'px';
  box.style.transformOrigin = `${r.left + r.width / 2 - left}px 100%`;
  const onDown = (e) => {
    if (!box.contains(e.target) && !anchor.contains(e.target)) closeMenu();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') closeMenu();
  };
  setTimeout(() => document.addEventListener('mousedown', onDown, true), 0);
  document.addEventListener('keydown', onKey, true);
  openMenu = {
    close() {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      leave(box, [{ opacity: 1 }, { opacity: 0, transform: 'scale(0.94)' }], 120);
    },
    list: box,
  };
  if (opts.autoclose) box.addEventListener('click', (e) => e.target.closest('button') && closeMenu());
  return openMenu;
}

export { clear };
