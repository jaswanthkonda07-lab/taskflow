'use strict';
/* TaskFlow front-end: dependency-free SPA. All DOM is built with h() (textContent only) to avoid XSS. */
const $ = (s, r = document) => r.querySelector(s);
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}
const COLORS = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#8b5cf6', '#ef4444', '#0ea5e9', '#22c55e'];
const state = { user: null, projects: [], board: null, notifs: [], socket: null, openTask: null, view: 'board', activity: [], presence: [], calMonth: null, filters: { q: '', assignee: '', priority: '', label: '' } };
const root = $('#app');
const theme = {
  init() { document.documentElement.dataset.theme = localStorage.getItem('tf_theme') || 'dark'; },
  toggle() { const n = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = n; localStorage.setItem('tf_theme', n); }
};
theme.init();
const NS = 'http://www.w3.org/2000/svg';
function sv(tag, attrs, ...kids) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) e.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid != null) e.append(kid instanceof Node ? kid : String(kid));
  return e;
}
function countUp(node, to, suffix = '') {
  const t0 = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - t0) / 900);
    node.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))) + suffix;
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
const token = { get: () => localStorage.getItem('tf_token'), set: (t) => (t ? localStorage.setItem('tf_token', t) : localStorage.removeItem('tf_token')) };

async function api(method, url, body) {
  const res = await fetch('/api' + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token.get() ? { Authorization: 'Bearer ' + token.get() } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.user) logout();
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}
function toast(msg, type = 'info') {
  const t = h('div', { class: 'toast ' + type }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.classList.add('out'), 3500);
  setTimeout(() => t.remove(), 4000);
}
const initials = (n) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const avatar = (u, cls = '') => (u ? h('span', { class: 'avatar ' + cls, style: 'background:' + u.color, title: u.name }, initials(u.name)) : null);
const ago = (d) => {
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return new Date(d).toLocaleDateString();
};
const label = (text, el) => h('div', {}, h('label', { class: 'lbl' }, text), el);
const LOGO = '<svg viewBox="0 0 32 32"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#6366f1"/><stop offset="1" stop-color="#ec4899"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#lg)"/><path d="M9 16.5l4.5 4.5L23 11" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function logoSvg() { const t = document.createElement('template'); t.innerHTML = LOGO; return t.content.firstChild; }

function modal(title, body, { wide = false, onClose } = {}) {
  const close = () => {
    ov.classList.add('out');
    setTimeout(() => ov.remove(), 180);
    document.removeEventListener('keydown', esc);
    if (onClose) onClose();
  };
  const esc = (e) => e.key === 'Escape' && close();
  const ov = h('div', { class: 'overlay', onclick: (e) => e.target === ov && close() },
    h('div', { class: 'dialog' + (wide ? ' wide' : '') },
      h('div', { class: 'dialog-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', onclick: close, 'aria-label': 'Close' }, '✕')),
      body));
  document.addEventListener('keydown', esc);
  document.body.append(ov);
  return close;
}

