// Shared view pieces: page header, range picker, ranked lists, charts.
import { h, s, num, mins, date, openInSpotify, hrs } from './util.js';
import { state, PRESETS, setRange, years, rangeLabel } from './data.js';
import { artEl } from './art.js';
import { enqueue } from './queue.js';

export function head(eyebrow, title, sub, right) {
  return h('header.head', {},
    h('div', {}, h('div.eyebrow', {}, eyebrow), h('h1', {}, title), sub ? h('p.sub', {}, sub) : null),
    right ? h('div', {}, right) : null);
}

export function rangePicker() {
  const r = state.range;
  const ys = years();
  const seg = h('div.seg', { role: 'group', 'aria-label': 'Date range' },
    PRESETS.map(([k, label]) => h('button', { class: r.preset === k ? 'on' : '', onclick: () => setRange({ preset: k }) }, label)),
    ys.length ? h('select', {
      class: r.preset === 'year' ? 'on' : '', 'aria-label': 'Year',
      onchange: (e) => e.target.value && setRange({ preset: 'year', year: Number(e.target.value) }),
    }, h('option', { value: '' }, 'Year'), ys.map((y) => h('option', { value: y, selected: r.preset === 'year' && r.year === y }, y))) : null,
    h('button', { class: r.preset === 'custom' ? 'on' : '', onclick: () => customRange() }, 'Custom'));
  return seg;
}

function customRange() {
  const today = new Date().toISOString().slice(0, 10);
  const from = prompt('From (YYYY-MM-DD)', state.range.from || new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10));
  if (!from) return;
  const to = prompt('To (YYYY-MM-DD)', state.range.to || today);
  if (!to) return;
  if (!Date.parse(from) || !Date.parse(to)) return alert('Use dates like 2024-05-01');
  setRange({ preset: 'custom', from, to });
}

export function sectionTitle(n, text, aside) {
  return h('h2', {}, h('span.n', {}, n), text, aside ? h('span.aside', {}, aside) : null);
}

export function trackActs(item) {
  return h('div.acts', {},
    h('button.btn.ghost.small', { title: 'Open in Spotify', onclick: () => openInSpotify(item) }, 'Open'),
    h('button.btn.ghost.small', { title: 'Add to Up Next', onclick: () => enqueue(item) }, '+ Queue'));
}

// rows: [{name, artist, id, ms, plays}] ; kind: 'track' | 'artist' | 'album'
export function rankList(rows, { kind = 'track', metric = 'ms', start = 0, extra } = {}) {
  if (!rows.length) return h('div.list', {}, h('div.empty-line', {}, 'Nothing in this range yet.'));
  const max = rows[0][metric] || 1;
  return h('div.list', {}, rows.map((e, i) => h('div.li', {},
    h('span.rk', {}, start + i + 1),
    artEl({ id: e.id, name: e.name, artist: kind === 'artist' ? e.name : e.artist }),
    h('div.tt', {}, h('div.t1', {}, e.name), h('div.t2', {}, kind === 'artist' ? `${num(e.plays)} plays` : e.artist)),
    h('div.meter', {}, h('i', { style: { width: (100 * e[metric] / max).toFixed(1) + '%' } })),
    h('span.val', {}, extra ? extra(e) : metric === 'ms' ? `${mins(e.ms)} min` : `${num(e.plays)} plays`),
    kind === 'track' ? trackActs({ id: e.id, name: e.name, artist: e.artist }) : h('span'))));
}

export function tiles(rows, kind = 'artist') {
  return h('div.tiles', {}, rows.map((e, i) => h('div.tile', {},
    h('div.rk', {}, String(i + 1).padStart(2, '0')),
    artEl({ id: e.id, name: e.name, artist: kind === 'artist' ? e.name : e.artist }, 'lg'),
    h('div.t1', {}, e.name),
    h('div.t2', {}, `${hrs(e.ms)} h · ${num(e.plays)} plays`))));
}

// data: [{label, v, tip}] -> responsive SVG bar chart
export function barChart(data, { height = 160, fmt = (v) => num(v), labelEvery = 1, highlight } = {}) {
  const W = 1000, H = height, pad = 18;
  const max = Math.max(1, ...data.map((d) => d.v));
  const bw = W / Math.max(1, data.length);
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H + pad}`, preserveAspectRatio: 'none', role: 'img' });
  for (const f of [0.5, 1]) svg.append(s('line', { class: 'grid', x1: 0, x2: W, y1: H - H * f, y2: H - H * f, 'vector-effect': 'non-scaling-stroke' }));
  data.forEach((d, i) => {
    const bh = Math.max(d.v ? 1.5 : 0, (d.v / max) * (H - 4));
    const r = s('rect', { class: 'bar' + (highlight && !highlight(d, i) ? ' dim' : ''), x: i * bw + bw * 0.12, y: H - bh, width: bw * 0.76, height: bh });
    r.append(s('title', {}, d.tip || `${d.label}: ${fmt(d.v)}`));
    svg.append(r);
  });
  const labels = h('div', { style: { display: 'flex', justifyContent: 'space-between', font: '400 10.5px var(--mono)', color: 'var(--dim)', marginTop: '6px' } });
  data.forEach((d, i) => { if (i % labelEvery === 0) labels.append(h('span', {}, d.label)); });
  const wrap = h('div', {}, svg, labels);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.style.height = height + 'px';
  return wrap;
}

export function lockbox(title, text, actions) {
  return h('div.lockbox', {}, h('span.pill', {}, 'Needs Spotify login'), h('b', {}, title), h('p', {}, text),
    actions || h('a.btn.solid', { href: '#/settings' }, 'Set up Spotify login'));
}

export function emptyHistory() {
  return h('div.lockbox', {},
    h('span.pill', {}, 'No history yet'),
    h('b', {}, 'Import your Spotify history to fill this in'),
    h('p', {}, 'Request your Extended streaming history from Spotify (Account → Privacy settings), then drop the zip into Crate. Until it arrives you can explore with sample data.'),
    h('a.btn.solid', { href: '#/settings' }, 'Import or try sample data'));
}

export const rangeText = () => rangeLabel();
export { date };
