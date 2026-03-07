/* global THREE */
'use strict';

/**
 * CookingGuide — Immersive step-by-step 3D cooking overlay
 *
 * Per-step 3D animations: knife chop / spoon stir / steam / sparkle / drip / salt
 * Chop steps move the active ingredient to a cutting board then back.
 *
 *   CookingGuide.init(scene, camera, renderer, ingredientMeshes)
 *   .goToStep(n) .next() .prev() .reset() .destroy() .setXRActive(bool)
 */
const CookingGuide = (() => {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────
  let _scene, _camera, _renderer, _meshes;
  let _currentStep  = 0;
  let _animId       = null;
  let _overlayEl    = null;
  let _activeLights = [];
  let _autoAdvanceTimer = null;
  let _countdownStart   = null;
  let _audioCtx     = null;
  let _lastFrame    = 0;
  let _initialized  = false;
  let _isXR         = false;

  // 3D scene objects
  let _cuttingBoard = null;
  let _knifeGroup   = null;
  let _spoonGroup   = null;
  let _spotGlow     = null;
  let _particles    = [];
  let _animType     = 'none';
  let _animT        = 0;
  let _chopT        = 0;
  let _stirAngle    = 0;

  // Ingredient lerp system (move to board / return)
  let _activeLerps   = [];   // [{ mesh, from, to, t, duration }]
  let _origPositions = {};   // { slotName: {x,y,z} }

  // Cutting board world-space center (ingredients land here when chopped)
  const BOARD_CENTER = { x: -0.85, z: 0.38 };
  const BOARD_Y      = 2.960;  // counter-level y for board top surface

  // ── Ingredient emoji map ──────────────────────────────────────────────────
  const ING_EMOJI = {
    butternut_squash_1: '🎃',
    onion_1:            '🧅',
    garlic_1:           '🧄',
    canned_beans_1:     '🫘',
    canned_corn_1:      '🌽',
    chicken_stock_1:    '🍲',
  };

  // ── Step data ─────────────────────────────────────────────────────────────
  const STEPS = [
    {
      id: 1, phase: 'Preparation', icon: '🔪', action: 'CHOP', heroColor: '#5C2A0E', animType: 'chop',
      title: 'Cube the squash',
      body: 'Peel the butternut squash, halve lengthwise, scoop out the seeds, and cut into 1-inch cubes. Uniform size = even cooking.',
      tip: 'Use the heel of your knife, knuckles curled — the blade guides against them.',
      activeIngredients: ['butternut_squash_1'], duration: null,
    },
    {
      id: 2, phase: 'Preparation', icon: '🔪', action: 'DICE', heroColor: '#5C2A0E', animType: 'chop',
      title: 'Dice the onion',
      body: 'Halve through the root end, peel, make parallel cuts lengthwise then crosswise. The root holds everything together while you work.',
      tip: 'Refrigerate the onion 15 min before cutting — reduces the tear-inducing vapour.',
      activeIngredients: ['onion_1'], duration: null,
    },
    {
      id: 3, phase: 'Preparation', icon: '🔪', action: 'MINCE', heroColor: '#5C2A0E', animType: 'chop',
      title: 'Smash and mince the garlic',
      body: 'Press the flat of your knife over each clove and smash with your palm. Peel, then rock-chop into a fine mince. 4–5 cloves.',
      tip: 'Smashing splits the skin instantly. Smaller mince = more flavour unlocked.',
      activeIngredients: ['garlic_1'], duration: null,
    },
    {
      id: 4, phase: 'Preparation', icon: '💧', action: 'DRAIN', heroColor: '#1E3D60', animType: 'drain',
      title: 'Drain and rinse the beans',
      body: 'Open the can, pour into a colander and rinse under cold water for 30 seconds. Removes excess sodium and starch.',
      tip: null,
      activeIngredients: ['canned_beans_1'], duration: null,
    },
    {
      id: 5, phase: 'Preparation', icon: '💧', action: 'DRAIN', heroColor: '#1E3D60', animType: 'drain',
      title: 'Prepare the corn',
      body: 'Open the canned corn and drain well. If using fresh, hold the cob upright and slice kernels off with a downward stroke.',
      tip: null,
      activeIngredients: ['canned_corn_1'], duration: null,
    },
    {
      id: 6, phase: 'Cooking', icon: '🍳', action: 'SAUTÉ', heroColor: '#7A3800', animType: 'stir',
      title: 'Sauté the onion',
      body: 'Heat 2 tbsp oil in a large pot over medium. Add diced onion + pinch of salt. Cook 5–8 min, stirring, until soft and golden.',
      tip: 'Don\'t rush — properly softened onions become the sweet savory base of the whole stew.',
      activeIngredients: ['onion_1'], duration: null,
    },
    {
      id: 7, phase: 'Cooking', icon: '✨', action: 'BLOOM', heroColor: '#6B3A00', animType: 'sparkle',
      title: 'Add garlic and spices',
      body: 'Add minced garlic, 1 tsp cumin, 1 tsp chili powder, ½ tsp thyme. Stir constantly 60 seconds until fragrant.',
      tip: 'Blooming in hot oil unlocks fat-soluble aromatics that water alone can\'t extract.',
      activeIngredients: ['garlic_1'], duration: null,
    },
    {
      id: 8, phase: 'Cooking', icon: '🌡️', action: 'BOIL', heroColor: '#5A2800', animType: 'steam',
      title: 'Add squash and stock — bring to a boil',
      body: 'Add the cubed squash and pour in 6 cups of chicken stock. Crank to high and bring to a rolling boil, then reduce.',
      tip: null,
      activeIngredients: ['butternut_squash_1', 'chicken_stock_1'], duration: null,
    },
    {
      id: 9, phase: 'Cooking', icon: '⏱️', action: 'SIMMER', heroColor: '#1A3D28', animType: 'steam',
      title: 'Simmer until fork-tender',
      body: 'Reduce to medium-low, cover, simmer 15–20 minutes. The squash is ready when a fork slides through with zero resistance.',
      tip: null,
      activeIngredients: ['butternut_squash_1'], duration: 8,
    },
    {
      id: 10, phase: 'Finishing', icon: '🥄', action: 'STIR IN', heroColor: '#133020', animType: 'stir',
      title: 'Stir in beans and corn',
      body: 'Add the drained beans and corn. Remove the lid and simmer on medium 10 more minutes — the stew will thicken.',
      tip: null,
      activeIngredients: ['canned_beans_1', 'canned_corn_1'], duration: null,
    },
    {
      id: 11, phase: 'Finishing', icon: '🥄', action: 'MASH', heroColor: '#133020', animType: 'stir',
      title: 'Mash for body',
      body: 'Press ~10% of the squash and beans against the pot wall with the back of your spoon. Stir back in — thickens the broth naturally.',
      tip: 'Traditional technique. Rustic texture, no blender needed.',
      activeIngredients: ['butternut_squash_1', 'canned_beans_1'], duration: null,
    },
    {
      id: 12, phase: 'Finishing', icon: '🧂', action: 'SEASON', heroColor: '#133020', animType: 'season',
      title: 'Season to taste',
      body: 'Taste and adjust with salt, pepper, and a squeeze of lemon. Ladle into bowls and serve immediately.',
      tip: null,
      activeIngredients: [], duration: null,
    },
  ];

  const TOTAL = STEPS.length;

  // ── Audio ─────────────────────────────────────────────────────────────────
  function _actx() {
    if (!_audioCtx) {
      try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (_) { return null; }
    }
    return _audioCtx;
  }
  function _tone(freqs, att, dec, vol) {
    const ctx = _actx(); if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    freqs.forEach(f => {
      try {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = 'sine'; o.frequency.value = f;
        const now = ctx.currentTime;
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(vol, now + att);
        g.gain.exponentialRampToValueAtTime(0.0001, now + att + dec);
        o.start(now); o.stop(now + att + dec + 0.05);
      } catch (_) {}
    });
  }
  const _chime       = () => _tone([440],               0.07, 0.32, 0.26);
  const _chimeFinale = () => _tone([440, 554.4, 659.3],  0.07, 1.80, 0.26);

  // ── DOM Overlay ───────────────────────────────────────────────────────────
  const _CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=DM+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap');
#cg-card {
  position:fixed; bottom:24px; right:20px; width:292px;
  background:#FEFBF5; border-radius:16px; overflow:hidden;
  box-shadow:0 20px 60px rgba(0,0,0,.48),0 0 0 1px rgba(180,110,40,.28);
  font-family:'DM Sans',system-ui,sans-serif;
  transition:opacity .15s ease,transform .15s ease;
  pointer-events:auto;
}
#cg-card.cg-out  { opacity:0; transform:translateY(6px) scale(.975); }
#cg-card.cg-done { background:#0F2018; }
.cg-hero {
  position:relative; padding:14px 16px 12px;
  display:flex; align-items:center; gap:12px; min-height:70px;
}
.cg-hero::after {
  content:''; position:absolute; inset:0;
  background:linear-gradient(135deg,rgba(255,255,255,.10) 0%,transparent 55%);
  pointer-events:none;
}
.cg-hero-icon { font-size:32px; line-height:1; flex-shrink:0; filter:drop-shadow(0 2px 5px rgba(0,0,0,.35)); }
.cg-hero-mid  { flex:1; min-width:0; }
.cg-hero-verb { font-size:9px; font-weight:700; letter-spacing:.13em; text-transform:uppercase; color:rgba(255,255,255,.55); margin-bottom:2px; }
.cg-hero-ings { font-size:24px; line-height:1; letter-spacing:.05em; }
.cg-hero-num  { font-family:'DM Sans',sans-serif; font-size:34px; font-weight:600; color:rgba(255,255,255,.20); line-height:1; flex-shrink:0; letter-spacing:-.03em; }
.cg-prog-wrap { height:3px; background:rgba(0,0,0,.07); }
.cg-prog-fill { height:100%; background:#C8813A; transition:width .5s cubic-bezier(.4,0,.2,1); }
.cg-content   { padding:13px 15px 11px; }
.cg-phase     { font-size:9.5px; font-weight:700; letter-spacing:.10em; text-transform:uppercase; color:#C8813A; margin-bottom:4px; }
.cg-title     { font-family:'Playfair Display',serif; font-size:21px; font-weight:700; color:#1A0E04; line-height:1.2; margin-bottom:8px; }
.cg-body-text { font-size:12.5px; line-height:1.65; color:#4A3520; margin-bottom:7px; }
.cg-tip       { font-size:11.5px; line-height:1.55; color:#7A5530; font-style:italic;
                 border-left:2.5px solid #C8813A; padding-left:9px; margin-bottom:11px; }
.cg-btns { display:flex; gap:8px; justify-content:flex-end; }
.cg-btn  {
  font-family:'DM Sans',sans-serif; font-size:13px; font-weight:600;
  padding:8px 16px; border-radius:9px; border:none; cursor:pointer;
  transition:background .12s,transform .1s,box-shadow .12s;
}
.cg-btn:active { transform:scale(.93); }
.cg-btn-back { background:transparent; color:#C8813A; border:1.5px solid #C8813A; }
.cg-btn-next { background:#C8813A; color:#FFF8EE; box-shadow:0 2px 8px rgba(200,129,58,.38); }
.cg-btn-back:hover { background:rgba(200,129,58,.1); }
.cg-btn-next:hover { background:#A06228; }
.cg-ring     { position:absolute; top:12px; right:12px; width:34px; height:34px; }
.cg-ring svg { transform:rotate(-90deg); }
.cg-ring-c   { fill:none; stroke:rgba(255,255,255,.75); stroke-width:3; stroke-linecap:round; stroke-dasharray:86; stroke-dashoffset:0; }
.cg-swipe    { font-size:10px; color:rgba(80,60,40,.38); text-align:center; margin-top:6px; display:none; }
@media(pointer:coarse){ .cg-btns{display:none} .cg-swipe{display:block} }
.cg-done-top     { text-align:center; padding:20px 16px 6px; }
.cg-done-emoji   { font-size:52px; display:block; margin-bottom:6px; }
.cg-done-title   { font-family:'Playfair Display',serif; font-size:18px; color:#F5ECD7; line-height:1.3; margin-bottom:3px; }
.cg-done-sub     { font-size:12px; color:rgba(245,236,215,.52); font-style:italic; margin-bottom:16px; }
.cg-done-btns    { padding:0 14px 16px; display:flex; flex-direction:column; gap:8px; }
.cg-btn-story, .cg-btn-reset {
  font-family:'DM Sans',sans-serif; font-weight:600; font-size:13px;
  padding:11px 14px; border-radius:10px; border:none; cursor:pointer; text-align:center;
}
.cg-btn-story { background:#C8813A; color:#FFF8EE; }
.cg-btn-story:hover { background:#A06228; }
.cg-btn-reset { background:rgba(245,236,215,.07); color:rgba(245,236,215,.58); border:1px solid rgba(245,236,215,.18); }
.cg-btn-reset:hover { background:rgba(245,236,215,.14); }
`;

  function _buildOverlay() {
    const el = document.createElement('div');
    el.id = 'cg-root';
    el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;';
    el.innerHTML = `<style>${_CSS}</style>
<div id="cg-card">
  <div class="cg-hero" id="cg-hero">
    <span class="cg-hero-icon" id="cg-hero-icon"></span>
    <div class="cg-hero-mid">
      <div class="cg-hero-verb" id="cg-hero-verb"></div>
      <div class="cg-hero-ings" id="cg-hero-ings"></div>
    </div>
    <div class="cg-hero-num" id="cg-hero-num"></div>
    <div class="cg-ring" id="cg-ring" style="display:none">
      <svg viewBox="0 0 34 34"><circle cx="17" cy="17" r="13.7" class="cg-ring-c" id="cg-ring-c"/></svg>
    </div>
  </div>
  <div class="cg-prog-wrap"><div class="cg-prog-fill" id="cg-prog-fill" style="width:0%"></div></div>
  <div class="cg-content">
    <div class="cg-phase"     id="cg-phase"></div>
    <div class="cg-title"     id="cg-title"></div>
    <div class="cg-body-text" id="cg-body-text"></div>
    <div class="cg-tip"       id="cg-tip" style="display:none"></div>
    <div class="cg-btns">
      <button class="cg-btn cg-btn-back" id="cg-btn-back">&#8592; Back</button>
      <button class="cg-btn cg-btn-next" id="cg-btn-next">Next &#8594;</button>
    </div>
    <div class="cg-swipe">&#8592; swipe to navigate &#8594;</div>
  </div>
</div>`;
    document.body.appendChild(el);
    _overlayEl = el;
    _q('#cg-btn-next').addEventListener('click', () => _nextStep());
    _q('#cg-btn-back').addEventListener('click', () => prev());
    let tx0 = 0;
    el.addEventListener('touchstart', e => { tx0 = e.changedTouches[0].clientX; }, { passive: true });
    el.addEventListener('touchend',   e => {
      const dx = e.changedTouches[0].clientX - tx0;
      if (Math.abs(dx) > 46) { dx > 0 ? prev() : _nextStep(); }
    }, { passive: true });
  }

  function _destroyOverlay() { if (_overlayEl) { _overlayEl.remove(); _overlayEl = null; } }

  // ── Cutting board ─────────────────────────────────────────────────────────
  function _buildCuttingBoard() {
    const g = new THREE.Group();

    // Main board — dark walnut
    const boardMat  = new THREE.MeshStandardMaterial({ color: 0x5C3010, roughness: 0.88, metalness: 0 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.022, 0.34), boardMat);
    board.receiveShadow = true;
    board.castShadow    = true;
    g.add(board);

    // Grain lines running lengthwise (x direction)
    const grainMat = new THREE.MeshStandardMaterial({ color: 0x7A4A1C, roughness: 0.91, metalness: 0 });
    [-0.11, -0.04, 0.04, 0.11].forEach(z => {
      const grain = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.0012, 0.007), grainMat);
      grain.position.set(0, 0.012, z);
      g.add(grain);
    });

    // Slightly raised edge border
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x3D1E08, roughness: 0.92, metalness: 0 });
    // Long edges
    [[-0.246, 0, 0, 0.008, 0.024, 0.34], [0.246, 0, 0, 0.008, 0.024, 0.34]].forEach(([x, y, z, w, h, d]) => {
      const e = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), edgeMat);
      e.position.set(x, y, z);
      g.add(e);
    });
    // Short edges
    [[0, 0, -0.166, 0.50, 0.024, 0.008], [0, 0, 0.166, 0.50, 0.024, 0.008]].forEach(([x, y, z, w, h, d]) => {
      const e = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), edgeMat);
      e.position.set(x, y, z);
      g.add(e);
    });

    // Handle tab on the right
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x4A2408, roughness: 0.90, metalness: 0 });
    const tab = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.018, 0.06), handleMat);
    tab.position.set(0.295, 0, 0.05);
    g.add(tab);

    // Rubber feet (small dark cylinders at corners)
    const feetMat = new THREE.MeshStandardMaterial({ color: 0x1A1A1A, roughness: 0.95, metalness: 0 });
    [[-0.20, -0.14], [-0.20, 0.14], [0.20, -0.14], [0.20, 0.14]].forEach(([fx, fz]) => {
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.008, 10), feetMat);
      foot.position.set(fx, -0.014, fz);
      g.add(foot);
    });

    // Place on counter, slightly in front and to the right of the ingredient cluster
    g.position.set(BOARD_CENTER.x, BOARD_Y, BOARD_CENTER.z);
    g.castShadow    = true;
    g.receiveShadow = true;
    _scene.add(g);
    _cuttingBoard = g;
  }

  // ── Knife ─────────────────────────────────────────────────────────────────
  function _buildKnife() {
    const g = new THREE.Group();
    const silver = new THREE.MeshStandardMaterial({ color: 0xE2E2E2, metalness: 0.94, roughness: 0.06 });
    const wood   = new THREE.MeshStandardMaterial({ color: 0x2C1608, roughness: 0.84, metalness: 0 });
    const grey   = new THREE.MeshStandardMaterial({ color: 0xB2B2B2, metalness: 0.78, roughness: 0.22 });

    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.013, 0.27, 0.004), silver);
    blade.position.y = -0.02; blade.castShadow = true; g.add(blade);

    const bolster = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.022, 0.013), grey);
    bolster.position.y = 0.12; g.add(bolster);

    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.020, 0.136, 0.017), wood);
    handle.position.y = 0.203; handle.castShadow = true; g.add(handle);

    [0.173, 0.233].forEach(y => {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.020, 8), grey);
      r.rotation.x = Math.PI / 2; r.position.set(0, y, 0); g.add(r);
    });

    g.scale.setScalar(1.5);
    g.rotation.z = Math.PI / 9;
    g.visible = false;
    _scene.add(g);
    _knifeGroup = g;
  }

  // ── Wooden spoon ──────────────────────────────────────────────────────────
  function _buildSpoon() {
    const g = new THREE.Group();
    const darkWood  = new THREE.MeshStandardMaterial({ color: 0x6B3A14, roughness: 0.83, metalness: 0 });
    const lightWood = new THREE.MeshStandardMaterial({ color: 0x9A5A28, roughness: 0.78, metalness: 0 });

    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.013, 0.38, 10), darkWood);
    handle.position.y = 0.05; handle.castShadow = true; g.add(handle);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.022, 0.06, 10), darkWood);
    neck.position.y = -0.16; g.add(neck);

    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.048, 14, 10), lightWood);
    bowl.scale.set(1, 0.43, 0.88); bowl.position.y = -0.22;
    bowl.castShadow = true; g.add(bowl);

    g.rotation.x = 0.24;
    g.visible = false;
    _scene.add(g);
    _spoonGroup = g;
  }

  // ── Spot glow ─────────────────────────────────────────────────────────────
  function _buildSpotGlow() {
    const g = new THREE.Group();
    const sharedParams = { transparent: true, opacity: 0, side: THREE.DoubleSide, depthTest: false, depthWrite: false };
    const inner = new THREE.Mesh(
      new THREE.CircleGeometry(0.17, 40),
      new THREE.MeshBasicMaterial({ color: 0xD4883A, ...sharedParams })
    );
    inner.rotation.x = -Math.PI / 2; inner.name = 'inner'; g.add(inner);

    const outer = new THREE.Mesh(
      new THREE.RingGeometry(0.17, 0.38, 40),
      new THREE.MeshBasicMaterial({ color: 0xC8813A, ...sharedParams })
    );
    outer.rotation.x = -Math.PI / 2; outer.name = 'outer'; g.add(outer);

    _scene.add(g);
    _spotGlow = g;
  }

  // ── Ingredient lerp system ────────────────────────────────────────────────
  // Easing: smooth cubic in-out
  function _easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function _startLerp(mesh, to, duration) {
    // Cancel any existing lerp for this mesh
    _activeLerps = _activeLerps.filter(l => l.mesh !== mesh);
    _activeLerps.push({
      mesh,
      from: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
      to,
      t: 0,
      duration,
    });
  }

  // Return all currently-boarded ingredients to their original positions
  function _returnAllIngredients() {
    Object.entries(_origPositions).forEach(([slot, orig]) => {
      const m = _getMesh(slot);
      if (m) _startLerp(m, orig, 0.7);
    });
    _origPositions = {};
  }

  // Move the named ingredient to the cutting board (arc motion)
  function _moveToBoard(slot) {
    const m = _getMesh(slot);
    if (!m) return;
    if (!_origPositions[slot]) {
      _origPositions[slot] = { x: m.position.x, y: m.position.y, z: m.position.z };
    }
    _startLerp(m, { x: BOARD_CENTER.x, y: _origPositions[slot].y, z: BOARD_CENTER.z }, 0.75);
  }

  // ── Particle system ───────────────────────────────────────────────────────
  function _clearParticles() {
    _particles.forEach(p => {
      if (p.mesh && _scene) {
        _scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
      }
    });
    _particles = [];
  }

  // Steam: thin wispy planes that twist and rise (NOT spheres)
  function _spawnSteamWisps() {
    for (let i = 0; i < 7; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xEEEEE4, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthTest: false, depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.040, 0.20), mat.clone());
      mesh.visible = false;
      _scene.add(mesh);
      _particles.push({
        type: 'wisp', mesh,
        phase: Math.random(), speed: 0.17 + Math.random() * 0.13,
        ox: (Math.random() - 0.5) * 0.09, oz: (Math.random() - 0.5) * 0.09,
        rotOffset: Math.random() * Math.PI * 2,
        rotSpeed:  (Math.random() - 0.5) * 1.6,
        swayPhase: Math.random() * Math.PI * 2,
      });
    }
  }

  // Drain: elongated falling droplets + flat expanding water ripple rings
  function _spawnDrainDroplets() {
    const dropGeo = new THREE.CylinderGeometry(0.007, 0.010, 0.042, 7);
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x88BBDD, transparent: true, opacity: 0, metalness: 0.1, roughness: 0.35, depthTest: false,
      });
      const mesh = new THREE.Mesh(dropGeo, mat.clone());
      mesh.visible = false;
      _scene.add(mesh);
      _particles.push({
        type: 'droplet', mesh,
        phase: Math.random(), speed: 0.55 + Math.random() * 0.38,
        ox: (Math.random() - 0.5) * 0.11, oz: (Math.random() - 0.5) * 0.11,
        fallH: 0.33 + Math.random() * 0.14,
      });
    }
    // Expanding ripple rings on the counter surface
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x88BBDD, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthTest: false, depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0.025, 0.040, 28), mat.clone());
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      _scene.add(mesh);
      _particles.push({
        type: 'ripple', mesh,
        phase: (i / 4) + Math.random() * 0.15, // stagger starts
        speed: 0.55 + Math.random() * 0.30,
        ox: (Math.random() - 0.5) * 0.09, oz: (Math.random() - 0.5) * 0.09,
      });
    }
  }

  // Season: tumbling crystalline octahedra raining from above
  function _spawnSaltCrystals() {
    for (let i = 0; i < 16; i++) {
      const b = 0.88 + Math.random() * 0.12;
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(b, b * 0.97, b * 0.94),
        transparent: true, opacity: 0, metalness: 0.06, roughness: 0.25, depthTest: false,
      });
      const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.008 + Math.random() * 0.007, 0), mat.clone());
      mesh.visible = false;
      _scene.add(mesh);
      _particles.push({
        type: 'crystal', mesh,
        phase: Math.random(), speed: 0.38 + Math.random() * 0.32,
        ox: (Math.random() - 0.5) * 0.20, oz: (Math.random() - 0.5) * 0.20,
        fallH: 0.28 + Math.random() * 0.22,
        rx: Math.random() * Math.PI * 2, rz: Math.random() * Math.PI * 2,
        rxs: (Math.random() - 0.5) * 9,  rzs: (Math.random() - 0.5) * 7,
      });
    }
  }

  // Sparkles: warm golden octahedra burst outward (unchanged — these look great)
  function _spawnSparkles(count) {
    const geo = new THREE.OctahedronGeometry(0.017, 0);
    for (let i = 0; i < count; i++) {
      const hue = (28 + Math.random() * 22) / 360;
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(hue, 1.0, 0.60),
        transparent: true, opacity: 0, depthTest: false,
      });
      const mesh = new THREE.Mesh(geo, mat.clone());
      mesh.visible = false;
      _scene.add(mesh);
      _particles.push({
        type: 'sparkle', mesh,
        phase: Math.random() * 0.65, speed: 0.42 + Math.random() * 0.28,
        angle: (i / count) * Math.PI * 2 + Math.random() * 0.5,
        spread: 0.17 + Math.random() * 0.13,
        lift: 0.55 + Math.random() * 0.55,
        rotSpeed: (Math.random() - 0.5) * 6,
      });
    }
  }

  // ── Animation type switcher ───────────────────────────────────────────────
  function _setAnimType(type, ingPos) {
    if (_knifeGroup) _knifeGroup.visible = false;
    if (_spoonGroup) _spoonGroup.visible = false;
    _clearParticles();
    _animType = type; _animT = 0; _chopT = 0; _stirAngle = 0;

    switch (type) {
      case 'chop':
        if (_knifeGroup && ingPos) {
          // Start knife above the board center (ingredient is lerping there)
          _knifeGroup.position.set(BOARD_CENTER.x + 0.07, BOARD_Y + 0.58, BOARD_CENTER.z - 0.05);
          _knifeGroup.visible = true;
        }
        // Move ingredient to board
        {
          const step = STEPS[_currentStep];
          if (step && step.activeIngredients[0]) _moveToBoard(step.activeIngredients[0]);
        }
        break;
      case 'stir':
        if (_spoonGroup && ingPos) {
          _spoonGroup.position.set(ingPos.x, ingPos.y + 0.3, ingPos.z);
          _spoonGroup.visible = true;
        }
        break;
      case 'steam':   _spawnSteamWisps(); break;
      case 'drain':   _spawnDrainDroplets(); break;
      case 'season':  _spawnSaltCrystals(); break;
      case 'sparkle': _spawnSparkles(12); break;
    }
  }

  // ── Animation ticks ───────────────────────────────────────────────────────
  function _tickChop(dt) {
    if (!_knifeGroup) return;
    _chopT += dt;
    const CYCLE = 1.05;
    const ph = _chopT % CYCLE;

    // Knife always tracks above the board center (where ingredient is landing)
    const bx = BOARD_CENTER.x + 0.07;
    const bz = BOARD_CENTER.z - 0.05;
    const boardSurface = BOARD_Y + 0.022;

    let ky, lean;
    if (ph < 0.21) {
      ky   = _lerp(boardSurface + 0.52, boardSurface + 0.08, ph / 0.21);
      lean = _lerp(0.05, -0.20, ph / 0.21);
    } else if (ph < 0.34) {
      ky   = boardSurface + 0.08 + Math.sin((ph - 0.21) * 32) * 0.012;
      lean = -0.20;
    } else {
      const rt = (ph - 0.34) / 0.71;
      ky   = _lerp(boardSurface + 0.08, boardSurface + 0.52, rt);
      lean = _lerp(-0.20, 0.05, rt);
    }

    _knifeGroup.position.set(bx, ky, bz);
    _knifeGroup.rotation.x = lean;
  }

  function _tickStir(dt, base) {
    if (!_spoonGroup) return;
    const isMash = STEPS[_currentStep] && STEPS[_currentStep].action === 'MASH';
    if (isMash) {
      _stirAngle += dt * 2.2;
      const press = Math.abs(Math.sin(_stirAngle));
      _spoonGroup.position.set(base.x + 0.06, base.y + 0.12 + press * 0.24, base.z + 0.04);
      _spoonGroup.rotation.x = 0.38 + press * 0.32;
    } else {
      _stirAngle += dt * 1.9;
      const r = 0.11;
      _spoonGroup.position.set(
        base.x + r * Math.cos(_stirAngle),
        base.y + 0.29 + 0.028 * Math.sin(_stirAngle * 2),
        base.z + r * Math.sin(_stirAngle)
      );
      _spoonGroup.rotation.y = _stirAngle + Math.PI * 1.1;
      _spoonGroup.rotation.x = 0.20 + 0.06 * Math.sin(_stirAngle);
    }
  }

  // Unified particle tick — routes by p.type
  function _tickAllParticles(dt, base, now) {
    _particles.forEach(p => {
      p.phase = (p.phase + dt * p.speed) % 1;
      const lp = p.phase;

      switch (p.type) {

        case 'wisp': {
          // Thin plane wisp: rises, twists, sways side to side
          const fi = lp < 0.22 ? lp / 0.22 : 1;
          const fo = lp > 0.66 ? (1 - lp) / 0.34 : 1;
          p.mesh.visible = true;
          p.mesh.position.set(
            base.x + p.ox + 0.042 * Math.sin(now / 1000 * 1.3 + p.swayPhase + lp * 7),
            base.y + 0.06 + lp * 0.60,
            base.z + p.oz + 0.030 * Math.cos(now / 1000 * 0.9 + p.swayPhase)
          );
          // Always face roughly toward camera; twist slowly around Y
          p.mesh.rotation.y = p.rotOffset + p.rotSpeed * (now / 1000);
          // Lean/sway on Z gives the wispy flutter
          p.mesh.rotation.z = 0.20 * Math.sin(now / 1000 * 1.1 + p.swayPhase);
          p.mesh.material.opacity = fi * fo * 0.34;
          // Wider and taller as it rises
          p.mesh.scale.set(0.7 + 0.7 * lp, 0.9 + 0.5 * lp, 1);
          break;
        }

        case 'droplet': {
          // Elongated cylinder: falls in a parabolic arc, stretches at peak velocity
          const fi = lp < 0.08 ? lp / 0.08 : 1;
          const fo = lp > 0.86 ? (1 - lp) / 0.14 : 1;
          // Velocity proxy: sin of lifecycle — fastest at lp≈0.5
          const vel = Math.sin(lp * Math.PI);
          const y = base.y + p.fallH - (p.fallH + 0.06) * lp;
          p.mesh.visible = true;
          p.mesh.position.set(base.x + p.ox, y, base.z + p.oz);
          // Stretch along fall direction at high velocity
          p.mesh.scale.set(1.0 - vel * 0.25, 1 + vel * 2.2, 1.0 - vel * 0.25);
          p.mesh.material.opacity = fi * fo * 0.70;
          break;
        }

        case 'ripple': {
          // Flat ring expands on counter surface then fades — like water impact
          const fi = lp < 0.08 ? lp / 0.08 : 1;
          const fo = lp > 0.50 ? (1 - lp) / 0.50 : 1;
          const scale = 0.5 + lp * 3.0; // ring radius grows 0.5→3.5×
          p.mesh.visible = true;
          p.mesh.position.set(base.x + p.ox, base.y - 0.018, base.z + p.oz);
          p.mesh.scale.set(scale, scale, 1);
          p.mesh.material.opacity = fi * fo * 0.45;
          break;
        }

        case 'crystal': {
          // Tumbling octahedron rains from above, spinning on multiple axes
          const fi = lp < 0.07 ? lp / 0.07 : 1;
          const fo = lp > 0.80 ? (1 - lp) / 0.20 : 1;
          const y = base.y + p.fallH + 0.08 - (p.fallH + 0.28) * lp;
          p.mesh.visible = y > base.y - 0.04;
          p.mesh.position.set(base.x + p.ox, Math.max(y, base.y - 0.03), base.z + p.oz);
          p.mesh.rotation.x = p.rx + p.rxs * (now / 1000);
          p.mesh.rotation.z = p.rz + p.rzs * (now / 1000);
          p.mesh.material.opacity = fi * fo * 0.88;
          break;
        }

        case 'sparkle': {
          // Golden burst outward then contract — unchanged, they look great
          const r = p.spread * Math.sin(lp * Math.PI);
          p.mesh.visible = true;
          p.mesh.position.set(
            base.x + r * Math.cos(p.angle),
            base.y + 0.14 + r * p.lift,
            base.z + r * Math.sin(p.angle)
          );
          p.mesh.material.opacity = Math.sin(lp * Math.PI) * 0.92;
          p.mesh.rotation.y += dt * p.rotSpeed;
          p.mesh.rotation.x += dt * p.rotSpeed * 0.55;
          p.mesh.scale.setScalar(0.45 + Math.sin(lp * Math.PI) * 1.05);
          break;
        }
      }
    });
  }

  // ── Ingredient helpers ────────────────────────────────────────────────────
  function _getMesh(slot) {
    return (_meshes || []).find(m => m.userData.slotName === slot) || null;
  }

  function _setAllOpacity(opacity, skip) {
    (_meshes || []).forEach(m => {
      if (skip && skip.includes(m.userData.slotName)) return;
      m.traverse(c => {
        if (!c.isMesh) return;
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach(mat => { mat.transparent = opacity < 1; mat.opacity = opacity; });
      });
    });
  }

  function _setMeshFull(slot) {
    const m = _getMesh(slot);
    if (!m) return;
    m.traverse(c => {
      if (!c.isMesh) return;
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      mats.forEach(mat => { mat.transparent = false; mat.opacity = 1; });
    });
  }

  // ── Ingredient lights ─────────────────────────────────────────────────────
  function _clearLights() {
    const sc = _scene;
    _activeLights.forEach(({ light }) => {
      const i0 = light.intensity, t0 = performance.now();
      (function fade() {
        const p = (performance.now() - t0) / 380;
        if (p >= 1) { if (sc) sc.remove(light); return; }
        light.intensity = i0 * (1 - p);
        requestAnimationFrame(fade);
      })();
    });
    _activeLights = [];
  }

  function _addLight(slot) {
    const m = _getMesh(slot); if (!m || !_scene) return;
    const p = m.position;
    const light = new THREE.PointLight(0xD4883A, 0, 1.9);
    light.position.set(p.x, p.y + 0.48, p.z + 0.12);
    _scene.add(light);
    _activeLights.push({ light, startTime: performance.now() });
  }

  // ── Step renderer ─────────────────────────────────────────────────────────
  function _applyStep(idx) {
    const step = STEPS[idx]; if (!step) return;

    if (_autoAdvanceTimer) { clearTimeout(_autoAdvanceTimer); _autoAdvanceTimer = null; }
    _countdownStart = null;

    // Return any ingredients sitting on the cutting board
    _returnAllIngredients();

    // Hero band
    const hero = _q('#cg-hero');
    if (hero) hero.style.background = step.heroColor;
    _set('cg-hero-icon', step.icon);
    _set('cg-hero-verb', step.action);
    _set('cg-hero-num',  String(step.id).padStart(2, '0'));
    const ingsEl = _q('#cg-hero-ings');
    if (ingsEl) {
      ingsEl.textContent = step.activeIngredients.length
        ? step.activeIngredients.map(s => ING_EMOJI[s] || '🌿').join(' ')
        : '🍲';
    }

    // Progress
    const fill = _q('#cg-prog-fill');
    if (fill) fill.style.width = `${(step.id / TOTAL) * 100}%`;

    // Content
    _set('cg-phase',     step.phase);
    _set('cg-title',     step.title);
    _set('cg-body-text', step.body);
    const tipEl = _q('#cg-tip');
    if (tipEl) { tipEl.textContent = step.tip || ''; tipEl.style.display = step.tip ? '' : 'none'; }

    // Buttons
    const bkBtn = _q('#cg-btn-back'), nxBtn = _q('#cg-btn-next');
    if (bkBtn) bkBtn.style.display = idx === 0 ? 'none' : '';
    if (nxBtn) nxBtn.textContent = idx === TOTAL - 1 ? 'Finish \u2192' : 'Next \u2192';

    // Fade back in
    const card = _q('#cg-card');
    if (card) { card.classList.remove('cg-out'); card.classList.remove('cg-done'); }

    // Ingredient opacity + lights
    _clearLights();
    const active = step.activeIngredients;
    if (active.length) {
      _setAllOpacity(0.30, active);
      active.forEach(s => { _setMeshFull(s); _addLight(s); });
    } else {
      _setAllOpacity(1);
    }

    // Spot glow under first active ingredient
    if (_spotGlow) {
      const m = active[0] ? _getMesh(active[0]) : null;
      if (m) {
        _spotGlow.position.set(m.position.x, m.position.y - 0.04, m.position.z);
        _spotGlow.children.forEach(c => { if (c.material) c.material.opacity = 0.01; });
      } else {
        _spotGlow.children.forEach(c => { if (c.material) c.material.opacity = 0; });
      }
    }

    // 3D animation
    const firstM = active[0] ? _getMesh(active[0]) : null;
    _setAnimType(step.animType, firstM ? firstM.position : null);

    // Countdown ring
    const ring = _q('#cg-ring');
    if (ring) ring.style.display = 'none';
    if (step.duration) {
      _countdownStart = performance.now();
      if (ring) ring.style.display = 'block';
      _autoAdvanceTimer = setTimeout(() => _nextStep(), step.duration * 1000);
    }
  }

  function _renderStep(idx, skipFade) {
    const card = _q('#cg-card'); if (!card) return;
    if (skipFade) { _applyStep(idx); }
    else { card.classList.add('cg-out'); setTimeout(() => _applyStep(idx), 155); }
  }

  function _renderCompletion() {
    _clearLights();
    _setAllOpacity(1);
    _returnAllIngredients();
    _setAnimType('none', null);
    _chimeFinale();
    if (_spotGlow) _spotGlow.children.forEach(c => { if (c.material) c.material.opacity = 0; });

    const card = _q('#cg-card'); if (!card) return;
    card.classList.add('cg-out');
    setTimeout(() => {
      card.classList.remove('cg-out'); card.classList.add('cg-done');
      card.innerHTML = `
<div class="cg-done-top">
  <span class="cg-done-emoji">🍲</span>
  <div class="cg-done-title">Three Sisters Stew &mdash; complete</div>
  <div class="cg-done-sub">Baaniibaanesi-Naboob</div>
</div>
<div class="cg-done-btns">
  <button class="cg-btn-story" id="cg-btn-story" style="pointer-events:auto">Hear the story behind this dish &rarr;</button>
  <button class="cg-btn-reset" id="cg-btn-reset" style="pointer-events:auto">Cook again</button>
</div>`;
      document.getElementById('cg-btn-reset').addEventListener('click', () => reset());
      document.getElementById('cg-btn-story').addEventListener('click', () => {
        if (typeof window.launchElderStory === 'function') window.launchElderStory();
        else window.dispatchEvent(new CustomEvent('cookingguide:story'));
      });
    }, 155);
  }

  // ── Main animation loop ───────────────────────────────────────────────────
  function _tick(now) {
    _animId = requestAnimationFrame(_tick);
    const dt = Math.min((now - _lastFrame) / 1000, 0.1);
    _lastFrame = now;
    if (!_scene) return;

    const t = now / 1000;
    _animT += dt;

    // Process ingredient lerp animations (arc motion to board / back)
    _activeLerps = _activeLerps.filter(l => {
      l.t += dt / l.duration;
      const ease = _easeInOut(Math.min(l.t, 1));
      const arc  = Math.sin(Math.min(l.t, 1) * Math.PI) * 0.18; // arc height
      l.mesh.position.set(
        _lerp(l.from.x, l.to.x, ease),
        _lerp(l.from.y, l.to.y, ease) + arc,
        _lerp(l.from.z, l.to.z, ease)
      );
      return l.t < 1;
    });

    // Pulse ingredient lights
    _activeLights.forEach(({ light, startTime }) => {
      const el = (now - startTime) / 1000;
      const fi = Math.min(el / 0.38, 1);
      light.intensity = 2.4 * fi * (1 + 0.30 * Math.sin(t * 3.1));
    });

    // Spot glow pulse
    if (_spotGlow) {
      const step = STEPS[_currentStep];
      const active = step ? step.activeIngredients : [];
      const m0 = active[0] ? _getMesh(active[0]) : null;
      if (m0) {
        // Glow tracks the ingredient as it moves (e.g. to the board)
        _spotGlow.position.set(m0.position.x, m0.position.y - 0.04, m0.position.z);
        const pulse = 0.08 + 0.055 * Math.sin(t * 2.7);
        _spotGlow.children.forEach(c => {
          if (!c.material) return;
          c.material.opacity = c.name === 'inner' ? pulse : pulse * 0.45;
        });
      }
    }

    // Per-animation tick
    const step = STEPS[_currentStep];
    if (step) {
      const slot = step.activeIngredients[0];
      const ingM = slot ? _getMesh(slot) : null;
      const base = ingM ? ingM.position : null;

      switch (_animType) {
        case 'chop':    _tickChop(dt); break;
        case 'stir':    if (base) _tickStir(dt, base); break;
        default:        if (base) _tickAllParticles(dt, base, now); break;
      }
    }

    // Countdown ring
    if (_countdownStart !== null) {
      const s = STEPS[_currentStep];
      if (s && s.duration) {
        const p = Math.min((now - _countdownStart) / 1000 / s.duration, 1);
        const c = _q('#cg-ring-c');
        if (c) c.style.strokeDashoffset = (86 * (1 - p)).toFixed(2);
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function _lerp(a, b, t)  { return a + (b - a) * Math.max(0, Math.min(1, t)); }
  function _q(sel)         { return _overlayEl ? _overlayEl.querySelector(sel) : document.querySelector(sel); }
  function _set(id, v)     { const el = _q('#' + id); if (el) el.textContent = v || ''; }

  // ── Public API ────────────────────────────────────────────────────────────
  function init(scene, camera, renderer, meshes) {
    destroy();
    _scene = scene; _camera = camera; _renderer = renderer;
    _meshes = meshes || []; _currentStep = 0; _initialized = true;

    _buildCuttingBoard();
    _buildKnife();
    _buildSpoon();
    _buildSpotGlow();
    _buildOverlay();
    _renderStep(0, true);
    _chime();

    _lastFrame = performance.now();
    _animId = requestAnimationFrame(_tick);
    console.log('[CookingGuide] ready —', _meshes.length, 'meshes, cutting board placed at', BOARD_CENTER);
  }

  function goToStep(n) {
    _currentStep = Math.max(0, Math.min(n, TOTAL - 1));
    _renderStep(_currentStep); _chime();
  }

  function _nextStep() {
    if (_currentStep >= TOTAL - 1) _renderCompletion();
    else { _currentStep++; _renderStep(_currentStep); _chime(); }
  }

  function next() { _nextStep(); }

  function prev() {
    if (_currentStep <= 0) return;
    _currentStep--; _renderStep(_currentStep); _chime();
  }

  function reset() {
    if (_autoAdvanceTimer) { clearTimeout(_autoAdvanceTimer); _autoAdvanceTimer = null; }
    _clearLights(); _returnAllIngredients(); _setAnimType('none', null);
    _currentStep = 0; _countdownStart = null;
    _destroyOverlay(); _buildOverlay();
    _renderStep(0, true); _chime();
  }

  function destroy() {
    if (!_initialized) return;
    if (_animId) { cancelAnimationFrame(_animId); _animId = null; }
    if (_autoAdvanceTimer) { clearTimeout(_autoAdvanceTimer); _autoAdvanceTimer = null; }
    _clearLights(); _clearParticles(); _returnAllIngredients();
    _destroyOverlay();

    [_cuttingBoard, _knifeGroup, _spoonGroup, _spotGlow].forEach(obj => {
      if (!obj) return;
      _scene.remove(obj);
      obj.traverse(c => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      });
    });
    _cuttingBoard = _knifeGroup = _spoonGroup = _spotGlow = null;

    if (_audioCtx) { try { _audioCtx.close(); } catch (_) {} _audioCtx = null; }
    _scene = _camera = _renderer = _meshes = null;
    _currentStep = 0; _initialized = false; _isXR = false;
    _animType = 'none'; _activeLerps = []; _origPositions = {};
    console.log('[CookingGuide] destroyed');
  }

  function setXRActive(v) { _isXR = !!v; }

  return { init, goToStep, next, prev, reset, destroy, setXRActive };
})();

window.CookingGuide = CookingGuide;
