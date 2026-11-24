import { h, toast, ago } from '../util.js';
import { state, inRange } from '../data.js';
import { top } from '../stats.js';
import { head, lockbox, sectionTitle } from '../ui.js';
import { kvGet, kvSet } from '../db.js';
import * as sp from '../spotify.js';
import { SOURCES, defaultParams, runRule, likedSongs, pages } from '../rules.js';

const ORDERS = [['source', 'Ranked / newest first'], ['reverse', 'Reversed'], ['random', 'Shuffled']];

// History-based sources run here in the browser.
async function historyIds(rule) {
  const p = rule.params || {};
  const all = state.plays;
  if (rule.source === 'hist_top') return top(inRange({ preset: 'custom', from: new Date(Date.now() - p.days * 864e5).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) }), 'track', 'plays', 0).map((e) => e.id);
  if (rule.source === 'hist_repeat') {
    const cut = Date.now() - (p.days || 14) * 864e5;
    return top(all.filter((x) => x.t >= cut), 'track', 'plays', 0).filter((e) => e.plays >= 3).map((e) => e.id);
  }
  if (rule.source === 'hist_forgotten') {
    const cut = Date.now() - (p.notInDays || 180) * 864e5;
    return top(all, 'track', 'plays', 0).filter((e) => e.plays >= (p.minPlays || 15) && e.last < cut).map((e) => e.id);
  }
  if (rule.source === 'hist_never') {
    const heard = new Set(all.map((x) => x.u));
    return (await likedSongs(sp.api)).map((it) => it.track?.id).filter((id) => id && !heard.has(id));
  }
  return [];
}

