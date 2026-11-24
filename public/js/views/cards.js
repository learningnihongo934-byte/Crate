import { h, num, hrs, download, toast } from '../util.js';
import { state, inRange, rangeLabel } from '../data.js';
import { top, totals, clock } from '../stats.js';
import { head, rangePicker, emptyHistory } from '../ui.js';
import { getArt } from '../art.js';

const KINDS = [['summary', 'Summary'], ['artists', 'Top artists'], ['songs', 'Top songs'], ['clock', 'Listening clock']];
const SIZES = [['post', '4:5 post', 1350], ['story', '9:16 story', 1920]];
const C = { bg: '#151515', line: '#2c2c2c', text: '#ebe8e2', muted: '#9a968f', dim: '#66635e', raise: '#222222' };

export function render(page) {
  const ui = JSON.parse(sessionStorage.getItem('crate.card') || '{"kind":"summary","size":"post","name":""}');
  const canvas = h('canvas', { width: 1080, height: 1350 });
  let token = 0;

  const draw = async () => {
    sessionStorage.setItem('crate.card', JSON.stringify(ui));
    const my = ++token;
    canvas.height = SIZES.find((s) => s[0] === ui.size)[2];
    await document.fonts.load('700 80px Archivo').catch(() => {});
    await document.fonts.load('500 30px "IBM Plex Mono"').catch(() => {});
    if (my !== token) return;
    await paint(canvas, ui, () => my === token);
  };

  const controls = () => h('div', {},
    h('label.field', { style: { marginBottom: '18px' } }, h('span', {}, 'Card'),
      h('div.seg', {}, KINDS.map(([k, l]) => h('button', { class: ui.kind === k ? 'on' : '', onclick: () => { ui.kind = k; rebuild(); } }, l)))),
    h('label.field', { style: { marginBottom: '18px' } }, h('span', {}, 'Shape'),
      h('div.seg', {}, SIZES.map(([k, l]) => h('button', { class: ui.size === k ? 'on' : '', onclick: () => { ui.size = k; rebuild(); } }, l)))),
    h('label.field', { style: { marginBottom: '22px' } }, h('span', {}, 'Name on card (optional)'),
      h('input', { type: 'text', value: ui.name, maxLength: 28, oninput: (e) => { ui.name = e.target.value; draw(); } })),
    h('div.row', {},
      h('button.btn.solid', { onclick: save }, 'Save PNG'),
      navigator.canShare ? h('button.btn', { onclick: share }, 'Share') : null),
    h('p.note', {}, 'Album art loads from Spotify. Songs without a Spotify link show a grey block instead.'));

  const save = () => canvas.toBlob((b) => download(`crate-${ui.kind}-${rangeLabel().replace(/\W+/g, '-').toLowerCase()}.png`, b), 'image/png');
  const share = () => canvas.toBlob(async (b) => {
    const file = new File([b], 'crate.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] }).catch(() => {});
    else toast('Sharing isn\'t supported here, use Save PNG');
  });

  const rebuild = () => {
    if (!state.plays.length) return page.replaceChildren(head('Share cards', 'Share cards'), emptyHistory());
    page.replaceChildren(head(`Share cards · ${rangeLabel()}`, 'Share cards', 'Wrapped-style images for any date range.', rangePicker()),
      h('div.cards-ui', {}, controls(), canvas));
    draw();
  };
  rebuild();
  window.addEventListener('crate:data', rebuild);
  return () => { token++; window.removeEventListener('crate:data', rebuild); };
}

const imgCache = new Map();
function loadImg(id) {
  if (!id) return Promise.resolve(null);
  if (imgCache.has(id)) return imgCache.get(id);
  const p = getArt(id).then((url) => url ? new Promise((ok) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => ok(im);
    im.onerror = () => ok(null);
    im.src = '/api/img?u=' + encodeURIComponent(url);
  }) : null);
  imgCache.set(id, p);
  return p;
}