/* ---------- Auth ---------- */
function renderAuth(initialMode = 'login', resetToken = null) {
  let mode = initialMode;
  const err = h('p', { class: 'error' });
  const note = h('p', { class: 'muted sm' });
  const name = h('input', { placeholder: 'Full name', autocomplete: 'name' });
  const email = h('input', { type: 'email', placeholder: 'Email address', autocomplete: 'email' });
  const pass = h('input', { type: 'password', placeholder: 'Password (min 8 characters)', autocomplete: 'current-password' });
  const pass2 = h('input', { type: 'password', placeholder: 'Confirm password', autocomplete: 'new-password' });
  const eye = h('button', {
    type: 'button', class: 'eye', 'aria-label': 'Show password', title: 'Show / hide password',
    onclick: () => { const show = pass.type === 'password'; pass.type = show ? 'text' : 'password'; pass2.type = pass.type; eye.textContent = show ? '🙈' : '👁'; }
  }, '👁');
  const nameField = h('div', {}, name);
  const passWrap = h('div', { class: 'pw' }, pass, eye);
  const forgot = h('a', { href: '#', class: 'link', onclick: (e) => { e.preventDefault(); setMode('forgot'); } }, 'Forgot password?');
  const back = h('a', { href: '#', class: 'link', onclick: (e) => { e.preventDefault(); resetToken = null; setMode('login'); } }, '← Back to sign in');
  const submit = h('button', { class: 'btn primary block', type: 'submit' }, 'Sign in');
  const tabLogin = h('button', { type: 'button', class: 'tab active', onclick: () => setMode('login') }, 'Sign in');
  const tabReg = h('button', { type: 'button', class: 'tab', onclick: () => setMode('register') }, 'Create account');
  const tabs = h('div', { class: 'tabs' }, tabLogin, tabReg);
  const orEl = h('div', { class: 'or' }, 'or');
  const demo = h('button', { type: 'button', class: 'btn ghost block', onclick: () => go('/auth/demo', {}) }, '✨ Try the live demo (no sign-up)');
  function setMode(m) {
    mode = m;
    const reg = m === 'register', log = m === 'login', fgt = m === 'forgot', rst = m === 'reset';
    nameField.hidden = !reg; email.hidden = rst; passWrap.hidden = fgt; pass2.hidden = !(reg || rst);
    forgot.hidden = !log; back.hidden = !(fgt || rst); tabs.hidden = fgt || rst; orEl.hidden = fgt || rst; demo.hidden = fgt || rst;
    note.textContent = fgt ? 'Enter your account email and we will send you a link to reset your password.' : rst ? 'Choose a new password for your account.' : '';
    submit.textContent = { login: 'Sign in', register: 'Create account', forgot: 'Send reset link', reset: 'Set new password' }[m];
    pass.placeholder = rst ? 'New password (min 8 characters)' : 'Password (min 8 characters)';
    pass.autocomplete = log ? 'current-password' : 'new-password';
    tabLogin.classList.toggle('active', log); tabReg.classList.toggle('active', reg);
    err.textContent = '';
  }
  async function go(path, payload) {
    submit.disabled = true;
    err.textContent = '';
    try {
      const d = await api('POST', path, payload);
      token.set(d.token);
      state.user = d.user;
      await start();
    } catch (e) { err.textContent = e.message; }
    submit.disabled = false;
  }
  async function onSubmit(e) {
    e.preventDefault();
    err.textContent = '';
    if ((mode === 'register' || mode === 'reset') && pass.value !== pass2.value) { err.textContent = 'Passwords do not match'; return; }
    if (mode === 'forgot' || mode === 'reset') {
      submit.disabled = true;
      try {
        if (mode === 'forgot') {
          await api('POST', '/auth/forgot', { email: email.value });
          note.textContent = 'If an account exists for that email, a reset link is on its way. Check your inbox and spam folder.';
        } else {
          await api('POST', '/auth/reset', { token: resetToken, password: pass.value });
          resetToken = null; pass.value = ''; pass2.value = '';
          setMode('login');
          toast('Password updated. Please sign in.', 'success');
        }
      } catch (x) { err.textContent = x.message; }
      submit.disabled = false;
      return;
    }
    go(mode === 'login' ? '/auth/login' : '/auth/register', { name: name.value, email: email.value, password: pass.value });
  }
  const form = h('form', { class: 'auth-card', onsubmit: onSubmit },
    tabs, nameField, note, email, passWrap, pass2, forgot, back, err, submit, orEl, demo);
  setMode(mode);
  root.replaceChildren(h('div', { class: 'auth-wrap' },
    h('section', { class: 'hero' },
      h('div', { class: 'logo big' }, logoSvg(), 'TaskFlow'),
      h('h1', {}, 'Ship projects together, ', h('span', { class: 'grad' }, 'in real time.')),
      h('p', { class: 'lead' }, 'Plan work on Kanban boards, assign tasks to teammates, and discuss everything right inside each card.'),
      h('ul', { class: 'features' }, ['Drag & drop Kanban boards', 'Assign tasks, set priorities and due dates', 'Comment threads inside every task', 'Instant updates and notifications over WebSockets'].map((f) => h('li', {}, f))),
      h('div', { class: 'hero-art mock' }, ['To do', 'In progress', 'Done'].map((c, i) => h('div', { class: 'mcol', style: '--i:' + i }, h('small', {}, c), h('div', { class: 'mcard' }, h('span', { class: 'prio high' }), h('i'), h('i')), h('div', { class: 'mcard m2' }, h('i'), h('i')))))),
    form));
}

/* ---------- Session / sockets ---------- */
async function start() {
  connectSocket();
  state.notifs = await api('GET', '/notifications').catch(() => []);
  route();
}
function logout() {
  token.set(null);
  if (state.socket) state.socket.disconnect();
  state.user = null; state.board = null; state.notifs = [];
  location.hash = '';
  renderAuth();
}
const inBoard = (id) => state.board && state.board.project._id === String(id);
function upsertTask(t) {
  if (!inBoard(t.project)) return;
  const i = state.board.tasks.findIndex((x) => x._id === t._id);
  if (i > -1) state.board.tasks[i] = t; else state.board.tasks.push(t);
  refreshColumns();
}
function connectSocket() {
  if (state.socket) state.socket.disconnect();
  const s = io({ auth: { token: token.get() } });
  state.socket = s;
  s.on('connect', () => { if (state.board) s.emit('project:join', state.board.project._id); });
  s.on('notification', (n) => { state.notifs.unshift(n); updateBell(); toast(n.message); });
  s.on('projects:changed', async () => { if (!state.board) { state.projects = await api('GET', '/projects'); paintDashboard(); } });
  s.on('task:created', upsertTask);
  s.on('task:updated', upsertTask);
  s.on('task:deleted', ({ id, project }) => { if (inBoard(project)) { state.board.tasks = state.board.tasks.filter((x) => x._id !== id); refreshColumns(); } });
  s.on('presence', ({ project, users }) => { if (inBoard(project)) { state.presence = users; updatePresence(); } });
  s.on('activity:new', (a) => { if (inBoard(a.project)) { state.activity.unshift(a); if (state.view === 'activity') refreshColumns(); } });
  s.on('comment:created', (c) => { if (state.openTask === c.task) appendComment(c); });
  s.on('project:updated', (p) => { if (inBoard(p._id)) { state.board.project = p; paintBoard(); } });
}

