import { h, num, date, month } from '../util.js';
import { state, inRange, rangeLabel } from '../data.js';
import { peakWeeks, streaks, dropped, mostSkipped, discoveries, counted } from '../stats.js';
import { head, rangePicker, sectionTitle, rankList, emptyHistory, barChart } from '../ui.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function render(page) {
  const draw = () => {
    if (!state.plays.length) return page.replaceChildren(head('Obsessions', 'Loops, streaks and drop-offs'), emptyHistory());
    const plays = inRange();
    const weeks = peakWeeks(plays);
    const aStreak = streaks(plays, 'artist');
    const tStreak = streaks(plays, 'track', 8);
    const gone = dropped(state.plays);
    const skip = mostSkipped(plays);
    const disc = discoveries(state.plays);
    const newInRange = [...disc.first.entries()].filter(([, t]) => plays.length && t >= plays[0].t && t <= plays.at(-1).t);
    const months = [];
    if (plays.length) {
      const a = new Date(plays[0].t), b = new Date(plays.at(-1).t);
      for (let y = a.getFullYear(), m = a.getMonth(); y < b.getFullYear() || (y === b.getFullYear() && m <= b.getMonth()); m === 11 ? (y++, m = 0) : m++)
        months.push({ label: m === 0 ? String(y) : '', v: disc.perMonth.get(`${y}-${m}`) || 0, tip: `${MON[m]} ${y}: ${disc.perMonth.get(`${y}-${m}`) || 0} new artists` });
    }
    const firstNew = newInRange.sort((a, b) => a[1] - b[1]);
    const stuck = plays.filter(counted);

    page.replaceChildren(
      head(`Obsessions · ${rangeLabel()}`, 'Loops, streaks and drop-offs', 'The songs you couldn\'t stop playing, the artists you played every day, and the ones you quietly left behind.', rangePicker()),
      h('div.cols', {},
        h('section.section.c7', {}, sectionTitle('01', 'On repeat', 'most plays in any 7 days'),
          rankList(weeks, { metric: 'plays', extra: (e) => `${e.plays}× · wk of ${date(e.at)}` })),
        h('section.section.c5', {}, sectionTitle('02', 'Artist streaks', 'days in a row'),
          streakList(aStreak))),
      h('div.cols', {},
        h('section.section.c7', {}, sectionTitle('03', 'Dropped', 'loved, then silent for 4+ months · all time'),
          rankList(gone, { metric: 'plays', extra: (e) => `${num(e.plays)}× · last ${month(e.last)}` })),
        h('section.section.c5', {}, sectionTitle('04', 'Song streaks', 'days in a row'), streakList(tStreak, true))),
      h('div.cols', {},
        h('section.section.c7', {}, sectionTitle('05', 'Most skipped', 'share of starts you skipped'),
          skip.length ? rankList(skip, { metric: 'rate', extra: (e) => `${Math.round(e.rate * 100)}% of ${e.skips + e.plays}` })
            : h('div.empty-line', {}, 'Skip data comes from the Extended streaming history export.')),
        h('section.section.c5', {}, sectionTitle('06', 'New artists', `${num(firstNew.length)} first heard in this range`),
          months.length > 1 ? barChart(months, { height: 110 }) : null,
          h('div.list', { style: { marginTop: '14px' } }, firstNew.slice(0, 8).map(([a, t]) =>
            h('div.li.compact', {}, h('span.rk', {}, ''), h('span'), h('div.tt', {}, h('div.t1', {}, a)), h('span.val', {}, date(t)), h('span')))))),
      h('p.dim.mono', { style: { fontSize: '12px' } }, `${num(stuck.length)} counted plays in range (30 s or longer).`));
  };
  draw();
  window.addEventListener('crate:data', draw);
  return () => window.removeEventListener('crate:data', draw);
}

function streakList(rows, isTrack) {
  if (!rows.length) return h('div.list', {}, h('div.empty-line', {}, 'No streaks of 3+ days in this range.'));
  const max = rows[0].days;
  return h('div.list', {}, rows.map((e, i) => h('div.li', {},
    h('span.rk', {}, i + 1), h('span.mono.dim', {}, `${e.days}d`),
    h('div.tt', {}, h('div.t1', {}, e.name), h('div.t2', {}, isTrack ? e.artist : `ended ${date(e.end)}`)),
    h('div.meter', {}, h('i', { style: { width: (100 * e.days / max) + '%' } })),
    h('span.val', {}, `${e.days} days`), h('span'))));
}
