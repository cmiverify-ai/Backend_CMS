const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [50, 'Name cannot exceed 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    validate: {
      validator: function(v) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: 'Please provide a valid email address'
    }
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters long'],
    select: false // Don't include password in queries by default
  },
  phone: {
    type: String,
    trim: true,
    validate: {
      validator: function(v) {
        return !v || /^\+?[\d\s-()]+$/.test(v);
      },
      message: 'Please provide a valid phone number'
    }
  },
  role: {
    type: String,
    enum: ['user', 'admin', 'super_admin'],
    default: 'user'
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended'],
    default: 'active'
  },
  avatar: {
    type: String,
    trim: true,
    validate: {
      validator: function(v) {
        return !v || /^https?:\/\/.+/.test(v);
      },
      message: 'Avatar URL must be a valid HTTP/HTTPS URL'
    }
  },
  preferences: {
    language: {
      type: String,
      enum: ['en', 'hi', 'regional'],
      default: 'en'
    },
    categories: [{
      type: String,
      enum: ['Politics', 'Technology', 'Sports', 'Entertainment', 'Business', 'Health']
    }],
    theme: {
      type: String,
      enum: ['light', 'dark', 'auto'],
      default: 'auto'
    },
    fontSize: {
      type: String,
      enum: ['small', 'medium', 'large'],
      default: 'medium'
    },
    notifications: {
      push: { type: Boolean, default: true },
      email: { type: Boolean, default: true },
      breakingNews: { type: Boolean, default: true },
      categoryUpdates: { type: Boolean, default: true },
      silentHours: {
        enabled: { type: Boolean, default: false },
        start: { type: String, default: '22:00' },
        end: { type: String, default: '08:00' }
      }
    }
  },
  bookmarks: {
    news: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'News'
    }],
    videos: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Video'
    }]
  },
  // Authentication related fields
  emailVerified: {
    type: Boolean,
    default: false
  },
  phoneVerified: {
    type: Boolean,
    default: false
  },
  lastLogin: {
    type: Date
  },
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date
  },
  resetPasswordToken: String,
  resetPasswordExpire: Date,
  emailVerificationToken: String,
  emailVerificationExpire: Date,
  // Firebase related fields
  firebaseUid: {
    type: String,
    sparse: true,
    unique: true
  },
  // Analytics
  analytics: {
    totalViews: { type: Number, default: 0 },
    totalShares: { type: Number, default: 0 },
    lastActiveAt: { type: Date, default: Date.now },
    deviceInfo: {
      platform: String,
      version: String,
      model: String
    }
  }
}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.password;
      delete ret.resetPasswordToken;
      delete ret.resetPasswordExpire;
      delete ret.emailVerificationToken;
      delete ret.emailVerificationExpire;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Indexes
// Note: 'unique: true' in schema definition already creates an index.
// Redundant schema.index() calls for 'email' and 'firebaseUid' are removed.
userSchema.index({ role: 1, status: 1 });
userSchema.index({ 'analytics.lastActiveAt': -1 });

// Virtual for account lock status
userSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Pre-save middleware
userSchema.pre('save', async function(next) {
  // Hash password if it's modified
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Pre-save middleware for login attempts
userSchema.pre('save', function(next) {
  // If account is not locked and we're modifying login attempts
  if (!this.isModified('loginAttempts') && !this.isModified('lockUntil')) {
    return next();
  }
  
  // If we have a previous lock that has expired, restart at 1
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $unset: { lockUntil: 1 },
      $set: { loginAttempts: 1 }
    }, next);
  }
  
  next();
});

// Instance methods
userSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.password) return false;
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.incLoginAttempts = function() {
  const maxAttempts = 5;
  const lockTime = 2 * 60 * 60 * 1000; // 2 hours
  
  // If we have a previous lock that has expired, restart at 1
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $unset: { lockUntil: 1 },
      $set: { loginAttempts: 1 }
    });
  }
  
  const updates = { $inc: { loginAttempts: 1 } };
  
  // Lock account after max attempts
  if (this.loginAttempts + 1 >= maxAttempts && !this.isLocked) {
    updates.$set = { lockUntil: Date.now() + lockTime };
  }
  
  return this.updateOne(updates);
};

userSchema.methods.resetLoginAttempts = function() {
  return this.updateOne({
    $set: { loginAttempts: 0 },
    $unset: { lockUntil: 1 }
  });
};

userSchema.methods.addBookmark = function(type, itemId) {
  if (!['news', 'videos'].includes(type)) {
    throw new Error('Invalid bookmark type');
  }
  
  if (!this.bookmarks[type].includes(itemId)) {
    this.bookmarks[type].push(itemId);
  }
  
  return this.save();
};

userSchema.methods.removeBookmark = function(type, itemId) {
  if (!['news', 'videos'].includes(type)) {
    throw new Error('Invalid bookmark type');
  }
  
  this.bookmarks[type] = this.bookmarks[type].filter(
    id => id.toString() !== itemId.toString()
  );
  
  return this.save();
};

userSchema.methods.updateLastActive = function() {
  this.analytics.lastActiveAt = new Date();
  return this.save();
};

// Static methods
userSchema.statics.findByEmail = function(email) {
  return this.findOne({ email: email.toLowerCase() });
};

userSchema.statics.findActiveAdmins = function() {
  return this.find({ 
    role: { $in: ['admin', 'super_admin'] },
    status: 'active'
  });
};

userSchema.statics.getActiveUsers = function(days = 30) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  
  return this.find({
    'analytics.lastActiveAt': { $gte: date },
    status: 'active'
  });
};

module.exports = mongoose.model('User', userSchema);

