// ═══════════════════════════════════════════════════
// RENDER — Circuit Forge  (clean rebuild)
// ═══════════════════════════════════════════════════

// ── Canvas / context ────────────────────────────────
const bgCanvas   = document.getElementById('bg-canvas');
const mainCanvas = document.getElementById('main-canvas');
const bgCtx      = bgCanvas.getContext('2d');
const ctx        = mainCanvas.getContext('2d');
const wrap       = document.getElementById('canvas-wrap');

// ── State ────────────────────────────────────────────
let cam              = { x: 0, y: 0, zoom: 1 };
let tool             = 'pan';
let surface          = 'flat_kerb';
let brushSize        = 12;
let waypoints        = [];
let paintLayers      = [];
let undoStack        = [];
let bgImage          = null;
let bgImageBounds    = { x: 0, y: 0, w: 0, h: 0 };
let isPainting       = false;
let isPanning        = false;
let spaceDown        = false;
let panStart         = { x: 0, y: 0, camX: 0, camY: 0 };
let selectedWP       = -1;
let mouseWorld       = { x: 0, y: 0 };
let startingPointIdx = 0;
let barrierSegments  = [];
let barrierSelStart  = -1;
let barrierSide      = 'both';

// ── Spline cache ─────────────────────────────────────
let _cachedSpline12 = null, _cachedSpline16 = null, _cachedSpline20 = null;
let _bgCamKey = '', _wpCacheKey = '';

// ── Track geometry constants (world units ≈ 0.93 m) ──
const TRACK_HALF_WIDTH = 7;   // half of 14 m road
const BARRIER_INNER    = 9.0; // inner barrier line — just outside the kerb
const BARRIER_OUTER    = 26.0; // outer barrier line — perimeter wall

// ── Surface config (kept for export.js compatibility) ─
const SURFACES = {
  flat_kerb: { color: 'rgba(232,57,42,0.85)',   label: 'Flat Kerb',    dot: '#e8392a', icon: '🟥' },
  sausage:   { color: 'rgba(245,197,24,0.90)',   label: 'Sausage Kerb', dot: '#f5c518', icon: '🟨' },
  rumble:    { color: 'rgba(200,50,50,0.75)',    label: 'Rumble Strip', dot: '#dd3333', icon: '🟧' },
  gravel:    { color: 'rgba(200,184,154,0.75)',  label: 'Gravel',       dot: '#c8b89a', icon: '🟫' },
  sand:      { color: 'rgba(227,207,152,0.78)',  label: 'Sand',         dot: '#e3cf98', icon: '🟨' },
  grass:     { color: 'rgba(40,110,40,0.70)',    label: 'Grass',        dot: '#3a7a3a', icon: '🟩' },
  armco:     { color: 'rgba(180,180,180,0.90)',  label: 'Armco Wall',   dot: '#bbbbbb', icon: '⬜' },
  tecpro:    { color: 'rgba(40,80,180,0.85)',    label: 'Tecpro',       dot: '#3a5fa8', icon: '🟦' },
  tyrewall:  { color: 'rgba(55,55,55,0.90)',     label: 'Tyre Wall',    dot: '#555555', icon: '⬛' },
};

const SURFACE_LANES = {
  rumble:    { inner:  7.0, outer:  8.1, labelOffset: 12 },
  flat_kerb: { inner:  7.0, outer:  8.1, labelOffset: 12 },
  sausage:   { inner:  7.0, outer:  8.1, labelOffset: 14 },
  grass:     { inner:  8.1, outer: 26.0, labelOffset: 22 },
  gravel:    { inner:  9.2, outer: 23.0, labelOffset: 20 },
  sand:      { inner:  9.2, outer: 23.0, labelOffset: 20 },
  tyrewall:  { inner: 23.0, outer: 23.9, labelOffset: 25 },
  armco:     { inner: 23.9, outer: 24.9, labelOffset: 28 },
  tecpro:    { inner: 24.9, outer: 25.8, labelOffset: 27 },
};

function getSurfaceLane(surfaceName, lane = 0) {
  const cfg = SURFACE_LANES[surfaceName] || SURFACE_LANES.flat_kerb;
  const extra = Math.max(0, lane || 0) * 5.5;
  return {
    inner: cfg.inner + extra,
    outer: cfg.outer + extra,
    center: (cfg.inner + cfg.outer) * 0.5 + extra,
    width: Math.max(2, cfg.outer - cfg.inner),
    labelOffset: (cfg.labelOffset || cfg.outer + 8) + extra
  };
}

