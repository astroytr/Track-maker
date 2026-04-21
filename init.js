// ═══════════════════════════════════════════════════
// INIT — Circuit Forge
// ═══════════════════════════════════════════════════
render();

// Auto-hide pinch hint
setTimeout(() => {
  const h = document.getElementById('pinch-hint');
  if (h) { h.style.transition = 'opacity 0.6s'; h.style.opacity = '0'; setTimeout(()=>{if(h)h.style.display='none';},600); }
}, 3000);

// Dirty-flag render loop — throttled to one render per rAF frame.
// markDirty() just sets the flag; the loop does the actual render
// once per animation frame so rapid pan/pinch events don't stack up.
let _renderDirty = true;
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
// Kick off continuous loop only for hover/cursor effects (barrier hover needs it)
(function loop() {
  if (_renderDirty) { _renderDirty = false; render(); }
  requestAnimationFrame(loop);
})();
