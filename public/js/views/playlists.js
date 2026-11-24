import { h, num, date, dur, toast, debounce, download, openInSpotify } from '../util.js';
import { state } from '../data.js';
import { counted } from '../stats.js';
import { head, lockbox, sectionTitle } from '../ui.js';
import { artEl, setArt } from '../art.js';
import { kvGet, kvSet } from '../db.js';
import { enqueueMany } from '../queue.js';
import * as sp from '../spotify.js';
import { pages, itemTrack, writePlaylist, shuffle } from '../rules.js';

let cache = null;
async function myPlaylists(force) {
  if (cache && !force) return cache;
  const me = await sp.me();
  const all = await pages(sp.api, '/me/playlists?limit=50');
  cache = all.filter((p) => p && (p.owner?.id === me.id || p.collaborative));
  return cache;
}

export function render(page, { args }) {
  if (!sp.connected()) {
    page.replaceChildren(head('Library', 'Playlist tools'),
      lockbox('Edit playlists in bulk', 'Sort by anything (including how often you actually play each song), remove duplicates, true-shuffle, split by decade, merge playlists, with undo. Playlist editing works on free accounts, but it needs a Spotify login.'));
    return;
  }
  return args[0] ? editor(page, args[0]) : list(page);
}

async function list(page) {
  const picked = new Set();
  page.replaceChildren(head('Library', 'Playlist tools', 'Only playlists you own or collaborate on: Spotify doesn\'t let new apps read anyone else\'s.'), h('div.loading', {}, 'Loading playlists…'));
  let pls;
  try { pls = await myPlaylists(true); } catch (e) { page.lastChild.replaceWith(h('p.err', {}, e.message)); return; }
  const mergeBtn = h('button.btn', { disabled: true, onclick: () => merge() }, 'Merge selected');
  const card = (p) => {
    const box = h('input', { type: 'checkbox', onchange: (e) => { e.target.checked ? picked.add(p.id) : picked.delete(p.id); mergeBtn.disabled = picked.size < 2; mergeBtn.textContent = picked.size >= 2 ? `Merge ${picked.size} into new playlist` : 'Merge selected'; } });
    const a = artEl({ name: p.name, artist: p.name, art: p.images?.[0]?.url, id: p.images?.length ? '' : null }, 'lg');
    return h('div', {},
      h('a.pcard', { href: '#/playlists/' + p.id }, a, h('div.t1', {}, p.name), h('div.t2', {}, `${num(p.items?.total ?? p.tracks?.total ?? 0)} songs${p.collaborative ? ' · collab' : ''}`)),
      h('label.check', { style: { marginTop: '6px', fontSize: '12px' } }, box, 'select'));
  };
  const merge = async () => {
    const name = prompt('Name for the merged playlist', 'Merged · ' + new Date().toLocaleDateString());
    if (!name) return;
    toast('Merging…');
    try {
      const ids = [];
      for (const id of picked) ids.push(...(await pages(sp.api, `/playlists/${id}/items?limit=100`)).map((e) => itemTrack(e)?.id));
      const uniq = [...new Set(ids.filter(Boolean))];
      const p = await sp.api('/me/playlists', { method: 'POST', body: { name, public: false, description: 'Merged with Crate' } });
      await writePlaylist(sp.api, p.id, uniq);
      toast(`Created "${name}" with ${uniq.length} songs (${ids.length - uniq.length} duplicates skipped)`);
      list(page);
    } catch (e) { toast(e.message); }
  };
  page.replaceChildren(
    head('Library', 'Playlist tools', 'Only playlists you own or collaborate on: Spotify doesn\'t let new apps read anyone else\'s.',
      h('div.row', {}, mergeBtn, h('button.btn', { onclick: async () => {
        const name = prompt('New playlist name');
        if (!name) return;
        const p = await sp.api('/me/playlists', { method: 'POST', body: { name, public: false } });
        location.hash = '#/playlists/' + p.id;
      } }, 'New playlist'))),
    h('div.pgrid', {},
      h('div', {}, h('a.pcard', { href: '#/playlists/liked' }, h('div.art.lg', {}, h('span.mono', {}, 'LIKED')), h('div.t1', {}, 'Liked Songs'), h('div.t2', {}, 'read-only · copy, split, sort'))),
      pls.map(card)));
}

