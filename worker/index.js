// Crate Worker: /api/art (Spotify oEmbed art lookup), /api/img (CORS image proxy for share cards),
// /api/room/CODE (listening rooms, WebSocket Durable Object), /api/vault/* (smart-playlist
// token vault) and a daily cron that refreshes every cloud smart playlist.
import { DurableObject } from 'cloudflare:workers';
import { runRule, SOURCES } from '../public/js/rules.js';

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...extra } });

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (p === '/api/art') return art(req, url, ctx);
    if (p === '/api/img') return img(req, url, ctx);
    if (p.startsWith('/api/room/')) {
      const code = (p.split('/')[3] || '').toUpperCase();
      if (!/^[A-Z0-9]{4,8}$/.test(code)) return json({ error: 'bad room code' }, 400);
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
    }
    if (p.startsWith('/api/vault/')) return env.VAULT.get(env.VAULT.idFromName('main')).fetch(req);
    if (p.startsWith('/api/')) return json({ error: 'not found' }, 404);
    return env.ASSETS.fetch(req);
  },
  async scheduled(_ev, env, ctx) {
    ctx.waitUntil(env.VAULT.get(env.VAULT.idFromName('main')).fetch('https://vault/internal/run', { method: 'POST' }));
  },
};

// ---------- art ----------
async function art(req, url, ctx) {
  const type = url.searchParams.get('type') || 'track';
  const id = url.searchParams.get('id') || '';
  if (!['track', 'album', 'artist', 'playlist'].includes(type) || !/^[A-Za-z0-9]{22}$/.test(id))
    return json({ error: 'bad id' }, 400);
  const cache = caches.default;
  const key = new Request(`https://crate-cache/art/${type}/${id}`);
  let hit = await cache.match(key);
  if (hit) return hit;
  const r = await fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/${type}/${id}`, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; Crate/1.0)' },
  });
  let body = { thumb: '', title: '' };
  if (r.ok) {
    const d = await r.json();
    body = { thumb: d.thumbnail_url || '', title: d.title || '' };
  }
  const res = json(body, 200, { 'cache-control': `public, max-age=${r.ok ? 2592000 : 3600}` });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

const IMG_HOSTS = /^(i\.scdn\.co|mosaic\.scdn\.co|image-cdn-[a-z0-9-]+\.spotifycdn\.com|[a-z0-9-]+\.spotifycdn\.com)$/;
async function img(req, url, ctx) {
  let u;
  try { u = new URL(url.searchParams.get('u') || ''); } catch { return json({ error: 'bad url' }, 400); }
  if (u.protocol !== 'https:' || !IMG_HOSTS.test(u.hostname)) return json({ error: 'host not allowed' }, 400);
  const cache = caches.default;
  const key = new Request('https://crate-cache/img/' + encodeURIComponent(u.href));
  const hit = await cache.match(key);
  if (hit) return hit;
  const r = await fetch(u.href);
  if (!r.ok) return new Response('upstream ' + r.status, { status: 502 });
  const res = new Response(r.body, {
    headers: {
      'content-type': r.headers.get('content-type') || 'image/jpeg',
      'cache-control': 'public, max-age=2592000',
      'access-control-allow-origin': '*',
    },
  });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

// ---------- rooms ----------
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, n);
const cleanTrack = (t) =>
  t && typeof t === 'object'
    ? {
        id: /^[A-Za-z0-9]{22}$/.test(t.id || '') ? t.id : '',
        name: clean(t.name, 200),
        artist: clean(t.artist, 200),
        art: /^https:\/\/[a-z0-9.-]+\/[^\s"'<>]*$/i.test(t.art || '') ? t.art.slice(0, 400) : '',
      }
    : null;

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected websocket' }, 426);
    if (this.ctx.getWebSockets().length >= 40) return json({ error: 'room full' }, 429);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: crypto.randomUUID().slice(0, 8), name: '', np: null, joined: false });
    return new Response(null, { status: 101, webSocket: client });
  }

  async state() {
    return {
      queue: (await this.ctx.storage.get('queue')) || [],
      chat: (await this.ctx.storage.get('chat')) || [],
    };
  }

  members() {
    return this.ctx.getWebSockets()
      .map((ws) => ws.deserializeAttachment())
      .filter((a) => a && a.joined)
      .map(({ id, name, np }) => ({ id, name, np }));
  }

  send(ws, msg) { try { ws.send(JSON.stringify(msg)); } catch {} }
  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(s); } catch {} }
  }

  async webSocketMessage(ws, raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const me = ws.deserializeAttachment();
    if (m.type === 'hello') {
      me.name = clean(m.name, 30) || 'Guest';
      me.joined = true;
      ws.serializeAttachment(me);
      const st = await this.state();
      this.send(ws, { type: 'welcome', you: me.id, ...st, members: this.members() });
      this.broadcast({ type: 'members', members: this.members() });
      return;
    }
    if (!me.joined) return;
    const st = await this.state();
    switch (m.type) {
      case 'np':
        me.np = cleanTrack(m.track);
        ws.serializeAttachment(me);
        this.broadcast({ type: 'members', members: this.members() });
        break;
      case 'add': {
        const t = cleanTrack(m.track);
        if (!t || !(t.id || t.name)) return;
        st.queue.push({ ...t, by: me.name, key: crypto.randomUUID().slice(0, 8) });
        st.queue = st.queue.slice(-200);
        await this.ctx.storage.put('queue', st.queue);
        this.broadcast({ type: 'queue', queue: st.queue });
        break;
      }
      case 'remove':
        st.queue = st.queue.filter((q) => q.key !== m.key);
        await this.ctx.storage.put('queue', st.queue);
        this.broadcast({ type: 'queue', queue: st.queue });
        break;
      case 'move': {
        const i = st.queue.findIndex((q) => q.key === m.key);
        const j = Math.max(0, Math.min(st.queue.length - 1, i + (m.dir > 0 ? 1 : -1)));
        if (i < 0 || i === j) return;
        const [x] = st.queue.splice(i, 1);
        st.queue.splice(j, 0, x);
        await this.ctx.storage.put('queue', st.queue);
        this.broadcast({ type: 'queue', queue: st.queue });
        break;
      }
      case 'chat': {
        const text = clean(m.text, 300).trim();
        if (!text) return;
        const line = { name: me.name, text, t: Date.now() };
        st.chat.push(line);
        await this.ctx.storage.put('chat', st.chat.slice(-60));
        this.broadcast({ type: 'chat', line });
        break;
      }
      case 'drop': {
        const t = cleanTrack(m.track);
        if (!t) return;
        this.broadcast({ type: 'drop', track: t, at: Date.now() + 4000, by: me.name });
        break;
      }
    }
  }

  async webSocketClose(ws) {
    try { ws.close(); } catch {}
    const a = ws.deserializeAttachment();
    if (a) { a.joined = false; ws.serializeAttachment(a); }
    this.broadcast({ type: 'members', members: this.members() });
  }
  async webSocketError(ws) { await this.webSocketClose(ws); }
}

// ---------- vault (smart playlists in the cloud) ----------
async function sha(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function refresh(clientId, refreshToken) {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }),
  });
  if (!r.ok) throw new Error(`Spotify refused the login (${r.status}): ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

function makeApi(token) {
  return async function api(path, opts = {}) {
    const url = path.startsWith('http') ? path : 'https://api.spotify.com/v1' + path;
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await fetch(url, {
        method: opts.method || 'GET',
        headers: { authorization: 'Bearer ' + token, ...(opts.body ? { 'content-type': 'application/json' } : {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      if (r.status === 429) {
        await new Promise((ok) => setTimeout(ok, Math.min(30, Number(r.headers.get('retry-after')) || 2) * 1000));
        continue;
      }
      if (!r.ok) throw new Error(`Spotify ${r.status} on ${path.split('?')[0]}`);
      return r.status === 204 ? null : r.json().catch(() => null);
    }
    throw new Error('Spotify kept rate-limiting');
  };
}

export class Vault extends DurableObject {
  async user(req) {
    const key = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
    if (key.length < 32) return null;
    const uid = await this.ctx.storage.get('k:' + (await sha(key)));
    return uid ? this.ctx.storage.get('u:' + uid) : null;
  }

  async access(u) {
    if (u.access && u.exp > Date.now() + 60000) return u.access;
    const t = await refresh(u.clientId, u.refresh);
    u.access = t.access_token;
    u.exp = Date.now() + t.expires_in * 1000;
    if (t.refresh_token) u.refresh = t.refresh_token;
    await this.ctx.storage.put('u:' + u.id, u);
    return u.access;
  }

  async runUser(u, only) {
    const api = makeApi(await this.access(u));
    for (const rule of u.rules || []) {
      if (only && rule.id !== only) continue;
      if (!SOURCES[rule.source]?.cloud || !rule.playlistId) continue;
      const entry = { t: Date.now(), rule: rule.id, name: rule.name };
      try { entry.n = await runRule(api, rule); } catch (e) { entry.err = String(e.message || e); }
      u.log = [entry, ...(u.log || [])].slice(0, 40);
    }
    await this.ctx.storage.put('u:' + u.id, u);
  }

  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p === '/internal/run') {
        const users = await this.ctx.storage.list({ prefix: 'u:' });
        for (const u of users.values()) {
          try { await this.runUser(u); } catch (e) {
            u.log = [{ t: Date.now(), err: String(e.message || e) }, ...(u.log || [])].slice(0, 40);
            await this.ctx.storage.put('u:' + u.id, u);
          }
        }
        return json({ ok: true, users: users.size });
      }
      if (p === '/api/vault/register' && req.method === 'POST') {
        const { clientId, refreshToken } = await req.json();
        if (!/^[a-f0-9]{32}$/.test(clientId || '') || !refreshToken) return json({ error: 'missing login' }, 400);
        const t = await refresh(clientId, refreshToken);
        const me = await makeApi(t.access_token)('/me');
        const key = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
        const old = await this.ctx.storage.get('u:' + me.id);
        if (old?.keyHash) await this.ctx.storage.delete('k:' + old.keyHash);
        const u = {
          ...(old || {}), id: me.id, name: me.display_name || me.id, clientId,
          refresh: t.refresh_token || refreshToken, access: t.access_token,
          exp: Date.now() + t.expires_in * 1000, keyHash: await sha(key),
        };
        await this.ctx.storage.put('u:' + me.id, u);
        await this.ctx.storage.put('k:' + u.keyHash, me.id);
        return json({ key, access: u.access, exp: u.exp, rules: u.rules || [] });
      }
      const u = await this.user(req);
      if (!u) return json({ error: 'not signed in to the vault' }, 401);
      if (p === '/api/vault/token') return json({ access: await this.access(u), exp: u.exp });
      if (p === '/api/vault/rules' && req.method === 'GET') return json({ rules: u.rules || [], log: u.log || [] });
      if (p === '/api/vault/rules' && req.method === 'PUT') {
        const { rules } = await req.json();
        u.rules = (Array.isArray(rules) ? rules : []).slice(0, 50);
        await this.ctx.storage.put('u:' + u.id, u);
        return json({ ok: true });
      }
      if (p === '/api/vault/run' && req.method === 'POST') {
        await this.runUser(u, url.searchParams.get('rule'));
        return json({ log: u.log || [] });
      }
      if (p === '/api/vault/me' && req.method === 'DELETE') {
        await this.ctx.storage.delete('k:' + u.keyHash);
        await this.ctx.storage.delete('u:' + u.id);
        return json({ ok: true });
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e.message || e) }, 500);
    }
  }
}
