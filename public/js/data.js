// In-memory listening history + range selection + live sync from Spotify's recently-played.
import { allPlays, putPlays, deletePlays, clearPlays, kvGet, kvSet } from './db.js';
import * as sp from './spotify.js';
import { setArt } from './art.js';

export const state = {
  plays: [],
  range: JSON.parse(localStorage.getItem('crate.range') || '{"preset":"1y"}'),
};

export const emit = () => window.dispatchEvent(new Event('crate:data'));

export async function load() {
  state.plays = (await allPlays()).sort((a, b) => a.t - b.t);
}

export async function addPlays(rows) {
  const have = new Set(state.plays.map((p) => p.k));
  const fresh = rows.filter((r) => !have.has(r.k) && (have.add(r.k), true));
  // drop live-logged plays that the export now covers (same track within 2 minutes)
  const exp = new Map();
  for (const r of fresh) if (r.src === 'x' && r.u) (exp.get(r.u) || exp.set(r.u, []).get(r.u)).push(r.t);
  const dupes = state.plays.filter((p) => p.src === 'a' && exp.get(p.u)?.some((t) => Math.abs(t - p.t) < 120000));
  if (dupes.length) await deletePlays(dupes.map((p) => p.k));
  const dk = new Set(dupes.map((p) => p.k));
  await putPlays(fresh);
  state.plays = state.plays.filter((p) => !dk.has(p.k)).concat(fresh).sort((a, b) => a.t - b.t);
  emit();
  return fresh.length;
}

export async function removeSource(src) {
  const gone = state.plays.filter((p) => !src || p.src === src);
  if (!src) await clearPlays(); else await deletePlays(gone.map((p) => p.k));
  state.plays = src ? state.plays.filter((p) => p.src !== src) : [];
  emit();
  return gone.length;
}

export const hasSample = () => state.plays.some((p) => p.src === 'd');

// Pull recent plays from the API so the history keeps growing while Crate is open.
let syncing = false;
export async function syncRecent() {
  if (!sp.connected() || syncing) return 0;
  syncing = true;
  try {
    const after = (await kvGet('lastApiPlay')) || 0;
    const r = await sp.api(`/me/player/recently-played?limit=50${after ? '&after=' + after : ''}`);
    const rows = [];
    let newest = after;
    for (const it of r?.items || []) {
      const t = Date.parse(it.played_at);
      const tr = it.track;
      if (!tr || !t) continue;
      newest = Math.max(newest, t);
      setArt(tr.id, tr.album?.images?.at(-2)?.url || tr.album?.images?.[0]?.url);
      const near = state.plays.some((p) => p.u === tr.id && Math.abs(p.t - t) < 120000);
      if (near) continue;
      rows.push({ t, ms: tr.duration_ms, n: tr.name, a: tr.artists?.[0]?.name || '', b: tr.album?.name || '', u: tr.id, s: 0, src: 'a', k: `${Math.round(t / 1000)}|${tr.id}` });
    }
    if (newest > after) await kvSet('lastApiPlay', newest);
    return rows.length ? addPlays(rows) : 0;
  } finally {
    syncing = false;
  }
}

// ----- ranges -----
export const PRESETS = [['4w', '4 weeks'], ['6m', '6 months'], ['1y', '12 months'], ['all', 'All time']];

export function setRange(r) {
  state.range = r;
  localStorage.setItem('crate.range', JSON.stringify(r));
  emit();
}

export function years() {
  if (!state.plays.length) return [];
  const a = new Date(state.plays[0].t).getFullYear();
  const b = new Date(state.plays.at(-1).t).getFullYear();
  const out = [];
  for (let y = b; y >= a; y--) out.push(y);
  return out;
}

export function bounds(r = state.range) {
  const now = Date.now();
  const end = state.plays.length ? Math.max(now, state.plays.at(-1).t) : now;
  switch (r.preset) {
    case '4w': return [now - 28 * 864e5, end];
    case '6m': return [now - 182 * 864e5, end];
    case '1y': return [now - 365 * 864e5, end];
    case 'year': return [new Date(r.year, 0, 1).getTime(), new Date(r.year + 1, 0, 1).getTime()];
    case 'custom': return [Date.parse(r.from) || 0, (Date.parse(r.to) || now) + 864e5];
    default: return [0, Infinity];
  }
}

export function rangeLabel(r = state.range) {
  if (r.preset === 'year') return String(r.year);
  if (r.preset === 'custom') return `${r.from} → ${r.to}`;
  return PRESETS.find((p) => p[0] === r.preset)?.[1] || 'All time';
}

export function inRange(r = state.range) {
  const [a, b] = bounds(r);
  const P = state.plays;
  // binary search start
  let lo = 0, hi = P.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (P[m].t < a) lo = m + 1; else hi = m; }
  const out = [];
  for (let i = lo; i < P.length && P[i].t < b; i++) out.push(P[i]);
  return out;
}
