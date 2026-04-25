// ═══════════════════════════════════════════════════
// INPUT — Circuit Forge  (pan & zoom only)
// ═══════════════════════════════════════════════════

// ── Stubs expected by other modules ─────────────────
function setTool(t) {}
function setSurface(s) {}
function setBarrierSide(s) {}
function updateBrush() {}
function updateBrushRing() {}
function paintAt() {}
function eraseAt() {}
function undoPaint() {}
function getSegmentNear() { return -1; }
function setStartingPoint() {}
function findBestStartFinishWaypoint() { return 0; }
function editBarrierSide(i) {}
function deleteBarrier(i) { barrierSegments.splice(i,1); markDirty(); }
function deleteWP(i) { waypoints.splice(i,1); markDirty(); }
function clearWaypoints() { if (!confirm('Clear all waypoints?')) return; waypoints=[]; barrierSegments=[]; markDirty(); }
function clearAll() { if (!confirm('Reset everything?')) return; waypoints=[]; paintLayers=[]; undoStack=[]; bgImage=null; barrierSegments=[]; markDirty(); }
function updateWPList() { const el=document.getElementById('stat-wp'); if(el) el.textContent=waypoints.length; }
function updateBarrierList() {}
function mobileDeleteLast() {}
function toggleSurfOverlay() {}
function closeSurfOverlay() {}
function hidePinchHint() { const h=document.getElementById('pinch-hint'); if(h) h.style.display='none'; }

function openSimplify() { const m=document.getElementById('simplify-modal'); if(m) m.classList.add('open'); }
function closeSimplify() { const m=document.getElementById('simplify-modal'); if(m) m.classList.remove('open'); }
function updateSimplifyPreview() {}
function applySimplify() { const eps=parseFloat(document.getElementById('simplify-eps').value)||2; simplifyWaypoints(eps); closeSimplify(); }
function analyseTrack() { return null; }

// ── Helpers ──────────────────────────────────────────
function getCanvasPos(clientX, clientY) {
  const r = mainCanvas.getBoundingClientRect();
  return { x: clientX - r.left, y: clientY - r.top };
}

function applyZoom(factor, sx, sy) {
  const before = screenToWorld(sx, sy);
  cam.zoom = Math.max(0.05, Math.min(20, cam.zoom * factor));
  const after = screenToWorld(sx, sy);
  cam.x += before.x - after.x;
  cam.y += before.y - after.y;
  updateZoomHUD(); markDirty();
}

function updateZoomHUD() {
  const zh = document.getElementById('zoom-hud');
  if (zh) zh.textContent = Math.round(cam.zoom * 100) + '%';
}

// ── Mouse ────────────────────────────────────────────
mainCanvas.style.cursor = 'grab';

mainCanvas.addEventListener('mousedown', e => {
  isPanning = true;
  const pos = getCanvasPos(e.clientX, e.clientY);
  panStart = { x: pos.x, y: pos.y, camX: cam.x, camY: cam.y };
  mainCanvas.style.cursor = 'grabbing';
});

mainCanvas.addEventListener('mousemove', e => {
  const pos = getCanvasPos(e.clientX, e.clientY);
  mouseWorld = screenToWorld(pos.x, pos.y);
  if (isPanning) {
    cam.x = panStart.camX - (pos.x - panStart.x) / cam.zoom;
    cam.y = panStart.camY - (pos.y - panStart.y) / cam.zoom;
    markDirty();
  }
});

mainCanvas.addEventListener('mouseup',    () => { isPanning = false; mainCanvas.style.cursor = 'grab'; });
mainCanvas.addEventListener('mouseleave', () => { isPanning = false; });

mainCanvas.addEventListener('wheel', e => {
  e.preventDefault();
  const pos = getCanvasPos(e.clientX, e.clientY);
  if (typeof beginInteract === 'function') beginInteract();
  applyZoom(e.deltaY < 0 ? 1.12 : 0.89, pos.x, pos.y);
  if (typeof endInteract === 'function') endInteract(180);
}, { passive: false });

// ── Touch (pinch-zoom + pan) ─────────────────────────
let touches = {}, pinchStartDist = 0, pinchStartZoom = 1;
let pinchMidStart = null, pinchCamStart = null;

