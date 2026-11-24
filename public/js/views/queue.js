import { h, toast, ago } from '../util.js';
import { inRange, rangeLabel } from '../data.js';
import { top } from '../stats.js';
import { head, sectionTitle } from '../ui.js';
import { isNative } from '../nowplaying.js';
import { artEl } from '../art.js';
import { picker } from '../picker.js';
import { queue, played, enqueue, enqueueMany, removeAt, move, moveTo, clearQueue, shuffleQueue, playNext, playItem } from '../queue.js';
import * as sp from '../spotify.js';

export function render(page) {
  let dragKey = null;
  const draw = () => {
    const q = queue();
    const list = h('div.list', {}, q.length ? q.map((t, i) => h('div.li', {
      draggable: true,
      ondragstart: () => { dragKey = t.key; },
      ondragover: (e) => e.preventDefault(),
      ondrop: (e) => { e.preventDefault(); if (dragKey) moveTo(dragKey, i); dragKey = null; },
      style: { cursor: 'grab' },
    },
      h('span.rk', {}, i + 1), artEl(t),
      h('div.tt', {}, h('div.t1', {}, t.name), h('div.t2', {}, t.artist || '—')),
      h('span'),
      h('div.row', { style: { gap: '2px' } },
        h('button.btn.ghost.small', { onclick: () => move(t.key, -1), title: 'Move up', 'aria-label': 'Move up' }, '↑'),
        h('button.btn.ghost.small', { onclick: () => move(t.key, 1), title: 'Move down', 'aria-label': 'Move down' }, '↓')),
      h('div.row', { style: { gap: '2px' } },
        h('button.btn.small', { onclick: () => playItem(t.key) }, 'Play'),
        h('button.btn.ghost.small', { onclick: () => removeAt(t.key) }, 'Remove'))))
      : h('div.empty-line', {}, 'Up Next is empty. Add songs below, or use "+ Queue" on any song in Crate.'));

    page.replaceChildren(
      head('Listen', 'Up next', isNative ? 'Crate plays these in order, starting each one as the current song ends. Drag to reorder.' : 'Crate keeps its own queue. Press N (or Next ›) to open the next song in Spotify. Drag to reorder.',
        h('div.row', {},
          h('button.btn.solid', { onclick: () => playNext(), disabled: !q.length }, 'Play next  N'),
          h('button.btn', { onclick: shuffleQueue, disabled: q.length < 2 }, 'Shuffle'),
          h('button.btn', { onclick: () => confirm('Clear Up Next?') && clearQueue(), disabled: !q.length }, 'Clear'))),
      h('div.cols', {},
        h('section.section.c7', {}, sectionTitle('01', 'Queue', `${q.length} songs`), list,
          q.length && sp.connected() ? h('div.row', { style: { marginTop: '14px' } }, h('button.btn', { onclick: saveAsPlaylist }, 'Save queue as a playlist')) : null),
        h('section.section.c5', {},
          sectionTitle('02', 'Add songs'), picker((t) => enqueue(t)),
          h('div.row', { style: { marginTop: '14px' } },
            h('button.btn.small', { onclick: () => enqueueMany(top(inRange(), 'track', 'plays', 20).map((e) => ({ id: e.id, name: e.name, artist: e.artist }))) }, `Add my top 20 (${rangeLabel()})`),
            h('button.btn.small', { onclick: addForgotten }, 'Add 15 forgotten favorites')),
          isNative ? null : h('label.check', { style: { marginTop: '18px' } },
            h('input', { type: 'checkbox', checked: localStorage.getItem('crate.nudge') !== 'off', onchange: (e) => localStorage.setItem('crate.nudge', e.target.checked ? 'on' : 'off') }),
            'Remind me when the Spotify song changes'),
          sectionTitle('03', 'Played from Up Next'),
          h('div.list', {}, played().slice(0, 12).map((t) => h('div.li.compact', {},
            h('span.rk', {}, ''), artEl(t, 'sm'), h('div.tt', {}, h('div.t1', {}, t.name), h('div.t2', {}, t.artist)), h('span'),
            h('button.btn.ghost.small', { onclick: () => enqueue(t) }, 'Again')))))));
  };

  const addForgotten = () => {
    const cut = Date.now() - 180 * 864e5;
    const all = top(inRange({ preset: 'all' }), 'track', 'plays', 0).filter((e) => e.plays >= 8 && e.last < cut);
    if (!all.length) return toast('No forgotten favorites yet');
    const pickN = all.sort(() => Math.random() - 0.5).slice(0, 15);
    enqueueMany(pickN.map((e) => ({ id: e.id, name: e.name, artist: e.artist })));
  };

  const saveAsPlaylist = async () => {
    const ids = queue().map((t) => t.id).filter(Boolean);
    if (!ids.length) return toast('None of these songs have Spotify links');
    try {
      const p = await sp.api('/me/playlists', { method: 'POST', body: { name: `Up Next · ${new Date().toLocaleDateString()}`, public: false, description: 'Saved from Crate' } });
      for (let i = 0; i < ids.length; i += 100) await sp.api(`/playlists/${p.id}/items`, { method: 'POST', body: { uris: ids.slice(i, i + 100).map((id) => 'spotify:track:' + id) } });
      toast(`Saved ${ids.length} songs to "${p.name}"`);
    } catch (e) { toast(e.message); }
  };

  draw();
  window.addEventListener('crate:queue', draw);
  return () => window.removeEventListener('crate:queue', draw);
}
export { ago };