/* ---------- Layout ---------- */
function mount(...nodes) { root.replaceChildren(topbar(), ...nodes); updateBell(); }
function topbar() {
  return h('header', { class: 'topbar' },
    h('a', { href: '#/', class: 'logo' }, logoSvg(), 'TaskFlow'),
    h('div', { class: 'top-right' }, h('button', { class: 'btn ghost sm kbd', onclick: openPalette, title: 'Command palette (Ctrl+K)' }, '⌘K'), h('button', { class: 'icon-btn', title: 'Toggle light / dark theme', 'aria-label': 'Toggle theme', onclick: () => theme.toggle() }, '🌓'), bell(),
      h('div', { class: 'me' }, avatar(state.user), h('span', {}, state.user.name)),
      h('button', { class: 'btn ghost sm', onclick: logout }, 'Sign out')));
}
function bell() {
  return h('div', { class: 'bell-wrap' },
    h('button', { class: 'icon-btn', 'aria-label': 'Notifications', onclick: (e) => { e.stopPropagation(); const p = $('#notifPanel'); p.hidden = !p.hidden; if (!p.hidden) renderNotifs(); } },
      '🔔', h('span', { class: 'badge', id: 'badge' })),
    h('div', { class: 'dropdown', id: 'notifPanel', hidden: true }));
}
document.addEventListener('click', (e) => { const p = $('#notifPanel'); if (p && !p.contains(e.target)) p.hidden = true; });
function updateBell() {
  const b = $('#badge');
  if (!b) return;
  const n = state.notifs.filter((x) => !x.read).length;
  b.textContent = n ? String(n) : '';
  const p = $('#notifPanel');
  if (p && !p.hidden) renderNotifs();
}
function renderNotifs() {
  const p = $('#notifPanel');
  p.replaceChildren(
    h('header', {}, 'Notifications', h('button', { class: 'btn ghost sm', onclick: async () => { await api('POST', '/notifications/read-all', {}); state.notifs.forEach((n) => (n.read = true)); updateBell(); } }, 'Mark all read')),
    state.notifs.length
      ? state.notifs.map((n) => h('div', { class: 'notif' + (n.read ? '' : ' unread'), onclick: () => { if (n.project) location.hash = '#/p/' + n.project; p.hidden = true; } }, n.message, h('small', {}, ago(n.createdAt))))
      : h('div', { class: 'pad' }, 'You are all caught up 🎉'));
}

