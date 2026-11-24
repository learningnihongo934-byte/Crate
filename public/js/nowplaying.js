// Polls what's playing in the user's Spotify app (works on free accounts: read-only).
import * as sp from './spotify.js';
import { setArt } from './art.js';
import { syncRecent } from './data.js';

export const np = { item: null, progress: 0, playing: false, at: 0, error: '' };
let timer = null, lastId = '', lastSync = 0;

function toItem(tr) {
  if (!tr) return null;
  const art = tr.album?.images?.[0]?.url || '';
  setArt(tr.id, tr.album?.images?.at(-2)?.url || art);
  return { id: tr.id, name: tr.name, artist: (tr.artists || []).map((a) => a.name).join(', '), album: tr.album?.name || '', albumId: tr.album?.id || '', art, duration: tr.duration_ms, type: tr.type };
}

async function tick() {
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
  } catch (e) {
    np.error = e.message;
  }
  window.dispatchEvent(new Event('crate:np'));
  if (Date.now() - lastSync > 4 * 60000) { lastSync = Date.now(); syncRecent().catch(() => {}); }
}

export function startPolling() {
  if (timer) return;
  tick();
  timer = setInterval(tick, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}

export const progressNow = () => (np.playing ? Math.min(np.item?.duration || 0, np.progress + (Date.now() - np.at)) : np.progress);
