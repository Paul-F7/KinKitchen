/* global THREE */
'use strict';

/**
 * Step3Garlic — Full pipeline orchestrator for Step 3 (Smash & Mince the Garlic)
 *
 * Phases (executed in strict order, one at a time):
 *   1. IDLE            — waiting for user to click "Start Cutting"
 *   2. MOVE_BOARD      — cutting board slides in from the right to centre
 *   3. MOVE_GARLIC     — garlic hovers smoothly to the cutting board
 *   4. KNIFE_ENTER_FLAT— knife descends rotated flat (blade sideways for smashing)
 *   5. SMASHING        — flat knife slams down; garlic squishes, skin particles fly
 *   6. KNIFE_ROTATE    — knife smoothly rotates from flat back to blade-down
 *   7. MINCING         — quick rock-chops; garlic shrinks, minced pile grows
 *   8. KNIFE_EXIT      — knife rises and fades out
 *   9. MOVE_PILE       — minced garlic glides to final resting position
 *  10. SLIDE_BOARD_OUT — cutting board slides back off-screen
 *  11. DONE            — pipeline complete, pile remains
 *
 * API (called by CookingGuide):
 *   Step3Garlic.init(scene)
 *   Step3Garlic.start({ ingredient, knifeGroup, mincedGarlic, pileFinalScale,
 *                       chopTarget, boardCenter, boardY, origPosition,
 *                       cuttingBoard, onComplete })
 *   Step3Garlic.tick(dt)
 *   Step3Garlic.isChopping()
 *   Step3Garlic.cleanup()
 *   Step3Garlic.destroy()
 */
