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
function _polyPath(ctx, poly) {
  ctx.beginPath();
  poly.forEach((p, i) => i===0 ? ctx.moveTo(p.x,p.y) : ctx.lineTo(p.x,p.y));
}

// ── Self-intersection clipper with rounded corner ────
// Removes loops from a closed offset polyline. At each cut point, instead
// of leaving a sharp vertex, inserts a small quadratic-bezier arc so the
// barrier curves smoothly around tight hairpin corners.
function _clipSelfIntersections(poly) {
  if (poly.length < 4) return poly;

  function segIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    const ex = bx - ax, ey = by - ay;
    const fx = dx - cx, fy = dy - cy;
    const det = ex * fy - ey * fx;
    if (Math.abs(det) < 1e-9) return null;
    const gx = cx - ax, gy = cy - ay;
    const t = (gx * fy - gy * fx) / det;
    const u = (gx * ey - gy * ex) / det;
    if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6)
      return { t, u };
    return null;
  }

  // Quadratic bezier arc bridging the cut. Backs off along each arm so the
  // sharp corner becomes a smooth curve. Radius is in screen pixels.
  function roundedBridge(pBefore, ix, iy, pAfter) {
    const radius = Math.max(18, 28 * cam.zoom);
    const r = Math.min(radius,
      Math.hypot(pBefore.x - ix, pBefore.y - iy) * 0.48,
      Math.hypot(pAfter.x  - ix, pAfter.y  - iy) * 0.48
    );
    const d0 = Math.hypot(pBefore.x - ix, pBefore.y - iy) || 1;
    const d1 = Math.hypot(pAfter.x  - ix, pAfter.y  - iy) || 1;
    const p0 = { x: ix + (pBefore.x - ix) / d0 * r, y: iy + (pBefore.y - iy) / d0 * r };
    const p1 = { x: ix + (pAfter.x  - ix) / d1 * r, y: iy + (pAfter.y  - iy) / d1 * r };
    const STEPS = 10;
    const arc = [];
    for (let k = 0; k <= STEPS; k++) {
      const t = k / STEPS, mt = 1 - t;
      arc.push({
        x: mt * mt * p0.x + 2 * mt * t * ix + t * t * p1.x,
        y: mt * mt * p0.y + 2 * mt * t * iy + t * t * p1.y
      });
    }
    return arc;
  }

  let pts = poly.slice();
  for (let pass = 0; pass < 8; pass++) {
    let found = false;
    const n = pts.length;
    outer:
    for (let i = 0; i < n - 1; i++) {
      const ax = pts[i].x, ay = pts[i].y;
      const bx = pts[i+1].x, by = pts[i+1].y;
      for (let j = i + 2; j < n - 1; j++) {
        if (i === 0 && j === n - 2) continue;
        const hit = segIntersect(ax, ay, bx, by, pts[j].x, pts[j].y, pts[j+1].x, pts[j+1].y);
        if (!hit) continue;
        const ix = ax + hit.t * (bx - ax);
        const iy = ay + hit.t * (by - ay);
        const bridge = roundedBridge(pts[i], ix, iy, pts[j + 1]);
        pts = pts.slice(0, i + 1).concat(bridge).concat(pts.slice(j + 1));
        found = true;
        break outer;
      }
    }
    if (!found) break;
  }
  return pts;
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
  // Drop down to a lighter render path while the user is actively pinching,
  // panning or wheel-zooming. We restore full detail in the settle render
  // fired ~140ms after the gesture ends (see init.js).
  const fast = !!window._interacting;

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

  // Waypoint dots. Two performance shortcuts here:
  //  - In fast mode (active gesture) we skip per-dot text labels — fillText
  //    is the most expensive call in this loop and 800 of them per frame
  //    will tank a phone.
  //  - When the dots are tiny on screen (zoomed out) we also drop labels
  //    and shrink the strokes — they're unreadable anyway and just smear
  //    into a yellow blob.
  const tooSmallForLabels = cam.zoom < 0.55;
  const skipLabels        = fast || tooSmallForLabels;
  const labelFont = skipLabels
    ? null
    : `bold ${Math.max(7, Math.min(10, cam.zoom*9))}px "Barlow Condensed", sans-serif`;
  if (labelFont) { ctx.font = labelFont; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; }
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
    if (!skipLabels || isStart) {
      // Always keep the SF label readable since it's the start marker the
      // user is most likely to be looking for, even mid-gesture.
      if (skipLabels) {
        ctx.font = `bold ${Math.max(8, Math.min(11, cam.zoom*9))}px "Barlow Condensed", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      }
      ctx.fillStyle = '#000';
      ctx.fillText(isStart ? 'SF' : i, s.x, s.y);
    }
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

  // Kerb — alternating red/white dashes just outside the edge line.
  // Use the SAFE per-point offsets from _getBarrierGeo so the kerbs squeeze
  // inward gracefully whenever a foreign track section is too close, rather
  // than overlapping the foreign road (the bug visible on tight Interlagos
  // hairpins / parallel back-to-back sections).
  // _getBarrierGeo() builds its arrays against getCachedSpline(20), so we
  // use the SAME density here for kerbs to keep array sizes aligned.
  // PERF: in fast (gesture) mode we draw a single thin solid red line
  // instead of the dashed two-pass kerb — this halves the stroke work and,
  // more importantly, avoids ctx.setLineDash which forces canvas to
  // re-tessellate the polyline every frame.
  const fastDraw = !!window._interacting;
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
    if (fastDraw) {
      // Quick single-stroke kerb hint while interacting.
      ctx.strokeStyle = 'rgba(215,25,25,0.85)';
      _polyPath(ctx, poly); ctx.stroke();
    } else {
      ctx.setLineDash([dashLen, dashLen]);
      ctx.lineDashOffset = 0;
      ctx.strokeStyle = 'rgba(215,25,25,0.92)';
      _polyPath(ctx, poly); ctx.stroke();
      ctx.lineDashOffset = dashLen;
      ctx.strokeStyle = 'rgba(245,245,245,0.92)';
      _polyPath(ctx, poly); ctx.stroke();
    }
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

// ═══════════════════════════════════════════════════
// BARRIER GEOMETRY  v8.0 — full rewrite, ray-cast based
// ═══════════════════════════════════════════════════
//
// The geometric idea is simple:
//
//   For each point P on the centreline, on each side, shoot a ray
//   perpendicular to the road. Find the distance D to the next piece of
//   road in that direction (skipping nearby segments that belong to the
//   same section). All three barriers — kerb, inner, outer — must lie
//   within D/2 of P, otherwise they'd cross into another section's lane.
//
// One simple cap formula handles every case:
//
//   cap = D / 2 - SAFETY_GAP / 2
//   kerbOff  = clamp(cap, KERB_MIN,  KERB_IDEAL)
//   innerOff = clamp(cap, INNER_MIN, INNER_IDEAL)
//   outerOff = clamp(cap, OUTER_MIN, OUTER_IDEAL)
//
// Where D = ∞ on a wide-open straight (so all barriers sit at their ideal
// offsets) and D = ~14 wu in a tight back-to-back section (so all three
// barriers symmetrically squeeze inward and meet the foreign section's
// barriers halfway, with SAFETY_GAP between them).
//
// This replaces the old 6-step pipeline (per-point binary search, windowed
// minimum, Gaussian blur, mutual barrier-vs-barrier squeeze, separate kerb
// pass) with a single ray-cast plus a small smoothing window. It is both
// faster and more geometrically correct: the result naturally extends the
// barrier outward where there is room, retracts where there isn't, and
// never overlaps a foreign section regardless of how tight the fold is.
function _getBarrierGeo() {
  const splinePts = getCachedSpline(20);
  if (splinePts.length < 2) return null;
  if (_cachedBarrierWorldGeo) return _cachedBarrierWorldGeo;

  const n       = splinePts.length;
  const loopLen = n - 1;                            // closing duplicate excluded

  // Per-side outward normals (winding-aware so they're consistent on
  // self-crossing tracks). Reused from the v7.x code.
  const normalsL = _buildNormalsForBarrier(splinePts, -1);
  const normalsR = _buildNormalsForBarrier(splinePts,  1);

  // Ideal target offsets for each barrier element.
  const KERB_IDEAL  = TRACK_HALF_WIDTH + 0.6;       // ~7.6 wu — kerb stripe
  const INNER_IDEAL = BARRIER_INNER;                // 9.0 wu — silver inner rail
  const OUTER_IDEAL = BARRIER_OUTER;                // 26.0 wu — outer wall

  // Hard floors. Everything must stay strictly outside the asphalt.
  const KERB_MIN    = TRACK_HALF_WIDTH + 0.1;       // hugs the road edge
  const INNER_MIN   = TRACK_HALF_WIDTH + 0.3;
  const OUTER_MIN   = TRACK_HALF_WIDTH + 0.5;

  // Gap kept between two adjacent sections' barriers when they meet halfway.
  const SAFETY_GAP  = 1.5;
  // Maximum ray length we bother probing. A barrier > OUTER_IDEAL away
  // never affects the result, so cap the ray here for performance.
  const RAY_MAX     = OUTER_IDEAL * 2 + SAFETY_GAP + 1;

  // ── Build a spatial grid of centreline SEGMENTS for fast ray queries ────
  // Each segment (sp[i], sp[i+1]) is registered in every cell its bounding
  // box overlaps. Cell size matches OUTER_IDEAL so any segment within range
  // is at most one cell away from the probe.
  const CELL = OUTER_IDEAL;
  const segGrid = new Map();
  function gridKey(cx, cy) { return cx + ',' + cy; }
  function gridAdd(cx, cy, segIdx) {
    const k = gridKey(cx, cy);
    let bucket = segGrid.get(k);
    if (!bucket) { bucket = []; segGrid.set(k, bucket); }
    bucket.push(segIdx);
  }
  for (let i = 0; i < loopLen; i++) {
    const a = splinePts[i].pt, b = splinePts[(i + 1) % loopLen].pt;
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL);
    const cy0 = Math.floor(y0 / CELL), cy1 = Math.floor(y1 / CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) gridAdd(cx, cy, i);
    }
  }

  // Ignore segments within SKIP_SEGS of the probe — those belong to the
  // same physical road section as the probe and would just give the
  // "ray hits its own neighbour" trivial answer.
  const segsPerWp = Math.max(1, Math.round(loopLen / Math.max(1, waypoints.length)));
  const SKIP_SEGS = Math.max(8, segsPerWp); // ~1 waypoint of arc on either side

  // Cast a ray from p along (nx, ny) and return the smallest positive t at
  // which the ray hits any non-adjacent centreline segment. Returns RAY_MAX
  // when nothing is hit within range.
  function rayHit(p, nx, ny, selfSeg) {
    let bestT = RAY_MAX;
    // Walk the cells the ray passes through in steps of CELL/2. Cheap DDA.
    const steps = Math.ceil(RAY_MAX / (CELL * 0.5));
    const visited = new Set();
    for (let s = 0; s <= steps; s++) {
      const t   = (s / steps) * RAY_MAX;
      if (t > bestT) break;
      const qx  = p.x + nx * t, qy = p.y + ny * t;
      const cx  = Math.floor(qx / CELL), cy = Math.floor(qy / CELL);
      // Probe the 3×3 cell neighbourhood at this step.
      for (let dcx = -1; dcx <= 1; dcx++) {
        for (let dcy = -1; dcy <= 1; dcy++) {
          const k = gridKey(cx + dcx, cy + dcy);
          if (visited.has(k)) continue;
          visited.add(k);
          const bucket = segGrid.get(k);
          if (!bucket) continue;
          for (let bi = 0; bi < bucket.length; bi++) {
            const j = bucket[bi];
            // Skip same-section segments.
            const di = Math.min(Math.abs(j - selfSeg), loopLen - Math.abs(j - selfSeg));
            if (di < SKIP_SEGS) continue;
            const a = splinePts[j].pt, b = splinePts[(j + 1) % loopLen].pt;
            // Intersect ray (p + t*n, t>0) with segment (a + u*(b-a), 0≤u≤1).
            const ex = b.x - a.x, ey = b.y - a.y;
            const det = nx * (-ey) - ny * (-ex);
            if (Math.abs(det) < 1e-9) continue; // parallel
            const px = a.x - p.x, py = a.y - p.y;
            const tt = (px * (-ey) - py * (-ex)) / det;
            if (tt <= 0 || tt >= bestT) continue;
            const uu = (nx * py - ny * px) / det;
            if (uu < 0 || uu > 1) continue;
            bestT = tt;
          }
        }
      }
    }
    return bestT;
  }

  // ── Per-point free distance via ray-cast ────────────────────────────────
  const freeL = new Float64Array(loopLen);
  const freeR = new Float64Array(loopLen);
  for (let i = 0; i < loopLen; i++) {
    const p = splinePts[i].pt;
    freeL[i] = rayHit(p, normalsL[i].x, normalsL[i].y, i);
    freeR[i] = rayHit(p, normalsR[i].x, normalsR[i].y, i);
  }

  // ── Smooth the free-distance arrays so the barrier tapers in/out gently
  // rather than jumping at conflict boundaries. We do a windowed-MIN first
  // (so the squeeze region is conservatively wide) then a small box-blur
  // (so the resulting curve is C0/C1 smooth).
  const SMOOTH_WIN = Math.max(6, segsPerWp * 3);     // ~3 waypoints
  function windowedMin(src) {
    const out = new Float64Array(src.length);
    for (let i = 0; i < src.length; i++) {
      let m = src[i];
      for (let k = -SMOOTH_WIN; k <= SMOOTH_WIN; k++) {
        const j = ((i + k) % src.length + src.length) % src.length;
        if (src[j] < m) m = src[j];
      }
      out[i] = m;
    }
    return out;
  }
  function boxBlur(src, radius) {
    const out = new Float64Array(src.length);
    const w = radius * 2 + 1;
    for (let i = 0; i < src.length; i++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) {
        s += src[((i + k) % src.length + src.length) % src.length];
      }
      out[i] = s / w;
    }
    return out;
  }
  const blurR = Math.max(3, Math.floor(segsPerWp * 1.5));
  const smoothL = boxBlur(boxBlur(boxBlur(windowedMin(freeL), blurR), blurR), Math.max(2, Math.floor(segsPerWp)));
  const smoothR = boxBlur(boxBlur(boxBlur(windowedMin(freeR), blurR), blurR), Math.max(2, Math.floor(segsPerWp)));

  // ── Build per-point barrier offsets and world points ────────────────────
  const innerL = new Array(loopLen), innerR = new Array(loopLen);
  const outerL = new Array(loopLen), outerR = new Array(loopLen);
  const kerbL  = new Float64Array(loopLen);
  const kerbR  = new Float64Array(loopLen);

  function offsetsFor(free) {
    // The cap is half the free distance minus half the safety gap, so two
    // facing sections each contribute equally and meet with SAFETY_GAP
    // between their outermost points.
    const cap = free / 2 - SAFETY_GAP / 2;
    return {
      kerb:  Math.max(KERB_MIN,  Math.min(KERB_IDEAL,  cap)),
      inner: Math.max(INNER_MIN, Math.min(INNER_IDEAL, cap)),
      outer: Math.max(OUTER_MIN, Math.min(OUTER_IDEAL, cap)),
    };
  }

  for (let i = 0; i < loopLen; i++) {
    const p = splinePts[i].pt;
    const oL = offsetsFor(smoothL[i]);
    const oR = offsetsFor(smoothR[i]);
    kerbL[i] = oL.kerb; kerbR[i] = oR.kerb;
    innerL[i] = { x: p.x + normalsL[i].x * oL.inner, y: p.y + normalsL[i].y * oL.inner };
    innerR[i] = { x: p.x + normalsR[i].x * oR.inner, y: p.y + normalsR[i].y * oR.inner };
    outerL[i] = { x: p.x + normalsL[i].x * oL.outer, y: p.y + normalsL[i].y * oL.outer };
    outerR[i] = { x: p.x + normalsR[i].x * oR.outer, y: p.y + normalsR[i].y * oR.outer };
  }

  const geo = {
    '-1': { innerWorld: innerL, outerWorld: outerL, kerbOffsets: Array.from(kerbL) },
     '1': { innerWorld: innerR, outerWorld: outerR, kerbOffsets: Array.from(kerbR) }
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
    const { innerWorld, outerWorld } = geo[side];

    const innerRaw = innerWorld.map(p => worldToScreen(p.x, p.y));
    innerRaw.push(innerRaw[0]);
    const outerRaw = outerWorld.map(p => worldToScreen(p.x, p.y));
    outerRaw.push(outerRaw[0]);
    const inner = _clipSelfIntersections(innerRaw);
    const outer = _clipSelfIntersections(outerRaw);

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

    // Inner barrier — smoothly squeezed on tight sections, no hard kinks
    ctx.lineWidth = Math.max(2, 2.0 * cam.zoom);
    ctx.strokeStyle = 'rgba(20,20,20,0.35)';
    _polyPath(ctx, inner); ctx.stroke();

    ctx.lineWidth = Math.max(1.5, 1.5 * cam.zoom);
    ctx.strokeStyle = 'rgba(160,175,190,0.85)';
    _polyPath(ctx, inner); ctx.stroke();

    ctx.lineWidth = Math.max(0.8, 0.8 * cam.zoom);
    ctx.strokeStyle = 'rgba(220,235,255,0.45)';
    _polyPath(ctx, inner); ctx.stroke();

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
