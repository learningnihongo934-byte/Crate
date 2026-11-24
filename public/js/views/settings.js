import { h, num, date, toast, download } from '../util.js';
import { state, addPlays, removeSource, hasSample, syncRecent } from '../data.js';
import { importFiles, rowsFrom } from '../importer.js';
import { makeSample } from '../sample.js';
import { head, sectionTitle, DMG } from '../ui.js';
import { isNative, np, cmd } from '../nowplaying.js';
import * as sp from '../spotify.js';

export function render(page) {
  const draw = () => {
    const bySrc = { x: 0, a: 0, d: 0, n: 0 };
    for (const p of state.plays) bySrc[p.src] = (bySrc[p.src] || 0) + 1;
    page.replaceChildren(
      head('Crate', 'Settings', 'Your history is stored on this computer only.'),
      h('div.cols', {},
        h('section.section.c7', {}, sectionTitle('01', 'Your history'), dataPanel(bySrc), importPanel(bySrc)),
        h('section.section.c5', {}, sectionTitle('02', isNative ? 'Spotify app' : 'Mac app'), appPanel(), sectionTitle('03', 'Preferences'), prefsPanel(),
          h('details.adv', { open: sp.connected() }, h('summary', {}, 'Advanced: Spotify developer login (optional)'),
            h('p.muted', { style: { fontSize: '13.5px' } }, 'Only needed for playlist editing, smart playlists and genres. It requires a Spotify developer app owned by a Premium account.'),
            spotifyPanel()))));
  };

  const importPanel = (bySrc) => {
    const status = h('p.muted', { style: { margin: '10px 0 0' } });
    const input = h('input', { type: 'file', multiple: true, accept: '.zip,.json,application/zip,application/json', class: 'hide', onchange: (e) => go(e.target.files) });
    const go = async (files) => {
      if (!files?.length) return;
      try {
        const r = await importFiles([...files], (t) => (status.textContent = t));
        status.textContent = `Saving ${num(r.rows.length)} plays…`;
        const added = await addPlays(r.rows);
        status.textContent = '';
        toast(`Imported ${num(added)} new plays from ${r.files} file${r.files > 1 ? 's' : ''}${r.podcasts ? ` (skipped ${num(r.podcasts)} podcast plays)` : ''}`, 6000);
        if (added && hasSample() && confirm('Your real history is in. Remove the sample data?')) await removeSource('d');
        draw();
      } catch (e) { status.textContent = ''; toast(e.message, 6000); }
    };
    const zone = h('div.drop', {
      onclick: () => input.click(),
      ondragover: (e) => { e.preventDefault(); zone.classList.add('over'); },
      ondragleave: () => zone.classList.remove('over'),
      ondrop: (e) => { e.preventDefault(); zone.classList.remove('over'); go(e.dataTransfer.files); },
    }, h('b', {}, 'Drop your Spotify data here'), 'my_spotify_data.zip, or the Streaming_History JSON files inside it');
    return h('div.panel', {},
      h('h3', {}, 'Optional: bring in past years'),
      h('p', {}, isNative ? 'Crate already logs everything you play. If you also want your history from before you installed it, Spotify can send it to you.' : 'Spotify can send you every play since you joined.'),
      h('ol.steps', {},
        h('li', {}, 'Open ', h('a', { href: 'https://www.spotify.com/account/privacy/', target: '_blank', rel: 'noopener' }, 'spotify.com → Account → Privacy settings'), '.'),
        h('li', {}, 'Tick ', h('b', {}, 'Extended streaming history'), ' (every play since you joined) and request it. "Account data" works too, but only covers the last year.'),
        h('li', {}, 'Spotify emails a download link, usually within a few days. Download the zip.'),
        h('li', {}, 'Drop the zip here. You can import again later: Crate skips duplicates.')),
      zone, input, status);
  };

  const dataPanel = (bySrc) => h('div.panel', {},
    h('h3', {}, 'What\'s stored'),
    state.plays.length
      ? h('p', {}, `${num(state.plays.length)} plays from ${date(state.plays[0].t)} to ${date(state.plays.at(-1).t)}: ${num(bySrc.n || 0)} logged by the Mac app, ${num(bySrc.x)} from exports, ${num(bySrc.a)} from the Spotify API${bySrc.d ? `, ${num(bySrc.d)} sample` : ''}.`)
      : h('p', {}, 'Nothing yet.'),
    h('div.row', {},
      hasSample()
        ? h('button.btn', { onclick: async () => { await removeSource('d'); toast('Sample data removed'); draw(); } }, 'Remove sample data')
        : h('button.btn', { onclick: async () => { const n = await addPlays(makeSample()); toast(`Added ${num(n)} sample plays`); draw(); } }, 'Try with sample data'),
      state.plays.length ? h('button.btn', { onclick: backup }, 'Download backup') : null,
      h('button.btn', { onclick: () => restoreIn.click() }, 'Restore backup'),
      state.plays.length ? h('button.btn.ghost.danger', { onclick: async () => { if (confirm(`Delete all ${num(state.plays.length)} stored plays from this browser? This can't be undone unless you have a backup.`)) { await removeSource(); draw(); } } }, 'Delete all') : null),
    restoreIn);

  const restoreIn = h('input', { type: 'file', accept: '.json', class: 'hide', onchange: async (e) => {
    try {
      const d = JSON.parse(await e.target.files[0].text());
      const rows = Array.isArray(d.plays) ? d.plays.filter((p) => p && p.k && p.t) : rowsFrom(d).rows;
      toast(`Restored ${num(await addPlays(rows))} plays`);
      draw();
    } catch (err) { toast('That file isn\'t a Crate backup: ' + err.message); }
  } });

  const backup = () => download(`crate-backup-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify({ app: 'crate', v: 1, plays: state.plays })], { type: 'application/json' }));

  const spotifyPanel = () => {
    const on = sp.connected();
    const idIn = h('input', { type: 'text', value: sp.getClientId(), placeholder: '32-character client ID', style: { fontFamily: 'var(--mono)', width: '100%' }, spellcheck: false });
    const redirect = sp.redirect();
    if (on) {
      const me = JSON.parse(localStorage.getItem('crate.me') || 'null');
      return h('div.panel', {},
        h('h3', {}, 'Connected', me ? ` as ${me.name}` : ''),
        h('p', {}, sp.vaultOn() ? 'Your login is held by Crate\'s server for daily smart-playlist updates.' : 'Your login token is kept in this browser only.'),
        h('div.row', {},
          h('button.btn', { onclick: async () => { try { const n = await syncRecent(); toast(n ? `Logged ${n} new plays` : 'Already up to date'); } catch (e) { toast(e.message); } } }, 'Sync recent plays'),
          h('button.btn.ghost.danger', { onclick: async () => { if (sp.vaultOn()) await sp.disableVault(); else sp.logout(); toast('Disconnected'); location.reload(); } }, 'Disconnect')));
    }
    return h('div.panel', {},
      h('h3', {}, 'Connect a Spotify developer app'),
      h('p', {}, 'Spotify only lets an app log people in if the app\'s owner has Premium. A Premium account (yours, or a friend\'s) creates the app once, then adds you as a user.'),
      h('ol.steps', {},
        h('li', {}, 'The Premium account opens ', h('a', { href: 'https://developer.spotify.com/dashboard', target: '_blank', rel: 'noopener' }, 'developer.spotify.com/dashboard'), ' and clicks ', h('b', {}, 'Create app'), '.'),
        h('li', {}, 'Redirect URI: ', h('code', {}, redirect), h('button.btn.ghost.small', { onclick: () => navigator.clipboard.writeText(redirect).then(() => toast('Copied')) }, 'Copy'), ' · API: ', h('b', {}, 'Web API'), '.'),
        h('li', {}, 'In the app\'s ', h('b', {}, 'User Management'), ', add the email of the Spotify account you\'ll log in with (up to 5).'),
        h('li', {}, 'Copy the app\'s ', h('b', {}, 'Client ID'), ' here. No client secret needed.')),
      h('div', { style: { display: 'grid', gap: '10px' } }, idIn,
        h('div.row', {},
          h('button.btn.solid', { onclick: async () => {
            const v = idIn.value.trim();
            if (!/^[a-f0-9]{32}$/i.test(v)) return toast('A client ID is 32 letters and numbers');
            sp.setClientId(v);
            try { await sp.login(); } catch (e) { toast(e.message); }
          } }, 'Save and log in with Spotify'))),
      null);
  };

  const appPanel = () => isNative
    ? h('div.panel', {},
        h('h3', {}, np.running ? 'Connected to the Spotify app' : 'Spotify is closed'),
        h('p', {}, 'Crate controls the Spotify app on this Mac and logs each song you play (5 seconds or more). If macOS asks whether Crate may control Spotify, click OK.'),
        !np.running ? h('button.btn.solid', { onclick: () => cmd('activate') }, 'Open Spotify') : null)
    : h('div.panel', {},
        h('h3', {}, 'Get Crate for Mac'),
        h('p', {}, 'The app works with the Spotify app on your computer: play, pause, skip, a real queue, a sleep timer and loops. It logs every song for your stats. No login, works on free accounts.'),
        h('a.btn.solid', { href: DMG }, 'Download for Mac (Apple silicon)'),
        h('p.note', {}, 'First launch: right-click Crate in Applications → Open, because the app is not notarized by Apple.'));

  const prefsPanel = () => h('div.panel', {},
    isNative ? null : h('label.field', {}, h('span', {}, 'Open songs in'),
      h('div.seg', {}, [['app', 'Spotify app'], ['web', 'Web player']].map(([k, l]) =>
        h('button', { class: (localStorage.getItem('crate.openIn') || 'app') === k ? 'on' : '', onclick: () => { localStorage.setItem('crate.openIn', k); draw(); } }, l)))),
    h('p.note', {}, isNative ? 'Keyboard: Space play/pause · J previous · L next · Q queue · P now playing · O overview · / search' : 'Keyboard: N next from Up Next · Q queue · P now playing · O overview · / search'));

  draw();
  window.addEventListener('crate:data', draw);
  return () => window.removeEventListener('crate:data', draw);
}