/* ---------- Routing ---------- */
window.addEventListener('hashchange', route);
async function route() {
  if (!state.user) return;
  if (state.board) state.socket.emit('project:leave', state.board.project._id);
  state.board = null;
  const m = location.hash.match(/^#\/p\/([a-f0-9]{24})/);
  if (m) await openBoard(m[1]); else await openDashboard();
}
async function openDashboard() { state.projects = await api('GET', '/projects'); paintDashboard(); }

/* ---------- Dashboard ---------- */
const stat = (label, value, suffix = '', icon = '') => {
  const b = h('b', {}, '0');
  countUp(b, value, suffix);
  return h('div', { class: 'stat' }, h('div', { class: 'stat-ico' }, icon), h('div', {}, b, h('span', {}, label)));
};
function paintDashboard() {
  const ps = state.projects;
  const total = ps.reduce((a, p) => a + p.taskCount, 0);
  const done = ps.reduce((a, p) => a + p.doneCount, 0);
  const mine = h('aside', { class: 'panel my-tasks' }, h('h3', {}, '🎯 My open tasks'), h('div', { class: 'pad' }, 'Loading…'));
  mount(h('main', { class: 'container' },
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Welcome back, ' + state.user.name.split(' ')[0] + ' 👋'), h('p', { class: 'muted' }, 'Here is what is happening across your projects.')),
      h('button', { class: 'btn primary', onclick: newProjectModal }, '+ New project')),
    h('div', { class: 'stats' },
      stat('Projects', ps.length, '', '📁'), stat('Total tasks', total, '', '🧩'),
      stat('Completed', total ? Math.round((done / total) * 100) : 0, '%', '✅'), stat('Still open', total - done, '', '⏳')),
    h('div', { class: 'dash-grid' },
      h('section', {}, h('h2', { class: 'section-title' }, 'Your projects'),
        ps.length
          ? h('div', { class: 'grid' }, ps.map(pcard))
          : h('div', { class: 'empty' }, h('div', { class: 'empty-art' }, '📋'), h('h3', {}, 'No projects yet'), h('p', { class: 'muted' }, 'Create your first project to start collaborating.'))),
      mine)));
  loadMine(mine);
}
async function loadMine(box) {
  const head = h('h3', {}, '🎯 My open tasks');
  try {
    const tasks = await api('GET', '/tasks/mine');
    box.replaceChildren(head, tasks.length
      ? h('div', { class: 'mine-list' }, tasks.slice(0, 8).map((t) => h('a', { class: 'mine', href: '#/p/' + t.project },
        h('span', { class: 'dot', style: 'background:' + t.projectColor }),
        h('div', {}, h('b', {}, t.title), h('small', {}, t.projectName + ' · ' + t.column + (t.dueDate ? ' · due ' + new Date(t.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''))),
        h('span', { class: 'prio ' + t.priority }, t.priority))))
      : h('div', { class: 'pad' }, 'Nothing assigned to you right now ☕'));
  } catch { box.replaceChildren(head, h('div', { class: 'pad' }, 'Could not load your tasks')); }
}
function pcard(p, i) {
  const pct = p.taskCount ? Math.round((p.doneCount / p.taskCount) * 100) : 0;
  return h('a', { class: 'pcard', href: '#/p/' + p._id, style: `--i:${i};--c:${p.color}` },
    h('h3', {}, p.name), h('p', {}, p.description || 'No description'),
    h('div', { class: 'progress' }, h('i', { style: `width:${pct}%` })),
    h('div', { class: 'pfoot' }, h('span', {}, `${p.doneCount}/${p.taskCount} done`), h('span', { class: 'members' }, p.members.map((m) => avatar(m, 'sm')))));
}
function newProjectModal() {
  const name = h('input', { placeholder: 'e.g. Mobile app launch', maxlength: 80, required: true });
  const desc = h('textarea', { placeholder: 'What is this project about?', maxlength: 300, rows: 3 });
  let color = COLORS[0];
  const sw = h('div', { class: 'swatches' }, COLORS.map((c, i) => h('button', {
    type: 'button', class: 'sw' + (i === 0 ? ' sel' : ''), style: 'background:' + c,
    onclick: (e) => { color = c; [...sw.children].forEach((b) => b.classList.toggle('sel', b === e.currentTarget)); }
  })));
  const form = h('form', {
    class: 'form',
    onsubmit: async (e) => {
      e.preventDefault();
      try { const p = await api('POST', '/projects', { name: name.value, description: desc.value, color }); close(); location.hash = '#/p/' + p._id; }
      catch (err) { toast(err.message, 'error'); }
    }
  }, label('Name', name), label('Description', desc), label('Colour', sw), h('button', { class: 'btn primary block' }, 'Create project'));
  const close = modal('New project', form);
  name.focus();
}

/* ---------- Board ---------- */
async function openBoard(id) {
  try {
    state.board = await api('GET', '/projects/' + id);
    state.view = 'board';
    state.filters = { q: '', assignee: '', priority: '', label: '' };
    state.activity = await api('GET', `/projects/${id}/activity`).catch(() => []);
    state.presence = [];
    state.socket.emit('project:join', id);
    paintBoard();
  } catch (e) { toast(e.message, 'error'); location.hash = '#/'; }
}
function paintBoard() {
  const { project } = state.board;
  const owner = project.owner === state.user._id;
  mount(h('main', { class: 'container wide' },
    h('div', { class: 'board-head' },
      h('div', {}, h('a', { href: '#/', class: 'back' }, '← All projects'),
        h('h1', {}, h('span', { class: 'dot', style: 'background:' + project.color }), project.name),
        project.description && h('p', { class: 'muted' }, project.description)),
      h('div', { class: 'members' }, project.members.map(memberAvatar), h('span', { class: 'online-count', id: 'online-count' }, onlineText()),
        h('button', { class: 'btn ghost sm', onclick: inviteModal }, '+ Invite'),
        h('button', { class: 'btn ghost sm', onclick: exportCsv, title: 'Download all tasks as a spreadsheet' }, '⬇ CSV'),
        owner && h('button', { class: 'btn danger sm', onclick: deleteProject }, 'Delete'))),
    boardToolbar(),
    h('div', { id: 'board-area' }, viewBody())));
}
function columnsView() {
  return h('div', { class: 'columns', id: 'columns' }, state.board.project.columns.map(columnView));
}
function refreshColumns() { const a = $('#board-area'); if (a) a.replaceChildren(viewBody()); }
function columnView(col, idx) {
  const tasks = state.board.tasks.filter((t) => t.column === col && matches(t)).sort((a, b) => a.position - b.position);
  const list = h('div', { class: 'cards' }, tasks.map(cardView));
  const el = h('section', {
    class: 'column', style: '--i:' + idx,
    ondragover: (e) => { e.preventDefault(); el.classList.add('over'); },
    ondragleave: (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('over'); },
    ondrop: (e) => onDrop(e, col, list, el)
  }, h('div', { class: 'col-head' }, h('span', {}, col), h('span', { class: 'count' }, tasks.length)), list, addTask(col));
  return el;
}
const overdue = (t) => t.dueDate && new Date(t.dueDate) < new Date() && t.column !== state.board.project.columns.at(-1);
function cardView(t) {
  const cl = t.checklist || [];
  const doneN = cl.filter((i) => i.done).length;
  return h('article', {
    class: 'card', draggable: 'true',
    ondragstart: (e) => { e.dataTransfer.setData('text/plain', t._id); e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('dragging'); },
    ondragend: (e) => e.currentTarget.classList.remove('dragging'),
    onclick: () => openTask(t._id)
  },
  h('div', { class: 'card-top' }, h('span', { class: 'prio ' + t.priority }, t.priority),
    h('span', { class: 'meta-r' },
      cl.length > 0 && h('span', { class: 'chk' + (doneN === cl.length ? ' all' : '') }, `☑ ${doneN}/${cl.length}`),
      t.dueDate && h('span', { class: 'due' + (overdue(t) ? ' late' : '') }, '📅 ' + new Date(t.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })))),
  h('h4', {}, t.title),
  (t.labels || []).length > 0 && h('div', { class: 'task-labels' }, t.labels.map((x) => h('span', { class: 'task-label' }, '#' + x))),
  cl.length > 0 && h('div', { class: 'mini-bar' }, h('i', { style: `width:${Math.round((doneN / cl.length) * 100)}%` })),
  t.description && h('p', { class: 'snippet' }, t.description.slice(0, 90)),
  h('div', { class: 'card-foot' }, h('span', { class: 'muted sm' }, t.assignee ? t.assignee.name : 'Unassigned'), avatar(t.assignee, 'sm')));
}
async function onDrop(e, col, list, el) {
  e.preventDefault();
  el.classList.remove('over');
  const id = e.dataTransfer.getData('text/plain');
  const task = state.board.tasks.find((t) => t._id === id);
  if (!task) return;
  const cards = [...list.querySelectorAll('.card:not(.dragging)')];
  const idx = cards.findIndex((c) => e.clientY < c.getBoundingClientRect().top + c.offsetHeight / 2);
  const sibs = state.board.tasks.filter((t) => t.column === col && t._id !== id && matches(t)).sort((a, b) => a.position - b.position);
  const at = idx === -1 ? sibs.length : idx;
  const prev = sibs[at - 1], next = sibs[at];
  const position = prev && next ? (prev.position + next.position) / 2 : prev ? prev.position + 1000 : next ? next.position - 1000 : 1000;
  Object.assign(task, { column: col, position });
  refreshColumns();
  try { await api('PATCH', '/tasks/' + id, { column: col, position }); }
  catch (err) { toast(err.message, 'error'); openBoard(state.board.project._id); }
}
function addTask(col) {
  const wrap = h('div', { class: 'add' });
  const btn = h('button', { class: 'add-btn', onclick: open }, '+ Add task');
  wrap.append(btn);
  function open() {
    const input = h('input', { placeholder: 'e.g. Fix login bug tomorrow !high @ava', maxlength: 140 });
    const chips = h('div', { class: 'qa-chips' });
    input.addEventListener('input', () => {
      const q = parseQuick(input.value, state.board.project.members);
      chips.replaceChildren(...[
        q.priority && h('span', { class: 'chip' }, '⚑ ' + q.priority),
        q.assignee && h('span', { class: 'chip' }, '👤 ' + q.assignee.name.split(' ')[0]),
        q.due && h('span', { class: 'chip' }, '📅 ' + new Date(q.due + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))
      ].filter(Boolean));
    });
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        const q = parseQuick(text, state.board.project.members);
        input.disabled = true;
        try {
          upsertTask(await api('POST', '/tasks', { projectId: state.board.project._id, title: q.title, column: col, priority: q.priority || undefined, assignee: q.assignee ? q.assignee._id : undefined, dueDate: q.due || undefined }));
        } catch (err) { toast(err.message, 'error'); input.disabled = false; }
      }
    }, input, chips);
    input.addEventListener('keydown', (e) => e.key === 'Escape' && wrap.replaceChildren(btn));
    input.addEventListener('blur', () => setTimeout(() => { if (!input.value.trim()) wrap.replaceChildren(btn); }, 150));
    wrap.replaceChildren(form);
    input.focus();
  }
  return wrap;
}
function inviteModal() {
  const email = h('input', { type: 'email', placeholder: 'teammate@email.com', required: true });
  const form = h('form', {
    class: 'form',
    onsubmit: async (e) => {
      e.preventDefault();
      try { await api('POST', `/projects/${state.board.project._id}/members`, { email: email.value }); toast('Teammate added', 'success'); close(); }
      catch (err) { toast(err.message, 'error'); }
    }
  }, h('p', { class: 'muted sm' }, 'They must already have a TaskFlow account.'), label('Email', email), h('button', { class: 'btn primary block' }, 'Add to project'));
  const close = modal('Invite teammate', form);
  email.focus();
}
async function deleteProject() {
  if (!confirm('Delete this project and all its tasks? This cannot be undone.')) return;
  try { await api('DELETE', '/projects/' + state.board.project._id); toast('Project deleted', 'success'); location.hash = '#/'; }
  catch (e) { toast(e.message, 'error'); }
}