async function editor(page, id) {
  const liked = id === 'liked';
  let meta = { name: 'Liked Songs' };
  let items = [];
  let view = [];
  const sel = new Set();
  let dupes = new Set();
  let sortKey = null, sortDir = 1, filter = '';
  let dirty = false;

  page.replaceChildren(head('Playlist tools', '…'), h('div.loading', {}, 'Loading songs…'));
  const playsBy = new Map();
  for (const p of state.plays) if (p.u && counted(p)) playsBy.set(p.u, (playsBy.get(p.u) || 0) + 1);

  try {
    let raw;
    if (liked) raw = (await pages(sp.api, '/me/tracks?limit=50')).map((e) => ({ added_at: e.added_at, item: e.track }));
    else {
      meta = await sp.api(`/playlists/${id}?fields=id,name,description,owner(id),collaborative,images`);
      raw = await pages(sp.api, `/playlists/${id}/items?limit=100`);
    }
    items = raw.map((e, i) => {
      const t = itemTrack(e) || {};
      const art = t.album?.images?.at(-1)?.url || '';
      if (t.id) setArt(t.id, art);
      return {
        pos: i, id: t.id || '', local: !!(e.is_local || t.is_local || !t.id), name: t.name || '(unavailable)',
        artist: (t.artists || []).map((a) => a.name).join(', '), album: t.album?.name || '', year: (t.album?.release_date || '').slice(0, 4),
        ms: t.duration_ms || 0, added: Date.parse(e.added_at) || 0, art, plays: playsBy.get(t.id) || 0, ep: t.type === 'episode',
      };
    });
  } catch (e) {
    page.replaceChildren(head('Playlist tools', 'Couldn\'t open playlist'), h('p.err', {}, e.message), h('a.btn', { href: '#/playlists' }, 'Back'));
    return;
  }

  const COLS = [['pos', '#'], [null, ''], [null, ''], ['name', 'Title'], ['artist', 'Artist'], ['album', 'Album'], ['year', 'Year'], ['ms', 'Length'], ['added', 'Added'], ['plays', 'Your plays']];
  const tableHost = h('div.tbl-wrap');
  const info = h('span.mono.dim', { style: { fontSize: '12px' } });
  const saveBtn = h('button.btn.solid', { onclick: () => save(), disabled: true }, 'Save to Spotify');

  const compute = () => {
    view = items.slice();
    if (sortKey) {
      view.sort((a, b) => {
        const x = a[sortKey], y = b[sortKey];
        return (typeof x === 'string' ? x.localeCompare(y, undefined, { sensitivity: 'base' }) : x - y) * sortDir;
      });
    }
  };

  const drawTable = () => {
    const f = filter.toLowerCase();
    const rows = f ? view.filter((t) => `${t.name} ${t.artist} ${t.album}`.toLowerCase().includes(f)) : view;
    const tbl = h('table.tbl', {},
      h('thead', {}, h('tr', {}, COLS.map(([k, l]) => h('th', {
        class: sortKey === k && k ? 'on' : '',
        onclick: () => { if (!k) return; if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = ['added', 'plays', 'ms', 'year'].includes(k) ? -1 : 1; } compute(); markDirty(k !== 'pos' || sortDir !== 1); drawTable(); },
      }, l, sortKey === k && k ? (sortDir > 0 ? ' ↑' : ' ↓') : '')))),
      h('tbody', {}, rows.slice(0, 1500).map((t, i) => h('tr', { class: (sel.has(t) ? 'sel ' : '') + (dupes.has(t) ? 'dupe' : '') },
        h('td.num', {}, i + 1),
        h('td', {}, h('input', { type: 'checkbox', checked: sel.has(t), onchange: (e) => { e.target.checked ? sel.add(t) : sel.delete(t); updateInfo(); e.target.closest('tr').classList.toggle('sel', e.target.checked); } })),
        h('td', {}, artEl({ id: t.id, art: t.art, name: t.name, artist: t.artist }, 'sm')),
        h('td', { title: t.name, style: { fontWeight: 600, cursor: 'pointer' }, ondblclick: () => openInSpotify(t) }, t.name, t.local ? h('span.pill', { style: { marginLeft: '6px' } }, t.ep ? 'episode' : 'local') : null),
        h('td', { title: t.artist }, t.artist), h('td', { title: t.album }, t.album),
        h('td.num', {}, t.year), h('td.num', {}, dur(t.ms)), h('td.num', {}, t.added ? date(t.added) : ''), h('td.num', {}, t.plays || '')))));
    tableHost.replaceChildren(tbl, rows.length > 1500 ? h('p.dim', {}, `Showing the first 1,500 of ${num(rows.length)}.`) : null);
    updateInfo();
  };

  const updateInfo = () => {
    const total = items.reduce((s, t) => s + t.ms, 0);
    info.textContent = `${num(items.length)} songs · ${Math.round(total / 60000)} min${sel.size ? ` · ${sel.size} selected` : ''}${dupes.size ? ` · ${dupes.size} duplicates` : ''}`;
  };

  const markDirty = (d = true) => { dirty = d && !liked; saveBtn.disabled = !dirty; saveBtn.textContent = dirty ? 'Save to Spotify' : 'Saved'; };

  const findDupes = () => {
    dupes = new Set();
    const seenId = new Set(), seenName = new Set();
    for (const t of view) {
      const nk = `${t.name.toLowerCase().replace(/\s*[-(].*(remaster|version|edit|mix).*$/i, '')}|${t.artist.split(',')[0].toLowerCase()}`;
      if ((t.id && seenId.has(t.id)) || seenName.has(nk)) dupes.add(t);
      if (t.id) seenId.add(t.id);
      seenName.add(nk);
    }
    sel.clear();
    dupes.forEach((t) => sel.add(t));
    toast(dupes.size ? `${dupes.size} duplicates found and selected (later copies)` : 'No duplicates');
    drawTable();
  };

  const removeSel = () => {
    if (!sel.size) return toast('Select songs first');
    items = items.filter((t) => !sel.has(t));
    dupes = new Set([...dupes].filter((t) => !sel.has(t)));
    sel.clear();
    compute(); markDirty(); drawTable();
  };

  const trueShuffle = () => { items = shuffle(items); sortKey = null; compute(); markDirty(); drawTable(); };

  const currentIds = () => view.filter((t) => t.id && !t.local).map((t) => t.id);

  const save = async () => {
    const ids = currentIds();
    const lost = view.filter((t) => t.local).length;
    if (lost && !confirm(`${lost} local files or episodes can't be re-added through the API and will be dropped. Continue?`)) return;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const prev = (await kvGet('snap:' + id)) || [];
      const before = items.length ? (await pages(sp.api, `/playlists/${id}/items?limit=100`)).map((e) => itemTrack(e)?.id).filter(Boolean) : [];
      await kvSet('snap:' + id, [{ t: Date.now(), ids: before }, ...prev].slice(0, 5));
      await writePlaylist(sp.api, id, ids);
      items = view.slice();
      sortKey = null;
      items.forEach((t, i) => (t.pos = i));
      compute();
      markDirty(false);
      drawTable();
      toast(`Saved ${ids.length} songs. Undo is under "Versions".`);
    } catch (e) { toast(e.message); markDirty(); }
  };

  const restore = async () => {
    const snaps = (await kvGet('snap:' + id)) || [];
    if (!snaps.length) return toast('No saved versions yet. Crate keeps one each time you save.');
    const pick = prompt(`Restore which version?\n${snaps.map((s, i) => `${i + 1}: ${new Date(s.t).toLocaleString()} (${s.ids.length} songs)`).join('\n')}`, '1');
    const s = snaps[Number(pick) - 1];
    if (!s) return;
    await writePlaylist(sp.api, id, s.ids);
    toast('Restored. Reloading…');
    editor(page, id);
  };

  const newPlaylist = async (name, ids, desc = 'Made with Crate') => {
    const p = await sp.api('/me/playlists', { method: 'POST', body: { name, public: false, description: desc } });
    await writePlaylist(sp.api, p.id, ids);
    cache = null;
    return p;
  };

  const copy = async () => {
    const ids = sel.size ? view.filter((t) => sel.has(t) && t.id).map((t) => t.id) : currentIds();
    const name = prompt(`Name for the new playlist (${ids.length} songs)`, `${meta.name} (copy)`);
    if (!name) return;
    try { const p = await newPlaylist(name, ids); toast(`Created "${p.name}"`); } catch (e) { toast(e.message); }
  };

  const split = async () => {
    const how = prompt('Split by:\n1 = decade (album release)\n2 = played by you vs never played\n3 = main artist (artists with 5+ songs)', '1');
    const groups = new Map();
    for (const t of view) {
      if (!t.id) continue;
      let k;
      if (how === '1') k = t.year ? t.year.slice(0, 3) + '0s' : null;
      else if (how === '2') k = t.plays ? 'played' : 'never played';
      else if (how === '3') k = t.artist.split(',')[0];
      else return;
      if (!k) continue;
      (groups.get(k) || groups.set(k, []).get(k)).push(t.id);
    }
    const out = [...groups.entries()].filter(([, ids]) => how !== '3' || ids.length >= 5);
    if (!out.length) return toast('Nothing to split');
    if (!confirm(`Create ${out.length} new playlists?\n${out.map(([k, v]) => `${meta.name} · ${k} (${v.length})`).join('\n')}`)) return;
    try {
      for (const [k, ids] of out) await newPlaylist(`${meta.name} · ${k}`, ids);
      toast(`Created ${out.length} playlists`);
    } catch (e) { toast(e.message); }
  };

  const csv = () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['#', 'Title', 'Artist', 'Album', 'Year', 'Length', 'Added', 'Your plays', 'Spotify URL'].join(',')]
      .concat(view.map((t, i) => [i + 1, t.name, t.artist, t.album, t.year, dur(t.ms), t.added ? new Date(t.added).toISOString().slice(0, 10) : '', t.plays, t.id ? 'https://open.spotify.com/track/' + t.id : ''].map(esc).join(',')));
    download(`${meta.name.replace(/[^\w -]/g, '')}.csv`, new Blob([lines.join('\n')], { type: 'text/csv' }));
  };

  compute();
  page.replaceChildren(
    head(liked ? 'Liked Songs · read-only' : 'Playlist tools', meta.name, liked ? 'Spotify doesn\'t let apps reorder Liked Songs, but you can sort, filter, copy, split and export it.' : null,
      h('div.row', {}, h('a.btn.ghost', { href: '#/playlists' }, '← All playlists'), liked ? null : saveBtn)),
    h('div.row', { style: { marginBottom: '14px' } },
      h('input', { type: 'search', placeholder: 'Filter  ( / )', style: { width: '200px' }, oninput: debounce((e) => { filter = e.target.value; drawTable(); }, 150) }),
      h('button.btn.small', { onclick: findDupes }, 'Find duplicates'),
      liked ? null : h('button.btn.small', { onclick: removeSel }, 'Remove selected'),
      liked ? null : h('button.btn.small', { onclick: trueShuffle }, 'True shuffle'),
      h('button.btn.small', { onclick: copy }, 'Copy to new playlist'),
      h('button.btn.small', { onclick: split }, 'Split…'),
      h('button.btn.small', { onclick: () => enqueueMany((sel.size ? view.filter((t) => sel.has(t)) : view).filter((t) => t.id).slice(0, 200)) }, 'Add to Up Next'),
      h('button.btn.small', { onclick: csv }, 'Export CSV'),
      liked ? null : h('button.btn.small.ghost', { onclick: restore }, 'Versions'),
      h('div.spacer'), info),
    h('p.dim', { style: { fontSize: '12.5px', margin: '0 0 10px' } }, 'Click a column to sort, then Save to keep that order. Double-click a title to open it in Spotify.'),
    tableHost);
  drawTable();
  const warn = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', warn);
  return () => window.removeEventListener('beforeunload', warn);
}
export { sectionTitle };
