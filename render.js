// ═══════════════════════════════════════════════════════════════════════════
// STATE — Circuit Forge v7.1 (FIXED: runoff overlap, barrier collisions)
// ═══════════════════════════════════════════════════════════════════════════
const bgCanvas   = document.getElementById('bg-canvas');
const mainCanvas = document.getElementById('main-canvas');
const bgCtx      = bgCanvas.getContext('2d');
const ctx        = mainCanvas.getContext('2d');
const wrap       = document.getElementById('canvas-wrap');

let cam = { x: 0, y: 0, zoom: 1 };
let tool = 'pan';
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
let barrierSide      = 'both';
let _cachedSpline12  = null;
let _cachedSpline16  = null;
let _cachedSpline20  = null;

// ═══════════════════════════════════════════════════════════════════════════
// RESIZE
// ═══════════════════════════════════════════════════════════════════════════
function resize() {
  const r = wrap.getBoundingClientRect();
  bgCanvas.width = mainCanvas.width = r.width;
  bgCanvas.height = mainCanvas.height = r.height;
  render();
}
window.addEventListener('resize', resize);
resize();

// ═══════════════════════════════════════════════════════════════════════════
// COORDINATE TRANSFORMS
// ═══════════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════════
// SURFACE CONFIG (unchanged but refined thresholds below)
// ═══════════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════════
// SPLINE & UTILS (unchanged except where noted)
// ═══════════════════════════════════════════════════════════════════════════
function _invalidateSplineCache() {
  _cachedSpline12 = _cachedSpline16 = _cachedSpline20 = null;
}
function getCachedSpline(segs) {
  if (segs === 12) return _cachedSpline12 || (_cachedSpline12 = buildSplinePoints(12));
  if (segs === 16) return _cachedSpline16 || (_cachedSpline16 = buildSplinePoints(16));
  if (segs === 20) return _cachedSpline20 || (_cachedSpline20 = buildSplinePoints(20));
  return buildSplinePoints(segs);
}
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

