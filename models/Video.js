const mongoose = require('mongoose');

const videoSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  youtubeUrl: {
    type: String,
    required: [true, 'YouTube URL is required'],
    trim: true,
    validate: {
      validator: function(v) {
        return /^https?:\/\/(www\.)?(youtube\.com\/(watch\?v=|embed\/)|youtu\.be\/)[\w-]+/.test(v);
      },
      message: 'Please provide a valid YouTube URL'
    }
  },
  youtubeId: {
    type: String,
    required: [true, 'YouTube ID is required'],
    trim: true,
    unique: true,
    validate: {
      validator: function(v) {
        return /^[\w-]{11}$/.test(v);
      },
      message: 'Invalid YouTube video ID'
    }
  },
  thumbnailUrl: {
    type: String,
    trim: true,
    validate: {
      validator: function(v) {
        return !v || /^https?:\/\/.+/.test(v);
      },
      message: 'Thumbnail URL must be a valid HTTP/HTTPS URL'
    }
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    enum: ['News', 'Analysis', 'Interview', 'Documentary', 'Live', 'Entertainment'],
    trim: true
  },
  duration: {
    type: String,
    trim: true,
    validate: {
      validator: function(v) {
        return !v || /^(\d{1,2}:)?\d{1,2}:\d{2}$/.test(v);
      },
      message: 'Duration must be in format MM:SS or HH:MM:SS'
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
  likes: {
    type: Number,
    default: 0,
    min: 0
  },
  tags: [{
    type: String,
    trim: true
  }],
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
  },
  // YouTube API data (optional)
  youtubeData: {
    channelTitle: String,
    publishedAt: Date,
    viewCount: Number,
    likeCount: Number,
    commentCount: Number,
    lastSynced: Date
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
// Note: 'unique: true' for youtubeId already creates an index.
videoSchema.index({ status: 1, createdAt: -1 });
videoSchema.index({ category: 1, status: 1 });
videoSchema.index({ featured: 1, status: 1 });
videoSchema.index({ title: 'text', description: 'text' });

// Virtual for embed URL
videoSchema.virtual('embedUrl').get(function() {
  return `https://www.youtube.com/embed/${this.youtubeId}`;
});

// Virtual for default thumbnail if not provided
videoSchema.virtual('defaultThumbnail').get(function() {
  return this.thumbnailUrl || `https://img.youtube.com/vi/${this.youtubeId}/maxresdefault.jpg`;
});

// Pre-save middleware
videoSchema.pre('save', function(next) {
  // Extract YouTube ID from URL if not provided
  if (this.isModified('youtubeUrl') && this.youtubeUrl) {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
      /youtube\.com\/watch\?.*v=([^&\n?#]+)/
    ];
    
    for (const pattern of patterns) {
      const match = this.youtubeUrl.match(pattern);
      if (match) {
        this.youtubeId = match[1];
        break;
      }
    }
  }
  
  // Set default thumbnail if not provided
  if (!this.thumbnailUrl && this.youtubeId) {
    this.thumbnailUrl = `https://img.youtube.com/vi/${this.youtubeId}/maxresdefault.jpg`;
  }
  
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
videoSchema.statics.getPublished = function() {
  return this.find({ status: 'published' }).sort({ createdAt: -1 });
};

videoSchema.statics.getFeatured = function() {
  return this.find({ status: 'published', featured: true }).sort({ createdAt: -1 });
};

videoSchema.statics.getByCategory = function(category) {
  return this.find({ status: 'published', category }).sort({ createdAt: -1 });
};

videoSchema.statics.searchVideos = function(query) {
  return this.find({
    status: 'published',
    $text: { $search: query }
  }).sort({ score: { $meta: 'textScore' } });
};

videoSchema.statics.getTrending = function(limit = 10) {
  return this.find({ status: 'published' })
    .sort({ views: -1, createdAt: -1 })
    .limit(limit);
};

// Instance methods
videoSchema.methods.incrementViews = function() {
  this.views += 1;
  return this.save();
};

videoSchema.methods.incrementShares = function() {
  this.shares += 1;
  return this.save();
};

videoSchema.methods.incrementLikes = function() {
  this.likes += 1;
  return this.save();
};

videoSchema.methods.syncWithYouTube = async function() {
  // This method would integrate with YouTube Data API
  // For now, it's a placeholder for future implementation
  this.youtubeData.lastSynced = new Date();
  return this.save();
};

module.exports = mongoose.model('Video', videoSchema);
