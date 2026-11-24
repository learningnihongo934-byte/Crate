import { h, num, hrs, month, date } from '../util.js';
import { state, inRange, rangeLabel, hasSample } from '../data.js';
import { totals, top, byMonth, byDay } from '../stats.js';
import { head, rangePicker, sectionTitle, rankList, tiles, barChart, emptyHistory } from '../ui.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function render(page) {
  const draw = () => {
    if (!state.plays.length) {
      page.replaceChildren(head('Overview', 'Your listening, all year round.', 'Crate keeps every play: years of history from your Spotify export plus new plays as they happen.'), emptyHistory());
      return;
    }
    const plays = inRange();
    const t = totals(plays);
    const months = byMonth(plays);
    const days = byDay(plays);
    const bestDay = [...days.entries()].sort((a, b) => b[1] - a[1])[0];
    const first = state.plays[0].t, last = state.plays.at(-1).t;
    page.replaceChildren(
      head(`Overview · ${rangeLabel()}`, 'Your listening', hasSample() ? 'Showing sample data with made-up artists. Import your own history in Data & Spotify.' : `History from ${date(first)} to ${date(last)}.`, rangePicker()),
      h('div.figures', {},
        fig(num(t.ms / 60000), 'minutes'), fig(hrs(t.ms), 'hours'), fig(num(t.plays), 'plays'),
        fig(num(t.artists), 'artists'), fig(num(t.tracks), 'songs'), fig(t.rows ? Math.round((100 * t.skips) / t.rows) + '%' : '–', 'skipped')),
      h('section.section', {}, sectionTitle('01', 'Top artists', 'by minutes'), tiles(top(plays, 'artist', 'ms', 5))),
      h('div.cols', {},
        h('section.section.c7', {}, sectionTitle('02', 'Top songs', h('a', { href: '#/top' }, 'See all')), rankList(top(plays, 'track', 'ms', 10))),
        h('section.section.c5', {},
          sectionTitle('03', 'Minutes per month'),
          months.length > 1
            ? barChart(months.map((m) => ({ label: m.m === 0 || months.length < 14 ? (m.m === 0 ? String(m.y) : MON[m.m]) : '', v: m.ms / 60000, tip: `${MON[m.m]} ${m.y}: ${num(m.ms / 60000)} min` })), { height: 150, labelEvery: 1 })
            : h('div.empty-line', {}, 'Needs more than one month of plays.'),
          h('div.kv', {},
            h('div', {}, h('b', {}, bestDay ? num(bestDay[1] / 60000) : '–'), h('span', {}, bestDay ? `Best day · ${date(Date.parse(bestDay[0]))}` : 'Best day')),
            h('div', {}, h('b', {}, num(t.days)), h('span', {}, 'Days with music')),
            h('div', {}, h('b', {}, t.days ? num(t.ms / 60000 / t.days) : '–'), h('span', {}, 'Min per active day'))),
          h('section', { style: { marginTop: '36px' } }, sectionTitle('04', 'Top albums'), rankList(top(plays, 'album', 'ms', 5), { kind: 'album' })))));
  };
  draw();
  window.addEventListener('crate:data', draw);
  return () => window.removeEventListener('crate:data', draw);
}

const fig = (v, k) => h('div.fig', {}, h('div.v', { title: v }, v), h('div.k', {}, k));
export { month };
