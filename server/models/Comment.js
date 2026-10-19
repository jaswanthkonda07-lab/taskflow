const { Schema, model } = require('mongoose');
const schema = new Schema({
  task: { type: Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
  project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, maxlength: 1000 }
}, { timestamps: true });
module.exports = model('Comment', schema);
