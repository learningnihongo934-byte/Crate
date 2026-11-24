import { h, toast, openInSpotify } from '../util.js';
import { head, sectionTitle } from '../ui.js';
import { artEl } from '../art.js';
import { picker } from '../picker.js';
import { np, startPolling, isNative, canSee } from '../nowplaying.js';
import * as sp from '../spotify.js';

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => [...crypto.getRandomValues(new Uint8Array(5))].map((b) => ALPHA[b % ALPHA.length]).join('');
const myName = () => localStorage.getItem('crate.name') || '';

export function render(page, { args }) {
  const code = (args[0] || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (!code || code.length < 4) return lobby(page);
  if (!myName()) return askName(page, code);
  return room(page, code);
}

function lobby(page) {
  const join = h('input', { type: 'text', placeholder: 'Room code', maxLength: 8, style: { textTransform: 'uppercase', width: '160px' } });
  page.replaceChildren(
    head('Listen', 'Rooms', 'Listen with friends. Everyone sees what the others are playing, builds one shared queue, and can start a countdown so the whole room presses play together. Guests don\'t need Crate or a Spotify login.'),
    h('div.three', {},
      h('div.panel', {}, h('h3', {}, 'Start a room'), h('p', {}, 'You get a code and a link to send.'),
        h('button.btn.solid', { onclick: () => (location.hash = '#/rooms/' + newCode()) }, 'Create room')),
      h('div.panel', {}, h('h3', {}, 'Join a room'), h('p', {}, 'Enter the code someone sent you.'),
        h('form.row', { onsubmit: (e) => { e.preventDefault(); const c = join.value.trim().toUpperCase(); if (c.length >= 4) location.hash = '#/rooms/' + c; } },
          join, h('button.btn', {}, 'Join'))),
      h('div.panel', {}, h('h3', {}, 'How playing works'), h('p', {}, 'With the Crate Mac app, a Drop starts the song in everyone\'s Spotify automatically after a 4-second countdown. On the web, each person taps Play when the countdown ends.'))));
}

function askName(page, code) {
  const input = h('input', { type: 'text', maxLength: 30, placeholder: 'Your name', value: JSON.parse(localStorage.getItem('crate.me') || 'null')?.name || '' });
  page.replaceChildren(head(`Room ${code}`, 'Pick a name'),
    h('form.row', { onsubmit: (e) => { e.preventDefault(); if (!input.value.trim()) return; localStorage.setItem('crate.name', input.value.trim()); render(page, { args: [code] }); } },
      input, h('button.btn.solid', {}, 'Enter room')));
  input.focus();
}

function room(page, code) {
  let ws = null, closed = false, retry = 0, pingIv = null;
  let me = '', members = [], queue = [], chat = [];
  let manualNp = null;
  const status = h('span.mono.dim', { style: { fontSize: '12px' } }, 'connecting…');
  const membersEl = h('div');
  const queueEl = h('div');
  const chatLog = h('div.chat-log');
  const chatIn = h('input', { type: 'text', placeholder: 'Say something', maxLength: 300 });
  const link = `${location.origin}/#/rooms/${code}`;

  const send = (m) => ws?.readyState === 1 && ws.send(JSON.stringify(m));

  const connect = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/room/${code}`);
    ws.onopen = () => {
      retry = 0;
      status.textContent = 'connected';
      send({ type: 'hello', name: myName() });
      shareNp(true);
      clearInterval(pingIv);
      pingIv = setInterval(() => ws?.readyState === 1 && ws.send('ping'), 30000);
    };
    ws.onmessage = (e) => {
      if (e.data === 'pong') return;
      const m = JSON.parse(e.data);
      if (m.type === 'welcome') { me = m.you; members = m.members; queue = m.queue; chat = m.chat; drawAll(); }
      if (m.type === 'members') { members = m.members; drawMembers(); }
      if (m.type === 'queue') { queue = m.queue; drawQueue(); }
      if (m.type === 'chat') { chat.push(m.line); drawChat(); }
      if (m.type === 'drop') dropOverlay(m);
    };
    ws.onclose = () => {
      clearInterval(pingIv);
      if (closed) return;
      status.textContent = 'reconnecting…';
      setTimeout(connect, Math.min(10000, 800 * 2 ** retry++));
    };
  };

  let lastNp = '';
  const shareNp = (force) => {
    const t = np.item ? { id: np.item.id, name: np.item.name, artist: np.item.artist, art: np.item.art } : manualNp;
    const key = t ? t.id + t.name : '';
    if (!force && key === lastNp) return;
    lastNp = key;
    send({ type: 'np', track: t });
  };

  const drawMembers = () => {
    membersEl.replaceChildren(sectionTitle('01', 'In the room', String(members.length)),
      ...members.map((m) => h('div.member', {},
        m.np ? artEl({ ...m.np }) : h('div.art', {}, h('span.mono', {}, m.name.slice(0, 2).toUpperCase())),
        h('div', { style: { minWidth: 0 } },
          h('div.nm', {}, m.name, m.id === me ? h('span.pill', {}, 'you') : null),
          h('div.pl', {}, m.np ? `${m.np.name}${m.np.artist ? ' · ' + m.np.artist : ''}` : 'Not sharing a song'),
          m.np && m.id !== me ? h('div.row', { style: { gap: '4px', marginTop: '4px' } },
            h('button.btn.small', { onclick: () => openInSpotify(m.np) }, 'Jump in'),
            h('button.btn.ghost.small', { onclick: () => send({ type: 'add', track: m.np }) }, '+ Queue')) : null))));
    if (!canSee()) {
      membersEl.append(h('div', { style: { marginTop: '18px' } },
        h('div.eyebrow', {}, 'What are you playing?'),
        picker((t) => { manualNp = t; shareNp(true); }, 'Search or paste a link'),
        manualNp ? h('button.btn.ghost.small', { onclick: () => { manualNp = null; shareNp(true); drawMembers(); } }, 'Stop sharing') : null));
    } else membersEl.append(h('p.note', {}, 'Your Spotify playback is shared automatically.'));
  };

  const drawQueue = () => {
    queueEl.replaceChildren(sectionTitle('02', 'Shared queue', `${queue.length} songs`),
      h('div.list', {}, queue.length ? queue.map((t, i) => h('div.li', {},
        h('span.rk', {}, i + 1), artEl(t),
        h('div.tt', {}, h('div.t1', {}, t.name), h('div.t2', {}, `${t.artist ? t.artist + ' · ' : ''}added by ${t.by}`)),
        h('div.row', { style: { gap: '2px' } },
          h('button.btn.ghost.small', { onclick: () => send({ type: 'move', key: t.key, dir: -1 }), 'aria-label': 'Move up' }, '↑'),
          h('button.btn.ghost.small', { onclick: () => send({ type: 'move', key: t.key, dir: 1 }), 'aria-label': 'Move down' }, '↓')),
        h('button.btn.small', { onclick: () => openInSpotify(t) }, 'Play'),
        h('div.row', { style: { gap: '2px' } },
          h('button.btn.small.solid', { onclick: () => { send({ type: 'drop', track: t }); send({ type: 'remove', key: t.key }); }, title: 'Countdown, then everyone plays it' }, 'Drop'),
          h('button.btn.ghost.small', { onclick: () => send({ type: 'remove', key: t.key }) }, '×'))))
        : h('div.empty-line', {}, 'Nothing queued. Add a song below, then hit Drop to play it together.')),
      h('div', { style: { marginTop: '16px' } }, picker((t) => send({ type: 'add', track: t }), 'Add to the shared queue: search or paste a link')));
  };

  const drawChat = () => {
    chatLog.replaceChildren(...chat.map((l) => h('div', {}, h('span.who', {}, l.name), l.text)));
    chatLog.scrollTop = chatLog.scrollHeight;
  };

  const drawAll = () => { drawMembers(); drawQueue(); drawChat(); };

  page.replaceChildren(
    head('Room', h('span.code-big', {}, code), null,
      h('div.row', {}, status,
        h('button.btn', { onclick: () => navigator.clipboard.writeText(link).then(() => toast('Invite link copied')) }, 'Copy invite link'),
        h('button.btn.ghost', { onclick: () => { localStorage.removeItem('crate.name'); location.hash = '#/rooms'; } }, 'Leave'))),
    h('div.room', {}, membersEl, queueEl,
      h('div.chat-col', {}, sectionTitle('03', 'Chat'),
        h('div.chat', {}, chatLog,
          h('form', { onsubmit: (e) => { e.preventDefault(); const t = chatIn.value.trim(); if (t) send({ type: 'chat', text: t }); chatIn.value = ''; } }, chatIn)))));
  drawAll();
  connect();
  if (canSee()) startPolling();
  const onNp = () => shareNp(false);
  window.addEventListener('crate:np', onNp);
  return () => {
    closed = true;
    clearInterval(pingIv);
    window.removeEventListener('crate:np', onNp);
    try { ws.close(); } catch {}
    document.querySelector('.overlay')?.remove();
  };
}

function dropOverlay(m) {
  document.querySelector('.overlay')?.remove();
  const count = h('div.count');
  const btn = h('button.btn.solid', { style: { fontSize: '18px', padding: '14px 28px' }, onclick: () => { openInSpotify(m.track); ov.remove(); } }, 'Play now');
  const ov = h('div.overlay', {}, h('div', {},
    h('div.eyebrow', {}, `${m.by} dropped a song`), count,
    h('div.what', {}, `${m.track.name}${m.track.artist ? ' · ' + m.track.artist : ''}`),
    h('div.row', { style: { justifyContent: 'center' } }, btn, h('button.btn.ghost', { onclick: () => ov.remove() }, 'Skip'))));
  document.body.append(ov);
  const tick = () => {
    const left = Math.ceil((m.at - Date.now()) / 1000);
    if (!ov.isConnected) return;
    if (left > 0) { count.textContent = left; setTimeout(tick, 100); }
    else if (isNative && m.track.id) { openInSpotify(m.track); ov.remove(); toast(`Playing ${m.track.name}`); }
    else { count.textContent = 'Go'; btn.focus(); }
  };
  tick();
}
