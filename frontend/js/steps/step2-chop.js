/* global THREE */
'use strict';

/**
 * Step2Chop — Full pipeline orchestrator for Step 2 (Dice the Onion)
 *
 * Phases (executed in strict order, one at a time):
 *   1. IDLE          — waiting for user to click "Start Cutting"
 *   2. MOVE_BOARD    — cutting board slides in from the right to centre
 *   3. MOVE_ONION    — onion hovers smoothly to the cutting board
 *   4. KNIFE_ENTER   — knife elegantly descends and fades in
 *   5. CHOPPING      — knife chops slowly; white bits scatter, onion shrinks, diced pile grows
 *   6. KNIFE_EXIT    — knife rises and fades out
 *   7. MOVE_PILE     — diced onions glide to final resting position
 *   8. SLIDE_BOARD_OUT — cutting board slides back off-screen
 *   9. DONE          — pipeline complete, pile remains
 *
 * API (called by CookingGuide):
 *   Step2Chop.init(scene)
 *   Step2Chop.start({ ingredient, knifeGroup, dicedOnions, pileFinalScale,
 *                      chopTarget, boardCenter, boardY, origPosition,
 *                      cuttingBoard, onComplete })
 *   Step2Chop.tick(dt)
 *   Step2Chop.isChopping()
 *   Step2Chop.cleanup()
 *   Step2Chop.destroy()
 */
