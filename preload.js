const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  setAlwaysOnTop: async (onTop) => ipcRenderer.invoke('window:setAlwaysOnTop', onTop),
  getAlwaysOnTop: async () => ipcRenderer.invoke('window:getAlwaysOnTop'),
  notify: async (title, body) => {
    try {
      // Try HTML5 Notification first (renderer-friendly)
      if (typeof window !== 'undefined' && 'Notification' in window) {
        let perm = window.Notification.permission;
        if (perm !== 'granted') {
          try { perm = await window.Notification.requestPermission(); } catch (_) {}
        }
        if (perm === 'granted') {
          // eslint-disable-next-line no-new
          new window.Notification(title, { body });
          return;
        }
      }
    } catch (_) {}
    // Fallback to main-process notification
    try { await ipcRenderer.invoke('notify', { title, body }); } catch (_) {}
  },
  sendTimerUpdate: (timeText) => {
    try { ipcRenderer.send('timer:update', timeText); } catch (_) {}
  },
  focusOpen: () => ipcRenderer.invoke('focus:open'),
  focusClose: () => ipcRenderer.invoke('focus:close')
});

// Additional channel helpers for focus window
contextBridge.exposeInMainWorld('focusApi', {
  onUpdate: (handler) => {
    try {
      const listener = (_e, text) => handler(text);
      ipcRenderer.on('focus:update', listener);
      return () => ipcRenderer.off('focus:update', listener);
    } catch (_) { return () => {}; }
  },
  getLatestTime: () => ipcRenderer.invoke('timer:getLatest').catch(() => '00:00:00')
});


