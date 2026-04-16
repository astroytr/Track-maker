// ═══════════════════════════════════════════════════
// TOOL & SURFACE MANAGEMENT
// ═══════════════════════════════════════════════════
function getSegmentNear(wx, wy) {
  if (waypoints.length < 2) return -1;
  let best = -1, bestD = Infinity;
  const n = waypoints.length;
  for (let i = 0; i < n; i++) {
    const w = waypoints[i];
    const dx = w.x - wx, dy = w.y - wy;
    const d = dx*dx + dy*dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function setStartingPoint() {
  if (waypoints.length === 0) { showToast('No waypoints yet!'); return; }
  startingPointIdx = selectedWP >= 0 ? selectedWP : 0;
  updateWPList(); render();
  showToast(`Starting point set to WP ${startingPointIdx}`);
}

function setTool(t) {
  if (tool === 'barrier' && t !== 'barrier') barrierSelStart = -1;
  tool = t;
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  const tb = document.getElementById('tool-' + t);
  if (tb) tb.classList.add('active');
  document.querySelectorAll('.mb-btn').forEach(b => b.classList.remove('active'));
  const mb = document.getElementById('mb-' + t);
  if (mb) mb.classList.add('active');

  const hudMap = {
    waypoint: 'Waypoint — click to place',
    paint:    'Paint — drag to paint surface',
    erase:    'Erase — drag to erase',
    pan:      'Pan — drag to move · scroll/pinch zoom',
    barrier:  'Barrier — tap start waypoint'
  };
  document.getElementById('tool-hud').textContent = hudMap[t] || t;

  const showBrush   = t === 'paint' || t === 'erase';
  const showSurface = t === 'paint' || t === 'barrier';
  const sSection = document.getElementById('surface-section');
  const bSection = document.getElementById('brush-section');
  if (sSection) sSection.style.display = showSurface ? '' : 'none';
  if (bSection) bSection.style.display = showBrush   ? '' : 'none';

  mainCanvas.style.cursor = t === 'pan' ? 'grab' : (showBrush ? 'none' : 'crosshair');
  const ring = document.getElementById('brush-ring');
  if (ring) ring.style.display = showBrush ? '' : 'none';
}

function setSurface(s) {
  surface = s;
  document.querySelectorAll('.surf-btn').forEach(b => b.classList.remove('active'));
  const sb = document.getElementById('surf-' + s.replaceAll('_', '-'));
  if (sb) sb.classList.add('active');
  document.querySelectorAll('.so-btn').forEach(b => b.classList.remove('active'));
  const so = document.getElementById('so-' + s);
  if (so) so.classList.add('active');
  const dotMap = { flat_kerb:'🟥', sausage:'🟨', rumble:'🟧', gravel:'🟫', grass:'🟩', armco:'⬜', tecpro:'🟦', tyrewall:'⬛' };
  const mbDot = document.getElementById('mb-surf-dot');
  if (mbDot) mbDot.textContent = dotMap[s] || '🔲';
}

function updateBrush() {
  brushSize = parseInt(document.getElementById('brush-size').value);
  document.getElementById('brush-display').textContent = brushSize;
  updateBrushRing();
}

function updateBrushRing(sx, sy) {
  const ring = document.getElementById('brush-ring');
  if (!ring) return;
  const r = brushSize * cam.zoom;
  ring.style.width  = r * 2 + 'px';
  ring.style.height = r * 2 + 'px';
  if (sx !== undefined) { ring.style.left = sx + 'px'; ring.style.top = sy + 'px'; }
}

// ═══════════════════════════════════════════════════
// PAINT / ERASE
// ═══════════════════════════════════════════════════
function paintAt(wx, wy) {
  paintLayers.push({ surface, x: wx, y: wy, r: brushSize });
  const el = document.getElementById('stat-paint');
  if (el) el.textContent = paintLayers.length;
}

function eraseAt(wx, wy) {
  const r2 = (brushSize * 1.5) ** 2;
  paintLayers = paintLayers.filter(p => {
    const dx = p.x - wx, dy = p.y - wy;
    return (dx * dx + dy * dy) > r2;
  });
  const el = document.getElementById('stat-paint');
  if (el) el.textContent = paintLayers.length;
}

function undoPaint() {
  if (undoStack.length === 0) { showToast('Nothing to undo'); return; }
  paintLayers = paintLayers.slice(0, undoStack.pop());
  const el = document.getElementById('stat-paint');
  if (el) el.textContent = paintLayers.length;
  render(); showToast('Undone');
}

// ═══════════════════════════════════════════════════
// INPUT HELPERS
// ═══════════════════════════════════════════════════
function getCanvasPos(clientX, clientY) {
  const r = mainCanvas.getBoundingClientRect();
  return { x: clientX - r.left, y: clientY - r.top };
}

mainCanvas.addEventListener('mousedown', e => handleDown(getCanvasPos(e.clientX, e.clientY), false));
mainCanvas.addEventListener('mousemove', e => {
  const pos = getCanvasPos(e.clientX, e.clientY);
  mouseWorld = screenToWorld(pos.x, pos.y);
  const ch = document.getElementById('coords-hud');
  if (ch) ch.textContent = `x: ${Math.round(mouseWorld.x)}  y: ${Math.round(mouseWorld.y)}`;
  updateBrushRing(pos.x, pos.y);
  handleMove(pos);
  if (tool === 'barrier' && barrierSelStart >= 0) render();
});
mainCanvas.addEventListener('mouseup',    e => handleUp(getCanvasPos(e.clientX, e.clientY)));
mainCanvas.addEventListener('mouseleave', () => handleUp(null));
mainCanvas.addEventListener('wheel', e => {
  e.preventDefault();
  applyZoom(e.deltaY < 0 ? 1.12 : 0.89, getCanvasPos(e.clientX, e.clientY).x, getCanvasPos(e.clientX, e.clientY).y);
}, { passive: false });

let touches = {}, pinchStartDist = 0, pinchStartZoom = 1;
let pinchMidStart = null, pinchCamStart = null;
let touchMoved = false, touchDownPos = null, touchDownTime = 0;

mainCanvas.addEventListener('touchstart', e => {
  e.preventDefault(); hidePinchHint();
  Array.from(e.changedTouches).forEach(t => { touches[t.identifier] = getCanvasPos(t.clientX, t.clientY); });
  const ids = Object.keys(touches);
  if (ids.length === 2) {
    isPainting = false; isPanning = false;
    const a = touches[ids[0]], b = touches[ids[1]];
    pinchStartDist = Math.hypot(b.x-a.x, b.y-a.y);
    pinchStartZoom = cam.zoom;
    pinchMidStart  = { x: (a.x+b.x)/2, y: (a.y+b.y)/2 };
    pinchCamStart  = { x: cam.x, y: cam.y };
  } else if (ids.length === 1) {
    touchMoved = false;
    touchDownPos  = { ...touches[ids[0]] };
    touchDownTime = Date.now();
    handleDown(touches[ids[0]], true);
  }
}, { passive: false });

mainCanvas.addEventListener('touchmove', e => {
  e.preventDefault();
  Array.from(e.changedTouches).forEach(t => { touches[t.identifier] = getCanvasPos(t.clientX, t.clientY); });
  const ids = Object.keys(touches);
  if (ids.length === 2) {
    const a = touches[ids[0]], b = touches[ids[1]];
    const dist = Math.hypot(b.x-a.x, b.y-a.y);
    const mid  = { x: (a.x+b.x)/2, y: (a.y+b.y)/2 };
    cam.x = pinchCamStart.x - (mid.x - pinchMidStart.x) / pinchStartZoom;
    cam.y = pinchCamStart.y - (mid.y - pinchMidStart.y) / pinchStartZoom;
    const newZoom = Math.max(0.05, Math.min(20, pinchStartZoom * (dist / pinchStartDist)));
    const before  = screenToWorld(mid.x, mid.y);
    cam.zoom = newZoom;
    const after   = screenToWorld(mid.x, mid.y);
    cam.x += before.x - after.x; cam.y += before.y - after.y;
    updateZoomHUD(); render();
  } else if (ids.length === 1) {
    const pos = touches[ids[0]];
    if (touchDownPos && Math.hypot(pos.x-touchDownPos.x, pos.y-touchDownPos.y) > 8) touchMoved = true;
    handleMove(pos);
  }
}, { passive: false });

mainCanvas.addEventListener('touchend', e => {
  e.preventDefault();
  Array.from(e.changedTouches).forEach(t => delete touches[t.identifier]);
  const remaining = Object.keys(touches).length;
  if (remaining === 0) {
    if (tool === 'waypoint' && (Date.now()-touchDownTime) < 400 && !touchMoved && touchDownPos) {
      const world = screenToWorld(touchDownPos.x, touchDownPos.y);
      waypoints.push({ x: world.x, y: world.y });
      updateWPList(); render();
    }
    handleUp(touchDownPos); touchDownPos = null;
  } else if (remaining === 1) {
    const id = Object.keys(touches)[0];
    panStart = { x: touches[id].x, y: touches[id].y, camX: cam.x, camY: cam.y };
    isPanning = (tool === 'pan');
  }
}, { passive: false });

mainCanvas.addEventListener('touchcancel', e => {
  Array.from(e.changedTouches).forEach(t => delete touches[t.identifier]);
  handleUp(null);
}, { passive: false });

function handleDown(pos, isTouch) {
  const world = screenToWorld(pos.x, pos.y);
  if (spaceDown || tool === 'pan') {
    isPanning = true;
    panStart = { x: pos.x, y: pos.y, camX: cam.x, camY: cam.y };
    mainCanvas.style.cursor = 'grabbing'; return;
  }
  if (tool === 'waypoint' && !isTouch) {
    waypoints.push({ x: world.x, y: world.y });
    updateWPList(); render();
  } else if (tool === 'paint') {
    isPainting = true; undoStack.push(paintLayers.length);
    paintAt(world.x, world.y); render();
  } else if (tool === 'erase') {
    isPainting = true; undoStack.push(paintLayers.length);
    eraseAt(world.x, world.y); render();
  } else if (tool === 'barrier') {
    const seg = getSegmentNear(world.x, world.y);
    if (seg >= 0) {
      if (barrierSelStart < 0) {
        barrierSelStart = seg;
        document.getElementById('tool-hud').textContent = `Barrier — start at WP ${seg} · now tap end point`;
        showToast(`Start: WP ${seg} — now tap end`); render();
      } else {
        if (seg !== barrierSelStart) {
          barrierSegments.push({ from: Math.min(barrierSelStart, seg), to: Math.max(barrierSelStart, seg), surface, side: 'both', lane: 0 });
          showToast(`✓ ${SURFACES[surface].label} barrier added`);
          updateBarrierList();
        }
        barrierSelStart = -1;
        document.getElementById('tool-hud').textContent = 'Barrier — tap start waypoint'; render();
      }
    }
  }
}

function handleMove(pos) {
  if (isPanning) {
    cam.x = panStart.camX - (pos.x - panStart.x) / cam.zoom;
    cam.y = panStart.camY - (pos.y - panStart.y) / cam.zoom;
    render(); return;
  }
  if (isPainting) {
    const world = screenToWorld(pos.x, pos.y);
    if (tool === 'paint')      { paintAt(world.x, world.y); render(); }
    else if (tool === 'erase') { eraseAt(world.x, world.y); render(); }
  }
}

function handleUp() {
  isPanning = false; isPainting = false;
  mainCanvas.style.cursor = tool === 'pan' ? 'grab' : (tool === 'paint' || tool === 'erase') ? 'none' : 'crosshair';
}

function applyZoom(factor, sx, sy) {
  const before = screenToWorld(sx, sy);
  cam.zoom = Math.max(0.05, Math.min(20, cam.zoom * factor));
  const after = screenToWorld(sx, sy);
  cam.x += before.x - after.x; cam.y += before.y - after.y;
  updateZoomHUD(); render();
}

function updateZoomHUD() {
  const pct = Math.round(cam.zoom * 100) + '%';
  const zh = document.getElementById('zoom-hud'); if (zh) zh.textContent = pct;
  const sz = document.getElementById('stat-zoom'); if (sz) sz.textContent = pct;
}

window.addEventListener('keydown', e => {
  if (e.code === 'Space' && !e.target.matches('input,textarea')) {
    spaceDown = true; mainCanvas.style.cursor = 'grab'; e.preventDefault();
  }
  if (e.key === 'w' || e.key === 'W') setTool('waypoint');
  if (e.key === 'p' || e.key === 'P') setTool('paint');
  if (e.key === 'e' || e.key === 'E') setTool('erase');
  if ((e.key === 'Delete' || e.key === 'Backspace') && !e.target.matches('input,textarea')) {
    if (waypoints.length > 0 && tool === 'waypoint') { waypoints.pop(); updateWPList(); render(); }
  }
  if (e.ctrlKey && e.key === 'z') { undoPaint(); e.preventDefault(); }
});
window.addEventListener('keyup', e => {
  if (e.code === 'Space') {
    spaceDown = false;
    mainCanvas.style.cursor = (tool === 'paint' || tool === 'erase') ? 'none' : 'crosshair';
  }
});

// ── MOBILE HELPERS ──
function mobileDeleteLast() {
  if (waypoints.length > 0) { waypoints.pop(); updateWPList(); render(); showToast('Deleted last WP'); }
}
let surfOverlayOpen = false;
function toggleSurfOverlay() { surfOverlayOpen = !surfOverlayOpen; document.getElementById('surf-overlay').classList.toggle('open', surfOverlayOpen); }
function closeSurfOverlay() { surfOverlayOpen = false; document.getElementById('surf-overlay').classList.remove('open'); }
function hidePinchHint() { const h = document.getElementById('pinch-hint'); if (h) h.style.display = 'none'; }

// ═══════════════════════════════════════════════════
// IMAGE UPLOAD (background reference)
// ═══════════════════════════════════════════════════
function loadBgImage(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      bgImage = img;
      const W = mainCanvas.width, H = mainCanvas.height;
      const scale = Math.min((W * 0.85) / img.width, (H * 0.85) / img.height);
      const ww = img.width  * scale / cam.zoom;
      const wh = img.height * scale / cam.zoom;
      bgImageBounds = { x: -ww/2, y: -wh/2, w: ww, h: wh };
      cam.x = 0; cam.y = 0; render(); showToast('Image loaded');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}
document.getElementById('file-input').addEventListener('change', e => loadBgImage(e.target.files[0]));
const cw = document.getElementById('canvas-wrap');
cw.addEventListener('dragover', e => e.preventDefault());
cw.addEventListener('drop', e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) loadBgImage(file);
});

