/* global THREE */
'use strict';

/**
 * Step1Chop — Full pipeline orchestrator for Step 1 (Cube the Squash)
 *
 * Phases (executed in strict order, one at a time):
 *   1. IDLE        — waiting for user to click "Start Cutting"
 *   2. MOVE_BOARD  — cutting board slides in from the right to centre
 *   3. MOVE_SQUASH — squash hovers smoothly to the cutting board
 *   4. KNIFE_ENTER — knife elegantly descends and fades in
 *   5. CHOPPING    — knife chops slowly; cubes scatter, squash shrinks
 *   6. KNIFE_EXIT  — knife rises and fades out
 *   7. MOVE_PILE   — pile glides to its final resting position
 *   8. DONE        — pipeline complete, pile remains
 *
 * API (called by CookingGuide):
 *   Step1Chop.init(scene)
 *   Step1Chop.start({ ingredient, knifeGroup, orangePile, pileFinalScale,
 *                      chopTarget, boardCenter, boardY, origPosition, onComplete })
 *   Step1Chop.tick(dt)
 *   Step1Chop.isChopping()    — true only during CHOPPING phase
 *   Step1Chop.cleanup()
 *   Step1Chop.destroy()
 */
const Step1Chop = (() => {

  // ── Phases ───────────────────────────────────────────────────────────────
  const PHASE = {
    IDLE:         'IDLE',
    MOVE_BOARD:   'MOVE_BOARD',
    MOVE_SQUASH:  'MOVE_SQUASH',
    KNIFE_ENTER:  'KNIFE_ENTER',
    CHOPPING:     'CHOPPING',
    KNIFE_EXIT:   'KNIFE_EXIT',
    MOVE_PILE:    'MOVE_PILE',
    SLIDE_BOARD_OUT: 'SLIDE_BOARD_OUT',
    DONE:         'DONE',
  };

  // ── Timing ───────────────────────────────────────────────────────────────
  const MOVE_BOARD_DUR   = 1.0;   // seconds for cutting board to slide in
  const MOVE_SQUASH_DUR  = 1.2;   // seconds for squash to glide to board
  const KNIFE_ENTER_DUR  = 0.9;   // seconds for knife to appear
  const KNIFE_EXIT_DUR   = 0.8;   // seconds for knife to disappear
  const MOVE_PILE_DUR    = 1.0;   // seconds for pile to move to final position
  const SLIDE_BOARD_OUT_DUR = 1.0; // seconds for board to slide away
  const PILE_FINAL_POS   = { x: 1.3284, y: 3.0008, z: 0.4884 };
  const CHOP_CYCLE       = 1.4;   // seconds per full knife stroke (slow, elegant)
  const DOWNSWING_END    = 0.30;  // fraction: end of downswing
  const VIBRATE_END      = 0.42;  // fraction: end of impact vibrate
  // remainder is upswing

  // ── Cube spawning ────────────────────────────────────────────────────────
  const MAX_HITS         = 4;
  const CUBES_PER_HIT    = 12;
  const CUBE_SCALE       = 0.003;
  const CUBE_GROW_DUR    = 0.5;   // seconds to grow from 0 → full
  const CUBE_COLOR       = 0xED9544;
  const PILE_APPEAR_HIT  = 1;     // orange pile starts appearing on this hit (1-indexed)

  // ── Easing helpers ───────────────────────────────────────────────────────
  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }
  function easeInQuad(t)  { return t * t; }
  function lerp(a, b, t)  { return a + (b - a) * Math.max(0, Math.min(1, t)); }

  // ── State ────────────────────────────────────────────────────────────────
  let _scene        = null;
  let _phase        = PHASE.IDLE;
  let _phaseT       = 0;
  let _completed    = false;       // true after pipeline reaches DONE          // elapsed time in current phase

  // References (set via start())
  let _ingredient   = null;       // the squash mesh
  let _knifeGroup   = null;       // knife Three.Group
  let _orangePile   = null;       // pile-of-cubes Three.Group
  let _pileFinalScale = 1;
  let _chopTarget   = null;       // { x, y, z } landing spot on board
  let _boardCenter  = null;       // { x, z }
  let _boardY       = 0;
  let _origPos      = null;       // squash original position
  let _origScale    = 1;
  let _onComplete   = null;
  let _cuttingBoard = null;       // cutting board mesh
  let _boardEndPos   = null;      // board final center position
  let _pileStartPos  = null;      // pile position when MOVE_PILE begins

  // Knife positioning
  let _knifeRestX   = 0;
  let _knifeRestZ   = 0;
  let _knifeSurface = 0;          // board surface Y for knife bottom
  let _knifeTopY    = 0;          // knife raised Y
  let _knifeEntryY  = 0;          // where knife enters from (above scene)

  // Chopping state
  let _chopT        = 0;          // time within chop animation
  let _prevCyclePos = 0;          // previous position in cycle (for hit detection)
  let _hitCount     = 0;

  // Cube template + spawned cubes
  let _cubeTemplate = null;
  let _cubes        = [];         // [{ mesh, targetScale, age }]
  let _cubeReady    = false;

  // ── Init (preload cube GLB) ──────────────────────────────────────────────
  function init(scene) {
    _scene = scene;
    _cubeReady = false;

    const loader = new THREE.GLTFLoader();
    loader.load(
      '/assets/3d/orange-cube.glb',
      (gltf) => {
        _cubeTemplate = gltf.scene;
        _cubeTemplate.traverse(c => {
          if (c.isMesh) {
            c.castShadow = true;
            c.receiveShadow = true;
            c.material = new THREE.MeshStandardMaterial({
              color: CUBE_COLOR, roughness: 0.75, metalness: 0,
            });
          }
        });
        _cubeReady = true;
        console.log('[Step1Chop] cube GLB loaded');
      },
      undefined,
      () => {
        const geo = new THREE.BoxGeometry(0.04, 0.04, 0.04);
        const mat = new THREE.MeshStandardMaterial({ color: CUBE_COLOR, roughness: 0.75 });
        _cubeTemplate = new THREE.Mesh(geo, mat);
        _cubeReady = true;
        console.warn('[Step1Chop] cube GLB fallback');
      }
    );
  }

  // ── Start pipeline ───────────────────────────────────────────────────────
  function start(opts) {
    cleanup();
    _completed = false;

    _ingredient     = opts.ingredient;
    _knifeGroup     = opts.knifeGroup;
    _orangePile     = opts.orangePile;
    _pileFinalScale = opts.pileFinalScale || 1;
    _chopTarget     = opts.chopTarget;
    _boardCenter    = opts.boardCenter;
    _boardY         = opts.boardY;
    _origPos        = opts.origPosition;
    _origScale      = _ingredient ? _ingredient.scale.x : 1;
    _onComplete     = opts.onComplete || null;
    _cuttingBoard   = opts.cuttingBoard || null;

    // Pre-compute knife positions relative to chop target
    _knifeRestX   = _chopTarget.x + 0.07;
    _knifeRestZ   = _chopTarget.z - 0.05;
    _knifeSurface = _chopTarget.y + 0.022;
    _knifeTopY    = _knifeSurface + 0.52;
    _knifeEntryY  = _knifeTopY + 0.4;  // starts above the top position

    // Hide knife and pile initially
    if (_knifeGroup) {
      _knifeGroup.visible = false;
      _knifeGroup.position.set(_knifeRestX, _knifeEntryY, _knifeRestZ);
      _setKnifeOpacity(0);
    }
    if (_orangePile) {
      _orangePile.visible = false;
      _orangePile.scale.setScalar(0.001);
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
      // No board to animate, go straight to squash
      _enterPhase(PHASE.MOVE_SQUASH);
    }
  }

  // ── Phase transitions ────────────────────────────────────────────────────
  function _enterPhase(phase) {
    _phase  = phase;
    _phaseT = 0;
    console.log('[Step1Chop] phase →', phase);

    if (phase === PHASE.CHOPPING) {
      _chopT       = 0;
      _prevCyclePos = 0;
      _hitCount    = 0;
    }
    if (phase === PHASE.DONE) {
      _completed = true;
    }
  }

  // ── Main tick ────────────────────────────────────────────────────────────
  function tick(dt) {
    _phaseT += dt;

    switch (_phase) {
      case PHASE.IDLE:         return;
      case PHASE.MOVE_BOARD:   _tickMoveBoard(dt);   break;
      case PHASE.MOVE_SQUASH:  _tickMoveSquash(dt);  break;
      case PHASE.KNIFE_ENTER:  _tickKnifeEnter(dt);  break;
      case PHASE.CHOPPING:     _tickChopping(dt);     break;
      case PHASE.KNIFE_EXIT:   _tickKnifeExit(dt);   break;
      case PHASE.MOVE_PILE:       _tickMovePile(dt);        break;
      case PHASE.SLIDE_BOARD_OUT: _tickSlideBoardOut(dt);   break;
      case PHASE.DONE:            return;
    }

    // Always tick cubes (they may still be animating after chops end)
    _tickCubes(dt);
  }

  // ── Phase 0: Fade cutting board in place ─────────────────────────────────
  function _tickMoveBoard() {
    if (!_cuttingBoard || !_boardEndPos) {
      _enterPhase(PHASE.MOVE_SQUASH);
      return;
    }

    const t = Math.min(_phaseT / MOVE_BOARD_DUR, 1);
    _setBoardOpacity(easeInOutCubic(t));

    if (t >= 1) {
      _setBoardOpacity(1);
      _enterPhase(PHASE.MOVE_SQUASH);
    }
  }

  // ── Phase 1: Move squash to board ────────────────────────────────────────
  function _tickMoveSquash() {
    if (!_ingredient || !_chopTarget) return;

    const t = Math.min(_phaseT / MOVE_SQUASH_DUR, 1);
    const ease = easeInOutCubic(t);
    const arc  = Math.sin(t * Math.PI) * 0.15;  // gentle arc

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

  // ── Phase 2: Knife elegantly appears ─────────────────────────────────────
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
    _knifeGroup.rotation.x = lerp(0.3, 0.05, ease);  // slight tilt → neutral
    _setKnifeOpacity(ease);

    if (t >= 1) {
      _setKnifeOpacity(1);
      _enterPhase(PHASE.CHOPPING);
    }
  }

  // ── Phase 3: Chopping ────────────────────────────────────────────────────
  function _tickChopping(dt) {
    if (!_knifeGroup || _hitCount >= MAX_HITS) {
      _enterPhase(PHASE.KNIFE_EXIT);
      return;
    }

    _chopT += dt;
    const cyclePos = _chopT % CHOP_CYCLE;
    const norm     = cyclePos / CHOP_CYCLE;  // 0→1 within one stroke

    // Detect knife-hit: crossed from downswing into vibrate
    if (_prevCyclePos / CHOP_CYCLE < DOWNSWING_END && norm >= DOWNSWING_END) {
      _onKnifeHit();
    }
    _prevCyclePos = cyclePos;

    // Knife vertical position and lean
    let ky, lean;
    if (norm < DOWNSWING_END) {
      // Downswing: top → bottom
      const p = norm / DOWNSWING_END;
      ky   = lerp(_knifeTopY, _knifeSurface + 0.08, easeInQuad(p));
      lean = lerp(0.05, -1.3, p);
    } else if (norm < VIBRATE_END) {
      // Impact vibrate
      ky   = _knifeSurface + 0.08 + Math.sin((norm - DOWNSWING_END) * CHOP_CYCLE * 32) * 0.010;
      lean = -1.3;
    } else {
      // Upswing: bottom → top
      const p = (norm - VIBRATE_END) / (1 - VIBRATE_END);
      ky   = lerp(_knifeSurface + 0.08, _knifeTopY, easeOutQuad(p));
      lean = lerp(-1.3, 0.05, p);
    }

    _knifeGroup.position.set(_knifeRestX, ky, _knifeRestZ);
    _knifeGroup.rotation.x = lean;
  }

  // ── Knife hit handler ────────────────────────────────────────────────────
  function _onKnifeHit() {
    _hitCount++;
    console.log('[Step1Chop] hit', _hitCount, '/', MAX_HITS);

    // Shrink the squash proportionally
    if (_ingredient) {
      const shrink = Math.max(0, 1 - (_hitCount / MAX_HITS));
      _ingredient.scale.setScalar(_origScale * shrink);
      if (_hitCount >= MAX_HITS) {
        _ingredient.visible = false;
      }
    }

    // Spawn scattered cubes
    for (let i = 0; i < CUBES_PER_HIT; i++) {
      _spawnCube();
    }

    // Orange pile appears starting on the designated hit
    if (_orangePile && _hitCount >= PILE_APPEAR_HIT) {
      const pileProgress = (_hitCount - PILE_APPEAR_HIT + 1) / (MAX_HITS - PILE_APPEAR_HIT + 1);
      if (!_orangePile.visible) _orangePile.visible = true;
      _orangePile.scale.setScalar(_pileFinalScale * pileProgress);
    }

    // After final hit, let the current upswing finish then exit
    if (_hitCount >= MAX_HITS) {
      // Small delay so the last upswing completes before knife exits
      const remaining = CHOP_CYCLE * (1 - VIBRATE_END);
      setTimeout(() => {
        if (_phase === PHASE.CHOPPING) _enterPhase(PHASE.KNIFE_EXIT);
      }, remaining * 1000);
    }
  }

  // ── Phase 4: Knife exits ─────────────────────────────────────────────────
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
      _setKnifeOpacity(1);  // reset for future use
      _finish();
    }
  }

  function _finish() {
    if (_orangePile) _orangePile.scale.setScalar(_pileFinalScale);

    // Move pile to its final resting position
    if (_orangePile) {
      _pileStartPos = {
        x: _orangePile.position.x,
        y: _orangePile.position.y,
        z: _orangePile.position.z,
      };
      _enterPhase(PHASE.MOVE_PILE);
    } else {
      _enterPhase(PHASE.DONE);
      _fireComplete();
    }
  }

  // ── Phase 5: Move pile to final position ──────────────────────────────────
  function _tickMovePile() {
    if (!_orangePile || !_pileStartPos) {
      _enterPhase(PHASE.DONE);
      _fireComplete();
      return;
    }

    const t = Math.min(_phaseT / MOVE_PILE_DUR, 1);
    const ease = easeInOutCubic(t);

    _orangePile.position.set(
      lerp(_pileStartPos.x, PILE_FINAL_POS.x, ease),
      lerp(_pileStartPos.y, PILE_FINAL_POS.y, ease),
      lerp(_pileStartPos.z, PILE_FINAL_POS.z, ease)
    );

    if (t >= 1) {
      _orangePile.position.set(PILE_FINAL_POS.x, PILE_FINAL_POS.y, PILE_FINAL_POS.z);
      // Fade board away after pile reaches destination
      if (_cuttingBoard) {
        _enterPhase(PHASE.SLIDE_BOARD_OUT);
      } else {
        _enterPhase(PHASE.DONE);
        _fireComplete();
      }
    }
  }

  // ── Phase 6: Fade cutting board out in place ──────────────────────────────
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

  // ── Cube spawning & physics ──────────────────────────────────────────────
  function _spawnCube() {
    if (!_cubeTemplate || !_scene || !_boardCenter) return;

    const cube = _cubeTemplate.clone();
    cube.visible = true;
    cube.traverse(c => { c.visible = true; });
    cube.scale.setScalar(0.0001);

    const ox = (Math.random() - 0.5) * 0.06;
    const oz = (Math.random() - 0.5) * 0.06;
    cube.position.set(_boardCenter.x + ox, _boardY + 0.01, _boardCenter.z + oz);
    cube.rotation.set(
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2
    );

    _scene.add(cube);
    _cubes.push({ mesh: cube, targetScale: CUBE_SCALE, age: 0 });
  }

  function _tickCubes(dt) {
    for (let i = _cubes.length - 1; i >= 0; i--) {
      const c = _cubes[i];
      c.age += dt;

      // Grow from 0 → full
      const growT = Math.min(c.age / CUBE_GROW_DUR, 1);
      c.mesh.scale.setScalar(c.targetScale * easeOutQuad(growT));

      // Fade out 1s after spawn (0.5s after reaching full size)
      if (c.age > 1.0) {
        const fade = 1 - (c.age - 1.0) / 0.5;
        if (fade <= 0) {
          _scene.remove(c.mesh);
          c.mesh.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
              if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
              else child.material.dispose();
            }
          });
          _cubes.splice(i, 1);
          continue;
        }
        c.mesh.traverse(child => {
          if (child.isMesh && child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach(mat => { mat.transparent = true; mat.opacity = fade; });
          }
        });
      }
    }
  }

  // ── Board opacity helper ─────────────────────────────────────────────────
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

  // ── Knife opacity helper ─────────────────────────────────────────────────
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

  // ── Cleanup & destroy ────────────────────────────────────────────────────
  function cleanup() {
    // Remove all scattered cubes
    _cubes.forEach(c => {
      if (c.mesh && _scene) {
        _scene.remove(c.mesh);
        c.mesh.traverse(child => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
            else child.material.dispose();
          }
        });
      }
    });
    _cubes = [];

    // Restore ingredient only if pipeline didn't complete (e.g. user went back)
    if (_ingredient && !_completed) {
      _ingredient.visible = true;
      if (_origScale !== null) _ingredient.scale.setScalar(_origScale);
    }

    _ingredient    = null;
    _knifeGroup    = null;
    _orangePile    = null;
    _cuttingBoard  = null;
    _boardEndPos   = null;
    _pileStartPos  = null;
    _origPos       = null;
    _origScale     = 1;
    _hitCount     = 0;
    _chopT        = 0;
    _prevCyclePos = 0;
    _phase        = PHASE.IDLE;
    _phaseT       = 0;
    _onComplete   = null;
  }

  function destroy() {
    cleanup();
    if (_cubeTemplate) {
      _cubeTemplate.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
      });
      _cubeTemplate = null;
    }
    _scene     = null;
    _cubeReady = false;
  }

  // ── Public queries ───────────────────────────────────────────────────────
  function isReady()    { return _cubeReady; }
  function isChopping() { return _phase === PHASE.CHOPPING; }
  function isDone()     { return _completed; }
  function phase()      { return _phase; }
  function hitCount()   { return _hitCount; }
  function maxHits()    { return MAX_HITS; }

  return {
    init, start, tick, cleanup, destroy,
    isReady, isChopping, isDone, phase, hitCount, maxHits,
  };
})();

window.Step1Chop = Step1Chop;
