const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001;

// Import User model for seeding
const User = require('./models/User');

// Import routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const newsRoutes = require('./routes/news');
const videoRoutes = require('./routes/videos');
const feedbackRoutes = require('./routes/feedback');

// Security middleware
app.use(helmet());

// Rate limiting - Stricter for admin
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests from this IP, please try again later.'
  }
});
app.use('/api/', limiter);

// CORS configuration - Allow admin panel only
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://admin.abhaya.com']
    : ['http://localhost:3001', 'http://localhost:5173'],
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Seed default admin user function
const seedAdminUser = async () => {
  try {
    const adminEmail = 'admin@abhaya.com';
    const defaultPassword = 'admin123';
    const admin = await User.findOne({ email: adminEmail }).select('+password');

    if (!admin) {
      console.log('No admin user found. Creating one...');
      const newAdmin = new User({
        name: 'Admin User',
        email: adminEmail,
        password: defaultPassword,
        role: 'admin',
        status: 'active',
        emailVerified: true
      });
      await newAdmin.save();
      console.log('✅ Default admin user created successfully.');
      console.log(`   Email: ${adminEmail}`);
      console.log(`   Password: ${defaultPassword}`);
    } else {
      const isPasswordDefault = await bcrypt.compare(defaultPassword, admin.password || '');
      if (!isPasswordDefault || admin.isLocked || admin.loginAttempts > 0) {
        console.log('Admin account requires reset. Resetting password and unlocking...');
        admin.password = defaultPassword;
        admin.loginAttempts = 0;
        admin.lockUntil = undefined;
        await admin.save();
        console.log('✅ Default admin user password has been reset and account unlocked.');
      } else {
        console.log('✅ Admin user account is in a good state.');
      }
    }
  } catch (error) {
    console.error('❌ Error during admin user seeding:', error.message);
  }
};

// MongoDB connection
const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/abhaya-news';
    await mongoose.connect(mongoURI);
    console.log('✅ Admin Backend: MongoDB connected successfully');
    await seedAdminUser();
  } catch (error) {
    console.error('❌ Admin Backend: MongoDB connection error:', error.message);
    process.exit(1);
  }
};

// Connect to database
connectDB();

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    service: 'Admin Backend',
    status: 'OK',
    message: 'Abhaya News Admin API is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/feedback', feedbackRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Abhaya News Admin API',
    version: '1.0.0',
    service: 'Admin Backend',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      admin: '/api/admin',
      news: '/api/news (CRUD)',
      videos: '/api/videos (CRUD)',
      feedback: '/api/feedback'
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    message: `Cannot ${req.method} ${req.originalUrl}`,
    service: 'Admin Backend'
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Admin Backend Error:', error);
  
  if (error.name === 'ValidationError') {
    const errors = Object.values(error.errors).map(err => err.message);
    return res.status(400).json({ success: false, message: errors.join(', ') });
  }
  
  if (error.code === 11000) {
    const field = Object.keys(error.keyValue)[0];
    return res.status(409).json({ success: false, message: `A ${field} already exists.` });
  }
  
  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Invalid authentication token.' });
  }
  
  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Your session has expired. Please login again.' });
  }
  
  res.status(500).json({
    success: false,
    message: 'An internal server error occurred.',
    ...(process.env.NODE_ENV === 'development' && { error: error.message, stack: error.stack })
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 Admin Backend running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
  console.log(`\n${signal} received. Shutting down Admin Backend gracefully...`);
  server.close(() => {
    console.log('Admin Backend HTTP server closed.');
    mongoose.connection.close(false, () => {
      console.log('Admin Backend MongoDB connection closed.');
      process.exit(0);
    });
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = app;