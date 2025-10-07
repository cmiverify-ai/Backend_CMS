const mongoose = require('mongoose');

const newsSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  summary: {
    type: String,
    required: [true, 'Summary is required'],
    trim: true,
    maxlength: [500, 'Summary cannot exceed 500 characters']
  },
  content: {
    type: String,
    required: [true, 'Content is required'],
    trim: true
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    enum: ['Politics', 'Technology', 'Sports', 'Entertainment', 'Business', 'Health'],
    trim: true
  },
  imageUrl: {
    type: String,
    trim: true,
    validate: {
      validator: function(v) {
        return !v || /^https?:\/\/.+/.test(v);
      },
      message: 'Image URL must be a valid HTTP/HTTPS URL'
    }
  },
  status: {
    type: String,
    enum: ['published', 'draft'],
    default: 'draft'
  },
  views: {
    type: Number,
    default: 0,
    min: 0
  },
  shares: {
    type: Number,
    default: 0,
    min: 0
  },
  tags: [{
    type: String,
    trim: true
  }],
  author: {
    type: String,
    default: 'Admin',
    trim: true
  },
  featured: {
    type: Boolean,
    default: false
  },
  publishedAt: {
    type: Date
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
newsSchema.index({ status: 1, createdAt: -1 });
newsSchema.index({ category: 1, status: 1 });
newsSchema.index({ featured: 1, status: 1 });
newsSchema.index({ title: 'text', summary: 'text', content: 'text' });

// Virtual for reading time estimation
newsSchema.virtual('readingTime').get(function() {
  const wordsPerMinute = 200;
  const wordCount = this.content.split(/\s+/).length;
  const readingTime = Math.ceil(wordCount / wordsPerMinute);
  return readingTime;
});

// Pre-save middleware
newsSchema.pre('save', function(next) {
  // Set publishedAt when status changes to published
  if (this.isModified('status') && this.status === 'published' && !this.publishedAt) {
    this.publishedAt = new Date();
  }
  
  // Remove publishedAt if status changes to draft
  if (this.isModified('status') && this.status === 'draft') {
    this.publishedAt = undefined;
  }
  
  next();
});

// Static methods
newsSchema.statics.getPublished = function() {
  return this.find({ status: 'published' }).sort({ createdAt: -1 });
};

newsSchema.statics.getFeatured = function() {
  return this.find({ status: 'published', featured: true }).sort({ createdAt: -1 });
};

newsSchema.statics.getByCategory = function(category) {
  return this.find({ status: 'published', category }).sort({ createdAt: -1 });
};

newsSchema.statics.searchNews = function(query) {
  return this.find({
    status: 'published',
    $text: { $search: query }
  }).sort({ score: { $meta: 'textScore' } });
};

// Instance methods
newsSchema.methods.incrementViews = function() {
  this.views += 1;
  return this.save();
};

newsSchema.methods.incrementShares = function() {
  this.shares += 1;
  return this.save();
};

module.exports = mongoose.model('News', newsSchema);
