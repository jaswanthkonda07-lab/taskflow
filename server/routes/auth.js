const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const Project = require('../models/Project');
const Task = require('../models/Task');
const auth = require('../middleware/auth');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sign = (u) => jwt.sign({ id: u.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
const pub = (u) => ({ _id: u.id, name: u.name, email: u.email, color: u.color });

router.post('/register', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!name || !EMAIL.test(email)) return res.status(400).json({ error: 'Enter a valid name and email' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (await User.findOne({ email })) return res.status(409).json({ error: 'This email is already registered' });
  const user = await User.create({ name, email, password: await bcrypt.hash(password, 12) });
  res.status(201).json({ token: sign(user), user: pub(user) });
});

router.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = await User.findOne({ email });
  if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.password))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.json({ token: sign(user), user: pub(user) });
});

router.get('/me', auth, (req, res) => res.json(pub(req.user)));

// One-click demo account with a pre-filled project, handy for recruiters.
router.post('/demo', async (req, res) => {
  const rand = crypto.randomBytes(4).toString('hex');
  const hash = await bcrypt.hash(crypto.randomBytes(12).toString('hex'), 8);
  const [me, ava] = await User.create([
    { name: 'Demo User', email: `demo.${rand}@taskflow.demo`, password: hash },
    { name: 'Ava Chen', email: `ava.${rand}@taskflow.demo`, password: hash }
  ]);
  const project = await Project.create({
    name: 'Website Redesign', description: 'Q4 marketing site refresh, shared with the design team',
    color: '#6366f1', owner: me._id, members: [me._id, ava._id]
  });
  const d = (n) => new Date(Date.now() + n * 86400000);
  const seed = [
    ['Research competitor sites', 'Done', 'low', ava, -2],
    ['Design landing page mockups', 'Review', 'high', ava, 1],
    ['Build responsive navbar', 'In Progress', 'medium', me, 3],
    ['Set up analytics events', 'To Do', 'medium', null, 7],
    ['Write launch announcement', 'To Do', 'low', me, 10],
    ['Fix Safari layout bug', 'In Progress', 'high', me, 0]
  ];
  await Task.insertMany(seed.map(([title, column, priority, who, days], i) => ({
    project: project._id, title, column, priority, assignee: who ? who._id : null,
    dueDate: d(days), position: (i + 1) * 1000, createdBy: me._id,
    description: 'Sample task. Drag me between columns, open me to comment!'
  })));
  res.status(201).json({ token: sign(me), user: pub(me) });
});

// ---- Password reset (email via Brevo's HTTPS API; Render's free tier blocks SMTP ports) ----
const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many reset requests. Please try again in an hour.' }
});
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sendMail(to, subject, html) {
  const key = process.env.BREVO_API_KEY;
  if (!key) { console.log(`[mail disabled: set BREVO_API_KEY] To: ${to}\nSubject: ${subject}\n${html}`); return false; }
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { name: 'TaskFlow', email: process.env.MAIL_FROM }, to: [{ email: to }], subject, htmlContent: html })
  });
  if (!r.ok) console.error('Email send failed:', r.status, await r.text());
  return r.ok;
}

// Always answers the same way so attackers cannot discover which emails are registered.
router.post('/forgot', forgotLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = EMAIL.test(email) ? await User.findOne({ email }) : null;
  if (user) {
    const raw = crypto.randomBytes(32).toString('hex');
    user.resetHash = sha(raw);
    user.resetExpires = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();
    const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const link = `${base}/#reset=${raw}`;
    sendMail(user.email, 'Reset your TaskFlow password',
      `<p>Hi ${esc(user.name)},</p><p>Click the button below to choose a new password. The link is valid for 1 hour.</p>` +
      `<p><a href="${link}" style="background:#6366f1;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Reset password</a></p>` +
      `<p>If you did not request this, you can ignore this email.</p>`).catch((e) => console.error(e));
  }
  res.json({ ok: true });
});

router.post('/reset', async (req, res) => {
  const token = String(req.body.token || '');
  const password = String(req.body.password || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error: 'Invalid or expired reset link' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const user = await User.findOne({ resetHash: sha(token), resetExpires: { $gt: new Date() } });
  if (!user) return res.status(400).json({ error: 'Invalid or expired reset link' });
  user.password = await bcrypt.hash(password, 12);
  user.resetHash = undefined;
  user.resetExpires = undefined;
  await user.save();
  res.json({ ok: true });
});

module.exports = router;
