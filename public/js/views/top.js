import { h, num, mins, date, debounce, ago, openInSpotify } from '../util.js';
import { state, inRange, rangeLabel } from '../data.js';
import { top } from '../stats.js';
import { head, rangePicker, rankList, emptyHistory, trackActs } from '../ui.js';
import { artEl } from '../art.js';
import * as sp from '../spotify.js';

const RANGES = [['short_term', '4 weeks'], ['medium_term', '6 months'], ['long_term', '1 year']];

export function render(page) {
  const ui = JSON.parse(sessionStorage.getItem('crate.top') || '{"by":"track","metric":"ms","q":"","n":100}');
  const save = () => sessionStorage.setItem('crate.top', JSON.stringify(ui));
  const body = h('div');

  const draw = () => {
    const tabs = h('div.seg', {}, [['track', 'Songs'], ['artist', 'Artists'], ['album', 'Albums'], ['log', 'Play log'], ...(sp.connected() ? [['spotify', 'Spotify says']] : [])]
      .map(([k, l]) => h('button', { class: ui.by === k ? 'on' : '', onclick: () => { ui.by = k; ui.n = 100; save(); draw(); } }, l)));
    const metric = h('div.seg', {}, [['ms', 'Minutes'], ['plays', 'Plays']].map(([k, l]) =>
      h('button', { class: ui.metric === k ? 'on' : '', onclick: () => { ui.metric = k; save(); draw(); } }, l)));
    const search = h('input', { type: 'search', placeholder: 'Filter  ( / )', value: ui.q, style: { width: '220px' },
      oninput: debounce((e) => { ui.q = e.target.value; save(); drawBody(); }, 150) });
    page.replaceChildren(
      head(`Top lists · ${rangeLabel()}`, 'Top lists', 'Ranked by real minutes listened, not just play counts.', rangePicker()),
      h('div.row', { style: { marginBottom: '20px' } }, tabs, ui.by !== 'log' && ui.by !== 'spotify' ? metric : null, h('div.spacer'), ui.by !== 'spotify' ? search : null),
      body);
    drawBody();
  };

  const drawBody = () => {
    if (ui.by === 'spotify') return drawSpotify();
    if (!state.plays.length) return body.replaceChildren(emptyHistory());
    const q = ui.q.trim().toLowerCase();
    const plays = inRange();
    if (ui.by === 'log') {
      let rows = plays.slice().reverse();
      if (q) rows = rows.filter((p) => `${p.n} ${p.a} ${p.b}`.toLowerCase().includes(q));
      const shown = rows.slice(0, ui.n);
      body.replaceChildren(
        h('div.list', {}, shown.map((p) => h('div.li', {},
          h('span.rk', {}, ''), artEl({ id: p.u, name: p.n, artist: p.a }),
          h('div.tt', {}, h('div.t1', {}, p.n), h('div.t2', {}, `${p.a}${p.b ? ' · ' + p.b : ''}`)),
          h('span.val', { style: { textAlign: 'left' } }, p.s ? 'skipped' : `${mins(p.ms)} min`),
          h('span.val', { title: new Date(p.t).toLocaleString() }, ago(p.t)),
          trackActs({ id: p.u, name: p.n, artist: p.a })))),
        more(rows.length));
      return;
    }
    let rows = top(plays, ui.by, ui.metric, 0);
    if (q) rows = rows.filter((e) => `${e.name} ${e.artist}`.toLowerCase().includes(q));
    body.replaceChildren(
      h('p.dim.mono', { style: { margin: '0 0 10px', fontSize: '12px' } }, `${num(rows.length)} ${ui.by === 'track' ? 'songs' : ui.by + 's'}`),
      rankList(rows.slice(0, ui.n), { kind: ui.by, metric: ui.metric, extra: (e) => `${mins(e.ms)} min · ${num(e.plays)}×` }),
      more(rows.length));
  };

  const more = (total) => total > ui.n
    ? h('div.row', { style: { marginTop: '16px' } }, h('button.btn', { onclick: () => { ui.n += 200; drawBody(); } }, `Show more (${num(total - ui.n)} left)`))
    : null;

  const drawSpotify = async () => {
    if (!sp.connected()) {
      return body.replaceChildren(h('div.lockbox', {}, h('span.pill', {}, 'Needs Spotify login'), h('b', {}, 'Spotify\'s own top lists'), h('p', {}, 'Connect Spotify to compare its ranking with your real minutes.'), h('a.btn.solid', { href: '#/settings' }, 'Set up Spotify login')));
    }
    ui.sr ||= 'short_term';
    const kind = ui.metric === 'plays' ? 'artists' : 'tracks';
    body.replaceChildren(h('div.row', { style: { marginBottom: '16px' } },
      h('div.seg', {}, RANGES.map(([k, l]) => h('button', { class: ui.sr === k ? 'on' : '', onclick: () => { ui.sr = k; save(); drawSpotify(); } }, l))),
      h('div.seg', {}, [['ms', 'Songs'], ['plays', 'Artists']].map(([k, l]) => h('button', { class: ui.metric === k ? 'on' : '', onclick: () => { ui.metric = k; save(); drawSpotify(); } }, l)))),
    h('div.loading', {}, 'Asking Spotify…'));
    try {
      const r = await sp.api(`/me/top/${kind}?limit=50&time_range=${ui.sr}`);
      const list = h('div.list', {}, (r.items || []).map((it, i) => {
        const isT = kind === 'tracks';
        const item = isT ? { id: it.id, name: it.name, artist: it.artists.map((a) => a.name).join(', '), art: it.album.images.at(-1)?.url } : { name: it.name, artist: it.name, art: it.images?.at(-1)?.url };
        return h('div.li', {}, h('span.rk', {}, i + 1), artEl(item), h('div.tt', {}, h('div.t1', {}, item.name), h('div.t2', {}, isT ? item.artist : (it.genres || []).slice(0, 3).join(', ') || 'Artist')),
          h('span'), h('span.val', {}, ''), isT ? trackActs(item) : h('span'));
      }));
      body.lastChild.replaceWith(list);
    } catch (e) { body.lastChild.replaceWith(h('p.err', {}, e.message)); }
  };

  draw();
  window.addEventListener('crate:data', draw);
  return () => window.removeEventListener('crate:data', draw);
}
export { date, openInSpotify };
