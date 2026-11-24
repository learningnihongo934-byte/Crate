// Smart-playlist rules. Shared by the browser and the Worker's daily cron,
// so it must not touch the DOM. `api(pathOrUrl, {method, body})` is injected.

export const SOURCES = {
  top:            { label: 'Your top tracks, per Spotify', cloud: true },
  liked_recent:   { label: 'Liked songs added in the last N days', cloud: true },
  liked_year:     { label: 'Liked songs added in a given year', cloud: true },
  liked_random:   { label: 'Random pick of liked songs (new pick every run)', cloud: true },
  recent:         { label: 'Recently played (last 50)', cloud: true },
  merge:          { label: 'Combine playlists you own', cloud: true },
  hist_top:       { label: 'Most played in your history', cloud: false },
  hist_repeat:    { label: 'On repeat lately', cloud: false },
  hist_forgotten: { label: 'Forgotten favorites', cloud: false },
  hist_never:     { label: 'Liked but never played (history)', cloud: false },
};

export const defaultParams = (source) => ({
  top: { range: 'short_term' },
  liked_recent: { days: 30 },
  liked_year: { year: new Date().getFullYear() - 1 },
  liked_random: {},
  recent: {},
  merge: { playlists: [] },
  hist_top: { days: 30 },
  hist_repeat: { days: 14 },
  hist_forgotten: { minPlays: 15, notInDays: 180 },
  hist_never: {},
}[source] || {});

export async function pages(api, path, stop) {
  const out = [];
  let url = path;
  while (url) {
    const r = await api(url);
    for (const it of r.items || []) {
      if (stop && stop(it)) return out;
      out.push(it);
    }
    url = r.next;
  }
  return out;
}

export const itemTrack = (e) => e && (e.item || e.track);

export async function likedSongs(api, stop) {
  return pages(api, '/me/tracks?limit=50', stop);
}

async function collect(api, rule, ctx = {}) {
  const p = rule.params || {};
  switch (rule.source) {
    case 'top': {
      const a = await api(`/me/top/tracks?limit=50&time_range=${p.range}`);
      let b = { items: [] };
      try { b = await api(`/me/top/tracks?limit=50&offset=50&time_range=${p.range}`); } catch {}
      return [...a.items, ...b.items].map((t) => t.id);
    }
    case 'liked_recent': {
      const cut = Date.now() - (p.days || 30) * 864e5;
      return (await likedSongs(api, (it) => Date.parse(it.added_at) < cut)).map((it) => it.track?.id);
    }
    case 'liked_year':
      return (await likedSongs(api))
        .filter((it) => new Date(it.added_at).getUTCFullYear() === Number(p.year))
        .map((it) => it.track?.id);
    case 'liked_random':
      return shuffle((await likedSongs(api)).map((it) => it.track?.id));
    case 'recent':
      return (await api('/me/player/recently-played?limit=50')).items.map((it) => it.track?.id);
    case 'merge': {
      const ids = [];
      for (const id of p.playlists || []) {
        const items = await pages(api, `/playlists/${id}/items?limit=100`);
        ids.push(...items.map((e) => itemTrack(e)?.id));
      }
      return ids;
    }
    default:
      if (ctx.history) return ctx.history(rule);
      throw new Error('This rule uses your imported history, so it only runs in the browser.');
  }
}

export function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function finish(ids, rule) {
  let out = [...new Set(ids.filter((id) => id && /^[A-Za-z0-9]{22}$/.test(id)))];
  if (rule.order === 'random') out = shuffle(out);
  if (rule.order === 'reverse') out.reverse();
  return out.slice(0, Math.max(1, Math.min(Number(rule.limit) || 50, 1000)));
}

export async function writePlaylist(api, playlistId, ids) {
  const uris = ids.map((id) => 'spotify:track:' + id);
  await api(`/playlists/${playlistId}/items`, { method: 'PUT', body: { uris: uris.slice(0, 100) } });
  for (let i = 100; i < uris.length; i += 100) {
    await api(`/playlists/${playlistId}/items`, { method: 'POST', body: { uris: uris.slice(i, i + 100) } });
  }
}

export async function runRule(api, rule, ctx) {
  const ids = finish(await collect(api, rule, ctx), rule);
  await writePlaylist(api, rule.playlistId, ids);
  return ids.length;
}
