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
  rumble:    { inner:  8.1, outer:  8.6, labelOffset: 12 },
  flat_kerb: { inner:  7.0, outer:  8.1, labelOffset: 12 },
  sausage:   { inner:  7.0, outer:  8.1, labelOffset: 14 },  // apex of flat kerb zone
  grass:     { inner:  8.1, outer: 26.0, labelOffset: 22 },
  gravel:    { inner:  9.2, outer: 23.0, labelOffset: 20 },
  sand:      { inner:  9.2, outer: 23.0, labelOffset: 20 },
  tyrewall:  { inner: 23.0, outer: 23.9, labelOffset: 25 },
  armco:     { inner: 23.9, outer: 24.9, labelOffset: 28 },
  tecpro:    { inner: 23.9, outer: 25.8, labelOffset: 27 },
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
// RENDER
// ═══════════════════════════════════════════════════
function render() {
  if (typeof preview3dActive !== 'undefined' && preview3dActive) return;
  const W = mainCanvas.width, H = mainCanvas.height;

  // ── Background — solid grass green ──
  bgCtx.clearRect(0, 0, W, H);
  bgCtx.fillStyle = '#2d5a1b';
  bgCtx.fillRect(0, 0, W, H);
  // Subtle texture grid on top (very faint)
  bgCtx.strokeStyle = 'rgba(0,0,0,0.08)';
  bgCtx.lineWidth = 1;
  const gs = 50 * cam.zoom;
  const ox = (-cam.x * cam.zoom + W / 2) % gs;
  const oy = (-cam.y * cam.zoom + H / 2) % gs;
  for (let x=ox; x<W; x+=gs) { bgCtx.beginPath(); bgCtx.moveTo(x,0); bgCtx.lineTo(x,H); bgCtx.stroke(); }
  for (let y=oy; y<H; y+=gs) { bgCtx.beginPath(); bgCtx.moveTo(0,y); bgCtx.lineTo(W,y); bgCtx.stroke(); }

  // ── Background image ──
  if (bgImage) {
    const s = worldToScreen(bgImageBounds.x, bgImageBounds.y);
    bgCtx.globalAlpha = 0.55;
    bgCtx.drawImage(bgImage, s.x, s.y, bgImageBounds.w * cam.zoom, bgImageBounds.h * cam.zoom);
    bgCtx.globalAlpha = 1;
  }

  ctx.clearRect(0, 0, W, H);

  // ── Paint layers ──
  const orderedPaint = paintLayers.slice().sort((a,b) => {
    const ar = a.rank !== undefined ? a.rank : (SURFACE_LANES[a.surface] ? SURFACE_LANES[a.surface].inner : 99);
    const br = b.rank !== undefined ? b.rank : (SURFACE_LANES[b.surface] ? SURFACE_LANES[b.surface].inner : 99);
    return br - ar;
  });
  for (const p of orderedPaint) {
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
    drawPermanentGrassBand();
    drawAutoSurfaces();      // auto: TecPro straights, gravel corners, rumble, sausage, tyrewall
    drawBarrierSegments();   // user-placed segments paint on top of auto surfaces
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

// ═══════════════════════════════════════════════════
// TRACK ROAD
// ═══════════════════════════════════════════════════
function drawTrackRoad_REMOVED_COMPACT_DUPLICATE() {
  const splinePts = buildSplinePoints(16);
  if (splinePts.length < 2) return;
  const n = waypoints.length;
  const screenPts = splinePts.map(p => ({ s: worldToScreen(p.pt.x, p.pt.y), seg: p.seg }));
  const trackW = Math.max(6, 14 * cam.zoom);
  const kerbW  = Math.max(2, 3.5 * cam.zoom);
  const spl = splinePts.length;

  // ── Curvature per spline point ──
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
  const CORNER_T = 0.010, SLOW_T = 0.028, MARG = 10;
  const inCornerRoad = new Uint8Array(spl);
  const isSlowRoad   = new Uint8Array(spl);
  for (let i=0; i<spl; i++) {
    if (curvature[i]>CORNER_T) for(let d=-MARG;d<=MARG;d++) inCornerRoad[(i+d+spl)%spl]=1;
    if (curvature[i]>SLOW_T)   for(let d=-MARG;d<=MARG;d++) isSlowRoad[(i+d+spl)%spl]=1;
  }

  // ── 1. OUTER FLAT KERB — full circuit, both sides, under asphalt ──
  // Real tracks: red/white alternating kerb runs the entire circuit length.
  // Width is consistent — asphalt paints over the centre leaving only the kerb band.
  let dist = 0;
  for (let i=1; i<screenPts.length; i++) {
    const a=screenPts[i-1].s, b=screenPts[i].s;
    dist += Math.hypot(b.x-a.x, b.y-a.y);
    const phase = Math.floor(dist / 16);
    ctx.strokeStyle = phase%2===0 ? 'rgba(215,25,25,0.90)' : 'rgba(245,245,245,0.90)';
    ctx.lineWidth = trackW*2 + kerbW*2;
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
  }

  // ── 2. ASPHALT — dark grey ──
  ctx.strokeStyle = 'rgba(48,50,54,0.97)';
  ctx.lineWidth = trackW*2;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  screenPts.forEach((p,i) => i===0 ? ctx.moveTo(p.s.x,p.s.y) : ctx.lineTo(p.s.x,p.s.y));
  ctx.closePath(); ctx.stroke();

  // Aggregate texture overlay
  ctx.strokeStyle = 'rgba(72,74,80,0.28)';
  ctx.lineWidth = trackW*2 - 2;
  ctx.setLineDash([3,8]); ctx.lineDashOffset = 4;
  ctx.beginPath();
  screenPts.forEach((p,i) => i===0 ? ctx.moveTo(p.s.x,p.s.y) : ctx.lineTo(p.s.x,p.s.y));
  ctx.closePath(); ctx.stroke();
  ctx.setLineDash([]);

  // Rubber marbling before corners
  ctx.save(); ctx.lineCap = 'round';
  for (let i=1; i<spl; i++) {
    if (!inCornerRoad[i] && inCornerRoad[(i+1)%spl]) {
      for (let k=Math.max(0,i-8); k<=i; k++) {
        const fade=(k-(i-8))/8;
        ctx.globalAlpha=0.07*fade;
        ctx.strokeStyle='rgba(20,20,20,1)';
        ctx.lineWidth=trackW*2*0.7;
        if (k>0) { ctx.beginPath(); ctx.moveTo(screenPts[k-1].s.x,screenPts[k-1].s.y); ctx.lineTo(screenPts[k].s.x,screenPts[k].s.y); ctx.stroke(); }
      }
    }
  }
  ctx.globalAlpha=1; ctx.restore();

  // ── 3. WHITE TRACK LIMIT LINES — very thin, straights only, suppressed at corners ──
  const edgeW = Math.max(0.8, 1.2 * cam.zoom);
  ctx.lineWidth = edgeW;
  ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
  [-1, 1].forEach(side => {
    for (let i = 0; i < spl - 1; i++) {
      if (inCornerRoad[i] || inCornerRoad[i+1]) continue; // skip corners entirely
      const pa = buildOffsetScreenPolyline([splinePts[i], splinePts[i+1]], side, TRACK_HALF_WIDTH);
      if (pa.length < 2) continue;
      ctx.strokeStyle = 'rgba(255,255,255,0.90)';
      ctx.beginPath(); ctx.moveTo(pa[0].x,pa[0].y); ctx.lineTo(pa[1].x,pa[1].y); ctx.stroke();
    }
  });

  // ── 4. RAISED SAUSAGE KERB — outside of slow corners, clean lifted look ──
  for (let i = 1; i < spl; i++) {
    if (!isSlowRoad[i]) continue;
    const ds = cornerSign[i] >= 0 ? 1 : -1;
    const prev = splinePts[(i-1+spl)%spl], curr = splinePts[i];
    const pa = buildOffsetScreenPolyline([prev, curr], ds, TRACK_HALF_WIDTH + 0.6);
    if (pa.length < 2) continue;
    // Shadow
    ctx.strokeStyle = 'rgba(40,0,0,0.55)';
    ctx.lineWidth = Math.max(2.5, kerbW * 1.4);
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(pa[0].x+0.8,pa[0].y+0.8); ctx.lineTo(pa[1].x+0.8,pa[1].y+0.8); ctx.stroke();
    // Main dark red body
    ctx.strokeStyle = 'rgba(165,8,8,1.0)';
    ctx.lineWidth = Math.max(2, kerbW * 1.2);
    ctx.beginPath(); ctx.moveTo(pa[0].x,pa[0].y); ctx.lineTo(pa[1].x,pa[1].y); ctx.stroke();
    // Top highlight
    ctx.strokeStyle = 'rgba(240,60,60,0.45)';
    ctx.lineWidth = Math.max(0.8, kerbW * 0.35);
    ctx.beginPath(); ctx.moveTo(pa[0].x,pa[0].y); ctx.lineTo(pa[1].x,pa[1].y); ctx.stroke();
  }

  // ── 5. INSIDE KERBS — red/white flat painted, inside of corners ──
  const insideKerbW = Math.max(1.5, kerbW * 0.65);
  const insideOffset = TRACK_HALF_WIDTH - 1.0;
  let dist2 = 0;
  for (let i = 1; i < spl; i++) {
    if (!inCornerRoad[i]) { dist2 += 2; continue; }
    const side = cornerSign[i] >= 0 ? -1 : 1; // inside = opposite to outside
    const prev = splinePts[(i-1+spl)%spl], curr = splinePts[i];
    const pa = buildOffsetScreenPolyline([prev, curr], side, insideOffset);
    if (pa.length < 2) continue;
    dist2 += Math.hypot(pa[1].x-pa[0].x, pa[1].y-pa[0].y);
    const phase = Math.floor(dist2 / 10);
    ctx.strokeStyle = phase%2===0 ? 'rgba(200,18,18,0.88)' : 'rgba(238,238,238,0.88)';
    ctx.lineWidth = insideKerbW;
    ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(pa[0].x,pa[0].y); ctx.lineTo(pa[1].x,pa[1].y); ctx.stroke();
  }

  // ── 6. BRAKING MARKERS ──
  if (cam.zoom > 0.4) {
    const markerColors = ['#ff2222','#ffdd00','#ffffff'];
    const markerDists  = [24, 16, 8];
    for (let i = 1; i < spl; i++) {
      if (!inCornerRoad[i] || inCornerRoad[(i-1+spl)%spl]) continue;
      const ds2 = dominantSignAt(i, cornerSign, spl);
      markerDists.forEach((offset, mi) => {
        const idx = ((i - offset) + spl) % spl;
        const pt  = splinePts[idx];
        const side = -ds2;
        const mPoly = buildOffsetScreenPolyline(
          [splinePts[(idx-1+spl)%spl], pt, splinePts[(idx+1)%spl]], side, TRACK_HALF_WIDTH + 2.5
        );
        if (mPoly.length < 2) return;
        const mp = mPoly[1];
        const mw = Math.max(2, 3*cam.zoom), mh = Math.max(4, 7*cam.zoom);
        ctx.save();
        ctx.fillStyle = markerColors[mi]; ctx.strokeStyle = '#000'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.rect(mp.x-mw/2, mp.y-mh/2, mw, mh);
        ctx.fill(); ctx.stroke();
        ctx.restore();
      });
    }
  }

  // ── 7. PIT LANE STUB ──
  if (startingPointIdx < waypoints.length && n >= 4) {
    const sfIdx = startingPointIdx * 16;
    const sfPt  = splinePts[Math.min(sfIdx, spl-1)];
    const nxt = splinePts[Math.min(sfIdx+4, spl-1)].pt;
    const prv = splinePts[Math.max(sfIdx-4, 0)].pt;
    const tdx = nxt.x-prv.x, tdy = nxt.y-prv.y;
    const tlen = Math.sqrt(tdx*tdx+tdy*tdy)||1;
    const pitSide = 1, pitOffset = TRACK_HALF_WIDTH + 4.5, pitLen = 22;
    const pitPts = [];
    for (let k=-2; k<=2; k++) {
      const frac=k/2;
      pitPts.push(worldToScreen(
        sfPt.pt.x + tdx/tlen*frac*pitLen/2 - tdy/tlen*pitSide*pitOffset,
        sfPt.pt.y + tdy/tlen*frac*pitLen/2 + tdx/tlen*pitSide*pitOffset
      ));
    }
    ctx.save();
    ctx.strokeStyle='rgba(55,57,62,0.92)'; ctx.lineWidth=Math.max(4,trackW*0.55);
    ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.beginPath(); pitPts.forEach((p,i) => i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y)); ctx.stroke();
    ctx.strokeStyle='rgba(255,255,255,0.75)'; ctx.lineWidth=Math.max(1,edgeW*0.8);
    ctx.beginPath(); pitPts.forEach((p,i) => i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y)); ctx.stroke();
    const pitEntry=pitPts[0], pitExit=pitPts[pitPts.length-1];
    const te1=buildOffsetScreenPolyline([splinePts[Math.max(sfIdx-2,0)],sfPt],pitSide,TRACK_HALF_WIDTH);
    const te2=buildOffsetScreenPolyline([sfPt,splinePts[Math.min(sfIdx+2,spl-1)]],pitSide,TRACK_HALF_WIDTH);
    ctx.strokeStyle='rgba(55,57,62,0.75)'; ctx.lineWidth=Math.max(2,trackW*0.3); ctx.setLineDash([3,3]);
    if(te1.length){ctx.beginPath();ctx.moveTo(te1[0].x,te1[0].y);ctx.lineTo(pitEntry.x,pitEntry.y);ctx.stroke();}
    if(te2.length){ctx.beginPath();ctx.moveTo(te2[te2.length-1].x,te2[te2.length-1].y);ctx.lineTo(pitExit.x,pitExit.y);ctx.stroke();}
    ctx.setLineDash([]); ctx.restore();
  }

  // ── 8. START/FINISH LINE — chequered ──
  if (startingPointIdx < waypoints.length) {
    const i1=Math.min(startingPointIdx*16,screenPts.length-1);
    const i2=Math.min(i1+1,screenPts.length-1);
    if (i2>i1) {
      const sfPt=worldToScreen(waypoints[startingPointIdx].x,waypoints[startingPointIdx].y);
      const dx=screenPts[i2].s.x-screenPts[i1].s.x, dy=screenPts[i2].s.y-screenPts[i1].s.y;
      const len=Math.hypot(dx,dy)||1;
      const px=-dy/len*(trackW+4), py=dx/len*(trackW+4);
      const sq=(trackW+4)/2;
      ctx.save();
      for(let row=0;row<2;row++) for(let col=0;col<4;col++) {
        const t=(col/4-0.5)*2;
        const cx2=sfPt.x+px*t+dx/len*row*sq*0.6, cy2=sfPt.y+py*t+dy/len*row*sq*0.6;
        ctx.fillStyle=(row+col)%2===0?'#fff':'#111';
        ctx.beginPath(); ctx.rect(cx2-sq*0.48,cy2-sq*0.48,sq*0.9,sq*0.9); ctx.fill();
      }
      ctx.restore();
    }
  }
}

