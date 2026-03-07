'use strict';
/**
 * glow.js — Vanilla JS port of GlowingEffect (React component)
 *
 * Tracks mouse position and draws a rotating conic-gradient border
 * that follows the cursor around any element with class "glowing-card".
 *
 * Colours are matched to the Aki theme:
 *   ochre (#C8813A), ochre-light (#E8A55A), forest (#2D4A35),
 *   forest-light (#3D6148), cream (#F5ECD7)
 *
 * How it works:
 *   – CSS custom properties (--glow-start, --glow-active) drive the animation
 *   – A ::after pseudo-element renders the gradient border via CSS mask-composite
 *   – JS calculates mouse angle from each card's centre and smoothly lerps to it
 */

(function () {
  const SPREAD       = 40;   // degrees of visible arc
  const INACTIVE_R   = 0.7;  // fraction of card radius that stays inactive
  const PROXIMITY    = 0;    // extra pixels beyond card edge
  const LERP_SPEED   = 0.09; // 0–1: how quickly angle follows mouse (lower = smoother)

  /* Tracked state per card */
  const cards = [];
  let rafId   = null;
  let mouseX  = -9999;
  let mouseY  = -9999;

  /* ── Card tracker ────────────────────────────────────────────────────────── */
  function trackCard(el) {
    cards.push({ el, currentAngle: 0 });
  }

  /* ── Per-frame update ───────────────────────────────────────────────────── */
  function tick() {
    rafId = requestAnimationFrame(tick);

    for (const card of cards) {
      const { el } = card;
      const { left, top, width, height } = el.getBoundingClientRect();
      const cx = left + width  * 0.5;
      const cy = top  + height * 0.5;

      const dist = Math.hypot(mouseX - cx, mouseY - cy);
      const inactiveRadius = 0.5 * Math.min(width, height) * INACTIVE_R;

      /* Mouse inside dead-zone → deactivate */
      if (dist < inactiveRadius) {
        el.style.setProperty('--glow-active', '0');
        continue;
      }

      const isNear =
        mouseX > left - PROXIMITY &&
        mouseX < left + width  + PROXIMITY &&
        mouseY > top  - PROXIMITY &&
        mouseY < top  + height + PROXIMITY;

      el.style.setProperty('--glow-active', isNear ? '1' : '0');
      if (!isNear) continue;

      /* Target angle from card centre to mouse */
      let targetAngle = (180 * Math.atan2(mouseY - cy, mouseX - cx)) / Math.PI + 90;

      /* Shortest-path lerp on a circle */
      let diff = ((targetAngle - card.currentAngle + 180) % 360) - 180;
      card.currentAngle += diff * LERP_SPEED;

      el.style.setProperty('--glow-start', String(card.currentAngle));
    }
  }

  /* ── Global pointer listener ────────────────────────────────────────────── */
  function onPointerMove(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
  }

  /* ── Init: find all .glowing-card elements, start loop ─────────────────── */
  function init() {
    document.querySelectorAll('.glowing-card').forEach(trackCard);
    if (!cards.length) return;

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('scroll',      () => {},       { passive: true }); // keep angles current on scroll

    tick();
  }

  /* ── Re-scan when new cards are added (e.g. after nation-select renders) ── */
  function rescan() {
    const existing = new Set(cards.map(c => c.el));
    document.querySelectorAll('.glowing-card').forEach(el => {
      if (!existing.has(el)) trackCard(el);
    });
    if (cards.length && !rafId) tick();
  }

  /* Expose for use after dynamic content loads */
  window.GlowingEffect = { rescan };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
