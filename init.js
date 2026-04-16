// ═══════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════
setTool('waypoint');
setSurface('flat_kerb');
updateBrush();
render();

setTimeout(() => {
  const h = document.getElementById('pinch-hint');
  if (h) { h.style.transition = 'opacity 0.6s'; h.style.opacity = '0'; setTimeout(() => { if (h) h.style.display = 'none'; }, 600); }
}, 3000);

(function loop() { render(); requestAnimationFrame(loop); })();
