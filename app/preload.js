// Exposes a tiny, fixed set of Spotify commands to the Crate site.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('crateNative', {
  platform: 'mac',
  state: () => ipcRenderer.invoke('spotify:state'),
  cmd: (action, arg) => ipcRenderer.invoke('spotify:cmd', action, arg),
  // State pushed by the main process every second, so polling never depends on page timers.
  onState: (cb) => ipcRenderer.on('spotify:push', (_e, s) => cb(s)),
  setInterval: (ms) => ipcRenderer.send('spotify:interval', ms),
});

window.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('native-mac'));
