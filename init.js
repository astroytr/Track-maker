// ═══════════════════════════════════════════════════
// INIT — Circuit Forge
// ═══════════════════════════════════════════════════
render();

// Auto-hide pinch hint
setTimeout(() => {
  const h = document.getElementById('pinch-hint');
  if (h) { h.style.transition = 'opacity 0.6s'; h.style.opacity = '0'; setTimeout(()=>{if(h)h.style.display='none';},600); }
}, 3000);

// Dirty-flag render loop — renders only when something changes, and at most
// once per animation frame so a burst of pinch/wheel/pointer events from
// the touchscreen doesn't trigger one full canvas redraw per event (which
// is what was making it stutter on phones).
let _renderDirty     = true;
let _renderScheduled = false;
function markDirty() {
  _renderDirty = true;
  if (!_renderScheduled) {
    _renderScheduled = true;
    requestAnimationFrame(_doRender);
  }
}
function _doRender() {
  _renderScheduled = false;
  if (_renderDirty) { _renderDirty = false; render(); }
}

// Interactive-mode flag — set to true while a finger is on the canvas
// (pinch / pan) or the wheel is spinning. render() reads this and skips
// the most expensive details (per-waypoint number labels, dashed kerb
// stripes) so we keep 60fps on mobile. After a short idle delay we drop
// back to full detail and re-render once.
window._interacting   = false;
let _interactSettleId = 0;
function beginInteract() {
  window._interacting = true;
  if (_interactSettleId) { clearTimeout(_interactSettleId); _interactSettleId = 0; }
}
function endInteract(delayMs) {
  if (_interactSettleId) clearTimeout(_interactSettleId);
  _interactSettleId = setTimeout(() => {
    _interactSettleId = 0;
    window._interacting = false;
    markDirty();
  }, delayMs == null ? 120 : delayMs);
}
window.beginInteract = beginInteract;
window.endInteract   = endInteract;
