// Toasts, dialogs and pop-up menus.

import { h, clear } from './dom.js';
import { icon } from './icons.js';

let toastRoot;

export function toast(text, opts = {}) {
  if (!toastRoot) {
    toastRoot = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastRoot);
  }
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
              node.remove();
            },
          },
          opts.action.label,
        )
      : null,
  );
  toastRoot.appendChild(node);
  const max = window.innerWidth <= 720 ? 2 : 3;
  while (toastRoot.children.length > max) toastRoot.firstChild.remove();
  setTimeout(() => node.remove(), opts.timeout || 4500);
  return node;
}

let openDialog = null;

export function dialog({ title, body, actions = [], wide = false, onClose, dismissable = true }) {
  closeDialog();
  const previous = document.activeElement;
  const close = () => {
    if (!backdrop.isConnected) return;
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    if (openDialog === api) openDialog = null;
    if (onClose) onClose();
    if (previous && previous.focus) previous.focus();
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

let openMenu = null;

/**
 * @param {HTMLElement} anchor
 * @param {Array<{label:string, icon?:string, run:()=>void, checked?:boolean, danger?:boolean, hint?:string}|'-'>} items
 */
export function menu(anchor, items, { align = 'center', above = true } = {}) {
  closeMenu();
  const list = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (it === '-') {
      list.appendChild(h('div', { class: 'menu-sep', role: 'separator' }));
      continue;
    }
    if (!it) continue;
    list.appendChild(
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
  document.body.appendChild(list);
  const r = anchor.getBoundingClientRect();
  const mw = list.offsetWidth;
  const mh = list.offsetHeight;
  let left = align === 'end' ? r.right - mw : align === 'start' ? r.left : r.left + r.width / 2 - mw / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
  let top = above ? r.top - mh - 8 : r.bottom + 8;
  if (top < 8) top = r.bottom + 8;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 8);
  list.style.left = left + 'px';
  list.style.top = top + 'px';
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
      list.remove();
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('touchstart', onDown, true);
      document.removeEventListener('keydown', onKey, true);
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
  box.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8)) + 'px';
  box.style.top = Math.max(8, r.top - ht - 8) + 'px';
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
      box.remove();
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    },
    list: box,
  };
  if (opts.autoclose) box.addEventListener('click', (e) => e.target.closest('button') && closeMenu());
  return openMenu;
}

export { clear };
