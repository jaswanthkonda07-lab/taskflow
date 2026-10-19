const router = require('express').Router();
const Notification = require('../models/Notification');
const auth = require('../middleware/auth');
router.use(auth);

router.get('/', async (req, res) => {
  res.json(await Notification.find({ user: req.userId }).sort('-createdAt').limit(30));
});
router.post('/read-all', async (req, res) => {
  await Notification.updateMany({ user: req.userId, read: false }, { read: true });
  res.json({ ok: true });
});
module.exports = router;
