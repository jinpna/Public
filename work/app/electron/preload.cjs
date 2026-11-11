const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openLoginWindow: (data) => ipcRenderer.invoke('open-login-window', data),
  onCookieCaptured: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('cookie-captured', handler);
    return () => ipcRenderer.removeListener('cookie-captured', handler);
  },
  selectCodeProject: () => ipcRenderer.invoke('choose-code-project'),
  selectSaveDirectory: (currentPath) => ipcRenderer.invoke('choose-save-directory', currentPath),
  cacheInfo: () => ipcRenderer.invoke('muse-cache-info'),
  clearCache: () => ipcRenderer.invoke('muse-cache-clear'),
  isElectron: true
});
