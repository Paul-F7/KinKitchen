/* global CookingAR, escapeHtml */
'use strict';

// ── Main render entry ────────────────────────────────────────────────────────
function renderAnalysis(data) {
  const ingredients = collectIngredients(data);
  const summary     = data.analysis?.summary || '';
  const indigenous  = data.analysis?.indigenousContext || null;
  const recipes     = data.analysis?.recipes || [];
  const nutrition   = data.analysis?.nutritionNotes || null;

  return `
    <div class="result-card" role="region" aria-label="Analysis results">

      <div class="result-media">

        <!-- Left: uploaded photo -->
        <div class="result-photo">
          <img
            id="ar-image"
            src="${escapeHtml(data.url)}"
            crossorigin="anonymous"
            alt="Uploaded ingredient photo"
            loading="eager"
          />
          <span class="result-photo__label">Your photo</span>
        </div>

        <!-- Right: 3D viewer -->
        <div class="ar-viewer" id="ar-wrapper" aria-label="3D ingredient preview">
          <span class="ar-viewer__label">3D Preview</span>
          <div class="ar-loading" id="ar-loading">
            <div class="spinner"></div>
            Generating 3D…
          </div>
        </div>

      </div>

      ${ingredients.length ? `
      <div class="result-info">
        <p class="result-info__heading">Detected ingredients</p>
        <div class="ingredient-chips">
          ${ingredients.map(i => `
            <span class="chip">
              ${escapeHtml(i.name)}
              ${i.conf ? `<span class="chip__conf">${i.conf}%</span>` : ''}
            </span>`).join('')}
        </div>
      </div>` : ''}

      ${renderIndigenousContext(indigenous, recipes, nutrition)}

      ${renderSuggestedRecipes(data.suggestedRecipes || [])}

      ${summary ? `
      <div class="result-summary">
        <strong>AI overview —</strong> ${escapeHtml(summary)}
      </div>` : ''}

    </div>`;
}

// ── Indigenous context section ────────────────────────────────────────────────
function renderIndigenousContext(ctx, recipes, nutrition) {
  // Only render if we have at least one meaningful field
  const hasCtx      = ctx && (
    ctx.traditionalNames?.length ||
    ctx.culturalUses?.length ||
    ctx.traditionalPreparations?.length ||
    ctx.seasonality ||
    ctx.culturalSignificance
  );
  const hasRecipes   = recipes?.length > 0;
  const hasNutrition = !!nutrition;

  if (!hasCtx && !hasRecipes && !hasNutrition) return '';

  return `
    <div class="indigenous-section">
      <div class="indigenous-section__header">
        <span class="indigenous-section__icon" aria-hidden="true">🌿</span>
        <h2 class="indigenous-section__title">Indigenous Food Knowledge</h2>
      </div>

      ${hasCtx ? `
      <div class="indigenous-grid">

        ${ctx.traditionalNames?.length ? `
        <div class="ig-card">
          <p class="ig-card__label">Traditional Names</p>
          <ul class="ig-names-list">
            ${ctx.traditionalNames.map(n => `
              <li><span class="ig-nation">${escapeHtml(n.nation)}</span> — <em>${escapeHtml(n.name)}</em></li>
            `).join('')}
          </ul>
        </div>` : ''}

        ${ctx.culturalUses?.length ? `
        <div class="ig-card">
          <p class="ig-card__label">Cultural Uses</p>
          <ul class="ig-list">
            ${ctx.culturalUses.map(u => `<li>${escapeHtml(u)}</li>`).join('')}
          </ul>
        </div>` : ''}

        ${ctx.traditionalPreparations?.length ? `
        <div class="ig-card">
          <p class="ig-card__label">Traditional Preparations</p>
          <ul class="ig-list">
            ${ctx.traditionalPreparations.map(p => `<li>${escapeHtml(p)}</li>`).join('')}
          </ul>
        </div>` : ''}

        ${ctx.seasonality ? `
        <div class="ig-card ig-card--inline">
          <p class="ig-card__label">Seasonality</p>
          <p class="ig-card__text">${escapeHtml(ctx.seasonality)}</p>
        </div>` : ''}

        ${ctx.culturalSignificance ? `
        <div class="ig-card ig-card--inline ig-card--significance">
          <p class="ig-card__label">Cultural Significance</p>
          <p class="ig-card__text">${escapeHtml(ctx.culturalSignificance)}</p>
        </div>` : ''}

      </div>` : ''}

      ${hasRecipes ? `
      <div class="ig-recipes">
        <p class="ig-card__label">Traditional Recipes</p>
        <div class="ig-recipe-list">
          ${recipes.map(r => `
            <div class="ig-recipe">
              <p class="ig-recipe__name">${escapeHtml(r.name)}</p>
              <p class="ig-recipe__desc">${escapeHtml(r.description)}</p>
            </div>
          `).join('')}
        </div>
      </div>` : ''}

      ${hasNutrition ? `
      <div class="ig-nutrition">
        <span class="ig-nutrition__icon" aria-hidden="true">🍃</span>
        <p>${escapeHtml(nutrition)}</p>
      </div>` : ''}

    </div>`;
}