/* ---------- Task modal + comments ---------- */
function appendComment(c) {
  const list = $('#comments');
  if (!list || list.querySelector(`[data-id="${c._id}"]`)) return;
  list.append(h('div', { class: 'comment', 'data-id': c._id }, avatar(c.author, 'sm'),
    h('div', {}, h('div', { class: 'meta' }, h('strong', {}, c.author.name), ' · ', ago(c.createdAt)), h('p', {}, c.text))));
  list.scrollTop = list.scrollHeight;
}
async function openTask(id) {
  const t = state.board.tasks.find((x) => x._id === id);
  if (!t) return;
  const { project } = state.board;
  state.openTask = id;
  const title = h('input', { value: t.title, maxlength: 140 });
  const desc = h('textarea', { rows: 4, placeholder: 'Add a description…' }, t.description || '');
  const assignee = h('select', {}, h('option', { value: '' }, 'Unassigned'),
    project.members.map((m) => h('option', { value: m._id, selected: !!t.assignee && t.assignee._id === m._id }, m.name)));
  const priority = h('select', {}, ['low', 'medium', 'high'].map((p) => h('option', { value: p, selected: t.priority === p }, p[0].toUpperCase() + p.slice(1))));
  const column = h('select', {}, project.columns.map((c) => h('option', { value: c, selected: t.column === c }, c)));
  const due = h('input', { type: 'date', value: t.dueDate ? t.dueDate.slice(0, 10) : '' });
  const labels = h('input', { value: (t.labels || []).join(', '), placeholder: 'e.g. frontend, urgent, v1', maxlength: 220 });
  const items = (t.checklist || []).map((i) => ({ text: i.text, done: i.done }));
  const checkList = h('div', { class: 'check-list' });
  const renderItems = () => checkList.replaceChildren(...items.map((it, i) => h('div', { class: 'check-item' + (it.done ? ' done' : '') },
    h('input', { type: 'checkbox', checked: it.done, onchange: (e) => { it.done = e.target.checked; renderItems(); } }),
    h('span', {}, it.text),
    h('button', { type: 'button', class: 'x', 'aria-label': 'Remove', onclick: () => { items.splice(i, 1); renderItems(); } }, '✕'))));
  const newItem = h('input', {
    placeholder: 'Add a checklist item and press Enter', maxlength: 140,
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); const v = e.target.value.trim(); if (v) { items.push({ text: v, done: false }); e.target.value = ''; renderItems(); } } }
  });
  renderItems();
  const save = async () => {
    try {
      upsertTask(await api('PATCH', '/tasks/' + id, { title: title.value, description: desc.value, assignee: assignee.value || null, priority: priority.value, column: column.value, dueDate: due.value || null, labels: labels.value.split(',').map((x) => x.trim()).filter(Boolean), checklist: items }));
      toast('Task saved', 'success'); close();
    } catch (e) { toast(e.message, 'error'); }
  };
  const del = async () => {
    if (!confirm('Delete this task?')) return;
    try { await api('DELETE', '/tasks/' + id); close(); } catch (e) { toast(e.message, 'error'); }
  };
  const input = h('input', { placeholder: 'Write a comment…', maxlength: 1000 });
  const cform = h('form', {
    class: 'comment-form',
    onsubmit: async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      try { appendComment(await api('POST', `/tasks/${id}/comments`, { text })); } catch (err) { toast(err.message, 'error'); }
    }
  }, input, h('button', { class: 'btn primary sm' }, 'Send'));
  const body = h('div', { class: 'task-modal' },
    h('div', { class: 'form' }, label('Title', title), label('Description', desc), label('Labels', labels), label('Checklist', h('div', {}, checkList, newItem)),
      h('div', { class: 'row' }, label('Assignee', assignee), label('Priority', priority)),
      h('div', { class: 'row' }, label('Status', column), label('Due date', due)),
      h('div', { class: 'row end' }, h('button', { class: 'btn danger sm', onclick: del }, 'Delete'), h('button', { class: 'btn primary', onclick: save }, 'Save changes'))),
    h('div', { class: 'thread' }, h('h3', {}, 'Discussion'), h('div', { class: 'comments', id: 'comments' }), cform));
  const close = modal('Task details', body, { wide: true, onClose: () => { state.openTask = null; } });
  try { (await api('GET', `/tasks/${id}/comments`)).forEach(appendComment); } catch { /* ignore */ }
}

