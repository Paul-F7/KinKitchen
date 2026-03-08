/* global escapeHtml, AkiApp */
'use strict';

/**
 * render.js — AkiRender
 * Populates the 5 dynamic screens from the /api/upload response.
 *
 * Called by upload.js after a successful upload:
 *   AkiRender.renderDetection(data, file)
 *   AkiRender.renderRecipe(data)
 *   AkiRender.renderStory(data)
 *   AkiRender.renderWord(data)
 */
const AkiRender = (() => {

  // ── Ingredient emoji map ───────────────────────────────────────────────────
  const EMOJIS = {
    garlic: '🧄', onion: '🧅', tomato: '🍅', carrot: '🥕', corn: '🌽',
    potato: '🥔', broccoli: '🥦', mushroom: '🍄', apple: '🍎', lemon: '🍋',
    banana: '🍌', strawberry: '🍓', blueberry: '🫐', raspberry: '🍓',
    salmon: '🐟', fish: '🐟', chicken: '🍗', beef: '🥩', egg: '🥚',
    flour: '🌾', bread: '🍞', rice: '🍚', bean: '🫘', squash: '🎃',
    pepper: '🌶️', cucumber: '🥒', spinach: '🥬', default: '🌿',
  };

  function ingredientEmoji(name) {
    const n = (name || '').toLowerCase();
    for (const [k, v] of Object.entries(EMOJIS)) if (n.includes(k)) return v;
    return EMOJIS.default;
  }

  // ── Collect + deduplicate ingredients from all API sources ─────────────────
  function collectIngredients(data) {
    const seen = new Set();
    const out  = [];
    for (const b of (data.boundingBoxes || [])) {
      const name = (b.name || '').toLowerCase();
      if (!seen.has(name)) { seen.add(name); out.push({ name, conf: b.confidence }); }
    }
    for (const f of (data.contentAnalysis?.foodDetected || [])) {
      const name = ((typeof f === 'object' ? f.label : f) || '').toLowerCase();
      if (name && !seen.has(name)) { seen.add(name); out.push({ name, conf: f.confidence || null }); }
    }
    for (const obj of (data.analysis?.detectedObjects || [])) {
      const name = (obj || '').toLowerCase();
      if (name && !seen.has(name)) { seen.add(name); out.push({ name, conf: null }); }
    }
    return out;
  }

  // ── SCREEN 4: Detection ───────────────────────────────────────────────────
  function renderDetection(data, file) {
    // Show uploaded photo: prefer Cloudinary thumbnail (fast, works after refresh), else blob
    const img    = document.getElementById('detect-img');
    const holder = document.getElementById('detect-placeholder');
    if (img) {
      const url = (data.mediaType === 'video' && data.posterUrl) ? data.posterUrl
        : (data.thumbnailUrl || data.url);
      if (url) {
        img.src            = url;
        img.style.display  = 'block';
        if (holder) holder.style.display = 'none';
      } else if (file) {
        img.src            = URL.createObjectURL(file);
        img.style.display  = 'block';
        if (holder) holder.style.display = 'none';
      }
    }

    // Primary detected ingredient
    const ingredients = collectIngredients(data);
    const primary     = ingredients[0];
    const ingName     = primary?.name || data.analysis?.detectedObjects?.[0] || '–';
    const ingConf     = primary?.conf ? Math.round(primary.conf * 100) : null;

    // Ojibwe / traditional name from Gemini
    const names       = data.analysis?.indigenousContext?.traditionalNames;
    const ojibweName  = names?.length ? names[0].name : '–';

    // Set text
    const n = document.getElementById('detect-name');
    const o = document.getElementById('detect-ojibwe');
    if (n) n.textContent = _cap(ingName);
    if (o) o.textContent = ojibweName;

    // Bounding box overlay
    if (data.boundingBoxes?.length) {
      const bbox = data.boundingBoxes[0];
      const ov   = document.getElementById('bbox-overlay');
      const lbl  = document.getElementById('bbox-label');
      if (ov && bbox) {
        ov.style.left    = `${(bbox.x || 0) * 100}%`;
        ov.style.top     = `${(bbox.y || 0) * 100}%`;
        ov.style.width   = `${(bbox.w || 0.3) * 100}%`;
        ov.style.height  = `${(bbox.h || 0.3) * 100}%`;
        ov.style.display = '';
        if (lbl) lbl.textContent = `${_cap(ingName)} ${ingConf ? `· ${ingConf}%` : ''}`;
      }
    }

    // Tags
    const tags  = document.getElementById('detect-tags');
    if (tags) {
      const ctx  = data.analysis?.indigenousContext;
      const rows = [];
      if (ctx?.seasonality)          rows.push(['tag-forest', ctx.seasonality]);
      if (AkiApp.state.selectedNation !== 'All')
                                     rows.push(['tag-ochre', AkiApp.state.selectedNation]);
      if (ctx?.culturalUses?.length) rows.push(['tag-cream', ctx.culturalUses[0]]);

      tags.innerHTML = rows.map(([cls, txt]) =>
        `<span class="tag ${cls}">${escapeHtml(txt)}</span>`
      ).join('');
    }

    // Show audio chip if we have an Ojibwe name
    const chip = document.getElementById('audio-chip');
    if (chip) chip.style.display = ojibweName !== '–' ? '' : 'none';

    // Clickable ingredient chips — show Cloudinary labeled image on click
    const chipsWrap = document.getElementById('detect-ingredient-chips');
    if (chipsWrap && data.publicId && ingredients.length) {
      chipsWrap.style.display = '';
      chipsWrap.innerHTML = ingredients.slice(0, 10).map(ing =>
        '<button type="button" class="detect-ingredient-chip" data-ingredient="' + escapeHtml(ing.name) + '">' +
          escapeHtml(typeof formatIngredientLabel === 'function' ? formatIngredientLabel(ing.name) : ing.name) +
        '</button>'
      ).join('');
      chipsWrap.querySelectorAll('.detect-ingredient-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          if (typeof showIngredientLabel === 'function') showIngredientLabel(data.publicId, btn.dataset.ingredient);
        });
      });
    } else if (chipsWrap) chipsWrap.style.display = 'none';

    // Placeholder emoji update
    if (holder) {
      const emoji = ingredientEmoji(ingName);
      holder.textContent = emoji;
    }
  }

  // ── SCREEN 5: Recipe ──────────────────────────────────────────────────────
  function renderRecipe(data) {
    const ctx         = data.analysis?.indigenousContext;
    const suggested   = data.suggestedRecipes || [];
    const geminiRec   = data.analysis?.recipes?.[0];

    // Primary recipe: prefer dataset match, fall back to Gemini suggestion
    const primaryMatch = suggested[0];
    const primaryRec   = primaryMatch?.recipe || null;

    // Hero section
    const nation     = primaryRec?.culture || ctx?.culturalSignificance && AkiApp.state.selectedNation || '–';
    const titleOjib  = geminiRec?.name || primaryRec?.name || '–';
    const titleEng   = geminiRec?.description || primaryRec?.description || '';

    _set('recipe-nation',         nation);
    _set('recipe-title-ojibwe',   titleOjib);
    _set('recipe-title-english',  titleEng);
    _set('recipe-time',           '35');   // placeholder until we have timing data
    _set('recipe-serves',         '4');
    _set('recipe-difficulty',     'Easy');

    // Ingredient list — use detected ingredients + map ojibwe names; click to show Cloudinary label
    const ingredients   = collectIngredients(data);
    const traditNames   = ctx?.traditionalNames || [];
    const ingListEl     = document.getElementById('recipe-ingredients');
    const publicId      = data.publicId || null;
    if (ingListEl) {
      ingListEl.innerHTML = ingredients.slice(0, 8).map(ing => {
        const match = traditNames.find(t => ing.name.toLowerCase().includes(t.name?.toLowerCase() || '##'));
        const ojibwe = match?.name || '';
        const clickable = publicId && typeof showIngredientLabel === 'function' ? ' ingredient-row-clickable' : '';
        return `
          <div class="ingredient-row${clickable}" data-ingredient="${escapeHtml(ing.name)}" role="${clickable ? 'button' : ''}" tabindex="${clickable ? '0' : ''}">
            <div class="ingredient-left">
              <div class="ingredient-dot"></div>
              <div>
                <div class="ingredient-name">${escapeHtml(_cap(ing.name))}</div>
                ${ojibwe ? `<div class="ingredient-ojibwe">${escapeHtml(ojibwe)}</div>` : ''}
              </div>
            </div>
            <div class="ingredient-amount">${ing.conf ? `${Math.round(ing.conf * 100)}%` : ''}</div>
          </div>`;
      }).join('') || '<p style="color:var(--text-muted);font-size:14px;padding:16px 0">No ingredients detected.</p>';
      if (publicId && typeof showIngredientLabel === 'function' && !ingListEl.dataset.labelListener) {
        ingListEl.dataset.labelListener = '1';
        ingListEl.addEventListener('click', e => {
          const row = e.target.closest('.ingredient-row-clickable');
          if (!row || !row.dataset.ingredient) return;
          const data = AkiApp.state.uploadData;
          if (data && data.publicId) showIngredientLabel(data.publicId, row.dataset.ingredient);
        });
      }
    }

    // Steps — from traditional preparations or cultural uses
    const preps    = ctx?.traditionalPreparations || ctx?.culturalUses || [];
    const stepsEl  = document.getElementById('recipe-steps');
    if (stepsEl) {
      if (preps.length) {
        stepsEl.innerHTML = preps.slice(0, 4).map((p, i) => `
          <div class="step-item">
            <div class="step-num">${i + 1}</div>
            <div class="step-content">
              <div class="step-title">Step ${i + 1}</div>
              <div class="step-desc">${escapeHtml(p)}</div>
              ${i === 0 ? '<button class="step-ar-btn">◈ Watch in AR</button>' : ''}
            </div>
          </div>`).join('');
      } else {
        stepsEl.innerHTML = `
          <div class="step-item">
            <div class="step-num">1</div>
            <div class="step-content">
              <div class="step-title">Prepare your ingredients</div>
              <div class="step-desc">Gather the detected ingredients and prepare them using traditional methods when possible.</div>
              <button class="step-ar-btn">◈ Watch in AR</button>
            </div>
          </div>`;
      }
    }

    // Cultural knowledge block
    const cultWrap = document.getElementById('recipe-cultural-wrap');
    const cultText = document.getElementById('recipe-cultural-text');
    if (ctx?.culturalSignificance && cultWrap && cultText) {
      cultText.textContent = ctx.culturalSignificance;
      cultWrap.style.display = '';
    } else if (cultWrap) {
      cultWrap.style.display = 'none';
    }

    // More recipes list — include primary; select one then "Cook this in 3D" appears below
    const sugWrap   = document.getElementById('recipe-suggestions-wrap');
    const sugList   = document.getElementById('recipe-suggestions-list');
    const currentId = (AkiApp.state.activeRecipe?.recipe?.id || primaryMatch?.recipe?.id) || '';

    if (suggested.length && sugWrap && sugList) {
      if (!AkiApp.state.activeRecipe && primaryMatch) AkiApp.state.activeRecipe = primaryMatch;

      sugList.innerHTML = suggested.slice(0, 5).map(({ recipe, score }) => {
        const isSelected = (recipe.id || '') === currentId;
        return `<div class="aki-recipe-sug${isSelected ? ' aki-recipe-sug--selected' : ''}" data-recipe-id="${escapeHtml(recipe.id || '')}">
          <div class="aki-recipe-sug__left">
            <button class="aki-recipe-sug__build" data-recipe-id="${escapeHtml(recipe.id || '')}" title="Cook this in 3D">Build →</button>
            <span class="aki-recipe-sug__name">${escapeHtml(recipe.name)}</span>
          </div>
          <span class="aki-recipe-sug__match">${Math.round(score * 100)}% match</span>
        </div>`;
      }).join('');
      sugWrap.style.display = '';

      if (!sugList.dataset.recipeSelectListener) {
        sugList.dataset.recipeSelectListener = '1';
        sugList.addEventListener('click', e => {
          // Build button → select + immediately enter kitchen
          const buildBtn = e.target.closest('.aki-recipe-sug__build');
          if (buildBtn) {
            e.stopPropagation();
            const recId = buildBtn.dataset.recipeId;
            const found = AkiApp.state.uploadData?.suggestedRecipes?.find(s => s.recipe.id === recId);
            if (found) {
              AkiApp.state.activeRecipe = found;
              _set('recipe-title-ojibwe',  found.recipe.name);
              _set('recipe-title-english', found.recipe.description);
              _set('recipe-nation',        found.recipe.culture);
              sugList.querySelectorAll('.aki-recipe-sug').forEach(el => {
                el.classList.toggle('aki-recipe-sug--selected', el.dataset.recipeId === recId);
              });
              document.getElementById('btn-enter-kitchen3d')?.click();
            }
            return;
          }

          // Card click → select recipe
          const item = e.target.closest('.aki-recipe-sug');
          if (!item) return;
          const recId = item.dataset.recipeId;
          const uploadData = AkiApp.state.uploadData;
          const found = uploadData?.suggestedRecipes?.find(s => s.recipe.id === recId);
          if (found) {
            AkiApp.state.activeRecipe = found;
            _set('recipe-title-ojibwe',  found.recipe.name);
            _set('recipe-title-english', found.recipe.description);
            _set('recipe-nation',        found.recipe.culture);
            sugList.querySelectorAll('.aki-recipe-sug').forEach(el => {
              el.classList.toggle('aki-recipe-sug--selected', el.dataset.recipeId === recId);
            });
          }
        });
      }
    } else if (sugWrap) {
      sugWrap.style.display = 'none';
    }
  }

  // ── SCREEN 7: Story ───────────────────────────────────────────────────────
  function renderStory(data) {
    const ctx   = data.analysis?.indigenousContext;
    const names = ctx?.traditionalNames;
    const ing   = collectIngredients(data)[0];

    // Title
    const title = names?.length
      ? `The story of ${names[0].name || _cap(ing?.name || 'this ingredient')}`
      : `The story of ${_cap(ing?.name || 'this ingredient')}`;
    _set('story-title', title);

    // Body — cultural significance or uses
    const body = ctx?.culturalSignificance
      || (ctx?.culturalUses?.join(' ') || '')
      || data.analysis?.nutritionNotes
      || 'This ingredient carries deep cultural knowledge passed down through generations.';
    _set('story-body', body);

    // Eyebrow
    const nation = AkiApp.state.selectedNation !== 'All'
      ? `${AkiApp.state.selectedNation} teaching`
      : 'The teaching behind the recipe';
    _set('story-eyebrow', nation);

    // Attribution
    const nation2 = names?.[0]?.nation || AkiApp.state.selectedNation || '';
    _set('story-attr-name', nation2 ? `Traditional knowledge · ${nation2}` : 'Indigenous foodways');

    // Land acknowledgment
    const land = names?.length
      ? `Prepared on the traditional territory of the ${names[0].nation || AkiApp.state.selectedNation} peoples. This knowledge has been shared respectfully.`
      : '';
    _set('story-land', land);

    // Show TTS chip if story is available
    const chip = document.getElementById('story-audio-chip');
    if (chip) chip.style.display = '';
  }

  // ── SCREEN 8: Word of the Day ─────────────────────────────────────────────
  function renderWord(data) {
    const ctx   = data.analysis?.indigenousContext;
    const names = ctx?.traditionalNames;
    const ing   = collectIngredients(data)[0];

    const wordObj  = names?.[0];
    const ojibwe   = wordObj?.name   || '–';
    const english  = ing?.name ? `"${_cap(ing.name)}"` : '–';
    const emoji    = ingredientEmoji(ing?.name || '');

    _set('word-ojibwe',  ojibwe);
    _set('word-english', english);

    const emojiEl = document.getElementById('word-emoji');
    if (emojiEl) emojiEl.textContent = emoji;

    // Show play button if we have a word
    const play = document.getElementById('word-play');
    if (play) play.style.display = ojibwe !== '–' ? '' : 'none';
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function _set(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text || '';
  }

  function _cap(s) {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  return { renderDetection, renderRecipe, renderStory, renderWord };
})();
