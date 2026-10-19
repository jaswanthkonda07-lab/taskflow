const Activity = require('../models/Activity');

// Record an audit-trail entry and stream it live to everyone viewing the board. Never throws.
module.exports = async (io, { project, actor, task, text }) => {
  try {
    const a = await Activity.create({ project, actor, task, text: String(text).slice(0, 300) });
    await a.populate('actor', 'name color');
    io.to('project:' + project).emit('activity:new', a.toJSON());
  } catch (e) { console.error('activity log failed:', e.message); }
};
