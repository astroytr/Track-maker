// ═══════════════════════════════════════════════════
// STATE — Circuit Forge v7.1
// ═══════════════════════════════════════════════════
const bgCanvas   = document.getElementById('bg-canvas');
const mainCanvas = document.getElementById('main-canvas');
const bgCtx      = bgCanvas.getContext('2d');
const ctx        = mainCanvas.getContext('2d');
const wrap       = document.getElementById('canvas-wrap');

let cam = { x: 0, y: 0, zoom: 1 };
let tool = 'waypoint';
let surface = 'flat_kerb';
let brushSize = 12;
let waypoints = [];
let paintLayers = [];
let undoStack = [];
let bgImage = null;
let bgImageBounds = { x: 0, y: 0, w: 0, h: 0 };
let isPainting = false;
let isPanning  = false;
let spaceDown  = false;
let panStart = { x: 0, y: 0, camX: 0, camY: 0 };
let selectedWP = -1;
let mouseWorld = { x: 0, y: 0 };
let startingPointIdx = 0;
let barrierSegments  = [];
let barrierSelStart  = -1;
let barrierSide      = 'both';   // 'both' | 'left' | 'right'
let _cachedSpline12  = null;
let _cachedSpline16  = null;
let _cachedSpline20  = null;
let _bgCamKey        = '';
let _wpCacheKey      = '';
let _paintSortKey    = -1;
let _orderedPaintCache = [];

// ═══════════════════════════════════════════════════
// RESIZE
// ═══════════════════════════════════════════════════
function resize() {
  const r = wrap.getBoundingClientRect();
  bgCanvas.width = mainCanvas.width = r.width;
  bgCanvas.height = mainCanvas.height = r.height;
  render();
}
window.addEventListener('resize', resize);
resize();

// ═══════════════════════════════════════════════════
// COORDINATE TRANSFORMS
// ═══════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════
// SURFACE CONFIG
// ═══════════════════════════════════════════════════
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

const TRACK_HALF_WIDTH = 7;

// ── FIA-based cross-section (world units ≈ 0.93 m each) ──────────────────
// Real layout from centreline outward:
//   0–7 wu   : track surface (14m road)
//   7–8.1    : rumble strip / flat kerb  (~1 m kerb)
//   8.1–9.2  : sausage kerb zone         (~1 m)
//   9.2–11.2 : verge / access strip      (~2 m grass shoulder always present)
//   11.2–20.5: gravel OR sand trap       (~9 m runoff)
//   9.2–25.5 : outer grass (full width, rendered UNDER runoff)
//   barrier  : sits at outer edge of runoff
// ── FIA-based cross-section (matches 3D exactly) ────────────────────────
// Centreline outward:
//   0–7     : track road
//   7–8.1   : flat kerb / rumble strip
//   8.1–9.2 : sausage kerb (slow-corner apexes only)
//   8.1–26  : grass base band (always present)
//   9.2–23  : gravel or sand runoff (corner outsides, auto+manual)
//   23–23.9 : tyre wall (behind gravel at corners)
//   23.9–26 : armco (corners) / TecPro (straights) perimeter wall
const SURFACE_LANES = {
  rumble:    { inner:  7.0, outer:  8.1, labelOffset: 12 },
  flat_kerb: { inner:  7.0, outer:  8.1, labelOffset: 12 },
  sausage:   { inner:  7.0, outer:  8.1, labelOffset: 14 },  // apex of flat kerb zone
  grass:     { inner:  8.1, outer: 26.0, labelOffset: 22 },
  gravel:    { inner:  9.2, outer: 23.0, labelOffset: 20 },
  sand:      { inner:  9.2, outer: 23.0, labelOffset: 20 },
  tyrewall:  { inner: 23.0, outer: 23.9, labelOffset: 25 },
  armco:     { inner: 23.9, outer: 24.9, labelOffset: 28 },
  tecpro:    { inner: 24.9, outer: 25.8, labelOffset: 27 },
};

const LANE_STEP = 5.5;

function normalizeSideValue(side) {
  return side === 'left' || side === -1 ? -1 : 1;
}

function getSurfaceLane(surfaceName, lane = 0) {
  const cfg = SURFACE_LANES[surfaceName] || SURFACE_LANES.flat_kerb;
  const extra = Math.max(0, lane || 0) * LANE_STEP;
  return {
    inner: cfg.inner + extra,
    outer: cfg.outer + extra,
    center: (cfg.inner + cfg.outer) * 0.5 + extra,
    width: Math.max(2, cfg.outer - cfg.inner),
    labelOffset: (cfg.labelOffset || cfg.outer + 8) + extra
  };
}

// ═══════════════════════════════════════════════════
// RAMER-DOUGLAS-PEUCKER SIMPLIFICATION
// ═══════════════════════════════════════════════════
function rdpPerpendicularDist(px, py, x1, y1, x2, y2) {
  const dx = x2-x1, dy = y2-y1;
  const len2 = dx*dx + dy*dy;
  if (len2 === 0) return Math.hypot(px-x1, py-y1);
  const t = Math.max(0, Math.min(1, ((px-x1)*dx + (py-y1)*dy) / len2));
  return Math.hypot(px-(x1+t*dx), py-(y1+t*dy));
}

function rdp(pts, eps) {
  if (pts.length <= 2) return pts.slice();
  let maxDist = 0, maxIdx = 0;
  const first = pts[0], last = pts[pts.length-1];
  for (let i=1; i<pts.length-1; i++) {
    const d = rdpPerpendicularDist(pts[i].x,pts[i].y,first.x,first.y,last.x,last.y);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > eps) {
    const left  = rdp(pts.slice(0, maxIdx+1), eps);
    const right = rdp(pts.slice(maxIdx),       eps);
    return left.slice(0,-1).concat(right);
  }
  return [first, last];
}

function simplifyWaypoints(eps) {
  if (waypoints.length < 5) { showToast('Not enough waypoints to simplify'); return; }
  const before = waypoints.length;
  const closed = waypoints.concat([waypoints[0]]);
  const simplified = rdp(closed, eps);
  if (simplified.length > 1 &&
      simplified[simplified.length-1].x === simplified[0].x &&
      simplified[simplified.length-1].y === simplified[0].y) {
    simplified.pop();
  }
  if (simplified.length < 3) { showToast('Tolerance too high — no simplification applied'); return; }
  waypoints = simplified;
  startingPointIdx = 0;
  selectedWP = -1;
  updateWPList();
  render();
  showToast(`Simplified: ${before} → ${waypoints.length} waypoints`);
}

// ═══════════════════════════════════════════════════
// SPLINE CACHE — rebuilt once per render, shared by all draw calls
// ═══════════════════════════════════════════════════

function _invalidateSplineCache() {
  _cachedSpline12 = _cachedSpline16 = _cachedSpline20 = null;
}

function getCachedSpline(segs) {
  if (segs === 12) return _cachedSpline12 || (_cachedSpline12 = buildSplinePoints(12));
  if (segs === 16) return _cachedSpline16 || (_cachedSpline16 = buildSplinePoints(16));
  if (segs === 20) return _cachedSpline20 || (_cachedSpline20 = buildSplinePoints(20));
  return buildSplinePoints(segs);
}


// ── Background grid cache — only redrawn when camera or canvas size changes ──
function _redrawBg(W, H) {
  bgCtx.clearRect(0, 0, W, H);
  bgCtx.fillStyle = '#2d5a1b';
  bgCtx.fillRect(0, 0, W, H);
  // Single-path grid — far cheaper than one beginPath per line
  const gs = 50 * cam.zoom;
  const ox = (-cam.x * cam.zoom + W / 2) % gs;
  const oy = (-cam.y * cam.zoom + H / 2) % gs;
  bgCtx.beginPath();
  for (let x = ox; x < W; x += gs) { bgCtx.moveTo(x, 0); bgCtx.lineTo(x, H); }
  for (let y = oy; y < H; y += gs) { bgCtx.moveTo(0, y); bgCtx.lineTo(W, y); }
  bgCtx.strokeStyle = 'rgba(0,0,0,0.08)';
  bgCtx.lineWidth = 1;
  bgCtx.stroke();
}

// ── Spline cache key — invalidate only when waypoints actually change ──
function _getWpKey() {
  // cheap hash: count + sum of x+y of first/mid/last waypoint
  const n = waypoints.length;
  if (n === 0) return '0';
  const s = waypoints[0].x + waypoints[0].y +
            waypoints[Math.floor(n/2)].x + waypoints[Math.floor(n/2)].y +
            waypoints[n-1].x + waypoints[n-1].y;
  return `${n}_${s}`;
}

