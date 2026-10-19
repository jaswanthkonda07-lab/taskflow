const Notification = require('../models/Notification');

// Persist a notification and push it to the user's private socket room in real time.
module.exports = async (io, { user, type, message, project, task }) => {
  const n = await Notification.create({ user, type, message, project, task });
  io.to('user:' + user).emit('notification', n.toJSON());
  return n;
};
