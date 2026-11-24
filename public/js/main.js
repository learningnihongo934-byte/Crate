// Crate: router, navigation, bottom bar, keyboard shortcuts.
import { h, toast, dur, openInSpotify, setPlayer } from './util.js';
import { state, load } from './data.js';
import * as sp from './spotify.js';
import { np, startPolling, progressNow, isNative, playUri, cmd, canSee } from './nowplaying.js';
import { loadQueue, queue, playNext } from './queue.js';
import { artEl } from './art.js';
import { DMG } from './ui.js';
import { transport } from './controls.js';

if (isNative) setPlayer(playUri);

const ROUTES = {
  '': () => import('./views/overview.js'),
  top: () => import('./views/top.js'),
  clock: () => import('./views/clock.js'),
  obsessions: () => import('./views/obsessions.js'),
  genres: () => import('./views/genres.js'),
  cards: () => import('./views/cards.js'),
  now: () => import('./views/now.js'),
  queue: () => import('./views/queue.js'),
  rooms: () => import('./views/rooms.js'),
  playlists: () => import('./views/playlists.js'),
  smart: () => import('./views/smart.js'),
  settings: () => import('./views/settings.js'),
};

// [route, label, show?]
const NAV = () => [
  ['Listen', [['now', 'Now playing', canSee()], ['queue', 'Up next'], ['rooms', 'Rooms']]],
  ['Stats', [['', 'Overview'], ['top', 'Top lists'], ['clock', 'Listening clock'], ['obsessions', 'Obsessions'], ['genres', 'Genres', sp.connected()], ['cards', 'Share cards']]],
  ['Library', [['playlists', 'Playlist tools', sp.connected()], ['smart', 'Smart playlists', sp.connected()]]],
  ['Crate', [['settings', 'Settings']]],
];

const view = document.getElementById('view');
let cleanup = null;
let current = '';

function parse() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  return { name: parts[0] || '', args: parts.slice(1).map(decodeURIComponent) };
}

function renderNav() {
  const { name } = parse();
  let i = 0;
  document.getElementById('nav').replaceChildren(...NAV().map(([label, links]) => {
    const shown = links.filter((l) => l[2] !== false);
    if (!shown.length) return '';
    return h('div.nav-group', {}, h('div.nav-label', {}, label),
      shown.map(([k, text]) => h('a.nav-link', { href: '#/' + k, class: name === k ? 'on' : '' }, h('span.n', {}, String(++i).padStart(2, '0')), text)));
  }));
  const on = isNative ? np.running : sp.connected();
  const me = JSON.parse(localStorage.getItem('crate.me') || 'null');
  document.getElementById('railFoot').replaceChildren(
    h('div.who', {}, h('span.dot', { class: on ? 'on' : '' }),
      isNative ? (np.running ? 'Connected to Spotify' : 'Spotify is closed') : sp.connected() ? (me?.name || 'Spotify connected') : 'Web version'),
    h('div', {}, `${state.plays.length.toLocaleString()} plays logged`),
    !isNative ? h('a', { href: DMG, style: { display: 'inline-block', marginTop: '8px' } }, 'Get the Mac app') : null);
}

async function route() {
  const { name, args } = parse();
  renderNav();
  const load = ROUTES[name] || ROUTES[''];
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  current = name + '/' + args.join('/');
  const mod = await load();
  if (current !== name + '/' + args.join('/')) return;
  const page = h('div.page');
  view.replaceChildren(page);
  try {
    cleanup = (await mod.render(page, { args })) || null;
  } catch (e) {
    console.error(e);
    page.replaceChildren(h('div.lockbox', {}, h('b', {}, 'Something went wrong'), h('p.err', {}, e.message)));
  }
  window.scrollTo(0, 0);
}

