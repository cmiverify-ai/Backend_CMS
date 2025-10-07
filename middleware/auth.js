const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Authentication middleware
const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    const token = authHeader && authHeader.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : null;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    
    if (decoded.isGuest) {
      req.user = {
        userId: decoded.userId,
        role: 'guest',
        isGuest: true
      };
      return next();
    }

    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Token is not valid. User not found.'
      });
    }

    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Account is not active. Please contact support.'
      });
    }

    if (user.isLocked) {
      return res.status(423).json({
        success: false,
        message: 'Account is temporarily locked.'
      });
    }

    req.user = {
      userId: user._id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      preferences: user.preferences
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired. Please login again.'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error in authentication.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Admin middleware
const adminMiddleware = (req, res, next) => {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'super_admin')) {
    return next();
  }
  return res.status(403).json({ success: false, message: 'Access denied. Admin privileges required.' });
};

// Super admin middleware
const superAdminMiddleware = (req, res, next) => {
  if (req.user && req.user.role === 'super_admin') {
    return next();
  }
  return res.status(403).json({ success: false, message: 'Access denied. Super admin privileges required.' });
};
// Optional auth middleware
const optionalAuthMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    const token = authHeader && authHeader.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : null;

    if (token) {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId).select('-password');
        if (user && user.status === 'active' && !user.isLocked) {
            req.user = {
                userId: user._id,
                email: user.email,
                name: user.name,
                role: user.role,
            };
        }
    }
    next();
  } catch (error) {
    // If token is invalid or expired, just proceed without a user
    next();
  }
};
module.exports = {
  authMiddleware,
  adminMiddleware,
  superAdminMiddleware,
  optionalAuthMiddleware,
};