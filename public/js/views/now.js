import { h, num, date, dur, ago, toast, openInSpotify } from '../util.js';
import { state } from '../data.js';
import { trackHistory } from '../stats.js';
import { head, lockbox, sectionTitle, trackActs } from '../ui.js';
import { artEl } from '../art.js';
import { np, progressNow, startPolling } from '../nowplaying.js';
import { enqueue } from '../queue.js';
import * as sp from '../spotify.js';
import { pages } from '../rules.js';

let myPlaylists = null;

export function render(page) {
  if (!sp.connected()) {
    const last = state.plays.slice(-12).reverse();
    page.replaceChildren(
      head('Listen', 'Now playing'),
      lockbox('See what\'s playing live', 'With a Spotify login, this page follows whatever is playing in your Spotify app and shows your full history with that song. Free accounts can see playback but can\'t control it, so Crate gives you Open buttons and its own Up Next queue.'),
      last.length ? h('section.section', { style: { marginTop: '40px' } }, sectionTitle('01', 'Last played in your history'), recent(last)) : null);
    return;
  }
  startPolling();
  let shownId = null;
  const prog = h('div.prog', {}, h('i'));
  const times = h('div.prog-t', {}, h('span'), h('span'));

  const tickProg = () => {
    if (!np.item) return;
    const p = progressNow();
    prog.firstChild.style.width = (np.item.duration ? (100 * p) / np.item.duration : 0) + '%';
    times.firstChild.textContent = dur(p);
    times.lastChild.textContent = dur(np.item.duration);
  };

  const draw = () => {
    if (np.error && !np.item) {
      page.replaceChildren(head('Listen', 'Now playing'), h('p.err', {}, np.error));
      return;
    }
    if (!np.item) {
      shownId = null;
      page.replaceChildren(head('Listen', 'Now playing'),
        h('div.lockbox', {}, h('b', {}, np.at ? 'Nothing is playing in Spotify' : 'Checking Spotify…'), h('p', {}, 'Start something in any Spotify app (phone, desktop, web) and it shows up here within a few seconds.')),
        h('section.section', { style: { marginTop: '40px' } }, sectionTitle('01', 'Recently played'), recent(state.plays.slice(-12).reverse())));
      return;
    }
    if (shownId === np.item.id) return tickProg();
    shownId = np.item.id;
    const it = np.item;
    const hist = trackHistory(state.plays, { id: it.id, name: it.name, artist: it.artist.split(',')[0] });
    page.replaceChildren(
      h('div.eyebrow', {}, np.playing ? 'Now playing' : 'Paused'),
      h('div.np', { style: { marginTop: '16px' } },
        artEl({ id: it.id, art: it.art, name: it.name, artist: it.artist }, 'xl'),
        h('div', {},
          h('h1.np-title', {}, it.name),
          h('div.np-artist', {}, it.artist, it.album ? h('span.dim', {}, ' · ' + it.album) : null),
          prog, times,
          h('div.row', { style: { marginTop: '22px' } },
            h('button.btn.solid', { onclick: () => openInSpotify(it) }, 'Open in Spotify'),
            h('button.btn', { onclick: () => enqueue(it) }, '+ Up Next'),
            h('button.btn', { onclick: like }, 'Like'),
            playlistPicker(it)),
          h('div.kv', {},
            h('div', {}, h('b', {}, num(hist.plays)), h('span', {}, 'Your plays')),
            h('div', {}, h('b', {}, num(hist.ms / 60000)), h('span', {}, 'Minutes')),
            h('div', {}, h('b', {}, hist.rank ? '#' + num(hist.rank) : '–'), h('span', {}, `Rank of ${num(hist.of)}`)),
            h('div', {}, h('b', { style: { fontSize: '17px' } }, hist.first ? date(hist.first) : 'Today'), h('span', {}, 'First heard')),
            h('div', {}, h('b', { style: { fontSize: '17px' } }, hist.last ? ago(hist.last) : '–'), h('span', {}, 'Last logged')),
            h('div', {}, h('b', {}, hist.rows ? Math.round((100 * hist.skips) / hist.rows) + '%' : '–'), h('span', {}, 'Skipped'))),
          h('p.note', {}, 'Playback buttons are missing on purpose: Spotify only allows controlling playback from Premium accounts.'))),
      h('section.section', { style: { marginTop: '48px' } }, sectionTitle('02', 'Recently played'), recent(state.plays.slice(-10).reverse())));
    tickProg();
  };

  async function like() {
    try {
      await sp.api(`/me/library?uris=spotify:track:${np.item.id}`, { method: 'PUT' });
      toast('Saved to Liked Songs');
    } catch (e) { toast(e.message); }
  }

  draw();
  const iv = setInterval(tickProg, 500);
  window.addEventListener('crate:np', draw);
  return () => { clearInterval(iv); window.removeEventListener('crate:np', draw); };
}

function playlistPicker(it) {
  const sel = h('select.input', { style: { maxWidth: '200px' }, onchange: async (e) => {
    const id = e.target.value;
    e.target.value = '';
    if (!id) return;
    try {
      await sp.api(`/playlists/${id}/items`, { method: 'POST', body: { uris: ['spotify:track:' + it.id] } });
      toast('Added to playlist');
    } catch (err) { toast(err.message); }
  } }, h('option', { value: '' }, 'Add to playlist…'));
  (async () => {
    try {
      const me = await sp.me();
      myPlaylists ||= (await pages(sp.api, '/me/playlists?limit=50')).filter((p) => p.owner?.id === me.id || p.collaborative);
      for (const p of myPlaylists) sel.append(h('option', { value: p.id }, p.name));
    } catch {}
  })();
  return sel;
}

function recent(rows) {
  if (!rows.length) return h('div.empty-line', {}, 'No plays stored yet.');
  return h('div.list', {}, rows.map((p) => h('div.li', {},
    h('span.rk', {}, ''), artEl({ id: p.u, name: p.n, artist: p.a }),
    h('div.tt', {}, h('div.t1', {}, p.n), h('div.t2', {}, p.a)),
    h('span'), h('span.val', {}, ago(p.t)), trackActs({ id: p.u, name: p.n, artist: p.a }))));
}
