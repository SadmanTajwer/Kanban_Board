/* Vanilla Kanban with:
   - Drag & drop (HTML5 DnD)
   - LocalStorage persistence
   - Search + filters (priority, assignee)
   - Modal create/edit
   - Keyboard shortcuts
   - Undo/redo (simple command stack)
   - Theming (dark/light) persisted
   - Custom events + tiny store
*/

const q = (sel, el = document) => el.querySelector(sel);
const qa = (sel, el = document) => [...el.querySelectorAll(sel)];
const $dialog = q('#taskDialog');
const $form = q('#taskForm');
const $title = q('input[name="title"]', $form);
const $id = q('input[name="id"]', $form);
const $assigneesDL = q('#assignees');
const $filterAssignee = q('#filterAssignee');

const COLUMNS = ['backlog','todo','inprogress','done'];
const STORAGE_KEY = 'kanban.v1';
const THEME_KEY = 'kanban.theme';
const nowISO = () => new Date().toISOString().slice(0,10);

// --- Simple store with eventing and history -------------------
const Store = (() => {
  let state = load() || seed();
  let listeners = new Set();
  let undoStack = [];
  let redoStack = [];

  function notify() { listeners.forEach(fn => fn(getState())); }

  function getState(){ return structuredClone(state); }

  function commit(newState, meta={type:'unknown'}) {
    undoStack.push(structuredClone(state));
    state = structuredClone(newState);
    redoStack = []; // clear redo on new action
    persist(state);
    notify();
  }

  function set(partial, meta) {
    const next = {...state, ...partial};
    commit(next, meta);
  }

  function patchTask(id, patch){
    const next = getState();
    const idx = next.tasks.findIndex(t => t.id === id);
    if (idx === -1) return;
    next.tasks[idx] = {...next.tasks[idx], ...patch, updatedAt: Date.now()};
    commit(next, {type:'task:update', id});
  }

  function addTask(task){
    const next = getState();
    next.tasks.push(task);
    commit(next, {type:'task:add', id: task.id});
  }

  function deleteTask(id){
    const next = getState();
    next.tasks = next.tasks.filter(t => t.id !== id);
    commit(next, {type:'task:delete', id});
  }

  function moveTask(id, column, index){
    const next = getState();
    const fromIdx = next.tasks.findIndex(t => t.id === id);
    if (fromIdx === -1) return;
    const task = next.tasks.splice(fromIdx,1)[0];
    task.column = column;
    task.updatedAt = Date.now();

    // compute insert index by other tasks in that column
    const colTasks = next.tasks.filter(t => t.column === column);
    const targetBeforeId = colTasks[index]?.id;
    if (targetBeforeId){
      const beforeIdx = next.tasks.findIndex(t => t.id === targetBeforeId);
      next.tasks.splice(beforeIdx, 0, task);
    } else {
      next.tasks.push(task);
    }
    commit(next, {type:'task:move', id, column, index});
  }

  function on(fn){ listeners.add(fn); return () => listeners.delete(fn); }

  function undo(){
    if (!undoStack.length) return;
    redoStack.push(structuredClone(state));
    state = undoStack.pop();
    persist(state);
    notify();
  }
  function redo(){
    if (!redoStack.length) return;
    undoStack.push(structuredClone(state));
    state = redoStack.pop();
    persist(state);
    notify();
  }

  return {getState, set, patchTask, addTask, deleteTask, moveTask, on, undo, redo};
})();

// --- Persistence ------------------------------------------------
function persist(state){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function load(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  }catch{ return null; }
}
function seed(){
  // Initial demo data
  const id = () => crypto.randomUUID();
  const demo = {
    tasks: [
      {id:id(), title:'Design landing hero', description:'Create an eye-catching hero with CTA', assignee:'Ava', priority:'high', due: nowISO(), column:'backlog', createdAt:Date.now(), updatedAt:Date.now()},
      {id:id(), title:'API contract review', description:'Confirm /tasks endpoints', assignee:'Liam', priority:'normal', due: '', column:'todo', createdAt:Date.now(), updatedAt:Date.now()},
      {id:id(), title:'Implement drag & drop', description:'HTML5 DnD on cards', assignee:'Mia', priority:'high', due: nowISO(), column:'inprogress', createdAt:Date.now(), updatedAt:Date.now()},
      {id:id(), title:'Write unit tests', description:'Core store + utils', assignee:'Noah', priority:'low', due: '', column:'done', createdAt:Date.now(), updatedAt:Date.now()},
    ],
    filters: { q:'', priority:'', assignee:'' },
  };
  persist(demo);
  return demo;
}