function drawTrackRoad() {
  const splinePts = buildSplinePoints(16);
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

  // ── Outer kerb chevrons (wide, under asphalt) ──
  let dist = 0;
  for (let i=1; i<screenPts.length; i++) {
    const a=screenPts[i-1].s, b=screenPts[i].s;
    dist += Math.hypot(b.x-a.x, b.y-a.y);
    const phase = Math.floor(dist / 18);
    ctx.strokeStyle = phase%2===0 ? 'rgba(220,30,30,0.85)' : 'rgba(240,240,240,0.85)';
    ctx.lineWidth = trackW*2 + kerbW*2;
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
  }

  // ── Asphalt — dark grey with subtle aggregate texture ──
  ctx.strokeStyle = 'rgba(48,50,54,0.97)';
  ctx.lineWidth = trackW*2;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  screenPts.forEach((p,i) => i===0 ? ctx.moveTo(p.s.x,p.s.y) : ctx.lineTo(p.s.x,p.s.y));
  ctx.closePath(); ctx.stroke();

  // Aggregate texture — very faint lighter overlay
  ctx.strokeStyle = 'rgba(72,74,80,0.30)';
  ctx.lineWidth = trackW*2 - 2;
  ctx.setLineDash([3, 7]); ctx.lineDashOffset = 4;
  ctx.beginPath();
  screenPts.forEach((p,i) => i===0 ? ctx.moveTo(p.s.x,p.s.y) : ctx.lineTo(p.s.x,p.s.y));
  ctx.closePath(); ctx.stroke();
  ctx.setLineDash([]);

  // Rubber marbling — dark streaks in braking zones before corners
  ctx.save();
  ctx.lineCap = 'round';
  for (let i=1; i<spl; i++) {
    if (!inCornerRoad[i] && inCornerRoad[(i+1)%spl]) {
      // This is just before a corner — add rubber buildup over ~8 pts before
      for (let k=Math.max(0,i-8); k<=i; k++) {
        const p=screenPts[k].s, nx=screenPts[k].s, fade=(k-(i-8))/8;
        ctx.globalAlpha=0.08*fade;
        ctx.strokeStyle='rgba(20,20,20,1)';
        ctx.lineWidth=trackW*2*0.7;
        if (k>0) { ctx.beginPath(); ctx.moveTo(screenPts[k-1].s.x,screenPts[k-1].s.y); ctx.lineTo(screenPts[k].s.x,screenPts[k].s.y); ctx.stroke(); }
      }
    }
  }
  ctx.globalAlpha=1; ctx.restore();

  // ── White track edge lines — continuous both sides ──
  // The most visually defining feature of any real circuit aerial view
  const edgeW = Math.max(1.5, 2.2 * cam.zoom);
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = edgeW;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // Build offset polylines for both edges
  const leftEdge  = buildOffsetScreenPolyline(splinePts, -1, TRACK_HALF_WIDTH);
  const rightEdge = buildOffsetScreenPolyline(splinePts,  1, TRACK_HALF_WIDTH);
  [leftEdge, rightEdge].forEach(edge => {
    ctx.beginPath();
    edge.forEach((p,i) => i===0 ? ctx.moveTo(p.x,p.y) : ctx.lineTo(p.x,p.y));
    ctx.closePath(); ctx.stroke();
  });

  // ── Inside kerbs — small red/white painted kerb on inside of corners ──
  // Real circuits have kerbs on BOTH sides; inside kerb is narrower/flatter
  const insideKerbW = Math.max(1.5, kerbW * 0.7);
  const insideOffset = TRACK_HALF_WIDTH - 1.2; // just inside track edge
  let dist2 = 0;
  for (let i = 1; i < spl; i++) {
    if (!inCornerRoad[i]) { dist2 += 2; continue; }
    const side = -cornerSign[i]; // inside = opposite of turn direction
    const prev = splinePts[(i-1+spl)%spl], curr = splinePts[i];
    const pa = buildOffsetScreenPolyline([prev, curr], side, insideOffset);
    if (pa.length < 2) continue;
    dist2 += Math.hypot(pa[1].x-pa[0].x, pa[1].y-pa[0].y);
    const phase = Math.floor(dist2 / 12);
    ctx.strokeStyle = phase%2===0 ? 'rgba(210,20,20,0.90)' : 'rgba(240,240,240,0.90)';
    ctx.lineWidth = insideKerbW;
    ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(pa[0].x,pa[0].y); ctx.lineTo(pa[1].x,pa[1].y); ctx.stroke();
  }

  // ── Braking markers — coloured boards on outside before heavy braking corners ──
  // 300m / 200m / 100m boards; appear on outside of track at straight→corner transitions
  if (cam.zoom > 0.4) {
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
    // Pit lane white edge lines
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = Math.max(1, edgeW * 0.8);
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
      const px=-dy/len*(trackW+4), py=dx/len*(trackW+4);
      // Chequered pattern — 4 squares across
      const sq = (trackW+4) / 2;
      ctx.save();
      for (let row=0; row<2; row++) {
        for (let col=0; col<4; col++) {
          const t = (col/4 - 0.5) * 2;
          const cx2 = sfPt.x + px*t + dx/len*row*sq*0.6;
          const cy2 = sfPt.y + py*t + dy/len*row*sq*0.6;
          ctx.fillStyle = (row+col)%2===0 ? '#fff' : '#111';
          ctx.beginPath();
          ctx.rect(cx2 - sq*0.48, cy2 - sq*0.48, sq*0.9, sq*0.9);
          ctx.fill();
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

    // ── FLAT KERB — bold alternating red/white blocks ───────────────
    case 'flat_kerb': {
      const arcs = _arcLengths(poly);
      const total = arcs[arcs.length - 1];
      const blockLen = Math.max(5, 12 * zoom);
      let dist = 0, block = 0;
      ctx.lineWidth = w;
      while (dist < total) {
        const end = Math.min(dist + blockLen, total);
        const steps = 4;
        ctx.beginPath();
        for (let s = 0; s <= steps; s++) {
          const p = _polyAtDist(poly, arcs, dist + (end - dist) * s / steps);
          s === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = block % 2 === 0 ? 'rgba(220,25,25,1.0)' : 'rgba(252,252,252,1.0)';
        ctx.stroke();
        dist = end; block++;
      }
      break;
    }

    // ── RUMBLE STRIP — vivid orange/white ──────────────────────────
    case 'rumble': {
      const arcs = _arcLengths(poly);
      const total = arcs[arcs.length - 1];
      const blockLen = Math.max(4, 8 * zoom);
      let dist = 0, block = 0;
      ctx.lineWidth = w;
      while (dist < total) {
        const end = Math.min(dist + blockLen, total);
        const steps = 3;
        ctx.beginPath();
        for (let s = 0; s <= steps; s++) {
          const p = _polyAtDist(poly, arcs, dist + (end - dist) * s / steps);
          s === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = block % 2 === 0 ? 'rgba(240,100,0,1.0)' : 'rgba(248,248,248,1.0)';
        ctx.stroke();
        dist = end; block++;
      }
      break;
    }

    // ── SAUSAGE KERB — fat yellow ridge with white highlight ────────
    case 'sausage': {
      // Dark outline for definition against grass
      ctx.lineWidth = w * 1.4;
      ctx.strokeStyle = 'rgba(160,120,0,0.7)';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      _polyPath(ctx, poly); ctx.stroke();
      // Main yellow body
      ctx.lineWidth = w * 1.2;
      ctx.strokeStyle = 'rgba(248,200,20,1.0)';
      _polyPath(ctx, poly); ctx.stroke();
      // White specular ridge on top
      ctx.lineWidth = Math.max(1.5, w * 0.4);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      _polyPath(ctx, poly); ctx.stroke();
      ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
      break;
    }

    // ── GRAVEL — wide tan/brown trap with coarse stipple ────────────
    case 'gravel': {
      // Soft blended edge — wider semi-transparent halo so gravel fades into grass
      ctx.lineWidth = w * 1.28;
      ctx.strokeStyle = 'rgba(145,128,95,0.32)';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      _polyPath(ctx, poly); ctx.stroke();
      ctx.lineWidth = w * 1.12;
      ctx.strokeStyle = 'rgba(155,138,105,0.55)';
      _polyPath(ctx, poly); ctx.stroke();
      // Wide base — full runoff width, solid fill
      ctx.lineWidth = w;
      ctx.strokeStyle = 'rgba(168,152,118,1.0)'; // greyer-brown = gravel
      _polyPath(ctx, poly); ctx.stroke();
      // Coarse stipple dots scattered across full width
      const arcs = _arcLengths(poly);
      const total = arcs[arcs.length - 1];
      const spacing = Math.max(4, 7 * zoom);
      const halfW = w * 0.44;
      for (let d = spacing * 0.5; d < total; d += spacing) {
        const p = _polyAtDist(poly, arcs, d);
        const perp = { x: -p.ty, y: p.tx };
        // Scatter dots across the full width using multiple offsets
        for (let row = -1; row <= 1; row++) {
          const off = row * halfW * 0.6 + (Math.sin(d * 1.7 + row) * 0.25) * halfW;
          const r = Math.max(1.2, (1.4 + Math.sin(d * 3.3 + row) * 0.4) * zoom);
          const alpha = 0.5 + Math.sin(d * 2.1 + row * 1.3) * 0.2;
          ctx.fillStyle = 'rgba(118,100,72,' + alpha + ')';
          ctx.beginPath();
          ctx.arc(p.x + perp.x * off, p.y + perp.y * off, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.lineCap = 'butt';
      break;
    }

    // ── SAND — wide warm-yellow trap with fine grain stipple ────────
    case 'sand': {
      // Soft blended edge — halo that fades sand into surrounding grass
      ctx.lineWidth = w * 1.28;
      ctx.strokeStyle = 'rgba(195,175,100,0.30)';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      _polyPath(ctx, poly); ctx.stroke();
      ctx.lineWidth = w * 1.12;
      ctx.strokeStyle = 'rgba(210,188,115,0.52)';
      _polyPath(ctx, poly); ctx.stroke();
      ctx.lineWidth = w;
      ctx.strokeStyle = 'rgba(235,215,145,1.0)'; // warm yellow = sand
      _polyPath(ctx, poly); ctx.stroke();
      // Fine grain — smaller dots, lighter colour than gravel
      const arcs = _arcLengths(poly);
      const total = arcs[arcs.length - 1];
      const spacing = Math.max(3.5, 6 * zoom);
      const halfW = w * 0.44;
      for (let d = spacing * 0.5; d < total; d += spacing) {
        const p = _polyAtDist(poly, arcs, d);
        const perp = { x: -p.ty, y: p.tx };
        for (let row = -1; row <= 1; row++) {
          const off = row * halfW * 0.6 + (Math.cos(d * 2.3 + row) * 0.2) * halfW;
          const r = Math.max(0.9, (1.0 + Math.cos(d * 4.1 + row) * 0.35) * zoom);
          const alpha = 0.42 + Math.cos(d * 1.9 + row * 1.1) * 0.18;
          ctx.fillStyle = 'rgba(178,150,82,' + alpha + ')';
          ctx.beginPath();
          ctx.arc(p.x + perp.x * off, p.y + perp.y * off, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
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

    // ── ARMCO — W-beam guardrail, two rails with corrugation ticks ──
    case 'armco': {
      const arcs = _arcLengths(poly);
      const total = arcs[arcs.length - 1];
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // Shadow
      ctx.lineWidth = w + 4;
      ctx.strokeStyle = 'rgba(20,20,20,0.55)';
      _polyPath(ctx, poly); ctx.stroke();
      // Two W-beam rail bodies (draw as two parallel thick stripes)
      for (const [col, lw] of [['rgba(160,180,200,1.0)', w], ['rgba(235,245,255,0.90)', Math.max(2, w*0.42)]]) {
        ctx.lineWidth = lw;
        ctx.strokeStyle = col;
        _polyPath(ctx, poly); ctx.stroke();
      }
      // Corrugation ticks — denser and taller than before to suggest W-profile
      const tickSpacing = Math.max(3, 5 * zoom);
      const tickH = Math.max(2.5, w * 0.75);
      ctx.strokeStyle = 'rgba(60,80,100,0.90)';
      ctx.lineWidth = Math.max(1.5, zoom * 1.2);
      ctx.lineCap = 'butt';
      for (let d = 0; d < total; d += tickSpacing) {
        const p = _polyAtDist(poly, arcs, d);
        const perp = { x: -p.ty, y: p.tx };
        ctx.beginPath();
        ctx.moveTo(p.x - perp.x * tickH, p.y - perp.y * tickH);
        ctx.lineTo(p.x + perp.x * tickH, p.y + perp.y * tickH);
        ctx.stroke();
      }
      break;
    }

    // ── TECPRO — vivid blue modular barrier blocks ──────────────────
    case 'tecpro': {
      const arcs = _arcLengths(poly);
      const total = arcs[arcs.length - 1];
      const segLen = Math.max(6, 14 * zoom);
      const gap    = Math.max(1.5, 2 * zoom);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      let d = 0;
      while (d < total) {
        const end = Math.min(d + segLen - gap, total);
        const steps = 4;
        // Dark outline
        ctx.lineWidth = w + 2;
        ctx.strokeStyle = 'rgba(10,20,80,0.6)';
        ctx.beginPath();
        for (let s = 0; s <= steps; s++) {
          const p = _polyAtDist(poly, arcs, d + (end - d) * s / steps);
          s === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        // Main blue body
        ctx.lineWidth = w;
        ctx.strokeStyle = 'rgba(20,70,220,1.0)';
        ctx.beginPath();
        for (let s = 0; s <= steps; s++) {
          const p = _polyAtDist(poly, arcs, d + (end - d) * s / steps);
          s === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        // Light face highlight
        ctx.lineWidth = Math.max(1.5, w * 0.35);
        ctx.strokeStyle = 'rgba(140,200,255,0.85)';
        ctx.beginPath();
        for (let s = 0; s <= steps; s++) {
          const p = _polyAtDist(poly, arcs, d + (end - d) * s / steps);
          s === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        d += segLen;
      }
      ctx.lineCap = 'butt';
      break;
    }

    // ── TYRE WALL — thick black stack with white stripe and tyre circles
    case 'tyrewall': {
      // Dark shadow
      ctx.lineWidth = w + 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      _polyPath(ctx, poly); ctx.stroke();
      // Main black tyre body
      ctx.lineWidth = w;
      ctx.strokeStyle = 'rgba(22,22,22,1.0)';
      _polyPath(ctx, poly); ctx.stroke();
      // Red safety stripe (standard tyre wall marking)
      ctx.lineWidth = Math.max(2, w * 0.32);
      ctx.strokeStyle = 'rgba(220,30,30,0.90)';
      _polyPath(ctx, poly); ctx.stroke();
      // White band on red stripe
      ctx.lineWidth = Math.max(1, w * 0.12);
      ctx.strokeStyle = 'rgba(255,255,255,0.70)';
      _polyPath(ctx, poly); ctx.stroke();
      // Individual tyre outlines
      const arcs = _arcLengths(poly);
      const total = arcs[arcs.length - 1];
      const tyreSpacing = Math.max(5, w * 1.1);
      ctx.strokeStyle = 'rgba(60,60,60,0.80)';
      ctx.lineWidth = Math.max(1, 1.0 * zoom);
      ctx.lineCap = 'butt';
      for (let d = tyreSpacing * 0.5; d < total; d += tyreSpacing) {
        const p = _polyAtDist(poly, arcs, d);
        const r = Math.max(1.5, w * 0.44);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
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
  const splinePts = buildSplinePoints(12);
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

  // ── 1. PERIMETER ARMCO — two separate passes: inside always tight, outside fans at corners ──
  const closeBarrierOffset = 10.8;
  const closeBarrierLane   = { width: 2.0, center: closeBarrierOffset, inner: 9.8, outer: 11.8 };

  // Compute dominant sign per spline point (which side is outside for each point)
  const ptDominantSide = new Int8Array(spl);
  for (let i = 0; i < spl; i++) {
    // look ahead 6 pts to determine corner direction
    let s = 0;
    for (let d = 0; d < 6; d++) s += cornerSign[(i + d) % spl];
    ptDominantSide[i] = s >= 0 ? 1 : -1;
  }

  [-1, 1].forEach(side => {
    const armcoOffsets = Array.from({ length: spl }, (_, i) => {
      const isOutside = (ptDominantSide[i] === side);
      if (!inCorner[i]) return closeBarrierOffset; // straight: always tight
      if (!isOutside)   return closeBarrierOffset; // inside of corner: always tight
      // Outside of corner: fan out based on severity
      if (isMedium[i]) return gravelLane.outer;
      return tarmacLane.outer * 0.75; // fast corner outside: moderate fan
    });
    // Smooth
    const smoothed = armcoOffsets.slice();
    for (let i = 0; i < spl; i++) {
      let sum = 0, cnt = 0;
      for (let d = -TRANS; d <= TRANS; d++) { sum += armcoOffsets[(i+d+spl)%spl]; cnt++; }
      smoothed[i] = sum / cnt;
    }
    const poly = buildOffsetScreenPolylineVarying(splinePts, side, smoothed);
    drawSurfacePattern(ctx, 'armco', poly, closeBarrierLane, side, cam.zoom);
  });

  // ── 2. FAST CORNERS: tarmac runoff ──
  collectRuns(i => inCorner[i] && !isMedium[i] && !userRunoffPts.has(i)).forEach(run => {
    const pts = runPts(run);
    if (pts.length < 2) return;
    const ds = dominantSign(run);
    const offsets = buildTransitionOffsets(pts.length, closeBarrierOffset, tarmacLane.center, TRANS);
    const poly = buildOffsetScreenPolylineVarying(pts, ds, offsets);
    const w = Math.max(4, tarmacLane.width * cam.zoom);
    ctx.lineWidth = w; ctx.strokeStyle = 'rgba(90,92,95,0.88)';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    _polyPath(ctx, poly); ctx.stroke();
    ctx.lineWidth = Math.max(1, w*0.15); ctx.strokeStyle = 'rgba(60,62,65,0.45)';
    _polyPath(ctx, poly); ctx.stroke();
  });

  // ── 3. MEDIUM CORNERS: gravel ──
  collectRuns(i => isMedium[i] && !isSlow[i] && !userRunoffPts.has(i)).forEach(run => {
    const pts = runPts(run);
    if (pts.length < 2) return;
    const ds = dominantSign(run);
    const offsets = buildTransitionOffsets(pts.length, closeBarrierOffset, gravelLane.center, TRANS);
    const poly = buildOffsetScreenPolylineVarying(pts, ds, offsets);
    drawSurfacePattern(ctx, 'gravel', poly, gravelLane, ds, cam.zoom);
  });

  // ── 4. SLOW CORNERS: sand ──
  collectRuns(i => isSlow[i] && !userRunoffPts.has(i)).forEach(run => {
    const pts = runPts(run);
    if (pts.length < 2) return;
    const ds = dominantSign(run);
    const offsets = buildTransitionOffsets(pts.length, closeBarrierOffset, sandLane.center, TRANS);
    const poly = buildOffsetScreenPolylineVarying(pts, ds, offsets);
    drawSurfacePattern(ctx, 'sand', poly, sandLane, ds, cam.zoom);
  });

  // ── 5. CORNERS: rumble strip both sides (fixed offset, no transition needed) ──
  const rumbleLane = getSurfaceLane('rumble', 0);
  collectRuns(i => inCorner[i]).forEach(run => {
    const pts = runPts(run);
    if (pts.length < 2) return;
    [-1, 1].forEach(s => {
      const poly = buildOffsetScreenPolyline(pts, s, rumbleLane.center);
      drawSurfacePattern(ctx, 'rumble', poly, rumbleLane, s, cam.zoom);
    });
  });

  // ── 6. SLOW CORNERS: sausage kerb ──
  const sausageLane = getSurfaceLane('sausage', 0);
  collectRuns(i => isSlow[i]).forEach(run => {
    const pts = runPts(run);
    if (pts.length < 2) return;
    const ds = dominantSign(run);
    const poly = buildOffsetScreenPolyline(pts, ds, sausageLane.center);
    drawSurfacePattern(ctx, 'sausage', poly, sausageLane, ds, cam.zoom);
  });

  // ── 7. OUTER TecPro — fixed offset, behind medium/slow runoff ──
  // Use fixed offset (not varying) so it always renders at the correct position.
  const tecproLane = getSurfaceLane('tecpro', 0);
  const tecproMinW = { ...tecproLane, width: Math.max(tecproLane.width, 3.0) };
  collectRuns(i => isMedium[i]).forEach(run => {
    const pts = runPts(run);
    if (pts.length < 2) return;
    const ds = dominantSign(run);
    const poly = buildOffsetScreenPolyline(pts, ds, tecproLane.center);
    drawSurfacePattern(ctx, 'tecpro', poly, tecproMinW, ds, cam.zoom);
  });

  // ── 8. TYRE WALL — fixed offset, behind sand at slow corners ──
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

function drawPermanentGrassBand() {
  const splinePts = buildSplinePoints(20);
  if (splinePts.length < 2) return;

  const grassLane = getSurfaceLane('grass', 0);
  // Width covers from just outside sausage kerb all the way to armco distance
  const innerOffset = 8.1;   // start at kerb outer edge (flush with sausage inner)
  const outerOffset = 26.0;  // wide enough to sit behind any barrier
  const centerOffset = (innerOffset + outerOffset) * 0.5;
  const bandWidth = outerOffset - innerOffset;

  const fakeLane = { width: bandWidth, center: centerOffset, inner: innerOffset, outer: outerOffset };

  ctx.save();
  ctx.globalAlpha = 1.0;
  [-1, 1].forEach(side => {
    const poly = buildOffsetScreenPolyline(splinePts, side, centerOffset);
    const w = Math.max(4, bandWidth * cam.zoom);
    ctx.lineWidth = w;
    ctx.strokeStyle = '#2a5916';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    poly.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();

    // Darker stripe for depth / texture
    ctx.lineWidth = Math.max(2, w * 0.25);
    ctx.strokeStyle = 'rgba(20,50,10,0.35)';
    ctx.beginPath();
    poly.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();
  });
  ctx.restore();
}

// ═══════════════════════════════════════════════════
// BARRIER SEGMENTS
// ═══════════════════════════════════════════════════
function drawBarrierSegments() {
  const splinePts = buildSplinePoints(20);
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
  const gapTolerance = Math.max(4, Math.floor(waypoints.length * 0.04)); // wider gap bridge
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
