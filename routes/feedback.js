const express = require('express');
const { query, validationResult } = require('express-validator');
const Feedback = require('../models/Feedback');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const router = express.Router();

// Apply authentication and admin middleware to all routes
router.use(authMiddleware);
router.use(adminMiddleware);

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

// @route   GET /api/feedback
// @desc    Get all feedback with pagination and filters
// @access  Private (Admin only)
router.get('/', [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('rating').optional().isInt({ min: 1, max: 5 }).toInt(),
  query('sort').optional().isIn(['createdAt', 'rating', 'feedback']),
  query('order').optional().isIn(['asc', 'desc'])
], handleValidationErrors, async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      rating,
      sort = 'createdAt',
      order = 'desc',
      search
    } = req.query;

    let query = {};

    // Filter by rating if provided
    if (rating) {
      query.rating = parseInt(rating);
    }

    // Search in feedback text
    if (search) {
      query.feedback = { $regex: search, $options: 'i' };
    }

    const skip = (page - 1) * limit;
    const sortObj = { [sort]: order === 'desc' ? -1 : 1 };

    const [feedbacks, total, stats] = await Promise.all([
      Feedback.find(query)
        .sort(sortObj)
        .skip(skip)
        .limit(parseInt(limit))
        .populate('user', 'name email')
        .lean(),
      Feedback.countDocuments(query),
      Feedback.aggregate([
        {
          $group: {
            _id: null,
            avgRating: { $avg: '$rating' },
            totalFeedback: { $sum: 1 },
            ratingDistribution: {
              $push: '$rating'
            }
          }
        }
      ])
    ]);

    // Calculate rating distribution
    let ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    if (stats[0] && stats[0].ratingDistribution) {
      stats[0].ratingDistribution.forEach(rating => {
        if (rating) ratingDistribution[rating]++;
      });
    }

    res.json({
      success: true,
      data: {
        feedbacks,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalFeedback: total
        },
        stats: {
          averageRating: stats[0]?.avgRating?.toFixed(2) || 0,
          totalFeedback: stats[0]?.totalFeedback || 0,
          ratingDistribution
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/feedback/:id
// @desc    Get single feedback by ID
// @access  Private (Admin only)
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const feedback = await Feedback.findById(id)
      .populate('user', 'name email phone createdAt')
      .lean();

    if (!feedback) {
      return res.status(404).json({
        success: false,
        message: 'Feedback not found'
      });
    }

    res.json({
      success: true,
      data: { feedback }
    });
  } catch (error) {
    next(error);
  }
});

// @route   DELETE /api/feedback/:id
// @desc    Delete feedback
// @access  Private (Admin only)
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const feedback = await Feedback.findByIdAndDelete(id);

    if (!feedback) {
      return res.status(404).json({
        success: false,
        message: 'Feedback not found'
      });
    }

    res.json({
      success: true,
      message: 'Feedback deleted successfully',
      data: { deletedId: id }
    });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/feedback/stats/summary
// @desc    Get feedback statistics summary
// @access  Private (Admin only)
router.get('/stats/summary', async (req, res, next) => {
  try {
    const { days = 30 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const [recentStats, overallStats, trendData] = await Promise.all([
      // Recent feedback stats
      Feedback.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            avgRating: { $avg: '$rating' },
            ratings: { $push: '$rating' }
          }
        }
      ]),
      // Overall stats
      Feedback.aggregate([
        {
          $group: {
            _id: null,
            totalCount: { $sum: 1 },
            overallAvgRating: { $avg: '$rating' }
          }
        }
      ]),
      // Trend data - feedback per day
      Feedback.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
            },
            count: { $sum: 1 },
            avgRating: { $avg: '$rating' }
          }
        },
        { $sort: { _id: 1 } }
      ])
    ]);

    // Calculate rating distribution for recent feedback
    let ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    if (recentStats[0] && recentStats[0].ratings) {
      recentStats[0].ratings.forEach(rating => {
        if (rating) ratingDistribution[rating]++;
      });
    }

    res.json({
      success: true,
      data: {
        period: `Last ${days} days`,
        recent: {
          count: recentStats[0]?.count || 0,
          averageRating: recentStats[0]?.avgRating?.toFixed(2) || 0,
          ratingDistribution
        },
        overall: {
          totalCount: overallStats[0]?.totalCount || 0,
          averageRating: overallStats[0]?.overallAvgRating?.toFixed(2) || 0
        },
        trend: trendData
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;