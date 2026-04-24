// ═══════════════════════════════════════════════════
// RENDER — Circuit Forge  (barrier-overlap fix v7.3)
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

// ── Spline + barrier geometry caches ─────────────────
let _cachedSpline12 = null, _cachedSpline16 = null, _cachedSpline20 = null;
let _bgCamKey = '', _wpCacheKey = '';
let _cachedBarrierWorldGeo = null;
let _cachedBarrierGeo = null;
let _barrierGeoCamZoom = -1;
let _trackRasterCache = null;

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
  _bgCamKey = ''; // force bg redraw
  if (typeof markDirty === 'function') markDirty(); else render();
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
  // Close the loop — append first point so offset polylines have no seam gap
  if (pts.length > 0) pts.push({ pt: pts[0].pt, seg: pts[0].seg });
  return pts;
}

function _invalidateSplineCache() {
  _cachedSpline12 = _cachedSpline16 = _cachedSpline20 = null;
  _cachedBarrierWorldGeo = null;
  _cachedBarrierGeo = null;
  _trackRasterCache = null;
}

function resetRenderCaches() {
  _bgCamKey = '';
  _wpCacheKey = '';
  _barrierGeoCamZoom = -1;
  _trackRasterCache = null;
  _cachedSpline12 = _cachedSpline16 = _cachedSpline20 = null;
  _cachedBarrierWorldGeo = null;
  _cachedBarrierGeo = null;
  _windSignCache = 0;
  _windSignWpKey = '';
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
  updateWPList();
  _invalidateSplineCache();
  if (typeof markDirty === 'function') markDirty(); else render();
  showToast(`Simplified: ${before} → ${waypoints.length} waypoints`);
}

// ═══════════════════════════════════════════════════
// OFFSET POLYLINE — winding-aware, sign-propagated normals
// sideNum: +1 = right of travel, -1 = left
// FIX: compute winding sign from FULL closed loop, not just open pts slice
// ═══════════════════════════════════════════════════

// Compute the winding sign from the full waypoint set (closed loop)
// Returns +1 or -1. Cached per render frame since waypoints don't change mid-frame.
let _windSignCache = 0;
let _windSignWpKey = '';
function _getWindSign() {
  const k = _getWpKey();
  if (k === _windSignWpKey) return _windSignCache;
  _windSignWpKey = k;
  if (waypoints.length < 3) { _windSignCache = 1; return 1; }
  let area = 0;
  const n = waypoints.length;
  for (let i = 0; i < n; i++) {
    const a = waypoints[i], b = waypoints[(i+1)%n];
    area += a.x * b.y - b.x * a.y;
  }
  _windSignCache = area >= 0 ? -1 : 1;
  return _windSignCache;
}

function _computeNormalsForPts(pts) {
  const len = pts.length;
  const windSign = _getWindSign();

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

  const normals = new Array(len);
  normals[0] = { px: raw[0].px * windSign, py: raw[0].py * windSign };
  for (let i = 1; i < len; i++) {
    const dot = raw[i].px*normals[i-1].px + raw[i].py*normals[i-1].py;
    const s = dot > -0.2 ? 1 : -1;
    normals[i] = { px: raw[i].px*s, py: raw[i].py*s };
  }
  return normals;
}

// ═══════════════════════════════════════════════════
// AAA CLEAN OFFSET SYSTEM (stable, no spikes)
// ═══════════════════════════════════════════════════

function buildOffsetScreenPolyline(pts, sideNum, offset) {
  const n = pts.length;
  if (n < 2) return [];

  const normals = new Array(n);

  function norm(x, y) {
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l };
  }

  function dot(ax, ay, bx, by) {
    return ax * bx + ay * by;
  }

  // Step 1: compute per-point normals using wrapped neighbours for closed loop
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n].pt;
    const next = pts[(i + 1) % n].pt;

    const dx = next.x - prev.x;
    const dy = next.y - prev.y;

    const l = Math.hypot(dx, dy) || 1;

    let nx = -dy / l;
    let ny = dx / l;

    if (sideNum === 1) {
      nx = -nx;
      ny = -ny;
    }

    normals[i] = { x: nx, y: ny };
  }

  // Step 2: smooth normals — flip if dot product goes negative (direction flip on tight corners)
  for (let i = 1; i < n; i++) {
    const p = normals[i - 1];
    const c = normals[i];

    const d = dot(p.x, p.y, c.x, c.y);

    // If normal flipped direction, un-flip it
    if (d < 0) {
      c.x = -c.x;
      c.y = -c.y;
    } else if (d < 0.6) {
      c.x = p.x * 0.6 + c.x * 0.4;
      c.y = p.y * 0.6 + c.y * 0.4;

      const l = Math.hypot(c.x, c.y) || 1;
      c.x /= l;
      c.y /= l;
    }
  }

  // FIX 1: The closing duplicate point (pts[n-1] === pts[0] spatially) has a
  // degenerate tangent (next - current ≈ zero), producing a garbage normal.
  // Copy the second-to-last real normal so the seam has a clean direction.
  if (n > 1) {
    normals[n - 1] = { x: normals[n - 2].x, y: normals[n - 2].y };
  }

  // Step 3: miter offset
  const result = [];
  const MITER_LIMIT = 3.0;

  for (let i = 0; i < n; i++) {
    const p = pts[i].pt;

    if (i === 0 || i === n - 1) {
      const nx = normals[i].x;
      const ny = normals[i].y;
      result.push(worldToScreen(p.x + nx * offset, p.y + ny * offset));
      continue;
    }

    const n0 = normals[i - 1];
    const n1 = normals[i];

    const mx = n0.x + n1.x;
    const my = n0.y + n1.y;

    const len = Math.hypot(mx, my) || 1;
    const mxn = mx / len;
    const myn = my / len;

    // If miter bisector points away from expected side, fall back to simple normal
    const sideCheck = dot(mxn, myn, n1.x, n1.y);
    if (sideCheck < 0.1) {
      result.push(worldToScreen(p.x + n1.x * offset, p.y + n1.y * offset));
      continue;
    }

    const denom = Math.max(1e-4, sideCheck);
    let miterLen = offset / denom;

    const maxLen = offset * MITER_LIMIT;
    if (Math.abs(miterLen) > maxLen) {
      miterLen = Math.sign(miterLen) * maxLen;
    }

    // prevent collapse
    const MIN_OFFSET = offset * 0.6;
    if (Math.abs(miterLen) < MIN_OFFSET) {
      miterLen = Math.sign(miterLen) * MIN_OFFSET;
    }

    result.push(
      worldToScreen(
        p.x + mxn * miterLen,
        p.y + myn * miterLen
      )
    );
  }

  return result;
}