// ── Indigenous recipes you can make (from dataset match) ──────────────────────
function renderSuggestedRecipes(suggestedRecipes) {
  if (!suggestedRecipes.length) return '';
  return `
    <div class="indigenous-section suggested-recipes">
      <div class="indigenous-section__header">
        <span class="indigenous-section__icon" aria-hidden="true">🍲</span>
        <h2 class="indigenous-section__title">Indigenous recipes you can make</h2>
      </div>
      <p class="suggested-recipes__intro">Based on your detected ingredients. Match = how many recipe ingredients you have.</p>
      <div class="ig-recipe-list suggested-recipes__list">
        ${suggestedRecipes.map(({ recipe, score, matchedIngredients }) => {
          const pct = Math.round(score * 100);
          const matched = (matchedIngredients || []).join(', ') || '—';
          return `
          <div class="ig-recipe suggested-recipe">
            <p class="ig-recipe__name">${escapeHtml(recipe.name)}</p>
            <p class="ig-recipe__culture">${escapeHtml(recipe.culture || '')}</p>
            <p class="ig-recipe__desc">${escapeHtml(recipe.description || '')}</p>
            <p class="suggested-recipe__match">Match: ${pct}% — ${escapeHtml(matched)}</p>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

// ── Collect + deduplicate ingredients from all sources ────────────────────────
function collectIngredients(data) {
  const seen = new Set();
  const out  = [];

  // 1. Cloudinary LVIS bounding boxes (most precise)
  for (const b of (data.boundingBoxes || [])) {
    const name = (b.name || '').toLowerCase();
    if (!seen.has(name)) {
      seen.add(name);
      out.push({ name, conf: b.confidence ? Math.round(b.confidence * 100) : null });
    }
  }

  // 2. Cloudinary content analysis food detections
  for (const f of (data.contentAnalysis?.foodDetected || [])) {
    const name = ((typeof f === 'object' ? f.label : f) || '').toLowerCase();
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push({ name, conf: f.confidence ? Math.round(f.confidence * 100) : null });
    }
  }

  // 3. Gemini detected objects
  for (const obj of (data.analysis?.detectedObjects || [])) {
    const name = (obj || '').toLowerCase();
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push({ name, conf: null });
    }
  }

  return out;
}

// ── Mount AR ──────────────────────────────────────────────────────────────────
function mountAR(data) {
  if (data.mediaType !== 'image') return;
  const wrapper = document.getElementById('ar-wrapper');
  const img     = document.getElementById('ar-image');
  if (!wrapper || !img) return;

  // Best detection: bbox → food detected → gemini object → fallback
  let detection = null;

  if (data.boundingBoxes?.length) {
    detection = data.boundingBoxes[0];
  }

  if (!detection) {
    const foods = data.contentAnalysis?.foodDetected;
    const first = Array.isArray(foods) && foods.length
      ? (typeof foods[0] === 'object' ? foods[0].label : foods[0])
      : null;
    if (first) detection = { name: first, x: 0.1, y: 0.1, w: 0.8, h: 0.8, confidence: 1 };
  }

  if (!detection) {
    const obj  = data.analysis?.detectedObjects?.[0] || 'ingredient';
    detection  = { name: obj, x: 0.1, y: 0.1, w: 0.8, h: 0.8, confidence: 1 };
  }

  // Pass Gemini Indigenous context so the storyboard overlay has real data
  const contextData = data.analysis
    ? {
        indigenousContext: data.analysis.indigenousContext || null,
        recipes:           data.analysis.recipes           || [],
        nutritionNotes:    data.analysis.nutritionNotes    || null,
      }
    : null;

  CookingAR.mount(wrapper, img, detection, contextData);
}
