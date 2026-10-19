const { Schema, model } = require('mongoose');
const schema = new Schema({
  project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 140 },
  description: { type: String, default: '', maxlength: 2000 },
  column: { type: String, required: true },
  position: { type: Number, default: 1000 },
  assignee: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  dueDate: { type: Date, default: null },
  checklist: [{ _id: false, text: { type: String, maxlength: 140 }, done: { type: Boolean, default: false } }],
  labels: [{ type: String, trim: true, maxlength: 24 }],
  reminded: { type: Boolean, default: false },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });
schema.index({ project: 1, column: 1, position: 1 });
schema.index({ project: 1, labels: 1 });
module.exports = model('Task', schema);