// ── Resize ───────────────────────────────────────────
function resize() {
  const r = wrap.getBoundingClientRect();
  bgCanvas.width = mainCanvas.width = r.width;
  bgCanvas.height = mainCanvas.height = r.height;
  render();
}
window.addEventListener('resize', resize);
resize();

// ── Coord transforms ─────────────────────────────────
function worldToScreen(wx, wy) {
  return {
    x: (wx - cam.x) * cam.zoom + mainCanvas.width  / 2,
    y: (wy - cam.y) * cam.zoom + mainCanvas.height / 2
  };
}
function screenToWorld(sx, sy) {
  return {
    x: (sx - mainCanvas.width  / 2) / cam.zoom + cam.x,
    y: (sy - mainCanvas.height / 2) / cam.zoom + cam.y
  };
}

// ── Spline ───────────────────────────────────────────
function catmullPoint(p0, p1, p2, p3, t) {
  const t2=t*t, t3=t2*t;
  return {
    x: 0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
    y: 0.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3)
  };
}

function buildSplinePoints(segs) {
  const n = waypoints.length;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const p0=waypoints[(i-1+n)%n], p1=waypoints[i];
    const p2=waypoints[(i+1)%n],   p3=waypoints[(i+2)%n];
    for (let j = 0; j < segs; j++) pts.push({ pt: catmullPoint(p0,p1,p2,p3,j/segs), seg: i });
  }
  return pts;
}

function _invalidateSplineCache() {
  _cachedSpline12 = _cachedSpline16 = _cachedSpline20 = null;
}

function getCachedSpline(segs) {
  if (segs === 12) return _cachedSpline12 || (_cachedSpline12 = buildSplinePoints(12));
  if (segs === 16) return _cachedSpline16 || (_cachedSpline16 = buildSplinePoints(16));
  if (segs === 20) return _cachedSpline20 || (_cachedSpline20 = buildSplinePoints(20));
  return buildSplinePoints(segs);
}

// ── RDP simplify (used by tools.js) ─────────────────
function rdpPerpendicularDist(px, py, x1, y1, x2, y2) {
  const dx=x2-x1, dy=y2-y1, len2=dx*dx+dy*dy;
  if (len2===0) return Math.hypot(px-x1,py-y1);
  const t=Math.max(0,Math.min(1,((px-x1)*dx+(py-y1)*dy)/len2));
  return Math.hypot(px-(x1+t*dx),py-(y1+t*dy));
}
function rdp(pts, eps) {
  if (pts.length<=2) return pts.slice();
  let maxDist=0, maxIdx=0;
  const first=pts[0], last=pts[pts.length-1];
  for (let i=1; i<pts.length-1; i++) {
    const d=rdpPerpendicularDist(pts[i].x,pts[i].y,first.x,first.y,last.x,last.y);
    if (d>maxDist){maxDist=d;maxIdx=i;}
  }
  if (maxDist>eps) {
    const left=rdp(pts.slice(0,maxIdx+1),eps), right=rdp(pts.slice(maxIdx),eps);
    return left.slice(0,-1).concat(right);
  }
  return [first,last];
}
function simplifyWaypoints(eps) {
  if (waypoints.length<5){showToast('Not enough waypoints');return;}
  const before=waypoints.length;
  const closed=waypoints.concat([waypoints[0]]);
  const simplified=rdp(closed,eps);
  if (simplified.length>1&&simplified[simplified.length-1].x===simplified[0].x) simplified.pop();
  if (simplified.length<3){showToast('Tolerance too high');return;}
  waypoints=simplified; startingPointIdx=0; selectedWP=-1;
  updateWPList(); render();
  showToast(`Simplified: ${before} → ${waypoints.length} waypoints`);
}