mainCanvas.addEventListener('touchstart', e => {
  e.preventDefault(); hidePinchHint();
  if (typeof beginInteract === 'function') beginInteract();
  Array.from(e.changedTouches).forEach(t => { touches[t.identifier] = getCanvasPos(t.clientX, t.clientY); });
  const ids = Object.keys(touches);
  if (ids.length === 2) {
    isPanning = false;
    const a = touches[ids[0]], b = touches[ids[1]];
    pinchStartDist = Math.hypot(b.x - a.x, b.y - a.y);
    pinchStartZoom = cam.zoom;
    pinchMidStart  = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    pinchCamStart  = { x: cam.x, y: cam.y };
  } else if (ids.length === 1) {
    isPanning = true;
    panStart = { x: touches[ids[0]].x, y: touches[ids[0]].y, camX: cam.x, camY: cam.y };
  }
}, { passive: false });

mainCanvas.addEventListener('touchmove', e => {
  e.preventDefault();
  Array.from(e.changedTouches).forEach(t => { touches[t.identifier] = getCanvasPos(t.clientX, t.clientY); });
  const ids = Object.keys(touches);
  if (ids.length === 2) {
    const a = touches[ids[0]], b = touches[ids[1]];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const mid  = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    cam.x = pinchCamStart.x - (mid.x - pinchMidStart.x) / pinchStartZoom;
    cam.y = pinchCamStart.y - (mid.y - pinchMidStart.y) / pinchStartZoom;
    const newZoom = Math.max(0.05, Math.min(20, pinchStartZoom * (dist / pinchStartDist)));
    const before  = screenToWorld(mid.x, mid.y);
    cam.zoom = newZoom;
    const after = screenToWorld(mid.x, mid.y);
    cam.x += before.x - after.x; cam.y += before.y - after.y;
    updateZoomHUD(); markDirty();
  } else if (ids.length === 1 && isPanning) {
    const pos = touches[ids[0]];
    cam.x = panStart.camX - (pos.x - panStart.x) / cam.zoom;
    cam.y = panStart.camY - (pos.y - panStart.y) / cam.zoom;
    markDirty();
  }
}, { passive: false });

mainCanvas.addEventListener('touchend', e => {
  e.preventDefault();
  Array.from(e.changedTouches).forEach(t => delete touches[t.identifier]);
  const remaining = Object.keys(touches).length;
  if (remaining === 0) {
    isPanning = false;
    // All fingers off — settle back to high-detail render after a short pause.
    if (typeof endInteract === 'function') endInteract(140);
  }
  else if (remaining === 1) {
    const id = Object.keys(touches)[0];
    panStart = { x: touches[id].x, y: touches[id].y, camX: cam.x, camY: cam.y };
    isPanning = true;
  }
}, { passive: false });

mainCanvas.addEventListener('touchcancel', e => {
  Array.from(e.changedTouches).forEach(t => delete touches[t.identifier]);
  isPanning = false;
  if (typeof endInteract === 'function') endInteract(140);
}, { passive: false });

// ── Keyboard (zoom only) ─────────────────────────────
window.addEventListener('keydown', e => {
  if (e.code === 'Space' && !e.target.matches('input,textarea')) {
    spaceDown = true; e.preventDefault();
  }
  if ((e.key === '+' || e.key === '=') && !e.target.matches('input,textarea')) {
    applyZoom(1.12, mainCanvas.width / 2, mainCanvas.height / 2);
  }
  if (e.key === '-' && !e.target.matches('input,textarea')) {
    applyZoom(0.89, mainCanvas.width / 2, mainCanvas.height / 2);
  }
});
window.addEventListener('keyup', e => {
  if (e.code === 'Space') spaceDown = false;
});

// ── Image upload (background reference) ─────────────
function loadBgImage(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      bgImage = img;
      const W = mainCanvas.width, H = mainCanvas.height;
      const scale = Math.min((W * 0.85) / img.width, (H * 0.85) / img.height);
      const ww = img.width * scale / cam.zoom, wh = img.height * scale / cam.zoom;
      bgImageBounds = { x: -ww / 2, y: -wh / 2, w: ww, h: wh };
      cam.x = 0; cam.y = 0; markDirty(); showToast('Image loaded');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}
document.getElementById('file-input').addEventListener('change', e => loadBgImage(e.target.files[0]));
const _cw = document.getElementById('canvas-wrap');
_cw.addEventListener('dragover', e => e.preventDefault());
_cw.addEventListener('drop', e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) loadBgImage(file);
});