// --- UI Rendering -----------------------------------------------
function render(){
  const {tasks, filters} = Store.getState();
  COLUMNS.forEach(col => {
    const zone = q(`.dropzone[data-col="${col}"]`);
    zone.innerHTML = ''; // clear
    const filtered = tasks
      .filter(t => t.column === col)
      .filter(applyFilters(filters));
    if(!filtered.length){
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.style.opacity = .5;
      empty.textContent = 'No tasks';
      zone.append(empty);
    } else {
      filtered.forEach(t => zone.append(renderCard(t)));
    }
  });
  renderAssigneeOptions();
}

function applyFilters({q, priority, assignee}){
  const ql = q.trim().toLowerCase();
  return t => {
    const hit = !ql || [t.title, t.description, t.assignee].some(v => (v||'').toLowerCase().includes(ql));
    const pri = !priority || t.priority === priority;
    const asg = !assignee || t.assignee === assignee;
    return hit && pri && asg;
  };
}

function renderCard(task){
  const el = document.createElement('article');
  el.className = 'card';
  el.draggable = true;
  el.dataset.id = task.id;
  el.setAttribute('role', 'listitem');
  el.innerHTML = `
    <div class="title">${escapeHtml(task.title)}</div>
    <div class="meta">
      <span class="badge priority-${task.priority}">${task.priority}</span>
      ${task.assignee ? `<span class="badge assignee">@${escapeHtml(task.assignee)}</span>`:''}
      ${task.due ? `<span class="badge">📅 ${task.due}</span>`:''}
    </div>
    <div class="actions">
      <button class="icon edit" title="Edit">✏️</button>
      <button class="icon del" title="Delete">🗑️</button>
    </div>
  `;
  el.addEventListener('dblclick', () => openEdit(task.id));
  el.querySelector('.edit').addEventListener('click', () => openEdit(task.id));
  el.querySelector('.del').addEventListener('click', () => Store.deleteTask(task.id));
  attachDragHandlers(el);
  return el;
}

function renderAssigneeOptions(){
  const {tasks, filters} = Store.getState();
  const names = Array.from(new Set(tasks.map(t => t.assignee).filter(Boolean))).sort();
  $assigneesDL.innerHTML = names.map(n => `<option value="${escapeHtml(n)}">`).join('');
  // filter dropdown
  $filterAssignee.innerHTML = `<option value="">All assignees</option>` + names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
  $filterAssignee.value = filters.assignee || '';
}

// --- Drag & Drop -------------------------------------------------
function attachDragHandlers(card){
  card.addEventListener('dragstart', ev => {
    ev.dataTransfer.setData('text/plain', card.dataset.id);
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
}

qa('.dropzone').forEach(zone => {
  zone.addEventListener('dragover', ev => {
    ev.preventDefault();
    const afterEl = getDragAfterElement(zone, ev.clientY);
    let hint = q('.drop-hint', zone);
    if(!hint){ hint = document.createElement('div'); hint.className='drop-hint'; zone.append(hint); }
    if(afterEl == null){
      zone.appendChild(hint);
    } else {
      zone.insertBefore(hint, afterEl);
    }
  });
  zone.addEventListener('dragleave', () => {
    const hint = q('.drop-hint', zone);
    if(hint) hint.remove();
  });
  zone.addEventListener('drop', ev => {
    ev.preventDefault();
    const id = ev.dataTransfer.getData('text/plain');
    const hint = q('.drop-hint', zone);
    const index = hint ? [...zone.children].indexOf(hint) : zone.children.length;
    Store.moveTask(id, zone.dataset.col, index);
    if(hint) hint.remove();
  });
});

function getDragAfterElement(container, y){
  const els = [...container.querySelectorAll('.card:not(.dragging)')];
  return els.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height/2;
    if (offset < 0 && offset > closest.offset){
      return {offset, element: child};
    } else {
      return closest;
    }
  }, {offset: Number.NEGATIVE_INFINITY}).element;
}

