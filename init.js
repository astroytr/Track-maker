// ═══════════════════════════════════════════════════
// INIT — Circuit Forge
// ═══════════════════════════════════════════════════
render();

// Auto-hide pinch hint
setTimeout(() => {
  const h = document.getElementById('pinch-hint');
  if (h) { h.style.transition = 'opacity 0.6s'; h.style.opacity = '0'; setTimeout(()=>{if(h)h.style.display='none';},600); }
}, 3000);

// Dirty-flag render loop — renders only when something changes
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
