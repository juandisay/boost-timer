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
        const denom = initialTotalSeconds > 0 ? initialTotalSeconds : remainingSeconds;
        pct = denom > 0 ? Math.round((1 - (remainingSeconds / denom)) * 100) : 0;
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
})();