const Step2Chop = (() => {

  // ── Phases ───────────────────────────────────────────────────────────────
  const PHASE = {
    IDLE:            'IDLE',
    MOVE_BOARD:      'MOVE_BOARD',
    MOVE_ONION:      'MOVE_ONION',
    KNIFE_ENTER:     'KNIFE_ENTER',
    CHOPPING:        'CHOPPING',
    KNIFE_EXIT:      'KNIFE_EXIT',
    MOVE_PILE:       'MOVE_PILE',
    SLIDE_BOARD_OUT: 'SLIDE_BOARD_OUT',
    DONE:            'DONE',
  };

  // ── Timing ───────────────────────────────────────────────────────────────
  const MOVE_BOARD_DUR      = 1.0;
  const MOVE_ONION_DUR      = 1.2;
  const KNIFE_ENTER_DUR     = 0.9;
  const KNIFE_EXIT_DUR      = 0.8;
  const MOVE_PILE_DUR       = 1.0;
  const SLIDE_BOARD_OUT_DUR = 1.0;
  const CHOP_CYCLE          = 1.4;
  const DOWNSWING_END       = 0.30;
  const VIBRATE_END         = 0.42;

  // Final resting position for diced onions pile
  const PILE_FINAL_POS = { x: 1.3190, y: 3.0000, z: 0.0354 };

  // ── White particle spawning ────────────────────────────────────────────
  const MAX_HITS         = 4;
  const BITS_PER_HIT     = 14;
  const BIT_SCALE        = 0.0025;
  const BIT_GROW_DUR     = 0.5;
  const BIT_COLOR        = 0xF5F0E0;   // creamy white
  const PILE_APPEAR_HIT  = 1;

  // ── Easing helpers ───────────────────────────────────────────────────────
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
  let _ingredient   = null;       // the onion mesh
  let _knifeGroup   = null;
  let _dicedOnions  = null;       // diced_onions Three.Group
  let _pileFinalScale = 1;
  let _chopTarget   = null;       // { x, y, z } landing spot on board
  let _boardCenter  = null;
  let _boardY       = 0;
  let _origPos      = null;       // onion original position
  let _origScale    = 1;
  let _origRot      = null;       // onion original rotation
  let _onComplete   = null;
  let _cuttingBoard = null;
  let _boardStartPos = null;
  let _boardEndPos   = null;
  let _pileStartPos  = null;

  // Knife positioning
  let _knifeRestX   = 0;
  let _knifeRestZ   = 0;
  let _knifeSurface = 0;
  let _knifeTopY    = 0;
  let _knifeEntryY  = 0;

  // Chopping state
  let _chopT        = 0;
  let _prevCyclePos = 0;
  let _hitCount     = 0;

  // White bit particles
  let _bits         = [];         // [{ mesh, targetScale, age }]

  // ── Init ──────────────────────────────────────────────────────────────
  function init(scene) {
    _scene = scene;
    console.log('[Step2Chop] initialized');
  }

  // ── Start pipeline ─────────────────────────────────────────────────────
  function start(opts) {
    cleanup();
    _completed = false;

    _ingredient     = opts.ingredient;
    _knifeGroup     = opts.knifeGroup;
    _dicedOnions    = opts.dicedOnions;
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

    // Pre-compute knife positions relative to chop target
    _knifeRestX   = _chopTarget.x + 0.07;
    _knifeRestZ   = _chopTarget.z - 0.05;
    _knifeSurface = _chopTarget.y + 0.022;
    _knifeTopY    = _knifeSurface + 0.52;
    _knifeEntryY  = _knifeTopY + 0.4;

    // Hide knife and diced pile initially
    if (_knifeGroup) {
      _knifeGroup.visible = false;
      _knifeGroup.position.set(_knifeRestX, _knifeEntryY, _knifeRestZ);
      _setKnifeOpacity(0);
    }
    if (_dicedOnions) {
      _dicedOnions.visible = false;
      _dicedOnions.scale.setScalar(0.001);
    }

    // Set up cutting board slide-in
    if (_cuttingBoard) {
      _boardEndPos = {
        x: _cuttingBoard.position.x,
        y: _cuttingBoard.position.y,
        z: _cuttingBoard.position.z,
      };
      _boardStartPos = {
        x: _boardEndPos.x + 1.2,
        y: _boardEndPos.y,
        z: _boardEndPos.z,
      };
      _cuttingBoard.position.set(_boardStartPos.x, _boardStartPos.y, _boardStartPos.z);
      _enterPhase(PHASE.MOVE_BOARD);
    } else {
      _enterPhase(PHASE.MOVE_ONION);
    }
  }

  // ── Phase transitions ──────────────────────────────────────────────────
  function _enterPhase(phase) {
    _phase  = phase;
    _phaseT = 0;
    console.log('[Step2Chop] phase →', phase);

    if (phase === PHASE.CHOPPING) {
      _chopT        = 0;
      _prevCyclePos = 0;
      _hitCount     = 0;
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
      case PHASE.MOVE_BOARD:      _tickMoveBoard(dt);      break;
      case PHASE.MOVE_ONION:      _tickMoveOnion(dt);      break;
      case PHASE.KNIFE_ENTER:     _tickKnifeEnter(dt);     break;
      case PHASE.CHOPPING:        _tickChopping(dt);       break;
      case PHASE.KNIFE_EXIT:      _tickKnifeExit(dt);      break;
      case PHASE.MOVE_PILE:       _tickMovePile(dt);       break;
      case PHASE.SLIDE_BOARD_OUT: _tickSlideBoardOut(dt);  break;
      case PHASE.DONE:            return;
    }

    // Always tick particles (they may still be animating)
    _tickBits(dt);
  }

  // ── Phase: Slide cutting board into centre ─────────────────────────────
  function _tickMoveBoard() {
    if (!_cuttingBoard || !_boardStartPos || !_boardEndPos) {
      _enterPhase(PHASE.MOVE_ONION);
      return;
    }
    const t = Math.min(_phaseT / MOVE_BOARD_DUR, 1);
    const ease = easeInOutCubic(t);
    _cuttingBoard.position.set(
      lerp(_boardStartPos.x, _boardEndPos.x, ease),
      lerp(_boardStartPos.y, _boardEndPos.y, ease),
      lerp(_boardStartPos.z, _boardEndPos.z, ease)
    );
    if (t >= 1) {
      _cuttingBoard.position.set(_boardEndPos.x, _boardEndPos.y, _boardEndPos.z);
      _enterPhase(PHASE.MOVE_ONION);
    }
  }

  // ── Phase: Move onion to board ─────────────────────────────────────────
  function _tickMoveOnion() {
    if (!_ingredient || !_chopTarget) return;
    const t = Math.min(_phaseT / MOVE_ONION_DUR, 1);
    const ease = easeInOutCubic(t);
    const arc  = Math.sin(t * Math.PI) * 0.15;

    _ingredient.position.set(
      lerp(_origPos.x, _chopTarget.x, ease),
      lerp(_origPos.y, _chopTarget.y, ease) + arc,
      lerp(_origPos.z, _chopTarget.z, ease)
    );

    if (t >= 1) {
      _ingredient.position.set(_chopTarget.x, _chopTarget.y, _chopTarget.z);
      _enterPhase(PHASE.KNIFE_ENTER);
    }
  }

  // ── Phase: Knife elegantly appears ─────────────────────────────────────
  function _tickKnifeEnter() {
    if (!_knifeGroup) { _enterPhase(PHASE.CHOPPING); return; }
    const t = Math.min(_phaseT / KNIFE_ENTER_DUR, 1);
    const ease = easeOutQuad(t);
    _knifeGroup.visible = true;
    _knifeGroup.position.set(
      _knifeRestX,
      lerp(_knifeEntryY, _knifeTopY, ease),
      _knifeRestZ
    );
    _knifeGroup.rotation.x = lerp(0.3, 0.05, ease);
    _setKnifeOpacity(ease);
    if (t >= 1) {
      _setKnifeOpacity(1);
      _enterPhase(PHASE.CHOPPING);
    }
  }

  // ── Phase: Chopping ────────────────────────────────────────────────────
  function _tickChopping(dt) {
    if (!_knifeGroup || _hitCount >= MAX_HITS) {
      _enterPhase(PHASE.KNIFE_EXIT);
      return;
    }
    _chopT += dt;
    const cyclePos = _chopT % CHOP_CYCLE;
    const norm     = cyclePos / CHOP_CYCLE;

    if (_prevCyclePos / CHOP_CYCLE < DOWNSWING_END && norm >= DOWNSWING_END) {
      _onKnifeHit();
    }
    _prevCyclePos = cyclePos;

    let ky, lean;
    if (norm < DOWNSWING_END) {
      const p = norm / DOWNSWING_END;
      ky   = lerp(_knifeTopY, _knifeSurface + 0.08, easeInQuad(p));
      lean = lerp(0.05, -0.20, p);
    } else if (norm < VIBRATE_END) {
      ky   = _knifeSurface + 0.08 + Math.sin((norm - DOWNSWING_END) * CHOP_CYCLE * 32) * 0.010;
      lean = -0.20;
    } else {
      const p = (norm - VIBRATE_END) / (1 - VIBRATE_END);
      ky   = lerp(_knifeSurface + 0.08, _knifeTopY, easeOutQuad(p));
      lean = lerp(-0.20, 0.05, p);
    }
    _knifeGroup.position.set(_knifeRestX, ky, _knifeRestZ);
    _knifeGroup.rotation.x = lean;
  }

  // ── Knife hit handler ──────────────────────────────────────────────────
  function _onKnifeHit() {
    _hitCount++;
    console.log('[Step2Chop] hit', _hitCount, '/', MAX_HITS);

    // Shrink the onion proportionally
    if (_ingredient) {
      const shrink = Math.max(0, 1 - (_hitCount / MAX_HITS));
      _ingredient.scale.setScalar(_origScale * shrink);
      if (_hitCount >= MAX_HITS) {
        _ingredient.visible = false;
      }
    }

    // Spawn white bits
    for (let i = 0; i < BITS_PER_HIT; i++) {
      _spawnBit();
    }

    // Diced onions pile appears starting on the designated hit
    if (_dicedOnions && _hitCount >= PILE_APPEAR_HIT) {
      const pileProgress = (_hitCount - PILE_APPEAR_HIT + 1) / (MAX_HITS - PILE_APPEAR_HIT + 1);
      if (!_dicedOnions.visible) _dicedOnions.visible = true;
      _dicedOnions.scale.setScalar(_pileFinalScale * pileProgress);
    }

    // After final hit, let the current upswing finish then exit
    if (_hitCount >= MAX_HITS) {
      const remaining = CHOP_CYCLE * (1 - VIBRATE_END);
      setTimeout(() => {
        if (_phase === PHASE.CHOPPING) _enterPhase(PHASE.KNIFE_EXIT);
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
    _setKnifeOpacity(1 - ease);
    if (t >= 1) {
      _knifeGroup.visible = false;
      _setKnifeOpacity(1);
      _finish();
    }
  }

  function _finish() {
    if (_dicedOnions) _dicedOnions.scale.setScalar(_pileFinalScale);

    if (_dicedOnions) {
      _pileStartPos = {
        x: _dicedOnions.position.x,
        y: _dicedOnions.position.y,
        z: _dicedOnions.position.z,
      };
      _enterPhase(PHASE.MOVE_PILE);
    } else {
      _enterPhase(PHASE.DONE);
      _fireComplete();
    }
  }

  // ── Phase: Move pile to final position ─────────────────────────────────
  function _tickMovePile() {
    if (!_dicedOnions || !_pileStartPos) {
      _enterPhase(PHASE.DONE);
      _fireComplete();
      return;
    }
    const t = Math.min(_phaseT / MOVE_PILE_DUR, 1);
    const ease = easeInOutCubic(t);
    _dicedOnions.position.set(
      lerp(_pileStartPos.x, PILE_FINAL_POS.x, ease),
      lerp(_pileStartPos.y, PILE_FINAL_POS.y, ease),
      lerp(_pileStartPos.z, PILE_FINAL_POS.z, ease)
    );
    if (t >= 1) {
      _dicedOnions.position.set(PILE_FINAL_POS.x, PILE_FINAL_POS.y, PILE_FINAL_POS.z);
      if (_cuttingBoard && _boardStartPos) {
        _enterPhase(PHASE.SLIDE_BOARD_OUT);
      } else {
        _enterPhase(PHASE.DONE);
        _fireComplete();
      }
    }
  }

  // ── Phase: Slide cutting board back out ────────────────────────────────
  function _tickSlideBoardOut() {
    if (!_cuttingBoard || !_boardEndPos || !_boardStartPos) {
      _enterPhase(PHASE.DONE);
      _fireComplete();
      return;
    }
    const t = Math.min(_phaseT / SLIDE_BOARD_OUT_DUR, 1);
    const ease = easeInOutCubic(t);
    _cuttingBoard.position.set(
      lerp(_boardEndPos.x, _boardStartPos.x, ease),
      lerp(_boardEndPos.y, _boardStartPos.y, ease),
      lerp(_boardEndPos.z, _boardStartPos.z, ease)
    );
    if (t >= 1) {
      _cuttingBoard.position.set(_boardStartPos.x, _boardStartPos.y, _boardStartPos.z);
      _cuttingBoard.visible = false;
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

  // ── White bit spawning & animation ─────────────────────────────────────
  function _spawnBit() {
    if (!_scene || !_boardCenter) return;

    const geo = new THREE.SphereGeometry(0.012, 6, 4);
    const mat = new THREE.MeshStandardMaterial({
      color: BIT_COLOR, roughness: 0.7, metalness: 0,
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

    _scene.add(mesh);
    _bits.push({ mesh, targetScale: BIT_SCALE, age: 0 });
  }

  function _tickBits(dt) {
    for (let i = _bits.length - 1; i >= 0; i--) {
      const b = _bits[i];
      b.age += dt;

      // Grow from 0 → full
      const growT = Math.min(b.age / BIT_GROW_DUR, 1);
      b.mesh.scale.setScalar(b.targetScale * easeOutQuad(growT));

      // Fade out 1s after spawn
      if (b.age > 1.0) {
        const fade = 1 - (b.age - 1.0) / 0.5;
        if (fade <= 0) {
          _scene.remove(b.mesh);
          b.mesh.geometry.dispose();
          b.mesh.material.dispose();
          _bits.splice(i, 1);
          continue;
        }
        b.mesh.material.opacity = fade;
      }
    }
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
    // Remove all scattered bits
    _bits.forEach(b => {
      if (b.mesh && _scene) {
        _scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mesh.material.dispose();
      }
    });
    _bits = [];

    // Restore ingredient only if pipeline didn't complete (e.g. user went back)
    if (_ingredient && !_completed) {
      _ingredient.visible = true;
      if (_origScale !== null) _ingredient.scale.setScalar(_origScale);
      if (_origRot) _ingredient.rotation.set(_origRot.x, _origRot.y, _origRot.z);
    }

    _ingredient    = null;
    _knifeGroup    = null;
    _dicedOnions   = null;
    _cuttingBoard  = null;
    _boardStartPos = null;
    _boardEndPos   = null;
    _pileStartPos  = null;
    _origPos       = null;
    _origScale     = 1;
    _origRot       = null;
    _hitCount      = 0;
    _chopT         = 0;
    _prevCyclePos  = 0;
    _phase         = PHASE.IDLE;
    _phaseT        = 0;
    _onComplete    = null;
  }

  function destroy() {
    cleanup();
    _scene = null;
  }

  // ── Public queries ─────────────────────────────────────────────────────
  function isChopping() { return _phase === PHASE.CHOPPING; }
  function isDone()     { return _completed; }
  function phase()      { return _phase; }

  return {
    init, start, tick, cleanup, destroy,
    isChopping, isDone, phase,
  };
})();

window.Step2Chop = Step2Chop;
