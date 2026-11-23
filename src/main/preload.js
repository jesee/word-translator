const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  translate: (args) => ipcRenderer.invoke('translate', args),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (patch) => ipcRenderer.invoke('save-settings', patch),
  listEngines: () => ipcRenderer.invoke('list-engines'),
  hidePopup: () => ipcRenderer.invoke('hide-popup'),
  copyResult: (text) => ipcRenderer.invoke('copy-result', text),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  getHotkey: () => ipcRenderer.invoke('get-hotkey'),
  setHotkey: (combo) => ipcRenderer.invoke('set-hotkey', combo),
  onTranslateStart: (cb) => ipcRenderer.on('translate-start', (_e, text) => cb(text)),
});
