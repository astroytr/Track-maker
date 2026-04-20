// ═══════════════════════════════════════════════════
// INIT — Circuit Forge
// ═══════════════════════════════════════════════════
render();

// Auto-hide pinch hint
setTimeout(() => {
  const h = document.getElementById('pinch-hint');
  if (h) { h.style.transition = 'opacity 0.6s'; h.style.opacity = '0'; setTimeout(()=>{if(h)h.style.display='none';},600); }
}, 3000);

// Dirty-flag render loop — only redraws when something changed
let _renderDirty = true;
function markDirty() { _renderDirty = true; }
(function loop() {
  if (_renderDirty) { _renderDirty = false; render(); }
  requestAnimationFrame(loop);
})();
