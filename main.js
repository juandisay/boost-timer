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
    title: '#BoostTimer',
    frame: false,
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

ipcMain.handle('window:close', (event) => {
  // Get the window that sent the close request
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow && !senderWindow.isDestroyed()) {
    senderWindow.close();
  }
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
    const activeTodo = timerState.activeTodoId
      ? timerState.todos.find(t => t.id === timerState.activeTodoId)
      : null;
    
    console.log('Sending focus:update with:');
    console.log('  timeText:', timeText);
    console.log('  timerState.activeTodoId:', timerState.activeTodoId);
    console.log('  found activeTodo:', activeTodo);
    console.log('  activeTodo title:', activeTodo ? activeTodo.title : null);
    
    focusWindow.webContents.send('focus:update', {
      timeText,
      activeTodo: activeTodo ? activeTodo.title : null
    });
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
  console.log('focus:open called');
  
  // Hide the main window when opening focus window
  if (mainWindow && !mainWindow.isDestroyed()) {
    console.log('Hiding main window');
    mainWindow.hide();
  }
  
  if (focusWindow && !focusWindow.isDestroyed()) {
    console.log('Showing existing focus window');
    focusWindow.show();
    focusWindow.focus();
    
    // Send current state to focus window
    const activeTodo = timerState.activeTodoId
      ? timerState.todos.find(t => t.id === timerState.activeTodoId)
      : null;
    
    console.log('Sending initial focus:update to existing window:');
    console.log('  timeText:', lastTimeText);
    console.log('  activeTodo:', activeTodo ? activeTodo.title : null);
    
    focusWindow.webContents.send('focus:update', {
      timeText: lastTimeText,
      activeTodo: activeTodo ? activeTodo.title : null
    });
    
    return true;
  }
  focusWindow = new BrowserWindow({
    width: 377,
    height: 62,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  const focusUrl = new URL(`file://${path.join(__dirname, 'focus.html')}`).toString();
  focusWindow.loadURL(focusUrl);
  focusWindow.on('closed', () => { focusWindow = null; });
  
  // Send initial state once the window is ready
  focusWindow.webContents.once('did-finish-load', () => {
    console.log('Focus window did-finish-load event fired');
    const activeTodo = timerState.activeTodoId
      ? timerState.todos.find(t => t.id === timerState.activeTodoId)
      : null;
    
    console.log('Sending initial focus:update to new window:');
    console.log('  timeText:', lastTimeText);
    console.log('  activeTodo:', activeTodo ? activeTodo.title : null);
    
    focusWindow.webContents.send('focus:update', {
      timeText: lastTimeText,
      activeTodo: activeTodo ? activeTodo.title : null
    });
  });
  
  return true;
});

ipcMain.handle('focus:close', () => {
  if (focusWindow && !focusWindow.isDestroyed()) {
    focusWindow.close();
    focusWindow = null;
    
    // Show the main window when closing focus window
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('Showing main window');
      mainWindow.show();
      mainWindow.focus();
    }
    
    return true;
  }
  return false;
});

/**
 * Handle focus window resize requests
 * @param {boolean} expanded - Whether the todo section is expanded
 */
ipcMain.handle('focus:resize', (_event, expanded) => {
  if (focusWindow && !focusWindow.isDestroyed()) {
    const baseHeight = 62;
    const expandedHeight = 150; // Height when todo is visible
    const newHeight = expanded ? expandedHeight : baseHeight;
    
    focusWindow.setSize(262, newHeight);
    return true;
  }
  return false;
});

/**
 * Handle window resize requests with specific dimensions
 * @param {number} width - The desired width
 * @param {number} height - The desired height
 */
ipcMain.handle('window:resize', (_event, width, height) => {
  if (focusWindow && !focusWindow.isDestroyed()) {
    console.log(`Resizing focus window to ${width}x${height}`);
    focusWindow.setSize(width, height);
    return true;
  }
  return false;
});