// ── Paint layer sort cache — only re-sort when paintLayers changes ──

function render() {
  if (typeof preview3dActive !== 'undefined' && preview3dActive) return;
  const W = mainCanvas.width, H = mainCanvas.height;

  // Only redraw background when camera or size actually changed
  const bgKey = `${cam.x.toFixed(2)}_${cam.y.toFixed(2)}_${cam.zoom.toFixed(4)}_${W}_${H}`;
  if (bgKey !== _bgCamKey) {
    _bgCamKey = bgKey;
    _redrawBg(W, H);
    // Background image redrawn too
    if (bgImage) {
      const s = worldToScreen(bgImageBounds.x, bgImageBounds.y);
      bgCtx.globalAlpha = 0.55;
      bgCtx.drawImage(bgImage, s.x, s.y, bgImageBounds.w * cam.zoom, bgImageBounds.h * cam.zoom);
      bgCtx.globalAlpha = 1;
    }
  }

  // Only invalidate spline cache when waypoints actually change
  const wpKey = _getWpKey();
  if (wpKey !== _wpCacheKey) {
    _wpCacheKey = wpKey;
    _invalidateSplineCache();
  }

  ctx.clearRect(0, 0, W, H);

  // ── Paint layers — only re-sort when count changes ──
  if (paintLayers.length !== _paintSortKey) {
    _paintSortKey = paintLayers.length;
    _orderedPaintCache = paintLayers.slice().sort((a, b) => {
      const ar = a.rank !== undefined ? a.rank : (SURFACE_LANES[a.surface] ? SURFACE_LANES[a.surface].inner : 99);
      const br = b.rank !== undefined ? b.rank : (SURFACE_LANES[b.surface] ? SURFACE_LANES[b.surface].inner : 99);
      return br - ar;
    });
  }
  for (const p of _orderedPaintCache) {
    const s = worldToScreen(p.x, p.y);
    ctx.beginPath();
    ctx.arc(s.x, s.y, p.r * cam.zoom, 0, Math.PI * 2);
    ctx.fillStyle = SURFACES[p.surface] ? SURFACES[p.surface].color : 'rgba(128,128,128,0.6)';
    ctx.fill();
  }

  // ── Track — strict back-to-front paint order ──
  // 1. Grass band (widest, furthest out — background for everything)
  // 2. Barrier segments: runoff surfaces first (gravel/sand/grass), then barriers/kerbs on top
  // 3. Track road (asphalt + kerb chevrons) — always on top of runoff
  // 4. Centreline dashes
  if (waypoints.length >= 2) {
    drawAutoSurfaces();
    drawBarrierSegments();
    drawBarrierIntersectionFill();
    drawTrackRoad();
    drawCentreline();
  }

  // ── Waypoint dots (with drivability highlight) ──
  // Build issue map once per render — O(n), not per-dot
  const _driveIssues = new Map();
  if (typeof analyseTrack === 'function' && waypoints.length >= 3) {
    const _da = analyseTrack();
    if (_da) _da.issues.forEach(iss => _driveIssues.set(iss.idx, iss.level));
  }

  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const s  = worldToScreen(wp.x, wp.y);
    const isStart       = i === startingPointIdx;
    const isSel         = i === selectedWP;
    const isBarrierSel  = tool === 'barrier' && i === barrierSelStart;
    const issueLevel    = _driveIssues.get(i);  // 'hard' | 'tight' | undefined

    const r = isBarrierSel ? 11 : (isSel ? 9 : (isStart ? 8 : (issueLevel ? 7 : 5)));

    // Outer glow ring for problem corners
    if (issueLevel && !isStart && !isBarrierSel) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = issueLevel === 'hard' ? 'rgba(255,60,60,0.55)' : 'rgba(255,180,0,0.45)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    // Fill: barrier-sel=orange, start=green, selected=purple, hard=red, tight=amber, normal=yellow
    ctx.fillStyle = isBarrierSel ? '#ff8c00'
                  : isStart      ? '#00ff88'
                  : isSel        ? '#a78bfa'
                  : issueLevel === 'hard'  ? '#ff4040'
                  : issueLevel === 'tight' ? '#ffb800'
                  : '#e8ff47';
    ctx.fill();
    ctx.strokeStyle = isBarrierSel ? '#fff' : '#000';
    ctx.lineWidth   = isBarrierSel ? 2.5 : 1.5;
    ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.font = `bold ${Math.max(7, Math.min(10, cam.zoom * 9))}px "Barlow Condensed", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isStart ? 'SF' : i, s.x, s.y);
  }
}

// ═══════════════════════════════════════════════════
// SPLINE
// ═══════════════════════════════════════════════════
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
  for (let i=0; i<n; i++) {
    const p0=waypoints[(i-1+n)%n], p1=waypoints[i];
    const p2=waypoints[(i+1)%n],   p3=waypoints[(i+2)%n];
    for (let j=0; j<segs; j++) pts.push({ pt: catmullPoint(p0,p1,p2,p3,j/segs), seg: i });
  }
  return pts;
}

function drawTrackRoad() {
  const splinePts = getCachedSpline(16);
  if (splinePts.length < 2) return;
  const n = waypoints.length;
  const screenPts = splinePts.map(p => ({ s: worldToScreen(p.pt.x, p.pt.y), seg: p.seg }));
  const trackW = Math.max(6, 14 * cam.zoom);
  const kerbW  = Math.max(2, 3.5 * cam.zoom);

  // ── Curvature per spline point (for inside kerb / braking zone detection) ──
  const spl = splinePts.length;
  const curvature  = new Float32Array(spl);
  const cornerSign = new Float32Array(spl);
  for (let i = 0; i < spl; i++) {
    const p0 = splinePts[(i-1+spl)%spl].pt, p1 = splinePts[i].pt, p2 = splinePts[(i+1)%spl].pt;
    const v1x=p1.x-p0.x, v1y=p1.y-p0.y, v2x=p2.x-p1.x, v2y=p2.y-p1.y;
    const cross=v1x*v2y-v1y*v2x;
    const len=(Math.sqrt(v1x*v1x+v1y*v1y)*Math.sqrt(v2x*v2x+v2y*v2y))||1;
    curvature[i]=Math.abs(cross)/len;
    cornerSign[i]=Math.sign(cross);
  }
  const CORNER_T = 0.010; // same-ish as auto surfaces but track-local
  const inCornerRoad = new Uint8Array(spl);
  const MARG = 10;
  for (let i=0; i<spl; i++) {
    if (curvature[i]>CORNER_T) for(let d=-MARG;d<=MARG;d++) inCornerRoad[(i+d+spl)%spl]=1;
  }

  // ── Asphalt — solid dark grey ──
  ctx.strokeStyle = 'rgba(48,50,54,0.97)';
  ctx.lineWidth = trackW*2;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  screenPts.forEach((p,i) => i===0 ? ctx.moveTo(p.s.x,p.s.y) : ctx.lineTo(p.s.x,p.s.y));
  ctx.closePath(); ctx.stroke();



  // ── Flat kerb — full circuit, both sides, batched dashed strokes ──
  {
    const flatKerbLane = getSurfaceLane('flat_kerb', 0);
    const kerbOffset = flatKerbLane.center;
    const dashLen = Math.max(8, 14 * cam.zoom);
    ctx.lineWidth = Math.max(2, flatKerbLane.width * cam.zoom);
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
  }

  // ── Braking markers — only at zoom > 0.8 ──
  if (cam.zoom > 0.8) {
    const markerColors = ['#ff2222','#ffdd00','#ffffff']; // 300 / 200 / 100
    const markerDists  = [24, 16, 8]; // in spline pts (~300/200/100m equivalent)
    for (let i = 1; i < spl; i++) {
      if (!inCornerRoad[i] || inCornerRoad[(i-1+spl)%spl]) continue;
      // i is the first point entering a corner — place markers before it
      const ds2 = dominantSignAt(i, cornerSign, spl);
      markerDists.forEach((offset, mi) => {
        const idx = ((i - offset) + spl) % spl;
        const pt  = splinePts[idx];
        const side = -ds2; // markers on outside of straight (opposite to upcoming corner outside)
        const mPoly = buildOffsetScreenPolyline(
          [splinePts[(idx-1+spl)%spl], pt, splinePts[(idx+1)%spl]], side, TRACK_HALF_WIDTH + 2.5
        );
        if (mPoly.length < 1) return;
        const mp = mPoly[1] || mPoly[0];
        const mw = Math.max(2, 3 * cam.zoom), mh = Math.max(4, 7 * cam.zoom);
        ctx.save();
        ctx.fillStyle = markerColors[mi];
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.rect(mp.x - mw/2, mp.y - mh/2, mw, mh);
        ctx.fill(); ctx.stroke();
        ctx.restore();
      });
    }
  }

  // ── Pit lane stub — short parallel road off start/finish straight ──
  if (startingPointIdx < waypoints.length && n >= 4) {
    const sfIdx = startingPointIdx * 16;
    const sfPt  = splinePts[Math.min(sfIdx, spl-1)];
    // Find the straight direction at SF point
    const nxt = splinePts[Math.min(sfIdx+4, spl-1)].pt;
    const prv = splinePts[Math.max(sfIdx-4, 0)].pt;
    const tdx = nxt.x - prv.x, tdy = nxt.y - prv.y;
    const tlen = Math.sqrt(tdx*tdx+tdy*tdy)||1;
    // Pit lane: parallel to track, offset ~3.5 world units to right, length ~20 world units back
    const pitSide = 1; // pit lane always on right/inside by convention
    const pitOffset = TRACK_HALF_WIDTH + 4.5;
    const pitLen = 22;
    // Build 5 pts along the pit lane parallel to the track centreline
    const pitPts = [];
    for (let k = -2; k <= 2; k++) {
      const frac = k / 2;
      const wx = sfPt.pt.x + tdx/tlen * frac * pitLen/2 - tdy/tlen * pitSide * pitOffset;
      const wy = sfPt.pt.y + tdy/tlen * frac * pitLen/2 + tdx/tlen * pitSide * pitOffset;
      pitPts.push(worldToScreen(wx, wy));
    }
    // Pit lane asphalt
    ctx.save();
    ctx.strokeStyle = 'rgba(55,57,62,0.92)';
    ctx.lineWidth = Math.max(4, trackW * 0.55);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    pitPts.forEach((p,i) => i===0 ? ctx.moveTo(p.x,p.y) : ctx.lineTo(p.x,p.y));
    ctx.stroke();
    // Pit entry/exit blend lines
    const sfScreen = worldToScreen(sfPt.pt.x, sfPt.pt.y);
    const pitEntry = pitPts[0], pitExit = pitPts[pitPts.length-1];
    const trackEdge1 = buildOffsetScreenPolyline([splinePts[Math.max(sfIdx-2,0)], sfPt], pitSide, TRACK_HALF_WIDTH);
    const trackEdge2 = buildOffsetScreenPolyline([sfPt, splinePts[Math.min(sfIdx+2,spl-1)]], pitSide, TRACK_HALF_WIDTH);
    ctx.strokeStyle = 'rgba(55,57,62,0.75)';
    ctx.lineWidth = Math.max(2, trackW * 0.3);
    ctx.setLineDash([3,3]);
    if (trackEdge1.length) { ctx.beginPath(); ctx.moveTo(trackEdge1[0].x,trackEdge1[0].y); ctx.lineTo(pitEntry.x,pitEntry.y); ctx.stroke(); }
    if (trackEdge2.length) { ctx.beginPath(); ctx.moveTo(trackEdge2[trackEdge2.length-1].x,trackEdge2[trackEdge2.length-1].y); ctx.lineTo(pitExit.x,pitExit.y); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ── Start/finish line — bold chequered ──
  if (startingPointIdx < waypoints.length) {
    const i1 = Math.min(startingPointIdx*16, screenPts.length-1);
    const i2 = Math.min(i1+1, screenPts.length-1);
    if (i2 > i1) {
      const sfPt = worldToScreen(waypoints[startingPointIdx].x, waypoints[startingPointIdx].y);
      const dx=screenPts[i2].s.x-screenPts[i1].s.x, dy=screenPts[i2].s.y-screenPts[i1].s.y;
      const len=Math.hypot(dx,dy)||1;
      // Perpendicular unit vector (across track width)
      const ux = -dy/len, uy = dx/len;
      // Along-track unit vector
      const tx2 = dx/len, ty2 = dy/len;
      // Chequered pattern — 4 cols across full track width, 2 rows along track
      const COLS = 4, ROWS = 2;
      const sq = (trackW * 2) / COLS;   // square size = full track width / columns
      const totalAlong = sq * ROWS;
      ctx.save();
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          // Centre each square: columns span -trackW to +trackW, rows along track
          const across = (col + 0.5 - COLS / 2) * sq;
          const along  = (row + 0.5 - ROWS / 2) * sq;
          const cx2 = sfPt.x + ux * across + tx2 * along;
          const cy2 = sfPt.y + uy * across + ty2 * along;
          ctx.fillStyle = (row + col) % 2 === 0 ? '#ffffff' : '#111111';
          ctx.save();
          ctx.translate(cx2, cy2);
          ctx.rotate(Math.atan2(dy, dx));
          ctx.fillRect(-sq * 0.5, -sq * 0.5, sq, sq);
          ctx.restore();
        }
      }
      ctx.restore();
    }
  }
}

// Helper used by drawTrackRoad for braking marker side detection
function dominantSignAt(idx, cornerSign, spl) {
  let s = 0;
  for (let d=0; d<8; d++) s += cornerSign[(idx+d)%spl];
  return s >= 0 ? 1 : -1;
}

// ═══════════════════════════════════════════════════
// SURFACE PATTERN DRAWING
// Each surface type is drawn with its real-world visual
// pattern rather than a plain colour strip.
// ═══════════════════════════════════════════════════

// Helper: stroke a polyline path
function _polyPath(ctx, poly) {
  ctx.beginPath();
  poly.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
}

// Helper: compute arc-length distances along a screen polyline
function _arcLengths(poly) {
  const d = [0];
  for (let i = 1; i < poly.length; i++) {
    const dx = poly[i].x - poly[i-1].x, dy = poly[i].y - poly[i-1].y;
    d.push(d[i-1] + Math.sqrt(dx*dx + dy*dy));
  }
  return d;
}

// Helper: point + tangent at arc-length t along a polyline
function _polyAtDist(poly, arcs, t) {
  if (poly.length === 1) return { x: poly[0].x, y: poly[0].y, tx: 1, ty: 0 };
  const total = arcs[arcs.length - 1];
  t = Math.max(0, Math.min(total, t));
  let lo = 0, hi = arcs.length - 1;
  while (lo < hi - 1) { const mid = (lo+hi)>>1; arcs[mid] <= t ? lo=mid : hi=mid; }
  const alpha = arcs[hi] - arcs[lo] < 1e-9 ? 0 : (t - arcs[lo]) / (arcs[hi] - arcs[lo]);
  const x = poly[lo].x + alpha * (poly[hi].x - poly[lo].x);
  const y = poly[lo].y + alpha * (poly[hi].y - poly[lo].y);
  const dx = poly[hi].x - poly[lo].x, dy = poly[hi].y - poly[lo].y;
  const len = Math.sqrt(dx*dx + dy*dy) || 1;
  return { x, y, tx: dx/len, ty: dy/len };
}

function drawSurfacePattern(ctx, surface, poly, lane, sideNum, zoom) {
  if (poly.length < 2) return;
  // Minimum visible width — barriers get a fixed screen-pixel floor so they're always readable
  const isBarrier = surface === 'armco' || surface === 'tecpro' || surface === 'tyrewall';
  const w = isBarrier
    ? Math.max(6, lane.width * zoom)        // barriers: never thinner than 6px
    : Math.max(3, lane.width * zoom);       // runoff/kerbs: never thinner than 3px
  ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';

  switch (surface) {

    // ── FLAT KERB — alternating red/white via two dash passes ───────────────
    case 'flat_kerb': {
      // Two overlapping dashed strokes — far cheaper than per-segment beginPath
      const dashLen = Math.max(5, 12 * zoom);
      ctx.lineWidth = w;
      ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
      ctx.setLineDash([dashLen, dashLen]);
      ctx.strokeStyle = 'rgba(220,25,25,1.0)';
      _polyPath(ctx, poly); ctx.stroke();
      ctx.lineDashOffset = dashLen;
      ctx.strokeStyle = 'rgba(252,252,252,1.0)';
      _polyPath(ctx, poly); ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
      break;
    }

    // ── RUMBLE STRIP — vivid orange/white via dash passes ──────────────────
    case 'rumble': {
      const dashLen = Math.max(4, 8 * zoom);
      ctx.lineWidth = w;
      ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
      ctx.setLineDash([dashLen, dashLen]);
      ctx.strokeStyle = 'rgba(240,100,0,1.0)';
      _polyPath(ctx, poly); ctx.stroke();
      ctx.lineDashOffset = dashLen;
      ctx.strokeStyle = 'rgba(248,248,248,1.0)';
      _polyPath(ctx, poly); ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
      break;
    }

    // ── SAUSAGE KERB — raised yellow ridge, proportional width ────────
    case 'sausage': {
      // Dark shadow outline — NOT inflated, just slightly round-capped
      ctx.lineWidth = w * 1.05;
      ctx.strokeStyle = 'rgba(130,95,0,0.60)';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      _polyPath(ctx, poly); ctx.stroke();
      // Main yellow body — exactly lane width
      ctx.lineWidth = w;
      ctx.strokeStyle = 'rgba(248,200,20,1.0)';
      _polyPath(ctx, poly); ctx.stroke();
      // White specular highlight — thin
      ctx.lineWidth = Math.max(1, w * 0.28);
      ctx.strokeStyle = 'rgba(255,255,255,0.80)';
      _polyPath(ctx, poly); ctx.stroke();
      ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
      break;
    }

    // ── GRAVEL — solid tan strip (no stipple for perf) ──────────
    case 'gravel': {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = w;
      ctx.strokeStyle = 'rgba(168,152,118,1.0)';
      _polyPath(ctx, poly); ctx.stroke();
      ctx.lineWidth = Math.max(2, w * 0.45);
      ctx.strokeStyle = 'rgba(140,124,92,0.60)';
      _polyPath(ctx, poly); ctx.stroke();
      ctx.lineCap = 'butt';
      break;
    }

    // ── SAND — solid warm-yellow strip (no stipple for perf) ────────
    case 'sand': {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const sandW = Math.max(18, w);
      ctx.lineWidth = sandW;
      ctx.strokeStyle = 'rgba(232,210,138,1.0)';
      _polyPath(ctx, poly); ctx.stroke();
      ctx.lineWidth = Math.max(4, sandW * 0.35);
      ctx.strokeStyle = 'rgba(195,168,95,0.50)';
      _polyPath(ctx, poly); ctx.stroke();
      ctx.lineCap = 'butt';
      break;
    }

    // ── GRASS — mid-green, drawn by drawPermanentGrassBand but also ──
    //    available as a manual surface segment
    case 'grass': {
      ctx.lineWidth = w;
      ctx.strokeStyle = 'rgba(42,100,25,1.0)';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      _polyPath(ctx, poly); ctx.stroke();
      // Lighter highlight stripe for grass texture
      ctx.lineWidth = Math.max(1.5, w * 0.22);
      ctx.strokeStyle = 'rgba(80,140,30,0.40)';
      _polyPath(ctx, poly); ctx.stroke();
      ctx.lineCap = 'butt';
      break;
    }

    // ── ARMCO — two-tone rail, no tick loops for perf ──
    case 'armco': {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = w + 2;
      ctx.strokeStyle = 'rgba(20,20,20,0.45)';
      _polyPath(ctx, poly); ctx.stroke();
      ctx.lineWidth = w;
      ctx.strokeStyle = 'rgba(160,180,200,1.0)';
      _polyPath(ctx, poly); ctx.stroke();
      ctx.lineWidth = Math.max(2, w * 0.38);
      ctx.strokeStyle = 'rgba(235,245,255,0.80)';
      _polyPath(ctx, poly); ctx.stroke();
      ctx.lineCap = 'butt';
      break;
    }

    // ── TECPRO — solid blue barrier, single pass for perf ──────────────
    case 'tecpro': {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = w + 1;
      ctx.strokeStyle = 'rgba(10,20,80,0.30)';
      _polyPath(ctx, poly); ctx.stroke();
      ctx.lineWidth = w;
      ctx.strokeStyle = 'rgba(20,70,220,1.0)';
      _polyPath(ctx, poly); ctx.stroke();
      ctx.lineWidth = Math.max(1.5, w * 0.30);
      ctx.strokeStyle = 'rgba(140,200,255,0.60)';
      _polyPath(ctx, poly); ctx.stroke();
      ctx.lineCap = 'butt';
      break;
    }

    // ── TYRE WALL — solid black with red stripe, no circle loop ──
    case 'tyrewall': {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = w + 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      _polyPath(ctx, poly); ctx.stroke();
      ctx.lineWidth = w;
      ctx.strokeStyle = 'rgba(22,22,22,1.0)';
      _polyPath(ctx, poly); ctx.stroke();
      ctx.lineWidth = Math.max(2, w * 0.30);
      ctx.strokeStyle = 'rgba(220,30,30,0.90)';
      _polyPath(ctx, poly); ctx.stroke();
      ctx.lineCap = 'butt';
      break;
    }

    // ── FALLBACK ──────────────────────────────────────────────────
    default: {
      const cfg = SURFACES[surface] || { color: 'rgba(180,180,180,0.9)' };
      ctx.lineWidth = w;
      ctx.strokeStyle = cfg.color;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      _polyPath(ctx, poly); ctx.stroke();
      break;
    }
  }
}

// ═══════════════════════════════════════════════════
// PERMANENT GRASS BAND — always-on base layer both sides of track
// Draws a wide grass strip (verge + runoff zone) the full circuit length.
// Specific surfaces (gravel, sand etc.) are painted on top by drawBarrierSegments.
// ═══════════════════════════════════════════════════
// ═══════════════════════════════════════════════════
// AUTO SURFACES — matches 3D preview exactly
// Straights → TecPro perimeter
// Corners   → gravel runoff (outside) + rumble both sides
// Slow/tight → sausage kerb at apex (outside)
// Behind gravel → tyre wall
// Only fills where user hasn't manually placed that surface type
// ═══════════════════════════════════════════════════
function drawAutoSurfaces() {
  if (waypoints.length < 3) return;
  const splinePts = getCachedSpline(12);
  const spl = splinePts.length;
  if (spl < 4) return;

  // ── Curvature per spline point ──
  const curvature  = new Float32Array(spl);
  const cornerSign = new Float32Array(spl);
  for (let i = 0; i < spl; i++) {
    const p0 = splinePts[(i - 1 + spl) % spl].pt;
    const p1 = splinePts[i].pt;
    const p2 = splinePts[(i + 1) % spl].pt;
    const v1x = p1.x - p0.x, v1y = p1.y - p0.y;
    const v2x = p2.x - p1.x, v2y = p2.y - p1.y;
    const cross = v1x * v2y - v1y * v2x;
    const len = (Math.sqrt(v1x*v1x+v1y*v1y) * Math.sqrt(v2x*v2x+v2y*v2y)) || 1;
    curvature[i]  = Math.abs(cross) / len;
    cornerSign[i] = Math.sign(cross); // +1=left turn, -1=right turn
  }

  // Thresholds — lower = more corners get runoff (more sand/gravel visible)
  // SLOW  < 0.022 → medium corner → gravel
  // SLOW >= 0.022 → slow/tight   → sand + sausage kerb + tyre wall
  // FAST  < 0.008 → high speed   → tarmac runoff only (no gravel)
  const CORNER_THRESH = 0.010; // was 0.015 — catches more gentle curves
  const MEDIUM_THRESH = 0.018; // medium corners → gravel
  const SLOW_THRESH   = 0.028; // was 0.040 — slow corners → sand + sausage
  const MARGIN        = 20;

  const inCorner = new Uint8Array(spl);
  const isMedium = new Uint8Array(spl);
  const isSlow   = new Uint8Array(spl);
  for (let i = 0; i < spl; i++) {
    if (curvature[i] > CORNER_THRESH) {
      for (let d = -MARGIN; d <= MARGIN; d++) inCorner[(i + d + spl) % spl] = 1;
    }
    if (curvature[i] > MEDIUM_THRESH) {
      for (let d = -MARGIN; d <= MARGIN; d++) isMedium[(i + d + spl) % spl] = 1;
    }
    if (curvature[i] > SLOW_THRESH) {
      for (let d = -MARGIN; d <= MARGIN; d++) isSlow[(i + d + spl) % spl] = 1;
    }
  }

  // Already user-painted runoff — skip those spline pts
  const userRunoffPts = new Set();
  const runoffSurfs = new Set(['gravel','sand','grass']);
  barrierSegments.filter(s => runoffSurfs.has(s.surface)).forEach(seg => {
    const sStart = Math.min(seg.from, seg.to) * 20;
    const sEnd   = Math.max(seg.from, seg.to) * 20;
    for (let i = sStart; i <= sEnd; i++) userRunoffPts.add(i);
  });

  // Helper: collect runs — wrap-around safe so first+last zones merge into one run
  function collectRuns(predFn) {
    const runs = [];
    let start = -1;
    for (let i = 0; i < spl; i++) {
      const active = predFn(i);
      if (active && start === -1) start = i;
      else if (!active && start !== -1) { runs.push({ from: start, to: i - 1 }); start = -1; }
    }
    if (start !== -1) runs.push({ from: start, to: spl - 1 });
    // Merge wrap: if last run ends at spl-1 AND first run starts at 0 → one continuous zone
    if (runs.length >= 2 && runs[0].from === 0 && runs[runs.length - 1].to === spl - 1) {
      const tail = runs.pop();
      runs[0] = { from: tail.from - spl, to: runs[0].to }; // negative from = wrapped
    }
    return runs;
  }

  function runPts(run) {
    const pts = [];
    for (let i = run.from; i <= run.to; i++) pts.push(splinePts[((i % spl) + spl) % spl]);
    return pts;
  }

  function dominantSign(run) {
    let s = 0;
    for (let i = run.from; i <= run.to; i++) s += cornerSign[i % spl];
    return s >= 0 ? 1 : -1; // +1=left turn (outside=right), -1=right turn
  }

  const TRANS = 14;

  const tarmacLane = { width: 13.0, center: 16.0, inner: 9.5, outer: 22.5 };
  const gravelLane = getSurfaceLane('gravel', 0);
  const sandLane   = getSurfaceLane('sand', 0);

  // Perimeter distances (world units from centreline)
  // Straight: TecPro at 24.9, Armco just inside at 24.4
  // Corner outside: Armco fans to just outside gravel/sand outer edge
  // Corner inside: Armco stays at 24.4 (same as straight)
  const PERIM       = 24.4;   // armco on straights and corner insides
  const PERIM_MD    = gravelLane.outer + 0.4;  // armco outside medium corner (~23.4)
  const PERIM_SL    = sandLane.outer   + 0.4;  // armco outside slow corner   (~23.4)
  const armcoLane   = getSurfaceLane('armco', 0);

  // Per-point dominant side (look 8 pts ahead for stability)
  const ptDom = new Int8Array(spl);
  for (let i = 0; i < spl; i++) {
    let s = 0;
    for (let d = 0; d < 8; d++) s += cornerSign[(i + d) % spl];
    ptDom[i] = s >= 0 ? 1 : -1;
  }

  // ── World-space normals (sign-propagated) ───────────────────────────────
  const _wpN = new Array(spl);
  {
    const _rn = splinePts.map((p, i) => {
      const pv = splinePts[Math.max(0, i-1)].pt;
      const nx = splinePts[Math.min(spl-1, i+1)].pt;
      const ax = i===0 ? splinePts[1].pt.x-splinePts[0].pt.x
               : i===spl-1 ? splinePts[spl-1].pt.x-splinePts[spl-2].pt.x : nx.x-pv.x;
      const ay = i===0 ? splinePts[1].pt.y-splinePts[0].pt.y
               : i===spl-1 ? splinePts[spl-1].pt.y-splinePts[spl-2].pt.y : nx.y-pv.y;
      const sl = Math.sqrt(ax*ax+ay*ay)||1;
      return { px: -ay/sl, py: ax/sl };
    });
    let _area = 0;
    for (let i=0; i<spl-1; i++)
      _area += splinePts[i].pt.x*splinePts[i+1].pt.y - splinePts[i+1].pt.x*splinePts[i].pt.y;
    const _ws = _area >= 0 ? -1 : 1;
    _wpN[0] = { px: _rn[0].px*_ws, py: _rn[0].py*_ws };
    for (let i=1; i<spl; i++) {
      const _d = _rn[i].px*_wpN[i-1].px + _rn[i].py*_wpN[i-1].py;
      _wpN[i] = { px: _rn[i].px*(_d>=0?1:-1), py: _rn[i].py*(_d>=0?1:-1) };
    }
  }

  // ── Grass-only barrier rule + merge-zone TecPro ──────────────────────────
  // Road + kerb occupies 0..9.2 wu from any centreline.
  // Grass starts at 9.2 wu — barriers must never land inside another road/kerb.
  // Strategy: for each proposed barrier endpoint (in world space), find the
  // closest OTHER centreline point (index-gap > MIN_SEP = different road).
  // If the endpoint is within ROAD_KERB_EDGE of that centreline it's on a road/kerb
  // → clamp the offset so the endpoint sits exactly at ROAD_KERB_EDGE from it.
  // Track every spline index where a clamp fires (per side) → draw TecPro there.
  const _MIN_SEP     = Math.max(8, Math.floor(spl * 0.04));
  const _ROAD_KERB   = 9.2;   // road (7) + flat kerb (1.1) + sausage (1.1)

  // Pre-build a coarse grid of centreline points for fast nearest-other lookup
  // (stride 2 — good enough, exact result not needed)
  function _closestOtherCL(bx, by, selfIdx) {
    let minD = Infinity;
    for (let j = 0; j < spl; j += 4) {
      const gap = Math.min(Math.abs(j - selfIdx), spl - Math.abs(j - selfIdx));
      if (gap < _MIN_SEP) continue;
      const dx = splinePts[j].pt.x - bx, dy = splinePts[j].pt.y - by;
      const d = Math.sqrt(dx*dx + dy*dy);
      if (d < minD) minD = d;
    }
    return minD;
  }

  // Returns { offset, clamped } — offset is safe, clamped=true if it was pulled back
  function _grassOnlyOffset(proposedOffset, sideNum, splIdx) {
    const i  = ((splIdx % spl) + spl) % spl;
    const cx = splinePts[i].pt.x, cy = splinePts[i].pt.y;
    const nx = _wpN[i].px * sideNum, ny = _wpN[i].py * sideNum;
    const bx = cx + nx * proposedOffset, by = cy + ny * proposedOffset;
    const d  = _closestOtherCL(bx, by, i);
    if (d >= _ROAD_KERB) return { offset: proposedOffset, clamped: false };
    // Pull back so endpoint is exactly _ROAD_KERB from the other centreline
    const safeOffset = Math.max(4, proposedOffset - (_ROAD_KERB - d));
    return { offset: safeOffset, clamped: true };
  }

  // mergeZone[side+1][i] = true where a barrier was clamped (merge zone)
  const _mergeZone = [new Uint8Array(spl), new Uint8Array(spl)]; // [0]=side-1, [1]=side+1

  function _applyGrassOnly(rawOffsets, sideNum, fromIdx) {
    return rawOffsets.map((o, k) => {
      const splIdx = fromIdx + k;
      const { offset, clamped } = _grassOnlyOffset(o, sideNum, splIdx);
      if (clamped) _mergeZone[sideNum > 0 ? 1 : 0][((splIdx % spl) + spl) % spl] = 1;
      return offset;
    });
  }

  // ── 1. ARMCO — full circuit, smooth per-point offset, no hard jumps ──
  [-1, 1].forEach(side => {
    const raw = Array.from({ length: spl }, (_, i) => {
      const outside = ptDom[i] === side;
      if (!inCorner[i] || !outside) return PERIM;
      if (isSlow[i])   return PERIM_SL;
      if (isMedium[i]) return PERIM_MD;
      return (PERIM + PERIM_MD) * 0.5;
    });
    const SK = TRANS; // was TRANS*2 — halved for perf
    const sm = new Float32Array(spl);
    for (let i = 0; i < spl; i++) {
      let sum = 0, wt = 0;
      for (let d = -SK; d <= SK; d++) {
        const w = SK + 1 - Math.abs(d);
        sum += raw[(i + d + spl) % spl] * w; wt += w;
      }
      sm[i] = sum / wt;
    }
    const safeOffsets = _applyGrassOnly(Array.from(sm), side, 0);
    const poly = buildOffsetScreenPolylineVarying(splinePts, side, safeOffsets);
    drawSurfacePattern(ctx, 'armco', poly, armcoLane, side, cam.zoom);
  });

  // ── 2. FAST CORNERS: tarmac runoff ──
  collectRuns(i => inCorner[i] && !isMedium[i] && !userRunoffPts.has(i)).forEach(run => {
    const pts = runPts(run);
    if (pts.length < 2) return;
    const ds = dominantSign(run);
    const rawOff = buildTransitionOffsets(pts.length, PERIM, tarmacLane.center, TRANS);
    const offsets = _applyGrassOnly(rawOff, ds, run.from);
    const poly = buildOffsetScreenPolylineVarying(pts, ds, offsets);
    const w = Math.max(4, tarmacLane.width * cam.zoom);
    ctx.lineWidth = w; ctx.strokeStyle = 'rgba(90,92,95,0.88)';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    _polyPath(ctx, poly); ctx.stroke();
    ctx.lineWidth = Math.max(1, w * 0.15); ctx.strokeStyle = 'rgba(60,62,65,0.45)';
    _polyPath(ctx, poly); ctx.stroke();
  });

  // ── 3. MEDIUM CORNERS: gravel ──
  collectRuns(i => isMedium[i] && !isSlow[i] && !userRunoffPts.has(i)).forEach(run => {
    const pts = runPts(run);
    if (pts.length < 2) return;
    const ds = dominantSign(run);
    const rawOff = buildTransitionOffsets(pts.length, PERIM, gravelLane.center, TRANS);
    const offsets = _applyGrassOnly(rawOff, ds, run.from);
    const poly = buildOffsetScreenPolylineVarying(pts, ds, offsets);
    drawSurfacePattern(ctx, 'gravel', poly, gravelLane, ds, cam.zoom);
  });

  // ── 4. SLOW CORNERS: sand ──
  collectRuns(i => isSlow[i] && !userRunoffPts.has(i)).forEach(run => {
    const pts = runPts(run);
    if (pts.length < 2) return;
    const ds = dominantSign(run);
    const rawOff = buildTransitionOffsets(pts.length, PERIM, sandLane.center, TRANS);
    const offsets = _applyGrassOnly(rawOff, ds, run.from);
    const poly = buildOffsetScreenPolylineVarying(pts, ds, offsets);
    drawSurfacePattern(ctx, 'sand', poly, sandLane, ds, cam.zoom);
  });

  // ── 5. RUMBLE STRIP — both sides on all corners ──
  const rumbleLane = getSurfaceLane('rumble', 0);
  collectRuns(i => inCorner[i]).forEach(run => {
    const pts = runPts(run);
    if (pts.length < 2) return;
    [-1, 1].forEach(s => {
      const poly = buildOffsetScreenPolyline(pts, s, rumbleLane.center);
      drawSurfacePattern(ctx, 'rumble', poly, rumbleLane, s, cam.zoom);
    });
  });

  // ── 6. SAUSAGE KERB — outside of slow corners only ──
  const sausageLane = getSurfaceLane('sausage', 0);
  collectRuns(i => isSlow[i]).forEach(run => {
    const pts = runPts(run);
    if (pts.length < 2) return;
    const ds = dominantSign(run);
    const poly = buildOffsetScreenPolyline(pts, ds, sausageLane.center);
    drawSurfacePattern(ctx, 'sausage', poly, sausageLane, ds, cam.zoom);
  });

  // ── 7. TECPRO — straights + merge zones ──────────────────────────────────
  // Normal TecPro on straights (unchanged).
  // Additionally, wherever _mergeZone fired on ANY side, draw TecPro at the
  // grass edge of the merge (offset = distance to other road's kerb edge).
  const tecproLane = getSurfaceLane('tecpro', 0);
  const tecproMinW = { ...tecproLane, width: Math.max(tecproLane.width, 3.0) };

  // Normal straights TecPro
  collectRuns(i => !inCorner[i]).forEach(run => {
    const pts = runPts(run);
    if (pts.length < 2) return;
    [-1, 1].forEach(side => {
      const poly = buildOffsetScreenPolyline(pts, side, tecproLane.center);
      drawSurfacePattern(ctx, 'tecpro', poly, tecproMinW, side, cam.zoom);
    });
  });

  // Merge-zone TecPro — runs of clamped indices on each side
  [-1, 1].forEach(side => {
    const mz = _mergeZone[side > 0 ? 1 : 0];
    // Collect contiguous runs of merge-zone indices
    let mStart = -1;
    const flushMerge = (mEnd) => {
      if (mStart < 0 || mEnd < mStart) return;
      const pts = [];
      for (let i = mStart; i <= mEnd; i++) pts.push(splinePts[i % spl]);
      if (pts.length < 2) return;
      // At each point in the merge zone, find the offset that places the barrier
      // exactly at the grass edge of the other road (_ROAD_KERB from its CL).
      const offsets = pts.map((p, k) => {
        const i = (mStart + k) % spl;
        const cx = p.pt.x, cy = p.pt.y;
        const nx = _wpN[i].px * side, ny = _wpN[i].py * side;
        // Binary search: find largest offset where endpoint is still >= _ROAD_KERB from other CL
        let lo = 4, hi = PERIM;
        for (let iter = 0; iter < 12; iter++) {
          const mid = (lo + hi) * 0.5;
          const bx = cx + nx * mid, by2 = cy + ny * mid;
          const d = _closestOtherCL(bx, by2, i);
          if (d >= _ROAD_KERB) lo = mid; else hi = mid;
        }
        return lo;
      });
      const poly = buildOffsetScreenPolylineVarying(pts, side, offsets);
      drawSurfacePattern(ctx, 'tecpro', poly, tecproMinW, side, cam.zoom);
    };
    for (let i = 0; i < spl; i++) {
      if (mz[i]) {
        if (mStart < 0) mStart = i;
      } else {
        if (mStart >= 0) { flushMerge(i - 1); mStart = -1; }
      }
    }
    if (mStart >= 0) flushMerge(spl - 1);
  });

  // ── 8. TYRE WALL — behind sand at slow corners ──
  const tyreLane = getSurfaceLane('tyrewall', 0);
  const tyreMinW = { ...tyreLane, width: Math.max(tyreLane.width, 2.5) };
  collectRuns(i => isSlow[i]).forEach(run => {
    const pts = runPts(run);
    if (pts.length < 2) return;
    const ds = dominantSign(run);
    const poly = buildOffsetScreenPolyline(pts, ds, tyreLane.center);
    drawSurfacePattern(ctx, 'tyrewall', poly, tyreMinW, ds, cam.zoom);
  });
}

function drawPermanentGrassBand() { /* removed — background already grass */ };


// ═══════════════════════════════════════════════════
// BARRIER SEGMENTS
// ═══════════════════════════════════════════════════
function drawBarrierSegments() {
  const splinePts = getCachedSpline(20);
  const N = splinePts.length;
  if (!barrierSegments || barrierSegments.length === 0) {
    if (tool === 'barrier' && barrierSelStart >= 0) drawBarrierHover(splinePts, N);
    return;
  }

  // Draw order: outermost first so inner layers paint over outer ones.
  // Priority tiers ensure runoff (gravel/sand/grass) always goes under kerbs/barriers.
  const DRAW_TIER = { grass:0, gravel:1, sand:1, flat_kerb:2, rumble:2, sausage:2, tecpro:3, armco:3, tyrewall:3 };
  const expanded = expandBarrierDrawItems(barrierSegments)
    .sort((a,b) => {
      const ta = DRAW_TIER[a.surface] ?? 2;
      const tb = DRAW_TIER[b.surface] ?? 2;
      if (ta !== tb) return ta - tb;  // lower tier (runoff) draws first
      const la = getSurfaceLane(a.surface, a.lane || 0);
      const lb = getSurfaceLane(b.surface, b.lane || 0);
      return lb.outer - la.outer;     // within same tier: outermost first
    });

  const labelKeys = new Set();
  let labelCount = 0;
  // FIX: track bounding boxes of placed labels to detect overlap
  const placedLabelRects = [];

  expanded.forEach((seg) => {
    const cfg = SURFACES[seg.surface];
    if (!cfg) return;

    const pts = getSplineSegmentPoints(splinePts, seg.from, seg.to);
    if (pts.length < 2) return;

    const lane = getSurfaceLane(seg.surface, seg.lane || 0);

    const screenPoly = buildOffsetScreenPolyline(pts, seg.sideNum, lane.center);
    drawSurfacePattern(ctx, seg.surface, screenPoly, lane, seg.sideNum, cam.zoom);

    const labelKey = `${seg.surface}:${seg.sideNum}:${seg.lane || 0}`;
    const shouldLabel = !seg.auto || (labelCount < 7 && !labelKeys.has(labelKey) && (seg.to - seg.from) >= Math.max(3, waypoints.length * 0.018));
    if (!shouldLabel) return;
    labelKeys.add(labelKey);
    labelCount++;

    const midPt = pts[Math.floor(pts.length / 2)];
    const ms = worldToScreen(midPt.pt.x, midPt.pt.y);
    const labelTxt = cfg.label.toUpperCase();
    const sideLabel = seg.sideNum < 0 ? ' L' : ' R';

    ctx.save();
    const fontSize = Math.max(9, Math.min(14, cam.zoom * 11));
    ctx.font = `bold ${fontSize}px "Barlow Condensed", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(labelTxt + sideLabel).width;
    const pad = 5;
    const labelW = tw + pad * 2 + 12;
    const labelH = fontSize * 1.4;

    // FIX: base Y — label above the midpoint offset by lane offset
    let candidateY = ms.y - Math.max(22, lane.labelOffset * cam.zoom);

    // FIX: nudge candidate Y in 18px steps until no overlap (max 8 attempts)
    const MAX_TRIES = 8;
    const STEP = 18;
    let placed = false;
    for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
      const rx = ms.x - labelW / 2;
      const ry = candidateY - labelH / 2;
      let overlaps = false;
      for (const r of placedLabelRects) {
        if (rx < r.x + r.w && rx + labelW > r.x && ry < r.y + r.h && ry + labelH > r.y) {
          overlaps = true; break;
        }
      }
      if (!overlaps) {
        placedLabelRects.push({ x: rx, y: ry, w: labelW, h: labelH });
        placed = true;
        break;
      }
      // Alternate nudging: up, up+step, down, etc.
      candidateY += (attempt % 2 === 0 ? -STEP : STEP * (attempt + 1));
    }
    if (!placed) { ctx.restore(); return; } // skip if can't fit

    const labelY = candidateY;

    // Pill background
    ctx.fillStyle = 'rgba(9,9,14,0.82)';
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(ms.x - tw/2 - pad, labelY - fontSize*0.7, tw + pad*2, fontSize*1.4, 4);
    } else {
      ctx.rect(ms.x - tw/2 - pad, labelY - fontSize*0.7, tw + pad*2, fontSize*1.4);
    }
    ctx.fill();

    // Colour dot
    ctx.fillStyle = cfg.dot;
    ctx.beginPath();
    ctx.arc(ms.x - tw/2 - pad/2 - 5, labelY, Math.max(3, fontSize*0.35), 0, Math.PI*2);
    ctx.fill();

    // Text
    ctx.fillStyle = '#f4f4f7';
    ctx.shadowColor = '#000'; ctx.shadowBlur = 3;
    ctx.fillText(labelTxt + sideLabel, ms.x + 3, labelY);
    ctx.shadowBlur = 0;
    ctx.restore();
  });

  if (tool === 'barrier' && barrierSelStart >= 0) drawBarrierHover(splinePts, N);
}

