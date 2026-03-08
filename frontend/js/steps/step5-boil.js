/* global THREE */
'use strict';

/**
 * Step5Boil — Persistent boiling steam rising from the pot
 *
 * Once started, steam wisps persist for the rest of the tutorial.
 * Only destroyed on full CookingGuide.destroy() or reset().
 *
 * API (called by CookingGuide):
 *   Step5Boil.init(scene)
 *   Step5Boil.start({ potMesh, onComplete })
 *   Step5Boil.tick(dt)        — call EVERY frame once started
 *   Step5Boil.isActive()
 *   Step5Boil.cleanup()       — only called on reset/destroy
 *   Step5Boil.destroy()
 */
const Step5Boil = (() => {

  // ── Config ──────────────────────────────────────────────────────────────
  const WISP_COUNT      = 18;
  const BUBBLE_COUNT    = 6;
  const RAMP_DUR        = 2.5;   // seconds to ramp up from nothing to full steam

  // ── State ───────────────────────────────────────────────────────────────
  let _scene      = null;
  let _active     = false;
  let _elapsed    = 0;
  let _onComplete = null;

  // Pot info
  let _potCenter  = null;
  let _potRimY    = 0;
  let _potRadius  = 0;

  // Particle arrays
  let _wisps   = [];   // rising steam planes
  let _bubbles = [];   // small bubbling spheres at liquid surface
  let _wispTexture = null;

  // ── Helpers ─────────────────────────────────────────────────────────────
  function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }

  // ── Init ────────────────────────────────────────────────────────────────
  function init(scene) {
    _scene = scene;
    _wispTexture = _makeWispTexture();
    console.log('[Step5Boil] initialized');
  }

  // ── Start ───────────────────────────────────────────────────────────────
  function start(opts) {
    if (_active) return;  // already boiling

    const potMesh = opts.potMesh;
    _onComplete   = opts.onComplete || null;

    if (!potMesh) {
      console.warn('[Step5Boil] no potMesh');
      _fireComplete();
      return;
    }

    // Compute pot bounds
    const box    = new THREE.Box3().setFromObject(potMesh);
    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3());
    _potCenter   = { x: center.x, y: center.y, z: center.z };
    _potRimY     = box.max.y;
    _potRadius   = Math.min(size.x, size.z) * 0.35;

    _elapsed = 0;
    _active  = true;

    _spawnWisps();
    _spawnBubbles();

    // Auto-complete after ramp so the guide can advance
    setTimeout(() => _fireComplete(), (RAMP_DUR + 0.5) * 1000);

    console.log('[Step5Boil] steam started — will persist');
  }

  // ── Spawn steam wisps (thin planes that rise and twist) ─────────────────
  function _spawnWisps() {
    if (!_wispTexture) {
      _wispTexture = _makeWispTexture();
    }
    for (let i = 0; i < WISP_COUNT; i++) {
      const group = new THREE.Group();
      const sprites = [];
      const spriteCount = 3;
      for (let j = 0; j < spriteCount; j++) {
        const mat = new THREE.SpriteMaterial({
          color: 0xF2F2EA,
          map: _wispTexture,
          transparent: true,
          opacity: 0,
          depthTest: false,
          depthWrite: false,
          blending: THREE.NormalBlending,
        });
        const sprite = new THREE.Sprite(mat);
        const baseW = (0.085 + Math.random() * 0.055) * (1 - j * 0.12);
        const baseH = (0.24  + Math.random() * 0.20) * (1 - j * 0.08);
        const ox = (Math.random() - 0.5) * 0.04;
        const oy = j * 0.08 + Math.random() * 0.02;
        const oz = (Math.random() - 0.5) * 0.04;
        sprite.scale.set(baseW, baseH, 1);
        sprite.position.set(ox, oy, oz);
        sprite.material.rotation = Math.random() * Math.PI * 2;
        group.add(sprite);
        sprites.push({ sprite, baseW, baseH, ox, oy, oz });
      }
      group.visible = false;
      _scene.add(group);

      _wisps.push({
        mesh: group,
        sprites,
        phase:     Math.random(),
        speed:     0.14 + Math.random() * 0.12,
        ox:        (Math.random() - 0.5) * _potRadius * 1.2,
        oz:        (Math.random() - 0.5) * _potRadius * 1.2,
        rotOffset: Math.random() * Math.PI * 2,
        rotSpeed:  (Math.random() - 0.5) * 1.4,
        swayPhase: Math.random() * Math.PI * 2,
        curlPhase: Math.random() * Math.PI * 2,
        maxH:      0.50 + Math.random() * 0.30,
      });
    }
  }

  // ── Spawn bubbles at liquid surface ─────────────────────────────────────
  function _spawnBubbles() {
    for (let i = 0; i < BUBBLE_COUNT; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xDDDDD0,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
      });
      const r = 0.006 + Math.random() * 0.008;
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 6, 4), mat);
      mesh.visible = false;
      _scene.add(mesh);

      _bubbles.push({
        mesh,
        phase:  Math.random(),
        speed:  0.8 + Math.random() * 0.6,
        ox:     (Math.random() - 0.5) * _potRadius * 0.7,
        oz:     (Math.random() - 0.5) * _potRadius * 0.7,
      });
    }
  }

  // ── Tick (called every frame) ──────────────────────────────────────────
  function tick(dt) {
    if (!_active || !_potCenter) return;

    _elapsed += dt;
    const ramp = Math.min(_elapsed / RAMP_DUR, 1);
    const intensity = easeOutQuad(ramp);
    const now = performance.now() / 1000;

    // Tick wisps
    for (const w of _wisps) {
      w.phase = (w.phase + dt * w.speed) % 1;
      const lp = w.phase;

      // Fade in / out
      const fi = lp < 0.20 ? lp / 0.20 : 1;
      const fo = lp > 0.65 ? (1 - lp) / 0.35 : 1;
      const alpha = fi * fo * intensity * 0.45;

      w.mesh.visible = alpha > 0.01;

      // Position: rise from pot rim, sway
      const curl = 0.07 * Math.sin(now * 1.5 + w.curlPhase + lp * 9);
      const drift = lp * 0.10;
      w.mesh.position.set(
        _potCenter.x + w.ox + drift * Math.sin(now * 1.1 + w.swayPhase + lp * 6) + curl,
        _potRimY + 0.02 + lp * w.maxH,
        _potCenter.z + w.oz + drift * Math.cos(now * 0.9 + w.swayPhase) - curl * 0.6
      );

      // Twist
      w.mesh.rotation.y = w.rotOffset + w.rotSpeed * now;
      // Widen as they rise
      const spread = 1 + lp * 1.0;
      w.mesh.scale.set(spread, 1 + lp * 0.7, 1);

      // Per-sprite billow and opacity for volumetric look
      for (const s of w.sprites) {
        const puff = 1 + lp * 0.8 + Math.sin(now * 1.2 + w.curlPhase + s.oy * 6) * 0.10;
        s.sprite.material.opacity = alpha * (0.6 + s.oy * 1.5);
        s.sprite.scale.set(s.baseW * spread * puff, s.baseH * (1 + lp * 0.8) * puff, 1);
        s.sprite.position.set(
          s.ox + curl * 0.25,
          s.oy + lp * 0.10,
          s.oz - curl * 0.2
        );
      }
    }

    // Tick bubbles
    for (const b of _bubbles) {
      b.phase = (b.phase + dt * b.speed) % 1;
      const lp = b.phase;

      const fi = lp < 0.15 ? lp / 0.15 : 1;
      const fo = lp > 0.70 ? (1 - lp) / 0.30 : 1;
      const alpha = fi * fo * intensity * 0.5;

      b.mesh.visible = alpha > 0.01;
      b.mesh.material.opacity = alpha;

      // Jitter at the surface
      b.mesh.position.set(
        _potCenter.x + b.ox + Math.sin(now * 3 + b.phase * 10) * 0.008,
        _potRimY - 0.01 + lp * 0.03,
        _potCenter.z + b.oz + Math.cos(now * 2.5 + b.phase * 8) * 0.008
      );

      // Pop: grow then shrink
      const scale = lp < 0.5
        ? 0.5 + lp * 1.0
        : 1.0 - (lp - 0.5) * 1.2;
      b.mesh.scale.setScalar(Math.max(0.1, scale));
    }
  }

  // ── Fire completion callback ────────────────────────────────────────────
  function _fireComplete() {
    if (_onComplete) {
      const cb = _onComplete;
      _onComplete = null;
      cb();
    }
  }

  // ── Cleanup (removes all visuals, stops ticking) ───────────────────────
  function cleanup() {
    _wisps.forEach(w => {
      if (w.mesh && _scene) {
        _scene.remove(w.mesh);
        w.mesh.traverse(child => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        });
      }
    });
    _wisps = [];

    _bubbles.forEach(b => {
      if (b.mesh && _scene) {
        _scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mesh.material.dispose();
      }
    });
    _bubbles = [];

    _active     = false;
    _elapsed    = 0;
    _potCenter  = null;
    _onComplete = null;
  }

  function destroy() {
    cleanup();
    _scene = null;
  }

  // ── Public queries ─────────────────────────────────────────────────────
  function isActive() { return _active; }

  return { init, start, tick, isActive, cleanup, destroy };
})();

