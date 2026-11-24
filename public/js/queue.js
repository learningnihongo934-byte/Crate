// Crate's own Up Next. Free accounts can't touch Spotify's queue, so Crate keeps its own
// and opens each song in Spotify when you move to it.
import { kvGet, kvSet } from './db.js';
import { openInSpotify, toast } from './util.js';

let q = [];
let history = [];
export const queue = () => q;
export const played = () => history;
const changed = () => { kvSet('queue', q); kvSet('queueHistory', history.slice(0, 50)); window.dispatchEvent(new Event('crate:queue')); };

export async function loadQueue() {
  q = (await kvGet('queue')) || [];
  history = (await kvGet('queueHistory')) || [];
}

const clean = (t) => ({ id: t.id || t.u || '', name: t.name || t.n || '', artist: t.artist || t.a || '', art: t.art || '', key: Math.random().toString(36).slice(2, 9) });

export function enqueue(t, { next = false, quiet = false } = {}) {
  const item = clean(t);
  if (next) q.unshift(item); else q.push(item);
  changed();
  if (!quiet) toast(next ? `Playing next: ${item.name}` : `Added to Up Next: ${item.name}`);
}
export function enqueueMany(list) { for (const t of list) q.push(clean(t)); changed(); toast(`Added ${list.length} songs to Up Next`); }
export function removeAt(key) { q = q.filter((x) => x.key !== key); changed(); }
export function move(key, dir) {
  const i = q.findIndex((x) => x.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= q.length) return;
  [q[i], q[j]] = [q[j], q[i]];
  changed();
}
export function moveTo(key, j) {
  const i = q.findIndex((x) => x.key === key);
  if (i < 0) return;
  const [x] = q.splice(i, 1);
  q.splice(Math.max(0, Math.min(q.length, j)), 0, x);
  changed();
}
export function clearQueue() { q = []; changed(); }
export function shuffleQueue() {
  for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; }
  changed();
}
// Pop the next song and open it in Spotify. Must run inside a click/keypress.
export function playNext() {
  const item = q.shift();
  if (!item) { toast('Up Next is empty'); return null; }
  history.unshift(item);
  changed();
  openInSpotify(item);
  return item;
}
export function playItem(key) {
  const i = q.findIndex((x) => x.key === key);
  if (i < 0) return;
  const [item] = q.splice(i, 1);
  history.unshift(item);
  changed();
  openInSpotify(item);
}
