import { h, clear, formatBytes, timeOfDay } from './dom.js';
import { icon } from './icons.js';
import { toast } from './overlay.js';
import { platform } from '../lib/platform.js';

export function chatPanel(app, meeting) {
  const list = h('div', { class: 'chat-list', role: 'log', 'aria-live': 'polite' });
  const input = h('textarea', {
    class: 'chat-input',
    rows: 1,
    maxlength: 4000,
    placeholder: 'Message everyone',
    'aria-label': 'Message everyone',
  });
  const attach = h('button', { class: 'icon-btn', type: 'button', title: 'Share a file', 'aria-label': 'Share a file' }, icon('clip'));
  const send = h('button', { class: 'icon-btn send', type: 'submit', title: 'Send', 'aria-label': 'Send' }, icon('send'));
  const form = h('form', { class: 'chat-form' }, attach, input, send);
  const note = h('p', { class: 'chat-note' }, 'Messages go straight to the people in this meeting and disappear when it ends. People who join later will not see them.');
  const el = h('div', { class: 'panel-body chat' }, list, form);
  const fileNodes = new Map();
  let lastFrom = null;

  function grow() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  }
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value;
    if (!text.trim()) return;
    if (!meeting.connected.length) {
      toast('There is no one to send to yet.');
      return;
    }
    meeting.sendChat(text);
    input.value = '';
    grow();
  });
  attach.addEventListener('click', () => {
    const fi = h('input', { type: 'file', hidden: true });
    fi.addEventListener('change', () => {
      const f = fi.files && fi.files[0];
      fi.remove();
      if (!f) return;
      if (!meeting.connected.length) return toast('There is no one to share with yet.');
      if (!meeting.shareFile(f)) toast('Files up to 512 MB can be shared.');
    });
    document.body.appendChild(fi);
    fi.click();
  });

  function renderAll() {
    clear(list);
    lastFrom = null;
    list.appendChild(note);
    for (const m of meeting.chat) list.appendChild(item(m));
    list.scrollTop = list.scrollHeight;
  }

  function item(m) {
    const grouped = lastFrom === m.from;
    lastFrom = m.from;
    const head = grouped
      ? null
      : h('div', { class: 'msg-head' }, h('strong', {}, m.mine ? 'You' : m.name), h('span', { class: 'muted' }, timeOfDay(m.at)));
    if (m.file) {
      const status = h('span', { class: 'file-status muted' }, formatBytes(m.file.size));
      const action = m.mine
        ? h('span', { class: 'muted' }, 'Shared by you')
        : h('button', { class: 'btn btn-quiet btn-small', type: 'button' }, icon('download'), h('span', {}, 'Download'));
      const bar = h('span', { class: 'file-bar', hidden: true }, h('span', {}));
      if (!m.mine) {
        action.addEventListener('click', () => {
          if (meeting.requestFile(m.file.fid, m.from)) {
            action.disabled = true;
            bar.hidden = false;
            status.textContent = 'Starting';
          } else toast(`${m.name} has left, so the file is no longer available.`);
        });
      }
      fileNodes.set(m.file.fid, { status, action, bar, meta: m.file });
      return h(
        'div',
        { class: 'msg' + (m.mine ? ' mine' : '') + (grouped ? ' grouped' : '') },
        head,
        h('div', { class: 'file-card' }, icon('clip'), h('div', { class: 'file-info' }, h('span', { class: 'file-name' }, m.file.name), status, bar), action),
      );
    }
    return h('div', { class: 'msg' + (m.mine ? ' mine' : '') + (grouped ? ' grouped' : '') }, head, h('p', { class: 'msg-text' }, m.text));
  }

  const onChat = (e) => {
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    list.appendChild(item(e.detail));
    if (atBottom || e.detail.mine) list.scrollTop = list.scrollHeight;
  };
  const onProgress = async (e) => {
    const d = e.detail;
    const n = fileNodes.get(d.fid);
    if (!n) return;
    const pct = d.size ? Math.round((100 * d.received) / d.size) : 100;
    n.bar.firstChild.style.width = pct + '%';
    n.status.textContent = d.done ? 'Received' : `${pct}% of ${formatBytes(d.size)}`;
    if (d.done && d.blob) {
      n.bar.hidden = true;
      const where = await platform.saveFile(d.blob, n.meta.name);
      n.status.textContent = where ? 'Saved' : 'Could not save';
      n.action.disabled = false;
    }
  };
  meeting.addEventListener('chat', onChat);
  meeting.addEventListener('file-progress', onProgress);
  renderAll();

  return {
    title: 'Chat',
    el,
    show() {
      list.scrollTop = list.scrollHeight;
      setTimeout(() => input.focus(), 0);
    },
    hide() {},
    destroy() {
      meeting.removeEventListener('chat', onChat);
      meeting.removeEventListener('file-progress', onProgress);
    },
  };
}
