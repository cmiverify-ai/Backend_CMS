const express = require('express');
const { body, query, validationResult } = require('express-validator');
const News = require('../models/News');
const Video = require('../models/Video');
const User = require('../models/User');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const router = express.Router();

// Apply auth and admin middleware to all admin routes
router.use(authMiddleware);
router.use(adminMiddleware);

// @route   GET /api/admin/dashboard
// @desc    Get dashboard statistics
// @access  Private (Admin only)
router.get('/dashboard', async (req, res, next) => {
  try {
    const [
      totalNews,
      totalVideos,
      totalUsers,
      recentNews,
      recentVideos,
      newsStats,
      videoStats
    ] = await Promise.all([
      News.countDocuments(),
      Video.countDocuments(),
      User.countDocuments({ role: 'user' }),
      News.find().sort({ createdAt: -1 }).limit(5).select('title category createdAt views').lean(),
      Video.find().sort({ createdAt: -1 }).limit(5).select('title createdAt views').lean(),
      News.aggregate([
        { $group: { _id: null, totalViews: { $sum: '$views' }, totalShares: { $sum: '$shares' } } }
      ]),
      Video.aggregate([
        { $group: { _id: null, totalViews: { $sum: '$views' }, totalShares: { $sum: '$shares' }, totalLikes: { $sum: '$likes' } } }
      ])
    ]);

    const totalViews = (newsStats[0]?.totalViews || 0) + (videoStats[0]?.totalViews || 0);
    const totalShares = (newsStats[0]?.totalShares || 0) + (videoStats[0]?.totalShares || 0);
    const totalLikes = videoStats[0]?.totalLikes || 0;

    res.json({
      success: true,
      data: {
        overview: { totalNews, totalVideos, totalUsers, totalViews, totalShares, totalLikes },
        recentContent: { news: recentNews, videos: recentVideos }
      }
    });

  } catch (error) {
    next(error);
  }
});
const validateUserQuery = [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('role').optional().isIn(['user', 'admin', 'super_admin']),
    query('status').optional().isIn(['active', 'inactive', 'suspended']),
    query('search').optional().trim().escape()
];

// @route   GET /api/admin/analytics
// @desc    Get detailed analytics
// @access  Private (Admin only)
router.get('/analytics', [
  query('period').optional().isIn(['7', '30', '90', '365']).withMessage('Invalid period'),
  query('type').optional().isIn(['news', 'videos', 'users']).withMessage('Invalid type')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { period = '30', type = 'all' } = req.query;
    const days = parseInt(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    let analytics = {};

    if (type === 'news' || type === 'all') {
      // News analytics
      const newsAnalytics = await News.aggregate([
        {
          $facet: {
            totalStats: [
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  published: {
                    $sum: { $cond: [{ $eq: ['$status', 'published'] }, 1, 0] }
                  },
                  totalViews: { $sum: '$views' },
                  totalShares: { $sum: '$shares' }
                }
              }
            ],
            categoryBreakdown: [
              { $match: { status: 'published' } },
              {
                $group: {
                  _id: '$category',
                  count: { $sum: 1 },
                  views: { $sum: '$views' },
                  shares: { $sum: '$shares' }
                }
              },
              { $sort: { count: -1 } }
            ],
            dailyStats: [
              { $match: { createdAt: { $gte: startDate } } },
              {
                $group: {
                  _id: {
                    $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
                  },
                  count: { $sum: 1 },
                  published: {
                    $sum: { $cond: [{ $eq: ['$status', 'published'] }, 1, 0] }
                  }
                }
              },
              { $sort: { _id: 1 } }
            ]
          }
        }
      ]);

      analytics.news = newsAnalytics[0];
    }

    if (type === 'videos' || type === 'all') {
      // Video analytics
      const videoAnalytics = await Video.aggregate([
        {
          $facet: {
            totalStats: [
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  published: {
                    $sum: { $cond: [{ $eq: ['$status', 'published'] }, 1, 0] }
                  },
                  totalViews: { $sum: '$views' },
                  totalShares: { $sum: '$shares' },
                  totalLikes: { $sum: '$likes' }
                }
              }
            ],
            categoryBreakdown: [
              { $match: { status: 'published' } },
              {
                $group: {
                  _id: '$category',
                  count: { $sum: 1 },
                  views: { $sum: '$views' },
                  shares: { $sum: '$shares' },
                  likes: { $sum: '$likes' }
                }
              },
              { $sort: { count: -1 } }
            ],
            dailyStats: [
              { $match: { createdAt: { $gte: startDate } } },
              {
                $group: {
                  _id: {
                    $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
                  },
                  count: { $sum: 1 },
                  published: {
                    $sum: { $cond: [{ $eq: ['$status', 'published'] }, 1, 0] }
                  }
                }
              },
              { $sort: { _id: 1 } }
            ]
          }
        }
      ]);

      analytics.videos = videoAnalytics[0];
    }

    if (type === 'users' || type === 'all') {
      // User analytics
      const userAnalytics = await User.aggregate([
        {
          $facet: {
            totalStats: [
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  active: {
                    $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
                  },
                  verified: {
                    $sum: { $cond: ['$emailVerified', 1, 0] }
                  }
                }
              }
            ],
            roleBreakdown: [
              {
                $group: {
                  _id: '$role',
                  count: { $sum: 1 }
                }
              }
            ],
            dailyRegistrations: [
              { $match: { createdAt: { $gte: startDate } } },
              {
                $group: {
                  _id: {
                    $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
                  },
                  count: { $sum: 1 }
                }
              },
              { $sort: { _id: 1 } }
            ]
          }
        }
      ]);

      analytics.users = userAnalytics[0];
    }

    res.json({
      success: true,
      data: {
        analytics,
        period: days,
        type,
        generatedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/admin/users
// @desc    Get all users with pagination
// @access  Private (Admin only)
router.get('/users', validateUserQuery, async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }
  
      const { page = 1, limit = 20, role, status, search, sort = 'createdAt', order = 'desc' } = req.query;
  
      const query = {};
      if (role) query.role = role;
      if (status) query.status = status;
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ];
      }
  
      const skip = (page - 1) * limit;
      const sortObj = { [sort]: order === 'desc' ? -1 : 1 };
  
      const [users, total] = await Promise.all([
        User.find(query).sort(sortObj).skip(skip).limit(limit).select('-password').lean(),
        User.countDocuments(query)
      ]);
  
      res.json({
        success: true,
        data: {
          users,
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            totalUsers: total,
          }
        }
      });
  
    } catch (error) {
      next(error);
    }
  });
  

