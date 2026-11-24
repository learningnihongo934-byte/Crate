// Exposes a tiny, fixed set of Spotify commands to the Crate site.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('crateNative', {
  platform: 'mac',
  state: () => ipcRenderer.invoke('spotify:state'),
  cmd: (action, arg) => ipcRenderer.invoke('spotify:cmd', action, arg),
});

window.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('native-mac'));