window.Step5Boil = Step5Boil;

// ── Local texture generator ───────────────────────────────────────────────
function _makeWispTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 384;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Build a soft, cloudy column
  for (let i = 0; i < 24; i++) {
    const x = canvas.width * 0.5 + (Math.random() - 0.5) * canvas.width * 0.35;
    const y = Math.random() * canvas.height;
    const r = canvas.width * (0.18 + Math.random() * 0.18);
    const blob = ctx.createRadialGradient(x, y, 0, x, y, r);
    blob.addColorStop(0, 'rgba(255,255,255,0.45)');
    blob.addColorStop(1, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = blob;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Layer a few larger soft shapes for body
  for (let i = 0; i < 8; i++) {
    const x = canvas.width * 0.5 + (Math.random() - 0.5) * canvas.width * 0.18;
    const y = Math.random() * canvas.height;
    const r = canvas.width * (0.25 + Math.random() * 0.20);
    const blob = ctx.createRadialGradient(x, y, 0, x, y, r);
    blob.addColorStop(0, 'rgba(255,255,255,0.35)');
    blob.addColorStop(1, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = blob;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Apply vertical fade mask
  ctx.globalCompositeOperation = 'destination-in';
  const mask = ctx.createLinearGradient(0, 0, 0, canvas.height);
  mask.addColorStop(0, 'rgba(255,255,255,0.0)');
  mask.addColorStop(0.12, 'rgba(255,255,255,0.35)');
  mask.addColorStop(0.6, 'rgba(255,255,255,0.6)');
  mask.addColorStop(1, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipMapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}
