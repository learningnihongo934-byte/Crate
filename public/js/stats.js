// Pure stats over arrays of plays.
import { dayKey } from './util.js';

export const counted = (p) => p.ms >= 30000; // Spotify counts a stream at 30 s
export const trackKey = (p) => (p.u ? p.u : `${p.n}|${p.a}`.toLowerCase());

export function totals(plays) {
  let ms = 0, n = 0, skips = 0;
  const tracks = new Set(), artists = new Set(), days = new Set();
  for (const p of plays) {
    ms += p.ms;
    if (counted(p)) n++;
    if (p.s) skips++;
    tracks.add(trackKey(p));
    artists.add(p.a);
    days.add(dayKey(p.t));
  }
  return { ms, plays: n, rows: plays.length, skips, tracks: tracks.size, artists: artists.size, days: days.size };
}

// by: 'track' | 'artist' | 'album'; metric: 'ms' | 'plays'
export function top(plays, by = 'track', metric = 'ms', limit = 50) {
  const m = new Map();
  for (const p of plays) {
    const key = by === 'track' ? trackKey(p) : by === 'artist' ? p.a.toLowerCase() : `${p.b}|${p.a}`.toLowerCase();
    if (by === 'album' && !p.b) continue;
    let e = m.get(key);
    if (!e) {
      e = { key, name: by === 'artist' ? p.a : by === 'album' ? p.b : p.n, artist: p.a, id: p.u, ms: 0, plays: 0, skips: 0, first: p.t, last: p.t, ids: {} };
      m.set(key, e);
    }
    e.ms += p.ms;
    if (counted(p)) e.plays++;
    if (p.s) e.skips++;
    if (p.t < e.first) e.first = p.t;
    if (p.t > e.last) e.last = p.t;
    if (p.u) { e.ids[p.u] = (e.ids[p.u] || 0) + 1; if (!e.id) e.id = p.u; }
  }
  const arr = [...m.values()];
  // artists/albums: use their most-played track for art
  for (const e of arr) if (by !== 'track') e.id = Object.entries(e.ids).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  arr.sort((a, b) => b[metric] - a[metric] || b.ms - a.ms);
  return limit ? arr.slice(0, limit) : arr;
}

export function byMonth(plays) {
  const m = new Map();
  for (const p of plays) {
    const d = new Date(p.t);
    const k = d.getFullYear() * 12 + d.getMonth();
    m.set(k, (m.get(k) || 0) + p.ms);
  }
  if (!m.size) return [];
  const ks = [...m.keys()];
  const out = [];
  for (let k = Math.min(...ks); k <= Math.max(...ks); k++) out.push({ y: Math.floor(k / 12), m: k % 12, ms: m.get(k) || 0 });
  return out;
}

export function byDay(plays) {
  const m = new Map();
  for (const p of plays) { const k = dayKey(p.t); m.set(k, (m.get(k) || 0) + p.ms); }
  return m;
}

// 7 x 24 grid of ms (Mon first)
export function clock(plays) {
  const g = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const p of plays) {
    const d = new Date(p.t - p.ms / 2);
    g[(d.getDay() + 6) % 7][d.getHours()] += p.ms;
  }
  return g;
}

// Weeks where one track was played the most (sliding 7-day window).
export function peakWeeks(plays, limit = 12) {
  const by = new Map();
  for (const p of plays) if (counted(p)) (by.get(trackKey(p)) || by.set(trackKey(p), []).get(trackKey(p))).push(p);
  const out = [];
  for (const arr of by.values()) {
    if (arr.length < 5) continue;
    let best = 0, at = 0, j = 0;
    for (let i = 0; i < arr.length; i++) {
      while (arr[i].t - arr[j].t > 7 * 864e5) j++;
      if (i - j + 1 > best) { best = i - j + 1; at = arr[j].t; }
    }
    const p = arr[0];
    out.push({ name: p.n, artist: p.a, id: p.u, plays: best, at, total: arr.length });
  }
  return out.sort((a, b) => b.plays - a.plays).slice(0, limit);
}

// Longest run of consecutive days with at least one play.
export function streaks(plays, by = 'artist', limit = 10) {
  const days = new Map();
  for (const p of plays) {
    if (!counted(p)) continue;
    const key = by === 'artist' ? p.a : trackKey(p);
    let e = days.get(key);
    if (!e) days.set(key, (e = { name: by === 'artist' ? p.a : p.n, artist: p.a, id: p.u, set: new Set() }));
    e.set.add(Math.floor((p.t - new Date(p.t).getTimezoneOffset() * 60000) / 864e5));
  }
  const out = [];
  for (const e of days.values()) {
    const ds = [...e.set].sort((a, b) => a - b);
    let best = 1, cur = 1, end = ds[0];
    for (let i = 1; i < ds.length; i++) {
      cur = ds[i] === ds[i - 1] + 1 ? cur + 1 : 1;
      if (cur > best) { best = cur; end = ds[i]; }
    }
    if (best >= 3) out.push({ name: e.name, artist: e.artist, id: e.id, days: best, end: end * 864e5 });
  }
  return out.sort((a, b) => b.days - a.days).slice(0, limit);
}

// Tracks you played a lot, then stopped.
export function dropped(all, quietDays = 120, limit = 12) {
  const cut = Date.now() - quietDays * 864e5;
  return top(all, 'track', 'plays', 0)
    .filter((e) => e.last < cut && e.plays >= 10)
    .sort((a, b) => b.plays - a.plays)
    .slice(0, limit);
}

export function mostSkipped(plays, limit = 12) {
  return top(plays, 'track', 'plays', 0)
    .map((e) => ({ ...e, rows: e.plays + e.skips }))
    .filter((e) => e.skips >= 4)
    .map((e) => ({ ...e, rate: e.skips / (e.skips + e.plays) }))
    .sort((a, b) => b.rate - a.rate || b.skips - a.skips)
    .slice(0, limit);
}

// New artists discovered per month (first ever play).
export function discoveries(all) {
  const first = new Map();
  for (const p of all) if (counted(p) && !first.has(p.a)) first.set(p.a, p.t);
  const m = new Map();
  for (const t of first.values()) { const d = new Date(t); const k = `${d.getFullYear()}-${d.getMonth()}`; m.set(k, (m.get(k) || 0) + 1); }
  return { first, perMonth: m };
}

export function trackHistory(all, item) {
  const key = item.id || `${item.name}|${item.artist}`.toLowerCase();
  const rows = all.filter((p) => trackKey(p) === key || (item.id && p.u === item.id));
  const t = totals(rows);
  const ranked = top(all, 'track', 'plays', 0);
  const rank = ranked.findIndex((e) => e.key === key) + 1;
  return { ...t, first: rows[0]?.t, last: rows.at(-1)?.t, rank, of: ranked.length };
}
