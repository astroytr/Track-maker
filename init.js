// ═══════════════════════════════════════════════════
// INIT — Circuit Forge v7.0
// ═══════════════════════════════════════════════════
setTool('waypoint');
setSurface('flat_kerb');
setBarrierSide('both');
updateBrush();
render();

// Show simplify eps value on load
const epsEl = document.getElementById('simplify-eps');
if (epsEl) {
  document.getElementById('simplify-eps-val').textContent = parseFloat(epsEl.value).toFixed(1);
}

// Auto-hide pinch hint
setTimeout(() => {
  const h = document.getElementById('pinch-hint');
  if (h) { h.style.transition = 'opacity 0.6s'; h.style.opacity = '0'; setTimeout(()=>{if(h)h.style.display='none';},600); }
}, 3000);

// Render loop
(function loop() { render(); requestAnimationFrame(loop); })();