/* ---------- Filters, toolbar and insights ---------- */
const matches = (t) => {
  const f = state.filters;
  if (f.q && !(t.title + ' ' + (t.description || '')).toLowerCase().includes(f.q.toLowerCase())) return false;
  if (f.priority && t.priority !== f.priority) return false;
  if (f.assignee === 'none') return !t.assignee;
  if (f.assignee && (!t.assignee || t.assignee._id !== f.assignee)) return false;
  if (f.label && !(t.labels || []).includes(f.label)) return false;
  return true;
};
function boardToolbar() {
  const { project } = state.board;
  const q = h('input', { id: 'search', placeholder: '🔍 Search tasks…  (press / )', value: state.filters.q, oninput: (e) => { state.filters.q = e.target.value; refreshColumns(); } });
  const as = h('select', { onchange: (e) => { state.filters.assignee = e.target.value; refreshColumns(); } },
    h('option', { value: '' }, 'All assignees'), h('option', { value: 'none', selected: state.filters.assignee === 'none' }, 'Unassigned'),
    project.members.map((m) => h('option', { value: m._id, selected: state.filters.assignee === m._id }, m.name)));
  const pr = h('select', { onchange: (e) => { state.filters.priority = e.target.value; refreshColumns(); } },
    h('option', { value: '' }, 'Any priority'), ['high', 'medium', 'low'].map((p) => h('option', { value: p, selected: state.filters.priority === p }, p[0].toUpperCase() + p.slice(1))));
  const labels = [...new Set(state.board.tasks.flatMap((t) => t.labels || []))].sort();
  const lb = h('select', { onchange: (e) => { state.filters.label = e.target.value; refreshColumns(); } },
    h('option', { value: '' }, 'Any label'), labels.map((x) => h('option', { value: x, selected: state.filters.label === x }, '#' + x)));
  const seg = h('div', { class: 'seg-ctl' }, [['board', '▦ Board'], ['calendar', '📅 Calendar'], ['analytics', '📊 Insights'], ['activity', '🕒 Activity']].map(([v, txt]) => h('button', {
    class: 'seg-btn' + (state.view === v ? ' active' : ''),
    onclick: (e) => { state.view = v; [...e.currentTarget.parentNode.children].forEach((b) => b.classList.toggle('active', b === e.currentTarget)); refreshColumns(); }
  }, txt)));
  return h('div', { class: 'toolbar' }, q, as, pr, lb, seg);
}
const panelBox = (title, body) => h('section', { class: 'panel' }, h('h3', {}, title), body);
const kpi = (l, v) => h('div', { class: 'kpi' }, h('b', {}, String(v)), h('span', {}, l));
function donut(data, total) {
  if (!total) return h('div', { class: 'pad' }, 'No tasks yet');
  const R = 70, C = 2 * Math.PI * R;
  let off = 0;
  const segs = data.filter((d) => d.n > 0).map((d) => {
    const len = (d.n / total) * C;
    const c = sv('circle', { cx: 90, cy: 90, r: R, fill: 'none', stroke: d.color, 'stroke-width': 22, 'stroke-dasharray': `${len} ${C - len}`, 'stroke-dashoffset': -off, transform: 'rotate(-90 90 90)', class: 'seg' });
    off += len;
    return c;
  });
  const svg = sv('svg', { viewBox: '0 0 180 180', class: 'donut', role: 'img', 'aria-label': 'Tasks by status' },
    sv('circle', { cx: 90, cy: 90, r: R, fill: 'none', stroke: 'rgba(128,128,128,.18)', 'stroke-width': 22 }), segs,
    sv('text', { x: 90, y: 90, 'text-anchor': 'middle', class: 'dn' }, String(total)), sv('text', { x: 90, y: 110, 'text-anchor': 'middle', class: 'dl' }, 'tasks'));
  return h('div', {}, svg, h('ul', { class: 'legend' }, data.map((d) => h('li', {}, h('i', { style: 'background:' + d.color }), d.label, h('b', {}, String(d.n))))));
}
function bars(data) {
  const max = Math.max(1, ...data.map((d) => d.n));
  return h('div', { class: 'bars' }, data.map((d) => h('div', { class: 'bar-row' },
    h('span', { class: 'bl', title: d.label }, d.label), h('div', { class: 'bar' }, h('i', { style: `width:${(d.n / max) * 100}%;background:${d.color}` })), h('b', {}, String(d.n)))));
}
function analyticsView() {
  const { project, tasks } = state.board;
  const cols = project.columns, last = cols[cols.length - 1];
  const palette = ['#64748b', '#6366f1', '#f59e0b', '#22c55e', '#ec4899', '#14b8a6'];
  const total = tasks.length, doneN = tasks.filter((t) => t.column === last).length;
  const byCol = cols.map((c, i) => ({ label: c, n: tasks.filter((t) => t.column === c).length, color: palette[i % palette.length] }));
  const byPrio = [['high', '#ef4444'], ['medium', '#f59e0b'], ['low', '#22c55e']].map(([p, color]) => ({ label: p, n: tasks.filter((t) => t.priority === p).length, color }));
  const work = project.members.map((m) => ({ label: m.name, n: tasks.filter((t) => t.assignee && t.assignee._id === m._id && t.column !== last).length, color: m.color }));
  work.push({ label: 'Unassigned', n: tasks.filter((t) => !t.assignee && t.column !== last).length, color: '#64748b' });
  return h('div', { class: 'insights' },
    h('div', { class: 'kpis' }, kpi('Total tasks', total), kpi('Completed', doneN), kpi('Overdue', tasks.filter(overdue).length), kpi('Completion', (total ? Math.round((doneN / total) * 100) : 0) + '%')),
    h('div', { class: 'chart-grid' }, panelBox('Tasks by status', donut(byCol, total)), panelBox('Priority mix', bars(byPrio)), panelBox('Open workload by person', bars(work))));
}
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { const el = $('#search'); if (el) { e.preventDefault(); el.focus(); } }
});