// ═══════════════════════════════════════════════════
// BARRIER INTERSECTION FILL — world space
//
// Works entirely in world coordinates so it's stable
// regardless of pan/zoom. Only converts to screen at
// the final draw step.
//
// Algorithm:
//   1. Build world-space offset polylines for every
//      hard barrier segment (armco/tecpro/tyrewall).
//   2. Test every pair for segment–segment intersections.
//   3. For each pair with exactly 2 crossing points,
//      build the equidistant spine: at each step along
//      ix1→ix2, find nearest pt on each poly and average
//      them → true midline between both roads.
//   4. Convert spine to screen and stroke solid TecPro.
// ═══════════════════════════════════════════════════
function _buildWorldOffsetPoly(pts, sideNum, offset) {
  // Identical normal logic to buildOffsetScreenPolyline but stays in world space
  const len = pts.length;
  if (len < 2) return [];
  const raw = pts.map((p, i) => {
    const prev = pts[Math.max(0, i-1)], next = pts[Math.min(len-1, i+1)];
    const ax = i===0 ? pts[1].pt.x-pts[0].pt.x : i===len-1 ? pts[len-1].pt.x-pts[len-2].pt.x : next.pt.x-prev.pt.x;
    const ay = i===0 ? pts[1].pt.y-pts[0].pt.y : i===len-1 ? pts[len-1].pt.y-pts[len-2].pt.y : next.pt.y-prev.pt.y;
    const sl = Math.sqrt(ax*ax+ay*ay)||1;
    return { px: -ay/sl, py: ax/sl };
  });
  let area = 0;
  for (let i = 0; i < len-1; i++) area += pts[i].pt.x*pts[i+1].pt.y - pts[i+1].pt.x*pts[i].pt.y;
  const ws = area >= 0 ? -1 : 1;
  const normals = new Array(len);
  normals[0] = { px: raw[0].px*ws, py: raw[0].py*ws };
  for (let i = 1; i < len; i++) {
    const dot = raw[i].px*normals[i-1].px + raw[i].py*normals[i-1].py;
    normals[i] = { px: raw[i].px*(dot>=0?1:-1), py: raw[i].py*(dot>=0?1:-1) };
  }
  return pts.map((p, i) => ({
    x: p.pt.x + normals[i].px * sideNum * offset,
    y: p.pt.y + normals[i].py * sideNum * offset,
  }));
}

