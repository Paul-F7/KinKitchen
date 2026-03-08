/* global CookingAR */
'use strict';

/**
 * app.js — Aki screen navigation + app-level state machine
 *
 * Flow: splash → nation → upload → detect → recipe → kitchen3d → story
 *
 * State is kept in AkiApp.state. All screens read from and write to this.
 */
const AkiApp = (() => {
  // ── App state ──────────────────────────────────────────────────────────────
  const state = {
    selectedNation: 'Anishinaabe',
    uploadData:     null,   // raw API response from /api/upload
    activeRecipe:   null,   // { recipe, score, matchedIngredients }
    currentScreen:  'splash',
  };

  // ── Screen map ─────────────────────────────────────────────────────────────
  const SCREENS = ['splash','upload','detect','recipe','kitchen3d','story','ar'];

  // Screens that show the bottom nav
  const NAV_SCREENS = new Set(['upload','detect','recipe','story']);

  // ── Navigate ───────────────────────────────────────────────────────────────
  function goTo(screenName) {
    if (!SCREENS.includes(screenName)) return;

    const prev = document.querySelector('.screen.screen--active');
    if (prev) {
      prev.classList.remove('screen--active');
      prev.classList.add('screen--exit');
      setTimeout(() => prev.classList.remove('screen--exit'), 400);
    }

    const next = document.querySelector(`[data-screen="${screenName}"]`);
    if (next) {
      next.classList.add('screen--active');
      next.scrollTop = 0;
    }

    state.currentScreen = screenName;

    if (window.GlowingEffect) GlowingEffect.rescan();

    // Progress stepper — always show nav, update step states
    const nav = document.getElementById('bottom-nav');
    if (nav) nav.style.display = 'flex';

    updateProgressStepper(screenName);

    // Slide mascot to current active step
    requestAnimationFrame(() => {
      const active = document.querySelector('.progress-step.active');
      if (active) updateMascot(active);
    });

    // ── Screen side-effects ────────────────────────────────────────────────
    if (screenName === 'splash') {
      requestAnimationFrame(() => {
        if (window.Hero3d) Hero3d.mount();
      });
    } else {
      if (window.Hero3d)         Hero3d.unmount();
      if (window.ImmersiveEntry) ImmersiveEntry.unmount();
    }

    // Auto-narrate the story screen via ElevenLabs when it becomes active
    if (screenName === 'story') {
      setTimeout(() => {
        const body  = $('story-body')?.textContent?.trim();
        const audio = $('story-audio');
        if (body && body !== '–') speakText(body, audio);
        // Show audio chip once narration is triggered
        const chip = $('story-audio-chip');
        if (chip) chip.style.display = '';
      }, 600); // small delay so screen transition finishes first
    }
  }

  // ── Launch 3D kitchen with current upload data ────────────────────────────
  function _launchKitchen3d() {
    goTo('kitchen3d');
    requestAnimationFrame(() => {
      const container = document.getElementById('kitchen3d-container');
      const data      = state.uploadData;
      if (!container || !data || !window.handleGenerate3d) return;

      const bboxes = data.boundingBoxes || [];
      if (!bboxes.length && data.contentAnalysis?.foodDetected?.length) {
        const presetBoxes = data.contentAnalysis.foodDetected.map(f => ({
          name:       typeof f === 'object' ? f.label : f,
          confidence: f.confidence || 1,
        }));
        window.handleGenerate3d(data.url || '', presetBoxes, container, data.publicId || null);
      } else {
        window.handleGenerate3d(data.url || '', bboxes, container, data.publicId || null);
      }
    });
  }

  // ── Nation selection ───────────────────────────────────────────────────────
  function initNationGrid() {
    const grid = document.getElementById('nation-grid');
    if (!grid) return;
    grid.addEventListener('click', e => {
      const card = e.target.closest('.nation-card');
      if (!card) return;
      grid.querySelectorAll('.nation-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      state.selectedNation = card.dataset.nation || 'All';
    });
  }

  // ── Progress stepper + mascot ─────────────────────────────────────────────
  let _mascotShakeTimer = null;

  // Screen → step index: each page transition advances the bar
  // 0=Scan  1=Identify  2=Cook  3=Story
  const SCREEN_STEP = {
    splash:    0,
    upload:    0,
    detect:    1,   // photo analysed → step 2
    recipe:    2,   // recipe chosen  → step 3
    kitchen3d: 2,
    story:     3,   // story          → step 4
  };

  function updateMascot(el) {
    const track = document.getElementById('anime-mascot-track');
    if (!track || !el) return;
    const rect = el.getBoundingClientRect();
    track.style.left = (rect.left + rect.width / 2 - 30) + 'px';
  }

  function triggerMascotShake() {
    const mascot = document.getElementById('anime-mascot');
    if (!mascot) return;
    mascot.classList.remove('mascot--hover');
    void mascot.offsetWidth; // reflow to restart animation
    mascot.classList.add('mascot--hover');
    clearTimeout(_mascotShakeTimer);
    _mascotShakeTimer = setTimeout(() => mascot.classList.remove('mascot--hover'), 520);
  }

  function updateProgressStepper(screenName) {
    const activeIdx = SCREEN_STEP[screenName] ?? 0;
    const steps     = document.querySelectorAll('.progress-step');
    const connectors = document.querySelectorAll('.progress-connector');

    steps.forEach((step, i) => {
      step.classList.remove('active', 'completed');
      if (i < activeIdx)      step.classList.add('completed');
      else if (i === activeIdx) step.classList.add('active');
    });

    connectors.forEach((c, i) => {
      c.classList.toggle('completed', i < activeIdx);
    });
  }

  function initBottomNav() {
    const steps = document.querySelectorAll('.progress-step[data-nav]');
    const pill  = document.getElementById('anime-nav-pill');

    steps.forEach(step => {
      // Mascot follows hover
      step.addEventListener('mouseenter', () => {
        updateMascot(step.querySelector('.progress-step-dot') || step);
        triggerMascotShake();
      });
      step.addEventListener('mouseleave', () => {
        // Return mascot to active step
        const active = document.querySelector('.progress-step.active .progress-step-dot')
                    || document.querySelector('.progress-step.active');
        if (active) updateMascot(active);
      });
    });

    // Initial position
    requestAnimationFrame(() => {
      updateProgressStepper(state.currentScreen);
      const activeDot = document.querySelector('.progress-step.active .progress-step-dot')
                     || document.querySelector('.progress-step.active');
      if (activeDot) updateMascot(activeDot);
    });
  }

  // ── Wire all static buttons ────────────────────────────────────────────────
  function initButtons() {
    // ── Splash ──────────────────────────────────────────────────────────────
    // Single entry point: scan your kitchen
    $('btn-start-scan')?.addEventListener('click', () => goTo('upload'));

    // ── Upload ───────────────────────────────────────────────────────────────
    $('btn-upload-back')?.addEventListener('click', () => goTo('splash'));
    $('btn-upload-retry')?.addEventListener('click', () => {
      // Hide error + retry button, re-trigger file input
      const errEl   = $('upload-error');
      const retryEl = $('btn-upload-retry');
      if (errEl)   { errEl.textContent = ''; errEl.style.display = 'none'; }
      if (retryEl) retryEl.style.display = 'none';
      document.getElementById('file-input')?.click();
    });

    // ── Detection ────────────────────────────────────────────────────────────
    $('btn-find-recipes')?.addEventListener('click', () => goTo('recipe'));
    $('btn-scan-more')?.addEventListener('click', () => {
      if (window.CookingAR) CookingAR.unmount();
      goTo('upload');
    });

    // ── Recipe → 3D Kitchen (selected recipe from list) ──────────────────────
    // If selected recipe matches their upload → 3D build with that image. Else → demo kitchen.
    $('btn-enter-kitchen3d')?.addEventListener('click', () => {
      const primaryFromUpload = state.uploadData?.suggestedRecipes?.[0]?.recipe;
      const currentRecipe     = state.activeRecipe?.recipe || primaryFromUpload;
      const isUploadRecipe   = primaryFromUpload && currentRecipe && currentRecipe.id === primaryFromUpload.id;

      if (state.uploadData && isUploadRecipe) {
        _launchKitchen3d();
      } else if (state.uploadData) {
        goTo('kitchen3d');
        requestAnimationFrame(() => {
          const container = document.getElementById('kitchen3d-container');
          if (container && window.launchDemoKitchen) window.launchDemoKitchen(container);
        });
      } else {
        goTo('upload');
      }
    });

    // ── 3D Kitchen ───────────────────────────────────────────────────────────
    $('btn-kitchen3d-back')?.addEventListener('click', () => {
      if (window.CookingGuide) CookingGuide.destroy();
      goTo('recipe');
    });
    $('btn-kitchen3d-story')?.addEventListener('click', () => {
      if (window.CookingGuide) CookingGuide.destroy();
      goTo('story');
    });

    // ── Story ────────────────────────────────────────────────────────────────
    $('btn-story-restart')?.addEventListener('click', () => {
      state.uploadData  = null;
      state.activeRecipe = null;
      goTo('upload');
    });


    // ── AR (kept for bottom-nav / legacy) ────────────────────────────────────
    $('ar-btn-back')?.addEventListener('click', () => {
      if (window.CookingAR) CookingAR.unmount();
      goTo('recipe');
    });
    $('ar-btn-story')?.addEventListener('click', () => {
      // Fix: unmount CookingAR before leaving AR to prevent memory leak
      if (window.CookingAR) CookingAR.unmount();
      goTo('story');
    });
  }

  // ── TTS helper — ElevenLabs via /api/story/speak ──────────────────────────
  async function speakText(text, audioEl) {
    if (!text || !audioEl) return;
    try {
      const res = await fetch('/api/story/speak', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error('TTS failed');
      const blob = await res.blob();
      audioEl.src = URL.createObjectURL(blob);
      audioEl.play();
    } catch (e) {
      console.log('[AkiApp] TTS not available:', e.message);
    }
  }

  // ── Wire audio chips ───────────────────────────────────────────────────────
  function initAudioChips() {
    // Detection screen: hear Ojibwe name
    $('audio-chip')?.addEventListener('click', () => {
      const ojibwe = $('detect-ojibwe')?.textContent?.trim();
      if (ojibwe && ojibwe !== '–') speakText(ojibwe, $('detect-audio'));
    });

    // Story screen: manual replay
    $('story-play-btn')?.addEventListener('click', () => {
      const body = $('story-body')?.textContent?.trim();
      if (body) speakText(body, $('story-audio'));
    });

  }

  // ── Ingredient row click: hear Ojibwe name ─────────────────────────────────
  function initIngredientTap() {
    document.getElementById('recipe-ingredients')?.addEventListener('click', e => {
      const row  = e.target.closest('.ingredient-row');
      if (!row)  return;
      const name = row.querySelector('.ingredient-ojibwe')?.textContent?.trim();
      if (name)  speakText(name, $('detect-audio'));
    });
  }

  // ── Step buttons now route to 3D kitchen (not AR) ─────────────────────────
  function initStepBtns() {
    document.getElementById('recipe-steps')?.addEventListener('click', e => {
      if (e.target.closest('.step-ar-btn')) {
        if (state.uploadData) _launchKitchen3d();
        else goTo('upload');
      }
    });
  }

  // ── Utility ────────────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    initNationGrid();
    initBottomNav();
    initButtons();
    initAudioChips();
    initIngredientTap();
    initStepBtns();

    // Hide bottom nav on start
    const nav = document.getElementById('bottom-nav');
    if (nav) nav.style.display = 'none';

    // Start on splash
    goTo('splash');
    setTimeout(() => {
      if (window.Hero3d) Hero3d.mount();
    }, 150);
  }

  document.addEventListener('DOMContentLoaded', init);

  // CookingGuide fires this when user clicks "Hear the story" on the completion card
  window.addEventListener('cookingguide:story', () => {
    if (window.CookingGuide) CookingGuide.destroy();
    goTo('story');
  });

  // Also support the direct function call path
  window.launchElderStory = () => {
    if (window.CookingGuide) CookingGuide.destroy();
    goTo('story');
  };

  return { goTo, state, speakText };
})();