// ---------- bottom bar ----------
const bar = document.getElementById('bar');
let barKey = '';
function renderBar() {
  const q = queue();
  const nextTxt = q.length ? h('a.next', { href: '#/queue' }, `Up next: ${q[0].name} · ${q.length} queued`) : h('a.next', { href: '#/queue' }, 'Up Next is empty');
  if (np.item) {
    const pct = np.item.duration ? (100 * progressNow()) / np.item.duration : 0;
    const key = [np.item.id, np.playing, q.length, q[0]?.key].join('|');
    if (key === barKey && bar.querySelector('.prog i')) {
      bar.querySelector('.prog i').style.width = pct + '%';
      bar.querySelector('.bar-time').textContent = `${dur(progressNow())} / ${dur(np.item.duration)}`;
      return;
    }
    barKey = key;
    const prog = h('div.prog', {
      style: isNative ? { cursor: 'pointer', height: '6px', top: '-4px' } : {},
      onclick: isNative ? (e) => { const r = e.currentTarget.getBoundingClientRect(); cmd('seek', ((e.clientX - r.left) / r.width) * np.item.duration / 1000); } : null,
    }, h('i', { style: { width: pct + '%' } }));
    bar.replaceChildren(prog,
      isNative ? transport() : null,
      artEl({ id: np.item.id, art: np.item.art, name: np.item.name, artist: np.item.artist }),
      h('a.tt', { href: '#/now', style: { textDecoration: 'none' } }, h('div.t1', {}, np.item.name),
        h('div.t2', {}, `${np.item.artist} · `, h('span.bar-time', {}, `${dur(progressNow())} / ${dur(np.item.duration)}`))),
      nextTxt, isNative ? null : h('button.btn.small', { onclick: () => playNext(), disabled: !q.length }, 'Next ›'));
    return;
  }
  barKey = '';
  const last = state.plays.at(-1);
  bar.replaceChildren(
    isNative && np.running ? transport() : null,
    last ? artEl({ id: last.u, name: last.n, artist: last.a }) : h('div.art'),
    h('div.tt', {}, h('div.t1', {}, last ? last.n : 'Crate'),
      h('div.t2', {}, isNative ? (np.running ? 'Nothing playing. Press play.' : 'Open Spotify to start') : last ? `Last played · ${last.a}` : 'Get the Mac app to control Spotify')),
    isNative && !np.running ? h('button.btn.small', { onclick: () => cmd('activate') }, 'Open Spotify') : last ? h('button.btn.ghost.small', { onclick: () => openInSpotify({ id: last.u, name: last.n, artist: last.a }) }, isNative ? 'Play' : 'Open') : null,
    nextTxt, isNative ? null : h('button.btn.small', { onclick: () => playNext(), disabled: !q.length }, 'Next ›'));
}

// Web only: nudge to the next queued song when Spotify changes track (the Mac app advances by itself).
window.addEventListener('crate:trackchange', (e) => {
  if (isNative || !queue().length || !e.detail.prev) return;
  if (localStorage.getItem('crate.nudge') === 'off') return;
  toast(`Song changed. Press N to open "${queue()[0].name}" from Up Next.`, 5000);
});

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
  const map = {
    n: () => playNext(), q: () => (location.hash = '#/queue'), p: () => (location.hash = '#/now'), o: () => (location.hash = '#/'),
    '/': () => document.querySelector('main input[type=search]')?.focus(),
  };
  if (isNative) Object.assign(map, { ' ': () => cmd('playpause'), j: () => cmd('previous'), l: () => (queue().some((q) => q.id) ? playNext() : cmd('next')) });
  const f = map[e.key.toLowerCase()];
  if (f) { e.preventDefault(); f(); }
});

let wasRunning = null;
async function boot() {
  const cb = await sp.handleCallback().catch((e) => ({ ok: false, error: e.message, back: '#/settings' }));
  await Promise.all([load(), loadQueue()]);
  if (cb) {
    if (cb.ok) { toast('Spotify connected'); sp.me().then(renderNav).catch(() => {}); }
    else toast(cb.error, 6000);
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('crate:data', () => { renderNav(); renderBar(); });
  window.addEventListener('crate:np', () => { renderBar(); if (np.running !== wasRunning) { wasRunning = np.running; renderNav(); } });
  window.addEventListener('crate:queue', () => { barKey = ''; renderBar(); });
  setInterval(() => np.playing && renderBar(), 1000);
  route();
  renderBar();
  if (canSee()) startPolling();
}
boot();