export async function render(page) {
  if (!sp.connected()) {
    page.replaceChildren(head('Library', 'Smart playlists'),
      lockbox('Playlists that keep themselves up to date', 'Rules like "my top 50 this month", "liked songs from 2019" or "forgotten favorites" write straight into a real Spotify playlist, refreshed every day in the cloud.'));
    return;
  }
  let rules = (await kvGet('rules')) || [];
  let log = [];
  const saveRules = async () => {
    await kvSet('rules', rules);
    if (sp.vaultOn()) await sp.vault('rules', { method: 'PUT', body: { rules: rules.filter((r) => SOURCES[r.source]?.cloud) } }).catch((e) => toast(e.message));
  };
  if (sp.vaultOn()) { try { log = (await sp.vault('rules')).log || []; } catch {} }

  const run = async (rule, btn) => {
    if (btn) { btn.disabled = true; btn.textContent = 'Updating…'; }
    try {
      const n = await runRule(sp.api, rule, { history: historyIds });
      rule.lastRun = Date.now();
      rule.lastCount = n;
      rule.err = '';
      toast(`"${rule.name}" now has ${n} songs`);
    } catch (e) { rule.err = e.message; toast(e.message); }
    await saveRules();
    draw();
  };

  const form = () => {
    const f = { name: '', source: 'top', params: defaultParams('top'), limit: 50, order: 'source' };
    const paramsHost = h('div.row', { style: { gap: '14px', alignItems: 'end' } });
    const nameIn = h('input', { type: 'text', placeholder: 'e.g. This month on repeat', maxLength: 80, oninput: (e) => (f.name = e.target.value) });
    const drawParams = async () => {
      const p = f.params;
      const num = (k, label, min, max) => h('label.field', {}, h('span', {}, label), h('input', { type: 'number', value: p[k], min, max, style: { width: '110px' }, oninput: (e) => (p[k] = Number(e.target.value)) }));
      const kids = [];
      if (f.source === 'top') kids.push(h('label.field', {}, h('span', {}, 'Period'), h('select.input', { onchange: (e) => (p.range = e.target.value) },
        [['short_term', 'Last 4 weeks'], ['medium_term', 'Last 6 months'], ['long_term', 'Last year']].map(([v, l]) => h('option', { value: v, selected: p.range === v }, l)))));
      if (f.source === 'liked_recent') kids.push(num('days', 'Days', 1, 3650));
      if (f.source === 'liked_year') kids.push(num('year', 'Year', 2008, new Date().getFullYear()));
      if (f.source === 'hist_top' || f.source === 'hist_repeat') kids.push(num('days', 'Last N days', 1, 3650));
      if (f.source === 'hist_forgotten') kids.push(num('minPlays', 'At least N plays', 2, 1000), num('notInDays', 'Not played in N days', 14, 3650));
      if (f.source === 'merge') {
        const box = h('div.row', { style: { gap: '12px' } }, h('span.dim', {}, 'Loading your playlists…'));
        kids.push(h('label.field', {}, h('span', {}, 'Playlists to combine'), box));
        (async () => {
          const me = await sp.me();
          const pls = (await pages(sp.api, '/me/playlists?limit=50')).filter((x) => x.owner?.id === me.id || x.collaborative);
          box.replaceChildren(...pls.map((pl) => h('label.check', {}, h('input', { type: 'checkbox', onchange: (e) => { p.playlists = e.target.checked ? [...p.playlists, pl.id] : p.playlists.filter((x) => x !== pl.id); } }), pl.name)));
        })().catch((e) => box.replaceChildren(h('span.err', {}, e.message)));
      }
      paramsHost.replaceChildren(...kids);
    };
    const srcSel = h('select.input', { onchange: (e) => { f.source = e.target.value; f.params = defaultParams(f.source); drawParams(); cloudNote.textContent = SOURCES[f.source].cloud ? 'Updates daily in the cloud (when cloud updates are on).' : 'Uses your imported history, so it updates when you press Update in Crate.'; } },
      h('optgroup', { label: 'From Spotify (cloud-capable)' }, Object.entries(SOURCES).filter(([, s]) => s.cloud).map(([k, s]) => h('option', { value: k }, s.label))),
      h('optgroup', { label: 'From your history (browser)' }, Object.entries(SOURCES).filter(([, s]) => !s.cloud).map(([k, s]) => h('option', { value: k }, s.label))));
    const cloudNote = h('p.note', {}, 'Updates daily in the cloud (when cloud updates are on).');
    drawParams();
    return h('div.panel', {},
      h('h3', {}, 'New smart playlist'),
      h('div', { style: { display: 'grid', gap: '16px', marginTop: '14px' } },
        h('label.field', {}, h('span', {}, 'Name'), nameIn),
        h('label.field', {}, h('span', {}, 'Songs from'), srcSel),
        paramsHost,
        h('div.row', { style: { gap: '14px', alignItems: 'end' } },
          h('label.field', {}, h('span', {}, 'Max songs'), h('input', { type: 'number', value: 50, min: 1, max: 1000, style: { width: '110px' }, oninput: (e) => (f.limit = Number(e.target.value)) })),
          h('label.field', {}, h('span', {}, 'Order'), h('select.input', { onchange: (e) => (f.order = e.target.value) }, ORDERS.map(([v, l]) => h('option', { value: v }, l))))),
        cloudNote,
        h('div.row', {}, h('button.btn.solid', { onclick: async (e) => {
          if (!f.name.trim()) return toast('Give it a name');
          e.target.disabled = true;
          try {
            const pl = await sp.api('/me/playlists', { method: 'POST', body: { name: f.name.trim(), public: false, description: `Smart playlist by Crate: ${SOURCES[f.source].label}` } });
            const rule = { id: Math.random().toString(36).slice(2, 10), name: f.name.trim(), source: f.source, params: f.params, limit: f.limit, order: f.order, playlistId: pl.id };
            rules.push(rule);
            await run(rule);
          } catch (err) { toast(err.message); e.target.disabled = false; }
        } }, 'Create and fill playlist'))));
  };

  const cloudPanel = () => {
    if (sp.vaultOn()) {
      return h('div.panel', {},
        h('h3', {}, 'Daily cloud updates: on'),
        h('p', {}, 'Every day at 09:00 UTC, Crate\'s server refreshes your Spotify-based smart playlists, even with this tab closed.'),
        log.length ? h('div.list', { style: { marginBottom: '14px' } }, log.slice(0, 6).map((l) => h('div.li.compact', { style: { gridTemplateColumns: '1fr auto' } },
          h('div.tt', {}, h('div.t1', { style: { fontWeight: 500 } }, l.name || 'Run'), l.err ? h('div.t2.err', {}, l.err) : h('div.t2', {}, `${l.n} songs`)), h('span.val', {}, ago(l.t))))) : null,
        h('div.row', {},
          h('button.btn', { onclick: async (e) => { e.target.disabled = true; try { log = (await sp.vault('run', { method: 'POST' })).log; toast('Cloud run finished'); } catch (err) { toast(err.message); } draw(); } }, 'Run cloud update now'),
          h('button.btn.ghost.danger', { onclick: async () => { if (!confirm('Turn off cloud updates? This deletes your login from Crate\'s server and signs you out here, so you\'ll need to connect Spotify again.')) return; await sp.disableVault(); location.reload(); } }, 'Turn off')));
    }
    return h('div.panel', {},
      h('h3', {}, 'Daily cloud updates: off'),
      h('p', {}, 'Turning this on stores your Spotify login (a refresh token, never your password) on Crate\'s Cloudflare server so it can update your playlists every day. You can turn it off and delete it at any time.'),
      h('button.btn.solid', { onclick: async (e) => {
        e.target.disabled = true;
        try { await sp.enableVault(); await saveRules(); toast('Cloud updates on'); } catch (err) { toast(err.message); e.target.disabled = false; }
        draw();
      } }, 'Turn on daily updates'));
  };

  const draw = () => {
    page.replaceChildren(
      head('Library', 'Smart playlists', 'Rules that write into real Spotify playlists. Edit the rule, and the playlist follows.'),
      h('div.cols', {},
        h('section.section.c7', {}, sectionTitle('01', 'Your rules', String(rules.length)),
          h('div.list', {}, rules.length ? rules.map((r) => {
            const btn = h('button.btn.small', { onclick: () => run(r, btn) }, 'Update now');
            return h('div.li', { style: { gridTemplateColumns: 'minmax(0,1fr) auto auto' } },
              h('div.tt', {},
                h('div.t1', {}, r.name, ' ', h('span.pill', {}, SOURCES[r.source]?.cloud ? 'cloud' : 'browser')),
                h('div.t2', {}, `${SOURCES[r.source]?.label} · max ${r.limit}${r.lastRun ? ` · ${r.lastCount} songs, updated ${ago(r.lastRun)}` : ''}`),
                r.err ? h('div.t2.err', {}, r.err) : null),
              h('a.btn.ghost.small', { href: `https://open.spotify.com/playlist/${r.playlistId}`, target: '_blank', rel: 'noopener' }, 'Open'),
              h('div.row', { style: { gap: '2px' } }, btn,
                h('button.btn.ghost.small', { onclick: async () => { if (!confirm(`Delete the rule "${r.name}"? The playlist stays in Spotify.`)) return; rules = rules.filter((x) => x !== r); await saveRules(); draw(); } }, 'Delete')));
          }) : h('div.empty-line', {}, 'No rules yet. Make one on the right.'))),
        h('section.section.c5', {}, form(), cloudPanel())));
  };
  draw();
}
