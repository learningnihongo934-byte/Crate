// Small DOM + formatting helpers.
export function h(tag, attrs = {}, ...kids) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const svgNS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid != null) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}

export const nf = new Intl.NumberFormat('en-US');
export const num = (n) => nf.format(Math.round(n || 0));
export const mins = (ms) => num((ms || 0) / 60000);
export const hrs = (ms) => ((ms || 0) / 3600000).toFixed((ms || 0) < 36e6 ? 1 : 0);
export function dur(ms) {
  const sec = Math.round((ms || 0) / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
export function longDur(ms) {
  const m = Math.round((ms || 0) / 60000);
  if (m < 60) return `${m} min`;
  const hh = Math.floor(m / 60);
  if (hh < 48) return `${hh} h ${m % 60} min`;
  return `${num(hh / 24)} days`;
}
const dfmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const mfmt = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' });
export const date = (t) => (t ? dfmt.format(new Date(t)) : '');
export const month = (t) => (t ? mfmt.format(new Date(t)) : '');
export function ago(t) {
  const d = (Date.now() - t) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)} d ago`;
  return date(t);
}
export const pad2 = (n) => String(n).padStart(2, '0');
export const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

export function initials(name = '') {
  const w = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] || '?') + (w[1]?.[0] || '')).toUpperCase();
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function toast(text, ms = 3200) {
  const el = h('div.toast', {}, text);
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, ms);
}

export function parseSpotifyLink(text) {
  const m = String(text).match(/(?:open\.spotify\.com\/(?:intl-[a-z]+\/)?|spotify:)(track|album|playlist|artist)[/:]([A-Za-z0-9]{22})/);
  return m ? { type: m[1], id: m[2] } : null;
}

export function download(name, blob) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

// Open a track in the user's Spotify (app by default, web player as fallback setting).
export function openInSpotify(item) {
  const mode = localStorage.getItem('crate.openIn') || 'app';
  let href;
  if (item.id) href = mode === 'web' ? `https://open.spotify.com/track/${item.id}` : `spotify:track:${item.id}`;
  else {
    const q = encodeURIComponent(`${item.name || ''} ${item.artist || ''}`.trim());
    href = mode === 'web' ? `https://open.spotify.com/search/${q}` : `spotify:search:${q}`;
  }
  const a = h('a', { href, target: mode === 'web' ? '_blank' : null, rel: 'noopener' });
  document.body.append(a);
  a.click();
  a.remove();
}
