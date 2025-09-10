const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');

let mainWindow = null;
let tray = null;
let isAlwaysOnTop = false;
let isQuitting = false;
let lastTimeText = '00:00:00';
let focusWindow = null;

// Timer state for background processing
let timerState = {
  isRunning: false,
  remainingSeconds: 0,
  initialSeconds: 0,
  queueMode: false,
  todos: [],
  activeTodoId: null,
  intervalId: null
};

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

// Background timer functions
function formatTime(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function startBackgroundTimer() {
  if (timerState.intervalId) {
    clearInterval(timerState.intervalId);
  }
  
  timerState.intervalId = setInterval(() => {
    if (!timerState.isRunning) return;
    
    if (timerState.queueMode) {
      // Process todos queue
      const idx = timerState.todos.findIndex(t => t.estimateSeconds > 0);
      if (idx === -1) {
        // All todos completed
        completeAllTodos();
        return;
      }
      
      const todo = timerState.todos[idx];
      if (todo.estimateSeconds > 0) {
        todo.estimateSeconds -= 1;
      }
      
      if (todo.estimateSeconds <= 0) {
        // Todo completed
        const completed = timerState.todos.splice(idx, 1)[0];
        sendNotification('To-Do Complete', `"${completed.title}" selesai.`);
        playNotificationSound();
      }
      
      // Update active todo
      const nextIdx = timerState.todos.findIndex(t => t.estimateSeconds > 0);
      timerState.activeTodoId = nextIdx !== -1 ? timerState.todos[nextIdx].id : null;
      
      // Check if all todos are done
      const totalRemaining = timerState.todos.reduce((sum, t) => sum + Math.max(0, t.estimateSeconds), 0);
      if (totalRemaining <= 0) {
        completeAllTodos();
        return;
      }
      
      // Update display with total remaining time
      const totalText = formatTime(totalRemaining);
      updateTimerDisplay(totalText);
    } else {
      // Regular countdown timer
      if (timerState.remainingSeconds > 0) {
        timerState.remainingSeconds -= 1;
        const timeText = formatTime(timerState.remainingSeconds);
        updateTimerDisplay(timeText);
        
        if (timerState.remainingSeconds === 0) {
          completeTimer();
        }
      }
    }
  }, 1000);
}

function stopBackgroundTimer() {
  if (timerState.intervalId) {
    clearInterval(timerState.intervalId);
    timerState.intervalId = null;
  }
  timerState.isRunning = false;
}

function updateTimerDisplay(timeText) {
  lastTimeText = timeText;
  updateTrayTitle();
  
  // Send update to main window - only send serializable data
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('timer:backgroundUpdate', {
      timeText,
      remainingSeconds: timerState.remainingSeconds,
      queueMode: timerState.queueMode,
      todos: timerState.todos,
      activeTodoId: timerState.activeTodoId,
      isRunning: timerState.isRunning
    });
  }
  
  // Send update to focus window
  if (focusWindow && !focusWindow.isDestroyed()) {
    focusWindow.webContents.send('focus:update', timeText);
  }
}

function completeTimer() {
  stopBackgroundTimer();
  sendNotification('Timer Complete', 'Your countdown has finished.');
  playNotificationSound();
  
  // Auto-complete active todo if in queue mode
  if (timerState.activeTodoId) {
    const idx = timerState.todos.findIndex(t => t.id === timerState.activeTodoId);
    if (idx !== -1) {
      timerState.todos.splice(idx, 1);
      timerState.activeTodoId = null;
    }
  }
}

function completeAllTodos() {
  stopBackgroundTimer();
  sendNotification('Semua To-Do Selesai', 'Semua tugas telah diselesaikan.');
  playNotificationSound();
}

function sendNotification(title, body) {
  try {
    const notification = new Notification({ title, body });
    notification.show();
  } catch (error) {
    console.error('Failed to show notification:', error);
  }
}

function playNotificationSound() {
  // We'll let the renderer handle sound playing
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('timer:playSound');
  }
}

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

// Timer control IPC handlers
ipcMain.handle('timer:start', (_event, data) => {
  timerState.isRunning = true;
  timerState.remainingSeconds = data.remainingSeconds || 0;
  timerState.initialSeconds = data.initialSeconds || 0;
  timerState.queueMode = data.queueMode || false;
  timerState.todos = data.todos || [];
  timerState.activeTodoId = data.activeTodoId || null;
  
  startBackgroundTimer();
  return true;
});

ipcMain.handle('timer:pause', () => {
  timerState.isRunning = false;
  stopBackgroundTimer();
  return true;
});

ipcMain.handle('timer:reset', (_event, data) => {
  stopBackgroundTimer();
  timerState.isRunning = false;
  timerState.remainingSeconds = data.remainingSeconds || 0;
  timerState.initialSeconds = data.initialSeconds || 0;
  timerState.queueMode = data.queueMode || false;
  timerState.todos = data.todos || [];
  timerState.activeTodoId = data.activeTodoId || null;
  
  const timeText = formatTime(timerState.remainingSeconds);
  updateTimerDisplay(timeText);
  return true;
});

ipcMain.handle('timer:getState', () => {
  return {
    isRunning: timerState.isRunning,
    remainingSeconds: timerState.remainingSeconds,
    initialSeconds: timerState.initialSeconds,
    queueMode: timerState.queueMode,
    todos: timerState.todos,
    activeTodoId: timerState.activeTodoId
  };
});

ipcMain.handle('timer:updateState', (_event, newState) => {
  timerState = { ...timerState, ...newState };
  return true;
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