// ── Polyline path helper ─────────────────────────────
function buildOffsetWorldPolyline(pts, sideNum, offset) {
  const n = pts.length;
  if (n < 2) return [];

  const normals = new Array(n);

  function dot(ax, ay, bx, by) {
    return ax * bx + ay * by;
  }

  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n].pt;
    const next = pts[(i + 1) % n].pt;
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const l = Math.hypot(dx, dy) || 1;

    let nx = -dy / l;
    let ny = dx / l;

    if (sideNum === 1) {
      nx = -nx;
      ny = -ny;
    }

    normals[i] = { x: nx, y: ny };
  }

  for (let i = 1; i < n; i++) {
    const p = normals[i - 1];
    const c = normals[i];
    const d = dot(p.x, p.y, c.x, c.y);

    if (d < 0) {
      c.x = -c.x;
      c.y = -c.y;
    } else if (d < 0.6) {
      c.x = p.x * 0.6 + c.x * 0.4;
      c.y = p.y * 0.6 + c.y * 0.4;
      const l = Math.hypot(c.x, c.y) || 1;
      c.x /= l;
      c.y /= l;
    }
  }

  if (n > 1) {
    normals[n - 1] = { x: normals[n - 2].x, y: normals[n - 2].y };
  }

  const result = [];
  const MITER_LIMIT = 3.0;

  for (let i = 0; i < n; i++) {
    const p = pts[i].pt;

    if (i === 0 || i === n - 1) {
      const nx = normals[i].x;
      const ny = normals[i].y;
      result.push({ x: p.x + nx * offset, y: p.y + ny * offset });
      continue;
    }

    const n0 = normals[i - 1];
    const n1 = normals[i];
    const mx = n0.x + n1.x;
    const my = n0.y + n1.y;
    const len = Math.hypot(mx, my) || 1;
    const mxn = mx / len;
    const myn = my / len;
    const sideCheck = dot(mxn, myn, n1.x, n1.y);

    if (sideCheck < 0.1) {
      result.push({ x: p.x + n1.x * offset, y: p.y + n1.y * offset });
      continue;
    }

    const denom = Math.max(1e-4, sideCheck);
    let miterLen = offset / denom;
    const maxLen = offset * MITER_LIMIT;
    if (Math.abs(miterLen) > maxLen) {
      miterLen = Math.sign(miterLen) * maxLen;
    }

    const MIN_OFFSET = offset * 0.6;
    if (Math.abs(miterLen) < MIN_OFFSET) {
      miterLen = Math.sign(miterLen) * MIN_OFFSET;
    }

    result.push({ x: p.x + mxn * miterLen, y: p.y + myn * miterLen });
  }

  return result;
}

function _polyPath(ctx, poly) {
  ctx.beginPath();
  poly.forEach((p, i) => i===0 ? ctx.moveTo(p.x,p.y) : ctx.lineTo(p.x,p.y));
}

function _worldPath(drawCtx, poly) {
  drawCtx.beginPath();
  poly.forEach((p, i) => i === 0 ? drawCtx.moveTo(p.x, p.y) : drawCtx.lineTo(p.x, p.y));
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
  let h = 2166136261 >>> 0;
  function mix(v) {
    h ^= (v >>> 0);
    h = Math.imul(h, 16777619);
    h >>>= 0;
  }
  mix(n);
  mix(startingPointIdx || 0);
  for (let i = 0; i < n; i++) {
    mix(Math.round(waypoints[i].x * 100));
    mix(Math.round(waypoints[i].y * 100));
  }
  return `${n}_${h.toString(16)}`;
}

// ═══════════════════════════════════════════════════
// MAIN RENDER
// ═══════════════════════════════════════════════════
function _getTrackRasterTargetPpu(boundsW, boundsH) {
  const dpr = window.devicePixelRatio || 1;
  const need = Math.max(2, cam.zoom * dpr * 1.1);
  let target = need <= 2 ? 2 : (need <= 4 ? 4 : 8);

  const maxDim = 4096;
  const maxArea = 9_000_000;
  const dimCap = maxDim / Math.max(1, boundsW, boundsH);
  const areaCap = Math.sqrt(maxArea / Math.max(1, boundsW * boundsH));
  target = Math.min(target, dimCap, areaCap);

  return Math.max(0.75, target);
}

function _getTrackRasterBounds(roadSpline, geo) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  function includePoint(p) {
    if (!p) return;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  roadSpline.forEach(item => includePoint(item.pt));
  if (geo) {
    [-1, 1].forEach(side => {
      const sideGeo = geo[side];
      if (!sideGeo) return;
      sideGeo.outerWorld.forEach(includePoint);
      sideGeo.innerWorld.forEach(includePoint);
    });
  }

  if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return null;

  const pad = Math.max(BARRIER_OUTER + 10, TRACK_HALF_WIDTH + 14);
  return {
    x: minX - pad,
    y: minY - pad,
    w: Math.max(1, (maxX - minX) + pad * 2),
    h: Math.max(1, (maxY - minY) + pad * 2)
  };
}