// --- Modal create/edit ------------------------------------------
q('#addTaskBtn').addEventListener('click', () => openCreate());
q('#deleteBtn').addEventListener('click', onDeleteFromDialog);

function openCreate(){
  $form.reset();
  q('#dialogTitle').textContent = 'New Task';
  q('select[name="column"]', $form).value = 'backlog';
  $id.value = '';
  q('#deleteBtn').hidden = true;
  $dialog.showModal();
  $title.focus();
}

function openEdit(id){
  const task = Store.getState().tasks.find(t => t.id === id);
  if(!task) return;
  q('#dialogTitle').textContent = 'Edit Task';
  $id.value = task.id;
  $title.value = task.title;
  q('textarea[name="description"]',$form).value = task.description || '';
  q('input[name="assignee"]',$form).value = task.assignee || '';
  q('select[name="priority"]',$form).value = task.priority || 'normal';
  q('input[name="due"]',$form).value = task.due || '';
  q('select[name="column"]',$form).value = task.column;
  q('#deleteBtn').hidden = false;
  $dialog.showModal();
  $title.focus();
}

$form.addEventListener('submit', ev => {
  ev.preventDefault();
  const data = Object.fromEntries(new FormData($form).entries());
  const payload = {
    title: (data.title||'').trim(),
    description: (data.description||'').trim(),
    assignee: (data.assignee||'').trim(),
    priority: data.priority || 'normal',
    due: data.due || '',
    column: data.column || 'backlog',
  };
  if(!payload.title) return;

  if(data.id){ // update
    Store.patchTask(data.id, payload);
  } else { // add
    Store.addTask({
      id: crypto.randomUUID(),
      ...payload,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  $dialog.close();
});

function onDeleteFromDialog(){
  const id = $id.value;
  if(id && confirm('Delete this task?')){
    Store.deleteTask(id);
    $dialog.close();
  }
}

// --- Filters & Search -------------------------------------------
const $search = q('#search');
const $filterPriority = q('#filterPriority');

$search.addEventListener('input', debounce(() => {
  const state = Store.getState();
  Store.set({filters: {...state.filters, q: $search.value}});
}, 120));

$filterPriority.addEventListener('change', () => {
  const state = Store.getState();
  Store.set({filters: {...state.filters, priority: $filterPriority.value}});
});
$filterAssignee.addEventListener('change', () => {
  const state = Store.getState();
  Store.set({filters: {...state.filters, assignee: $filterAssignee.value}});
});

// --- Undo/Redo & Keyboard shortcuts -----------------------------
q('#undoBtn').addEventListener('click', () => Store.undo());
q('#redoBtn').addEventListener('click', () => Store.redo());

document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== $search){
    e.preventDefault(); $search.focus();
  }
  if (e.key === 'Escape'){ $search.value=''; triggerInput($search); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z'){ e.preventDefault(); Store.undo(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y'){ e.preventDefault(); Store.redo(); }
  if (e.key.toLowerCase() === 'n' && !($dialog?.open)){ openCreate(); }
});

// --- Theme toggle -----------------------------------------------
const $themeToggle = q('#themeToggle');
(function initTheme(){
  const saved = localStorage.getItem(THEME_KEY) || 'dark';
  document.documentElement.classList.toggle('light', saved === 'light');
  $themeToggle.textContent = saved === 'light' ? '🌙' : '☀️';
})();
$themeToggle.addEventListener('click', () => {
  const isLight = document.documentElement.classList.toggle('light');
  localStorage.setItem(THEME_KEY, isLight ? 'light' : 'dark');
  $themeToggle.textContent = isLight ? '🌙' : '☀️';
});

// --- Utilities ---------------------------------------------------
function debounce(fn, ms){
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
function triggerInput(el){ el.dispatchEvent(new Event('input', {bubbles:true})); }
function escapeHtml(str){ return (str||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

// --- Boot --------------------------------------------------------
Store.on(render);
// initial population of filter inputs from state
(function hydrateControls(){
  const {filters} = Store.getState();
  $search.value = filters.q || '';
  $filterPriority.value = filters.priority || '';
  $filterAssignee.value = filters.assignee || '';
})();
render();
