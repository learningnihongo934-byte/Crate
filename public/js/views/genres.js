import { h, num, toast } from '../util.js';
import { state, inRange, rangeLabel } from '../data.js';
import { top } from '../stats.js';
import { head, rangePicker, sectionTitle, lockbox, emptyHistory } from '../ui.js';
import { genreAll, genrePut, genreClear } from '../db.js';
import * as sp from '../spotify.js';

let busy = false;

export function render(page) {
  let map = new Map();
  const status = h('span.mono.dim', { style: { fontSize: '12px' } });

  const lookup = async (n) => {
    if (busy) return;
    busy = true;
    try {
      // 1) Spotify's top artists already carry genres
      for (const r of ['short_term', 'medium_term', 'long_term']) {
        const res = await sp.api(`/me/top/artists?limit=50&time_range=${r}`);
        await save(res.items.map((a) => ({ artist: a.name.toLowerCase(), genres: a.genres || [], id: a.id })));
      }
      // 2) the rest of your most-played artists, via one of their tracks
      const want = top(state.plays, 'artist', 'ms', n).filter((e) => !map.has(e.name.toLowerCase()));
      let done = 0;
      for (const e of want) {
        status.textContent = `Looking up ${e.name} (${++done}/${want.length})…`;
        try {
          let artistId = '';
          if (e.id) {
            const tr = await sp.api(`/tracks/${e.id}`);
            artistId = tr.artists?.[0]?.id || '';
          } else {
            const s = await sp.api(`/search?type=artist&limit=1&q=${encodeURIComponent(e.name)}`);
            const a = s.artists?.items?.[0];
            if (a && a.name.toLowerCase() === e.name.toLowerCase()) artistId = a.id;
          }
          const a = artistId ? await sp.api(`/artists/${artistId}`) : null;
          await save([{ artist: e.name.toLowerCase(), genres: a?.genres || [], id: artistId }]);
        } catch (err) {
          if (err.status === 429) break;
        }
        if (done % 10 === 0) drawBody();
      }
      status.textContent = '';
      toast('Genres updated');
    } catch (e) {
      status.textContent = e.message;
    } finally {
      busy = false;
      drawBody();
    }
  };

  const save = async (rows) => {
    rows = rows.map((r) => ({ ...r, t: Date.now() }));
    await genrePut(rows);
    for (const r of rows) map.set(r.artist, r);
  };

  const body = h('div');
  const drawBody = () => {
    const plays = inRange();
    const gms = new Map();
    const yearG = new Map();
    let tagged = 0, total = 0;
    for (const p of plays) {
      total += p.ms;
      const g = map.get(p.a.toLowerCase())?.genres;
      if (!g || !g.length) continue;
      tagged += p.ms;
      const y = new Date(p.t).getFullYear();
      for (const x of g) {
        gms.set(x, (gms.get(x) || 0) + p.ms / g.length);
        const k = y + '|' + x;
        yearG.set(k, (yearG.get(k) || 0) + p.ms / g.length);
      }
    }
    const ranked = [...gms.entries()].sort((a, b) => b[1] - a[1]);
    if (!map.size) {
      body.replaceChildren(h('div.lockbox', {}, h('b', {}, 'No genre tags yet'), h('p', {}, 'Crate asks Spotify for the genres of your most-played artists, then weighs them by how long you listened.'),
        h('div.row', {}, h('button.btn.solid', { onclick: () => lookup(150) }, 'Look up my top 150 artists'), status)));
      return;
    }
    const max = ranked[0]?.[1] || 1;
    const topG = ranked.slice(0, 8).map((x) => x[0]);
    const years = [...new Set(plays.map((p) => new Date(p.t).getFullYear()))].sort();
    const yearTot = new Map(years.map((y) => [y, topG.reduce((s, g) => s + (yearG.get(y + '|' + g) || 0), 0)]));
    body.replaceChildren(
      h('div.row', { style: { marginBottom: '18px' } },
        h('span.mono.dim', { style: { fontSize: '12px' } }, `${map.size} artists tagged · ${total ? Math.round((100 * tagged) / total) : 0}% of minutes in range covered`),
        h('div.spacer'), status,
        h('button.btn.small', { onclick: () => lookup(400), disabled: busy }, 'Look up more artists'),
        h('button.btn.small.ghost', { onclick: async () => { await genreClear(); map = new Map(); drawBody(); } }, 'Reset')),
      h('div.cols', {},
        h('section.section.c6', {}, sectionTitle('01', 'Top genres', 'by minutes'),
          ranked.length ? h('div.list', {}, ranked.slice(0, 24).map(([g, ms], i) => h('div.li.compact', { style: { gridTemplateColumns: '24px minmax(0,1fr) 120px 70px' } },
            h('span.rk', {}, i + 1), h('div.tt', {}, h('div.t1', {}, g)),
            h('div.meter', { style: { height: '3px', background: 'var(--line)', position: 'relative' } }, h('i', { style: { position: 'absolute', inset: '0 auto 0 0', background: 'var(--text)', width: (100 * ms / max) + '%' } })),
            h('span.val', {}, `${num(ms / 60000)} min`))))
            : h('div.empty-line', {}, 'None of the artists in this range have genre tags. Spotify leaves many artists untagged.')),
        h('section.section.c6', {}, sectionTitle('02', 'Genre mix by year', 'share of your top 8'),
          years.length && topG.length ? h('div', { style: { display: 'grid', gridTemplateColumns: `minmax(90px, 1.4fr) repeat(${years.length}, minmax(28px, 1fr))`, gap: '2px', alignItems: 'center' } },
            h('span'), years.map((y) => h('span.mono.dim', { style: { fontSize: '10.5px', textAlign: 'center' } }, "'" + String(y).slice(2))),
            topG.flatMap((g) => [h('span', { style: { fontSize: '12.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: '8px' } }, g),
              ...years.map((y) => {
                const share = (yearG.get(y + '|' + g) || 0) / (yearTot.get(y) || 1);
                return h('i', { style: { display: 'block', aspectRatio: '1.6', background: 'var(--text)', opacity: (0.05 + 0.95 * share).toFixed(3) }, title: `${g} · ${y}: ${Math.round(share * 100)}%` });
              })])) : h('div.empty-line', {}, 'Not enough data.'),
          h('p.note', {}, 'Each artist\'s minutes are split evenly across their genre tags.'))));
  };

  const draw = async () => {
    if (!sp.connected()) {
      page.replaceChildren(head('Genres', 'Genre map'), lockbox('Genres come from Spotify', 'Spotify only shares artist genres through its API, so this page needs a Spotify login. Everything else in Stats works from your export alone.'));
      return;
    }
    if (!state.plays.length) return page.replaceChildren(head('Genres', 'Genre map'), emptyHistory());
    map = new Map((await genreAll()).map((r) => [r.artist, r]));
    page.replaceChildren(head(`Genres · ${rangeLabel()}`, 'Genre map', null, rangePicker()), body);
    drawBody();
  };
  draw();
  window.addEventListener('crate:data', draw);
  return () => window.removeEventListener('crate:data', draw);
}
