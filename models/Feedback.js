const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  feedback: {
    type: String,
    required: [true, 'Feedback text is required'],
    trim: true,
    maxlength: [2000, 'Feedback cannot exceed 2000 characters']
  },
  rating: {
    type: Number,
    min: 1,
    max: 5
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  deviceInfo: {
      type: String
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Feedback', feedbackSchema);
