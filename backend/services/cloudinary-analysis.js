/**
 * Cloudinary Analyze API – Content Analysis add-on.
 * Uses captioning + LVIS; returns only food items above confidence threshold with bounding boxes.
 * Requires CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.
 */

const https = require('https');
const { isFoodLabel, MIN_CONFIDENCE, normalizeLabel } = require('./food-filter');

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

function analyzeRequest(model, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
    const options = {
      hostname: 'api.cloudinary.com',
      path: `/v2/analysis/${cloudName}/analyze/${model}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        Authorization: `Basic ${auth}`,
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (ch) => { data += ch; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(json.error?.message || json.message || `Analyze API ${res.statusCode}: ${data}`));
            return;
          }
          resolve(json);
        } catch (e) {
          reject(new Error(`Analyze API response parse error: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Extract food-only detections with confidence >= MIN_CONFIDENCE and bounding boxes.
 * Returns [{ label, confidence, boundingBox: [x, y, w, h] }, ...].
 */
function extractFoodDetections(lvisData) {
  const out = [];
  const analysis = lvisData?.data?.analysis;
  const tags = analysis?.tags ?? analysis?.data?.tags;
  if (!tags || typeof tags !== 'object') return out;

  for (const [label, items] of Object.entries(tags)) {
    if (!isFoodLabel(label)) continue;
    const list = Array.isArray(items) ? items : (items && items.detections) ? items.detections : [];
    for (const item of list) {
      const conf = item?.confidence ?? item?.score;
      if (conf == null || conf < MIN_CONFIDENCE) continue;
      const bbox = item?.['bounding-box'] ?? item?.bounding_box ?? item?.boundingBox;
      const arr = Array.isArray(bbox) && bbox.length >= 4 ? bbox : null;
      out.push({
        label: label.replace(/-/g, ' '),
        confidence: Math.round(conf * 100) / 100,
        boundingBox: arr,
      });
    }
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Run content analysis on an image URL.
 * Returns { caption, foodDetected: [{ label, confidence, boundingBox }], error }.
 */
/**
 * Only calls captioning — LVIS bounding boxes are already returned during
 * upload via detection:'lvis', so calling it again here was a duplicate that
 * doubled rate-limit consumption. Captioning is best-effort: if we hit a 429
 * we return gracefully so the rest of the upload pipeline still works.
 */
async function analyzeImageContent(imageUrl) {
  if (!cloudName || !apiKey || !apiSecret) {
    return { caption: null, foodDetected: [], error: 'Cloudinary credentials not configured' };
  }

  const source = { uri: imageUrl };
  const result = { caption: null, foodDetected: [], error: null };

  try {
    const captionRes = await analyzeRequest('captioning', { source });
    const capData = captionRes?.data?.analysis?.data;
    if (capData?.caption) result.caption = capData.caption;
    console.log('[cloudinary] Caption:', result.caption);
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('429') || /rate.?limit/i.test(msg)) {
      console.warn('[cloudinary] Captioning rate-limited — skipping, continuing upload');
    } else {
      console.error('[cloudinary] Captioning error:', msg);
    }
    // Non-fatal — return what we have (no caption) so the rest of the pipeline works
    result.error = msg;
  }

  return result;
}

function getContentAnalysisText(analysis) {
  if (!analysis) return null;
  if (analysis.error) return `Content analysis: ${analysis.error}`;
  const parts = [];
  if (analysis.foodDetected?.length) {
    parts.push(`Food detected: ${analysis.foodDetected.map((f) => `${f.label} (${(f.confidence * 100).toFixed(0)}%)`).join(', ')}.`);
  }
  if (analysis.caption) parts.push(analysis.caption);
  return parts.length ? parts.join(' ') : null;
}

module.exports = { analyzeImageContent, getContentAnalysisText };
