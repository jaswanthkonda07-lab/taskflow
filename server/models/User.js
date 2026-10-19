const { Schema, model } = require('mongoose');
const COLORS = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#8b5cf6', '#ef4444', '#0ea5e9', '#22c55e'];
const schema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  resetHash: { type: String },
  resetExpires: { type: Date },
  color: { type: String, default: () => COLORS[Math.floor(Math.random() * COLORS.length)] }
}, { timestamps: true });
module.exports = model('User', schema);
