// Crate: router, navigation, bottom bar, keyboard shortcuts.
import { h, toast, dur, openInSpotify } from './util.js';
import { state, load } from './data.js';
import * as sp from './spotify.js';
import { np, startPolling, progressNow } from './nowplaying.js';
import { loadQueue, queue, playNext } from './queue.js';
import { artEl } from './art.js';

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

const NAV = [
  ['Listen', [['now', 'Now playing', true], ['queue', 'Up next'], ['rooms', 'Rooms']]],
  ['Stats', [['', 'Overview'], ['top', 'Top lists'], ['clock', 'Listening clock'], ['obsessions', 'Obsessions'], ['genres', 'Genres', true], ['cards', 'Share cards']]],
  ['Library', [['playlists', 'Playlist tools', true], ['smart', 'Smart playlists', true]]],
  ['Crate', [['settings', 'Data & Spotify']]],
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
  const on = sp.connected();
  let i = 0;
  document.getElementById('nav').replaceChildren(...NAV.map(([label, links]) => h('div.nav-group', {},
    h('div.nav-label', {}, label),
    links.map(([k, text, needsApi]) => h('a.nav-link', { href: '#/' + k, class: name === k ? 'on' : '' },
      h('span.n', {}, String(++i).padStart(2, '0')), text, needsApi && !on ? h('span.lock', { title: 'Needs Spotify login' }, 'API') : null)))));
  const me = JSON.parse(localStorage.getItem('crate.me') || 'null');
  document.getElementById('railFoot').replaceChildren(
    h('div.who', {}, h('span.dot', { class: on ? 'on' : '' }), on ? (me?.name || 'Spotify connected') : 'Spotify not connected'),
    h('div', {}, `${state.plays.length.toLocaleString()} plays stored`));
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
function renderBar() {
  const q = queue();
  const nextBtn = h('button.btn.small', { onclick: () => playNext(), disabled: !q.length, title: 'Open the next song from Up Next (N)' }, 'Next ›');
  const nextTxt = q.length ? h('a.next', { href: '#/queue' }, `Up next: ${q[0].name} · ${q.length} queued`) : h('a.next', { href: '#/queue' }, 'Up Next is empty');
  if (np.item) {
    const pct = np.item.duration ? (100 * progressNow()) / np.item.duration : 0;
    bar.replaceChildren(
      h('div.prog', {}, h('i', { style: { width: pct + '%' } })),
      artEl({ id: np.item.id, art: np.item.art, name: np.item.name, artist: np.item.artist }),
      h('a.tt', { href: '#/now', style: { textDecoration: 'none' } }, h('div.t1', {}, np.item.name), h('div.t2', {}, `${np.playing ? 'Playing' : 'Paused'} · ${np.item.artist} · ${dur(progressNow())} / ${dur(np.item.duration)}`)),
      nextTxt, nextBtn);
    return;
  }
  const last = state.plays.at(-1);
  bar.replaceChildren(
    last ? artEl({ id: last.u, name: last.n, artist: last.a }) : h('div.art'),
    h('div.tt', {}, h('div.t1', {}, last ? last.n : 'Crate'),
      h('div.t2', {}, last ? `Last played · ${last.a}` : sp.connected() ? 'Nothing playing in Spotify' : 'Import your history or connect Spotify to start')),
    last ? h('button.btn.ghost.small', { onclick: () => openInSpotify({ id: last.u, name: last.n, artist: last.a }) }, 'Open') : null,
    nextTxt, nextBtn);
}

// When the Spotify track changes and Crate's queue has songs, nudge to the next one.
window.addEventListener('crate:trackchange', (e) => {
  if (!queue().length || !e.detail.prev) return;
  if (localStorage.getItem('crate.nudge') === 'off') return;
  toast(`Song changed. Press N to open "${queue()[0].name}" from Up Next.`, 5000);
});

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
  const map = { n: () => playNext(), q: () => (location.hash = '#/queue'), p: () => (location.hash = '#/now'), o: () => (location.hash = '#/'), '/': () => document.querySelector('main input[type=search]')?.focus() };
  const f = map[e.key.toLowerCase()];
  if (f) { e.preventDefault(); f(); }
});

async function boot() {
  const cb = await sp.handleCallback().catch((e) => ({ ok: false, error: e.message, back: '#/settings' }));
  await Promise.all([load(), loadQueue()]);
  if (cb) {
    if (cb.ok) { toast('Spotify connected'); sp.me().then(renderNav).catch(() => {}); }
    else toast(cb.error, 6000);
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('crate:data', () => { renderNav(); renderBar(); });
  window.addEventListener('crate:np', renderBar);
  window.addEventListener('crate:queue', renderBar);
  setInterval(() => np.playing && renderBar(), 1000);
  route();
  renderBar();
  if (sp.connected()) startPolling();
}
boot();
