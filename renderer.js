(function () {
  const displayEl = document.getElementById('display');
  const hoursEl = document.getElementById('hours');
  const minutesEl = document.getElementById('minutes');
  const secondsEl = document.getElementById('seconds');
  const startPauseBtn = document.getElementById('startPause');
  const resetBtn = document.getElementById('reset');
  const aotCheckbox = document.getElementById('alwaysOnTop');
  const doneSound = document.getElementById('doneSound');
  const todoForm = document.getElementById('todoForm');
  const todoTitle = document.getElementById('todoTitle');
  const todoEstimate = document.getElementById('todoEstimate');
  const todoUnit = document.getElementById('todoUnit');
  const todoList = document.getElementById('todoList');
  const totalRemainingEl = document.getElementById('totalRemaining');
  const tasksCountEl = document.getElementById('tasksCount');
  const progressBarEl = document.getElementById('progressBar');
  const focusBtn = document.getElementById('focusMode');
  const focusOverlay = document.getElementById('focusOverlay');
  const focusTimeEl = document.getElementById('focusTime');
  const focusCloseBtn = document.getElementById('focusClose');

  let initialTotalSeconds = 0;
  let remainingSeconds = 0;
  let intervalId = null;
  let state = 'idle'; // 'idle' | 'running' | 'paused' | 'finished'
  let queueMode = false; // when true, display shows sum of todos and ticks through them sequentially
  let initialQueueTotalSeconds = 0; // baseline for progress in queue mode
  let backgroundTimerActive = false; // Track if background timer is running

  // To-Do state
  /** @type {{id:string,title:string,estimateSeconds:number,completed:boolean}[]} */
  let todos = [];
  let activeTodoId = null;

  function clamp(num, min, max) { return Math.max(min, Math.min(max, num)); }
  function pad(num) { return String(num).padStart(2, '0'); }

  function readInputsToSeconds() {
    const h = clamp(parseInt(hoursEl.value || '0', 10) || 0, 0, 99);
    const m = clamp(parseInt(minutesEl.value || '0', 10) || 0, 0, 59);
    const s = clamp(parseInt(secondsEl.value || '0', 10) || 0, 0, 59);
    hoursEl.value = h;
    minutesEl.value = m;
    secondsEl.value = s;
    return h * 3600 + m * 60 + s;
  }

  function render() {
    const total = queueMode ? totalRemainingSeconds() : remainingSeconds;
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const text = `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    displayEl.textContent = text;
    if (focusTimeEl) focusTimeEl.textContent = text;
    try { window.api.sendTimerUpdate(text); } catch (_) {}

    displayEl.classList.remove('running', 'paused', 'finished');
    if (state === 'running') displayEl.classList.add('running');
    if (state === 'paused') displayEl.classList.add('paused');
    if (state === 'finished') displayEl.classList.add('finished');

    startPauseBtn.textContent = state === 'running' ? 'Pause' : 'Start';
    // summary
    const totalSecs = totalRemainingSeconds();
    const totalText = formatSeconds(totalSecs);
    if (totalRemainingEl) totalRemainingEl.textContent = totalText;
    if (tasksCountEl) tasksCountEl.textContent = `${todos.length} tasks`;
    if (progressBarEl) {
      let pct = 0;
      if (queueMode) {
        const denom = initialQueueTotalSeconds > 0 ? initialQueueTotalSeconds : totalSecs;
        pct = denom > 0 ? Math.round((1 - (totalSecs / denom)) * 100) : 100;
      } else {
        // Fix: Only calculate progress if we have a valid initial value
        if (initialTotalSeconds > 0) {
          pct = Math.round((1 - (remainingSeconds / initialTotalSeconds)) * 100);
        } else {
          pct = 0;
        }
      }
      pct = Math.max(0, Math.min(100, pct));
      progressBarEl.style.width = `${pct}%`;
    }
    renderTodos();
  }

  // Background timer update handler
  function handleBackgroundUpdate(data) {
    if (!data) return;
    
    const { timeText, remainingSeconds: bgRemainingSeconds, queueMode: bgQueueMode, todos: bgTodos, activeTodoId: bgActiveTodoId, isRunning } = data;
    
    // Update local state from background timer
    remainingSeconds = bgRemainingSeconds || remainingSeconds;
    queueMode = bgQueueMode || queueMode;
    todos = bgTodos || todos;
    activeTodoId = bgActiveTodoId || activeTodoId;
    
    // Update display
    if (timeText) {
      displayEl.textContent = timeText;
      if (focusTimeEl) focusTimeEl.textContent = timeText;
    }
    
    // Update state based on background timer
    if (isRunning) {
      state = 'running';
    } else {
      state = 'paused';
    }
    
    // Check for completion
    if (!isRunning && remainingSeconds === 0) {
      state = 'finished';
    }
    
    // Update UI
    render();
  }
  
  // Sound notification handler
  function handlePlaySound() {
    try { 
      doneSound.volume = 0.6; 
      doneSound.currentTime = 0; 
      doneSound.play().catch(() => {}); 
    } catch (_) {}
  }

  async function start() {
    if (state === 'running') return;
    // Prefer queue mode when there are todos
    const hasTodos = todos.length > 0;
    queueMode = hasTodos;
    if (!queueMode) {
      if (state === 'idle' || state === 'finished') {
        initialTotalSeconds = readInputsToSeconds();
        remainingSeconds = initialTotalSeconds;
      }
      if (remainingSeconds <= 0) return;
    } else {
      // ensure an active item is set
      const idx = firstIncompleteIndex();
      if (idx === -1) return; // nothing to do
      activeTodoId = todos[idx].id;
      initialQueueTotalSeconds = totalRemainingSeconds();
    }
    state = 'running';
    render();
    
    // Use background timer instead of local setInterval
    try {
      await window.api.startTimer({
        remainingSeconds: queueMode ? totalRemainingSeconds() : remainingSeconds,
        initialSeconds: queueMode ? initialQueueTotalSeconds : initialTotalSeconds,
        queueMode: queueMode,
        todos: todos,
        activeTodoId: activeTodoId
      });
      backgroundTimerActive = true;
    } catch (error) {
      console.error('Failed to start background timer:', error);
      // Fallback to local timer
      clearInterval(intervalId);
      intervalId = setInterval(tick, 1000);
    }
  }

  async function pause() {
    if (state !== 'running') return;
    state = 'paused';
    
    // Use background timer pause
    try {
      await window.api.pauseTimer();
      backgroundTimerActive = false;
    } catch (error) {
      console.error('Failed to pause background timer:', error);
      // Fallback to local timer
      clearInterval(intervalId);
    }
    render();
  }

  async function reset() {
    clearInterval(intervalId);
    state = 'idle';
    // reset manual timer to inputs; queue mode remains but idle
    remainingSeconds = readInputsToSeconds();
    if (queueMode) initialQueueTotalSeconds = totalRemainingSeconds();
    
    // Use background timer reset
    try {
      await window.api.resetTimer({
        remainingSeconds: remainingSeconds,
        initialSeconds: initialTotalSeconds,
        queueMode: queueMode,
        todos: todos,
        activeTodoId: activeTodoId
      });
      backgroundTimerActive = false;
    } catch (error) {
      console.error('Failed to reset background timer:', error);
    }
    render();
  }

  function complete() {
    clearInterval(intervalId);
    state = 'finished';
    backgroundTimerActive = false;
    render();
    try { doneSound.volume = 0.6; doneSound.currentTime = 0; doneSound.play().catch(() => {}); } catch (_) {}
    if (window.api && typeof window.api.notify === 'function') {
      window.api.notify('Timer Complete', 'Your countdown has finished.');
    }

    // Auto-complete active to-do
    if (activeTodoId) {
      const idx = todos.findIndex(t => t.id === activeTodoId);
      if (idx !== -1) {
        // delete on completion
        todos.splice(idx,1);
        activeTodoId = null;
        saveTodos();
        renderTodos();
      }
    }
  }

  function completeAll() {
    clearInterval(intervalId);
    state = 'finished';
    queueMode = true;
    backgroundTimerActive = false;
    render();
    try { doneSound.volume = 0.6; doneSound.currentTime = 0; doneSound.play().catch(() => {}); } catch (_) {}
    if (window.api && typeof window.api.notify === 'function') {
      window.api.notify('Semua To-Do Selesai', 'Semua tugas telah diselesaikan.');
    }
    initialQueueTotalSeconds = 0;
  }

  startPauseBtn.addEventListener('click', () => {
    if (state === 'running') pause(); else start();
  });
  resetBtn.addEventListener('click', reset);
  if (focusBtn) focusBtn.addEventListener('click', async () => {
    try { await window.api.focusOpen(); } catch (_) {}
  });
  if (focusCloseBtn) focusCloseBtn.addEventListener('click', async () => {
    try { await window.api.focusClose(); } catch (_) {}
  });

  // Always on top
  (async function initAot() {
    try {
      const cur = await window.api.getAlwaysOnTop();
      aotCheckbox.checked = !!cur;
    } catch (_) {}
  })();
  aotCheckbox.addEventListener('change', async (e) => {
    try { await window.api.setAlwaysOnTop(e.target.checked); } catch (_) {}
  });

  // Initialize background timer listeners
  if (window.api && typeof window.api.onTimerBackgroundUpdate === 'function') {
    window.api.onTimerBackgroundUpdate(handleBackgroundUpdate);
  }
  
  if (window.api && typeof window.api.onTimerPlaySound === 'function') {
    window.api.onTimerPlaySound(handlePlaySound);
  }

  // Handle window visibility changes to sync timer state
  document.addEventListener('visibilitychange', async () => {
    if (!document.hidden && window.api && typeof window.api.getTimerState === 'function') {
      try {
        const bgState = await window.api.getTimerState();
        if (bgState) {
          // Sync local state with background timer
          remainingSeconds = bgState.remainingSeconds || remainingSeconds;
          queueMode = bgState.queueMode || queueMode;
          todos = bgState.todos || todos;
          activeTodoId = bgState.activeTodoId || activeTodoId;
          state = bgState.isRunning ? 'running' : 'paused';
          backgroundTimerActive = bgState.isRunning;
          
          // Update UI
          render();
        }
      } catch (error) {
        console.error('Failed to sync timer state:', error);
      }
    }
  });

  // Initialize view
  remainingSeconds = readInputsToSeconds();
  render();

  /* =============================
   * To-Do logic
   * ============================= */
  function uid() { return Math.random().toString(36).slice(2, 10); }
  function loadTodos() {
    try {
      const raw = localStorage.getItem('todos.v1');
      if (raw) todos = JSON.parse(raw);
    } catch (_) { todos = []; }
  }
  function saveTodos() {
    try { localStorage.setItem('todos.v1', JSON.stringify(todos)); } catch (_) {}
  }

  function renderTodos() {
    // build list
    todoList.innerHTML = '';
    console.log('Rendering todos:', todos.length);
    todos.forEach((t, index) => {
      const li = document.createElement('li');
      li.className = 'todo-item' + (t.id === activeTodoId ? ' active' : '');
      li.draggable = true;
      li.dataset.id = t.id;
      li.innerHTML = `
        <div class="todo-handle">⋮⋮</div>
        <div class="todo-title">${escapeHtml(t.title)}</div>
        <div class="todo-meta">${formatSeconds(t.estimateSeconds)}</div>
        <div class="todo-actions">
          <button data-action="complete">Done</button>
          <button data-action="edit">Edit</button>
          <button data-action="delete">Delete</button>
        </div>
      `;
      // click to select and start timing
      li.addEventListener('click', (e) => {
        // avoid when pressing action buttons
        if (e.target instanceof HTMLElement && e.target.closest('.todo-actions')) return;
        setActiveTodo(t.id);
        start();
      });
      // actions
      li.querySelector('[data-action="complete"]').addEventListener('click', async (e) => {
        e.stopPropagation();
        // delete item on manual complete
        const idx2 = todos.findIndex(x => x.id === t.id);
        if (idx2 !== -1) todos.splice(idx2,1);
        if (activeTodoId === t.id) { 
          await pause(); 
          activeTodoId = null; 
        }
        saveTodos();
        
        // Update background timer state if it's running
        if (backgroundTimerActive && window.api && typeof window.api.updateTimerState === 'function') {
          try {
            await window.api.updateTimerState({
              todos: todos,
              remainingSeconds: queueMode ? totalRemainingSeconds() : remainingSeconds,
              activeTodoId: activeTodoId
            });
          } catch (error) {
            console.error('Failed to update background timer state:', error);
          }
        }
        
        render();
      });
      const editButton = li.querySelector('[data-action="edit"]');
      if (editButton) {
        editButton.addEventListener('click', async (e) => {
          e.stopPropagation();
          console.log('Edit button clicked for todo:', t.id, t.title);
        
        try {
          // Create a simple edit interface
          const editDiv = document.createElement('div');
          editDiv.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 20px; border: 2px solid #333; border-radius: 8px; z-index: 1000; box-shadow: 0 4px 20px rgba(0,0,0,0.3);';
          editDiv.innerHTML = `
            <h3 style="margin: 0 0 15px 0;">Edit Todo</h3>
            <div style="margin-bottom: 10px;">
              <label style="display: block; margin-bottom: 5px;">Title:</label>
              <input type="text" id="editTitle" value="${t.title}" style="width: 100%; padding: 5px; border: 1px solid #ccc; border-radius: 4px;">
            </div>
            <div style="margin-bottom: 15px;">
              <label style="display: block; margin-bottom: 5px;">Estimate (minutes):</label>
              <input type="number" id="editMinutes" value="${Math.round(t.estimateSeconds/60)}" min="1" max="9999" style="width: 100%; padding: 5px; border: 1px solid #ccc; border-radius: 4px;">
            </div>
            <div style="text-align: right;">
              <button id="editCancel" style="margin-right: 10px; padding: 5px 15px; border: 1px solid #ccc; background: #f5f5f5; border-radius: 4px; cursor: pointer;">Cancel</button>
              <button id="editSave" style="padding: 5px 15px; border: 1px solid #007cba; background: #007cba; color: white; border-radius: 4px; cursor: pointer;">Save</button>
            </div>
          `;
          
          document.body.appendChild(editDiv);
          
          // Focus on title input
          const titleInput = editDiv.querySelector('#editTitle');
          const minutesInput = editDiv.querySelector('#editMinutes');
          titleInput.focus();
          titleInput.select();
          
          // Handle save
          const saveEdit = () => {
            const newTitle = titleInput.value.trim();
            const newMinutes = parseInt(minutesInput.value, 10);
            
            if (newTitle && newMinutes > 0) {
              t.title = newTitle;
              t.estimateSeconds = clamp(newMinutes, 1, 9999) * 60;
              console.log('Todo updated:', { title: t.title, estimateSeconds: t.estimateSeconds });
              
              // Update active todo if this is the current one
              if (activeTodoId === t.id) {
                remainingSeconds = t.estimateSeconds;
                state = 'idle';
                console.log('Updated active todo remaining seconds:', remainingSeconds);
              }
              
              // Save to localStorage
              saveTodos();
              console.log('Todos saved to localStorage');
              
              // Update background timer state if it's running
              if (backgroundTimerActive && window.api && typeof window.api.updateTimerState === 'function') {
                window.api.updateTimerState({
                  todos: todos,
                  remainingSeconds: queueMode ? totalRemainingSeconds() : remainingSeconds,
                  activeTodoId: activeTodoId
                }).then(() => {
                  console.log('Background timer state updated');
                }).catch(error => {
                  console.error('Failed to update background timer state:', error);
                });
              }
              
              // Re-render the UI
              render();
              console.log('UI re-rendered after edit');
            }
            
            document.body.removeChild(editDiv);
          };
          
          // Handle cancel
          const cancelEdit = () => {
            document.body.removeChild(editDiv);
          };
          
          // Event listeners
          editDiv.querySelector('#editSave').addEventListener('click', saveEdit);
          editDiv.querySelector('#editCancel').addEventListener('click', cancelEdit);
          
          // Handle Enter key
          const handleKeyPress = (e) => {
            if (e.key === 'Enter') {
              saveEdit();
            } else if (e.key === 'Escape') {
              cancelEdit();
            }
          };
          
          titleInput.addEventListener('keydown', handleKeyPress);
          minutesInput.addEventListener('keydown', handleKeyPress);
          
          // Close on outside click
          editDiv.addEventListener('click', (e) => {
            if (e.target === editDiv) {
              cancelEdit();
            }
          });
          
        } catch (error) {
          console.error('Error in edit todo:', error);
        }
        });
      } else {
        console.error('Edit button not found for todo:', t.id);
      }
      li.querySelector('[data-action="delete"]').addEventListener('click', async (e) => {
        e.stopPropagation();
        const idx = todos.findIndex(x => x.id === t.id);
        if (idx !== -1) todos.splice(idx,1);
        if (activeTodoId === t.id) {
          activeTodoId = null;
          await reset();
        } else {
          // Update background timer state if it's running
          if (backgroundTimerActive && window.api && typeof window.api.updateTimerState === 'function') {
            try {
              await window.api.updateTimerState({
                todos: todos,
                remainingSeconds: queueMode ? totalRemainingSeconds() : remainingSeconds,
                activeTodoId: activeTodoId
              });
            } catch (error) {
              console.error('Failed to update background timer state:', error);
            }
          }
          render();
        }
        saveTodos();
      });

      // drag & drop
      li.addEventListener('dragstart', (e) => {
        li.classList.add('dragging');
        e.dataTransfer.setData('text/plain', t.id);
      });
      li.addEventListener('dragend', () => li.classList.remove('dragging'));
      li.addEventListener('dragover', (e) => e.preventDefault());
      li.addEventListener('drop', async (e) => {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData('text/plain');
        if (!draggedId || draggedId === t.id) return;
        const from = todos.findIndex(x => x.id === draggedId);
        const to = index;
        if (from === -1) return;
        const [moved] = todos.splice(from,1);
        todos.splice(to,0,moved);
        saveTodos();
        
        // Update background timer state if it's running
        if (backgroundTimerActive && window.api && typeof window.api.updateTimerState === 'function') {
          try {
            await window.api.updateTimerState({
              todos: todos,
              remainingSeconds: queueMode ? totalRemainingSeconds() : remainingSeconds,
              activeTodoId: activeTodoId
            });
          } catch (error) {
            console.error('Failed to update background timer state:', error);
          }
        }
        
        renderTodos();
      });

      todoList.appendChild(li);
    });
  }

  function escapeHtml(s) { return s.replace(/[&<>"]+/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function formatSeconds(sec) {
    const hrs = Math.floor(sec/3600), mins = Math.floor((sec%3600)/60), s = sec%60;
    return `${pad(hrs)}:${pad(mins)}:${pad(s)}`;
  }

  function setActiveTodo(id) {
    activeTodoId = id;
    const todo = todos.find(t => t.id === id);
    if (!todo) return;
    // sync input fields to the todo estimate
    const hrs = Math.floor(todo.estimateSeconds/3600);
    const mins = Math.floor((todo.estimateSeconds%3600)/60);
    const secs = todo.estimateSeconds%60;
    hoursEl.value = hrs; minutesEl.value = mins; secondsEl.value = secs;
    remainingSeconds = todo.estimateSeconds;
    state = 'idle';
    render();
  }

  todoForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = (todoTitle.value || '').trim();
    let est = parseInt(todoEstimate.value || '0', 10) || 0;
    const unit = todoUnit.value; // 'm' | 'h'
    if (!title || est <= 0) return;
    if (unit === 'h') est = est * 60; // hours -> minutes first
    const estimateSeconds = clamp(est, 1, 9999) * 60;
    const item = { id: uid(), title, estimateSeconds, completed: false };
    todos.push(item);
    saveTodos();
    todoTitle.value = '';
    renderTodos();
  });

  // Toolbar: search and clear all
  const searchInput = document.getElementById('todoSearch');
  const clearAllBtn = document.getElementById('clearAll');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const q = (searchInput.value || '').toLowerCase();
      const items = Array.from(todoList.children);
      items.forEach((li) => {
        const titleEl = li.querySelector('.todo-title');
        if (!titleEl) return;
        const match = titleEl.textContent.toLowerCase().includes(q);
        li.style.display = match ? '' : 'none';
      });
    });
  }
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', async () => {
      if (!confirm('Clear all tasks?')) return;
      todos = [];
      activeTodoId = null;
      saveTodos();
      
      // Update background timer state if it's running
      if (backgroundTimerActive && window.api && typeof window.api.updateTimerState === 'function') {
        try {
          await window.api.updateTimerState({
            todos: todos,
            remainingSeconds: queueMode ? totalRemainingSeconds() : remainingSeconds,
            activeTodoId: activeTodoId
          });
        } catch (error) {
          console.error('Failed to update background timer state:', error);
        }
      }
      
      render();
    });
  }

  // initial load
  loadTodos();
  renderTodos();

  function firstIncompleteIndex() {
    return todos.findIndex(t => t.estimateSeconds > 0);
  }
  function totalRemainingSeconds() {
    return todos.reduce((sum, t) => sum + Math.max(0, t.estimateSeconds), 0);
  }

  /* =============================
   * Next Todo Modal Logic
   * ============================= */
  
  // Modal state
  let modalState = {
    isOpen: false,
    detectionTimer: null,
    countdownTimer: null,
    countdownSeconds: 20,
    lastTodoCount: 0,
    lastCompletedTodo: null,
    preferences: {
      enabled: true,
      autoCloseDelay: 20,
      showAfterCompletion: true,
      defaultTimeEstimate: 25,
      defaultTimeUnit: 'm'
    }
  };

  /**
   * Load modal preferences from localStorage
   */
  function loadModalPreferences() {
    try {
      const saved = localStorage.getItem('modalPreferences.v1');
      if (saved) {
        const preferences = JSON.parse(saved);
        modalState.preferences = { ...modalState.preferences, ...preferences };
      }
    } catch (error) {
      console.error('Failed to load modal preferences:', error);
    }
  }

  /**
   * Save modal preferences to localStorage
   */
  function saveModalPreferences() {
    try {
      localStorage.setItem('modalPreferences.v1', JSON.stringify(modalState.preferences));
    } catch (error) {
      console.error('Failed to save modal preferences:', error);
    }
  }

  /**
   * Save modal state to localStorage
   */
  function saveModalState() {
    try {
      const stateToSave = {
        lastTodoCount: modalState.lastTodoCount,
        lastCompletedTodo: modalState.lastCompletedTodo,
        preferences: modalState.preferences
      };
      localStorage.setItem('modalState.v1', JSON.stringify(stateToSave));
    } catch (error) {
      console.error('Failed to save modal state:', error);
    }
  }

  /**
   * Load modal state from localStorage
   */
  function loadModalState() {
    try {
      const saved = localStorage.getItem('modalState.v1');
      if (saved) {
        const state = JSON.parse(saved);
        modalState.lastTodoCount = state.lastTodoCount || 0;
        modalState.lastCompletedTodo = state.lastCompletedTodo || null;
        if (state.preferences) {
          modalState.preferences = { ...modalState.preferences, ...state.preferences };
        }
      }
    } catch (error) {
      console.error('Failed to load modal state:', error);
    }
  }

  /**
   * Show the settings modal
   */
  function showSettingsModal() {
    // Populate form with current preferences
    modalEnabledCheckbox.checked = modalState.preferences.enabled;
    showAfterCompletionCheckbox.checked = modalState.preferences.showAfterCompletion;
    autoCloseDelayInput.value = modalState.preferences.autoCloseDelay;
    defaultTimeEstimateInput.value = modalState.preferences.defaultTimeEstimate;
    defaultTimeUnitSelect.value = modalState.preferences.defaultTimeUnit;
    
    // Show modal
    modalSettingsModal.classList.add('show');
    modalSettingsModal.style.display = 'flex';
    
    // Focus on first input
    setTimeout(() => {
      modalEnabledCheckbox.focus();
    }, 100);
  }

  /**
   * Hide the settings modal
   */
  function hideSettingsModal() {
    modalSettingsModal.classList.remove('show');
    setTimeout(() => {
      modalSettingsModal.style.display = 'none';
    }, 300);
  }

  /**
   * Handle settings form submission
   */
  function handleSettingsSubmit(event) {
    event.preventDefault();
    
    // Update preferences
    modalState.preferences.enabled = modalEnabledCheckbox.checked;
    modalState.preferences.showAfterCompletion = showAfterCompletionCheckbox.checked;
    modalState.preferences.autoCloseDelay = parseInt(autoCloseDelayInput.value) || 20;
    modalState.preferences.defaultTimeEstimate = parseInt(defaultTimeEstimateInput.value) || 25;
    modalState.preferences.defaultTimeUnit = defaultTimeUnitSelect.value;
    
    // Save preferences
    saveModalPreferences();
    saveModalState();
    
    // Close modal
    hideSettingsModal();
    
    // Show confirmation (optional)
    console.log('Modal settings saved successfully');
  }

  /**
   * Handle modal action button clicks
   */
  function handleModalAction(action) {
    const title = modalTaskTitle.value.trim();
    const timeEstimate = parseInt(modalTimeEstimate.value) || modalState.preferences.defaultTimeEstimate;
    const timeUnit = modalTimeUnit.value;
    
    if (!title && action !== 'take-break') {
      modalTaskTitle.focus();
      return;
    }
    
    switch (action) {
      case 'add-start':
        if (title) {
          addTodoFromModal();
          closeNextTodoModal();
        }
        break;
      case 'add-more':
        if (title) {
          addTodoFromModal();
          // Clear form but keep modal open
          modalTaskTitle.value = '';
          modalTimeEstimate.value = modalState.preferences.defaultTimeEstimate;
          modalTimeUnit.value = modalState.preferences.defaultTimeUnit;
          modalTaskTitle.focus();
        }
        break;
      case 'take-break':
        closeNextTodoModal();
        // Optionally start a break timer
        break;
      default:
        closeNextTodoModal();
    }
  }

  // Modal DOM elements
  const nextTodoModal = document.getElementById('nextTodoModal');
  const modalTaskTitle = document.getElementById('nextTodoTitle');
  const modalTimeEstimate = document.getElementById('nextTodoEstimate');
  const modalTimeUnit = document.getElementById('nextTodoUnit');
  const modalCountdown = document.getElementById('modalCountdown');
  const modalForm = document.getElementById('nextTodoForm');
  
  // Settings modal DOM elements
  const modalSettingsModal = document.getElementById('modalSettingsModal');
  const modalSettingsButton = document.getElementById('modalSettings');
  const modalEnabledCheckbox = document.getElementById('modalEnabled');
  const showAfterCompletionCheckbox = document.getElementById('showAfterCompletion');
  const autoCloseDelayInput = document.getElementById('autoCloseDelay');
  const defaultTimeEstimateInput = document.getElementById('defaultTimeEstimate');
  const defaultTimeUnitSelect = document.getElementById('defaultTimeUnit');
  const modalSettingsForm = document.getElementById('modalSettingsForm');
  const cancelSettingsButton = document.getElementById('cancelSettings');

  /**
   * Initialize modal detection system
   * Monitors for todo completion and triggers modal after delay
   */
  function initModalDetection() {
    // Load saved state and preferences
    loadModalState();
    loadModalPreferences();
    
    modalState.lastTodoCount = todos.length;
    
    // Start monitoring for todo completion
    setInterval(() => {
      checkForTodoCompletion();
    }, 1000);
    
    // Save state periodically
    setInterval(() => {
      saveModalState();
    }, 30000); // Save every 30 seconds
  }

  /**
   * Check if a todo was completed and trigger modal
   */
  function checkForTodoCompletion() {
    const currentTodoCount = todos.length;
    
    // If todo count decreased, a todo was completed
    if (currentTodoCount < modalState.lastTodoCount && !modalState.isOpen) {
      modalState.lastTodoCount = currentTodoCount;
      startModalCountdown();
    } else {
      modalState.lastTodoCount = currentTodoCount;
    }
  }

  /**
   * Start the countdown before showing modal
   */
  function startModalCountdown() {
    if (!modalState.preferences.enabled || !modalState.preferences.showAfterCompletion) return;
    
    if (modalState.detectionTimer) {
      clearTimeout(modalState.detectionTimer);
    }
    
    modalState.detectionTimer = setTimeout(() => {
      showNextTodoModal();
    }, modalState.preferences.autoCloseDelay * 1000); // Configurable delay in seconds
  }

  /**
   * Show the next todo modal with countdown
   */
  function showNextTodoModal() {
    if (modalState.isOpen || !modalState.preferences.enabled) return;
    
    modalState.isOpen = true;
    modalState.countdownSeconds = modalState.preferences.autoCloseDelay;
    
    // Reset form with preference defaults
    modalTaskTitle.value = '';
    modalTimeEstimate.value = modalState.preferences.defaultTimeEstimate;
    modalTimeUnit.value = modalState.preferences.defaultTimeUnit;
    
    // Show modal with animation
    nextTodoModal.classList.add('show');
    
    // Focus on title input
    setTimeout(() => {
      modalTaskTitle.focus();
    }, 100);
    
    // Start countdown
    startModalAutoClose();
    
    // Save state
    saveModalState();
    
    // Add escape key listener
    document.addEventListener('keydown', handleModalEscape);
  }

  /**
   * Start auto-close countdown timer
   */
  function startModalAutoClose() {
    updateCountdownDisplay();
    
    modalState.countdownTimer = setInterval(() => {
      modalState.countdownSeconds--;
      updateCountdownDisplay();
      
      if (modalState.countdownSeconds <= 0) {
        closeNextTodoModal();
      }
    }, 1000);
  }

  /**
   * Update countdown display
   */
  function updateCountdownDisplay() {
    modalCountdown.textContent = `Auto-close in ${modalState.countdownSeconds}s`;
  }

  /**
   * Close the next todo modal
   */
  function closeNextTodoModal() {
    if (!modalState.isOpen) return;
    
    modalState.isOpen = false;
    
    // Clear timers
    if (modalState.countdownTimer) {
      clearInterval(modalState.countdownTimer);
      modalState.countdownTimer = null;
    }
    
    // Hide modal with animation
    nextTodoModal.classList.remove('show');
    
    // Remove escape key listener
    document.removeEventListener('keydown', handleModalEscape);
    
    // Save state
    saveModalState();
    
    // Resume timer if it was paused
    if (state === 'paused' && remainingSeconds > 0) {
      setTimeout(() => {
        start();
      }, 500);
    }
  }

  /**
   * Handle escape key to close modal
   */
  function handleModalEscape(e) {
    if (e.key === 'Escape') {
      closeNextTodoModal();
    }
  }

  /**
   * Add new todo from modal
   */
  function addTodoFromModal() {
    const title = modalTaskTitle.value.trim();
    let estimate = parseInt(modalTimeEstimate.value || '0', 10) || modalState.preferences.defaultTimeEstimate;
    const unit = modalTimeUnit.value;
    
    if (!title || estimate <= 0) {
      // Focus back on empty field
      if (!title) {
        modalTaskTitle.focus();
      } else {
        modalTimeEstimate.focus();
      }
      return;
    }
    
    // Update preferences based on user input
    modalState.preferences.defaultTimeEstimate = estimate;
    modalState.preferences.defaultTimeUnit = unit;
    saveModalPreferences();
    
    // Convert to minutes if hours
    if (unit === 'h') {
      estimate = estimate * 60;
    }
    
    const estimateSeconds = clamp(estimate, 1, 9999) * 60;
    const newTodo = {
      id: uid(),
      title: title,
      estimateSeconds: estimateSeconds,
      completed: false
    };
    
    // Add to todos list
    todos.push(newTodo);
    saveTodos();
    
    // Update modal state
    modalState.lastTodoCount = todos.length;
    saveModalState();
    
    // Update background timer state if running
    if (backgroundTimerActive && window.api && typeof window.api.updateTimerState === 'function') {
      window.api.updateTimerState({
        todos: todos,
        remainingSeconds: queueMode ? totalRemainingSeconds() : remainingSeconds,
        activeTodoId: activeTodoId
      }).catch(error => {
        console.error('Failed to update background timer state:', error);
      });
    }
    
    // Re-render todos
    renderTodos();
    
    // Set as active todo and start timer
    setActiveTodo(newTodo.id);
    
    // Close modal
    closeNextTodoModal();
    
    // Start timer with new todo
    setTimeout(() => {
      start();
    }, 300);
  }

  /**
   * Focus trap for modal accessibility
   */
  function trapFocus(e) {
    if (!modalState.isOpen) return;
    
    const focusableElements = nextTodoModal.querySelectorAll(
      'input, button, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    
    if (e.key === 'Tab') {
      if (e.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    }
  }

  // Modal event listeners
  if (modalForm) {
    modalForm.addEventListener('submit', (e) => {
      e.preventDefault();
      addTodoFromModal();
    });
  }

  // Modal button functionality is handled through data-action attributes
  // in the handleModalAction function

  // Focus trap
  document.addEventListener('keydown', trapFocus);

  // Click outside to close
  if (nextTodoModal) {
    nextTodoModal.addEventListener('click', (e) => {
      if (e.target === nextTodoModal) {
        closeNextTodoModal();
      }
    });
  }

  // Smart suggestions for task titles
  if (modalTaskTitle) {
    modalTaskTitle.addEventListener('input', (e) => {
      const value = e.target.value.toLowerCase();
      
      // Auto-suggest time estimates based on common tasks
      if (value.includes('meeting') || value.includes('call')) {
        modalTimeEstimate.value = '30';
        modalTimeUnit.value = 'm';
      } else if (value.includes('break') || value.includes('coffee')) {
        modalTimeEstimate.value = '15';
        modalTimeUnit.value = 'm';
      } else if (value.includes('review') || value.includes('check')) {
        modalTimeEstimate.value = '10';
        modalTimeUnit.value = 'm';
      } else if (value.includes('deep work') || value.includes('focus')) {
        modalTimeEstimate.value = '90';
        modalTimeUnit.value = 'm';
      }
    });
  }

  // Modal action button event listeners
  if (nextTodoModal) {
    nextTodoModal.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action) {
        e.preventDefault();
        handleModalAction(action);
      }
    });
  }

  // Handle modal form submission
  if (modalForm) {
    modalForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleModalAction('add-start');
    });
  }

  // Initialize modal detection system (already called above)
  initModalDetection();

  // Listen for modal triggers from main process
  if (window.api && typeof window.api.onModalTrigger === 'function') {
    window.api.onModalTrigger((data) => {
      handleModalTrigger(data);
    });
  }

  // Settings modal event listeners
  if (modalSettingsButton) {
    modalSettingsButton.addEventListener('click', showSettingsModal);
  }

  if (modalSettingsForm) {
    modalSettingsForm.addEventListener('submit', handleSettingsSubmit);
  }

  if (cancelSettingsButton) {
    cancelSettingsButton.addEventListener('click', hideSettingsModal);
  }

  // Close settings modal when clicking overlay
  if (modalSettingsModal) {
    modalSettingsModal.addEventListener('click', (event) => {
      if (event.target === modalSettingsModal || event.target.classList.contains('modal-overlay')) {
        hideSettingsModal();
      }
    });
  }

  // Handle escape key for settings modal
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modalSettingsModal.classList.contains('show')) {
      hideSettingsModal();
    }
  });

  /**
   * Handle modal trigger from main process
   * @param {Object} data - Trigger data from main process
   */
  function handleModalTrigger(data) {
    if (!data) return;
    
    switch (data.action) {
      case 'show':
        showNextTodoModal();
        break;
      case 'hide':
        closeNextTodoModal();
        break;
      case 'todoCompleted':
        // Handle todo completion from background timer
        // Trigger modal when a todo is completed, especially when no todos remain
        modalState.lastCompletedTodo = data.completedTodo;
        startModalCountdown();
        break;
      default:
        console.log('Unknown modal trigger action:', data.action);
    }
  }

})();