function drawBarrierIntersectionFill() {
  if (waypoints.length < 3 || !barrierSegments.length) return;
  const splinePts = getCachedSpline(20);
  if (splinePts.length < 4) return;

  const HARD = new Set(['armco', 'tecpro', 'tyrewall']);

  // 1. Build world-space polys for all hard barrier segments
  const worldPolys = [];
  barrierSegments.forEach(seg => {
    if (!HARD.has(seg.surface)) return;
    const sides = (seg.side==='both'||!seg.side) ? [-1,1]
                : [(seg.side==='left'||seg.side===-1)?-1:1];
    sides.forEach(sideNum => {
      const pts = getSplineSegmentPoints(splinePts, seg.from, seg.to);
      if (pts.length < 2) return;
      const lane = getSurfaceLane(seg.surface, seg.lane||0);
      const poly = _buildWorldOffsetPoly(pts, sideNum, lane.center);
      if (poly.length >= 2) worldPolys.push(poly);
    });
  });

  if (worldPolys.length < 2) return;

  // 2. Segment–segment intersection in world space
  function intersect2D(p1, p2, p3, p4) {
    const d1x=p2.x-p1.x, d1y=p2.y-p1.y, d2x=p4.x-p3.x, d2y=p4.y-p3.y;
    const den = d1x*d2y - d1y*d2x;
    if (Math.abs(den) < 1e-10) return null;
    const t = ((p3.x-p1.x)*d2y - (p3.y-p1.y)*d2x) / den;
    const u = ((p3.x-p1.x)*d1y - (p3.y-p1.y)*d1x) / den;
    if (t<0||t>1||u<0||u>1) return null;
    return { x: p1.x+t*d1x, y: p1.y+t*d1y };
  }

  // 3. Collect up to 2 hits per poly pair
  const pairHits = new Map();
  for (let a = 0; a < worldPolys.length; a++) {
    for (let b = a+1; b < worldPolys.length; b++) {
      const pa = worldPolys[a], pb = worldPolys[b];
      const key = `${a}_${b}`;
      for (let i = 0; i < pa.length-1; i++) {
        if ((pairHits.get(key)||[]).length >= 2) break;
        for (let j = 0; j < pb.length-1; j++) {
          const hit = intersect2D(pa[i],pa[i+1],pb[j],pb[j+1]);
          if (hit) {
            if (!pairHits.has(key)) pairHits.set(key, []);
            pairHits.get(key).push({ pt: hit, a, b });
            if (pairHits.get(key).length >= 2) break;
          }
        }
      }
    }
  }

  pairHits.forEach(hits => {
    if (hits.length < 2) return;
    const ix1 = hits[0].pt, ix2 = hits[hits.length-1].pt;
    const pa = worldPolys[hits[0].a], pb = worldPolys[hits[0].b];

    // 4. Build equidistant spine in world space
    function nearestWPt(poly, qx, qy) {
      let best = poly[0], bestD = Infinity;
      for (const p of poly) {
        const d = (p.x-qx)**2 + (p.y-qy)**2;
        if (d < bestD) { bestD = d; best = p; }
      }
      return best;
    }

    const STEPS = 14;
    const spine = [];
    for (let s = 0; s <= STEPS; s++) {
      const f  = s / STEPS;
      const qx = ix1.x + (ix2.x-ix1.x)*f;
      const qy = ix1.y + (ix2.y-ix1.y)*f;
      const na = nearestWPt(pa, qx, qy);
      const nb = nearestWPt(pb, qx, qy);
      spine.push({ x: (na.x+nb.x)*0.5, y: (na.y+nb.y)*0.5 });
    }

    // 5. Convert to screen and stroke
    const gapW = Math.hypot(ix2.x-ix1.x, ix2.y-ix1.y);
    const strokeW = Math.max(4, gapW * cam.zoom * 0.18);

    ctx.save();
    ctx.lineWidth = strokeW;
    ctx.strokeStyle = 'rgba(20,70,220,1.0)';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    spine.forEach((p, i) => {
      const s = worldToScreen(p.x, p.y);
      i === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y);
    });
    ctx.stroke();
    ctx.restore();
  });
}

