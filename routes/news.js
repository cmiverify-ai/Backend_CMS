const express = require('express');
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const News = require('../models/News');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const router = express.Router();

// Apply authentication and admin middleware to all routes
router.use(authMiddleware);
router.use(adminMiddleware);

// --- Validation Middleware ---
const validateNews = [
  body('title').trim().isLength({ min: 5, max: 200 }).withMessage('Title must be between 5 and 200 characters'),
  body('summary').trim().isLength({ min: 10, max: 500 }).withMessage('Summary must be between 10 and 500 characters'),
  body('content').trim().isLength({ min: 50 }).withMessage('Content must be at least 50 characters long'),
  body('category').isIn(['Politics', 'Technology', 'Sports', 'Entertainment', 'Business', 'Health']).withMessage('Invalid category'),
  body('imageUrl').optional({ checkFalsy: true }).isURL().withMessage('Image URL must be a valid URL'),
  body('status').optional().isIn(['published', 'draft']).withMessage('Status must be either published or draft'),
];

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
  }
  next();
};

// --- ADMIN CRUD ROUTES ---

// GET all news articles (including drafts)
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, category, status, search, sort = 'createdAt', order = 'desc' } = req.query;
    let queryOptions = {};

    // Admin can see all statuses
    if (status && status !== 'all') {
      queryOptions.status = status;
    }

    if (category && category !== 'all') {
      queryOptions.category = category;
    }

    if (search) {
      queryOptions.$or = [
        { title: { $regex: search, $options: 'i' } },
        { summary: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (page - 1) * limit;
    const sortObj = { [sort]: order === 'desc' ? -1 : 1 };

    const [articles, total] = await Promise.all([
      News.find(queryOptions)
        .sort(sortObj)
        .skip(skip)
        .limit(parseInt(limit))
        .populate('createdBy', 'name email')
        .lean(),
      News.countDocuments(queryOptions)
    ]);

    res.json({
      success: true,
      data: {
        articles,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalArticles: total
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET a single news article by ID (including drafts)
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid news ID' });
    }

    const article = await News.findById(id)
      .populate('createdBy', 'name email')
      .lean();
    
    if (!article) {
      return res.status(404).json({ success: false, message: 'News article not found' });
    }

    res.json({ success: true, data: { article } });
  } catch (error) {
    next(error);
  }
});

// POST create a new article
router.post('/', validateNews, handleValidationErrors, async (req, res, next) => {
  try {
    const articleData = {
      ...req.body,
      createdBy: req.user.userId
    };
    
    const article = new News(articleData);
    await article.save();
    await article.populate('createdBy', 'name email');

    res.status(201).json({
      success: true,
      message: 'Article created successfully',
      data: { article }
    });
  } catch (error) {
    next(error);
  }
});

// PUT update an article
router.put('/:id', validateNews, handleValidationErrors, async (req, res, next) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid article ID' });
    }

    const article = await News.findByIdAndUpdate(
      id,
      req.body,
      { new: true, runValidators: true }
    ).populate('createdBy', 'name email');

    if (!article) {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }

    res.json({
      success: true,
      message: 'Article updated successfully',
      data: { article }
    });
  } catch (error) {
    next(error);
  }
});

// PATCH update article status only
router.patch('/:id/status', [
  body('status').isIn(['published', 'draft']).withMessage('Invalid status')
], handleValidationErrors, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid article ID' });
    }

    const article = await News.findByIdAndUpdate(
      id,
      { status },
      { new: true, runValidators: true }
    ).populate('createdBy', 'name email');

    if (!article) {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }

    res.json({
      success: true,
      message: `Article ${status === 'published' ? 'published' : 'saved as draft'} successfully`,
      data: { article }
    });
  } catch (error) {
    next(error);
  }
});

// PATCH toggle featured status
router.patch('/:id/featured', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid article ID' });
    }

    const article = await News.findById(id);
    if (!article) {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }

    article.featured = !article.featured;
    await article.save();
    await article.populate('createdBy', 'name email');

    res.json({
      success: true,
      message: `Article ${article.featured ? 'marked as featured' : 'unmarked from featured'}`,
      data: { article }
    });
  } catch (error) {
    next(error);
  }
});

// DELETE an article
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid news ID' });
    }

    const article = await News.findByIdAndDelete(id);
    
    if (!article) {
      return res.status(404).json({ success: false, message: 'News article not found' });
    }

    res.json({
      success: true,
      message: 'Article deleted successfully',
      data: { deletedId: id }
    });
  } catch (error) {
    next(error);
  }
});

// DELETE multiple articles
router.post('/bulk-delete', [
  body('ids').isArray().withMessage('IDs must be an array'),
  body('ids.*').isMongoId().withMessage('Invalid article ID in array')
], handleValidationErrors, async (req, res, next) => {
  try {
    const { ids } = req.body;

    const result = await News.deleteMany({ _id: { $in: ids } });

    res.json({
      success: true,
      message: `${result.deletedCount} article(s) deleted successfully`,
      data: { deletedCount: result.deletedCount }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;