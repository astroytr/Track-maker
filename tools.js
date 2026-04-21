// ═══════════════════════════════════════════════════
// TOOL & SURFACE MANAGEMENT — Circuit Forge v7.1
// ═══════════════════════════════════════════════════
function getSegmentNear(wx, wy) {
  if (waypoints.length < 2) return -1;
  let best=-1, bestD=Infinity;
  waypoints.forEach((w,i) => {
    const dx=w.x-wx, dy=w.y-wy, d=dx*dx+dy*dy;
    if (d<bestD){bestD=d;best=i;}
  });
  return best;
}

function setStartingPoint() {
  if (waypoints.length===0){showToast('No waypoints yet!');return;}
  startingPointIdx = selectedWP>=0 ? selectedWP : findBestStartFinishWaypoint();
  updateWPList(); markDirty();
  showToast(`Start set to WP ${startingPointIdx}`);
}

function findBestStartFinishWaypoint() {
  if (waypoints.length < 3) return 0;
  let best = 0, bestScore = -Infinity;
  const n = waypoints.length;
  for (let i=0; i<n; i++) {
    const prev=waypoints[(i-1+n)%n], cur=waypoints[i], next=waypoints[(i+1)%n];
    const ax=cur.x-prev.x, ay=cur.y-prev.y, bx=next.x-cur.x, by=next.y-cur.y;
    const la=Math.hypot(ax,ay), lb=Math.hypot(bx,by);
    if (la < 1e-6 || lb < 1e-6) continue;
    const straightness = (ax*bx+ay*by)/(la*lb);
    const lengthScore = Math.min(90, la + lb);
    const lowerScreenBias = cur.y * 0.01;
    const score = straightness * 140 + lengthScore + lowerScreenBias;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

function setTool(t) {
  if (tool==='barrier'&&t!=='barrier') barrierSelStart=-1;
  tool=t;
  mainCanvas.style.cursor = t==='pan'?'grab':(t==='paint'||t==='erase'?'none':'crosshair');
}

function setSurface(s) {
  surface=s;
  document.querySelectorAll('.so-btn').forEach(b=>b.classList.remove('active'));
  const so=document.getElementById('so-'+s);
  if (so) so.classList.add('active');
}

function setBarrierSide(s) {
  barrierSide = s;
  document.querySelectorAll('.bside-btn').forEach(b=>b.classList.remove('active'));
  const btn=document.getElementById('bside-'+s);
  if (btn) btn.classList.add('active');
}

function updateBrush() {
  brushSize=parseInt(document.getElementById('brush-size').value);
}

function updateBrushRing(sx, sy) {}

// ═══════════════════════════════════════════════════
// PAINT / ERASE
// ═══════════════════════════════════════════════════
function paintAt(wx, wy) {
  const rank = SURFACE_LANES[surface] ? SURFACE_LANES[surface].inner : 99;
  paintLayers.push({ surface, x:wx, y:wy, r:brushSize, rank });
  const el=document.getElementById('stat-paint');
  if (el) el.textContent=paintLayers.length;
}

function eraseAt(wx, wy) {
  const r2=(brushSize*1.5)**2;
  paintLayers=paintLayers.filter(p=>{
    const dx=p.x-wx, dy=p.y-wy;
    return (dx*dx+dy*dy)>r2;
  });
  const el=document.getElementById('stat-paint');
  if (el) el.textContent=paintLayers.length;
}

function undoPaint() {
  if (undoStack.length===0){showToast('Nothing to undo');return;}
  paintLayers=paintLayers.slice(0,undoStack.pop());
  const el=document.getElementById('stat-paint');
  if (el) el.textContent=paintLayers.length;
  markDirty(); showToast('Undone');
}

// ═══════════════════════════════════════════════════
// INPUT HELPERS
// ═══════════════════════════════════════════════════
function getCanvasPos(clientX, clientY) {
  const r=mainCanvas.getBoundingClientRect();
  return {x:clientX-r.left,y:clientY-r.top};
}

mainCanvas.addEventListener('mousedown', e=>handleDown(getCanvasPos(e.clientX,e.clientY),false));
mainCanvas.addEventListener('mousemove', e=>{
  const pos=getCanvasPos(e.clientX,e.clientY);
  mouseWorld=screenToWorld(pos.x,pos.y);
  handleMove(pos);
  if (tool==='barrier'&&barrierSelStart>=0) markDirty();
});
mainCanvas.addEventListener('mouseup',    e=>handleUp(getCanvasPos(e.clientX,e.clientY)));
mainCanvas.addEventListener('mouseleave', ()=>handleUp(null));
mainCanvas.addEventListener('wheel', e=>{
  e.preventDefault();
  applyZoom(e.deltaY<0?1.12:0.89,getCanvasPos(e.clientX,e.clientY).x,getCanvasPos(e.clientX,e.clientY).y);
},{passive:false});

let touches={}, pinchStartDist=0, pinchStartZoom=1;
let pinchMidStart=null, pinchCamStart=null;
let touchMoved=false, touchDownPos=null, touchDownTime=0;

mainCanvas.addEventListener('touchstart', e=>{
  e.preventDefault(); hidePinchHint();
  Array.from(e.changedTouches).forEach(t=>{touches[t.identifier]=getCanvasPos(t.clientX,t.clientY);});
  const ids=Object.keys(touches);
  if (ids.length===2) {
    isPainting=false; isPanning=false;
    const a=touches[ids[0]],b=touches[ids[1]];
    pinchStartDist=Math.hypot(b.x-a.x,b.y-a.y);
    pinchStartZoom=cam.zoom;
    pinchMidStart={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    pinchCamStart={x:cam.x,y:cam.y};
  } else if (ids.length===1) {
    touchMoved=false;
    touchDownPos={...touches[ids[0]]};
    touchDownTime=Date.now();
    handleDown(touches[ids[0]],true);
  }
},{passive:false});

mainCanvas.addEventListener('touchmove', e=>{
  e.preventDefault();
  Array.from(e.changedTouches).forEach(t=>{touches[t.identifier]=getCanvasPos(t.clientX,t.clientY);});
  const ids=Object.keys(touches);
  if (ids.length===2) {
    const a=touches[ids[0]],b=touches[ids[1]];
    const dist=Math.hypot(b.x-a.x,b.y-a.y);
    const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    cam.x=pinchCamStart.x-(mid.x-pinchMidStart.x)/pinchStartZoom;
    cam.y=pinchCamStart.y-(mid.y-pinchMidStart.y)/pinchStartZoom;
    const newZoom=Math.max(0.05,Math.min(20,pinchStartZoom*(dist/pinchStartDist)));
    const before=screenToWorld(mid.x,mid.y);
    cam.zoom=newZoom;
    const after=screenToWorld(mid.x,mid.y);
    cam.x+=before.x-after.x; cam.y+=before.y-after.y;
    updateZoomHUD(); markDirty();
  } else if (ids.length===1) {
    const pos=touches[ids[0]];
    if (touchDownPos&&Math.hypot(pos.x-touchDownPos.x,pos.y-touchDownPos.y)>8) touchMoved=true;
    handleMove(pos);
  }
},{passive:false});

mainCanvas.addEventListener('touchend', e=>{
  e.preventDefault();
  Array.from(e.changedTouches).forEach(t=>delete touches[t.identifier]);
  const remaining=Object.keys(touches).length;
  if (remaining===0) {
    if (tool==='waypoint'&&(Date.now()-touchDownTime)<400&&!touchMoved&&touchDownPos){
      const world=screenToWorld(touchDownPos.x,touchDownPos.y);
      waypoints.push({x:world.x,y:world.y});
      updateWPList(); markDirty();
    }
    handleUp(touchDownPos); touchDownPos=null;
  } else if (remaining===1) {
    const id=Object.keys(touches)[0];
    panStart={x:touches[id].x,y:touches[id].y,camX:cam.x,camY:cam.y};
    isPanning=(tool==='pan');
  }
},{passive:false});

mainCanvas.addEventListener('touchcancel', e=>{
  Array.from(e.changedTouches).forEach(t=>delete touches[t.identifier]);
  handleUp(null);
},{passive:false});

function handleDown(pos, isTouch) {
  const world=screenToWorld(pos.x,pos.y);
  if (spaceDown||tool==='pan') {
    isPanning=true;
    panStart={x:pos.x,y:pos.y,camX:cam.x,camY:cam.y};
    mainCanvas.style.cursor='grabbing'; return;
  }
  if (tool==='waypoint'&&!isTouch) {
    waypoints.push({x:world.x,y:world.y});
    updateWPList(); markDirty();
  } else if (tool==='paint') {
    isPainting=true; undoStack.push(paintLayers.length);
    paintAt(world.x,world.y); markDirty();
  } else if (tool==='erase') {
    isPainting=true; undoStack.push(paintLayers.length);
    eraseAt(world.x,world.y); markDirty();
  } else if (tool==='barrier') {
    const seg=getSegmentNear(world.x,world.y);
    if (seg>=0) {
      if (barrierSelStart<0) {
        barrierSelStart=seg;
        showToast(`Start: WP ${seg} — click the end waypoint`); markDirty();
      } else {
        if (seg!==barrierSelStart) {
          barrierSegments.push({
            from: Math.min(barrierSelStart,seg),
            to:   Math.max(barrierSelStart,seg),
            surface,
            side: barrierSide,
            lane: 0
          });
          showToast(`✓ ${SURFACES[surface].label} added (${barrierSide})`);
          updateBarrierList();
        }
        barrierSelStart=-1;
        markDirty();
      }
    }
  }
}

function handleMove(pos) {
  if (isPanning) {
    cam.x=panStart.camX-(pos.x-panStart.x)/cam.zoom;
    cam.y=panStart.camY-(pos.y-panStart.y)/cam.zoom;
    markDirty(); return;
  }
  if (isPainting) {
    const world=screenToWorld(pos.x,pos.y);
    if (tool==='paint')      {paintAt(world.x,world.y); markDirty();}
    else if (tool==='erase') {eraseAt(world.x,world.y); markDirty();}
  }
}

function handleUp() {
  isPanning=false; isPainting=false;
  mainCanvas.style.cursor=tool==='pan'?'grab':(tool==='paint'||tool==='erase')?'none':'crosshair';
}

function applyZoom(factor, sx, sy) {
  const before=screenToWorld(sx,sy);
  cam.zoom=Math.max(0.05,Math.min(20,cam.zoom*factor));
  const after=screenToWorld(sx,sy);
  cam.x+=before.x-after.x; cam.y+=before.y-after.y;
  updateZoomHUD(); markDirty();
}

function updateZoomHUD() {
  const zh=document.getElementById('zoom-hud'); if (zh) zh.textContent=Math.round(cam.zoom*100)+'%';
}

window.addEventListener('keydown', e=>{
  if (e.code==='Space'&&!e.target.matches('input,textarea')) {
    spaceDown=true; mainCanvas.style.cursor='grab'; e.preventDefault();
  }
  if (e.key==='w'||e.key==='W') setTool('waypoint');
  if (e.key==='p'||e.key==='P') setTool('paint');
  if (e.key==='e'||e.key==='E') setTool('erase');
  if (e.key==='b'||e.key==='B') setTool('barrier');
  if ((e.key==='Delete'||e.key==='Backspace')&&!e.target.matches('input,textarea')) {
    if (waypoints.length>0&&tool==='waypoint'){waypoints.pop();updateWPList();markDirty();}
  }
  if (e.ctrlKey&&e.key==='z'){undoPaint();e.preventDefault();}
});
window.addEventListener('keyup', e=>{
  if (e.code==='Space') {
    spaceDown=false;
    mainCanvas.style.cursor=(tool==='paint'||tool==='erase')?'none':'crosshair';
  }
});

// ── MOBILE HELPERS ──────────────────────────────────
function mobileDeleteLast() {
  if (waypoints.length>0){waypoints.pop();updateWPList();markDirty();showToast('Deleted last WP');}
}
let surfOverlayOpen=false;
function toggleSurfOverlay(){surfOverlayOpen=!surfOverlayOpen;document.getElementById('surf-overlay').classList.toggle('open',surfOverlayOpen);}
function closeSurfOverlay(){surfOverlayOpen=false;document.getElementById('surf-overlay').classList.remove('open');}
function hidePinchHint(){const h=document.getElementById('pinch-hint');if(h)h.style.display='none';}

// ═══════════════════════════════════════════════════
// IMAGE UPLOAD (background reference)
// ═══════════════════════════════════════════════════
function loadBgImage(file) {
  if (!file||!file.type.startsWith('image/')) return;
  const reader=new FileReader();
  reader.onload=ev=>{
    const img=new Image();
    img.onload=()=>{
      bgImage=img;
      const W=mainCanvas.width,H=mainCanvas.height;
      const scale=Math.min((W*0.85)/img.width,(H*0.85)/img.height);
      const ww=img.width*scale/cam.zoom, wh=img.height*scale/cam.zoom;
      bgImageBounds={x:-ww/2,y:-wh/2,w:ww,h:wh};
      cam.x=0; cam.y=0; markDirty(); showToast('Image loaded');
    };
    img.src=ev.target.result;
  };
  reader.readAsDataURL(file);
}
document.getElementById('file-input').addEventListener('change',e=>loadBgImage(e.target.files[0]));
const _cw=document.getElementById('canvas-wrap');
_cw.addEventListener('dragover',e=>e.preventDefault());
_cw.addEventListener('drop',e=>{
  e.preventDefault();
  const file=e.dataTransfer.files[0];
  if (file&&file.type.startsWith('image/')) loadBgImage(file);
});

// ═══════════════════════════════════════════════════
// DRIVABILITY ANALYSIS
// Derived from physics.js constants:
//   WHEELBASE = 3.8m,  maxSteer = 0.26 rad  (S.ss=5)
//   min turning radius = WHEELBASE/tan(0.26) = 14.3m
//   Track width TW = 14 units  ≈ 13m real  → scale 0.9286 m/unit
//   Min radius in units: 14.3/0.9286 ≈ 16 units  (hard limit — car can't turn tighter)
//   Tight radius: 127m / 0.9286 ≈ 137 units  (needs braking below 130 km/h)
//   Comfortable racing radius: 191m / 0.9286 ≈ 206 units  (can hold 140+ km/h)
//   Oval hairpin radius = HW=60 units → 55.7m → ~107 km/h cornering speed
// ═══════════════════════════════════════════════════
const _DRIVE = {
  SCALE:       0.9286,  // units → metres  (TW=14 units ≈ 13m real)
  // Hard limit: car physically cannot make this turn at any speed
  R_HARD:      16,      // units — below this = undriveable (tighter than min steering radius)
  // Tight: requires braking below 130 km/h
  R_TIGHT:     137,     // units — below this = tight corner
  // Comfortable: can carry 140+ km/h
  R_COMFY:     206,     // units — above this = fine
  TW:          14,      // track width in units (from tracks.js)
};

function _cornerRadius(prev, cur, next) {
  // Circumradius of the triangle formed by three consecutive waypoints
  // R = (a·b·c) / (4·Area)  — exact for any triangle
  const ax=cur.x-prev.x, ay=cur.y-prev.y;   // side a (prev→cur)
  const bx=next.x-cur.x, by=next.y-cur.y;   // side b (cur→next)
  const cx=prev.x-next.x, cy=prev.y-next.y; // side c (next→prev)
  const la=Math.hypot(ax,ay), lb=Math.hypot(bx,by), lc=Math.hypot(cx,cy);
  const area=Math.abs(ax*by - ay*bx)*0.5;    // half cross-product
  if (area < 1e-6) return Infinity;           // straight line
  return (la * lb * lc) / (4 * area);
}

function analyseTrack() {
  const n = waypoints.length;
  if (n < 3) return null;

  let minR = Infinity, minRIdx = -1;
  let undriveable = 0, tight = 0;
  const issues = [];

  for (let i = 0; i < n; i++) {
    const prev = waypoints[(i-1+n)%n];
    const cur  = waypoints[i];
    const next = waypoints[(i+1)%n];
    const R    = _cornerRadius(prev, cur, next);

    if (R < minR) { minR = R; minRIdx = i; }

    if (R < _DRIVE.R_HARD) {
      undriveable++;
      issues.push({ idx: i, R, level: 'hard' });
    } else if (R < _DRIVE.R_TIGHT) {
      tight++;
      issues.push({ idx: i, R, level: 'tight' });
    }
  }

  // Oval reference: hairpin R=60 units → 17.1m, right at the hard limit
  // Speed estimate at tightest corner: v = sqrt(R_metres * 9.81 * 1.05)
  const minRm = minR * _DRIVE.SCALE;
  const speedAtMin = Math.sqrt(Math.max(0, minRm * 9.81 * 1.05)) * 3.6; // km/h

  return { minR, minRIdx, minRm, speedAtMin, undriveable, tight, issues };
}

// ═══════════════════════════════════════════════════
// WAYPOINT LIST
// ═══════════════════════════════════════════════════
function updateWPList() {
  const statWP=document.getElementById('stat-wp');
  if (statWP) statWP.textContent=waypoints.length;
}

function updateBarrierList() {}

function editBarrierSide(i) {
  const b=barrierSegments[i];
  if (!b) return;
  const choices=['both','left','right'];
  const cur=choices.indexOf(b.side)||0;
  b.side=choices[(cur+1)%3]||'both';
  updateBarrierList(); markDirty();
  showToast('Side: '+b.side);
}

function deleteBarrier(i){barrierSegments.splice(i,1);updateBarrierList();markDirty();showToast('Barrier removed');}

function deleteWP(i) {
  waypoints.splice(i,1);
  if (selectedWP>=waypoints.length) selectedWP=-1;
  if (startingPointIdx>=waypoints.length) startingPointIdx=0;
  updateWPList(); markDirty();
}

function clearWaypoints() {
  if (!confirm('Clear all waypoints?')) return;
  waypoints=[]; selectedWP=-1; startingPointIdx=0; barrierSegments=[]; barrierSelStart=-1;
  updateWPList(); updateBarrierList(); markDirty();
}

function clearAll() {
  if (!confirm('Reset everything? This cannot be undone.')) return;
  waypoints=[]; paintLayers=[]; undoStack=[]; selectedWP=-1; bgImage=null;
  barrierSegments=[]; barrierSelStart=-1; startingPointIdx=0;
  updateWPList(); updateBarrierList(); markDirty();
}

// ── Simplify waypoints shortcut ─────────────────────
function openSimplify() {
  const modal=document.getElementById('simplify-modal');
  if (modal) {
    const _sw=document.getElementById('stat-wp-simplify');if(_sw)_sw.textContent=waypoints.length;
    modal.classList.add('open');
    updateSimplifyPreview();
  }
}
function closeSimplify(){document.getElementById('simplify-modal').classList.remove('open');}

function updateSimplifyPreview() {
  const eps=parseFloat(document.getElementById('simplify-eps').value)||2;
  document.getElementById('simplify-eps-val').textContent=eps.toFixed(1);
  if (waypoints.length<5){const _sw=document.getElementById('stat-wp-simplify');if(_sw)_sw.textContent=waypoints.length;return;}
  const closed=waypoints.concat([waypoints[0]]);
  const simplified=rdp(closed,eps);
  const count=simplified.length-(simplified.length>1&&simplified[simplified.length-1].x===simplified[0].x?1:0);
  document.getElementById('simplify-preview').textContent=Math.max(3,count);
}

function applySimplify() {
  const eps=parseFloat(document.getElementById('simplify-eps').value)||2;
  simplifyWaypoints(eps);
  closeSimplify();
}

