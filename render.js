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
// Offsets from centreline in world units (TW=14, half-width=7, scale=0.9286 m/wu)
// Layout: track edge at 7wu, surfaces placed outward from there
const SURFACE_LANES = {
  flat_kerb: { inner:  7.0, outer:  8.1, labelOffset: 10 },
  rumble:    { inner:  7.0, outer:  7.5, labelOffset: 10 },
  sausage:   { inner:  7.5, outer:  8.6, labelOffset: 11 },
  gravel:    { inner:  8.1, outer: 14.5, labelOffset: 18 },
  sand:      { inner:  8.1, outer: 14.5, labelOffset: 18 },
  grass:     { inner: 14.5, outer: 19.9, labelOffset: 24 },
  armco:     { inner: 17.8, outer: 18.7, labelOffset: 26 },
  tecpro:    { inner: 15.6, outer: 17.2, labelOffset: 24 },
  tyrewall:  { inner: 14.5, outer: 16.3, labelOffset: 23 },
};

function normalizeSideValue(side) {
  return side === 'left' || side === -1 ? -1 : 1;
}

function getSurfaceLane(surfaceName, lane = 0) {
  const cfg = SURFACE_LANES[surfaceName] || SURFACE_LANES.flat_kerb;
  const extra = Math.max(0, lane || 0) * 4.5;
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

  // ── Background grid ──
  bgCtx.clearRect(0, 0, W, H);
  bgCtx.strokeStyle = 'rgba(255,255,255,0.04)';
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

  // ── Track ──
  if (waypoints.length >= 2) {
    drawTrackRoad();
    drawBarrierSegments();
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
function drawTrackRoad() {
  const splinePts = buildSplinePoints(16);
  if (splinePts.length < 2) return;
  const screenPts = splinePts.map(p => ({ s: worldToScreen(p.pt.x, p.pt.y), seg: p.seg }));
  const trackW = Math.max(6, 14 * cam.zoom);
  const kerbW  = Math.max(2, 3.5 * cam.zoom);

  // White outer edge
  ctx.strokeStyle = 'rgba(200,200,200,0.4)';
  ctx.lineWidth = trackW*2 + kerbW*2;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  screenPts.forEach((p,i) => i===0 ? ctx.moveTo(p.s.x,p.s.y) : ctx.lineTo(p.s.x,p.s.y));
  ctx.closePath(); ctx.stroke();

  // Kerb chevrons
  let dist = 0;
  for (let i=1; i<screenPts.length; i++) {
    const a=screenPts[i-1].s, b=screenPts[i].s;
    dist += Math.hypot(b.x-a.x, b.y-a.y);
    const phase = Math.floor(dist / 18);
    ctx.strokeStyle = phase%2===0 ? 'rgba(220,30,30,0.7)' : 'rgba(225,225,225,0.6)';
    ctx.lineWidth = trackW*2 + kerbW*2;
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
  }

  // Asphalt centre
  ctx.strokeStyle = 'rgba(52,52,57,0.96)';
  ctx.lineWidth = trackW*2;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  screenPts.forEach((p,i) => i===0 ? ctx.moveTo(p.s.x,p.s.y) : ctx.lineTo(p.s.x,p.s.y));
  ctx.closePath(); ctx.stroke();

  // Start/finish line
  if (startingPointIdx < waypoints.length) {
    const i1 = Math.min(startingPointIdx*16, screenPts.length-1);
    const i2 = Math.min(i1+1, screenPts.length-1);
    if (i2 > i1) {
      const sfPt = worldToScreen(waypoints[startingPointIdx].x, waypoints[startingPointIdx].y);
      const dx=screenPts[i2].s.x-screenPts[i1].s.x, dy=screenPts[i2].s.y-screenPts[i1].s.y;
      const len=Math.hypot(dx,dy)||1;
      const px=-dy/len*(trackW+4), py=dx/len*(trackW+4);
      ctx.save();
      ctx.strokeStyle='#fff'; ctx.lineWidth=3; ctx.setLineDash([4,4]);
      ctx.beginPath(); ctx.moveTo(sfPt.x-px,sfPt.y-py); ctx.lineTo(sfPt.x+px,sfPt.y+py); ctx.stroke();
      ctx.setLineDash([]); ctx.restore();
    }
  }
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
  const w = Math.max(1.5, lane.width * zoom);
  ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';

  switch (surface) {

    // ── FLAT KERB — alternating red / white blocks ─────────────────
    case 'flat_kerb': {
      const arcs = _arcLengths(poly);
      const total = arcs[arcs.length - 1];
      const blockLen = Math.max(4, 10 * zoom);
      let dist = 0, block = 0;
      ctx.lineWidth = w;
      while (dist < total) {
        const end = Math.min(dist + blockLen, total);
        // Sample a few sub-points for this block
        const steps = 4;
        ctx.beginPath();
        for (let s = 0; s <= steps; s++) {
          const p = _polyAtDist(poly, arcs, dist + (end - dist) * s / steps);
          s === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = block % 2 === 0 ? 'rgba(220,30,30,0.92)' : 'rgba(245,245,245,0.92)';
        ctx.stroke();
        dist = end; block++;
      }
      break;
    }

    // ── RUMBLE STRIP — orange/white serrated chevrons ──────────────
    case 'rumble': {
      const arcs = _arcLengths(poly);
      const total = arcs[arcs.length - 1];
      const blockLen = Math.max(3, 7 * zoom);
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
        ctx.strokeStyle = block % 2 === 0 ? 'rgba(230,100,0,0.90)' : 'rgba(240,240,240,0.88)';
        ctx.stroke();
        dist = end; block++;
      }
      break;
    }

    // ── SAUSAGE KERB — thick yellow rounded ridge ──────────────────
    case 'sausage': {
      // Base: wide yellow
      ctx.lineWidth = w * 1.1;
      ctx.strokeStyle = 'rgba(245,197,24,0.95)';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      _polyPath(ctx, poly); ctx.stroke();
      // White highlight ridge on top
      ctx.lineWidth = Math.max(1, w * 0.35);
      ctx.strokeStyle = 'rgba(255,255,255,0.70)';
      _polyPath(ctx, poly); ctx.stroke();
      ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
      break;
    }

    // ── GRAVEL — stippled sandy dots ──────────────────────────────
    case 'gravel': {
      // Base fill strip
      ctx.lineWidth = w;
      ctx.strokeStyle = 'rgba(190,170,135,0.72)';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      _polyPath(ctx, poly); ctx.stroke();
      // Stipple dots along strip
      const arcs = _arcLengths(poly);
      const total = arcs[arcs.length - 1];
      const spacing = Math.max(3, 5 * zoom);
      const halfW = w * 0.38;
      ctx.fillStyle = 'rgba(155,135,100,0.55)';
      for (let d = spacing * 0.5; d < total; d += spacing) {
        const p = _polyAtDist(poly, arcs, d);
        const perp = { x: -p.ty, y: p.tx };
        const off = (Math.sin(d * 2.7) * 0.5) * halfW;
        const r = Math.max(0.8, 1.2 * zoom);
        ctx.beginPath();
        ctx.arc(p.x + perp.x * off, p.y + perp.y * off, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.lineCap = 'butt';
      break;
    }

    // ── SAND — lighter stipple, warm tone ─────────────────────────
    case 'sand': {
      ctx.lineWidth = w;
      ctx.strokeStyle = 'rgba(220,200,145,0.70)';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      _polyPath(ctx, poly); ctx.stroke();
      const arcs = _arcLengths(poly);
      const total = arcs[arcs.length - 1];
      const spacing = Math.max(3, 5 * zoom);
      ctx.fillStyle = 'rgba(190,165,100,0.45)';
      for (let d = spacing * 0.5; d < total; d += spacing) {
        const p = _polyAtDist(poly, arcs, d);
        const perp = { x: -p.ty, y: p.tx };
        const off = (Math.cos(d * 3.1) * 0.4) * w * 0.35;
        const r = Math.max(0.7, zoom);
        ctx.beginPath();
        ctx.arc(p.x + perp.x * off, p.y + perp.y * off, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.lineCap = 'butt';
      break;
    }

    // ── GRASS — green with darker stripe ──────────────────────────
    case 'grass': {
      ctx.lineWidth = w;
      ctx.strokeStyle = 'rgba(38,105,38,0.78)';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      _polyPath(ctx, poly); ctx.stroke();
      // Darker stripe down centre for depth
      ctx.lineWidth = Math.max(1, w * 0.3);
      ctx.strokeStyle = 'rgba(20,70,20,0.45)';
      _polyPath(ctx, poly); ctx.stroke();
      ctx.lineCap = 'butt';
      break;
    }

    // ── ARMCO — silver corrugated wall ────────────────────────────
    case 'armco': {
      // Base wall
      ctx.lineWidth = w;
      ctx.strokeStyle = 'rgba(185,185,185,0.95)';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      _polyPath(ctx, poly); ctx.stroke();
      // Corrugation ticks
      const arcs = _arcLengths(poly);
      const total = arcs[arcs.length - 1];
      const tickSpacing = Math.max(4, 8 * zoom);
      const tickH = Math.max(1, w * 0.55);
      ctx.strokeStyle = 'rgba(100,100,100,0.60)';
      ctx.lineWidth = Math.max(0.8, 0.8 * zoom);
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

    // ── TECPRO — blue block segments ──────────────────────────────
    case 'tecpro': {
      const arcs = _arcLengths(poly);
      const total = arcs[arcs.length - 1];
      const segLen = Math.max(5, 12 * zoom);
      const gap    = Math.max(1, 1.5 * zoom);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      let d = 0;
      while (d < total) {
        const end = Math.min(d + segLen - gap, total);
        const steps = 4;
        ctx.beginPath();
        for (let s = 0; s <= steps; s++) {
          const p = _polyAtDist(poly, arcs, d + (end - d) * s / steps);
          s === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
        }
        ctx.lineWidth = w;
        ctx.strokeStyle = 'rgba(35,75,175,0.92)';
        ctx.stroke();
        // Light face highlight
        ctx.lineWidth = Math.max(1, w * 0.3);
        ctx.strokeStyle = 'rgba(100,150,255,0.55)';
        ctx.stroke();
        d += segLen;
      }
      ctx.lineCap = 'butt';
      break;
    }

    // ── TYRE WALL — black with white band ─────────────────────────
    case 'tyrewall': {
      // Black base
      ctx.lineWidth = w;
      ctx.strokeStyle = 'rgba(28,28,28,0.95)';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      _polyPath(ctx, poly); ctx.stroke();
      // White centre band (tyre sidewall markings)
      ctx.lineWidth = Math.max(1, w * 0.25);
      ctx.strokeStyle = 'rgba(220,220,220,0.65)';
      _polyPath(ctx, poly); ctx.stroke();
      // Tyre circle ticks
      const arcs = _arcLengths(poly);
      const total = arcs[arcs.length - 1];
      const tyreSpacing = Math.max(4, w * 1.2);
      ctx.strokeStyle = 'rgba(50,50,50,0.70)';
      ctx.lineWidth = Math.max(0.7, 0.7 * zoom);
      ctx.lineCap = 'butt';
      for (let d = tyreSpacing * 0.5; d < total; d += tyreSpacing) {
        const p = _polyAtDist(poly, arcs, d);
        const r = Math.max(1, w * 0.42);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }

    // ── FALLBACK — plain colour strip ─────────────────────────────
    default: {
      const cfg = SURFACES[surface] || { color: 'rgba(180,180,180,0.8)' };
      ctx.lineWidth = w;
      ctx.strokeStyle = cfg.color;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      _polyPath(ctx, poly); ctx.stroke();
      break;
    }
  }
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

  const expanded = expandBarrierDrawItems(barrierSegments)
    .sort((a,b) => {
      const la = getSurfaceLane(a.surface, a.lane || 0);
      const lb = getSurfaceLane(b.surface, b.lane || 0);
      return lb.outer - la.outer;
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
  const gapTolerance = Math.max(2, Math.floor(waypoints.length * 0.018));
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
  const pts = splinePts.filter(p => p.seg >= from && p.seg <= to);
  if (pts.length < 3) return pts;
  return pts;
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