// Validation for status update
const validateStatusUpdate = [
    body('status').isIn(['active', 'inactive', 'suspended']).withMessage('Invalid status value')
];

// @route   PUT /api/admin/users/:id/status
// @desc    Update user status
// @access  Private (Admin only)
router.put('/users/:id/status', validateStatusUpdate, async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }
  
      const { id } = req.params;
      const { status } = req.body;
  
      const user = await User.findByIdAndUpdate(id, { status }, { new: true, runValidators: true }).select('-password');
  
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
  
      res.json({ success: true, message: 'User status updated successfully', data: { user } });
  
    } catch (error) {
        next(error)
    }
  });

// @route   GET /api/admin/content-stats
// @desc    Get content statistics
// @access  Private (Admin only)
router.get('/content-stats', async (req, res) => {
  try {
    const { period = '30' } = req.query;
    const days = parseInt(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get top performing content
    const [topNews, topVideos] = await Promise.all([
      News.find({ status: 'published' })
        .sort({ views: -1, shares: -1 })
        .limit(10)
        .select('title views shares createdAt category')
        .lean(),
      Video.find({ status: 'published' })
        .sort({ views: -1, likes: -1 })
        .limit(10)
        .select('title views likes shares createdAt category duration')
        .lean()
    ]);

    // Get engagement metrics
    const engagementStats = await Promise.all([
      News.aggregate([
        { $match: { status: 'published', createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: null,
            avgViews: { $avg: '$views' },
            avgShares: { $avg: '$shares' },
            totalEngagement: { $sum: { $add: ['$views', '$shares'] } }
          }
        }
      ]),
      Video.aggregate([
        { $match: { status: 'published', createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: null,
            avgViews: { $avg: '$views' },
            avgLikes: { $avg: '$likes' },
            avgShares: { $avg: '$shares' },
            totalEngagement: { $sum: { $add: ['$views', '$likes', '$shares'] } }
          }
        }
      ])
    ]);

    res.json({
      success: true,
      data: {
        topPerforming: {
          news: topNews,
          videos: topVideos
        },
        engagement: {
          news: engagementStats[0][0] || {},
          videos: engagementStats[1][0] || {}
        },
        period: days
      }
    });

  } catch (error) {
    console.error('Content stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch content statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/admin/profile
// @desc    Get logged-in admin details
// @access  Private (Admin only)
router.get('/profile', async (req, res, next) => {
  try {
    // authMiddleware se req.user._id milta hai
    const admin = await User.findById(req.user._id).select('-password');

    if (!admin) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }

    res.json({
      success: true,
      data: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        status: admin.status,
        createdAt: admin.createdAt
      }
    });
  } catch (error) {
    next(error);
  }
});


module.exports = router;