function expandBarrierDrawItems(segments) {
  const items = [];
  segments.forEach(seg => {
    const sides = (seg.side==='both'||!seg.side) ? [-1,1] : [(seg.side==='left'||seg.side===-1)?-1:1];
    sides.forEach(sideNum => items.push({ ...seg, sideNum }));
  });
  return mergeExpandedBarrierItems(items);
}

function mergeExpandedBarrierItems(items) {
  if (!items.length || !waypoints.length) return items;
  const gapTolerance = Math.max(1, Math.floor(waypoints.length * 0.01)); // tight: only truly adjacent
  const sorted = items.slice().sort((a,b) =>
    String(a.surface).localeCompare(String(b.surface)) ||
    a.sideNum - b.sideNum ||
    (a.lane || 0) - (b.lane || 0) ||
    a.from - b.from ||
    a.to - b.to
  );
  const merged = [];
  for (const item of sorted) {
    const prev = merged[merged.length - 1];
    const compatible = prev &&
      prev.surface === item.surface &&
      prev.sideNum === item.sideNum &&
      (prev.lane || 0) === (item.lane || 0) &&
      !!prev.auto === !!item.auto;
    if (compatible && item.from <= prev.to + gapTolerance) {
      prev.to = Math.max(prev.to, item.to);
    } else {
      merged.push({ ...item });
    }
  }
  return merged;
}