const Step3Garlic = (() => {

  // ── Phases ───────────────────────────────────────────────────────────────
  const PHASE = {
    IDLE:            'IDLE',
    MOVE_BOARD:      'MOVE_BOARD',
    MOVE_GARLIC:     'MOVE_GARLIC',
    KNIFE_ENTER_FLAT:'KNIFE_ENTER_FLAT',
    SMASHING:        'SMASHING',
    KNIFE_ROTATE:    'KNIFE_ROTATE',
    MINCING:         'MINCING',
    KNIFE_EXIT:      'KNIFE_EXIT',
    MOVE_PILE:       'MOVE_PILE',
    SLIDE_BOARD_OUT: 'SLIDE_BOARD_OUT',
    DONE:            'DONE',
  };

  // ── Shared timing ──────────────────────────────────────────────────────
  const MOVE_BOARD_DUR      = 1.0;
  const MOVE_GARLIC_DUR     = 1.2;
  const KNIFE_ENTER_DUR     = 0.9;
  const KNIFE_EXIT_DUR      = 0.8;
  const MOVE_PILE_DUR       = 1.0;
  const SLIDE_BOARD_OUT_DUR = 1.0;

  // ── Smash phase ────────────────────────────────────────────────────────
  const SMASH_HITS          = 3;
  const SMASH_CYCLE         = 1.0;      // seconds per slam cycle
  const SMASH_DOWNSWING_END = 0.40;     // longer downswing = heavier slam
  const SMASH_VIBRATE_END   = 0.55;
  const SKIN_COLOR          = 0xE8DCC8; // papery garlic skin
  const SKIN_PER_HIT        = 8;

  // ── Knife rotation transition ──────────────────────────────────────────
  const KNIFE_ROTATE_DUR    = 0.5;

  // ── Mince phase ────────────────────────────────────────────────────────
  const MINCE_HITS          = 3;
  const MINCE_CYCLE         = 0.8;      // quick rock-chops
  const MINCE_DOWNSWING_END = 0.30;
  const MINCE_VIBRATE_END   = 0.42;
  const MINCE_COLOR         = 0xF5E6C8; // cream/yellow minced bits
  const BITS_PER_HIT        = 10;
  const BIT_SCALE           = 0.002;
  const BIT_GROW_DUR        = 0.5;

  // ── Easing helpers ─────────────────────────────────────────────────────
  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }
  function easeInQuad(t)  { return t * t; }
  function lerp(a, b, t)  { return a + (b - a) * Math.max(0, Math.min(1, t)); }

  // ── State ──────────────────────────────────────────────────────────────
  let _scene        = null;
  let _phase        = PHASE.IDLE;
  let _phaseT       = 0;
  let _completed    = false;

  // References (set via start())
  let _ingredient     = null;   // the garlic mesh
  let _knifeGroup     = null;
  let _mincedGarlic   = null;   // minced-garlic Three.Group
  let _pileFinalScale = 1;
  let _chopTarget     = null;   // { x, y, z } landing spot on board
  let _boardCenter    = null;
  let _boardY         = 0;
  let _origPos        = null;   // garlic original position
  let _origScale      = 1;
  let _origRot        = null;
  let _onComplete     = null;
  let _cuttingBoard   = null;
  let _boardEndPos    = null;
  let _pileStartPos   = null;
  let _pileFinalPos   = null;   // passed in from cookingGuide

  // Knife positioning
  let _knifeRestX   = 0;
  let _knifeRestZ   = 0;
  let _knifeSurface = 0;
  let _knifeTopY    = 0;
  let _knifeEntryY  = 0;

  // Smash state
  let _smashT         = 0;
  let _smashPrevCycle = 0;
  let _smashHitCount  = 0;

  // Mince state
  let _minceT         = 0;
  let _mincePrevCycle = 0;
  let _minceHitCount  = 0;

  // Particles (skin flakes + mince bits)
  let _particles = [];   // [{ mesh, targetScale, age }]

  // ── Init ───────────────────────────────────────────────────────────────
  function init(scene) {
    _scene = scene;
    console.log('[Step3Garlic] initialized');
  }

  // ── Start pipeline ─────────────────────────────────────────────────────
  function start(opts) {
    cleanup();
    _completed = false;

    _ingredient     = opts.ingredient;
    _knifeGroup     = opts.knifeGroup;
    _mincedGarlic   = opts.mincedGarlic;
    _pileFinalScale = opts.pileFinalScale || 1;
    _chopTarget     = opts.chopTarget;
    _boardCenter    = opts.boardCenter;
    _boardY         = opts.boardY;
    _origPos        = opts.origPosition;
    _origScale      = _ingredient ? _ingredient.scale.x : 1;
    _origRot        = _ingredient ? {
      x: _ingredient.rotation.x,
      y: _ingredient.rotation.y,
      z: _ingredient.rotation.z,
    } : { x: 0, y: 0, z: 0 };
    _onComplete     = opts.onComplete || null;
    _cuttingBoard   = opts.cuttingBoard || null;
    _pileFinalPos   = opts.pileFinalPos || { x: 1.2118, y: 3.0039, z: -0.4023 };

    // Pre-compute knife positions relative to chop target
    _knifeRestX   = _chopTarget.x + 0.07;
    _knifeRestZ   = _chopTarget.z - 0.05;
    _knifeSurface = _chopTarget.y + 0.022;
    _knifeTopY    = _knifeSurface + 0.35;  // lower top than step1/2 for smashing feel
    _knifeEntryY  = _knifeTopY + 0.4;

    // Hide knife and pile initially
    if (_knifeGroup) {
      _knifeGroup.visible = false;
      _knifeGroup.position.set(_knifeRestX, _knifeEntryY, _knifeRestZ);
      _knifeGroup.rotation.set(0, 0, 0);
      _setKnifeOpacity(0);
    }
    if (_mincedGarlic) {
      _mincedGarlic.visible = false;
      _mincedGarlic.scale.setScalar(0.001);
    }

    // Set up cutting board fade-in in place
    if (_cuttingBoard) {
      _boardEndPos = {
        x: _cuttingBoard.position.x,
        y: _cuttingBoard.position.y,
        z: _cuttingBoard.position.z,
      };
      _cuttingBoard.visible = true;
      _setBoardOpacity(0);
      _enterPhase(PHASE.MOVE_BOARD);
    } else {
      _enterPhase(PHASE.MOVE_GARLIC);
    }
  }

  // ── Phase transitions ─────────────────────────────────────────────────
  function _enterPhase(phase) {
    _phase  = phase;
    _phaseT = 0;
    console.log('[Step3Garlic] phase →', phase);

    if (phase === PHASE.SMASHING) {
      _smashT         = 0;
      _smashPrevCycle = 0;
      _smashHitCount  = 0;
    }
    if (phase === PHASE.MINCING) {
      _minceT         = 0;
      _mincePrevCycle = 0;
      _minceHitCount  = 0;
      // Pre-show minced pile at one slice worth of scale before first hit
      if (_mincedGarlic) {
        _mincedGarlic.visible = true;
        _mincedGarlic.scale.setScalar(_pileFinalScale / MINCE_HITS);
      }
    }
    if (phase === PHASE.DONE) {
      _completed = true;
    }
  }

  // ── Main tick ──────────────────────────────────────────────────────────
  function tick(dt) {
    _phaseT += dt;

    switch (_phase) {
      case PHASE.IDLE:            return;
      case PHASE.MOVE_BOARD:      _tickMoveBoard();       break;
      case PHASE.MOVE_GARLIC:     _tickMoveGarlic();      break;
      case PHASE.KNIFE_ENTER_FLAT:_tickKnifeEnterFlat();  break;
      case PHASE.SMASHING:        _tickSmashing(dt);      break;
      case PHASE.KNIFE_ROTATE:    _tickKnifeRotate();     break;
      case PHASE.MINCING:         _tickMincing(dt);       break;
      case PHASE.KNIFE_EXIT:      _tickKnifeExit();       break;
      case PHASE.MOVE_PILE:       _tickMovePile();        break;
      case PHASE.SLIDE_BOARD_OUT: _tickSlideBoardOut();   break;
      case PHASE.DONE:            return;
    }

    // Always tick particles
    _tickParticles(dt);
  }

  // ── Phase: Fade cutting board in place ─────────────────────────────────
  function _tickMoveBoard() {
    if (!_cuttingBoard || !_boardEndPos) {
      _enterPhase(PHASE.MOVE_GARLIC);
      return;
    }
    const t = Math.min(_phaseT / MOVE_BOARD_DUR, 1);
    _setBoardOpacity(easeInOutCubic(t));
    if (t >= 1) {
      _setBoardOpacity(1);
      _enterPhase(PHASE.MOVE_GARLIC);
    }
  }

  // ── Phase: Move garlic to board ────────────────────────────────────────
  function _tickMoveGarlic() {
    if (!_ingredient || !_chopTarget) return;
    const t = Math.min(_phaseT / MOVE_GARLIC_DUR, 1);
    const ease = easeInOutCubic(t);
    const arc  = Math.sin(t * Math.PI) * 0.15;
    _ingredient.position.set(
      lerp(_origPos.x, _chopTarget.x, ease),
      lerp(_origPos.y, _chopTarget.y, ease) + arc,
      lerp(_origPos.z, _chopTarget.z, ease)
    );
    if (t >= 1) {
      _ingredient.position.set(_chopTarget.x, _chopTarget.y, _chopTarget.z);
      _enterPhase(PHASE.KNIFE_ENTER_FLAT);
    }
  }

  // ── Phase: Knife enters FLAT (rotated 90° on Z) ───────────────────────
  function _tickKnifeEnterFlat() {
    if (!_knifeGroup) { _enterPhase(PHASE.SMASHING); return; }
    const t = Math.min(_phaseT / KNIFE_ENTER_DUR, 1);
    const ease = easeOutQuad(t);

    _knifeGroup.visible = true;
    _knifeGroup.position.set(
      _knifeRestX,
      lerp(_knifeEntryY, _knifeTopY, ease),
      _knifeRestZ
    );
    // Enter already rotated flat
    _knifeGroup.rotation.x = lerp(0.3, 0.05, ease);
    _knifeGroup.rotation.z = Math.PI / 2;  // blade flat
    _setKnifeOpacity(ease);

    if (t >= 1) {
      _setKnifeOpacity(1);
      _enterPhase(PHASE.SMASHING);
    }
  }

  // ── Phase: SMASHING (flat knife slams) ─────────────────────────────────
  function _tickSmashing(dt) {
    if (!_knifeGroup || _smashHitCount >= SMASH_HITS) {
      _enterPhase(PHASE.KNIFE_ROTATE);
      return;
    }

    _smashT += dt;
    const cyclePos = _smashT % SMASH_CYCLE;
    const norm     = cyclePos / SMASH_CYCLE;

    // Detect hit: crossed from downswing into vibrate
    if (_smashPrevCycle / SMASH_CYCLE < SMASH_DOWNSWING_END && norm >= SMASH_DOWNSWING_END) {
      _onSmashHit();
    }
    _smashPrevCycle = cyclePos;

    // Knife vertical position (shorter travel for smashing)
    const smashTopY = _knifeSurface + 0.25; // lower than chop
    let ky, lean;
    if (norm < SMASH_DOWNSWING_END) {
      const p = norm / SMASH_DOWNSWING_END;
      ky   = lerp(smashTopY, _knifeSurface + 0.04, easeInQuad(p));
      lean = lerp(0.05, -0.10, p);
    } else if (norm < SMASH_VIBRATE_END) {
      ky   = _knifeSurface + 0.04 + Math.sin((norm - SMASH_DOWNSWING_END) * SMASH_CYCLE * 40) * 0.008;
      lean = -0.10;
    } else {
      const p = (norm - SMASH_VIBRATE_END) / (1 - SMASH_VIBRATE_END);
      ky   = lerp(_knifeSurface + 0.04, smashTopY, easeOutQuad(p));
      lean = lerp(-0.10, 0.05, p);
    }

    _knifeGroup.position.set(_knifeRestX, ky, _knifeRestZ);
    _knifeGroup.rotation.x = lean;
    _knifeGroup.rotation.z = Math.PI / 2; // keep flat
  }

  // ── Smash hit handler ──────────────────────────────────────────────────
  function _onSmashHit() {
    _smashHitCount++;
    console.log('[Step3Garlic] smash', _smashHitCount, '/', SMASH_HITS);

    // Squish the garlic: flatten Y, expand X/Z
    if (_ingredient) {
      const sy = _ingredient.scale.y * 0.5;
      const sx = _ingredient.scale.x * 1.15;
      const sz = _ingredient.scale.z * 1.15;
      _ingredient.scale.set(sx, sy, sz);
    }

    // Spawn skin-colored particles (papery flakes)
    for (let i = 0; i < SKIN_PER_HIT; i++) {
      _spawnParticle(SKIN_COLOR, 0.003, true);
    }

    // After final smash, let upswing finish then transition
    if (_smashHitCount >= SMASH_HITS) {
      const remaining = SMASH_CYCLE * (1 - SMASH_VIBRATE_END);
      setTimeout(() => {
        if (_phase === PHASE.SMASHING) _enterPhase(PHASE.KNIFE_ROTATE);
      }, remaining * 1000);
    }
  }

  // ── Phase: Knife rotates from flat to blade-down ───────────────────────
  function _tickKnifeRotate() {
    if (!_knifeGroup) { _enterPhase(PHASE.MINCING); return; }
    const t = Math.min(_phaseT / KNIFE_ROTATE_DUR, 1);
    const ease = easeInOutCubic(t);

    // Lift slightly during rotation
    const liftY = _knifeSurface + 0.25 + Math.sin(t * Math.PI) * 0.08;
    _knifeGroup.position.set(_knifeRestX, liftY, _knifeRestZ);

    // Rotate from flat (PI/2) back to upright (0)
    _knifeGroup.rotation.z = lerp(Math.PI / 2, 0, ease);
    _knifeGroup.rotation.x = 0.05;

    if (t >= 1) {
      _knifeGroup.rotation.z = 0;
      _enterPhase(PHASE.MINCING);
    }
  }

  // ── Phase: MINCING (quick rock-chops) ──────────────────────────────────
  function _tickMincing(dt) {
    if (!_knifeGroup || _minceHitCount >= MINCE_HITS) {
      _enterPhase(PHASE.KNIFE_EXIT);
      return;
    }

    _minceT += dt;
    const cyclePos = _minceT % MINCE_CYCLE;
    const norm     = cyclePos / MINCE_CYCLE;

    // Detect hit
    if (_mincePrevCycle / MINCE_CYCLE < MINCE_DOWNSWING_END && norm >= MINCE_DOWNSWING_END) {
      _onMinceHit();
    }
    _mincePrevCycle = cyclePos;

    // Shorter, quicker strokes
    const minceTopY = _knifeSurface + 0.20;
    let ky, lean;
    if (norm < MINCE_DOWNSWING_END) {
      const p = norm / MINCE_DOWNSWING_END;
      ky   = lerp(minceTopY, _knifeSurface + 0.06, easeInQuad(p));
      lean = lerp(0.05, -1.2, p);
    } else if (norm < MINCE_VIBRATE_END) {
      ky   = _knifeSurface + 0.06 + Math.sin((norm - MINCE_DOWNSWING_END) * MINCE_CYCLE * 36) * 0.008;
      lean = -1.2;
    } else {
      const p = (norm - MINCE_VIBRATE_END) / (1 - MINCE_VIBRATE_END);
      ky   = lerp(_knifeSurface + 0.06, minceTopY, easeOutQuad(p));
      lean = lerp(-1.2, 0.05, p);
    }

    _knifeGroup.position.set(_knifeRestX, ky, _knifeRestZ);
    _knifeGroup.rotation.x = lean;
    _knifeGroup.rotation.z = 0; // blade down
  }

  // ── Mince hit handler ──────────────────────────────────────────────────
  function _onMinceHit() {
    _minceHitCount++;
    console.log('[Step3Garlic] mince', _minceHitCount, '/', MINCE_HITS);

    // Shrink the flattened garlic uniformly
    if (_ingredient) {
      const shrink = Math.max(0, 1 - (_minceHitCount / MINCE_HITS));
      // Keep the squished proportions but scale everything down
      _ingredient.scale.multiplyScalar(shrink > 0 ? (shrink / (1 - ((_minceHitCount - 1) / MINCE_HITS))) : 0);
      if (_minceHitCount >= MINCE_HITS) {
        _ingredient.visible = false;
      }
    }

    // Spawn cream-colored mince particles
    for (let i = 0; i < BITS_PER_HIT; i++) {
      _spawnParticle(MINCE_COLOR, BIT_SCALE, false);
    }

    // Minced pile grows each hit; pile was pre-shown at 1/MINCE_HITS,
    // so add one extra slice per hit and reach full size one hit early
    if (_mincedGarlic) {
      const pileProgress = Math.min(1, (_minceHitCount + 1) / MINCE_HITS);
      _mincedGarlic.scale.setScalar(_pileFinalScale * pileProgress);
    }

    // After final hit, let upswing finish then exit
    if (_minceHitCount >= MINCE_HITS) {
      const remaining = MINCE_CYCLE * (1 - MINCE_VIBRATE_END);
      setTimeout(() => {
        if (_phase === PHASE.MINCING) _enterPhase(PHASE.KNIFE_EXIT);
      }, remaining * 1000);
    }
  }

  // ── Phase: Knife exits ─────────────────────────────────────────────────
  function _tickKnifeExit() {
    if (!_knifeGroup) { _finish(); return; }
    const t = Math.min(_phaseT / KNIFE_EXIT_DUR, 1);
    const ease = easeInQuad(t);
    _knifeGroup.position.set(
      _knifeRestX,
      lerp(_knifeTopY, _knifeEntryY, ease),
      _knifeRestZ
    );
    _knifeGroup.rotation.x = lerp(0.05, 0.3, ease);
    _knifeGroup.rotation.z = 0;
    _setKnifeOpacity(1 - ease);
    if (t >= 1) {
      _knifeGroup.visible = false;
      _setKnifeOpacity(1);
      _finish();
    }
  }

  function _finish() {
    if (_mincedGarlic) _mincedGarlic.scale.setScalar(_pileFinalScale);

    if (_mincedGarlic) {
      _pileStartPos = {
        x: _mincedGarlic.position.x,
        y: _mincedGarlic.position.y,
        z: _mincedGarlic.position.z,
      };
      _enterPhase(PHASE.MOVE_PILE);
    } else {
      _enterPhase(PHASE.DONE);
      _fireComplete();
    }
  }

  // ── Phase: Move pile to final position ─────────────────────────────────
  function _tickMovePile() {
    if (!_mincedGarlic || !_pileStartPos) {
      _enterPhase(PHASE.DONE);
      _fireComplete();
      return;
    }
    const t = Math.min(_phaseT / MOVE_PILE_DUR, 1);
    const ease = easeInOutCubic(t);
    _mincedGarlic.position.set(
      lerp(_pileStartPos.x, _pileFinalPos.x, ease),
      lerp(_pileStartPos.y, _pileFinalPos.y, ease),
      lerp(_pileStartPos.z, _pileFinalPos.z, ease)
    );
    if (t >= 1) {
      _mincedGarlic.position.set(_pileFinalPos.x, _pileFinalPos.y, _pileFinalPos.z);
      if (_cuttingBoard) {
        _enterPhase(PHASE.SLIDE_BOARD_OUT);
      } else {
        _enterPhase(PHASE.DONE);
        _fireComplete();
      }
    }
  }

  // ── Phase: Fade cutting board out in place ──────────────────────────────
  function _tickSlideBoardOut() {
    if (!_cuttingBoard) {
      _enterPhase(PHASE.DONE);
      _fireComplete();
      return;
    }
    const t = Math.min(_phaseT / SLIDE_BOARD_OUT_DUR, 1);
    _setBoardOpacity(1 - easeInOutCubic(t));
    if (t >= 1) {
      _cuttingBoard.visible = false;
      _setBoardOpacity(1);  // reset for future use
      _enterPhase(PHASE.DONE);
      _fireComplete();
    }
  }

  function _fireComplete() {
    if (_onComplete) {
      const cb = _onComplete;
      _onComplete = null;
      cb();
    }
  }

  // ── Particle spawning & animation ──────────────────────────────────────
  function _spawnParticle(color, scale, flat) {
    if (!_scene || !_boardCenter) return;

    // Skin flakes are flat ellipsoids; mince bits are small spheres
    const geo = flat
      ? new THREE.SphereGeometry(0.010, 5, 3)
      : new THREE.SphereGeometry(0.008, 6, 4);
    const mat = new THREE.MeshStandardMaterial({
      color: color, roughness: 0.7, metalness: 0,
      transparent: true, opacity: 1,
    });
    const mesh = new THREE.Mesh(geo, mat);

    const ox = (Math.random() - 0.5) * 0.07;
    const oz = (Math.random() - 0.5) * 0.07;
    mesh.position.set(_boardCenter.x + ox, _boardY + 0.01, _boardCenter.z + oz);
    mesh.rotation.set(
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2
    );
    mesh.scale.setScalar(0.0001);

    // Flatten skin particles
    if (flat) {
      mesh.scale.y = 0.00003;
    }

    _scene.add(mesh);
    _particles.push({ mesh, targetScale: scale, age: 0, flat: flat });
  }

  function _tickParticles(dt) {
    for (let i = _particles.length - 1; i >= 0; i--) {
      const p = _particles[i];
      p.age += dt;

      // Grow from 0 → full
      const growT = Math.min(p.age / BIT_GROW_DUR, 1);
      const s = p.targetScale * easeOutQuad(growT);
      if (p.flat) {
        p.mesh.scale.set(s, s * 0.3, s); // flat ellipsoid
      } else {
        p.mesh.scale.setScalar(s);
      }

      // Fade out 1s after spawn
      if (p.age > 1.0) {
        const fade = 1 - (p.age - 1.0) / 0.5;
        if (fade <= 0) {
          _scene.remove(p.mesh);
          p.mesh.geometry.dispose();
          p.mesh.material.dispose();
          _particles.splice(i, 1);
          continue;
        }
        p.mesh.material.opacity = fade;
      }
    }
  }

  // ── Board opacity helper ───────────────────────────────────────────────
  function _setBoardOpacity(opacity) {
    if (!_cuttingBoard) return;
    _cuttingBoard.traverse(c => {
      if (!c.isMesh) return;
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      mats.forEach(mat => {
        mat.transparent = opacity < 1;
        mat.opacity     = opacity;
      });
    });
  }

  // ── Knife opacity helper ───────────────────────────────────────────────
  function _setKnifeOpacity(opacity) {
    if (!_knifeGroup) return;
    _knifeGroup.traverse(c => {
      if (!c.isMesh) return;
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      mats.forEach(mat => {
        mat.transparent = opacity < 1;
        mat.opacity     = opacity;
      });
    });
  }

  // ── Cleanup & destroy ──────────────────────────────────────────────────
  function cleanup() {
    // Remove all particles
    _particles.forEach(p => {
      if (p.mesh && _scene) {
        _scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
      }
    });
    _particles = [];

    // Restore ingredient only if pipeline didn't complete
    if (_ingredient && !_completed) {
      _ingredient.visible = true;
      if (_origScale !== null) _ingredient.scale.setScalar(_origScale);
      if (_origRot) _ingredient.rotation.set(_origRot.x, _origRot.y, _origRot.z);
    }

    // Reset knife rotation in case we left it flat
    if (_knifeGroup) {
      _knifeGroup.rotation.z = 0;
    }

    _ingredient     = null;
    _knifeGroup     = null;
    _mincedGarlic   = null;
    _cuttingBoard   = null;
    _boardEndPos    = null;
    _pileStartPos   = null;
    _origPos        = null;
    _origScale      = 1;
    _origRot        = null;
    _smashHitCount  = 0;
    _smashT         = 0;
    _smashPrevCycle = 0;
    _minceHitCount  = 0;
    _minceT         = 0;
    _mincePrevCycle = 0;
    _phase          = PHASE.IDLE;
    _phaseT         = 0;
    _onComplete     = null;
  }

  function destroy() {
    cleanup();
    _scene = null;
  }

  // ── Public queries ─────────────────────────────────────────────────────
  function isChopping() { return _phase === PHASE.SMASHING || _phase === PHASE.MINCING; }
  function isDone()     { return _completed; }
  function phase()      { return _phase; }

  return {
    init, start, tick, cleanup, destroy,
    isChopping, isDone, phase,
  };
})();

window.Step3Garlic = Step3Garlic;
