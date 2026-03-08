/* global THREE */
'use strict';

/**
 * Step4Stock — Pour chicken stock into the pot
 *
 * Phases (executed in strict order):
 *   1. IDLE            — waiting for user to click "Start Pouring"
 *   2. MOVE_STOCK      — stock container arcs from shelf to above the pot
 *   3. TILT            — container tilts forward to pour
 *   4. POURING         — liquid stream flows, splash particles, pot fills
 *   5. UNTILT          — container tilts back upright, stream stops
 *   6. MOVE_STOCK_BACK — container arcs back to shelf position
 *   7. DONE            — pipeline complete
 *
 * API (called by CookingGuide):
 *   Step4Stock.init(scene)
 *   Step4Stock.start({ stockMesh, potMesh, onComplete })
 *   Step4Stock.tick(dt)
 *   Step4Stock.isPouring()
 *   Step4Stock.cleanup()
 *   Step4Stock.destroy()
 */
const Step4Stock = (() => {

  // ── Phases ───────────────────────────────────────────────────────────────
  const PHASE = {
    IDLE:            'IDLE',
    MOVE_STOCK:      'MOVE_STOCK',
    TILT:            'TILT',
    POURING:         'POURING',
    UNTILT:          'UNTILT',
    MOVE_STOCK_BACK: 'MOVE_STOCK_BACK',
    DONE:            'DONE',
  };

  // ── Timing ───────────────────────────────────────────────────────────────
  const MOVE_STOCK_DUR  = 1.2;
  const TILT_DUR        = 0.8;
  const POUR_DUR        = 3.0;
  const UNTILT_DUR      = 0.6;
  const MOVE_BACK_DUR   = 1.0;

  // ── Pour stream ──────────────────────────────────────────────────────────
  const STOCK_COLOR     = 0xC9A84C;   // golden chicken stock
  const STOCK_COLOR2    = 0xD4B65A;   // lighter variation
  const STREAM_APPEAR   = 0.4;        // seconds for stream to grow in
  const STREAM_CURVE_PTS = 20;        // points along the curve

  // ── Splash particles ─────────────────────────────────────────────────────
  const SPLASH_INTERVAL = 0.08;       // spawn every N seconds
  const SPLASH_COUNT    = 2;          // per spawn
  const SPLASH_LIFE     = 0.5;        // seconds before fully faded
  const SPLASH_SCALE    = 0.006;

  // ── Drip particles along stream ──────────────────────────────────────────
  const DRIP_INTERVAL   = 0.05;
  const DRIP_COUNT      = 1;
  const DRIP_LIFE       = 0.8;
  const DRIP_SCALE      = 0.004;

  // ── Fill disc ────────────────────────────────────────────────────────────
  const FILL_MAX_HEIGHT = 0.06;       // how high the liquid rises

  // ── Tilt angle ───────────────────────────────────────────────────────────
  const TILT_ANGLE      = -Math.PI * 0.55;  // ~100° forward tilt

  // ── Easing helpers ───────────────────────────────────────────────────────
  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }
  function easeInQuad(t)  { return t * t; }
  function lerp(a, b, t)  { return a + (b - a) * Math.max(0, Math.min(1, t)); }

  // ── State ────────────────────────────────────────────────────────────────
  let _scene     = null;
  let _phase     = PHASE.IDLE;
  let _phaseT    = 0;
  let _completed = false;

  // References (set via start())
  let _stockMesh   = null;
  let _potMesh     = null;
  let _onComplete  = null;

  // Saved transforms
  let _origPos = null;
  let _origRot = null;
  let _abovePos = null;

  // Stock container bounding info (for computing spout)
  let _stockHalfHeight = 0;

  // Pour stream
  let _streamMesh  = null;
  let _streamOrigVerts = null;

  // Fill disc
  let _fillMesh    = null;
  let _fillBaseY   = 0;

  // Particles (splash + drips)
  let _splashParticles = [];
  let _splashTimer     = 0;
  let _dripTimer       = 0;

  // Pot bounds (computed at runtime)
  let _potCenter = null;
  let _potRimY   = 0;
  let _potBottomY = 0;
  let _potRadius = 0;

  // Spout world position (recomputed each frame while pouring)
  let _spoutPos = null;

  // ── Init ─────────────────────────────────────────────────────────────────
  function init(scene) {
    _scene = scene;
    console.log('[Step4Stock] initialized');
  }

  // ── Start pipeline ───────────────────────────────────────────────────────
  function start(opts) {
    cleanup();
    _completed = false;

    _stockMesh  = opts.stockMesh;
    _potMesh    = opts.potMesh;
    _onComplete = opts.onComplete || null;

    if (!_stockMesh || !_potMesh) {
      console.warn('[Step4Stock] missing stockMesh or potMesh');
      _enterPhase(PHASE.DONE);
      _fireComplete();
      return;
    }

    // Save original stock transform
    _origPos = {
      x: _stockMesh.position.x,
      y: _stockMesh.position.y,
      z: _stockMesh.position.z,
    };
    _origRot = {
      x: _stockMesh.rotation.x,
      y: _stockMesh.rotation.y,
      z: _stockMesh.rotation.z,
    };

    // Measure the stock container to find its height (for spout offset)
    const stockBox = new THREE.Box3().setFromObject(_stockMesh);
    const stockSize = stockBox.getSize(new THREE.Vector3());
    _stockHalfHeight = stockSize.y * 0.5;

    // Compute pot bounds
    const box = new THREE.Box3().setFromObject(_potMesh);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    _potCenter = { x: center.x, y: center.y, z: center.z };
    _potRimY   = box.max.y;
    _potBottomY = box.min.y;
    _potRadius = Math.min(size.x, size.z) * 0.35;

    console.log('[Step4Stock] pot bounds — rim:', _potRimY, 'bottom:', _potBottomY,
      'depth:', (_potRimY - _potBottomY).toFixed(3), 'radius:', _potRadius.toFixed(3));

    // Target position: above the pot rim, offset to the side so spout is over pot
    _abovePos = {
      x: _potCenter.x - 0.15,
      y: _potRimY + _stockHalfHeight + 0.35,
      z: _potCenter.z,
    };

    _enterPhase(PHASE.MOVE_STOCK);
  }

  // ── Phase transitions ───────────────────────────────────────────────────
  function _enterPhase(phase) {
    _phase  = phase;
    _phaseT = 0;
    console.log('[Step4Stock] phase →', phase);

    if (phase === PHASE.POURING) {
      _splashTimer = 0;
      _dripTimer   = 0;
      _buildFill();
    }
    if (phase === PHASE.DONE) {
      _completed = true;
    }
  }

  // ── Compute spout world position from tilted container ──────────────────
  function _getSpoutWorldPos() {
    if (!_stockMesh) return _abovePos;

    // The spout is at the "top" of the container in local space.
    // When tilted, we need the world position of the container's top edge.
    // Local top of container: (0, halfHeight, 0) — then transformed to world.
    const SPOUT_Y_OFFSET = 0.75;
    const localSpout = new THREE.Vector3(0, _stockHalfHeight + SPOUT_Y_OFFSET, 0);
    _stockMesh.updateMatrixWorld(true);
    const worldSpout = localSpout.applyMatrix4(_stockMesh.matrixWorld);
    return { x: worldSpout.x, y: worldSpout.y, z: worldSpout.z };
  }

  // ── Main tick ────────────────────────────────────────────────────────────
  function tick(dt) {
    _phaseT += dt;

    switch (_phase) {
      case PHASE.IDLE:            return;
      case PHASE.MOVE_STOCK:      _tickMoveStock();      break;
      case PHASE.TILT:            _tickTilt();            break;
      case PHASE.POURING:         _tickPouring(dt);       break;
      case PHASE.UNTILT:          _tickUntilt();          break;
      case PHASE.MOVE_STOCK_BACK: _tickMoveBack();        break;
      case PHASE.DONE:            return;
    }

    // Always tick particles
    _tickAllParticles(dt);
  }

  // ── Phase: Move stock to above pot ───────────────────────────────────────
  function _tickMoveStock() {
    if (!_stockMesh) return;
    const t = Math.min(_phaseT / MOVE_STOCK_DUR, 1);
    const ease = easeInOutCubic(t);
    const arc  = Math.sin(t * Math.PI) * 0.2;

    _stockMesh.position.set(
      lerp(_origPos.x, _abovePos.x, ease),
      lerp(_origPos.y, _abovePos.y, ease) + arc,
      lerp(_origPos.z, _abovePos.z, ease)
    );

    // Gradually rotate to upright during move
    _stockMesh.rotation.set(
      lerp(_origRot.x, 0, ease),
      lerp(_origRot.y, 0, ease),
      lerp(_origRot.z, 0, ease)
    );

    if (t >= 1) {
      _stockMesh.position.set(_abovePos.x, _abovePos.y, _abovePos.z);
      _stockMesh.rotation.set(0, 0, 0);
      _enterPhase(PHASE.TILT);
    }
  }

  // ── Phase: Tilt container forward ────────────────────────────────────────
  function _tickTilt() {
    if (!_stockMesh) return;
    const t = Math.min(_phaseT / TILT_DUR, 1);
    const ease = easeInOutCubic(t);

    _stockMesh.rotation.z = lerp(0, TILT_ANGLE, ease);

    if (t >= 1) {
      _stockMesh.rotation.z = TILT_ANGLE;
      _enterPhase(PHASE.POURING);
    }
  }

  // ── Phase: Pouring ───────────────────────────────────────────────────────
  function _tickPouring(dt) {
    const t = Math.min(_phaseT / POUR_DUR, 1);

    // Get current spout position (changes as container is tilted)
    _spoutPos = _getSpoutWorldPos();

    // Rebuild stream each frame to follow spout — use curved tube
    _rebuildStream(_phaseT);

    // Grow fill inside pot (starts at bottom, rises)
    if (_fillMesh) {
      _fillMesh.visible = true;
      const fillProgress = easeOutQuad(t);
      const fillHeight = fillProgress * FILL_MAX_HEIGHT;
      _fillMesh.scale.y = Math.max(0.001, fillHeight / 0.01); // 0.01 is base geo height
      _fillMesh.position.y = _fillBaseY + fillHeight * 0.5;
    }

    // Spawn splash particles at the liquid surface
    _splashTimer += dt;
    if (_splashTimer >= SPLASH_INTERVAL) {
      _splashTimer -= SPLASH_INTERVAL;
      for (let i = 0; i < SPLASH_COUNT; i++) {
        _spawnSplash();
      }
    }

    // Spawn drip particles along the stream
    _dripTimer += dt;
    if (_dripTimer >= DRIP_INTERVAL) {
      _dripTimer -= DRIP_INTERVAL;
      for (let i = 0; i < DRIP_COUNT; i++) {
        _spawnDrip();
      }
    }

    if (t >= 1) {
      _enterPhase(PHASE.UNTILT);
    }
  }

  // ── Phase: Untilt ────────────────────────────────────────────────────────
  function _tickUntilt() {
    if (!_stockMesh) return;
    const t = Math.min(_phaseT / UNTILT_DUR, 1);
    const ease = easeInOutCubic(t);

    _stockMesh.rotation.z = lerp(TILT_ANGLE, 0, ease);

    // Shrink stream and fade it out
    if (_streamMesh && t < 0.5) {
      _spoutPos = _getSpoutWorldPos();
      _rebuildStream(_phaseT, 1 - easeInQuad(t * 2));
    } else {
      _removeStream();
    }

    if (t >= 1) {
      _stockMesh.rotation.z = 0;
      _removeStream();
      _enterPhase(PHASE.MOVE_STOCK_BACK);
    }
  }

  // ── Phase: Return stock to shelf ─────────────────────────────────────────
  function _tickMoveBack() {
    if (!_stockMesh) return;
    const t = Math.min(_phaseT / MOVE_BACK_DUR, 1);
    const ease = easeInOutCubic(t);
    const arc  = Math.sin(t * Math.PI) * 0.15;

    _stockMesh.position.set(
      lerp(_abovePos.x, _origPos.x, ease),
      lerp(_abovePos.y, _origPos.y, ease) + arc,
      lerp(_abovePos.z, _origPos.z, ease)
    );

    _stockMesh.rotation.set(
      lerp(0, _origRot.x, ease),
      lerp(0, _origRot.y, ease),
      lerp(0, _origRot.z, ease)
    );

    if (t >= 1) {
      _stockMesh.position.set(_origPos.x, _origPos.y, _origPos.z);
      _stockMesh.rotation.set(_origRot.x, _origRot.y, _origRot.z);
      _enterPhase(PHASE.DONE);
      _fireComplete();
    }
  }

  // ── Build/rebuild pour stream as a curved tube from spout to pot ────────
  function _rebuildStream(time, scaleFactor) {
    _removeStream();
    if (!_spoutPos || !_potCenter) return;

    const sf = (scaleFactor !== undefined) ? scaleFactor : 1;
    if (sf <= 0.01) return;

    // Grow-in factor
    const growT = Math.min(time / STREAM_APPEAR, 1);
    const reach = easeOutQuad(growT) * sf;

    // The liquid surface inside the pot (where the stream should end)
    const surfaceY = _fillMesh
      ? _fillMesh.position.y
      : lerp(_potBottomY, _potRimY, 0.15);

    // Build a curved path from spout down into the pot
    // The stream curves naturally due to gravity
    const startX = _spoutPos.x;
    const startY = _spoutPos.y;
    const startZ = _spoutPos.z;
    const endX   = _potCenter.x;
    const endY   = surfaceY + 0.02;
    const endZ   = _potCenter.z;

    const points = [];
    for (let i = 0; i <= STREAM_CURVE_PTS; i++) {
      const p = i / STREAM_CURVE_PTS;
      const pr = Math.min(p / reach, 1); // clamp to reach

      // Horizontal: lerp from spout to pot center
      const px = lerp(startX, endX, pr);
      const pz = lerp(startZ, endZ, pr);

      // Vertical: stronger gravity-like curve (noticeable arc)
      // Use a mid-curve sag term + accelerating drop
      const linearY = lerp(startY, endY, pr);
      const dx = endX - startX;
      const dz = endZ - startZ;
      const horizDist = Math.sqrt(dx * dx + dz * dz);
      const sagMag = 0.06 + horizDist * 0.18; // scale sag by distance
      const sag = (pr * (1 - pr)) * sagMag + pr * pr * 0.015;
      const py = linearY - sag;

      // Add wobble
      const wobbleX = Math.sin(p * 12 + time * 7) * 0.003 * p;
      const wobbleZ = Math.cos(p * 10 + time * 5.5) * 0.002 * p;

      points.push(new THREE.Vector3(px + wobbleX, py, pz + wobbleZ));
    }

    // Only use points up to where reach ends
    const usePts = Math.max(2, Math.floor(STREAM_CURVE_PTS * reach) + 1);
    const curvePoints = points.slice(0, usePts);

    if (curvePoints.length < 2) return;

    const curve = new THREE.CatmullRomCurve3(curvePoints);

    // Varying radius: thin at spout, slightly wider in middle, thin at end
    const radiusSteps = 8;
    const radiuses = [];
    for (let i = 0; i <= radiusSteps; i++) {
      const rp = i / radiusSteps;
      // Starts wider, widens more in the middle, thins at bottom
      const base = 0.018 + Math.sin(rp * Math.PI) * 0.012;
      // Add subtle pulsing
      const pulse = 1 + Math.sin(time * 8 + rp * 6) * 0.15;
      radiuses.push(base * pulse);
    }

    // Build tube geometry
    const tubeGeo = new THREE.TubeGeometry(curve, usePts * 2, 0.025, 8, false);

    // Modify radii per ring for variable thickness
    const posAttr = tubeGeo.attributes.position;
    const count = posAttr.count;
    const ringSize = 9; // 8 radial segments + 1 (closed ring)
    const numRings = Math.floor(count / ringSize);

    // Compute center of each ring, then scale vertices from center
    for (let ring = 0; ring < numRings; ring++) {
      const rp = ring / Math.max(numRings - 1, 1);
      const ridx = Math.min(Math.floor(rp * radiusSteps), radiusSteps);
      const targetR = radiuses[ridx];
      const scaleR = targetR / 0.025; // 0.025 is the base tube radius

      // Find ring center
      let cx = 0, cy = 0, cz = 0;
      for (let v = 0; v < ringSize && (ring * ringSize + v) < count; v++) {
        const idx = ring * ringSize + v;
        cx += posAttr.getX(idx);
        cy += posAttr.getY(idx);
        cz += posAttr.getZ(idx);
      }
      const n = Math.min(ringSize, count - ring * ringSize);
      cx /= n; cy /= n; cz /= n;

      // Scale from center
      for (let v = 0; v < ringSize && (ring * ringSize + v) < count; v++) {
        const idx = ring * ringSize + v;
        const vx = posAttr.getX(idx);
        const vy = posAttr.getY(idx);
        const vz = posAttr.getZ(idx);
        posAttr.setXYZ(idx,
          cx + (vx - cx) * scaleR,
          cy + (vy - cy) * scaleR,
          cz + (vz - cz) * scaleR
        );
      }
    }
    posAttr.needsUpdate = true;

    const mat = new THREE.MeshStandardMaterial({
      color: STOCK_COLOR,
      transparent: true,
      opacity: 0.7,
      roughness: 0.15,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });

    _streamMesh = new THREE.Mesh(tubeGeo, mat);
    _scene.add(_streamMesh);
  }

  // ── Build fill disc inside pot (starts near bottom) ─────────────────────
  function _buildFill() {
    _removeFill();

    const radius = _potRadius * 0.75;
    const geo = new THREE.CylinderGeometry(radius, radius, 0.01, 20);
    const mat = new THREE.MeshStandardMaterial({
      color: STOCK_COLOR,
      transparent: true,
      opacity: 0.6,
      roughness: 0.15,
      metalness: 0.12,
    });

    _fillMesh = new THREE.Mesh(geo, mat);
    // Start near the bottom of the pot, not near the rim
    const potDepth = _potRimY - _potBottomY;
    _fillBaseY = _potBottomY + potDepth * 0.15; // 15% up from bottom
    _fillMesh.position.set(_potCenter.x, _fillBaseY, _potCenter.z);
    _fillMesh.scale.y = 0.001;
    _fillMesh.visible = false;
    _scene.add(_fillMesh);
  }

  // ── Splash particle spawning (at liquid surface in pot) ─────────────────
  function _spawnSplash() {
    if (!_scene || !_potCenter) return;

    const geo = new THREE.SphereGeometry(0.005, 4, 3);
    const mat = new THREE.MeshStandardMaterial({
      color: Math.random() > 0.5 ? STOCK_COLOR : STOCK_COLOR2,
      transparent: true,
      opacity: 0.75,
      roughness: 0.3,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(geo, mat);

    // Splash near where stream hits the surface
    const splashY = _fillMesh ? _fillMesh.position.y : _potBottomY + 0.05;
    const angle = Math.random() * Math.PI * 2;
    const dist  = Math.random() * _potRadius * 0.25;
    mesh.position.set(
      _potCenter.x + Math.cos(angle) * dist,
      splashY + 0.01,
      _potCenter.z + Math.sin(angle) * dist
    );
    mesh.scale.setScalar(0.001);

    _scene.add(mesh);
    _splashParticles.push({
      mesh,
      age: 0,
      type: 'splash',
      vx: (Math.random() - 0.5) * 0.08,
      vy: 0.06 + Math.random() * 0.1,
      vz: (Math.random() - 0.5) * 0.08,
      maxLife: SPLASH_LIFE,
      maxScale: SPLASH_SCALE,
    });
  }

  // ── Drip particles (small droplets that break off the stream) ───────────
  function _spawnDrip() {
    if (!_scene || !_spoutPos || !_potCenter) return;

    const geo = new THREE.SphereGeometry(0.003, 3, 2);
    const mat = new THREE.MeshStandardMaterial({
      color: STOCK_COLOR2,
      transparent: true,
      opacity: 0.6,
      roughness: 0.2,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(geo, mat);

    // Spawn along the stream path with some randomness
    const streamT = 0.2 + Math.random() * 0.6;
    const surfaceY = _fillMesh ? _fillMesh.position.y : _potBottomY + 0.05;
    mesh.position.set(
      lerp(_spoutPos.x, _potCenter.x, streamT) + (Math.random() - 0.5) * 0.02,
      lerp(_spoutPos.y, surfaceY, streamT * streamT),
      lerp(_spoutPos.z, _potCenter.z, streamT) + (Math.random() - 0.5) * 0.02
    );
    mesh.scale.setScalar(0.001);

    _scene.add(mesh);
    _splashParticles.push({
      mesh,
      age: 0,
      type: 'drip',
      vx: (Math.random() - 0.5) * 0.03,
      vy: -0.05 - Math.random() * 0.1,
      vz: (Math.random() - 0.5) * 0.03,
      maxLife: DRIP_LIFE,
      maxScale: DRIP_SCALE,
    });
  }

  // ── Tick all particles (splash + drip) ──────────────────────────────────
  function _tickAllParticles(dt) {
    for (let i = _splashParticles.length - 1; i >= 0; i--) {
      const p = _splashParticles[i];
      p.age += dt;

      // Grow in
      const growT = Math.min(p.age / 0.1, 1);
      p.mesh.scale.setScalar(p.maxScale * easeOutQuad(growT));

      // Move
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;

      // Gravity
      if (p.type === 'splash') {
        p.vy -= dt * 0.4;
      } else {
        p.vy -= dt * 0.2;
      }

      // Fade out
      const fadeStart = p.maxLife * 0.35;
      if (p.age > fadeStart) {
        const fade = 1 - (p.age - fadeStart) / (p.maxLife * 0.65);
        if (fade <= 0) {
          _scene.remove(p.mesh);
          p.mesh.geometry.dispose();
          p.mesh.material.dispose();
          _splashParticles.splice(i, 1);
          continue;
        }
        p.mesh.material.opacity = fade * 0.7;
      }
    }
  }

  // ── Remove helpers ───────────────────────────────────────────────────────
  function _removeStream() {
    if (_streamMesh && _scene) {
      _scene.remove(_streamMesh);
      _streamMesh.geometry.dispose();
      _streamMesh.material.dispose();
    }
    _streamMesh = null;
    _streamOrigVerts = null;
  }

  function _removeFill() {
    if (_fillMesh && _scene) {
      _scene.remove(_fillMesh);
      _fillMesh.geometry.dispose();
      _fillMesh.material.dispose();
    }
    _fillMesh = null;
  }

  function _removeAllParticles() {
    _splashParticles.forEach(p => {
      if (p.mesh && _scene) {
        _scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
      }
    });
    _splashParticles = [];
  }

  function _fireComplete() {
    if (_onComplete) {
      const cb = _onComplete;
      _onComplete = null;
      cb();
    }
  }

  // ── Cleanup & destroy ───────────────────────────────────────────────────
  function cleanup() {
    _removeStream();
    _removeFill();
    _removeAllParticles();

    // Restore stock position if pipeline didn't complete
    if (_stockMesh && !_completed && _origPos && _origRot) {
      _stockMesh.position.set(_origPos.x, _origPos.y, _origPos.z);
      _stockMesh.rotation.set(_origRot.x, _origRot.y, _origRot.z);
    }

    _stockMesh   = null;
    _potMesh     = null;
    _origPos     = null;
    _origRot     = null;
    _abovePos    = null;
    _potCenter   = null;
    _spoutPos    = null;
    _splashTimer = 0;
    _dripTimer   = 0;
    _phase       = PHASE.IDLE;
    _phaseT      = 0;
    _onComplete  = null;
  }

  function destroy() {
    cleanup();
    _scene = null;
  }

  // ── Public queries ──────────────────────────────────────────────────────
  function isPouring() { return _phase === PHASE.POURING; }
  function isDone()    { return _completed; }
  function phase()     { return _phase; }

  return {
    init, start, tick, cleanup, destroy,
    isPouring, isDone, phase,
  };
})();

window.Step4Stock = Step4Stock;