function getSplineSegmentPoints(splinePts, from, to) {
  // Support wrap-around segments (from > to means segment crosses start/finish)
  if (from <= to) {
    return splinePts.filter(p => p.seg >= from && p.seg <= to);
  } else {
    // Wrap: take from→end then start→to
    return [
      ...splinePts.filter(p => p.seg >= from),
      ...splinePts.filter(p => p.seg <= to),
    ];
  }
}

// Stable offset polyline — normals use sign propagation so they never
// flip at tight corners (the triangle/spike artefact from v7.1 is gone).
//
// Algorithm:
//   1. Compute raw perpendicular at each point from centred-difference tangent.
//   2. Seed point 0 using the shoelace winding of the full spline so the
//      first normal already points the right way for sideNum=+1.
//   3. Each subsequent normal dot-checks against its predecessor — if the
//      dot product is negative the raw normal is flipped to match.  This
//      ensures continuity around every bend without ever consulting a global
//      winding flag again.
//   4. Finally scale by sideNum (+1 right / -1 left) and offset.
function buildOffsetScreenPolyline(pts, sideNum, offset) {
  const len = pts.length;
  if (len < 2) return [];

  // Step 1 — raw perpendiculars from centred-difference tangent
  const raw = pts.map((p, i) => {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(len - 1, i + 1)];
    // Use forward difference at start, backward at end — avoids zero vector
    const ax = i === 0   ? pts[1].pt.x - pts[0].pt.x
             : i === len-1 ? pts[len-1].pt.x - pts[len-2].pt.x
             : next.pt.x - prev.pt.x;
    const ay = i === 0   ? pts[1].pt.y - pts[0].pt.y
             : i === len-1 ? pts[len-1].pt.y - pts[len-2].pt.y
             : next.pt.y - prev.pt.y;
    const sl = Math.sqrt(ax*ax + ay*ay) || 1;
    return { px: -ay / sl, py: ax / sl };  // left-hand perp
  });

  // Step 2 — shoelace winding of this segment's pts to seed sign
  let area = 0;
  for (let i = 0; i < len - 1; i++) {
    area += pts[i].pt.x * pts[i+1].pt.y - pts[i+1].pt.x * pts[i].pt.y;
  }
  // CCW (area>0) → raw perp points left → sideNum=+1 means right → flip seed
  const windSign = area >= 0 ? -1 : 1;

  // Step 3 — propagate sign forward so no flip ever jumps across a bend
  const normals = new Array(len);
  normals[0] = { px: raw[0].px * windSign, py: raw[0].py * windSign };
  for (let i = 1; i < len; i++) {
    const dot = raw[i].px * normals[i-1].px + raw[i].py * normals[i-1].py;
    const s   = dot >= 0 ? 1 : -1;
    normals[i] = { px: raw[i].px * s, py: raw[i].py * s };
  }

  // Step 4 — apply sideNum and offset, convert to screen
  return pts.map((p, i) => {
    const nx = normals[i].px * sideNum;
    const ny = normals[i].py * sideNum;
    return worldToScreen(p.pt.x + nx * offset, p.pt.y + ny * offset);
  });
}

