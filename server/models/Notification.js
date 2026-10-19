const { Schema, model } = require('mongoose');
const schema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['assigned', 'comment', 'invite', 'reminder'], required: true },
  message: { type: String, required: true },
  project: { type: Schema.Types.ObjectId, ref: 'Project' },
  task: { type: Schema.Types.ObjectId, ref: 'Task' },
  read: { type: Boolean, default: false }
}, { timestamps: true });
module.exports = model('Notification', schema);