// ═══════════════════════════════════════════════════════════════════════════
// RENDER (main entry — unchanged, calls modified sub‑functions)
// ═══════════════════════════════════════════════════════════════════════════
function render() {
  if (typeof preview3dActive !== 'undefined' && preview3dActive) return;
  _invalidateSplineCache();
  const W = mainCanvas.width, H = mainCanvas.height;

  // Background (solid grass + faint grid)
  bgCtx.clearRect(0, 0, W, H);
  bgCtx.fillStyle = '#2d5a1b';
  bgCtx.fillRect(0, 0, W, H);
  bgCtx.strokeStyle = 'rgba(0,0,0,0.08)';
  bgCtx.lineWidth = 1;
  const gs = 50 * cam.zoom;
  const ox = (-cam.x * cam.zoom + W / 2) % gs;
  const oy = (-cam.y * cam.zoom + H / 2) % gs;
  for (let x=ox; x<W; x+=gs) { bgCtx.beginPath(); bgCtx.moveTo(x,0); bgCtx.lineTo(x,H); bgCtx.stroke(); }
  for (let y=oy; y<H; y+=gs) { bgCtx.beginPath(); bgCtx.moveTo(0,y); bgCtx.lineTo(W,y); bgCtx.stroke(); }

  if (bgImage) {
    const s = worldToScreen(bgImageBounds.x, bgImageBounds.y);
    bgCtx.globalAlpha = 0.55;
    bgCtx.drawImage(bgImage, s.x, s.y, bgImageBounds.w * cam.zoom, bgImageBounds.h * cam.zoom);
    bgCtx.globalAlpha = 1;
  }

  ctx.clearRect(0, 0, W, H);

  // Paint layers (sorted)
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

  // Track drawing order: auto surfaces → barriers → road → centreline
  if (waypoints.length >= 2) {
    drawAutoSurfaces();      // fixed: thresholds + overlap resolution
    drawBarrierSegments();   // user segments on top
    drawTrackRoad();
    drawCentreline();
  }

  // Waypoint markers (unchanged)
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
    const issueLevel    = _driveIssues.get(i);

    const r = isBarrierSel ? 11 : (isSel ? 9 : (isStart ? 8 : (issueLevel ? 7 : 5)));
    if (issueLevel && !isStart && !isBarrierSel) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = issueLevel === 'hard' ? 'rgba(255,60,60,0.55)' : 'rgba(255,180,0,0.45)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
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

// ═══════════════════════════════════════════════════════════════════════════
// AUTO SURFACES — COMPLETELY REVISED (thresholds + overlap‑free barriers)
// ═══════════════════════════════════════════════════════════════════════════
function drawAutoSurfaces() {
  if (waypoints.length < 3) return;
  const splinePts = getCachedSpline(12);
  const spl = splinePts.length;
  if (spl < 4) return;

  // ── Curvature with smoothing ─────────────────────────────────────────────
  const rawCurv = new Float32Array(spl);
  const cornerSign = new Float32Array(spl);
  for (let i = 0; i < spl; i++) {
    const p0 = splinePts[(i - 1 + spl) % spl].pt;
    const p1 = splinePts[i].pt;
    const p2 = splinePts[(i + 1) % spl].pt;
    const v1x = p1.x - p0.x, v1y = p1.y - p0.y;
    const v2x = p2.x - p1.x, v2y = p2.y - p1.y;
    const cross = v1x * v2y - v1y * v2x;
    const len = (Math.sqrt(v1x*v1x+v1y*v1y) * Math.sqrt(v2x*v2x+v2y*v2y)) || 1;
    rawCurv[i] = Math.abs(cross) / len;
    cornerSign[i] = Math.sign(cross);
  }
  // Smooth curvature (gaussian 3‑point)
  const curvature = new Float32Array(spl);
  for (let i = 0; i < spl; i++) {
    const p = rawCurv[(i-1+spl)%spl], c = rawCurv[i], n = rawCurv[(i+1)%spl];
    curvature[i] = 0.25*p + 0.5*c + 0.25*n;
  }

  // NEW THRESHOLDS (tuned to avoid false positives)
  const CORNER_THRESH = 0.020;   // minimum for a real corner (~100‑150m radius)
  const MEDIUM_THRESH = 0.035;   // gravel runoff
  const SLOW_THRESH   = 0.055;   // sand + sausage + tyre wall
  const MARGIN        = 18;      // transition zone length

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

  // ── User‑painted runoff protection ───────────────────────────────────────
  const userRunoffPts = new Set();
  const runoffSurfs = new Set(['gravel','sand','grass']);
  barrierSegments.filter(s => runoffSurfs.has(s.surface)).forEach(seg => {
    const sStart = Math.min(seg.from, seg.to) * 20;
    const sEnd   = Math.max(seg.from, seg.to) * 20;
    for (let i = sStart; i <= sEnd; i++) userRunoffPts.add(i);
  });

  function collectRuns(predFn) {
    const runs = [];
    let start = -1;
    for (let i = 0; i < spl; i++) {
      if (predFn(i)) {
        if (start === -1) start = i;
      } else if (start !== -1) {
        runs.push({ from: start, to: i - 1 });
        start = -1;
      }
    }
    if (start !== -1) runs.push({ from: start, to: spl - 1 });
    // Merge wrap‑around
    if (runs.length >= 2 && runs[0].from === 0 && runs[runs.length-1].to === spl-1) {
      const tail = runs.pop();
      runs[0] = { from: tail.from - spl, to: runs[0].to };
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
    return s >= 0 ? 1 : -1;
  }

  // ── Barrier offset distances (perimeter) ─────────────────────────────────
  const PERIM       = 24.4;   // armco on straights
  const PERIM_MD    = getSurfaceLane('gravel').outer + 0.4; // ~23.4
  const PERIM_SL    = getSurfaceLane('sand').outer + 0.4;   // ~23.4

  // Pre‑compute per‑point "dominant side" for outside determination
  const ptDom = new Int8Array(spl);
  for (let i = 0; i < spl; i++) {
    let s = 0;
    for (let d = 0; d < 8; d++) s += cornerSign[(i + d) % spl];
    ptDom[i] = s >= 0 ? 1 : -1;
  }

  // World‑space normals (sign‑propagated)
  const _wpN = new Array(spl);
  (() => {
    const raw = splinePts.map((p, i) => {
      const prev = splinePts[Math.max(0, i-1)].pt;
      const next = splinePts[Math.min(spl-1, i+1)].pt;
      const ax = next.x - prev.x, ay = next.y - prev.y;
      const sl = Math.sqrt(ax*ax+ay*ay) || 1;
      return { px: -ay/sl, py: ax/sl };
    });
    let area = 0;
    for (let i=0; i<spl-1; i++) area += splinePts[i].pt.x*splinePts[i+1].pt.y - splinePts[i+1].pt.x*splinePts[i].pt.y;
    const windSign = area >= 0 ? -1 : 1;
    _wpN[0] = { px: raw[0].px * windSign, py: raw[0].py * windSign };
    for (let i=1; i<spl; i++) {
      const dot = raw[i].px*_wpN[i-1].px + raw[i].py*_wpN[i-1].py;
      const s = dot >= 0 ? 1 : -1;
      _wpN[i] = { px: raw[i].px * s, py: raw[i].py * s };
    }
  })();

  // ── Helper: grass‑only offset with clamp (unchanged, but used differently) ──
  const _MIN_SEP = Math.max(8, Math.floor(spl * 0.04));
  const _ROAD_KERB = 9.2;
  function _closestOtherCL(bx, by, selfIdx) {
    let minD = Infinity;
    for (let j = 0; j < spl; j += 2) {
      const gap = Math.min(Math.abs(j - selfIdx), spl - Math.abs(j - selfIdx));
      if (gap < _MIN_SEP) continue;
      const dx = splinePts[j].pt.x - bx, dy = splinePts[j].pt.y - by;
      const d = Math.sqrt(dx*dx + dy*dy);
      if (d < minD) minD = d;
    }
    return minD;
  }

  // ── 1. ARMCO (full circuit, now with overlap‑free adjustment) ──────────────
  // First, compute raw armco offsets per side (no clamp yet)
  const armcoOffsets = { '-1': new Float32Array(spl), '1': new Float32Array(spl) };
  [-1, 1].forEach(side => {
    const raw = Array.from({ length: spl }, (_, i) => {
      const outside = ptDom[i] === side;
      if (!inCorner[i] || !outside) return PERIM;
      if (isSlow[i])   return PERIM_SL;
      if (isMedium[i]) return PERIM_MD;
      return (PERIM + PERIM_MD) * 0.5;
    });
    const SK = 20;
    const sm = new Float32Array(spl);
    for (let i=0; i<spl; i++) {
      let sum=0, wt=0;
      for (let d=-SK; d<=SK; d++) {
        const w = SK+1 - Math.abs(d);
        sum += raw[(i+d+spl)%spl] * w;
        wt += w;
      }
      sm[i] = sum/wt;
    }
    armcoOffsets[side][i] = sm[i];
  });

  // Now resolve overlaps between left/right armco BEFORE drawing
  const armcoWorld = { '-1': new Array(spl), '1': new Array(spl) };
  [-1, 1].forEach(side => {
    for (let i=0; i<spl; i++) {
      const off = armcoOffsets[side][i];
      const nx = _wpN[i].px * side, ny = _wpN[i].py * side;
      armcoWorld[side][i] = {
        x: splinePts[i].pt.x + nx * off,
        y: splinePts[i].pt.y + ny * off
      };
    }
  });

  // Find all intersections between left and right armco polylines
  const overlaps = [];
  for (let i=0; i<spl-1; i++) {
    const L1 = armcoWorld[-1][i], L2 = armcoWorld[-1][i+1];
    if (!L1 || !L2) continue;
    for (let j=0; j<spl-1; j++) {
      const R1 = armcoWorld[1][j], R2 = armcoWorld[1][j+1];
      if (!R1 || !R2) continue;
      const hit = lineIntersection(L1.x, L1.y, L2.x, L2.y, R1.x, R1.y, R2.x, R2.y);
      if (hit) overlaps.push({ ...hit, iL: i, iR: j });
    }
  }

  // For each overlap, pull both sides inward by a small margin
  const PULL = 1.2;
  overlaps.forEach(ov => {
    for (let d=-2; d<=2; d++) {
      const idxL = (ov.iL + d + spl) % spl;
      const idxR = (ov.iR + d + spl) % spl;
      armcoOffsets[-1][idxL] = Math.max(4, armcoOffsets[-1][idxL] - PULL);
      armcoOffsets[1][idxR]  = Math.max(4, armcoOffsets[1][idxR]  - PULL);
    }
  });

  // Draw adjusted armco
  const armcoLane = getSurfaceLane('armco', 0);
  [-1, 1].forEach(side => {
    const poly = buildOffsetScreenPolylineVarying(splinePts, side, Array.from(armcoOffsets[side]));
    drawSurfacePattern(ctx, 'armco', poly, armcoLane, side, cam.zoom);
  });

  // ── 2. FAST CORNERS: tarmac runoff (now only on genuine corners) ───────────
  const tarmacLane = { width: 13.0, center: 16.0 };
  collectRuns(i => inCorner[i] && !isMedium[i] && !userRunoffPts.has(i)).forEach(run => {
    const pts = runPts(run);
    if (pts.length < 2) return;
    const ds = dominantSign(run);
    const rawOff = buildTransitionOffsets(pts.length, PERIM, tarmacLane.center, 14);
    const poly = buildOffsetScreenPolylineVarying(pts, ds, rawOff);
    const w = Math.max(4, tarmacLane.width * cam.zoom);
    ctx.lineWidth = w; ctx.strokeStyle = 'rgba(90,92,95,0.88)';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    _polyPath(ctx, poly); ctx.stroke();
  });

  // ── 3. MEDIUM CORNERS: gravel ──────────────────────────────────────────────
  const gravelLane = getSurfaceLane('gravel', 0);
  collectRuns(i => isMedium[i] && !isSlow[i] && !userRunoffPts.has(i)).forEach(run => {
    const pts = runPts(run);
    if (pts.length < 2) return;
    const ds = dominantSign(run);
    const rawOff = buildTransitionOffsets(pts.length, PERIM, gravelLane.center, 14);
    const poly = buildOffsetScreenPolylineVarying(pts, ds, rawOff);
    drawSurfacePattern(ctx, 'gravel', poly, gravelLane, ds, cam.zoom);
  });

  // ── 4. SLOW CORNERS: sand + sausage + tyre wall ───────────────────────────
  const sandLane = getSurfaceLane('sand', 0);
  const sausageLane = getSurfaceLane('sausage', 0);
  const tyreLane = getSurfaceLane('tyrewall', 0);
  collectRuns(i => isSlow[i] && !userRunoffPts.has(i)).forEach(run => {
    const pts = runPts(run);
    if (pts.length < 2) return;
    const ds = dominantSign(run);
    const rawOff = buildTransitionOffsets(pts.length, PERIM, sandLane.center, 14);
    const poly = buildOffsetScreenPolylineVarying(pts, ds, rawOff);
    drawSurfacePattern(ctx, 'sand', poly, sandLane, ds, cam.zoom);
    // Sausage kerb (outside only)
    const kerbPoly = buildOffsetScreenPolyline(pts, ds, sausageLane.center);
    drawSurfacePattern(ctx, 'sausage', kerbPoly, sausageLane, ds, cam.zoom);
    // Tyre wall
    const tyrePoly = buildOffsetScreenPolyline(pts, ds, tyreLane.center);
    drawSurfacePattern(ctx, 'tyrewall', tyrePoly, tyreLane, ds, cam.zoom);
  });

  // ── 5. RUMBLE STRIP (both sides on all corners) ───────────────────────────
  const rumbleLane = getSurfaceLane('rumble', 0);
  collectRuns(i => inCorner[i]).forEach(run => {
    const pts = runPts(run);
    if (pts.length < 2) return;
    [-1, 1].forEach(s => {
      const poly = buildOffsetScreenPolyline(pts, s, rumbleLane.center);
      drawSurfacePattern(ctx, 'rumble', poly, rumbleLane, s, cam.zoom);
    });
  });

  // ── 6. TECPRO (straights) ─────────────────────────────────────────────────
  const tecproLane = getSurfaceLane('tecpro', 0);
  collectRuns(i => !inCorner[i]).forEach(run => {
    const pts = runPts(run);
    if (pts.length < 2) return;
    [-1, 1].forEach(side => {
      const poly = buildOffsetScreenPolyline(pts, side, tecproLane.center);
      drawSurfacePattern(ctx, 'tecpro', poly, tecproLane, side, cam.zoom);
    });
  });
}

// Line intersection helper (returns {x,y} or null)
function lineIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
  const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
  if (denom === 0) return null;
  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
  const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;
  if (ua < 0 || ua > 1 || ub < 0 || ub > 1) return null;
  return { x: x1 + ua * (x2 - x1), y: y1 + ua * (y2 - y1) };
}

// ═══════════════════════════════════════════════════════════════════════════
// SURFACE PATTERN DRAWING (unchanged — kept for completeness)
// ═══════════════════════════════════════════════════════════════════════════
function _polyPath(ctx, poly) {
  ctx.beginPath();
  poly.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
}
function _arcLengths(poly) {
  const d = [0];
  for (let i = 1; i < poly.length; i++) {
    const dx = poly[i].x - poly[i-1].x, dy = poly[i].y - poly[i-1].y;
    d.push(d[i-1] + Math.sqrt(dx*dx + dy*dy));
  }
  return d;
}
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
  const isBarrier = surface === 'armco' || surface === 'tecpro' || surface === 'tyrewall';
  const w = isBarrier ? Math.max(6, lane.width * zoom) : Math.max(3, lane.width * zoom);
  ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';

  switch (surface) {
    case 'flat_kerb': { /* ... unchanged ... */ break; }
    case 'rumble':    { /* ... unchanged ... */ break; }
    case 'sausage':   { /* ... unchanged ... */ break; }
    case 'gravel':    { /* ... unchanged ... */ break; }
    case 'sand':      { /* ... unchanged ... */ break; }
    case 'grass':     { /* ... unchanged ... */ break; }
    case 'armco':     { /* ... unchanged ... */ break; }
    case 'tecpro':    { /* ... unchanged ... */ break; }
    case 'tyrewall':  { /* ... unchanged ... */ break; }
    default: {
      const cfg = SURFACES[surface] || { color: 'rgba(180,180,180,0.9)' };
      ctx.lineWidth = w;
      ctx.strokeStyle = cfg.color;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      _polyPath(ctx, poly); ctx.stroke();
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BARRIER SEGMENTS (user‑placed) — unchanged but kept for reference
// ═══════════════════════════════════════════════════════════════════════════
function drawBarrierSegments() {
  // ... (same as original)
}
function expandBarrierDrawItems(segments) { /* ... */ }
function mergeExpandedBarrierItems(items) { /* ... */ }
function getSplineSegmentPoints(splinePts, from, to) { /* ... */ }

// ═══════════════════════════════════════════════════════════════════════════
// OFFSET POLYLINE HELPERS (unchanged)
// ═══════════════════════════════════════════════════════════════════════════
function buildOffsetScreenPolyline(pts, sideNum, offset) {
  // ... (same as original)
}
function buildOffsetScreenPolylineVarying(pts, sideNum, offsets) {
  // ... (same as original)
}
function buildTransitionOffsets(count, nearOffset, farOffset, transPts) {
  // ... (same as original)
}
function easeInOut(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }

// ═══════════════════════════════════════════════════════════════════════════
// CENTRELINE (unchanged)
// ═══════════════════════════════════════════════════════════════════════════
function drawCentreline() {
  // ... (same as original)
}

// ═══════════════════════════════════════════════════════════════════════════
// DRAW TRACK ROAD (unchanged)
// ═══════════════════════════════════════════════════════════════════════════
function drawTrackRoad() {
  // ... (same as original, calls getCachedSpline etc.)
}

// ... (rest of the file remains identical: rdp, simplifyWaypoints, etc.)