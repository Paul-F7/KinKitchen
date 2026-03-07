/**
 * Cloudinary Analyze API – Content Analysis add-on.
 * Uses captioning + LVIS; returns only food items above confidence threshold with bounding boxes.
 * Requires CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.
 */

const https = require('https');

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

const MIN_CONFIDENCE = 0.6;

/** LVIS labels we treat as food/ingredients only (excludes tableware, furniture, etc.) */
const FOOD_LABELS = new Set([
  'apple', 'apricot', 'artichoke', 'asparagus', 'avocado', 'bacon', 'bagel', 'baking-powder', 'banana',
  'basil', 'bean', 'beef', 'beet', 'biscuit', 'blackberry', 'blueberry', 'bread', 'broccoli', 'burrito',
  'butter', 'cabbage', 'cake', 'candy', 'cantaloupe', 'carrot', 'cauliflower', 'celery', 'cheese',
  'cherry', 'chicken', 'chili', 'chive', 'chocolate', 'cilantro', 'cinnamon', 'coconut', 'condiment',
  'cookie', 'courgette', 'crab', 'crape', 'cream', 'cucumber', 'curry', 'custard', 'dill', 'donut',
  'dough', 'dressing', 'egg', 'eggplant', 'fish', 'flour', 'garlic', 'ginger', 'grape', 'grapefruit',
  'grits', 'guacamole', 'ham', 'honey', 'hot-dog', 'ice-cream', 'jam', 'jelly', 'kale', 'ketchup',
  'kiwi', 'lamb', 'leek', 'lemon', 'lettuce', 'lime', 'lobster', 'mango', 'maple-syrup', 'marshmallow',
  'mayonnaise', 'meat', 'melon', 'milk', 'mint', 'mushroom', 'mustard', 'noodle', 'nut', 'oatmeal',
  'oil', 'olive', 'onion', 'orange', 'oregano', 'pancake', 'pasta', 'pastry', 'pea', 'peach', 'pear',
  'pepper', 'pickle', 'pie', 'pimento', 'pineapple', 'pita', 'pizza', 'plum', 'pomegranate', 'pork',
  'potato', 'poultry', 'pudding', 'pumpkin', 'quesadilla', 'radish', 'raisin', 'raspberry', 'relish',
  'rice', 'rosemary', 'rum', 'salad', 'salmon', 'salsa', 'salt', 'sandwich', 'sauce', 'sausage',
  'scallop', 'seafood', 'sesame', 'shallot', 'soup', 'sour-cream', 'soy-sauce', 'spinach', 'squash',
  'steak', 'strawberry', 'sugar', 'sushi', 'sweet-potato', 'taco', 'tarragon', 'tea', 'thyme', 'toast',
  'tofu', 'tomato', 'tortilla', 'tuna', 'turkey', 'turnip', 'vanilla', 'vinegar', 'waffle', 'walnut',
  'watermelon', 'wine', 'yogurt', 'zucchini',
]);

function normalizeLabel(label) {
  return String(label).toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-');
}

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
    const norm = normalizeLabel(label);
    if (!FOOD_LABELS.has(norm)) continue;
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
  } catch (err) {
    result.error = err.message || 'Captioning failed';
    return result;
  }

  try {
    const lvisRes = await analyzeRequest('lvis', { source });
    result.foodDetected = extractFoodDetections(lvisRes);
  } catch {
    // lvis optional
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
