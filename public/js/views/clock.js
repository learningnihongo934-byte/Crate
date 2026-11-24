import { h, num, dayKey, date } from '../util.js';
import { state, inRange, rangeLabel, bounds } from '../data.js';
import { clock, byDay, totals } from '../stats.js';
import { head, rangePicker, sectionTitle, barChart, emptyHistory } from '../ui.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function render(page) {
  const draw = () => {
    if (!state.plays.length) return page.replaceChildren(head('Listening clock', 'When you listen'), emptyHistory());
    const plays = inRange();
    const g = clock(plays);
    const max = Math.max(1, ...g.flat());
    const hours = new Array(24).fill(0);
    g.forEach((row) => row.forEach((v, i) => (hours[i] += v)));
    const perDay = g.map((row) => row.reduce((a, b) => a + b, 0));
    const peakH = hours.indexOf(Math.max(...hours));
    const peakD = perDay.indexOf(Math.max(...perDay));
    const night = hours.slice(0, 5).reduce((a, b) => a + b, 0);
    const tot = hours.reduce((a, b) => a + b, 0) || 1;

    const heat = h('div.heat', {},
      g.flatMap((row, d) => [h('span.lab', {}, DAYS[d]), ...row.map((v, hr) =>
        h('i.cell', { style: { opacity: (0.06 + 0.94 * Math.sqrt(v / max)).toFixed(3) }, title: `${DAYS[d]} ${String(hr).padStart(2, '0')}:00 · ${num(v / 60000)} min` }))]),
      h('span'), [...Array(24)].map((_, i) => h('span.hr', {}, i % 3 === 0 ? String(i).padStart(2, '0') : '')));

    page.replaceChildren(
      head(`Listening clock · ${rangeLabel()}`, 'When you listen', null, rangePicker()),
      h('div.figures', {},
        f(`${String(peakH).padStart(2, '0')}:00`, 'Peak hour'), f(DAYS[peakD], 'Busiest day'),
        f(Math.round((100 * night) / tot) + '%', 'After midnight'),
        f(Math.round((100 * (perDay[5] + perDay[6])) / tot) + '%', 'On weekends'),
        f(num(totals(plays).days), 'Active days'), f(num(tot / 60000 / 7 / Math.max(1, weeks(plays))), 'Min per day')),
      h('section.section', {}, sectionTitle('01', 'Hour × weekday', 'darker = less'), heat,
        h('div.legend', {}, 'less', [0.1, 0.3, 0.55, 0.8, 1].map((o) => h('i', { style: { opacity: o } })), 'more')),
      h('section.section', {}, sectionTitle('02', 'By hour of day'),
        barChart(hours.map((v, i) => ({ label: i % 3 === 0 ? String(i).padStart(2, '0') : '', v: v / 60000, tip: `${String(i).padStart(2, '0')}:00 · ${num(v / 60000)} min` })), { height: 120 })),
      h('section.section', {}, sectionTitle('03', 'Every day', 'last 53 weeks of the range'), calendar(plays)));
  };
  draw();
  window.addEventListener('crate:data', draw);
  return () => window.removeEventListener('crate:data', draw);
}

const f = (v, k) => h('div.fig', {}, h('div.v', {}, v), h('div.k', {}, k));
function weeks(plays) {
  if (!plays.length) return 1;
  return Math.max(1, (plays.at(-1).t - plays[0].t) / (7 * 864e5));
}

function calendar(plays) {
  const days = byDay(plays);
  const end = new Date(Math.min(Date.now(), bounds()[1], plays.at(-1)?.t || Date.now()));
  const start = new Date(end.getTime() - 370 * 864e5);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const max = Math.max(1, ...days.values());
  const cells = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const v = days.get(dayKey(d.getTime())) || 0;
    cells.push(h('i', { style: { opacity: v ? (0.12 + 0.88 * Math.sqrt(v / max)).toFixed(3) : 0.04 }, title: `${date(d.getTime())} · ${num(v / 60000)} min` }));
  }
  return h('div.cal', {}, cells);
}
