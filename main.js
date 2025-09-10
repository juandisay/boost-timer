const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');

let mainWindow = null;
let tray = null;
let isAlwaysOnTop = false;
let isQuitting = false;
let lastTimeText = '00:00:00';
let focusWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 820,
    height: 620,
    minWidth: 560,
    minHeight: 420,
    title: 'Countdown Timer',
    alwaysOnTop: isAlwaysOnTop,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const startUrl = new URL(`file://${path.join(__dirname, 'index.html')}`).toString();
  mainWindow.loadURL(startUrl);
  try { mainWindow.center(); } catch (_) {}

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Hide to tray on close instead of quitting (common macOS behavior for menu bar apps)
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      if (mainWindow) mainWindow.hide();
    }
  });
  mainWindow.on('minimize', (e) => {
    // Keep available from tray when minimized
    e.preventDefault();
    if (mainWindow) mainWindow.hide();
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('window:setAlwaysOnTop', (_event, shouldBeOnTop) => {
  isAlwaysOnTop = Boolean(shouldBeOnTop);
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(isAlwaysOnTop);
  }
  return isAlwaysOnTop;
});

ipcMain.handle('window:getAlwaysOnTop', () => {
  return isAlwaysOnTop;
});

ipcMain.handle('notify', (_event, { title, body }) => {
  try {
    const n = new Notification({ title, body });
    n.show();
  } catch (_) {}
});

ipcMain.handle('timer:getLatest', () => lastTimeText);

ipcMain.handle('focus:open', () => {
  if (focusWindow && !focusWindow.isDestroyed()) {
    focusWindow.show();
    focusWindow.focus();
    return true;
  }
  focusWindow = new BrowserWindow({
    width: 420,
    height: 180,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  const focusUrl = new URL(`file://${path.join(__dirname, 'focus.html')}`).toString();
  focusWindow.loadURL(focusUrl);
  focusWindow.on('closed', () => { focusWindow = null; });
  return true;
});

ipcMain.handle('focus:close', () => {
  if (focusWindow && !focusWindow.isDestroyed()) {
    focusWindow.close();
    focusWindow = null;
    return true;
  }
  return false;
});

ipcMain.on('timer:update', (_event, timeText) => {
  if (typeof timeText === 'string') {
    lastTimeText = timeText;
    updateTrayTitle();
    if (focusWindow && !focusWindow.isDestroyed()) {
      focusWindow.webContents.send('focus:update', lastTimeText);
    }
  }
});

function createTray() {
  if (tray) return tray;
  const emptyImg = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Z6z3scAAAAASUVORK5CYII=');
  tray = new Tray(emptyImg);
  tray.setToolTip('Countdown Timer');
  updateTrayTitle();
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => toggleWindowVisibility());
  return tray;
}

function updateTrayTitle() {
  if (!tray) return;
  // Show a compact title with an icon-like glyph
  tray.setTitle(`⏱ ${lastTimeText}`);
}

function toggleWindowVisibility() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function buildTrayMenu() {
  const template = [
    {
      label: mainWindow && mainWindow.isVisible() ? 'Hide' : 'Show',
      click: () => toggleWindowVisibility()
    },
    {
      type: 'checkbox',
      label: 'Always on Top',
      checked: isAlwaysOnTop,
      click: (item) => {
        isAlwaysOnTop = !!item.checked;
        if (mainWindow) mainWindow.setAlwaysOnTop(isAlwaysOnTop);
        // refresh menu to reflect state
        if (tray) tray.setContextMenu(buildTrayMenu());
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ];
  return Menu.buildFromTemplate(template);
}

// Rebuild tray menu when window show/hide changes
app.on('browser-window-blur', () => tray && tray.setContextMenu(buildTrayMenu()))
app.on('browser-window-focus', () => tray && tray.setContextMenu(buildTrayMenu()))


