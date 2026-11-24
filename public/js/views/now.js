import { h, num, date, dur, ago, toast, openInSpotify, playLabel } from '../util.js';
import { state } from '../data.js';
import { trackHistory } from '../stats.js';
import { head, sectionTitle, trackActs, DMG } from '../ui.js';
import { artEl } from '../art.js';
import { np, progressNow, startPolling, isNative, cmd, setSleep, setLoop, canSee } from '../nowplaying.js';
import { transport } from '../controls.js';
import { enqueue } from '../queue.js';
import * as sp from '../spotify.js';
import { pages } from '../rules.js';

let myPlaylists = null;

export function render(page) {
  if (!canSee()) {
    page.replaceChildren(head('Listen', 'Now playing'),
      h('div.lockbox', {}, h('b', {}, 'Control Spotify from Crate'), h('p', {}, 'The Crate app for Mac works with the Spotify app on your computer: play, pause, skip, a real queue, sleep timer and loops. It logs every song for your stats. No login, works on free accounts.'),
        h('a.btn.solid', { href: DMG }, 'Download for Mac')),
      state.plays.length ? h('section.section', { style: { marginTop: '40px' } }, sectionTitle('01', 'Last played'), recent(state.plays.slice(-12).reverse())) : null);
    return;
  }
  startPolling();
  let shownKey = null;
  const prog = h('div.prog', {
    style: isNative ? { cursor: 'pointer', height: '5px' } : {},
    onclick: isNative ? (e) => { const r = prog.getBoundingClientRect(); cmd('seek', ((e.clientX - r.left) / r.width) * np.item.duration / 1000); } : null,
  }, h('i'), h('b.loopmark'));
  const times = h('div.prog-t', {}, h('span'), h('span'));

  const tickProg = () => {
    if (!np.item) return;
    const p = progressNow();
    prog.firstChild.style.width = (np.item.duration ? (100 * p) / np.item.duration : 0) + '%';
    const lm = prog.lastChild;
    if (np.loop && np.item.duration) { lm.style.display = 'block'; lm.style.left = (100 * np.loop.a / np.item.duration) + '%'; lm.style.width = (100 * (np.loop.b - np.loop.a) / np.item.duration) + '%'; }
    else lm.style.display = 'none';
    times.firstChild.textContent = dur(p);
    times.lastChild.textContent = dur(np.item.duration);
  };

  const draw = () => {
    if (np.error && !np.item && !isNative) return page.replaceChildren(head('Listen', 'Now playing'), h('p.err', {}, np.error));
    if (!np.item) {
      shownKey = null;
      const closed = isNative && !np.running;
      page.replaceChildren(head('Listen', 'Now playing'),
        h('div.lockbox', {},
          h('b', {}, closed ? 'Spotify is closed' : np.at ? 'Nothing is playing' : 'Checking Spotify…'),
          h('p', {}, closed ? 'Open the Spotify app and Crate takes it from there.' : isNative ? 'Press play here or in Spotify. Every song you play is logged for your stats.' : 'Start something in any Spotify app and it shows up here within a few seconds.'),
          isNative ? h('div.row', {}, closed ? h('button.btn.solid', { onclick: () => cmd('activate') }, 'Open Spotify') : transport(true)) : null),
        h('section.section', { style: { marginTop: '40px' } }, sectionTitle('01', 'Recently played'), recent(state.plays.slice(-12).reverse())));
      return;
    }
    const key = [np.item.id, np.playing, np.shuffle, np.repeat, !!np.loop, np.sleep ? 1 : 0].join('|');
    if (shownKey === key) return tickProg();
    const sameTrack = shownKey?.split('|')[0] === np.item.id;
    shownKey = key;
    if (sameTrack && page.querySelector('.np-controls')) { page.querySelector('.np-controls').replaceWith(controls()); return tickProg(); }
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
          controls(),
          h('div.row', { style: { marginTop: '14px' } },
            !isNative ? h('button.btn.solid', { onclick: () => openInSpotify(it) }, 'Open in Spotify') : null,
            h('button.btn', { onclick: () => enqueue(it) }, '+ Up Next'),
            sp.connected() ? h('button.btn', { onclick: like }, 'Like') : null,
            sp.connected() ? playlistPicker(it) : null),
          h('div.kv', {},
            h('div', {}, h('b', {}, num(hist.plays)), h('span', {}, 'Your plays')),
            h('div', {}, h('b', {}, num(hist.ms / 60000)), h('span', {}, 'Minutes')),
            h('div', {}, h('b', {}, hist.rank ? '#' + num(hist.rank) : '–'), h('span', {}, `Rank of ${num(hist.of)}`)),
            h('div', {}, h('b', { style: { fontSize: '17px' } }, hist.first ? date(hist.first) : 'Today'), h('span', {}, 'First heard')),
            h('div', {}, h('b', { style: { fontSize: '17px' } }, hist.last ? ago(hist.last) : '–'), h('span', {}, 'Last logged')),
            h('div', {}, h('b', {}, hist.rows ? Math.round((100 * hist.skips) / hist.rows) + '%' : '–'), h('span', {}, 'Skipped'))))),
      h('section.section', { style: { marginTop: '48px' } }, sectionTitle('02', 'Recently played'), recent(state.plays.slice(-10).reverse())));
    tickProg();
  };

  const controls = () => {
    if (!isNative) return h('div.np-controls');
    const sleepSel = h('select.input', { 'aria-label': 'Sleep timer', onchange: (e) => { const v = e.target.value; setSleep(v === 'track' ? 'track' : Number(v)); toast(v ? 'Sleep timer set' : 'Sleep timer off'); } },
      [['', np.sleep ? (np.sleep.endOfTrack ? 'Sleep: end of song' : `Sleep: ${Math.ceil((np.sleep.at - Date.now()) / 60000)} min left`) : 'Sleep timer'], ['', 'Off'], ['15', '15 min'], ['30', '30 min'], ['45', '45 min'], ['60', '1 hour'], ['track', 'End of this song']]
        .map(([v, l], i) => h('option', { value: v, selected: i === 0, hidden: i === 0 }, l)));
    return h('div.np-controls', {},
      transport(true),
      h('div.row', { style: { gap: '6px', marginTop: '16px' } },
        h('button.btn.small', { class: np.shuffle ? 'solid' : '', onclick: () => cmd('shuffle', !np.shuffle) }, 'Shuffle'),
        h('button.btn.small', { class: np.repeat ? 'solid' : '', onclick: () => cmd('repeat', !np.repeat) }, 'Repeat'),
        h('label.vol', {}, h('span.mono.dim', {}, 'Vol'),
          h('input', { type: 'range', min: 0, max: 100, value: np.volume, oninput: (e) => cmd('volume', e.target.value), 'aria-label': 'Volume' })),
        sleepSel,
        loopBtns()));
  };

  const loopBtns = () => {
    if (np.loop) return h('button.btn.small.solid', { onclick: () => { setLoop(null); toast('Loop off'); } }, `Loop ${dur(np.loop.a)}–${dur(np.loop.b)} ×`);
    let a = null;
    const btn = h('button.btn.small', { title: 'Press once to mark the start, again to mark the end', onclick: () => {
      const p = progressNow();
      if (a == null) { a = p; btn.textContent = `A ${dur(a)} · set B`; return; }
      if (p - a < 1500) return toast('Pick an end point after the start');
      setLoop({ a, b: p });
      seekTo(a);
    } }, 'A–B loop');
    return btn;
  };
  const seekTo = (ms) => cmd('seek', ms / 1000);

  async function like() {
    try { await sp.api(`/me/library?uris=spotify:track:${np.item.id}`, { method: 'PUT' }); toast('Saved to Liked Songs'); }
    catch (e) { toast(e.message); }
  }

  draw();
  const iv = setInterval(tickProg, 250);
  window.addEventListener('crate:np', draw);
  const onTrack = () => { if (np.loop) setLoop(null); };
  window.addEventListener('crate:trackchange', onTrack);
  return () => { clearInterval(iv); window.removeEventListener('crate:np', draw); window.removeEventListener('crate:trackchange', onTrack); };
}

function playlistPicker(it) {
  const sel = h('select.input', { style: { maxWidth: '200px' }, onchange: async (e) => {
    const id = e.target.value;
    e.target.value = '';
    if (!id) return;
    try { await sp.api(`/playlists/${id}/items`, { method: 'POST', body: { uris: ['spotify:track:' + it.id] } }); toast('Added to playlist'); }
    catch (err) { toast(err.message); }
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
  if (!rows.length) return h('div.empty-line', {}, 'Nothing logged yet.');
  return h('div.list', {}, rows.map((p) => h('div.li', {},
    h('span.rk', {}, ''), artEl({ id: p.u, name: p.n, artist: p.a }),
    h('div.tt', {}, h('div.t1', {}, p.n), h('div.t2', {}, p.a)),
    h('span'), h('span.val', {}, ago(p.t)), trackActs({ id: p.u, name: p.n, artist: p.a }))));
}
export { playLabel };
