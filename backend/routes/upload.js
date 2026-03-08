const express  = require('express');
const multer   = require('multer');
const fs       = require('fs');
const path     = require('path');
const { upload: uploadToCloudinary } = require('../services/cloudinary');
const { analyzeImageContent }        = require('../services/cloudinary-analysis');
const { analyzeMedia }               = require('../services/gemini');
const { matchRecipes }               = require('../services/recipe-matcher');

// ── Constants ────────────────────────────────────────────────────────────────
const UPLOAD_DIR         = path.join(__dirname, '..', 'uploads');
const MAX_FILE_MB        = 100;
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4',  'video/quicktime', 'video/webm',
]);

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── Multer ───────────────────────────────────────────────────────────────────
const multerUpload = multer({
  dest:   `${UPLOAD_DIR}/`,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: JPEG, PNG, WEBP, GIF, MP4, MOV, WEBM.`));
    }
  },
});

// ── Hardcoded demo presets ───────────────────────────────────────────────────
const DEMO_PRESETS = {
  threesisters: {
    ingredients: ['butternut-squash', 'canned-beans', 'canned-corn', 'chicken-stock', 'onion', 'garlic'],
    caption: 'Three Sisters: butternut squash, canned beans, canned corn, chicken stock, onion, and garlic',
  },
};

function getDemoPreset(filename) {
  const name = path.parse(filename).name.toLowerCase();
  return DEMO_PRESETS[name] || null;
}

const router = express.Router();

// ── POST / ───────────────────────────────────────────────────────────────────
router.post('/', multerUpload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const localPath = req.file.path;
  const cleanup   = () => fs.unlink(localPath, () => {});

  // Check for hardcoded demo preset based on filename
  const preset = getDemoPreset(req.file.originalname);
  if (preset) {
    try {
      const { url, publicId, thumbnailUrl, posterUrl } = await uploadToCloudinary(localPath);
      cleanup();
      const contentAnalysis = {
        caption: preset.caption,
        foodDetected: preset.ingredients.map(i => ({ label: i, confidence: 1, boundingBox: null })),
        error: null,
      };
      const suggestedRecipes = matchRecipes(preset.ingredients, { minScore: 0.15, maxResults: 16 });
      return res.json({
        url,
        publicId,
        thumbnailUrl,
        posterUrl,
        mediaType: 'image',
        analysis: null,
        analysisError: null,
        contentAnalysis,
        boundingBoxes: [],
        suggestedRecipes,
      });
    } catch (err) {
      cleanup();
      console.error('[upload] Preset upload error:', err.message);
      return res.status(500).json({ error: err.message || 'Upload failed.' });
    }
  }

  try {
    // 1. Upload to Cloudinary (also triggers LVIS detection)
    const { url, publicId, boundingBoxes, thumbnailUrl, posterUrl } = await uploadToCloudinary(localPath);
    cleanup();

    const mediaType = (req.file.mimetype || '').startsWith('video/') ? 'video' : 'image';

    // 2. Gemini analysis
    let analysis      = null;
    let analysisError = null;
    try {
      analysis = await analyzeMedia(url, mediaType);
    } catch (err) {
      analysisError = err.message || 'Gemini analysis failed';
      console.error('[upload] Gemini error:', err.message);
    }

    // 3. Cloudinary captioning (images only, best-effort — 429 is non-fatal)
    let contentAnalysis = null;
    if (mediaType === 'image') {
      try {
        contentAnalysis = await analyzeImageContent(url);
      } catch (err) {
        // Never let content analysis failure break the upload
        contentAnalysis = { caption: null, foodDetected: [], error: err.message || 'Content analysis failed' };
        console.warn('[upload] Content analysis skipped:', err.message);
      }
    }

    // 4. Match detected ingredients to Indigenous recipes dataset
    const ingredients = [];
    if (contentAnalysis?.foodDetected?.length) {
      contentAnalysis.foodDetected.forEach(x =>
        ingredients.push(typeof x === 'string' ? x : x?.label)
      );
    }
    if (boundingBoxes?.length) {
      boundingBoxes.forEach(b => b.name && ingredients.push(b.name));
    }
    const suggestedRecipes = matchRecipes(ingredients, { minScore: 0.15, maxResults: 16 });

    return res.json({
      url,
      publicId,
      thumbnailUrl,
      posterUrl,
      mediaType,
      analysis,
      analysisError,
      contentAnalysis,
      boundingBoxes,
      suggestedRecipes,
    });

  } catch (err) {
    cleanup();
    console.error('[upload] Fatal error:', err.message);
    return res.status(500).json({ error: err.message || 'Upload failed. Please try again.' });
  }
});

// ── Multer error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
router.use((err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `File too large. Maximum size is ${MAX_FILE_MB} MB.` });
  }
  return res.status(400).json({ error: err.message || 'Upload error.' });
});

module.exports = router;