// Variant: per-point offsets array — smooth barrier distance transitions.
function buildOffsetScreenPolylineVarying(pts, sideNum, offsets) {
  const len = pts.length;
  if (len < 2) return [];
  const raw = pts.map((p, i) => {
    const prev = pts[Math.max(0, i-1)], next = pts[Math.min(len-1, i+1)];
    const ax = i===0 ? pts[1].pt.x-pts[0].pt.x : i===len-1 ? pts[len-1].pt.x-pts[len-2].pt.x : next.pt.x-prev.pt.x;
    const ay = i===0 ? pts[1].pt.y-pts[0].pt.y : i===len-1 ? pts[len-1].pt.y-pts[len-2].pt.y : next.pt.y-prev.pt.y;
    const sl = Math.sqrt(ax*ax+ay*ay)||1;
    return { px: -ay/sl, py: ax/sl };
  });
  let area = 0;
  for (let i=0; i<len-1; i++) area += pts[i].pt.x*pts[i+1].pt.y - pts[i+1].pt.x*pts[i].pt.y;
  const windSign = area >= 0 ? -1 : 1;
  const normals = new Array(len);
  normals[0] = { px: raw[0].px*windSign, py: raw[0].py*windSign };
  for (let i=1; i<len; i++) {
    const dot = raw[i].px*normals[i-1].px + raw[i].py*normals[i-1].py;
    const s = dot >= 0 ? 1 : -1;
    normals[i] = { px: raw[i].px*s, py: raw[i].py*s };
  }
  return pts.map((p, i) => {
    const off = offsets[i];
    return worldToScreen(p.pt.x + normals[i].px*sideNum*off, p.pt.y + normals[i].py*sideNum*off);
  });
}

