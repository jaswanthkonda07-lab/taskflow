const router = require('express').Router();
const Project = require('../models/Project');
const Task = require('../models/Task');
const Comment = require('../models/Comment');
const auth = require('../middleware/auth');
const notify = require('../utils/notify');
const log = require('../utils/activity');

const POP = 'name email color';
const PRIOS = ['low', 'medium', 'high'];
const normalizeLabels = (value) => [...new Set((Array.isArray(value) ? value : String(value || '').split(',')).map((x) => String(x).trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '-').slice(0, 24)).filter(Boolean))].slice(0, 8);
router.use(auth);

async function access(req, taskId) {
  const t = await Task.findById(taskId);
  if (!t) return {};
  const p = await Project.findOne({ _id: t.project, members: req.userId });
  return p ? { t, p } : {};
}
const validAssignee = (p, id) => (id && p.members.some((m) => m.equals(id)) ? id : null);

// Open tasks assigned to the current user across all projects (dashboard widget)
router.get('/mine', async (req, res) => {
  const projects = await Project.find({ members: req.userId }).select('name color columns');
  const byId = new Map(projects.map((p) => [p.id, p]));
  const tasks = await Task.find({ assignee: req.userId, project: { $in: projects.map((p) => p._id) } }).lean();
  const out = tasks
    .filter((t) => { const p = byId.get(String(t.project)); return p && t.column !== p.columns[p.columns.length - 1]; })
    .map((t) => { const p = byId.get(String(t.project)); return { _id: t._id, title: t.title, priority: t.priority, dueDate: t.dueDate, column: t.column, labels: t.labels || [], project: String(t.project), projectName: p.name, projectColor: p.color }; })
    .sort((a, b) => (a.dueDate ? new Date(a.dueDate) : 8.64e15) - (b.dueDate ? new Date(b.dueDate) : 8.64e15))
    .slice(0, 20);
  res.json(out);
});

router.post('/', async (req, res) => {
  const b = req.body;
  const p = await Project.findOne({ _id: b.projectId, members: req.userId });
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const title = String(b.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Task title is required' });
  const column = p.columns.includes(b.column) ? b.column : p.columns[0];
  const last = await Task.findOne({ project: p._id, column }).sort('-position');
  const task = await Task.create({
    project: p._id, title: title.slice(0, 140), description: String(b.description || '').slice(0, 2000),
    column, position: (last ? last.position : 0) + 1000, assignee: validAssignee(p, b.assignee),
    priority: PRIOS.includes(b.priority) ? b.priority : 'medium', dueDate: b.dueDate || null, labels: normalizeLabels(b.labels), createdBy: req.userId
  });
  await task.populate('assignee', POP);
  const io = req.app.get('io');
  io.to('project:' + p.id).emit('task:created', task.toJSON());
  log(io, { project: p._id, actor: req.userId, task: task._id, text: `created "${task.title}" in ${task.column}` });
  if (task.assignee && task.assignee.id !== req.userId) {
    await notify(io, { user: task.assignee._id, type: 'assigned', message: `${req.user.name} assigned you "${task.title}"`, project: p._id, task: task._id });
  }
  res.status(201).json(task);
});

router.patch('/:id', async (req, res) => {
  const { t, p } = await access(req, req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  const b = req.body;
  const prevAssignee = String(t.assignee || '');
  const prevColumn = t.column;
  const snap = () => JSON.stringify([t.title, t.description, t.priority, t.dueDate ? +t.dueDate : null, t.checklist]);
  const before = snap();
  if ('title' in b) {
    if (!String(b.title).trim()) return res.status(400).json({ error: 'Title is required' });
    t.title = String(b.title).trim().slice(0, 140);
  }
  if ('description' in b) t.description = String(b.description || '').slice(0, 2000);
  if ('priority' in b && PRIOS.includes(b.priority)) t.priority = b.priority;
  if ('dueDate' in b) {
    const nd = b.dueDate ? new Date(b.dueDate) : null;
    if ((nd ? +nd : null) !== (t.dueDate ? +t.dueDate : null)) t.reminded = false;
    t.dueDate = nd;
  }
  if ('assignee' in b) t.assignee = validAssignee(p, b.assignee);
  if (Array.isArray(b.checklist)) {
    t.checklist = b.checklist.slice(0, 30)
      .map((i) => ({ text: String((i && i.text) || '').trim().slice(0, 140), done: !!(i && i.done) }))
      .filter((i) => i.text);
  }
  if ('labels' in b) t.labels = normalizeLabels(b.labels);
  if ('column' in b && p.columns.includes(b.column)) {
    if (b.column !== t.column && typeof b.position !== 'number') {
      const last = await Task.findOne({ project: p._id, column: b.column }).sort('-position');
      t.position = (last ? last.position : 0) + 1000;
    }
    t.column = b.column;
  }
  if (typeof b.position === 'number' && Number.isFinite(b.position)) t.position = b.position;
  await t.save();
  await t.populate('assignee', POP);
  const io = req.app.get('io');
  io.to('project:' + p.id).emit('task:updated', t.toJSON());
  const msgs = [];
  if (t.column !== prevColumn) msgs.push(`moved "${t.title}" from ${prevColumn} to ${t.column}`);
  if (String(t.assignee ? t.assignee._id : '') !== prevAssignee) msgs.push(t.assignee ? `assigned "${t.title}" to ${t.assignee.name}` : `unassigned "${t.title}"`);
  if (!msgs.length && snap() !== before) msgs.push(`edited "${t.title}"`);
  msgs.forEach((text) => log(io, { project: p._id, actor: req.userId, task: t._id, text }));
  if (t.assignee && t.assignee.id !== prevAssignee && t.assignee.id !== req.userId) {
    await notify(io, { user: t.assignee._id, type: 'assigned', message: `${req.user.name} assigned you "${t.title}"`, project: p._id, task: t._id });
  }
  res.json(t);
});

router.delete('/:id', async (req, res) => {
  const { t, p } = await access(req, req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  const Activity = require('../models/Activity');
  const Notification = require('../models/Notification');
  await Promise.all([Comment.deleteMany({ task: t._id }), Activity.deleteMany({ task: t._id }), Notification.deleteMany({ task: t._id }), t.deleteOne()]);
  req.app.get('io').to('project:' + p.id).emit('task:deleted', { id: t.id, project: p.id });
  log(req.app.get('io'), { project: p._id, actor: req.userId, text: `deleted "${t.title}"` });
  res.json({ ok: true });
});

router.get('/:id/comments', async (req, res) => {
  const { t } = await access(req, req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  res.json(await Comment.find({ task: t._id }).populate('author', POP).sort('createdAt'));
});

router.post('/:id/comments', async (req, res) => {
  const { t, p } = await access(req, req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Comment cannot be empty' });
  const c = await Comment.create({ task: t._id, project: p._id, author: req.userId, text: text.slice(0, 1000) });
  await c.populate('author', POP);
  const io = req.app.get('io');
  io.to('project:' + p.id).emit('comment:created', c.toJSON());
  log(io, { project: p._id, actor: req.userId, task: t._id, text: `commented on "${t.title}"` });
  const targets = new Set([String(t.assignee || ''), String(t.createdBy || '')]);
  targets.delete(String(req.userId));
  targets.delete('');
  for (const user of targets) {
    await notify(io, { user, type: 'comment', message: `${req.user.name} commented on "${t.title}"`, project: p._id, task: t._id });
  }
  res.status(201).json(c);
});

module.exports = router;
