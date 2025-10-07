const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRE = process.env.JWT_EXPIRE || '7d';

// Generate JWT Token
const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRE }
  );
};

// Validation middleware
const validateLogin = [
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
  body('password').notEmpty().withMessage('Password is required')
];

// @route   POST /api/auth/login
// @desc    Admin login
// @access  Public
router.post('/login', validateLogin, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email, password } = req.body;

    // Find user and include password
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if user is admin or super_admin
    if (!['admin', 'super_admin'].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.'
      });
    }

    // Check if account is locked
    if (user.isLocked) {
      return res.status(423).json({
        success: false,
        message: 'Account is temporarily locked due to too many failed login attempts.'
      });
    }

    // Check if account is active
    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Your account is not active. Please contact support.'
      });
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      await user.incLoginAttempts();
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Reset login attempts on successful login
    await user.resetLoginAttempts();

    // Generate token
    const token = generateToken(user);

    // Update last login
    user.lastLogin = new Date();
    user.analytics.lastActiveAt = new Date();
    await user.save();

    // Send response
    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
          avatar: user.avatar,
          lastLogin: user.lastLogin
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/auth/me
// @desc    Get current admin profile
// @access  Private (Admin only)
router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update last active time
    user.analytics.lastActiveAt = new Date();
    await user.save();

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
          avatar: user.avatar,
          createdAt: user.createdAt,
          lastLogin: user.lastLogin
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/auth/change-password
// @desc    Change password for logged-in admin
// @access  Private (Admin only)
router.post('/change-password', authMiddleware, [
  body('oldPassword').notEmpty().withMessage('Old password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters long')
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { oldPassword, newPassword } = req.body;

    // Find user with password
    const user = await User.findById(req.user.userId).select('+password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify old password
    const isMatch = await user.comparePassword(oldPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Old password is incorrect'
      });
    }

    // Set new password (pre-save middleware will hash it)
    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/auth/logout
// @desc    Logout admin (client-side token removal)
// @access  Private
router.post('/logout', authMiddleware, (req, res) => {
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

module.exports = router;