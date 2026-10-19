require('dotenv').config();
require('express-async-errors');
const path = require('path');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const production = process.env.NODE_ENV === 'production';
if (production && !process.env.JWT_SECRET) throw new Error('JWT_SECRET is required in production');
if (production && !process.env.MONGODB_URI) throw new Error('MONGODB_URI is required in production');
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'dev-only-secret-change-me';
  console.warn('[warn] JWT_SECRET not set, using an insecure development default.');
}
const Project = require('./models/Project');

const app = express();
const server = http.createServer(app);
const origin = process.env.CLIENT_ORIGIN || false;
const io = new Server(server, { cors: { origin } });
app.set('io', io);
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), 'connect-src': ["'self'", 'ws:', 'wss:'] }
  }
}));
app.use(cors({ origin }));
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({ ok: ready, database: ready ? 'connected' : 'disconnected' });
});
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Please wait a few minutes.' } }), require('./routes/auth'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.name === 'CastError' || err.name === 'ValidationError') return res.status(400).json({ error: 'Invalid request data' });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

// ---- WebSockets: JWT-authenticated, room per project + private room per user ----
io.use((socket, next) => {
  try {
    socket.userId = jwt.verify(socket.handshake.auth.token, process.env.JWT_SECRET).id;
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});
// ---- Live presence: who is viewing which board ----
const presence = new Map(); // projectId -> Map(socketId -> userId)
function broadcastPresence(pid) {
  const m = presence.get(pid);
  io.to('project:' + pid).emit('presence', { project: pid, users: [...new Set(m ? m.values() : [])] });
}
function leaveBoard(socket, pid) {
  socket.leave('project:' + pid);
  const m = presence.get(pid);
  if (m) { m.delete(socket.id); if (!m.size) presence.delete(pid); }
  socket.boards.delete(pid);
  broadcastPresence(pid);
}
io.on('connection', (socket) => {
  socket.join('user:' + socket.userId);
  socket.boards = new Set();
  socket.on('project:join', async (projectId) => {
    try {
      const pid = String(projectId);
      if (!(await Project.exists({ _id: pid, members: socket.userId }))) return;
      socket.join('project:' + pid);
      if (!presence.has(pid)) presence.set(pid, new Map());
      presence.get(pid).set(socket.id, socket.userId);
      socket.boards.add(pid);
      broadcastPresence(pid);
    } catch { /* invalid id */ }
  });
  socket.on('project:leave', (projectId) => leaveBoard(socket, String(projectId)));
  socket.on('disconnect', () => { for (const pid of [...socket.boards]) leaveBoard(socket, pid); });
});

// ---- Due-date reminders: in-app notification once per task when it is due within 24h ----
const Task = require('./models/Task');
const notify = require('./utils/notify');
async function sendReminders() {
  try {
    const from = new Date(Date.now() - 12 * 3600 * 1000), to = new Date(Date.now() + 24 * 3600 * 1000);
    const tasks = await Task.find({ dueDate: { $gte: from, $lte: to }, assignee: { $ne: null }, reminded: false });
    for (const t of tasks) {
      const p = await Project.findById(t.project).select('columns');
      t.reminded = true;
      await t.save();
      if (!p || t.column === p.columns[p.columns.length - 1]) continue; // already done
      await notify(io, { user: t.assignee, type: 'reminder', message: `⏰ "${t.title}" is due soon`, project: t.project, task: t._id });
    }
  } catch (e) { console.error('reminder job failed:', e.message); }
}

const PORT = process.env.PORT || 4000;
const mongoUrl = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/taskflow';
let reminderTimer;
const httpReady = server.listen(PORT, () => console.log(`TaskFlow running on http://localhost:${PORT}`));
mongoose.connect(mongoUrl)
  .then(() => {
    console.log('MongoDB connected');
    reminderTimer = setInterval(sendReminders, 30 * 60 * 1000).unref();
    setTimeout(sendReminders, 15000).unref();
  })
  .catch((e) => { console.error('MongoDB connection failed:', e.message); if (production) process.exitCode = 1; });
async function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  if (reminderTimer) clearInterval(reminderTimer);
  await mongoose.disconnect().catch(() => {});
  httpReady.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8000).unref();
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
