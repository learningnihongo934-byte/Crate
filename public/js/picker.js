// Song picker: search your history (and Spotify, when logged in), or paste a Spotify track link.
import { h, debounce, parseSpotifyLink, toast } from './util.js';
import { state } from './data.js';
import { top } from './stats.js';
import { artEl, getArt } from './art.js';
import * as sp from './spotify.js';

let index = null, indexLen = -1;
function historyIndex() {
  if (indexLen !== state.plays.length) { index = top(state.plays, 'track', 'plays', 0); indexLen = state.plays.length; }
  return index;
}

export async function resolveLink(text) {
  const l = parseSpotifyLink(text);
  if (!l || l.type !== 'track') return null;
  if (sp.connected()) {
    try {
      const t = await sp.api(`/tracks/${l.id}`);
      return { id: t.id, name: t.name, artist: t.artists.map((a) => a.name).join(', '), art: t.album.images.at(-1)?.url || '' };
    } catch {}
  }
  const r = await fetch(`/api/art?type=track&id=${l.id}`).then((x) => x.json()).catch(() => ({}));
  const known = state.plays.find((p) => p.u === l.id);
  return { id: l.id, name: known?.n || r.title || 'Spotify track', artist: known?.a || '', art: r.thumb || '' };
}

export function picker(onPick, placeholder = 'Search your history or paste a Spotify song link') {
  const results = h('div.list', { style: { maxHeight: '340px', overflowY: 'auto', borderTop: '0' } });
  const input = h('input', { type: 'search', placeholder, style: { width: '100%' } });
  const pick = (t) => { onPick(t); input.value = ''; results.replaceChildren(); };
  const row = (t) => h('div.li.compact', { style: { cursor: 'pointer' }, onclick: () => pick(t) },
    h('span.rk', {}, ''), artEl(t, 'sm'), h('div.tt', {}, h('div.t1', {}, t.name), h('div.t2', {}, t.artist)), h('span.val', {}, t.meta || ''), h('span.btn.small', {}, 'Add'));
  const run = debounce(async () => {
    const q = input.value.trim();
    if (!q) return results.replaceChildren();
    if (parseSpotifyLink(q)) {
      const t = await resolveLink(q);
      if (t) pick(t); else toast('That link isn\'t a Spotify song');
      return;
    }
    const ql = q.toLowerCase();
    const hits = historyIndex().filter((e) => `${e.name} ${e.artist}`.toLowerCase().includes(ql)).slice(0, 8)
      .map((e) => ({ id: e.id, name: e.name, artist: e.artist, meta: `${e.plays}×` }));
    results.replaceChildren(...hits.map(row));
    if (sp.connected() && q.length > 2) {
      try {
        const r = await sp.api(`/search?type=track&limit=8&q=${encodeURIComponent(q)}`);
        if (input.value.trim() !== q) return;
        const seen = new Set(hits.map((x) => x.id));
        for (const t of r.tracks?.items || []) {
          if (seen.has(t.id)) continue;
          results.append(row({ id: t.id, name: t.name, artist: t.artists.map((a) => a.name).join(', '), art: t.album.images.at(-1)?.url, meta: 'Spotify' }));
        }
      } catch {}
    }
    if (!results.children.length) results.append(h('div.empty-line', {}, sp.connected() ? 'No matches.' : 'No matches in your history. Paste a Spotify link instead.'));
  }, 180);
  input.addEventListener('input', run);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); results.querySelector('.li')?.click(); } });
  return h('div', {}, input, results);
}
export { getArt };