function _buildTrackRaster() {
  const roadSpline = getCachedSpline(16);
  const kerbSpline = getCachedSpline(20);
  const geo = _getBarrierGeo();
  if (roadSpline.length < 2 || !geo) return null;

  const bounds = _getTrackRasterBounds(roadSpline, geo);
  if (!bounds) return null;

  const ppu = _getTrackRasterTargetPpu(bounds.w, bounds.h);
  const width = Math.max(1, Math.ceil(bounds.w * ppu));
  const height = Math.max(1, Math.ceil(bounds.h * ppu));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const drawCtx = canvas.getContext('2d');
  if (!drawCtx) return null;

  drawCtx.setTransform(1, 0, 0, 1, 0, 0);
  drawCtx.clearRect(0, 0, width, height);
  drawCtx.setTransform(ppu, 0, 0, ppu, -bounds.x * ppu, -bounds.y * ppu);
  drawCtx.imageSmoothingEnabled = true;
  drawCtx.lineCap = 'round';
  drawCtx.lineJoin = 'round';

  const roadWorld = roadSpline.map(p => p.pt);

  drawCtx.strokeStyle = 'rgba(48,50,54,0.97)';
  drawCtx.lineWidth = TRACK_HALF_WIDTH * 2;
  _worldPath(drawCtx, roadWorld);
  drawCtx.closePath();
  drawCtx.stroke();

  const edgeOffset = TRACK_HALF_WIDTH - 0.4;
  drawCtx.lineWidth = 0.8;
  [-1, 1].forEach(side => {
    drawCtx.strokeStyle = 'rgba(255,255,255,0.7)';
    _worldPath(drawCtx, buildOffsetWorldPolyline(roadSpline, side, edgeOffset));
    drawCtx.stroke();
  });

  const kerbDefault = TRACK_HALF_WIDTH + 0.6;
  drawCtx.lineWidth = 2.2;
  drawCtx.lineCap = 'butt';
  drawCtx.lineJoin = 'miter';
  [-1, 1].forEach(side => {
    let poly;
    const safe = geo[side] && geo[side].kerbOffsets;
    if (safe && kerbSpline.length >= 2 && safe.length === kerbSpline.length - 1) {
      poly = buildOffsetWorldPolylineVarying(kerbSpline, side, safe.concat([safe[0]]));
    } else {
      poly = buildOffsetWorldPolyline(roadSpline, side, kerbDefault);
    }
    drawCtx.setLineDash([14, 14]);
    drawCtx.lineDashOffset = 0;
    drawCtx.strokeStyle = 'rgba(215,25,25,0.92)';
    _worldPath(drawCtx, poly);
    drawCtx.stroke();
    drawCtx.lineDashOffset = 14;
    drawCtx.strokeStyle = 'rgba(245,245,245,0.92)';
    _worldPath(drawCtx, poly);
    drawCtx.stroke();
  });
  drawCtx.setLineDash([]);
  drawCtx.lineDashOffset = 0;
  drawCtx.lineCap = 'round';
  drawCtx.lineJoin = 'round';

  if (startingPointIdx < waypoints.length) {
    const spl = roadSpline.length;
    const i1  = Math.min(startingPointIdx * 16, spl - 1);
    const i2  = Math.min(i1 + 1, spl - 1);
    if (i2 > i1) {
      const sfPt = waypoints[startingPointIdx];
      const dx = roadSpline[i2].pt.x - roadSpline[i1].pt.x;
      const dy = roadSpline[i2].pt.y - roadSpline[i1].pt.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const halfW = TRACK_HALF_WIDTH;
      drawCtx.strokeStyle = 'rgba(255,255,255,0.95)';
      drawCtx.lineWidth = 3.5;
      drawCtx.beginPath();
      drawCtx.moveTo(sfPt.x - nx * halfW, sfPt.y - ny * halfW);
      drawCtx.lineTo(sfPt.x + nx * halfW, sfPt.y + ny * halfW);
      drawCtx.stroke();
    }
  }

  [-1, 1].forEach(side => {
    const { innerWorld, outerWorld, overlapFlags } = geo[side];
    const outer = outerWorld.concat([outerWorld[0]]);
    const inner = innerWorld.concat([innerWorld[0]]);

    drawCtx.lineWidth = 3.5;
    drawCtx.strokeStyle = 'rgba(20,20,20,0.5)';
    _worldPath(drawCtx, outer);
    drawCtx.stroke();

    drawCtx.lineWidth = 2.5;
    drawCtx.strokeStyle = 'rgba(170,185,200,1.0)';
    _worldPath(drawCtx, outer);
    drawCtx.stroke();

    drawCtx.lineWidth = 1.0;
    drawCtx.strokeStyle = 'rgba(235,245,255,0.7)';
    _worldPath(drawCtx, outer);
    drawCtx.stroke();

    const m = inner.length - 1;
    for (let i = 0; i < m; i++) {
      const flagged = overlapFlags && (overlapFlags[i % overlapFlags.length] || overlapFlags[(i + 1) % overlapFlags.length]);
      const shadowColor = flagged ? 'rgba(180,0,120,0.5)' : 'rgba(20,20,20,0.35)';
      const baseColor = flagged ? 'rgba(255,20,180,0.9)' : 'rgba(160,175,190,0.85)';
      const hlColor = flagged ? 'rgba(255,120,220,0.6)' : 'rgba(220,235,255,0.45)';
      const seg = [inner[i], inner[i + 1]];

      drawCtx.lineWidth = 2.0;
      drawCtx.strokeStyle = shadowColor;
      _worldPath(drawCtx, seg);
      drawCtx.stroke();

      drawCtx.lineWidth = 1.5;
      drawCtx.strokeStyle = baseColor;
      _worldPath(drawCtx, seg);
      drawCtx.stroke();

      drawCtx.lineWidth = 0.8;
      drawCtx.strokeStyle = hlColor;
      _worldPath(drawCtx, seg);
      drawCtx.stroke();
    }
  });

  drawCtx.strokeStyle = 'rgba(232,255,71,0.18)';
  drawCtx.lineWidth = 1;
  drawCtx.setLineDash([4, 8]);
  _worldPath(drawCtx, roadWorld);
  drawCtx.closePath();
  drawCtx.stroke();
  drawCtx.setLineDash([]);

  return { key: _getWpKey(), bounds, ppu, canvas };
}

function _ensureTrackRaster() {
  if (waypoints.length < 2) return null;
  const key = _getWpKey();
  if (_trackRasterCache && _trackRasterCache.key === key) {
    const targetPpu = _getTrackRasterTargetPpu(_trackRasterCache.bounds.w, _trackRasterCache.bounds.h);
    if (_trackRasterCache.ppu + 1e-6 >= targetPpu) {
      return _trackRasterCache;
    }
  }

  const roadSpline = getCachedSpline(16);
  if (roadSpline.length < 2) return null;
  const geo = _getBarrierGeo();
  if (!geo) return null;
  const bounds = _getTrackRasterBounds(roadSpline, geo);
  if (!bounds) return null;

  try {
    _trackRasterCache = _buildTrackRaster();
  } catch (err) {
    console.error('track raster build failed', err);
    _trackRasterCache = null;
  }
  return _trackRasterCache;
}

function _drawTrackRaster() {
  const raster = _ensureTrackRaster();
  if (!raster) return false;

  ctx.save();
  ctx.setTransform(
    cam.zoom, 0, 0, cam.zoom,
    mainCanvas.width / 2 - cam.x * cam.zoom,
    mainCanvas.height / 2 - cam.y * cam.zoom
  );
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(raster.canvas, raster.bounds.x, raster.bounds.y, raster.bounds.w, raster.bounds.h);
  ctx.restore();
  return true;
}

