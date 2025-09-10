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

  function tick() {
    if (queueMode) {
      // process first incomplete todo
      const idx = firstIncompleteIndex();
      if (idx === -1) {
        // nothing left
        completeAll();
        return;
      }
      const t = todos[idx];
      if (t.estimateSeconds > 0) {
        t.estimateSeconds -= 1;
        saveTodos();
      }
      if (t.estimateSeconds <= 0) {
        // delete finished item and notify
        const finished = todos.splice(idx, 1)[0];
        saveTodos();
        if (window.api && typeof window.api.notify === 'function') {
          window.api.notify('To-Do Complete', `"${finished.title}" selesai.`);
        }
        try { doneSound.volume = 0.6; doneSound.currentTime = 0; doneSound.play().catch(() => {}); } catch (_) {}
      }
      // refresh active id to new first incomplete
      const nextIdx = firstIncompleteIndex();
      activeTodoId = nextIdx !== -1 ? todos[nextIdx].id : null;
      render();
      if (totalRemainingSeconds() <= 0) {
        completeAll();
      }
    } else {
      if (remainingSeconds > 0) {
        remainingSeconds -= 1;
        render();
        if (remainingSeconds === 0) complete();
      }
    }
  }

  function start() {
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
    clearInterval(intervalId);
    intervalId = setInterval(tick, 1000);
  }

  function pause() {
    if (state !== 'running') return;
    state = 'paused';
    clearInterval(intervalId);
    render();
  }

  function reset() {
    clearInterval(intervalId);
    state = 'idle';
    // reset manual timer to inputs; queue mode remains but idle
    remainingSeconds = readInputsToSeconds();
    if (queueMode) initialQueueTotalSeconds = totalRemainingSeconds();
    render();
  }

  function complete() {
    clearInterval(intervalId);
    state = 'finished';
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
      li.querySelector('[data-action="complete"]').addEventListener('click', (e) => {
        e.stopPropagation();
        // delete item on manual complete
        const idx2 = todos.findIndex(x => x.id === t.id);
        if (idx2 !== -1) todos.splice(idx2,1);
        if (activeTodoId === t.id) { pause(); activeTodoId = null; }
        saveTodos();
        render();
      });
      li.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
        e.stopPropagation();
        const newTitle = prompt('Edit title', t.title);
        if (newTitle != null && newTitle.trim() !== '') t.title = newTitle.trim();
        const newMinutes = prompt('Edit estimate (minutes)', Math.round(t.estimateSeconds/60).toString());
        if (newMinutes != null && !Number.isNaN(parseInt(newMinutes,10))) {
          t.estimateSeconds = clamp(parseInt(newMinutes,10),1,9999)*60;
        }
        if (activeTodoId === t.id) {
          remainingSeconds = t.estimateSeconds;
          state = 'idle';
        }
        saveTodos();
        render();
      });
      li.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = todos.findIndex(x => x.id === t.id);
        if (idx !== -1) todos.splice(idx,1);
        if (activeTodoId === t.id) {
          activeTodoId = null;
          reset();
        } else {
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
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData('text/plain');
        if (!draggedId || draggedId === t.id) return;
        const from = todos.findIndex(x => x.id === draggedId);
        const to = index;
        if (from === -1) return;
        const [moved] = todos.splice(from,1);
        todos.splice(to,0,moved);
        saveTodos();
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
    clearAllBtn.addEventListener('click', () => {
      if (!confirm('Clear all tasks?')) return;
      todos = [];
      activeTodoId = null;
      saveTodos();
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