/**
 * Get current active todo for focus window initialization
 * @returns {string|null} - The title of the active todo or null
 */
ipcMain.handle('focus:getActiveTodo', () => {
  console.log('focus:getActiveTodo called');
  console.log('timerState.activeTodoId:', timerState.activeTodoId);
  console.log('timerState.todos:', timerState.todos);
  console.log('timerState.todos.length:', timerState.todos.length);
  
  const activeTodo = timerState.activeTodoId
    ? timerState.todos.find(t => t.id === timerState.activeTodoId)
    : null;
  
  console.log('Found activeTodo:', activeTodo);
  const result = activeTodo ? activeTodo.title : null;
  console.log('Returning result:', result);
  return result;
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
  timerState.remainingSeconds = data.remainingSeconds !== undefined ? data.remainingSeconds : 0;
  timerState.initialSeconds = data.initialSeconds !== undefined ? data.initialSeconds : 0;
  timerState.queueMode = data.queueMode !== undefined ? data.queueMode : false;
  timerState.todos = data.todos !== undefined ? data.todos : [];
  timerState.activeTodoId = data.activeTodoId !== undefined ? data.activeTodoId : null;
  
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
  timerState.remainingSeconds = data.remainingSeconds !== undefined ? data.remainingSeconds : 0;
  timerState.initialSeconds = data.initialSeconds !== undefined ? data.initialSeconds : 0;
  timerState.queueMode = data.queueMode !== undefined ? data.queueMode : false;
  timerState.todos = data.todos !== undefined ? data.todos : [];
  timerState.activeTodoId = data.activeTodoId !== undefined ? data.activeTodoId : null;
  
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
  const iconPath = process.platform === 'darwin' 
    ? path.join(__dirname, 'build/icon.icns')
    : process.platform === 'win32'
    ? path.join(__dirname, 'build/icon.ico') 
    : path.join(__dirname, 'build/icon.png');
  const emptyImg = nativeImage.createFromPath(iconPath);
  tray = new Tray(emptyImg);
  tray.setToolTip('#BoostTimer');
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

/**
 * Toggle the visibility of the main window
 * Shows the window if hidden, hides it if visible
 */
function toggleWindowVisibility() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function toggleStartPause() {
  if (timerState.isRunning) {
    // Directly pause the timer without re-registering handler
    timerState.isRunning = false;
    stopBackgroundTimer();
    if (tray) {
      const menu = buildTrayMenu();
      menu.items[0].label = 'Start';
      tray.setContextMenu(menu);
    }
  } else {
    // Directly start the timer without re-registering handler
    timerState.isRunning = true;
    timerState.remainingSeconds = timerState.remainingSeconds || 0;
    timerState.initialSeconds = timerState.initialSeconds || 0;
    timerState.queueMode = timerState.queueMode || false;
    timerState.todos = timerState.todos || [];
    timerState.activeTodoId = timerState.activeTodoId || null;
    startBackgroundTimer();
    if (tray) {
      const menu = buildTrayMenu();
      menu.items[0].label = 'Pause';
      tray.setContextMenu(menu);
    }
  }
}

/**
 * Toggle the visibility of the focus window
 * Shows the focus window if hidden, hides it if visible
 */
function toggleFocusWindow() {
  if (focusWindow && !focusWindow.isDestroyed()) {
    if (focusWindow.isVisible()) {
      focusWindow.hide();
    } else {
      focusWindow.show();
      focusWindow.focus();
    }
  } else {
    // Create and show focus window
    focusWindow = new BrowserWindow({
      width: 377,
      height: 62,
      resizable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      transparent: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    const focusUrl = new URL(`file://${path.join(__dirname, 'focus.html')}`).toString();
    focusWindow.loadURL(focusUrl);
    focusWindow.on('closed', () => { focusWindow = null; });
  }
}

function buildTrayMenu() {
  const template = [
    {
      label: timerState.isRunning ? 'Pause' : 'Start',
      click: () => toggleStartPause()
    },
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


