// Transport buttons for the Mac app (Spotify app control).
import { h, s } from './util.js';
import { np, cmd } from './nowplaying.js';
import { queue, playNext } from './queue.js';

const ICON = {
  prev: 'M6 5h2v14H6zM20 5v14L9 12z',
  next: 'M16 5h2v14h-2zM4 5l11 7-11 7z',
  play: 'M7 4.5v15L19.5 12z',
  pause: 'M6.5 5h4v14h-4zM13.5 5h4v14h-4z',
};
export const icon = (name, size = 18) => s('svg', { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true' }, s('path', { d: ICON[name], fill: 'currentColor' }));
export function transport(big = false) {
  const z = big ? 26 : 18;
  return h('div.transport' + (big ? '.big' : ''), {},
    h('button.tbtn', { onclick: () => cmd('previous'), title: 'Previous (J)', 'aria-label': 'Previous' }, icon('prev', z)),
    h('button.tbtn.main', { onclick: () => cmd('playpause'), title: 'Play / pause (Space)', 'aria-label': np.playing ? 'Pause' : 'Play' }, icon(np.playing ? 'pause' : 'play', z)),
    h('button.tbtn', { onclick: () => (queue().some((q) => q.id) ? playNext() : cmd('next')), title: 'Next (L)', 'aria-label': 'Next' }, icon('next', z)));
}

