/* global THREE */
'use strict';

/**
 * Step8Stir — Stir the pot with a spoon, then reveal the finished stew
 *
 * Phases:
 *   1. IDLE        — waiting for user to click "Start Stirring"
 *   2. STIR        — spoon orbits the pot for STIR_DUR seconds
 *   3. VANISH      — spoon shrinks/fades out over VANISH_DUR seconds
 *   4. REVEAL      — stew.glb scales up from 0 over REVEAL_DUR seconds
 *   5. DONE        — pipeline complete, onComplete fired
 *
 * API (called by CookingGuide):
 *   Step8Stir.init(scene)
 *   Step8Stir.start({ spoonGroup, potMesh, stewMesh, onComplete })
 *   Step8Stir.tick(dt)
 *   Step8Stir.cleanup()
 *   Step8Stir.destroy()
 */
const Step8Stir = (() => {

  // ── Phases ───────────────────────────────────────────────────────────────
  const PHASE = {
    IDLE:    'IDLE',
    STIR:    'STIR',
    VANISH:  'VANISH',
    REVEAL:  'REVEAL',
    DONE:    'DONE',
  };

  // ── Timing ───────────────────────────────────────────────────────────────
  const STIR_DUR   = 3.5;   // seconds of stirring
  const VANISH_DUR = 0.65;  // spoon disappears
  const REVEAL_DUR = 1.1;   // stew scales in

  // ── State ────────────────────────────────────────────────────────────────
  let _scene      = null;
  let _phase      = PHASE.IDLE;
  let _phaseT     = 0;
  let _onComplete = null;

  // External objects passed via start()
  let _spoonGroup  = null;
  let _stewMesh    = null;
  let _potMesh     = null;  // hidden before stew reveal
  let _potCenter   = null;  // {x, y, z}

  // Stir orbit state
  let _stirAngle   = 0;

  // Spoon's original scale (saved so we can restore on cleanup)
  let _spoonOrigScale = null;

  // Stew target scale (the .glb's designed scale passed in)
  let _stewTargetScale = 0.4138;

  // ── Easing ───────────────────────────────────────────────────────────────
  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  function easeOutBack(t) {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  function init(scene) {
    _scene = scene;
    console.log('[Step8Stir] initialized');
  }

  // ── Start ─────────────────────────────────────────────────────────────────
  function start(opts) {
    cleanup();

    _spoonGroup = opts.spoonGroup || null;
    _stewMesh   = opts.stewMesh   || null;
    _potMesh    = opts.potMesh    || null;
    _onComplete = opts.onComplete || null;
    _stewTargetScale = opts.stewTargetScale || 0.4138;

    if (_potMesh) {
      const box    = new THREE.Box3().setFromObject(_potMesh);
      const center = box.getCenter(new THREE.Vector3());
      _potCenter   = { x: center.x, y: box.max.y, z: center.z };
    } else {
      _potCenter = { x: 0, y: 3.0, z: 0 };
    }

    // Save spoon scale
    if (_spoonGroup) {
      _spoonOrigScale = _spoonGroup.scale.clone();
      _spoonGroup.visible = true;
    }

    // Hide stew initially
    if (_stewMesh) {
      _stewMesh.visible = false;
      _stewMesh.scale.setScalar(0.001);
    }

    _stirAngle = 0;
    _enterPhase(PHASE.STIR);
  }

  // ── Phase transitions ────────────────────────────────────────────────────
  function _enterPhase(phase) {
    _phase  = phase;
    _phaseT = 0;
    console.log('[Step8Stir] phase →', phase);

    if (phase === PHASE.REVEAL) {
      // Hide pot (and its smoke) before the stew appears
      if (_potMesh) _potMesh.visible = false;
      if (typeof Step5Boil !== 'undefined') Step5Boil.cleanup();

      if (_stewMesh) {
        _stewMesh.visible = true;
        _stewMesh.scale.setScalar(0.001);
      }
    }

    if (phase === PHASE.DONE) {
      _fireComplete();
    }
  }

  // ── Main tick ─────────────────────────────────────────────────────────────
  function tick(dt) {
    if (_phase === PHASE.IDLE || _phase === PHASE.DONE) return;

    _phaseT += dt;

    switch (_phase) {
      case PHASE.STIR:   _tickStir(dt); break;
      case PHASE.VANISH: _tickVanish(); break;
      case PHASE.REVEAL: _tickReveal(); break;
    }
  }

  // ── Tick: spoon orbits pot ───────────────────────────────────────────────
  function _tickStir(dt) {
    if (!_spoonGroup || !_potCenter) return;

    _stirAngle += dt * 2.1;

    const r = 0.10;
    _spoonGroup.position.set(
      _potCenter.x + r * Math.cos(_stirAngle),
      _potCenter.y + 0.18 + 0.022 * Math.sin(_stirAngle * 2),
      _potCenter.z + r * Math.sin(_stirAngle)
    );
    _spoonGroup.rotation.y = _stirAngle + Math.PI * 1.1;
    _spoonGroup.rotation.x = 0.28 + 0.06 * Math.sin(_stirAngle);

    if (_phaseT >= STIR_DUR) {
      _enterPhase(PHASE.VANISH);
    }
  }

  // ── Tick: spoon shrinks to nothing ────────────────────────────────────────
  function _tickVanish() {
    if (!_spoonGroup) { _enterPhase(PHASE.REVEAL); return; }

    const t = Math.min(_phaseT / VANISH_DUR, 1);
    const ease = easeInOutCubic(t);
    const s = 1 - ease;

    if (_spoonOrigScale) {
      _spoonGroup.scale.set(
        _spoonOrigScale.x * s,
        _spoonOrigScale.y * s,
        _spoonOrigScale.z * s
      );
    } else {
      _spoonGroup.scale.setScalar(Math.max(0.001, s));
    }

    if (t >= 1) {
      _spoonGroup.visible = false;
      _enterPhase(PHASE.REVEAL);
    }
  }

  // ── Tick: stew scales in with a bounce ───────────────────────────────────
  function _tickReveal() {
    if (!_stewMesh) { _enterPhase(PHASE.DONE); return; }

    const t = Math.min(_phaseT / REVEAL_DUR, 1);
    const ease = easeOutBack(t);
    const s = _stewTargetScale * Math.max(0.001, ease);
    _stewMesh.scale.setScalar(s);

    if (t >= 1) {
      _stewMesh.scale.setScalar(_stewTargetScale);
      _enterPhase(PHASE.DONE);
    }
  }

  // ── Fire completion callback ──────────────────────────────────────────────
  function _fireComplete() {
    if (_onComplete) {
      const cb = _onComplete;
      _onComplete = null;
      cb();
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  function cleanup() {
    // Restore spoon
    if (_spoonGroup) {
      if (_spoonOrigScale) {
        _spoonGroup.scale.copy(_spoonOrigScale);
      }
      _spoonGroup.visible = false;
    }

    _spoonGroup     = null;
    _stewMesh       = null;
    _potMesh        = null;
    _potCenter      = null;
    _onComplete     = null;
    _spoonOrigScale = null;
    _phase          = PHASE.IDLE;
    _phaseT         = 0;
    _stirAngle      = 0;
  }

  function destroy() {
    cleanup();
    _scene = null;
  }

  // ── Public queries ────────────────────────────────────────────────────────
  function isStirring() { return _phase === PHASE.STIR; }
  function isDone()     { return _phase === PHASE.DONE; }

  return { init, start, tick, cleanup, destroy, isStirring, isDone };
})();

window.Step8Stir = Step8Stir;