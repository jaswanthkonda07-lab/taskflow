const { Schema, model } = require('mongoose');
const schema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  description: { type: String, default: '', maxlength: 300 },
  color: { type: String, default: '#6366f1' },
  owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  members: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  columns: { type: [String], default: ['To Do', 'In Progress', 'Review', 'Done'] }
}, { timestamps: true });
schema.index({ members: 1 });
module.exports = model('Project', schema);