function drawWaypointDots() {
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const s  = worldToScreen(wp.x, wp.y);
    const isStart = i === startingPointIdx;
    const r = isStart ? 8 : 5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fillStyle = isStart ? '#00ff88' : '#e8ff47';
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.font = `bold ${Math.max(7, Math.min(10, cam.zoom * 9))}px "Barlow Condensed", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isStart ? 'SF' : i, s.x, s.y);
  }
}

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
  if (wpKey !== _wpCacheKey) {
    _wpCacheKey = wpKey;
    _invalidateSplineCache();
  }

  ctx.clearRect(0, 0, W, H);

  if (waypoints.length >= 2) {
    if (!_drawTrackRaster()) {
      drawTrackRoad();
      drawBarrierLines();
      drawCentreline();
    }
  }

  drawWaypointDots();
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

  // Kerb — alternating red/white dashes just outside the edge line.
  // Use the SAFE per-point offsets from _getBarrierGeo so the kerbs squeeze
  // inward gracefully whenever a foreign track section is too close, rather
  // than overlapping the foreign road (the bug visible on tight Interlagos
  // hairpins / parallel back-to-back sections).
  // _getBarrierGeo() builds its arrays against getCachedSpline(20), so we
  // use the SAME density here for kerbs to keep array sizes aligned.
  let _safeKerbGeo = null;
  try { _safeKerbGeo = _getBarrierGeo(); } catch (_) { _safeKerbGeo = null; }
  const kerbSpline = getCachedSpline(20);
  const kerbDefault = TRACK_HALF_WIDTH + 0.6;
  const kerbW       = Math.max(2, 2.2 * cam.zoom);
  const dashLen     = Math.max(6, 14 * cam.zoom);
  ctx.lineWidth = kerbW;
  ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
  [-1, 1].forEach(side => {
    let poly;
    const safe = _safeKerbGeo && _safeKerbGeo[side] && _safeKerbGeo[side].kerbOffsets;
    if (safe && kerbSpline.length >= 2 && safe.length === kerbSpline.length - 1) {
      // Geo arrays cover indices 0..n-2 (the closing duplicate is dropped).
      // Pad to kerbSpline.length so the closed loop wraps cleanly.
      const padded = safe.concat([safe[0]]);
      poly = buildOffsetScreenPolylineVarying(kerbSpline, side, padded);
    } else {
      poly = buildOffsetScreenPolyline(splinePts, side, kerbDefault);
    }
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
      const nx=-dy/len, ny=dx/len;
      const halfW = TRACK_HALF_WIDTH * cam.zoom;
      const lineW = Math.max(3, 3.5 * cam.zoom);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = lineW;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(sfPt.x - nx * halfW, sfPt.y - ny * halfW);
      ctx.lineTo(sfPt.x + nx * halfW, sfPt.y + ny * halfW);
      ctx.stroke();
      ctx.restore();
    }
  }
}

// ═══════════════════════════════════════════════════
// BARRIER LINES — overlap-free via closed offset polygon clipping
//
// FIX v7.3: The old clipping approach used open path caps that leaked across
// the centreline on tight corners. The new approach:
//   1. Build the full OUTER offset polygon for each side (closed loop).
//   2. Build the full INNER offset polygon (centreline ≈ offset 0.5wu, just
//      enough to never be on the wrong side).
//   3. Clip region = the DONUT between inner and outer — strictly owns only
//      the pixels belonging to that side.
//   4. Both barriers (inner line at BARRIER_INNER, outer wall at BARRIER_OUTER)
//      are drawn inside this clip region, so they physically cannot cross.
// ═══════════════════════════════════════════════════
function _buildSideClipPath(splinePts, side, innerClipOffset, outerClipOffset) {
  // Build a closed donut-shaped clip region.
  // outer ring goes forward along the outer offset polyline,
  // inner ring returns backward along the inner offset (centreline side).
  const outerPoly = buildOffsetScreenPolyline(splinePts, side, outerClipOffset);
  const innerPoly = buildOffsetScreenPolyline(splinePts, side, innerClipOffset);

  ctx.beginPath();
  // Forward along outer edge
  outerPoly.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.closePath();
  // Subtract inner edge (even-odd would work too, but we use a separate clip trick below)
  // We trace inner loop in REVERSE to create a hole via nonzero winding
  ctx.moveTo(innerPoly[innerPoly.length-1].x, innerPoly[innerPoly.length-1].y);
  for (let i = innerPoly.length - 2; i >= 0; i--) {
    ctx.lineTo(innerPoly[i].x, innerPoly[i].y);
  }
  ctx.closePath();
}

function _getBarrierGeo() {
  const splinePts = getCachedSpline(20);
  if (splinePts.length < 2) return null;
  if (_cachedBarrierWorldGeo) return _cachedBarrierWorldGeo;

  const innerOffset = BARRIER_INNER;   // 9.0 wu — ideal inner barrier distance
  const outerOffset = BARRIER_OUTER;   // 26.0 wu — outer perimeter wall
  const n      = splinePts.length;
  const loopLen = n - 1; // closing duplicate excluded

  // ── Step 1: normals for both sides ───────────────────────────────────────
  const normalsL = _buildNormalsForBarrier(splinePts, -1);
  const normalsR = _buildNormalsForBarrier(splinePts,  1);

  // ── Step 2: spatial grid over the centreline ─────────────────────────────
  // Used to quickly find which other parts of the track are physically nearby,
  // regardless of spline index distance.
  const CELL = outerOffset * 2;
  const centreGrid = new Map();
  for (let i = 0; i < n - 1; i++) {
    const p = splinePts[i].pt;
    const key = Math.floor(p.x / CELL) + ',' + Math.floor(p.y / CELL);
    if (!centreGrid.has(key)) centreGrid.set(key, []);
    centreGrid.get(key).push(i);
  }

  // How many spline points per waypoint — used to set local-skip radius.
  const segsPerWp = Math.max(1, Math.round(loopLen / Math.max(1, waypoints.length)));
  // Local skip: ignore spline points within ~3 waypoints of self (same curve section).
  const localSkip = segsPerWp * 3;
  const strictLocalSkip = Math.max(2, segsPerWp);

  // Arc-length map lets us distinguish "really the same nearby curve section"
  // from a different track section that only happens to come physically close.
  const prefixLen = new Float64Array(loopLen + 1);
  for (let i = 0; i < loopLen; i++) {
    const a = splinePts[i].pt;
    const b = splinePts[(i + 1) % loopLen].pt;
    prefixLen[i + 1] = prefixLen[i] + Math.hypot(b.x - a.x, b.y - a.y);
  }
  const totalArcLen = prefixLen[loopLen] || 1;

  function arcDistance(i, j) {
    const lo = Math.min(i, j);
    const hi = Math.max(i, j);
    const d = prefixLen[hi] - prefixLen[lo];
    return Math.min(d, totalArcLen - d);
  }

  function isSameLocalSection(i, j) {
    if (i === j) return true;
    const delta = Math.min(Math.abs(j - i), loopLen - Math.abs(j - i));
    if (delta <= strictLocalSkip) return true;
    if (delta >= localSkip) return false;

    const p = splinePts[i].pt;
    const q = splinePts[j].pt;
    const chord = Math.hypot(q.x - p.x, q.y - p.y);
    const arc = arcDistance(i, j);

    if (arc <= 1e-6) return true;

    // Same local curve section keeps a healthy chord/arc ratio.
    // Tight loop-backs have a tiny chord compared with the travelled arc length,
    // so they should be treated as FOREIGN even if their indices are still nearby.
    return (chord / arc) > 0.55;
  }

  // Query: distance from world point (wx,wy) to nearest FOREIGN centreline point.
  // "Foreign" means spline-index-far enough that it's a different track section.
  function nearestForeignCentre(wx, wy, selfIdx) {
    const cx0 = Math.floor(wx / CELL), cy0 = Math.floor(wy / CELL);
    let minDist = Infinity;
    for (let dcx = -2; dcx <= 2; dcx++) {
      for (let dcy = -2; dcy <= 2; dcy++) {
        const cell = centreGrid.get((cx0 + dcx) + ',' + (cy0 + dcy));
        if (!cell) continue;
        for (let k = 0; k < cell.length; k++) {
          const j = cell[k];
          if (isSameLocalSection(selfIdx, j)) continue; // same local section — skip
          const q = splinePts[j].pt;
          const d = Math.hypot(wx - q.x, wy - q.y);
          if (d < minDist) minDist = d;
        }
      }
    }
    return minDist;
  }

  // ── Step 3: outer barrier — per-point binary-search clamp ────────────────
  const OUTER_MIN_CLEARANCE = TRACK_HALF_WIDTH + 2;
  const outerL = [], outerR = [];
  for (let i = 0; i < n - 1; i++) {
    const p = splinePts[i].pt;
    const calcOuter = (nx, ny) => {
      const wx = p.x + nx * outerOffset, wy = p.y + ny * outerOffset;
      if (nearestForeignCentre(wx, wy, i) >= OUTER_MIN_CLEARANCE) return outerOffset;
      let lo = innerOffset + 1, hi = outerOffset;
      for (let iter = 0; iter < 12; iter++) {
        const mid = (lo + hi) * 0.5;
        if (nearestForeignCentre(p.x + nx * mid, p.y + ny * mid, i) < OUTER_MIN_CLEARANCE)
          hi = mid; else lo = mid;
      }
      return lo;
    };
    const offL = calcOuter(normalsL[i].x, normalsL[i].y);
    const offR = calcOuter(normalsR[i].x, normalsR[i].y);
    outerL.push({ x: p.x + normalsL[i].x * offL, y: p.y + normalsL[i].y * offL });
    outerR.push({ x: p.x + normalsR[i].x * offR, y: p.y + normalsR[i].y * offR });
  }

  // ── Step 4: inner barrier — smooth envelope squeeze ───────────────────────
  //
  // THE CORE FIX for Interlagos-style tight sections:
  //
  // Problem with the old approach (per-point binary search):
  //   Each point independently snaps inward the moment it detects a conflict.
  //   This creates a hard kink at the squeeze entry and exit — a sudden jump
  //   inward then back out, with no smooth transition.
  //
  // New approach — 3-pass pipeline:
  //
  //   Pass A: Per-point binary search finds the raw maximum safe offset at each
  //           point (how close the barrier CAN be without crossing foreign track).
  //           This is a step function: full offset everywhere except the conflict
  //           zone where it drops sharply.
  //
  //   Pass B: Windowed minimum then Gaussian blur smooths that step function
  //           into a gentle ramp. The barrier squeezes in gradually BEFORE the
  //           problem zone and expands gradually AFTER — exactly what you want.
  //           Sigma controls how wide the ramp is (~4 waypoints each side by default).
  //
  //   Pass C: Cross-check left vs right inner barriers against each other.
  //           If the two smoothed inner barriers are still too close to each other
  //           (not just to the foreign centreline), both sides pull back equally
  //           so neither crosses the midpoint between the two road edges.

  const INNER_MIN   = TRACK_HALF_WIDTH + 0.3; // never closer to centreline than road edge
  const INNER_CLEAR = TRACK_HALF_WIDTH + 1.5; // clearance from foreign centreline

  // Pass A: raw per-point maximum safe offset
  const maxOffL = new Float64Array(n - 1);
  const maxOffR = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const p = splinePts[i].pt;
    const calcInnerMax = (nx, ny) => {
      if (nearestForeignCentre(p.x + nx * innerOffset, p.y + ny * innerOffset, i) >= INNER_CLEAR)
        return innerOffset;
      let lo = INNER_MIN, hi = innerOffset;
      for (let iter = 0; iter < 12; iter++) {
        const mid = (lo + hi) * 0.5;
        if (nearestForeignCentre(p.x + nx * mid, p.y + ny * mid, i) < INNER_CLEAR)
          hi = mid; else lo = mid;
      }
      return lo;
    };
    maxOffL[i] = calcInnerMax(normalsL[i].x, normalsL[i].y);
    maxOffR[i] = calcInnerMax(normalsR[i].x, normalsR[i].y);
  }

  // Pass B: windowed minimum then Gaussian blur
  const SIGMA = Math.max(8, segsPerWp * 4); // spread ~4 waypoints each side
  const WIN   = Math.ceil(SIGMA * 2.5);
  const minOffL = new Float64Array(n - 1);
  const minOffR = new Float64Array(n - 1);
  // Windowed minimum spreads the squeeze region outward by WIN points
  for (let i = 0; i < n - 1; i++) {
    let mL = innerOffset, mR = innerOffset;
    for (let k = -WIN; k <= WIN; k++) {
      const j = ((i + k) % (n - 1) + (n - 1)) % (n - 1);
      if (maxOffL[j] < mL) mL = maxOffL[j];
      if (maxOffR[j] < mR) mR = maxOffR[j];
    }
    minOffL[i] = mL;
    minOffR[i] = mR;
  }
  // Gaussian blur smooths windowed-min into a gentle ramp
  const gaussW = Math.ceil(SIGMA * 2);
  const gaussKernel = [];
  let kSum = 0;
  for (let k = -gaussW; k <= gaussW; k++) {
    const w = Math.exp(-(k * k) / (2 * SIGMA * SIGMA));
    gaussKernel.push({ k, w });
    kSum += w;
  }
  const smoothMaxOffL = new Float64Array(n - 1);
  const smoothMaxOffR = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    let sL = 0, sR = 0;
    for (const { k, w } of gaussKernel) {
      const j = ((i + k) % (n - 1) + (n - 1)) % (n - 1);
      sL += minOffL[j] * w;
      sR += minOffR[j] * w;
    }
    smoothMaxOffL[i] = sL / kSum;
    smoothMaxOffR[i] = sR / kSum;
  }

  // Pass C: build final inner points, cross-check L vs R at the SAME index,
  // pull back if still overlapping locally.
  const innerL = [], innerR = [];
  const finalOffL = new Float64Array(n - 1);
  const finalOffR = new Float64Array(n - 1);
  const MIN_GAP = TRACK_HALF_WIDTH * 2 * 0.6; // 60 % of full road width minimum gap
  for (let i = 0; i < n - 1; i++) {
    const p   = splinePts[i].pt;
    let offL  = Math.max(INNER_MIN, Math.min(innerOffset, smoothMaxOffL[i]));
    let offR  = Math.max(INNER_MIN, Math.min(innerOffset, smoothMaxOffR[i]));
    const lx  = p.x + normalsL[i].x * offL, ly = p.y + normalsL[i].y * offL;
    const rx  = p.x + normalsR[i].x * offR, ry = p.y + normalsR[i].y * offR;
    const gap = Math.hypot(rx - lx, ry - ly);
    if (gap < MIN_GAP && gap > 0) {
      const squeeze = MIN_GAP / gap; // > 1 means offsets are too large
      offL = Math.max(INNER_MIN, offL / squeeze);
      offR = Math.max(INNER_MIN, offR / squeeze);
    }
    finalOffL[i] = offL;
    finalOffR[i] = offR;
    innerL.push({ x: p.x + normalsL[i].x * offL, y: p.y + normalsL[i].y * offL });
    innerR.push({ x: p.x + normalsR[i].x * offR, y: p.y + normalsR[i].y * offR });
  }

  // ── Step 5: MUTUAL barrier-vs-barrier overlap fix ───────────────────────
  //
  // The earlier passes only check barriers against the foreign CENTRELINE.
  // That misses cases where two barriers from DIFFERENT track sections sit
  // very close to each other (eg. two parallel straights with a thin gap, or
  // an outside hairpin barrier brushing another section's inner barrier).
  //
  // Here we build a spatial grid of every barrier point we just computed and
  // iteratively pull back any pair of foreign barriers that are too close —
  // BOTH sides shrink mutually so neither steals all the room. We also keep
  // each barrier strictly OUTSIDE the road by clamping to INNER_MIN.
  const BARRIER_BARRIER_MIN = 1.6;       // smallest tolerated gap between two
                                         // foreign barrier walls (world units)
  const BARRIER_ROAD_MIN    = INNER_MIN; // never let a barrier cross a road
  const PAIR_PASSES         = 4;
  const RELAX               = 0.55;      // mutual shrink amount per pass
  const overlapFlagL = new Uint8Array(n - 1);
  const overlapFlagR = new Uint8Array(n - 1);

  // Helper to evaluate the world position from current offsets.
  function worldL(i) {
    const p = splinePts[i].pt;
    return { x: p.x + normalsL[i].x * finalOffL[i], y: p.y + normalsL[i].y * finalOffL[i] };
  }
  function worldR(i) {
    const p = splinePts[i].pt;
    return { x: p.x + normalsR[i].x * finalOffR[i], y: p.y + normalsR[i].y * finalOffR[i] };
  }

  for (let pass = 0; pass < PAIR_PASSES; pass++) {
    // (Re)build a spatial grid each pass because positions move.
    const PCELL = Math.max(BARRIER_BARRIER_MIN * 2, 6);
    const bGrid = new Map();
    function gAdd(x, y, payload) {
      const key = Math.floor(x / PCELL) + ',' + Math.floor(y / PCELL);
      if (!bGrid.has(key)) bGrid.set(key, []);
      bGrid.get(key).push(payload);
    }
    for (let i = 0; i < n - 1; i++) {
      const wl = worldL(i), wr = worldR(i);
      gAdd(wl.x, wl.y, { side: -1, idx: i, x: wl.x, y: wl.y });
      gAdd(wr.x, wr.y, { side:  1, idx: i, x: wr.x, y: wr.y });
    }

    let anyChange = false;
    function flagOverlap(side, idx) {
      const arr = side < 0 ? overlapFlagL : overlapFlagR;
      if (idx >= 0 && idx < arr.length) arr[idx] = 1;
      if (arr.length > 0) arr[(idx + 1) % arr.length] = 1;
    }
    function shrink(side, idx, amount) {
      if (side < 0) {
        const next = Math.max(BARRIER_ROAD_MIN, finalOffL[idx] - amount);
        if (next !== finalOffL[idx]) { finalOffL[idx] = next; anyChange = true; }
      } else {
        const next = Math.max(BARRIER_ROAD_MIN, finalOffR[idx] - amount);
        if (next !== finalOffR[idx]) { finalOffR[idx] = next; anyChange = true; }
      }
    }

    for (let i = 0; i < n - 1; i++) {
      for (const sideSelf of [-1, 1]) {
        const self = sideSelf < 0 ? worldL(i) : worldR(i);
        const cx0 = Math.floor(self.x / PCELL), cy0 = Math.floor(self.y / PCELL);
        for (let dcx = -1; dcx <= 1; dcx++) {
          for (let dcy = -1; dcy <= 1; dcy++) {
            const cell = bGrid.get((cx0 + dcx) + ',' + (cy0 + dcy));
            if (!cell) continue;
            for (let k = 0; k < cell.length; k++) {
              const o = cell[k];
              // Skip self and same local section (not a foreign overlap).
              if (o.side === sideSelf && o.idx === i) continue;
              if (isSameLocalSection(i, o.idx)) continue;
              const dx = o.x - self.x, dy = o.y - self.y;
              const d  = Math.hypot(dx, dy);
              if (d >= BARRIER_BARRIER_MIN) continue;
              // Two foreign barrier points are touching → mutually shrink both.
              const overlap = (BARRIER_BARRIER_MIN - d);
              const amt     = overlap * RELAX * 0.5;
              flagOverlap(sideSelf, i);
              flagOverlap(o.side, o.idx);
              shrink(sideSelf, i, amt);
              shrink(o.side,   o.idx, amt);
            }
          }
        }
      }
    }

    if (!anyChange) break;
  }

  // Rebuild inner barrier point arrays from the (possibly) updated offsets.
  for (let i = 0; i < n - 1; i++) {
    const p = splinePts[i].pt;
    innerL[i] = { x: p.x + normalsL[i].x * finalOffL[i], y: p.y + normalsL[i].y * finalOffL[i] };
    innerR[i] = { x: p.x + normalsR[i].x * finalOffR[i], y: p.y + normalsR[i].y * finalOffR[i] };
  }

  // ── Pass 5: self-intersection fix ────────────────────────────────────────
  //
  // Even after Passes A-C+PAIR_PASSES, a barrier polyline can still cross
  // itself when the track curves back on itself tightly and the normal-flip
  // logic already committed to an offset that places the barrier on the
  // wrong side. These are the "pink overlap" points:
  //   - Find every pair of non-adjacent segments in innerL (and innerR)
  //     that intersect using a spatial grid.
  //   - For each intersecting pair (i, j), shrink finalOffL[i], finalOffL[j]
  //     (or R) by RELAX_SELF per iteration until the intersection clears.
  //   - Flag those indices as overlapping so drawBarrierLines can colour them pink.
  //
  // Uses a coarse spatial grid for O(n) average performance.

  function seg2dIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    // Returns true if segment AB intersects segment CD (excluding shared endpoints).
    const ex = bx - ax, ey = by - ay;
    const fx = dx - cx, fy = dy - cy;
    const denom = ex * fy - ey * fx;
    if (Math.abs(denom) < 1e-10) return false;
    const gx = cx - ax, gy = cy - ay;
    const t = (gx * fy - gy * fx) / denom;
    const u = (gx * ey - gy * ex) / denom;
    return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
  }

  function runSelfIntersectPass(pts, finalOff, normals, flags) {
    const m = pts.length - 1; // number of real segments (pts has closing dup)
    const CELL_SI = Math.max(BARRIER_INNER * 1.5, 20);
    const SHRINK_SELF = 0.5;
    const SELF_PASSES = 5;
    const SELF_SKIP   = Math.max(4, Math.round(segsPerWp * 1.5));

    for (let pass = 0; pass < SELF_PASSES; pass++) {
      // Rebuild point positions from current offsets.
      const px = new Float64Array(m + 1), py = new Float64Array(m + 1);
      for (let i = 0; i <= m; i++) {
        const ii = i % m;
        const cp = splinePts[ii].pt;
        px[i] = cp.x + normals[ii].x * finalOff[ii];
        py[i] = cp.y + normals[ii].y * finalOff[ii];
      }

      // Spatial grid of segment bounding boxes for fast neighbour queries.
      const grid = new Map();
      function addSeg(i) {
        const x0 = Math.min(px[i], px[i+1]), x1 = Math.max(px[i], px[i+1]);
        const y0 = Math.min(py[i], py[i+1]), y1 = Math.max(py[i], py[i+1]);
        const c0x = Math.floor(x0 / CELL_SI), c1x = Math.floor(x1 / CELL_SI);
        const c0y = Math.floor(y0 / CELL_SI), c1y = Math.floor(y1 / CELL_SI);
        for (let cx = c0x; cx <= c1x; cx++) {
          for (let cy = c0y; cy <= c1y; cy++) {
            const key = cx + ',' + cy;
            if (!grid.has(key)) grid.set(key, []);
            grid.get(key).push(i);
          }
        }
      }
      for (let i = 0; i < m; i++) addSeg(i);

      let anyHit = false;
      const checked = new Set();
      for (let i = 0; i < m; i++) {
        const x0 = Math.min(px[i], px[i+1]), x1 = Math.max(px[i], px[i+1]);
        const y0 = Math.min(py[i], py[i+1]), y1 = Math.max(py[i], py[i+1]);
        const c0x = Math.floor(x0 / CELL_SI), c1x = Math.floor(x1 / CELL_SI);
        const c0y = Math.floor(y0 / CELL_SI), c1y = Math.floor(y1 / CELL_SI);
        for (let cx = c0x; cx <= c1x; cx++) {
          for (let cy = c0y; cy <= c1y; cy++) {
            const cell = grid.get(cx + ',' + cy);
            if (!cell) continue;
            for (let ki = 0; ki < cell.length; ki++) {
              const j = cell[ki];
              if (j <= i + SELF_SKIP) continue;
              const loopDelta = Math.min(Math.abs(j - i), m - Math.abs(j - i));
              if (loopDelta < SELF_SKIP) continue;
              const pairKey = i < j ? i * 100000 + j : j * 100000 + i;
              if (checked.has(pairKey)) continue;
              checked.add(pairKey);
              if (!seg2dIntersect(px[i], py[i], px[i+1], py[i+1],
                                  px[j], py[j], px[j+1], py[j+1])) continue;
              // Intersection found — shrink both segments' leading endpoint offsets.
              flags[i] = 1; flags[j] = 1;
              flags[(i + 1) % m] = 1; flags[(j + 1) % m] = 1;
              const shrinkAmt = SHRINK_SELF;
              finalOff[i]           = Math.max(INNER_MIN, finalOff[i]           - shrinkAmt);
              finalOff[(i + 1) % m] = Math.max(INNER_MIN, finalOff[(i + 1) % m] - shrinkAmt);
              finalOff[j]           = Math.max(INNER_MIN, finalOff[j]           - shrinkAmt);
              finalOff[(j + 1) % m] = Math.max(INNER_MIN, finalOff[(j + 1) % m] - shrinkAmt);
              anyHit = true;
            }
          }
        }
      }
      if (!anyHit) break;
    }
  }

  runSelfIntersectPass(splinePts, finalOffL, normalsL, overlapFlagL);
  runSelfIntersectPass(splinePts, finalOffR, normalsR, overlapFlagR);

  function runCrossBarrierIntersectPass() {
    const m = n - 1;
    const CELL_X = Math.max(BARRIER_INNER * 1.5, 20);
    const CROSS_PASSES = 6;
    const SHRINK_CROSS = 0.75;

    for (let pass = 0; pass < CROSS_PASSES; pass++) {
      const pxL = new Float64Array(m + 1), pyL = new Float64Array(m + 1);
      const pxR = new Float64Array(m + 1), pyR = new Float64Array(m + 1);
      for (let i = 0; i <= m; i++) {
        const ii = i % m;
        const cp = splinePts[ii].pt;
        pxL[i] = cp.x + normalsL[ii].x * finalOffL[ii];
        pyL[i] = cp.y + normalsL[ii].y * finalOffL[ii];
        pxR[i] = cp.x + normalsR[ii].x * finalOffR[ii];
        pyR[i] = cp.y + normalsR[ii].y * finalOffR[ii];
      }

      const grid = new Map();
      function addRightSeg(i) {
        const x0 = Math.min(pxR[i], pxR[i + 1]), x1 = Math.max(pxR[i], pxR[i + 1]);
        const y0 = Math.min(pyR[i], pyR[i + 1]), y1 = Math.max(pyR[i], pyR[i + 1]);
        const c0x = Math.floor(x0 / CELL_X), c1x = Math.floor(x1 / CELL_X);
        const c0y = Math.floor(y0 / CELL_X), c1y = Math.floor(y1 / CELL_X);
        for (let cx = c0x; cx <= c1x; cx++) {
          for (let cy = c0y; cy <= c1y; cy++) {
            const key = cx + ',' + cy;
            if (!grid.has(key)) grid.set(key, []);
            grid.get(key).push(i);
          }
        }
      }
      for (let i = 0; i < m; i++) addRightSeg(i);

      let anyHit = false;
      const checked = new Set();
      for (let i = 0; i < m; i++) {
        const x0 = Math.min(pxL[i], pxL[i + 1]), x1 = Math.max(pxL[i], pxL[i + 1]);
        const y0 = Math.min(pyL[i], pyL[i + 1]), y1 = Math.max(pyL[i], pyL[i + 1]);
        const c0x = Math.floor(x0 / CELL_X), c1x = Math.floor(x1 / CELL_X);
        const c0y = Math.floor(y0 / CELL_X), c1y = Math.floor(y1 / CELL_X);
        for (let cx = c0x; cx <= c1x; cx++) {
          for (let cy = c0y; cy <= c1y; cy++) {
            const cell = grid.get(cx + ',' + cy);
            if (!cell) continue;
            for (let ki = 0; ki < cell.length; ki++) {
              const j = cell[ki];
              if (isSameLocalSection(i, j)) continue;
              const pairKey = i < j ? i * 100000 + j : j * 100000 + i;
              if (checked.has(pairKey)) continue;
              checked.add(pairKey);
              if (!seg2dIntersect(pxL[i], pyL[i], pxL[i + 1], pyL[i + 1],
                                  pxR[j], pyR[j], pxR[j + 1], pyR[j + 1])) continue;

              overlapFlagL[i] = 1;
              overlapFlagL[(i + 1) % m] = 1;
              overlapFlagR[j] = 1;
              overlapFlagR[(j + 1) % m] = 1;

              finalOffL[i] = Math.max(INNER_MIN, finalOffL[i] - SHRINK_CROSS);
              finalOffL[(i + 1) % m] = Math.max(INNER_MIN, finalOffL[(i + 1) % m] - SHRINK_CROSS);
              finalOffR[j] = Math.max(INNER_MIN, finalOffR[j] - SHRINK_CROSS);
              finalOffR[(j + 1) % m] = Math.max(INNER_MIN, finalOffR[(j + 1) % m] - SHRINK_CROSS);
              anyHit = true;
            }
          }
        }
      }
      if (!anyHit) break;
    }
  }

  runCrossBarrierIntersectPass();

  // Rebuild once more from the self-intersection-corrected offsets.
  for (let i = 0; i < n - 1; i++) {
    const p = splinePts[i].pt;
    innerL[i] = { x: p.x + normalsL[i].x * finalOffL[i], y: p.y + normalsL[i].y * finalOffL[i] };
    innerR[i] = { x: p.x + normalsR[i].x * finalOffR[i], y: p.y + normalsR[i].y * finalOffR[i] };
  }

  // ── Step 6: per-point safe KERB offsets ─────────────────────────────────
  //
  // The kerbs (red/white dashed strip just outside the road) are normally
  // drawn at a fixed offset of TRACK_HALF_WIDTH + 0.6 = 7.6 wu from the
  // centreline. On track sections that loop back near themselves (e.g.
  // hairpins, parallel straights) the kerbs from two different sections
  // physically overlap each other. We compute, for every spline point, the
  // largest kerb offset that won't intrude on any foreign road, then smooth
  // the result so the kerb width tapers gracefully rather than snapping.
  const KERB_OFFSET   = TRACK_HALF_WIDTH + 0.6;  // 7.6 default
  const KERB_HALFW    = 0.6;                     // visual half-width of the kerb stripe
  const KERB_MIN      = TRACK_HALF_WIDTH + 0.1;  // minimum: hugs the road edge
  // An offset is "safe" if foreign centreline is at least
  // (TRACK_HALF_WIDTH + KERB_HALFW + small margin) away.
  const KERB_NEED     = TRACK_HALF_WIDTH + KERB_HALFW + 0.4;
  const rawKerbL = new Float64Array(n - 1);
  const rawKerbR = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const p = splinePts[i].pt;
    const calcKerb = (nx, ny) => {
      const probe = p.x + nx * KERB_OFFSET, pry = p.y + ny * KERB_OFFSET;
      if (nearestForeignCentre(probe, pry, i) >= KERB_NEED) return KERB_OFFSET;
      let lo = KERB_MIN, hi = KERB_OFFSET;
      for (let iter = 0; iter < 10; iter++) {
        const mid = (lo + hi) * 0.5;
        if (nearestForeignCentre(p.x + nx * mid, p.y + ny * mid, i) < KERB_NEED) hi = mid;
        else lo = mid;
      }
      return lo;
    };
    rawKerbL[i] = calcKerb(normalsL[i].x, normalsL[i].y);
    rawKerbR[i] = calcKerb(normalsR[i].x, normalsR[i].y);
  }
  // Smooth with the same Gaussian kernel used for inner barriers so the
  // kerb tapers smoothly rather than snapping at the conflict boundary.
  const kerbL = new Float64Array(n - 1);
  const kerbR = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    let sL = 0, sR = 0;
    for (const { k, w } of gaussKernel) {
      const j = ((i + k) % (n - 1) + (n - 1)) % (n - 1);
      sL += rawKerbL[j] * w;
      sR += rawKerbR[j] * w;
    }
    kerbL[i] = Math.max(KERB_MIN, Math.min(KERB_OFFSET, sL / kSum));
    kerbR[i] = Math.max(KERB_MIN, Math.min(KERB_OFFSET, sR / kSum));
  }

  const geo = {
    '-1': { innerWorld: innerL, outerWorld: outerL, kerbOffsets: Array.from(kerbL), overlapFlags: overlapFlagL },
     '1': { innerWorld: innerR, outerWorld: outerR, kerbOffsets: Array.from(kerbR), overlapFlags: overlapFlagR }
  };
  _cachedBarrierWorldGeo = geo;
  return geo;
}

// Build normalised outward normals for one side of the track.
// Uses the SAME winding-aware anchor as buildOffsetScreenPolyline so barrier
// normals are globally consistent — no more hemisphere flips on self-crossing tracks.
function _buildNormalsForBarrier(pts, sideNum) {
  const n = pts.length;
  const normals = new Array(n);

  // Step 1: raw per-point normals
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n].pt;
    const next = pts[(i + 1) % n].pt;
    const dx = next.x - prev.x, dy = next.y - prev.y;
    const l = Math.hypot(dx, dy) || 1;
    let nx = -dy / l, ny = dx / l;
    if (sideNum === 1) { nx = -nx; ny = -ny; }
    normals[i] = { x: nx, y: ny };
  }

  // Step 2: anchor pt 0 to winding direction so the whole chain starts correctly.
  // Without this, flip-propagation can lock the wrong hemisphere for the entire track.
  const windSign = _getWindSign();
  const expectedSign = sideNum === -1 ? windSign : -windSign;
  const p0 = pts[0].pt, p1 = pts[1 % n].pt;
  const dx0 = p1.x - p0.x, dy0 = p1.y - p0.y;
  const l0 = Math.hypot(dx0, dy0) || 1;
  const refX = (-dy0 / l0) * expectedSign;
  const refY = ( dx0 / l0) * expectedSign;
  if (normals[0].x * refX + normals[0].y * refY < 0) {
    normals[0].x = -normals[0].x;
    normals[0].y = -normals[0].y;
  }

  // Step 3: propagate — flip if dot goes negative, blend if nearly perpendicular
  for (let i = 1; i < n; i++) {
    const p = normals[i - 1], c = normals[i];
    const d = p.x * c.x + p.y * c.y;
    if (d < 0) { c.x = -c.x; c.y = -c.y; }
    else if (d < 0.6) {
      c.x = p.x * 0.6 + c.x * 0.4;
      c.y = p.y * 0.6 + c.y * 0.4;
      const l = Math.hypot(c.x, c.y) || 1; c.x /= l; c.y /= l;
    }
  }
  // FIX 1: Closing duplicate point (pts[n-1] === pts[0]) has a degenerate tangent.
  // Copy the last real normal so the seam point has a clean, consistent direction.
  if (n > 1) {
    normals[n - 1] = { x: normals[n - 2].x, y: normals[n - 2].y };
  }
  return normals;
}

function drawBarrierLines() {
  let geo;
  try { geo = _getBarrierGeo(); } catch(e) { console.error('barrier geo error', e); return; }
  if (!geo) return;

  [-1, 1].forEach(side => {
    const { innerWorld, outerWorld, overlapFlags } = geo[side];

    const inner = innerWorld.map(p => worldToScreen(p.x, p.y));
    inner.push(inner[0]);
    const outer = outerWorld.map(p => worldToScreen(p.x, p.y));
    outer.push(outer[0]);

    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // Outer barrier — shadow + silver + highlight
    ctx.lineWidth = Math.max(4, 3.5 * cam.zoom);
    ctx.strokeStyle = 'rgba(20,20,20,0.5)';
    _polyPath(ctx, outer); ctx.stroke();

    ctx.lineWidth = Math.max(3, 2.5 * cam.zoom);
    ctx.strokeStyle = 'rgba(170,185,200,1.0)';
    _polyPath(ctx, outer); ctx.stroke();

    ctx.lineWidth = Math.max(1, 1.0 * cam.zoom);
    ctx.strokeStyle = 'rgba(235,245,255,0.7)';
    _polyPath(ctx, outer); ctx.stroke();

    // Inner barrier — normal segments silver, overlapping segments pink
    const m = inner.length - 1; // number of real segments
    for (let i = 0; i < m; i++) {
      const flagged = overlapFlags && (overlapFlags[i % overlapFlags.length] || overlapFlags[(i + 1) % overlapFlags.length]);
      const baseColor  = flagged ? 'rgba(255,20,180,0.9)'  : 'rgba(160,175,190,0.85)';
      const shadowColor= flagged ? 'rgba(180,0,120,0.5)'   : 'rgba(20,20,20,0.35)';
      const hlColor    = flagged ? 'rgba(255,120,220,0.6)'  : 'rgba(220,235,255,0.45)';

      const seg = [inner[i], inner[i + 1]];

      ctx.lineWidth = Math.max(2, 2.0 * cam.zoom);
      ctx.strokeStyle = shadowColor;
      _polyPath(ctx, seg); ctx.stroke();

      ctx.lineWidth = Math.max(1.5, 1.5 * cam.zoom);
      ctx.strokeStyle = baseColor;
      _polyPath(ctx, seg); ctx.stroke();

      ctx.lineWidth = Math.max(0.8, 0.8 * cam.zoom);
      ctx.strokeStyle = hlColor;
      _polyPath(ctx, seg); ctx.stroke();
    }

    ctx.restore();
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
// Varying-offset polyline. `offsets[i]` is the desired distance from the
// centreline at spline-point i (closed loop). Used by drawTrackRoad to draw
// kerbs that taper inward in tight back-to-back sections so they don't
// overlap kerbs from a foreign track section.
function buildOffsetWorldPolylineVarying(pts, sideNum, offsets) {
  const n = pts.length;
  if (n < 2) return [];
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n].pt;
    const next = pts[(i + 1) % n].pt;
    const dx = next.x - prev.x, dy = next.y - prev.y;
    const l  = Math.hypot(dx, dy) || 1;
    let nx = -dy / l, ny = dx / l;
    if (sideNum === 1) { nx = -nx; ny = -ny; }
    const off = offsets[Math.min(offsets.length - 1, i)] || 0;
    const p   = pts[i].pt;
    out[i] = { x: p.x + nx * off, y: p.y + ny * off };
  }
  return out;
}

function buildOffsetScreenPolylineVarying(pts, sideNum, offsets) {
  const n = pts.length;
  if (n < 2) return [];
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n].pt;
    const next = pts[(i + 1) % n].pt;
    const dx = next.x - prev.x, dy = next.y - prev.y;
    const l  = Math.hypot(dx, dy) || 1;
    let nx = -dy / l, ny = dx / l;
    if (sideNum === 1) { nx = -nx; ny = -ny; }
    const off = offsets[Math.min(offsets.length - 1, i)] || 0;
    const p   = pts[i].pt;
    out[i] = worldToScreen(p.x + nx * off, p.y + ny * off);
  }
  return out;
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
