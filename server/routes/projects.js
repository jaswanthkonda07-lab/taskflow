const router = require('express').Router();
const Project = require('../models/Project');
const Task = require('../models/Task');
const Comment = require('../models/Comment');
const User = require('../models/User');
const auth = require('../middleware/auth');
const notify = require('../utils/notify');
const log = require('../utils/activity');
const Activity = require('../models/Activity');

const POP = 'name email color';
const HEX = /^#[0-9a-f]{6}$/i;
router.use(auth);

router.get('/', async (req, res) => {
  const projects = await Project.find({ members: req.userId }).populate('members', POP).sort('-updatedAt').lean();
  await Promise.all(projects.map(async (p) => {
    p.taskCount = await Task.countDocuments({ project: p._id });
    p.doneCount = await Task.countDocuments({ project: p._id, column: p.columns[p.columns.length - 1] });
  }));
  res.json(projects);
});

router.post('/', async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Project name is required' });
  const color = HEX.test(req.body.color || '') ? req.body.color : '#6366f1';
  const p = await Project.create({
    name: name.slice(0, 80), description: String(req.body.description || '').slice(0, 300),
    color, owner: req.userId, members: [req.userId]
  });
  res.status(201).json(await p.populate('members', POP));
});

router.get('/:id/activity', async (req, res) => {
  if (!(await Project.exists({ _id: req.params.id, members: req.userId }))) return res.status(404).json({ error: 'Project not found' });
  res.json(await Activity.find({ project: req.params.id }).sort('-createdAt').limit(50).populate('actor', 'name color'));
});

router.get('/:id', async (req, res) => {
  const project = await Project.findOne({ _id: req.params.id, members: req.userId }).populate('members', POP);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const tasks = await Task.find({ project: project._id }).populate('assignee', POP).sort('position');
  res.json({ project, tasks });
});

router.post('/:id/members', async (req, res) => {
  const p = await Project.findOne({ _id: req.params.id, members: req.userId });
  if (!p) return res.status(404).json({ error: 'Project not found' });
  const email = String(req.body.email || '').trim().toLowerCase();
  const invitee = await User.findOne({ email });
  if (!invitee) return res.status(404).json({ error: 'No user with that email. Ask them to sign up first.' });
  if (p.members.some((m) => m.equals(invitee._id))) return res.status(400).json({ error: 'Already a member' });
  p.members.push(invitee._id);
  await p.save();
  await p.populate('members', POP);
  const io = req.app.get('io');
  io.to('project:' + p.id).emit('project:updated', p.toJSON());
  io.to('user:' + invitee.id).emit('projects:changed');
  await notify(io, { user: invitee._id, type: 'invite', message: `${req.user.name} added you to "${p.name}"`, project: p._id });
  log(io, { project: p._id, actor: req.userId, text: `added ${invitee.name} to the project` });
  res.json(p);
});

router.delete('/:id', async (req, res) => {
  const p = await Project.findOne({ _id: req.params.id, owner: req.userId });
  if (!p) return res.status(404).json({ error: 'Project not found or you are not the owner' });
  await Promise.all([Task.deleteMany({ project: p._id }), Comment.deleteMany({ project: p._id }), Activity.deleteMany({ project: p._id }), require('../models/Notification').deleteMany({ project: p._id }), p.deleteOne()]);
  const io = req.app.get('io');
  p.members.forEach((m) => io.to('user:' + m).emit('projects:changed'));
  res.json({ ok: true });
});

module.exports = router;
