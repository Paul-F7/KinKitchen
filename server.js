require('dotenv').config();
const express = require('express');
const fs = require('fs');
const multer = require('multer');
const { upload: uploadToCloudinary } = require('./services/cloudinary');
const { analyzeImageContent } = require('./services/cloudinary-analysis');
const { analyzeMedia } = require('./services/gemini');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = 'uploads';
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const multerUpload = multer({ dest: `${UPLOAD_DIR}/`, limits: { fileSize: 100 * 1024 * 1024 } });

app.use(express.static('public'));

app.post('/api/upload', multerUpload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  try {
    const { url, publicId } = await uploadToCloudinary(req.file.path);
    fs.unlink(req.file.path, () => {});

    const mediaType = (req.file.mimetype || '').startsWith('video/') ? 'video' : 'image';
    let analysis = null;
    let analysisError = null;
    try {
      analysis = await analyzeMedia(url, mediaType);
    } catch (err) {
      analysisError = err.message || 'Analysis failed';
    }

    let contentAnalysis = null;
    if (mediaType === 'image') {
      try {
        contentAnalysis = await analyzeImageContent(url);
      } catch (err) {
        contentAnalysis = { error: err.message || 'Content analysis failed' };
      }
    }

    res.json({ url, publicId, mediaType, analysis, analysisError, contentAnalysis });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