// ═══════════════════════════════════════════════════
// OFFSET POLYLINE — stable sign-propagated normals
// sideNum: +1 = right of travel, -1 = left
// ═══════════════════════════════════════════════════
function buildOffsetScreenPolyline(pts, sideNum, offset) {
  const len = pts.length;
  if (len < 2) return [];

  const raw = pts.map((p, i) => {
    const prev = pts[Math.max(0, i-1)], next = pts[Math.min(len-1, i+1)];
    const ax = i===0     ? pts[1].pt.x-pts[0].pt.x
             : i===len-1 ? pts[len-1].pt.x-pts[len-2].pt.x
             : next.pt.x-prev.pt.x;
    const ay = i===0     ? pts[1].pt.y-pts[0].pt.y
             : i===len-1 ? pts[len-1].pt.y-pts[len-2].pt.y
             : next.pt.y-prev.pt.y;
    const sl = Math.sqrt(ax*ax+ay*ay)||1;
    return { px: -ay/sl, py: ax/sl };
  });

  // Shoelace winding to seed normal direction
  let area = 0;
  for (let i=0; i<len-1; i++)
    area += pts[i].pt.x*pts[i+1].pt.y - pts[i+1].pt.x*pts[i].pt.y;
  const windSign = area >= 0 ? -1 : 1;

  const normals = new Array(len);
  normals[0] = { px: raw[0].px*windSign, py: raw[0].py*windSign };
  for (let i=1; i<len; i++) {
    const dot = raw[i].px*normals[i-1].px + raw[i].py*normals[i-1].py;
    const s = dot >= 0 ? 1 : -1;
    normals[i] = { px: raw[i].px*s, py: raw[i].py*s };
  }

  return pts.map((p, i) => {
    const nx = normals[i].px * sideNum;
    const ny = normals[i].py * sideNum;
    return worldToScreen(p.pt.x + nx*offset, p.pt.y + ny*offset);
  });
}

// ── Polyline path helper ─────────────────────────────
function _polyPath(ctx, poly) {
  ctx.beginPath();
  poly.forEach((p, i) => i===0 ? ctx.moveTo(p.x,p.y) : ctx.lineTo(p.x,p.y));
}

// ═══════════════════════════════════════════════════
// BACKGROUND
// ═══════════════════════════════════════════════════
function _redrawBg(W, H) {
  bgCtx.clearRect(0, 0, W, H);
  bgCtx.fillStyle = '#2d5a1b';
  bgCtx.fillRect(0, 0, W, H);
  const gs = 50 * cam.zoom;
  const ox = (-cam.x * cam.zoom + W/2) % gs;
  const oy = (-cam.y * cam.zoom + H/2) % gs;
  bgCtx.beginPath();
  for (let x=ox; x<W; x+=gs) { bgCtx.moveTo(x,0); bgCtx.lineTo(x,H); }
  for (let y=oy; y<H; y+=gs) { bgCtx.moveTo(0,y); bgCtx.lineTo(W,y); }
  bgCtx.strokeStyle = 'rgba(0,0,0,0.08)';
  bgCtx.lineWidth = 1;
  bgCtx.stroke();
}

function _getWpKey() {
  const n = waypoints.length;
  if (n===0) return '0';
  const s = waypoints[0].x+waypoints[0].y+waypoints[Math.floor(n/2)].x+waypoints[Math.floor(n/2)].y+waypoints[n-1].x+waypoints[n-1].y;
  return `${n}_${s}`;
}

