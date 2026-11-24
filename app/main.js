// Crate for Mac: loads crate.rennko.tech and gives it a bridge to the Spotify app on this Mac
// (AppleScript), so playback control and play logging work with any account and no login.
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } = require('electron');
const { execFile } = require('child_process');
const path = require('path');

const SITE = process.env.CRATE_URL || 'https://crate.rennko.tech';

// Crate must keep polling Spotify and logging plays while its window is hidden or covered.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const ORIGIN = new URL(SITE).origin;
let win = null, tray = null, quitting = false;

function osa(script) {
  return new Promise((ok) => execFile('osascript', ['-e', script], { timeout: 5000 }, (err, out) => ok(err ? { err: String(err.message || err) } : { out: String(out).trim() })));
}

const SEP = 'character id 30';
const STATE = `if application "Spotify" is running then
tell application "Spotify"
set s to player state as string
if s is "stopped" then return "stopped"
set t to current track
set sep to ${SEP}
return s & sep & (id of t) & sep & (name of t) & sep & (artist of t) & sep & (album of t) & sep & (duration of t) & sep & (player position as string) & sep & (artwork url of t) & sep & (sound volume as string) & sep & (shuffling as string) & sep & (repeating as string)
end tell
else
return "off"
end if`;

async function state() {
  const r = await osa(STATE);
  if (r.err) return { running: false, error: r.err };
  if (r.out === 'off') return { running: false };
  if (r.out === 'stopped') return { running: true, state: 'stopped' };
  const f = r.out.split('\u001e');
  const num = (v) => Number(String(v).replace(',', '.')) || 0;
  return {
    running: true, state: f[0], uri: f[1], id: (f[1] || '').split(':')[2] || '', type: (f[1] || '').split(':')[1] || '',
    name: f[2], artist: f[3], album: f[4], duration: num(f[5]), position: num(f[6]) * 1000,
    art: f[7] || '', volume: num(f[8]), shuffle: f[9] === 'true', repeat: f[10] === 'true',
  };
}

const URI = /^spotify:(track|album|playlist|artist|episode):[A-Za-z0-9]{22}$/;
async function cmd(action, arg) {
  const tell = (s) => osa(`tell application "Spotify" to ${s}`);
  switch (action) {
    case 'playpause': case 'play': case 'pause': return tell(action);
    case 'next': return tell('next track');
    case 'previous': return tell('previous track');
    case 'activate': return tell('activate');
    case 'seek': return tell(`set player position to ${Math.max(0, Number(arg) || 0)}`);
    case 'volume': return tell(`set sound volume to ${Math.max(0, Math.min(100, Math.round(Number(arg) || 0)))}`);
    case 'shuffle': return tell(`set shuffling to ${arg ? 'true' : 'false'}`);
    case 'repeat': return tell(`set repeating to ${arg ? 'true' : 'false'}`);
    case 'playTrack':
      if (!URI.test(String(arg))) return { err: 'bad uri' };
      return tell(`play track "${arg}"`);
    default: return { err: 'unknown command' };
  }
}

// Poll from the main process (Node timers are never throttled) and push state to the page.
let pollMs = 1000, pollTimer = null, polling = false;
async function poll() {
  if (polling || !win || win.isDestroyed()) return;
  polling = true;
  try { const st = await state(); if (win && !win.isDestroyed()) win.webContents.send('spotify:push', st); }
  finally { polling = false; }
}
function startPoll() { clearInterval(pollTimer); pollTimer = setInterval(poll, pollMs); }
ipcMain.on('spotify:interval', (e, ms) => { if (fromSite(e)) { pollMs = Math.max(250, Math.min(5000, Number(ms) || 1000)); startPoll(); } });

const fromSite = (e) => { try { return new URL(e.senderFrame.url).origin === ORIGIN; } catch { return false; } };
ipcMain.handle('spotify:state', (e) => (fromSite(e) ? state() : null));
ipcMain.handle('spotify:cmd', (e, a, v) => (fromSite(e) ? cmd(a, v) : null));

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 860, minWidth: 420, minHeight: 560, backgroundColor: '#151515', title: 'Crate',
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.loadURL(SITE);
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (new URL(url).origin === ORIGIN || url.startsWith('https://accounts.spotify.com')) return;
    e.preventDefault();
    shell.openExternal(url);
  });
  win.webContents.on('did-fail-load', (_e, code, _d, url) => {
    if (code === -3 || !url.startsWith(ORIGIN)) return;
    win.loadFile(path.join(__dirname, 'offline.html'));
  });
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
}

async function trayMenu() {
  const s = await state();
  const playing = s.state === 'playing';
  const items = [
    { label: s.name ? `${s.name} · ${s.artist}`.slice(0, 60) : s.running ? 'Nothing playing' : 'Spotify is closed', enabled: false },
    { type: 'separator' },
    { label: playing ? 'Pause' : 'Play', click: () => cmd('playpause') },
    { label: 'Next', click: () => cmd('next') },
    { label: 'Previous', click: () => cmd('previous') },
    { type: 'separator' },
    { label: 'Open Crate', click: () => { win.show(); win.focus(); } },
    { label: 'Quit Crate', click: () => { quitting = true; app.quit(); } },
  ];
  tray.popUpContextMenu(Menu.buildFromTemplate(items));
}

app.whenReady().then(() => {
  createWindow();
  startPoll();
  const img = nativeImage.createFromPath(path.join(__dirname, 'build', 'trayTemplate.png'));
  img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip('Crate');
  tray.on('click', trayMenu);
  tray.on('right-click', trayMenu);
  app.on('activate', () => { win.show(); });
});
app.on('before-quit', () => { quitting = true; });