function easeInOut(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }

// Per-point offsets: ease nearOffset→farOffset at start, hold, ease back at end.
function buildTransitionOffsets(count, nearOffset, farOffset, transPts) {
  const tp = Math.min(transPts, Math.floor(count / 2));
  return Array.from({ length: count }, (_, i) => {
    if (i < tp) return nearOffset + (farOffset - nearOffset) * easeInOut(i / tp);
    if (i > count - 1 - tp) return nearOffset + (farOffset - nearOffset) * easeInOut((count - 1 - i) / tp);
    return farOffset;
  });
}

function drawBarrierHover(splinePts, N) {
  const hoverSeg = getSegmentNear(mouseWorld.x, mouseWorld.y);
  if (hoverSeg < 0) return;
  const from = Math.min(barrierSelStart, hoverSeg);
  const to   = Math.max(barrierSelStart, hoverSeg);
  const pts  = splinePts.filter(p => p.seg>=from && p.seg<=to);
  if (pts.length < 2) return;
  const sides = barrierSide==='both' ? [-1,1] : [barrierSide==='left' ? -1 : 1];
  const lane = getSurfaceLane(surface, 0);
  ctx.save(); ctx.globalAlpha = 0.55;
  sides.forEach(s => {
    const screenPoly = buildOffsetScreenPolyline(pts, s, lane.center);
    drawSurfacePattern(ctx, surface, screenPoly, lane, s, cam.zoom);
  });
  ctx.restore();
}

// ═══════════════════════════════════════════════════
// CENTRELINE
// ═══════════════════════════════════════════════════
function drawCentreline() {
  const n = waypoints.length;
  ctx.strokeStyle = 'rgba(232,255,71,0.22)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4,8]);
  ctx.beginPath();
  for (let i=0; i<n; i++) {
    const p0=waypoints[(i-1+n)%n],p1=waypoints[i],p2=waypoints[(i+1)%n],p3=waypoints[(i+2)%n];
    for (let j=0; j<8; j++) {
      const pt=catmullPoint(p0,p1,p2,p3,j/8);
      const s =worldToScreen(pt.x,pt.y);
      (i===0&&j===0) ? ctx.moveTo(s.x,s.y) : ctx.lineTo(s.x,s.y);
    }
  }
  ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
}