// ═══════════════════════════════════════════════════
// MAIN RENDER
// ═══════════════════════════════════════════════════
function render() {
  if (typeof preview3dActive !== 'undefined' && preview3dActive) return;
  const W = mainCanvas.width, H = mainCanvas.height;

  // Background — only redraw on camera change
  const bgKey = `${cam.x.toFixed(2)}_${cam.y.toFixed(2)}_${cam.zoom.toFixed(4)}_${W}_${H}`;
  if (bgKey !== _bgCamKey) {
    _bgCamKey = bgKey;
    _redrawBg(W, H);
    if (bgImage) {
      const s = worldToScreen(bgImageBounds.x, bgImageBounds.y);
      bgCtx.globalAlpha = 0.55;
      bgCtx.drawImage(bgImage, s.x, s.y, bgImageBounds.w*cam.zoom, bgImageBounds.h*cam.zoom);
      bgCtx.globalAlpha = 1;
    }
  }

  // Spline cache invalidation
  const wpKey = _getWpKey();
  if (wpKey !== _wpCacheKey) { _wpCacheKey = wpKey; _invalidateSplineCache(); }

  ctx.clearRect(0, 0, W, H);

  if (waypoints.length >= 2) {
    drawTrackRoad();
    drawBarrierLines();
    drawCentreline();
  }

  // Waypoint dots
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const s  = worldToScreen(wp.x, wp.y);
    const isStart = i === startingPointIdx;
    const r = isStart ? 8 : 5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI*2);
    ctx.fillStyle = isStart ? '#00ff88' : '#e8ff47';
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.font = `bold ${Math.max(7, Math.min(10, cam.zoom*9))}px "Barlow Condensed", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isStart ? 'SF' : i, s.x, s.y);
  }
}

// ═══════════════════════════════════════════════════
// TRACK ROAD
// ═══════════════════════════════════════════════════
function drawTrackRoad() {
  const splinePts = getCachedSpline(16);
  if (splinePts.length < 2) return;
  const trackW = Math.max(6, TRACK_HALF_WIDTH * 2 * cam.zoom);

  // Asphalt
  ctx.strokeStyle = 'rgba(48,50,54,0.97)';
  ctx.lineWidth   = trackW;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  splinePts.forEach((p,i) => {
    const s = worldToScreen(p.pt.x, p.pt.y);
    i===0 ? ctx.moveTo(s.x,s.y) : ctx.lineTo(s.x,s.y);
  });
  ctx.closePath();
  ctx.stroke();

  // White edge lines both sides
  const edgeOffset = TRACK_HALF_WIDTH - 0.4;
  const edgeW = Math.max(1, 0.8 * cam.zoom);
  ctx.lineWidth   = edgeW;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  [-1, 1].forEach(side => {
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    const poly = buildOffsetScreenPolyline(splinePts, side, edgeOffset);
    _polyPath(ctx, poly);
    ctx.stroke();
  });

  // Kerb — alternating red/white dashes just outside the edge line
  const kerbOffset = TRACK_HALF_WIDTH + 0.6;
  const kerbW      = Math.max(2, 2.2 * cam.zoom);
  const dashLen    = Math.max(6, 14 * cam.zoom);
  ctx.lineWidth = kerbW;
  ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
  [-1, 1].forEach(side => {
    const poly = buildOffsetScreenPolyline(splinePts, side, kerbOffset);
    ctx.setLineDash([dashLen, dashLen]);
    ctx.lineDashOffset = 0;
    ctx.strokeStyle = 'rgba(215,25,25,0.92)';
    _polyPath(ctx, poly); ctx.stroke();
    ctx.lineDashOffset = dashLen;
    ctx.strokeStyle = 'rgba(245,245,245,0.92)';
    _polyPath(ctx, poly); ctx.stroke();
  });
  ctx.setLineDash([]); ctx.lineDashOffset = 0;

  // Start/finish line
  if (startingPointIdx < waypoints.length) {
    const spl = splinePts.length;
    const i1  = Math.min(startingPointIdx * 16, spl-1);
    const i2  = Math.min(i1+1, spl-1);
    if (i2 > i1) {
      const sfPt = worldToScreen(waypoints[startingPointIdx].x, waypoints[startingPointIdx].y);
      const dx=splinePts[i2].pt.x-splinePts[i1].pt.x, dy=splinePts[i2].pt.y-splinePts[i1].pt.y;
      const len=Math.hypot(dx,dy)||1;
      const ux=-dy/len*cam.zoom, uy=dx/len*cam.zoom;
      const tx=dx/len*cam.zoom, ty=dy/len*cam.zoom;
      const COLS=4, ROWS=2, sq=(trackW)/COLS;
      ctx.save();
      for (let row=0; row<ROWS; row++) for (let col=0; col<COLS; col++) {
        const across=(col+0.5-COLS/2)*sq, along=(row+0.5-ROWS/2)*sq;
        const cx=sfPt.x+ux*across+tx*along, cy=sfPt.y+uy*across+ty*along;
        ctx.fillStyle=(row+col)%2===0?'#ffffff':'#111111';
        ctx.save(); ctx.translate(cx,cy); ctx.rotate(Math.atan2(dy,dx));
        ctx.fillRect(-sq*0.5,-sq*0.5,sq,sq); ctx.restore();
      }
      ctx.restore();
    }
  }
}

// ═══════════════════════════════════════════════════
// BARRIER LINES
// Two clean offset lines — inner and outer — following
// the track shape exactly. These are the foundation;
// surfaces will fill the space between them later.
// ═══════════════════════════════════════════════════
function drawBarrierLines() {
  const splinePts = getCachedSpline(20);
  if (splinePts.length < 2) return;

  const innerOffset = BARRIER_INNER;   //  9.0 wu — inner barrier (just past kerb)
  const outerOffset = BARRIER_OUTER;   // 26.0 wu — outer perimeter wall

  [-1, 1].forEach(side => {
    const inner = buildOffsetScreenPolyline(splinePts, side, innerOffset);
    const outer = buildOffsetScreenPolyline(splinePts, side, outerOffset);

    // Outer wall — thick armco-style silver line
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, 3.5 * cam.zoom);
    ctx.strokeStyle = 'rgba(20,20,20,0.5)';
    _polyPath(ctx, outer); ctx.stroke();
    ctx.lineWidth = Math.max(3, 2.5 * cam.zoom);
    ctx.strokeStyle = 'rgba(170,185,200,1.0)';
    _polyPath(ctx, outer); ctx.stroke();
    ctx.lineWidth = Math.max(1, 1.0 * cam.zoom);
    ctx.strokeStyle = 'rgba(235,245,255,0.7)';
    _polyPath(ctx, outer); ctx.stroke();

    // Inner barrier — thinner, slightly transparent
    ctx.lineWidth = Math.max(2, 2.0 * cam.zoom);
    ctx.strokeStyle = 'rgba(20,20,20,0.35)';
    _polyPath(ctx, inner); ctx.stroke();
    ctx.lineWidth = Math.max(1.5, 1.5 * cam.zoom);
    ctx.strokeStyle = 'rgba(160,175,190,0.85)';
    _polyPath(ctx, inner); ctx.stroke();
  });
}

// ═══════════════════════════════════════════════════
// CENTRELINE
// ═══════════════════════════════════════════════════
function drawCentreline() {
  const n = waypoints.length;
  ctx.strokeStyle = 'rgba(232,255,71,0.18)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 8]);
  ctx.beginPath();
  for (let i=0; i<n; i++) {
    const p0=waypoints[(i-1+n)%n],p1=waypoints[i],p2=waypoints[(i+1)%n],p3=waypoints[(i+2)%n];
    for (let j=0; j<8; j++) {
      const pt=catmullPoint(p0,p1,p2,p3,j/8);
      const s=worldToScreen(pt.x,pt.y);
      (i===0&&j===0)?ctx.moveTo(s.x,s.y):ctx.lineTo(s.x,s.y);
    }
  }
  ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
}

// ═══════════════════════════════════════════════════
// STUBS — kept for export.js / home.js / preview3d.js
// ═══════════════════════════════════════════════════
function drawAutoSurfaces()          {}
function drawBarrierSegments()       {}
function drawBarrierIntersectionFill() {}
function drawSurfacePattern()        {}
function drawPermanentGrassBand()    {}
function drawBarrierHover()          {}
function expandBarrierDrawItems(s)   { return s || []; }
function mergeExpandedBarrierItems(s){ return s || []; }
function getSplineSegmentPoints(pts, from, to) {
  return from <= to ? pts.filter(p=>p.seg>=from&&p.seg<=to)
                    : [...pts.filter(p=>p.seg>=from),...pts.filter(p=>p.seg<=to)];
}
function buildOffsetScreenPolylineVarying(pts, sideNum, offsets) {
  return buildOffsetScreenPolyline(pts, sideNum, offsets[Math.floor(offsets.length/2)] || 0);
}
function buildTransitionOffsets(count, near, far, trans) {
  return Array.from({length:count},()=>far);
}
function easeInOut(t){ return t<0.5?2*t*t:-1+(4-2*t)*t; }
function autoPlaceTrackFeatures()    {}
function normalizeSideValue(side)    { return side==='left'||side===-1?-1:1; }
function dominantSignAt(idx, cornerSign, spl) {
  let s=0; for(let d=0;d<8;d++) s+=cornerSign[(idx+d)%spl]; return s>=0?1:-1;
}

// ── Toast ─────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove('show'), 2200);
}
