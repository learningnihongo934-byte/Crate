// What's playing. In the Mac app, Crate talks to the Spotify app directly (full control, any account,
// no login) and logs every play itself. On the web it falls back to the Spotify Web API (read-only).
import * as sp from './spotify.js';
import { setArt } from './art.js';
import { syncRecent, addPlays } from './data.js';
import { queue, takeNext } from './queue.js';

export const N = window.crateNative || null;
export const isNative = !!N;

export const np = {
  item: null, progress: 0, playing: false, at: 0, error: '', native: isNative, running: false,
  volume: 50, shuffle: false, repeat: false,
  loop: null,   // { a, b } in ms
  sleep: null,  // { at: ms timestamp } or { endOfTrack: true }
};
let timer = null, lastId = '', lastSync = 0;
const emitNp = () => window.dispatchEvent(new Event('crate:np'));

// ---------- web API mode ----------
function toItem(tr) {
  if (!tr) return null;
  const art = tr.album?.images?.[0]?.url || '';
  setArt(tr.id, tr.album?.images?.at(-2)?.url || art);
  return { id: tr.id, name: tr.name, artist: (tr.artists || []).map((a) => a.name).join(', '), album: tr.album?.name || '', art, duration: tr.duration_ms };
}
async function apiTick() {
  if (!sp.connected() || document.hidden) return;
  try {
    const r = await sp.api('/me/player/currently-playing?additional_types=episode');
    const prevId = lastId;
    np.item = r?.item ? toItem(r.item) : null;
    np.progress = r?.progress_ms || 0;
    np.playing = !!r?.is_playing;
    np.at = Date.now();
    np.error = '';
    lastId = np.item?.id || '';
    if (lastId !== prevId) window.dispatchEvent(new CustomEvent('crate:trackchange', { detail: { prev: prevId, now: lastId } }));
  } catch (e) { np.error = e.message; }
  emitNp();
  if (Date.now() - lastSync > 4 * 60000) { lastSync = Date.now(); syncRecent().catch(() => {}); }
}

// ---------- native mode ----------
let cur = null;          // track being listened to: { item, listened, lastPos, startedAt }
let expectId = '';       // track Crate just started from Up Next
let advancedFor = '';    // don't advance twice for the same track
let fading = false;

function finishCurrent() {
  if (!cur) return;
  const { item, listened } = cur;
  cur = null;
  if (listened < 5000 || !item.id) return;
  const t = Date.now();
  const skipped = listened < item.duration * 0.8 && listened < item.duration - 10000;
  addPlays([{ t, ms: Math.round(listened), n: item.name, a: item.artist.split(', ')[0] || item.artist, b: item.album, u: item.id, s: skipped ? 1 : 0, src: 'n', k: `${Math.round(t / 1000)}|${item.id}` }]).catch(() => {});
}

export async function cmd(action, arg) {
  if (!N) return;
  const r = await N.cmd(action, arg);
  setTimeout(nativeTick, 150);
  return r;
}

export async function playUri(id) {
  if (!N || !id) return false;
  expectId = id;
  advancedFor = '';
  await cmd('playTrack', 'spotify:track:' + id);
  return true;
}

async function advanceQueue() {
  const next = takeNext();
  if (next) await playUri(next.id);
}

async function nativeTick() {
  let s;
  try { s = await N.state(); } catch (e) { np.error = e.message; return; }
  if (!s) return;
  np.running = !!s.running;
  np.error = s.error || '';
  const playing = s.state === 'playing';
  if (!s.running || s.state === 'stopped' || !s.id) {
    finishCurrent();
    np.item = null;
    np.playing = false;
    lastId = '';
    np.at = Date.now();
    emitNp();
    return;
  }
  const item = { id: s.id, name: s.name, artist: s.artist, album: s.album, art: s.art, duration: s.duration, type: s.type };
  if (s.art) setArt(s.id, s.art);
  const pos = s.position;

  // play logging
  if (cur && cur.item.id === item.id) {
    const d = pos - cur.lastPos;
    if (cur.lastPlaying && d > 0 && d < 6000) cur.listened += d;
    // the same song started again (repeat, or replayed)
    if (d < -15000 && cur.lastPos > item.duration - 8000 && pos < 8000) { finishCurrent(); cur = { item, listened: pos, lastPos: pos, lastPlaying: playing }; }
    else { cur.lastPos = pos; cur.lastPlaying = playing; }
  } else {
    const prev = cur?.item;
    const endedNaturally = cur && cur.lastPos > prev.duration - 6000;
    finishCurrent();
    cur = { item, listened: 0, lastPos: pos, lastPlaying: playing };
    const prevId = lastId;
    lastId = item.id;
    window.dispatchEvent(new CustomEvent('crate:trackchange', { detail: { prev: prevId, now: item.id } }));
    if (np.sleep?.endOfTrack && prevId) { np.sleep = null; cmd('pause'); }
    // Spotify moved on by itself: take over with Up Next
    else if (endedNaturally && item.id !== expectId && queue().some((q) => q.id) && advancedFor !== prevId) { advancedFor = prevId; advanceQueue(); }
    if (item.id === expectId) expectId = '';
  }

  // Up Next: start the next queued song just before this one ends
  if (playing && queue().some((q) => q.id) && item.duration - pos < 2200 && advancedFor !== item.id && !np.loop) {
    advancedFor = item.id;
    advanceQueue();
  }

  // A-B loop
  if (np.loop && playing && pos >= np.loop.b) cmd('seek', np.loop.a / 1000);

  // sleep timer
  if (np.sleep?.at && Date.now() >= np.sleep.at && !fading) sleepNow();

  np.item = item;
  np.progress = pos;
  np.playing = playing;
  np.volume = s.volume;
  np.shuffle = s.shuffle;
  np.repeat = s.repeat;
  np.at = Date.now();
  emitNp();
}

async function sleepNow() {
  fading = true;
  const start = np.volume || 50;
  for (let i = 1; i <= 10; i++) { await N.cmd('volume', start * (1 - i / 10)); await new Promise((ok) => setTimeout(ok, 700)); }
  await N.cmd('pause');
  await N.cmd('volume', start);
  np.sleep = null;
  fading = false;
  nativeTick();
}

export function setSleep(minutes) {
  if (minutes === 'track') np.sleep = { endOfTrack: true };
  else if (minutes) np.sleep = { at: Date.now() + minutes * 60000 };
  else np.sleep = null;
  emitNp();
}
export function setLoop(loop) { np.loop = loop; restart(); emitNp(); }

function restart() {
  clearInterval(timer);
  timer = setInterval(isNative ? nativeTick : apiTick, isNative ? (np.loop ? 300 : 1000) : 5000);
}

export function startPolling() {
  if (timer) return;
  restart();
  (isNative ? nativeTick : apiTick)();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !isNative) apiTick(); });
}

export const progressNow = () => (np.playing ? Math.min(np.item?.duration || 0, np.progress + (Date.now() - np.at)) : np.progress);
export const canSee = () => isNative || sp.connected();
