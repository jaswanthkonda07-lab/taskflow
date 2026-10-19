const { Schema, model } = require('mongoose');
const schema = new Schema({
  project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  actor: { type: Schema.Types.ObjectId, ref: 'User' },
  task: { type: Schema.Types.ObjectId, ref: 'Task' },
  text: { type: String, required: true, maxlength: 300 }
}, { timestamps: true });
module.exports = model('Activity', schema);
