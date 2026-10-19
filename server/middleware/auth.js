const jwt = require('jsonwebtoken');
const User = require('../models/User');

module.exports = async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const { id } = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(id).select('-password');
    if (!user) throw new Error('no user');
    req.user = user;
    req.userId = user.id;
    next();
  } catch {
    res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }
};
