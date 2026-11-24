// Album art for history rows. Uses Spotify's public oEmbed (via our Worker, cached), so it
// works without logging in. Missing art falls back to a grey monogram block.
import { artGet, artPut } from './db.js';
import { h, initials } from './util.js';

const mem = new Map();
const waiting = [];
let active = 0;

function pump() {
  while (active < 5 && waiting.length) {
    const job = waiting.shift();
    active++;
    job().finally(() => { active--; pump(); });
  }
}

export function getArt(id, type = 'track') {
  if (!id) return Promise.resolve('');
  const key = type + ':' + id;
  if (mem.has(key)) return mem.get(key);
  const p = (async () => {
    const c = await artGet(key).catch(() => null);
    if (c && (c.url || Date.now() - c.t < 864e5)) return c.url;
    return new Promise((ok) => {
      waiting.push(async () => {
        try {
          const r = await fetch(`/api/art?type=${type}&id=${id}`);
          const d = r.ok ? await r.json() : { thumb: '' };
          await artPut(key, d.thumb || '').catch(() => {});
          ok(d.thumb || '');
        } catch { ok(''); }
      });
      pump();
    });
  })();
  mem.set(key, p);
  return p;
}
export const setArt = (id, url, type = 'track') => { if (id && url) mem.set(type + ':' + id, Promise.resolve(url)); };

const io = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        fill(e.target);
      }
    }, { rootMargin: '200px' })
  : null;

function fill(el) {
  getArt(el.dataset.id, el.dataset.type).then((url) => {
    if (!url) return;
    const img = new Image();
    img.alt = '';
    img.loading = 'lazy';
    img.onload = () => { el.classList.add('has'); };
    img.src = url;
    el.append(img);
  });
}

// <div class="art"> with monogram; lazily swaps in the cover when scrolled into view.
export function artEl(item, size = '') {
  const el = h('div.art' + (size ? '.' + size : ''), {}, h('span.mono', {}, initials(item.artist || item.name)));
  if (item.art) {
    const img = new Image();
    img.alt = '';
    img.onload = () => el.classList.add('has');
    img.src = item.art;
    el.append(img);
  } else if (item.id) {
    el.dataset.id = item.id;
    el.dataset.type = item.type || 'track';
    io ? io.observe(el) : fill(el);
  }
  return el;
}
