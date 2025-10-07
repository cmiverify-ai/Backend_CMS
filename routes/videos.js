const express = require('express');
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const Video = require('../models/Video');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const router = express.Router();

// Apply authentication and admin middleware to all routes
router.use(authMiddleware);
router.use(adminMiddleware);

// --- Validation Middleware ---
const validateVideo = [
  body('title').trim().isLength({ min: 5, max: 200 }).withMessage('Title must be between 5 and 200 characters'),
  body('youtubeUrl').isURL().withMessage('Please provide a valid YouTube URL'),
  body('category').isIn(['News', 'Analysis', 'Interview', 'Documentary', 'Live', 'Entertainment']).withMessage('Invalid category'),
  body('status').optional().isIn(['published', 'draft']).withMessage('Status must be either published or draft'),
  body('description').optional().trim().isLength({ max: 1000 }).withMessage('Description cannot exceed 1000 characters')
];

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
  }
  next();
};

// Helper function to extract YouTube ID
const extractYouTubeId = (url) => {
  const patterns = [
    /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
};

// --- ADMIN CRUD ROUTES ---

// GET all videos (including drafts)
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, category, status, search, sort = 'createdAt', order = 'desc' } = req.query;
    let query = {};

    // Admin can see all statuses
    if (status && status !== 'all') {
      query.status = status;
    }

    if (category && category !== 'all') {
      query.category = category;
    }

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (page - 1) * limit;
    const sortObj = { [sort]: order === 'desc' ? -1 : 1 };

    const [videos, total] = await Promise.all([
      Video.find(query)
        .sort(sortObj)
        .skip(skip)
        .limit(parseInt(limit))
        .populate('createdBy', 'name email')
        .lean(),
      Video.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: {
        videos,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalVideos: total
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET a single video by ID (including drafts)
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid video ID' });
    }

    const video = await Video.findById(id)
      .populate('createdBy', 'name email')
      .lean();
    
    if (!video) {
      return res.status(404).json({ success: false, message: 'Video not found' });
    }

    res.json({ success: true, data: { video } });
  } catch (error) {
    next(error);
  }
});

// POST fetch YouTube data
router.post('/fetch-youtube-data', [
  body('youtubeUrl').isURL().withMessage('A valid YouTube URL is required')
], handleValidationErrors, async (req, res, next) => {
  try {
    const { youtubeUrl } = req.body;
    const youtubeId = extractYouTubeId(youtubeUrl);
    
    if (!youtubeId) {
      return res.status(400).json({
        success: false,
        message: 'Could not extract a valid YouTube ID from the URL.'
      });
    }

    // Mock YouTube API response for demonstration
    // In production, integrate with YouTube Data API v3
    const mockVideoData = {
      title: `Sample Video ${youtubeId}`,
      description: `This is a sample description fetched for video ID: ${youtubeId}`,
      thumbnailUrl: `https://img.youtube.com/vi/${youtubeId}/maxresdefault.jpg`,
      duration: `${Math.floor(Math.random() * 50 + 5)}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}`
    };

    res.json({
      success: true,
      message: 'Video data fetched successfully',
      data: { ...mockVideoData, youtubeId }
    });
  } catch (error) {
    next(error);
  }
});

// POST create new video
router.post('/', validateVideo, handleValidationErrors, async (req, res, next) => {
  try {
    const youtubeId = extractYouTubeId(req.body.youtubeUrl);
    
    if (!youtubeId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid YouTube URL provided.'
      });
    }

    // Check if video with this YouTube ID already exists
    const existingVideo = await Video.findOne({ youtubeId });
    if (existingVideo) {
      return res.status(409).json({
        success: false,
        message: 'A video with this YouTube ID already exists.'
      });
    }

    const videoData = {
      ...req.body,
      youtubeId,
      createdBy: req.user.userId
    };
    
    const video = new Video(videoData);
    await video.save();
    await video.populate('createdBy', 'name email');

    res.status(201).json({
      success: true,
      message: 'Video created successfully',
      data: { video }
    });
  } catch (error) {
    next(error);
  }
});

// PUT update video
router.put('/:id', validateVideo, handleValidationErrors, async (req, res, next) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid video ID' });
    }

    const updateData = { ...req.body };
    
    if (updateData.youtubeUrl) {
      const youtubeId = extractYouTubeId(updateData.youtubeUrl);
      if (!youtubeId) {
        return res.status(400).json({
          success: false,
          message: 'Invalid YouTube URL provided.'
        });
      }
      updateData.youtubeId = youtubeId;
    }

    const video = await Video.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate('createdBy', 'name email');

    if (!video) {
      return res.status(404).json({ success: false, message: 'Video not found' });
    }

    res.json({
      success: true,
      message: 'Video updated successfully',
      data: { video }
    });
  } catch (error) {
    next(error);
  }
});

// PATCH update video status only
router.patch('/:id/status', [
  body('status').isIn(['published', 'draft']).withMessage('Invalid status')
], handleValidationErrors, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid video ID' });
    }

    const video = await Video.findByIdAndUpdate(
      id,
      { status },
      { new: true, runValidators: true }
    ).populate('createdBy', 'name email');

    if (!video) {
      return res.status(404).json({ success: false, message: 'Video not found' });
    }

    res.json({
      success: true,
      message: `Video ${status === 'published' ? 'published' : 'saved as draft'} successfully`,
      data: { video }
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
      return res.status(400).json({ success: false, message: 'Invalid video ID' });
    }

    const video = await Video.findById(id);
    if (!video) {
      return res.status(404).json({ success: false, message: 'Video not found' });
    }

    video.featured = !video.featured;
    await video.save();
    await video.populate('createdBy', 'name email');

    res.json({
      success: true,
      message: `Video ${video.featured ? 'marked as featured' : 'unmarked from featured'}`,
      data: { video }
    });
  } catch (error) {
    next(error);
  }
});

// DELETE a video
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid video ID' });
    }

    const video = await Video.findByIdAndDelete(id);
    
    if (!video) {
      return res.status(404).json({ success: false, message: 'Video not found' });
    }

    res.json({
      success: true,
      message: 'Video deleted successfully',
      data: { deletedId: id }
    });
  } catch (error) {
    next(error);
  }
});

// DELETE multiple videos
router.post('/bulk-delete', [
  body('ids').isArray().withMessage('IDs must be an array'),
  body('ids.*').isMongoId().withMessage('Invalid video ID in array')
], handleValidationErrors, async (req, res, next) => {
  try {
    const { ids } = req.body;

    const result = await Video.deleteMany({ _id: { $in: ids } });

    res.json({
      success: true,
      message: `${result.deletedCount} video(s) deleted successfully`,
      data: { deletedCount: result.deletedCount }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;