function font(ctx, w, size, fam = 'Archivo') {
  ctx.font = `${w} ${size}px ${fam === 'mono' ? '"IBM Plex Mono", monospace' : 'Archivo, sans-serif'}`;
  if ('fontStretch' in ctx) ctx.fontStretch = fam === 'mono' ? 'normal' : 'semi-condensed';
}
function fit(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  while (text.length > 1 && ctx.measureText(text + '…').width > max) text = text.slice(0, -1);
  return text + '…';
}
function cover(ctx, im, x, y, s, label) {
  ctx.fillStyle = C.raise;
  ctx.fillRect(x, y, s, s);
  if (im) ctx.drawImage(im, x, y, s, s);
  else if (label) {
    font(ctx, 500, Math.round(s / 4), 'mono');
    ctx.fillStyle = C.dim;
    ctx.textAlign = 'center';
    ctx.fillText(label, x + s / 2, y + s / 2 + s / 12);
    ctx.textAlign = 'left';
  }
}
const ini = (n = '') => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

async function paint(cv, ui, alive) {
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height, P = 80;
  const plays = inRange();
  const t = totals(plays);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  const rule = (y) => { ctx.fillStyle = C.line; ctx.fillRect(P, y, W - 2 * P, 2); };
  // header
  font(ctx, 500, 26, 'mono');
  ctx.fillStyle = C.muted;
  ctx.fillText('CRATE', P, P + 20);
  ctx.textAlign = 'right';
  ctx.fillText(rangeLabel().toUpperCase(), W - P, P + 20);
  ctx.textAlign = 'left';
  rule(P + 46);
  const title = { summary: ui.name ? `${ui.name}'s listening` : 'My listening', artists: 'Top artists', songs: 'Top songs', clock: 'When I listen' }[ui.kind];
  font(ctx, 750, 112);
  ctx.fillStyle = C.text;
  let y = P + 190;
  ctx.fillText(fit(ctx, title, W - 2 * P), P - 4, y);
  y += 60;

  if (ui.kind === 'artists' || ui.kind === 'songs') {
    const rows = top(plays, ui.kind === 'artists' ? 'artist' : 'track', 'ms', 5);
    const ims = await Promise.all(rows.map((r) => loadImg(r.id)));
    if (!alive()) return;
    const avail = H - y - 200;
    const rowH = Math.min(220, avail / 5);
    const s = rowH - 36;
    rows.forEach((r, i) => {
      const ry = y + i * rowH;
      font(ctx, 500, 30, 'mono');
      ctx.fillStyle = C.dim;
      ctx.fillText(String(i + 1).padStart(2, '0'), P, ry + s / 2 + 10);
      cover(ctx, ims[i], P + 70, ry, s, ini(r.name));
      const tx = P + 70 + s + 34;
      font(ctx, 700, i === 0 ? 58 : 48);
      ctx.fillStyle = C.text;
      ctx.fillText(fit(ctx, r.name, W - P - tx), tx, ry + s / 2 - (ui.kind === 'songs' ? 4 : -8));
      font(ctx, 400, 26, 'mono');
      ctx.fillStyle = C.muted;
      ctx.fillText(fit(ctx, ui.kind === 'songs' ? `${r.artist} · ${num(r.plays)} plays` : `${hrs(r.ms)} hours · ${num(r.plays)} plays`, W - P - tx), tx, ry + s / 2 + 42);
      if (i < 4) { ctx.fillStyle = C.line; ctx.fillRect(tx, ry + rowH - 18, W - P - tx, 1); }
    });
  } else if (ui.kind === 'summary') {
    const ta = top(plays, 'artist', 'ms', 1)[0];
    const ts = top(plays, 'track', 'ms', 1)[0];
    const [ia, is] = await Promise.all([loadImg(ta?.id), loadImg(ts?.id)]);
    if (!alive()) return;
    font(ctx, 800, 230);
    ctx.fillStyle = C.text;
    ctx.fillText(num(t.ms / 60000), P - 8, y + 190);
    font(ctx, 500, 30, 'mono');
    ctx.fillStyle = C.muted;
    ctx.fillText('MINUTES LISTENED', P, y + 245);
    y += 300;
    rule(y);
    const col = (W - 2 * P - 40) / 2;
    const s = Math.min(col, H - y - 420);
    [[ta, ia, 'TOP ARTIST'], [ts, is, 'TOP SONG']].forEach(([e, im, lab], i) => {
      const x = P + i * (col + 40);
      font(ctx, 500, 24, 'mono');
      ctx.fillStyle = C.dim;
      ctx.fillText(lab, x, y + 56);
      cover(ctx, im, x, y + 80, s, ini(e?.name));
      font(ctx, 700, 44);
      ctx.fillStyle = C.text;
      ctx.fillText(fit(ctx, e?.name || '–', col), x, y + 80 + s + 58);
      font(ctx, 400, 24, 'mono');
      ctx.fillStyle = C.muted;
      ctx.fillText(fit(ctx, i ? e?.artist || '' : `${hrs(e?.ms)} hours`, col), x, y + 80 + s + 96);
    });
    y = H - 260;
    rule(y);
    const figs = [[num(t.plays), 'PLAYS'], [num(t.artists), 'ARTISTS'], [num(t.tracks), 'SONGS']];
    figs.forEach(([v, k], i) => {
      const x = P + i * ((W - 2 * P) / 3);
      font(ctx, 750, 64);
      ctx.fillStyle = C.text;
      ctx.fillText(v, x, y + 92);
      font(ctx, 500, 22, 'mono');
      ctx.fillStyle = C.dim;
      ctx.fillText(k, x, y + 130);
    });
  } else if (ui.kind === 'clock') {
    const g = clock(plays);
    const max = Math.max(1, ...g.flat());
    const lab = 90;
    const cell = (W - 2 * P - lab) / 24;
    const D = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    y += 40;
    g.forEach((row, d) => {
      font(ctx, 500, 22, 'mono');
      ctx.fillStyle = C.dim;
      ctx.fillText(D[d], P, y + d * (cell + 4) + cell / 2 + 8);
      row.forEach((v, hr) => {
        ctx.globalAlpha = 0.06 + 0.94 * Math.sqrt(v / max);
        ctx.fillStyle = C.text;
        ctx.fillRect(P + lab + hr * cell, y + d * (cell + 4), cell - 4, cell);
        ctx.globalAlpha = 1;
      });
    });
    const gy = y + 7 * (cell + 4) + 34;
    font(ctx, 400, 20, 'mono');
    ctx.fillStyle = C.dim;
    for (let hr = 0; hr < 24; hr += 3) ctx.fillText(String(hr).padStart(2, '0'), P + lab + hr * cell, gy);
    const hours = new Array(24).fill(0);
    g.forEach((row) => row.forEach((v, i) => (hours[i] += v)));
    const peak = hours.indexOf(Math.max(...hours));
    const tot = hours.reduce((a, b) => a + b, 0) || 1;
    const night = hours.slice(0, 5).reduce((a, b) => a + b, 0);
    const by = gy + 90;
    rule(by);
    [[`${String(peak).padStart(2, '0')}:00`, 'PEAK HOUR'], [Math.round((100 * night) / tot) + '%', 'AFTER MIDNIGHT'], [num(t.days), 'ACTIVE DAYS']].forEach(([v, k], i) => {
      const x = P + i * ((W - 2 * P) / 3);
      font(ctx, 750, 72);
      ctx.fillStyle = C.text;
      ctx.fillText(v, x, by + 110);
      font(ctx, 500, 22, 'mono');
      ctx.fillStyle = C.dim;
      ctx.fillText(k, x, by + 150);
    });
  }
  // footer
  rule(H - P - 46);
  font(ctx, 500, 24, 'mono');
  ctx.fillStyle = C.dim;
  ctx.fillText('crate.rennko.tech', P, H - P);
  ctx.textAlign = 'right';
  ctx.fillText(ui.name ? ui.name.toUpperCase() : `${num(t.ms / 60000)} MIN`, W - P, H - P);
  ctx.textAlign = 'left';
}