/* ---------- v1.3: smart quick-add, calendar, activity, presence, palette, CSV ---------- */
/* PARSER-START */
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// "Fix login bug tomorrow !high @ava" -> title + due date + priority + assignee
function parseQuick(text, members) {
  let title = text, priority = null, assignee = null, due = null;
  const pm = title.match(/(^|\s)!(high|medium|med|low)\b/i);
  if (pm) { const w = pm[2].toLowerCase(); priority = w.startsWith('m') ? 'medium' : w; title = title.replace(pm[0], ' '); }
  const am = title.match(/(^|\s)@([\w.-]+)/);
  if (am) {
    const q = am[2].toLowerCase();
    const mem = members.find((x) => x.name.toLowerCase().split(/\s+/)[0] === q) || members.find((x) => x.name.toLowerCase().startsWith(q));
    if (mem) { assignee = mem; title = title.replace(am[0], ' '); }
  }
  const FULL = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dm = title.match(/(^|\s)(today|tomorrow|tmrw|in\s+(\d{1,2})\s*(?:d|days?)|(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat))\b/i);
  if (dm) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const w = dm[2].toLowerCase();
    let add = null;
    if (w === 'today') add = 0;
    else if (w === 'tomorrow' || w === 'tmrw') add = 1;
    else if (dm[3]) add = Number(dm[3]);
    else if (dm[4]) { const idx = FULL.findIndex((f) => f.startsWith(dm[4].toLowerCase().slice(0, 3))); add = ((idx - now.getDay() + 7) % 7) || 7; }
    if (add !== null) { const d = new Date(now); d.setDate(d.getDate() + add); due = ymd(d); title = title.replace(dm[0], ' '); }
  }
  title = title.replace(/\s+/g, ' ').trim() || text.trim();
  return { title, priority, assignee, due };
}
/* PARSER-END */

