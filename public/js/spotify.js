// Spotify Web API: PKCE login (no client secret), token refresh, and a fetch wrapper.
// When cloud smart playlists are on, the Worker vault owns the refresh token and hands out access tokens.
const SCOPES = [
  'user-read-recently-played', 'user-top-read', 'user-read-currently-playing', 'user-read-playback-state',
  'user-library-read', 'user-library-modify', 'playlist-read-private', 'playlist-read-collaborative',
  'playlist-modify-private', 'playlist-modify-public',
].join(' ');
const LS = 'crate.auth';
const redirectUri = () => location.origin + '/callback';

export const getClientId = () => localStorage.getItem('crate.clientId') || '';
export const setClientId = (id) => localStorage.setItem('crate.clientId', id.trim());
const read = () => { try { return JSON.parse(localStorage.getItem(LS)) || null; } catch { return null; } };
const write = (a) => (a ? localStorage.setItem(LS, JSON.stringify(a)) : localStorage.removeItem(LS));
export const connected = () => !!read();
export const authInfo = () => read();
export const redirect = redirectUri;

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function login() {
  const clientId = getClientId();
  if (!clientId) throw new Error('Add a Spotify client ID first.');
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(12)));
  sessionStorage.setItem('crate.pkce', JSON.stringify({ verifier, state, back: location.hash || '#/' }));
  const q = new URLSearchParams({
    response_type: 'code', client_id: clientId, scope: SCOPES, redirect_uri: redirectUri(),
    code_challenge_method: 'S256', code_challenge: challenge, state,
  });
  location.href = 'https://accounts.spotify.com/authorize?' + q;
}

// Returns null if not a callback, else { ok, back, error }.
export async function handleCallback() {
  if (location.pathname !== '/callback') return null;
  const q = new URLSearchParams(location.search);
  const saved = JSON.parse(sessionStorage.getItem('crate.pkce') || '{}');
  sessionStorage.removeItem('crate.pkce');
  const back = saved.back || '#/';
  history.replaceState(null, '', '/' + back);
  if (q.get('error')) return { ok: false, back, error: q.get('error') === 'access_denied' ? 'You cancelled the Spotify login.' : q.get('error') };
  if (!q.get('code') || q.get('state') !== saved.state) return { ok: false, back, error: 'Login expired, try again.' };
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code: q.get('code'), redirect_uri: redirectUri(),
      client_id: getClientId(), code_verifier: saved.verifier,
    }),
  });
  if (!r.ok) return { ok: false, back, error: `Spotify said no (${r.status}). ${(await r.text()).slice(0, 160)}` };
  const t = await r.json();
  write({ access: t.access_token, refresh: t.refresh_token, exp: Date.now() + t.expires_in * 1000 });
  return { ok: true, back };
}

export function logout() { write(null); localStorage.removeItem('crate.me'); }

let refreshing = null;
async function token(force = false) {
  const a = read();
  if (!a) throw new Error('Not connected to Spotify');
  if (!force && a.access && a.exp > Date.now() + 60000) return a.access;
  refreshing ||= (async () => {
    let t;
    if (a.vaultKey) {
      const r = await fetch('/api/vault/token', { method: 'POST', headers: { authorization: 'Bearer ' + a.vaultKey } });
      if (!r.ok) throw new Error('Cloud login expired. Reconnect Spotify in Settings.');
      t = await r.json();
      write({ ...a, access: t.access, exp: t.exp });
    } else {
      const r = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: a.refresh, client_id: getClientId() }),
      });
      if (!r.ok) { if (r.status === 400) logout(); throw new Error('Spotify login expired. Connect again.'); }
      t = await r.json();
      write({ ...a, access: t.access_token, refresh: t.refresh_token || a.refresh, exp: Date.now() + t.expires_in * 1000 });
    }
    return read().access;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

export async function api(path, opts = {}) {
  const url = path.startsWith('http') ? path : 'https://api.spotify.com/v1' + path;
  let tok = await token();
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url, {
      method: opts.method || 'GET',
      headers: { authorization: 'Bearer ' + tok, ...(opts.body ? { 'content-type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (r.status === 401 && attempt === 0) { tok = await token(true); continue; }
    if (r.status === 429) {
      await new Promise((ok) => setTimeout(ok, Math.min(30, Number(r.headers.get('retry-after')) || 2) * 1000));
      continue;
    }
    if (r.status === 204) return null;
    if (!r.ok) {
      let msg = '';
      try { msg = (await r.json()).error?.message || ''; } catch {}
      const err = new Error(`Spotify ${r.status}${msg ? ': ' + msg : ''}`);
      err.status = r.status;
      throw err;
    }
    return r.json().catch(() => null);
  }
  throw new Error('Spotify is rate-limiting, try again in a minute.');
}

export async function me() {
  const c = localStorage.getItem('crate.me');
  if (c) return JSON.parse(c);
  const m = await api('/me');
  localStorage.setItem('crate.me', JSON.stringify({ id: m.id, name: m.display_name || m.id, img: m.images?.[0]?.url || '' }));
  return JSON.parse(localStorage.getItem('crate.me'));
}

// Cloud vault: hand our refresh token to the Worker; from then on the Worker refreshes for us.
export async function enableVault() {
  const a = read();
  if (!a) throw new Error('Connect Spotify first');
  if (a.vaultKey) return a.vaultKey;
  const r = await fetch('/api/vault/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId: getClientId(), refreshToken: a.refresh }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Could not turn on cloud updates');
  write({ access: d.access, exp: d.exp, vaultKey: d.key });
  return d.key;
}
export async function vault(path, opts = {}) {
  const a = read();
  if (!a?.vaultKey) throw new Error('Cloud updates are off');
  const r = await fetch('/api/vault/' + path, {
    method: opts.method || 'GET',
    headers: { authorization: 'Bearer ' + a.vaultKey, ...(opts.body ? { 'content-type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Vault error ' + r.status);
  return d;
}
export const vaultOn = () => !!read()?.vaultKey;
export async function disableVault() {
  try { await vault('me', { method: 'DELETE' }); } catch {}
  logout();
}
