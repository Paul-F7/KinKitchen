/* global THREE */
'use strict';

/**
 * Step6Veggies — Drop the cut veggies (squash cubes, diced onion, minced garlic) into the pot
 *
 * Phases:
 *   1. IDLE           — waiting for user to click "Add Veggies"
 *   2. DROP_SQUASH    — squash cubes arc up and fall into the pot
 *   3. DROP_ONION     — diced onion arcs up and falls into the pot
 *   4. DROP_GARLIC    — minced garlic arcs up and falls into the pot
 *   5. SETTLE         — brief pause with splash particles settling
 *   6. DONE           — pipeline complete
 *
 * API (called by CookingGuide):
 *   Step6Veggies.init(scene)
 *   Step6Veggies.start({ squashMesh, onionMesh, garlicMesh, potMesh, onComplete })
 *   Step6Veggies.tick(dt)
 *   Step6Veggies.isDropping()
 *   Step6Veggies.cleanup()
 *   Step6Veggies.destroy()
 */
const Step6Veggies = (() => {

  // ── Phases ───────────────────────────────────────────────────────────────
  const PHASE = {
    IDLE:         'IDLE',
    DROP_SQUASH:  'DROP_SQUASH',
    DROP_ONION:   'DROP_ONION',
    DROP_GARLIC:  'DROP_GARLIC',
    SETTLE:       'SETTLE',
    DONE:         'DONE',
  };

  // ── Timing ───────────────────────────────────────────────────────────────
  const DROP_DUR    = 1.4;   // seconds per veggie drop
  const PAUSE_DUR   = 0.3;   // brief gap between drops
  const SETTLE_DUR  = 0.8;   // final settle time
  const ARC_HEIGHT  = 0.35;  // peak height of arc above start

  // ── Splash particles ────────────────────────────────────────────────────
  const SPLASH_COUNT    = 8;
  const SPLASH_LIFE     = 0.6;
  const SPLASH_SCALE    = 0.006;
  const STOCK_COLOR     = 0xC9A84C;
  const STOCK_COLOR2    = 0xD4B65A;

  // ── Easing helpers ──────────────────────────────────────────────────────
  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }
  function easeInQuad(t)  { return t * t; }
  function lerp(a, b, t)  { return a + (b - a) * Math.max(0, Math.min(1, t)); }

  // ── State ───────────────────────────────────────────────────────────────
  let _scene      = null;
  let _phase      = PHASE.IDLE;
  let _phaseT     = 0;
  let _completed  = false;
  let _onComplete = null;

  // Meshes
  let _squashMesh = null;
  let _onionMesh  = null;
  let _garlicMesh = null;
  let _potMesh    = null;

  // Saved original positions (to arc from)
  let _squashOrig = null;
  let _onionOrig  = null;
  let _garlicOrig = null;

  // Pot bounds
  let _potCenter  = null;
  let _potRimY    = 0;
  let _potBottomY = 0;
  let _potRadius  = 0;

  // Drop target (inside pot, slightly below rim)
  let _dropTarget = null;

  // Current dropping mesh (for the active phase)
  let _currentMesh = null;
  let _currentOrig = null;

  // Particles
  let _particles = [];

  // ── Init ────────────────────────────────────────────────────────────────
  function init(scene) {
    _scene = scene;
    console.log('[Step6Veggies] initialized');
  }

  // ── Start pipeline ──────────────────────────────────────────────────────
  function start(opts) {
    cleanup();
    _completed = false;

    _squashMesh = opts.squashMesh;
    _onionMesh  = opts.onionMesh;
    _garlicMesh = opts.garlicMesh;
    _potMesh    = opts.potMesh;
    _onComplete = opts.onComplete || null;

    if (!_potMesh) {
      console.warn('[Step6Veggies] missing potMesh');
      _enterPhase(PHASE.DONE);
      _fireComplete();
      return;
    }

    // Save original positions
    if (_squashMesh) {
      _squashOrig = { x: _squashMesh.position.x, y: _squashMesh.position.y, z: _squashMesh.position.z };
    }
    if (_onionMesh) {
      _onionOrig = { x: _onionMesh.position.x, y: _onionMesh.position.y, z: _onionMesh.position.z };
    }
    if (_garlicMesh) {
      _garlicOrig = { x: _garlicMesh.position.x, y: _garlicMesh.position.y, z: _garlicMesh.position.z };
    }

    // Compute pot bounds
    const box    = new THREE.Box3().setFromObject(_potMesh);
    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3());
    _potCenter   = { x: center.x, y: center.y, z: center.z };
    _potRimY     = box.max.y;
    _potBottomY  = box.min.y;
    _potRadius   = Math.min(size.x, size.z) * 0.35;

    // Drop target: center of pot, slightly below rim
    _dropTarget = {
      x: _potCenter.x,
      y: _potRimY - (_potRimY - _potBottomY) * 0.25,
      z: _potCenter.z,
    };

    console.log('[Step6Veggies] pot bounds — rim:', _potRimY, 'radius:', _potRadius.toFixed(3));

    // Start the first drop
    _startDrop(PHASE.DROP_SQUASH);
  }

  // ── Phase transitions ─────────────────────────────────────────────────
  function _enterPhase(phase) {
    _phase  = phase;
    _phaseT = 0;
    console.log('[Step6Veggies] phase →', phase);

    if (phase === PHASE.DONE) {
      _completed = true;
    }
  }

  // ── Start a specific drop ─────────────────────────────────────────────
  function _startDrop(phase) {
    switch (phase) {
      case PHASE.DROP_SQUASH:
        _currentMesh = _squashMesh;
        _currentOrig = _squashOrig;
        break;
      case PHASE.DROP_ONION:
        _currentMesh = _onionMesh;
        _currentOrig = _onionOrig;
        break;
      case PHASE.DROP_GARLIC:
        _currentMesh = _garlicMesh;
        _currentOrig = _garlicOrig;
        break;
      default:
        _currentMesh = null;
        _currentOrig = null;
    }

    // Skip if mesh doesn't exist
    if (!_currentMesh || !_currentOrig) {
      _advanceFromDrop(phase);
      return;
    }

    // Make sure it's visible
    _currentMesh.visible = true;
    _enterPhase(phase);
  }

  // ── Advance to next drop or settle ────────────────────────────────────
  function _advanceFromDrop(currentPhase) {
    switch (currentPhase) {
      case PHASE.DROP_SQUASH:
        _startDrop(PHASE.DROP_ONION);
        break;
      case PHASE.DROP_ONION:
        _startDrop(PHASE.DROP_GARLIC);
        break;
      case PHASE.DROP_GARLIC:
        _enterPhase(PHASE.SETTLE);
        break;
      default:
        _enterPhase(PHASE.DONE);
        _fireComplete();
    }
  }

  // ── Main tick ─────────────────────────────────────────────────────────
  function tick(dt) {
    _phaseT += dt;

    switch (_phase) {
      case PHASE.IDLE:        return;
      case PHASE.DROP_SQUASH:
      case PHASE.DROP_ONION:
      case PHASE.DROP_GARLIC:
        _tickDrop(dt);
        break;
      case PHASE.SETTLE:
        _tickSettle();
        break;
      case PHASE.DONE:        return;
    }

    // Always tick particles
    _tickParticles(dt);
  }

  // ── Tick: drop a veggie into the pot ──────────────────────────────────
  function _tickDrop(dt) {
    if (!_currentMesh || !_currentOrig) return;

    const t = Math.min(_phaseT / DROP_DUR, 1);

    // First half: rise in arc. Second half: drop into pot with gravity feel.
    const ease = easeInOutCubic(t);

    // Arc motion: rise high, then curve down into pot
    // Horizontal: smooth lerp to pot center (with slight offset per veggie)
    const offsetX = _phase === PHASE.DROP_SQUASH ? -0.02 :
                    _phase === PHASE.DROP_ONION  ?  0.02 : 0;
    const offsetZ = _phase === PHASE.DROP_SQUASH ?  0.02 :
                    _phase === PHASE.DROP_ONION  ? -0.02 : 0.01;

    const targetX = _dropTarget.x + offsetX;
    const targetZ = _dropTarget.z + offsetZ;

    // Vertical arc: parabolic — rise then fall
    // Peak at t=0.4 for a natural toss feel
    const peakT = 0.4;
    let arcY;
    if (t < peakT) {
      // Rising
      const riseT = t / peakT;
      const riseEase = easeOutQuad(riseT);
      arcY = lerp(_currentOrig.y, _currentOrig.y + ARC_HEIGHT + 0.1, riseEase);
    } else {
      // Falling into pot
      const fallT = (t - peakT) / (1 - peakT);
      const fallEase = easeInQuad(fallT);
      arcY = lerp(_currentOrig.y + ARC_HEIGHT + 0.1, _dropTarget.y, fallEase);
    }

    _currentMesh.position.set(
      lerp(_currentOrig.x, targetX, ease),
      arcY,
      lerp(_currentOrig.z, targetZ, ease)
    );

    // Gentle tumble rotation during flight
    const tumbleSpeed = 2.5;
    _currentMesh.rotation.x += dt * tumbleSpeed * (0.5 + Math.sin(_phaseT * 3) * 0.3);
    _currentMesh.rotation.z += dt * tumbleSpeed * 0.4;

    // At t=1, land and spawn splash
    if (t >= 1) {
      _currentMesh.position.set(targetX, _dropTarget.y, targetZ);

      // Spawn splash particles
      _spawnSplashBurst();

      // Shrink the mesh into the pot (it disappears into the liquid)
      _sinkIntoLiquid(_currentMesh);

      // Advance
      _advanceFromDrop(_phase);
    }
  }

  // ── Sink mesh into liquid (quick scale-down) ─────────────────────────
  function _sinkIntoLiquid(mesh) {
    if (!mesh) return;
    // Store ref for the sink animation
    const sinkData = {
      mesh,
      startScale: mesh.scale.clone(),
      startY: mesh.position.y,
      age: 0,
      dur: 0.5,
    };
    _particles.push({
      type: 'sink',
      data: sinkData,
    });
  }

  // ── Tick: settle phase ───────────────────────────────────────────────
  function _tickSettle() {
    if (_phaseT >= SETTLE_DUR) {
      _enterPhase(PHASE.DONE);
      _fireComplete();
    }
  }

  // ── Splash burst when veggie hits liquid ─────────────────────────────
  function _spawnSplashBurst() {
    if (!_scene || !_potCenter) return;

    const splashY = _dropTarget.y + 0.01;

    for (let i = 0; i < SPLASH_COUNT; i++) {
      const geo = new THREE.SphereGeometry(0.005, 4, 3);
      const mat = new THREE.MeshStandardMaterial({
        color: Math.random() > 0.5 ? STOCK_COLOR : STOCK_COLOR2,
        transparent: true,
        opacity: 0.8,
        roughness: 0.3,
        metalness: 0.05,
      });
      const mesh = new THREE.Mesh(geo, mat);

      const angle = (i / SPLASH_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const dist  = _potRadius * (0.15 + Math.random() * 0.25);
      mesh.position.set(
        _potCenter.x + Math.cos(angle) * dist,
        splashY,
        _potCenter.z + Math.sin(angle) * dist
      );
      mesh.scale.setScalar(0.001);

      _scene.add(mesh);
      _particles.push({
        type: 'splash',
        mesh,
        age: 0,
        vx: Math.cos(angle) * (0.06 + Math.random() * 0.08),
        vy: 0.12 + Math.random() * 0.15,
        vz: Math.sin(angle) * (0.06 + Math.random() * 0.08),
        maxLife: SPLASH_LIFE,
        maxScale: SPLASH_SCALE * (0.7 + Math.random() * 0.6),
      });
    }
  }

  // ── Tick all particles ──────────────────────────────────────────────
  function _tickParticles(dt) {
    for (let i = _particles.length - 1; i >= 0; i--) {
      const p = _particles[i];

      if (p.type === 'sink') {
        // Sink animation: scale down and lower into liquid
        const d = p.data;
        d.age += dt;
        const t = Math.min(d.age / d.dur, 1);
        const ease = easeInQuad(t);
        const scale = 1 - ease * 0.9;
        d.mesh.scale.set(
          d.startScale.x * scale,
          d.startScale.y * scale,
          d.startScale.z * scale
        );
        d.mesh.position.y = d.startY - ease * 0.04;

        if (t >= 1) {
          d.mesh.visible = false;
          _particles.splice(i, 1);
        }
        continue;
      }

      // Splash particles
      p.age += dt;

      // Grow in
      const growT = Math.min(p.age / 0.1, 1);
      p.mesh.scale.setScalar(p.maxScale * easeOutQuad(growT));

      // Move
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;

      // Gravity
      p.vy -= dt * 0.5;

      // Fade out
      const fadeStart = p.maxLife * 0.3;
      if (p.age > fadeStart) {
        const fade = 1 - (p.age - fadeStart) / (p.maxLife * 0.7);
        if (fade <= 0) {
          _scene.remove(p.mesh);
          p.mesh.geometry.dispose();
          p.mesh.material.dispose();
          _particles.splice(i, 1);
          continue;
        }
        p.mesh.material.opacity = fade * 0.8;
      }
    }
  }

  // ── Fire completion callback ────────────────────────────────────────
  function _fireComplete() {
    if (_onComplete) {
      const cb = _onComplete;
      _onComplete = null;
      cb();
    }
  }

  // ── Cleanup & destroy ──────────────────────────────────────────────
  function cleanup() {
    // Remove splash particles
    _particles.forEach(p => {
      if (p.type === 'splash' && p.mesh && _scene) {
        _scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
      }
    });
    _particles = [];

    // Restore meshes if pipeline didn't complete
    if (!_completed) {
      if (_squashMesh && _squashOrig) {
        _squashMesh.position.set(_squashOrig.x, _squashOrig.y, _squashOrig.z);
        _squashMesh.visible = true;
      }
      if (_onionMesh && _onionOrig) {
        _onionMesh.position.set(_onionOrig.x, _onionOrig.y, _onionOrig.z);
        _onionMesh.visible = true;
      }
      if (_garlicMesh && _garlicOrig) {
        _garlicMesh.position.set(_garlicOrig.x, _garlicOrig.y, _garlicOrig.z);
        _garlicMesh.visible = true;
      }
    }

    _squashMesh  = null;
    _onionMesh   = null;
    _garlicMesh  = null;
    _potMesh     = null;
    _squashOrig  = null;
    _onionOrig   = null;
    _garlicOrig  = null;
    _potCenter   = null;
    _dropTarget  = null;
    _currentMesh = null;
    _currentOrig = null;
    _onComplete  = null;
    _phase       = PHASE.IDLE;
    _phaseT      = 0;
  }

  function destroy() {
    cleanup();
    _scene = null;
  }

  // ── Public queries ──────────────────────────────────────────────────
  function isDropping() {
    return _phase === PHASE.DROP_SQUASH ||
           _phase === PHASE.DROP_ONION ||
           _phase === PHASE.DROP_GARLIC;
  }
  function isDone() { return _completed; }
  function phase()  { return _phase; }

  return {
    init, start, tick, cleanup, destroy,
    isDropping, isDone, phase,
  };
})();

window.Step6Veggies = Step6Veggies;