function viewBody() {
  switch (state.view) {
    case 'analytics': return analyticsView();
    case 'calendar': return calendarView();
    case 'activity': return activityView();
    default: return columnsView();
  }
}
function memberAvatar(m) {
  const a = avatar(m);
  a.dataset.uid = m._id;
  a.classList.toggle('online', state.presence.includes(m._id));
  return a;
}
const onlineText = () => (state.presence.length ? `● ${state.presence.length} online` : '');
function updatePresence() {
  document.querySelectorAll('.avatar[data-uid]').forEach((a) => a.classList.toggle('online', state.presence.includes(a.dataset.uid)));
  const c = $('#online-count');
  if (c) c.textContent = onlineText();
}
function activityView() {
  const list = state.activity || [];
  return h('div', { class: 'activity' }, list.length
    ? list.map((a) => h('div', { class: 'act' }, avatar(a.actor, 'sm'),
      h('div', {}, h('span', {}, h('b', {}, a.actor ? a.actor.name : 'Someone'), ' ' + a.text), h('small', {}, ago(a.createdAt)))))
    : h('div', { class: 'empty' }, h('h3', {}, 'No activity yet'), h('p', { class: 'muted' }, 'Everything that happens on this board shows up here, live.')));
}
function calendarView() {
  const base = state.calMonth || new Date();
  const y = base.getFullYear(), m = base.getMonth();
  const first = new Date(y, m, 1);
  const start = new Date(y, m, 1 - first.getDay());
  const byDay = {};
  state.board.tasks.filter((t) => t.dueDate && matches(t)).forEach((t) => { const k = t.dueDate.slice(0, 10); (byDay[k] = byDay[k] || []).push(t); });
  const todayKey = ymd(new Date());
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const k = ymd(d), items = byDay[k] || [];
    cells.push(h('div', { class: 'cal-cell' + (d.getMonth() !== m ? ' dim' : '') + (k === todayKey ? ' today' : '') },
      h('span', { class: 'cal-num' }, d.getDate()),
      items.slice(0, 3).map((t) => h('button', { class: 'cal-task ' + t.priority, title: t.title, onclick: () => openTask(t._id) }, t.title)),
      items.length > 3 && h('small', { class: 'muted' }, `+${items.length - 3} more`)));
  }
  const go = (date) => { state.calMonth = date; refreshColumns(); };
  return h('div', { class: 'calendar' },
    h('div', { class: 'cal-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => go(new Date(y, m - 1, 1)) }, '‹'),
      h('h3', {}, first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })),
      h('button', { class: 'icon-btn', 'aria-label': 'Next month', onclick: () => go(new Date(y, m + 1, 1)) }, '›'),
      h('button', { class: 'btn ghost sm', onclick: () => go(new Date()) }, 'Today')),
    h('div', { class: 'cal-dow' }, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => h('span', {}, d))),
    h('div', { class: 'cal-grid' }, cells));
}
function exportCsv() {
  const { project, tasks } = state.board;
  const safe = (v) => { const t = String(v == null ? '' : v); return /^[=+\-@]/.test(t) ? "'" + t : t; }; // blocks spreadsheet formula injection
  const cell = (v) => '"' + safe(v).replace(/"/g, '""') + '"';
  const rows = [['Title', 'Status', 'Priority', 'Labels', 'Assignee', 'Due date', 'Checklist', 'Description'],
    ...tasks.map((t) => [t.title, t.column, t.priority, (t.labels || []).join(', '), t.assignee ? t.assignee.name : '', t.dueDate ? t.dueDate.slice(0, 10) : '',
      (t.checklist || []).filter((i) => i.done).length + '/' + (t.checklist || []).length, t.description || ''])];
  const csv = rows.map((r) => r.map(cell).join(',')).join('\n');
  const a = h('a', { href: URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' })), download: project.name.replace(/[^\w-]+/g, '_') + '.csv' });
  document.body.append(a); a.click(); a.remove();
  toast(`Exported ${tasks.length} tasks`, 'success');
}
function shortcutsModal() {
  const row = (k, d) => h('div', {}, h('span', {}, d), h('kbd', {}, k));
  modal('Keyboard shortcuts', h('div', { class: 'shortcuts' }, row('Ctrl + K', 'Command palette'), row('/', 'Search tasks'), row('N', 'Add a task'), row('?', 'Show this help'), row('Esc', 'Close dialogs')));
}
function openPalette() {
  if (!state.user || $('#palette')) return;
  const items = [];
  state.projects.forEach((p) => items.push({ label: '📁 ' + p.name, hint: 'Project', run: () => { location.hash = '#/p/' + p._id; } }));
  if (state.board) {
    state.board.tasks.forEach((t) => items.push({ label: '🧩 ' + t.title, hint: t.column, run: () => openTask(t._id) }));
    ['board', 'calendar', 'analytics', 'activity'].forEach((v) => items.push({ label: '👁 View: ' + v, hint: 'Switch view', run: () => { state.view = v; paintBoard(); } }));
    items.push({ label: '⬇ Export tasks to CSV', hint: 'Action', run: exportCsv });
  }
  items.push({ label: '➕ New project', hint: 'Action', run: newProjectModal }, { label: '🌓 Toggle theme', hint: 'Action', run: () => theme.toggle() }, { label: '🚪 Sign out', hint: 'Action', run: logout });
  const input = h('input', { placeholder: 'Type a command, project or task…' });
  const list = h('div', { class: 'pal-list' });
  let sel = 0, shown = [];
  const close = () => ov.remove();
  const render = () => {
    const q = input.value.trim().toLowerCase();
    shown = items.filter((i) => !q || i.label.toLowerCase().includes(q)).slice(0, 9);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.replaceChildren(...shown.map((i, idx) => h('button', { class: 'pal-item' + (idx === sel ? ' sel' : ''), onclick: () => { close(); i.run(); } }, h('span', {}, i.label), h('small', {}, i.hint))));
  };
  input.addEventListener('input', () => { sel = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
    else if (e.key === 'Enter' && shown[sel]) { close(); shown[sel].run(); }
  });
  const ov = h('div', { class: 'overlay', id: 'palette', onclick: (e) => e.target === ov && close() }, h('div', { class: 'dialog palette' }, input, list));
  document.body.append(ov);
  render();
  input.focus();
}
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '?') shortcutsModal();
  else if (e.key.toLowerCase() === 'n' && state.board && state.view === 'board') { const b = $('.add-btn'); if (b) { e.preventDefault(); b.click(); } }
});

/* ---------- Boot ---------- */
(async () => {
  const rm = location.hash.match(/reset=([a-f0-9]{64})/);
  if (rm) { // opened from a password-reset email
    history.replaceState(null, '', location.pathname);
    renderAuth('reset', rm[1]);
    return;
  }
  if (token.get()) {
    try { state.user = await api('GET', '/auth/me'); await start(); return; }
    catch { token.set(null); state.user = null; }
  }
  renderAuth();
})();