// ═══════════════════════════════════════════════════
// WAYPOINT LIST
// ═══════════════════════════════════════════════════
function updateWPList() {
  const list = document.getElementById('wp-list');
  const statWP = document.getElementById('stat-wp');
  if (statWP) statWP.textContent = waypoints.length;
  if (!list) return;
  list.innerHTML = '';
  waypoints.forEach((wp, i) => {
    const isStart = i === startingPointIdx;
    const div = document.createElement('div');
    div.className = 'wp-item' + (i === selectedWP ? ' selected' : '');
    div.innerHTML = `<span class="wp-num" style="${isStart ? 'color:#00ff88' : ''}">${isStart ? '🏁' : i}</span>
      <span class="wp-coords">${Math.round(wp.x)}, ${Math.round(wp.y)}</span>
      <span class="wp-del" onclick="event.stopPropagation();deleteWP(${i})">✕</span>`;
    div.addEventListener('click', () => { selectedWP = i; updateWPList(); render(); });
    list.appendChild(div);
  });
}

function updateBarrierList() {
  const section = document.getElementById('barrier-list-section');
  const list    = document.getElementById('barrier-list');
  const countEl = document.getElementById('barrier-count');
  if (!section || !list) return;
  if (barrierSegments.length === 0) { section.style.display = 'none'; return; }
  section.style.display = '';
  if (countEl) countEl.textContent = barrierSegments.length;
  list.innerHTML = '';
  barrierSegments.forEach((b, i) => {
    const cfg = SURFACES[b.surface];
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.05);';
    div.innerHTML = `<div style="width:10px;height:10px;border-radius:2px;flex-shrink:0;background:${cfg.dot};"></div>
      <span style="font-family:'Barlow Condensed',sans-serif;font-size:11px;color:var(--text2);flex:1;">${cfg.label} ${b.side === 'both' || !b.side ? 'both sides' : b.side > 0 ? 'inside/right' : 'inside/left'} WP${b.from}→${b.to}</span>
      <span onclick="deleteBarrier(${i})" style="font-size:10px;color:var(--text3);cursor:pointer;padding:2px 5px;border-radius:2px;"
        onmouseover="this.style.color='#ff4747'" onmouseout="this.style.color='var(--text3)'">✕</span>`;
    list.appendChild(div);
  });
}

function deleteBarrier(i) { barrierSegments.splice(i, 1); updateBarrierList(); render(); showToast('Barrier removed'); }

function deleteWP(i) {
  waypoints.splice(i, 1);
  if (selectedWP >= waypoints.length) selectedWP = -1;
  if (startingPointIdx >= waypoints.length) startingPointIdx = 0;
  updateWPList(); render();
}

function clearWaypoints() {
  if (!confirm('Clear all waypoints?')) return;
  waypoints = []; selectedWP = -1; startingPointIdx = 0; barrierSegments = []; barrierSelStart = -1;
  updateWPList(); updateBarrierList(); render();
}

function clearAll() {
  if (!confirm('Reset everything? This cannot be undone.')) return;
  waypoints = []; paintLayers = []; undoStack = []; selectedWP = -1; bgImage = null;
  barrierSegments = []; barrierSelStart = -1; startingPointIdx = 0;
  updateWPList(); updateBarrierList(); render();
}
