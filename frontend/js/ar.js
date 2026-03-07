/* global THREE */
'use strict';

/**
 * CookingAR — 4-Scene Storyboard
 *
 * ARRIVAL      (≈2.5s) Ingredient drops from above, bounces onto the board.
 * REVEAL       (≈3.5s) Camera orbits, ingredient rotates, traditional name fades in.
 * PREPARATION  (≈N chops) Knife chops realistically; cultural uses cycle with each chop.
 * STORY        (≈4s) Ingredient shrinks, recipe card appears; loops back to REVEAL.
 *
 * Phase 2 (async, unchanged): depth-displaced plane textured from real crop swaps in
 * during ARRIVAL and is seamlessly used by all subsequent scenes.
 *
 * Public API:
 *   CookingAR.mount(wrapperEl, imgEl, detection, contextData)
 *   CookingAR.unmount()
 */
const CookingAR = (() => {
  'use strict';

  // ── Module state ──────────────────────────────────────────────────────────────
  let _animId        = null;
  let _renderer      = null;
  let _canvas        = null;
  let _threeScene    = null;
  let _camera        = null;
  let _ingredientRef = null;   // active ingredient mesh (placeholder or depth)
  let _knifeRef      = null;
  let _overlayEl     = null;   // HTML overlay div inside ar-wrapper
  let _worldPos      = null;   // { x, y } of ingredient in world space

  // Scene state
  let _scene        = 'ARRIVAL';  // 'ARRIVAL' | 'REVEAL' | 'PREPARATION' | 'STORY'
  let _sceneT0      = 0;           // performance.now() when current scene started
  let _culturalIdx  = -1;          // which cultural use is currently shown
  let _prevChopIdx  = -1;          // last chop index seen (to detect new chops)

  // Context data from Gemini analysis
  let _ctx = null; // { traditionalNames, culturalUses, recipes, nutritionNotes }

  // ── Colour palette ───────────────────────────────────────────────────────────
  const PALETTE = [
    [['tomato','strawberry','cherry','raspberry','pepper'], 0xd32f2f],
    [['apple'],                                              0xc62828],
    [['carrot','pumpkin','sweet potato'],                   0xe65100],
    [['orange'],                                             0xf4511e],
    [['lemon','banana','corn','squash'],                    0xf9a825],
    [['broccoli','spinach','kale','zucchini','cucumber'],   0x2e7d32],
    [['celery','leek','asparagus'],                         0x558b2f],
    [['onion'],                                              0xd4824a],
    [['garlic','ginger'],                                   0xf0e6c8],
    [['potato','mushroom'],                                  0xa1887f],
    [['bread','flour','oat'],                               0xd4a96a],
    [['blueberry','grape','eggplant','plum'],               0x6a3d9a],
    [['beet'],                                               0xad1457],
  ];

  function ingredientColor(label) {
    const n = (label || '').toLowerCase();
    for (const [keys, hex] of PALETTE) if (keys.some(k => n.includes(k))) return hex;
    return 0xd4b896;
  }

  // ── PBR material helper ───────────────────────────────────────────────────────
  function pbr(color, rough, metal, cc = 0) {
    return new THREE.MeshPhysicalMaterial({
      color, roughness: rough, metalness: metal,
      clearcoat: cc, clearcoatRoughness: 0.25,
    });
  }

  // ── Bbox → world coordinates ──────────────────────────────────────────────────
  function bboxToWorld(bbox) {
    const cx = (bbox.x || 0) + (bbox.w || 0.5) / 2;
    const cy = (bbox.y || 0) + (bbox.h || 0.5) / 2;
    return { x: (cx - 0.5) * 2.6, y: -(cy - 0.5) * 1.4 };
  }

  // ── Placeholder mesh (instant, label-based) ──────────────────────────────────
  function buildPlaceholder(label) {
    const n     = (label || '').toLowerCase();
    const color = ingredientColor(label);
    const group = new THREE.Group();

    let body;
    if (['garlic','onion','tomato','apple','orange','lemon','lime','peach','plum','egg','cherry','grape','blueberry','strawberry'].some(k => n.includes(k))) {
      body = new THREE.Mesh(new THREE.SphereGeometry(0.44, 40, 28), pbr(color, 0.55, 0, 0.35));
      body.scale.set(1, n.includes('onion') ? 0.85 : n.includes('garlic') ? 0.78 : 0.92, 1);
    } else if (['carrot','cucumber','asparagus','celery','leek','banana','zucchini','beet','corn'].some(k => n.includes(k))) {
      body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.19, 0.84, 18), pbr(color, 0.60, 0, 0.20));
    } else if (['mushroom'].some(k => n.includes(k))) {
      body = new THREE.Mesh(new THREE.SphereGeometry(0.46, 32, 20), pbr(color, 0.78, 0));
      body.scale.set(1, 0.52, 1);
    } else {
      body = new THREE.Mesh(new THREE.SphereGeometry(0.44, 40, 28), pbr(color, 0.65, 0, 0.15));
    }
    body.castShadow = true;
    group.add(body);

    if (['tomato','apple','orange','lemon','garlic','onion'].some(k => n.includes(k))) {
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.018, 0.028, 0.18, 8),
        pbr(0x5d4037, 0.88, 0)
      );
      stem.position.y = 0.44;
      group.add(stem);
    }
    return group;
  }

  // ── Depth mesh (Phase 2 — async, matches actual photo) ──────────────────────
  async function buildDepthMesh(imgEl, bbox) {
    const nw = imgEl.naturalWidth, nh = imgEl.naturalHeight;
    if (!nw || !nh) return null;

    const cw = Math.max(32, Math.round((bbox.w || 0.5) * nw));
    const ch = Math.max(32, Math.round((bbox.h || 0.5) * nh));
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width  = cw;
    cropCanvas.height = ch;
    cropCanvas.getContext('2d').drawImage(
      imgEl,
      (bbox.x || 0) * nw, (bbox.y || 0) * nh,
      (bbox.w || 1)  * nw, (bbox.h || 1) * nh,
      0, 0, cw, ch
    );
    const cropDataUrl = cropCanvas.toDataURL('image/jpeg', 0.90);
    const cropBlob    = await new Promise(r => cropCanvas.toBlob(r, 'image/jpeg', 0.90));
    if (!cropBlob) return null;

    const form = new FormData();
    form.append('crop', cropBlob, 'crop.jpg');
    let depthDataUrl = null;
    try {
      const res = await fetch('/api/hf/depth', {
        method: 'POST', body: form,
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const data = await res.json();
        depthDataUrl = data.depthMap || null;
        console.log('[CookingAR] depth model:', data.model);
      }
    } catch (e) {
      console.log('[CookingAR] depth fetch failed:', e.message);
    }

    return new Promise(resolve => {
      const SEG  = 80;
      const geo  = new THREE.PlaneGeometry(1.1, 1.1, SEG, SEG);
      const cropTex    = new THREE.TextureLoader().load(cropDataUrl);
      cropTex.encoding = THREE.sRGBEncoding;
      const matParams  = { map: cropTex, roughness: 0.68, metalness: 0.0, side: THREE.FrontSide };

      if (depthDataUrl) {
        const depthTex              = new THREE.TextureLoader().load(depthDataUrl);
        matParams.displacementMap   = depthTex;
        matParams.displacementScale = 0.42;
        matParams.displacementBias  = -0.10;
      }

      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial(matParams));
      mesh.castShadow    = true;
      mesh.receiveShadow = true;
      mesh.rotation.x    = -Math.PI * 0.28;
      setTimeout(() => resolve(mesh), 150);
    });
  }

  // ── Chef's knife (ExtrudeGeometry) ─────────────────────────────────────────
  function buildKnife() {
    const group      = new THREE.Group();
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(0.002, -0.34);
    bladeShape.quadraticCurveTo(0.092, -0.02, 0.10, 0.36);
    bladeShape.lineTo(-0.004, 0.36);
    bladeShape.quadraticCurveTo(-0.008, 0.04, 0.002, -0.34);

    const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, {
      depth: 0.009, bevelEnabled: true,
      bevelThickness: 0.0015, bevelSize: 0.0012, bevelSegments: 2,
    });
    bladeGeo.translate(-0.05, 0, -0.0045);
    group.add(new THREE.Mesh(bladeGeo, pbr(0xeaeaea, 0.04, 0.96, 1.0)));

    const bolster = new THREE.Mesh(
      new THREE.BoxGeometry(0.076, 0.052, 0.052),
      pbr(0xbdbdbd, 0.20, 0.90)
    );
    bolster.position.y = 0.386;
    group.add(bolster);

    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.090, 0.30, 0.044),
      pbr(0x2c1a0e, 0.86, 0)
    );
    handle.position.y = 0.537;
    handle.castShadow = true;
    group.add(handle);

    [0.50, 0.575].forEach(y => {
      const rivet = new THREE.Mesh(
        new THREE.CylinderGeometry(0.011, 0.011, 0.048, 10),
        pbr(0x9e9e9e, 0.32, 0.82)
      );
      rivet.rotation.x = Math.PI / 2;
      rivet.position.set(0, y, 0);
      group.add(rivet);
    });
    return group;
  }

  // ── Cutting board ─────────────────────────────────────────────────────────
  function buildBoard() {
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.075, 1.30),
      pbr(0x8d5524, 0.88, 0)
    );
    board.receiveShadow = true;
    const grainMat = pbr(0x6d4c41, 0.93, 0);
    [-0.28, -0.08, 0.12, 0.32].forEach(z => {
      const grain = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.001, 0.010), grainMat);
      grain.position.set(0, 0.04, z);
      board.add(grain);
    });
    return board;
  }

  // ── Three.js scene setup ──────────────────────────────────────────────────
  function setupScene(wrapperEl) {
    const rect   = wrapperEl.getBoundingClientRect();
    const dpr    = Math.min(window.devicePixelRatio || 1, 2);
    const cw     = Math.round(rect.width  * dpr);
    const ch     = Math.round(rect.height * dpr);
    const aspect = cw / ch || 1;

    const canvas         = document.createElement('canvas');
    canvas.className     = 'ar-canvas';
    canvas.width         = cw;
    canvas.height        = ch;
    canvas.style.cssText = `width:${rect.width}px;height:${rect.height}px;display:block;`;
    wrapperEl.appendChild(canvas);
    _canvas = canvas;

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, aspect, 0.1, 100);
    camera.position.set(0, 1.8, 3.4);
    camera.lookAt(0, 0.1, 0);

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true });
    renderer.setSize(cw, ch, false);
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x111318, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    _renderer = renderer;

    scene.add(new THREE.AmbientLight(0x8090b0, 0.9));
    const key = new THREE.DirectionalLight(0xfff0d0, 1.6);
    key.position.set(3, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5; key.shadow.camera.far  = 20;
    key.shadow.camera.left = -3;  key.shadow.camera.right = 3;
    key.shadow.camera.top  = 3;   key.shadow.camera.bottom = -3;
    key.shadow.bias = -0.0008;
    scene.add(key);
    scene.add(Object.assign(new THREE.DirectionalLight(0xb0c8ff, 0.55), { position: new THREE.Vector3(-4, 2, -2) }));
    scene.add(Object.assign(new THREE.DirectionalLight(0xffffff, 0.35), { position: new THREE.Vector3(0, -2, -5) }));

    return { scene, camera, renderer };
  }

  // ── Overlay (HTML) – fades in contextual text over the canvas ───────────
  function buildOverlay(wrapperEl) {
    const el = document.createElement('div');
    el.className = 'ar-storyboard-overlay';
    el.innerHTML = `
      <div class="aro-name"    id="aro-name"></div>
      <div class="aro-cultural" id="aro-cultural"></div>
      <div class="aro-recipe"  id="aro-recipe"></div>
    `;
    wrapperEl.appendChild(el);
    _overlayEl = el;
  }

  function _overlayEl_get(id) { return _overlayEl ? _overlayEl.querySelector('#' + id) : null; }

  function showOverlayCard(id, html, visible) {
    const el = _overlayEl_get(id);
    if (!el) return;
    if (html !== null) el.innerHTML = html;
    el.classList.toggle('aro--visible', !!visible);
  }

  /** Called on scene transition — hides all, then shows what belongs in that scene */
  function syncOverlayForScene(sceneName) {
    ['aro-name','aro-cultural','aro-recipe'].forEach(id => showOverlayCard(id, null, false));
    _culturalIdx = -1;
    _prevChopIdx = -1;
    if (sceneName === 'REVEAL' || sceneName === 'PREPARATION') {
      const names = _ctx?.indigenousContext?.traditionalNames;
      if (names?.length) {
        const { nation, name } = names[0];
        showOverlayCard('aro-name', `
          <span class="aro-nation">${escapeCtx(nation)}</span>
          <span class="aro-word">${escapeCtx(name)}</span>
        `, true);
      }
    }
  }

  function escapeCtx(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Scene helpers ─────────────────────────────────────────────────────────

  function lerp(a, b, t) { return a + (b - a) * Math.min(Math.max(t, 0), 1); }

  function advanceScene(name) {
    if (_scene === name) return;
    console.log(`[CookingAR] ${_scene} → ${name}`);
    _scene    = name;
    _sceneT0  = performance.now();
    syncOverlayForScene(name);
  }

  // ── SCENE 1: ARRIVAL ──────────────────────────────────────────────────────
  // Ingredient drops from above with damped-bounce physics.
  const ARRIVAL = {
    FALL_DUR: 0.65,
    BOUNCES:  [{ h: 0.55, d: 0.32 }, { h: 0.20, d: 0.22 }, { h: 0.07, d: 0.15 }],
    SETTLE_PAUSE: 0.35,
  };

  function tickArrival(t, pos) {
    const landY  = pos.y;
    const startY = landY + 3.2;
    const { FALL_DUR, BOUNCES, SETTLE_PAUSE } = ARRIVAL;

    if (t < FALL_DUR) {
      // Quadratic free-fall
      const p = t / FALL_DUR;
      if (_ingredientRef) _ingredientRef.position.y = lerp(startY, landY, p * p);
      return;
    }

    let bt = t - FALL_DUR;
    for (const { h, d } of BOUNCES) {
      if (bt < d) {
        const p = bt / d;
        if (_ingredientRef) _ingredientRef.position.y = landY + h * 4 * p * (1 - p);
        return;
      }
      bt -= d;
    }

    // Settled
    if (_ingredientRef) _ingredientRef.position.y = landY;
    const totalBounce = BOUNCES.reduce((s, b) => s + b.d, 0);
    if (t > FALL_DUR + totalBounce + SETTLE_PAUSE) advanceScene('REVEAL');
  }

  // ── SCENE 2: REVEAL ───────────────────────────────────────────────────────
  // Camera orbits 30° over 2s. Ingredient rotates. Name badge shown.
  function tickReveal(t) {
    const ORBIT_DUR = 2.0;
    const angle = lerp(0, Math.PI / 6, Math.min(t / ORBIT_DUR, 1));
    const radius = 3.4;
    _camera.position.x = Math.sin(angle) * radius;
    _camera.position.z = Math.cos(angle) * radius;
    _camera.lookAt(0, 0.1, 0);

    if (_ingredientRef) _ingredientRef.rotation.y += 0.007;

    if (t > 3.8) advanceScene('PREPARATION');
  }

  // ── SCENE 3: PREPARATION — realistic chop + cultural use cycling ──────────
  const CHOP_CYCLE  = 1.5;  // seconds per full chop
  const CHOP_DOWN   = 0.28; // fast descent (fraction of cycle)
  const CHOP_PAUSE  = 0.22; // impact pause
  // retract = remaining fraction

  function tickPreparation(t, pos) {
    const knifeBaseY  = pos.y + 0.82;
    const knifeRestY  = knifeBaseY + 0.75;
    const knifeImpactY = knifeBaseY - 0.28;
    const chopT       = t % CHOP_CYCLE;
    const chopIdx     = Math.floor(t / CHOP_CYCLE);

    if (_knifeRef) {
      let knifeY;
      if (chopT < CHOP_DOWN) {
        // Fast descent
        knifeY = lerp(knifeRestY, knifeImpactY, chopT / CHOP_DOWN);
      } else if (chopT < CHOP_DOWN + CHOP_PAUSE) {
        // Impact pause with tiny wobble
        knifeY = knifeImpactY + Math.sin((chopT - CHOP_DOWN) * 40) * 0.012;
        // Squish at first frame of impact
        if (_ingredientRef) _ingredientRef.scale.y = Math.max(0.68, _ingredientRef.scale.y - 0.15);
      } else {
        // Slow retract
        const retractT = (chopT - CHOP_DOWN - CHOP_PAUSE) / (CHOP_CYCLE - CHOP_DOWN - CHOP_PAUSE);
        knifeY = lerp(knifeImpactY, knifeRestY, retractT);
      }
      _knifeRef.position.y  = knifeY;
      _knifeRef.rotation.z  = Math.sin(chopT * 2.1) * 0.04;
    }

    // Ingredient scale recovery toward 1
    if (_ingredientRef) {
      _ingredientRef.scale.y = lerp(_ingredientRef.scale.y, 1.0, 0.10);
    }

    // Cycle cultural use text on each new chop
    const uses = _ctx?.indigenousContext?.culturalUses;
    if (uses?.length && chopIdx !== _prevChopIdx) {
      _prevChopIdx  = chopIdx;
      const useIdx  = chopIdx % uses.length;
      _culturalIdx  = useIdx;
      showOverlayCard('aro-cultural', `<span>${escapeCtx(uses[useIdx])}</span>`, true);
    }

    // Advance after enough chops (show all uses at least once + 2 extra)
    const minChops = Math.max(5, (uses?.length || 0) + 2);
    if (chopIdx >= minChops) advanceScene('STORY');
  }

  // ── SCENE 4: STORY — recipe reveal, then loop to REVEAL ─────────────────
  function tickStory(t) {
    // Ingredient shrinks
    if (_ingredientRef) {
      const s = lerp(_ingredientRef.scale.x, 0, 0.04);
      _ingredientRef.scale.set(s, s, s);
    }

    // Show recipe card after 0.4s
    if (t > 0.4) {
      const r = _ctx?.recipes?.[0];
      if (r) {
        showOverlayCard('aro-recipe', `
          <span class="aro-recipe__name">${escapeCtx(r.name)}</span>
          <span class="aro-recipe__desc">${escapeCtx(r.description)}</span>
        `, true);
      } else {
        const note = _ctx?.nutritionNotes;
        if (note) showOverlayCard('aro-recipe', `<span>${escapeCtx(note)}</span>`, true);
      }
    }

    // After 4s, restore ingredient and loop back to REVEAL
    if (t > 4.2) {
      if (_ingredientRef) _ingredientRef.scale.set(1, 1, 1);
      showOverlayCard('aro-recipe', null, false);
      advanceScene('REVEAL');
    }
  }

  // ── Main animation loop ────────────────────────────────────────────────────
  function startAnimation(renderer, scene, camera, pos) {
    _threeScene = scene;
    _camera     = camera;
    let orb = 0;

    function loop(now) {
      _animId = requestAnimationFrame(loop);
      const t = (now - _sceneT0) / 1000;

      // Subtle camera drift (active only in PREPARATION to keep it feeling alive)
      if (_scene === 'PREPARATION') {
        orb += 0.0015;
        const base = Math.PI / 6;
        _camera.position.x = Math.sin(base + Math.sin(orb) * 0.12) * 3.4;
        _camera.position.z = Math.cos(base + Math.sin(orb) * 0.12) * 3.4;
        _camera.lookAt(0, 0.1, 0);
      }

      switch (_scene) {
        case 'ARRIVAL':     tickArrival(t, pos);     break;
        case 'REVEAL':      tickReveal(t);            break;
        case 'PREPARATION': tickPreparation(t, pos);  break;
        case 'STORY':       tickStory(t);             break;
      }

      renderer.render(scene, camera);
    }

    loop(performance.now());
  }

  // ── Public: mount ─────────────────────────────────────────────────────────
  async function mount(wrapperEl, imgEl, detection, contextData) {
    unmount();
    _ctx = contextData || null;

    if (!window.THREE) { console.error('[CookingAR] THREE not loaded'); _clearSpinner(); return; }

    try {
      // Wait for wrapper to have real dimensions
      await new Promise(resolve => {
        const check = () => wrapperEl.getBoundingClientRect().width > 10
          ? resolve() : setTimeout(check, 50);
        setTimeout(check, 40);
      });

      const { scene, camera, renderer } = setupScene(wrapperEl);
      const pos = bboxToWorld(detection);
      console.log('[CookingAR] pos:', pos, 'label:', detection.name);

      // Cutting board
      const board = buildBoard();
      board.position.set(pos.x, pos.y - 0.64, 0);
      scene.add(board);

      // Placeholder ingredient — starts high for ARRIVAL drop
      const placeholder = buildPlaceholder(detection.name || '');
      placeholder.position.set(pos.x, pos.y + 3.2, 0); // high up for ARRIVAL
      placeholder.userData.baseY = pos.y;
      scene.add(placeholder);
      _ingredientRef = placeholder;
      _worldPos      = pos;

      // Knife — hidden until PREPARATION (positioned above frame)
      const knife = buildKnife();
      knife.name = 'knife';
      knife.position.set(pos.x + 0.08, pos.y + 3, 0.32); // out of view initially
      scene.add(knife);
      _knifeRef = knife;

      // Build HTML overlay
      buildOverlay(wrapperEl);

      _clearSpinner();

      // Start scene engine at ARRIVAL
      _scene   = 'ARRIVAL';
      _sceneT0 = performance.now();
      startAnimation(renderer, scene, camera, pos);

      // Bring knife into play on PREPARATION
      // (We poll _scene so knife slides into position when the scene changes)
      const knifeIntroInterval = setInterval(() => {
        if (_scene === 'PREPARATION' || _scene === 'STORY') {
          // Knife is now managed by tickPreparation
          clearInterval(knifeIntroInterval);
        } else if (_scene === 'ARRIVAL' || _scene === 'REVEAL') {
          // Keep knife parked above view
          if (_knifeRef) _knifeRef.position.y = pos.y + 3;
        }
      }, 200);

      // ── Phase 2: async depth mesh — swaps in during ARRIVAL/REVEAL ──────
      buildDepthMesh(imgEl, detection).then(depthMesh => {
        if (!depthMesh || !_renderer) return;
        scene.remove(placeholder);
        placeholder.traverse(c => { if (c.geometry) c.geometry.dispose(); });

        depthMesh.position.set(pos.x, _ingredientRef ? _ingredientRef.position.y : pos.y, 0);
        depthMesh.userData.baseY = pos.y;
        scene.add(depthMesh);
        _ingredientRef = depthMesh;
        console.log('[CookingAR] depth mesh swapped in');
      }).catch(err => {
        console.log('[CookingAR] keeping placeholder:', err.message);
      });

    } catch (err) {
      console.error('[CookingAR] mount error:', err);
      _clearSpinner();
    }
  }

  // ── Public: unmount ───────────────────────────────────────────────────────
  function unmount() {
    if (_animId)    { cancelAnimationFrame(_animId); _animId = null; }
    if (_renderer)  { _renderer.dispose(); _renderer = null; }
    if (_canvas)    { _canvas.remove(); _canvas = null; }
    if (_overlayEl) { _overlayEl.remove(); _overlayEl = null; }
    _ingredientRef = null;
    _knifeRef      = null;
    _threeScene    = null;
    _camera        = null;
    _worldPos      = null;
    _scene         = 'ARRIVAL';
    _culturalIdx   = -1;
    _prevChopIdx   = -1;
    _ctx           = null;
  }

  function _clearSpinner() {
    const b = document.getElementById('ar-loading');
    if (b) b.remove();
  }

  return { mount, unmount };
})();
