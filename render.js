// ═══════════════════════════════════════════════════
// STATE
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
let isPanning = false;
let spaceDown = false;
let panStart = { x: 0, y: 0, camX: 0, camY: 0 };
let selectedWP = -1;
let mouseWorld = { x: 0, y: 0 };
let startingPointIdx = 0;
let barrierSegments = [];
let barrierSelStart = -1;

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
  flat_kerb: { color: 'rgba(232,57,42,0.85)',   label: 'Flat Kerb',    dot: '#e8392a' },
  sausage:   { color: 'rgba(245,197,24,0.90)',   label: 'Sausage Kerb', dot: '#f5c518' },
  rumble:    { color: 'rgba(200,50,50,0.75)',    label: 'Rumble Strip', dot: '#dd3333' },
  gravel:    { color: 'rgba(200,184,154,0.75)',  label: 'Gravel/Sand',  dot: '#c8b89a' },
  grass:     { color: 'rgba(40,110,40,0.70)',    label: 'Grass',        dot: '#3a7a3a' },
  armco:     { color: 'rgba(180,180,180,0.90)',  label: 'Armco Wall',   dot: '#bbbbbb' },
  tecpro:    { color: 'rgba(40,80,180,0.85)',    label: 'Tecpro',       dot: '#3a5fa8' },
  tyrewall:  { color: 'rgba(55,55,55,0.90)',     label: 'Tyre Wall',    dot: '#555555' },
};

// ═══════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════
function render() {
  const W = mainCanvas.width, H = mainCanvas.height;

  bgCtx.clearRect(0, 0, W, H);
  bgCtx.strokeStyle = 'rgba(255,255,255,0.04)';
  bgCtx.lineWidth = 1;
  const gridSize = 50 * cam.zoom;
  const offX = (-cam.x * cam.zoom + W / 2) % gridSize;
  const offY = (-cam.y * cam.zoom + H / 2) % gridSize;
  for (let x = offX; x < W; x += gridSize) { bgCtx.beginPath(); bgCtx.moveTo(x, 0); bgCtx.lineTo(x, H); bgCtx.stroke(); }
  for (let y = offY; y < H; y += gridSize) { bgCtx.beginPath(); bgCtx.moveTo(0, y); bgCtx.lineTo(W, y); bgCtx.stroke(); }

  if (bgImage) {
    const s = worldToScreen(bgImageBounds.x, bgImageBounds.y);
    bgCtx.globalAlpha = 0.55;
    bgCtx.drawImage(bgImage, s.x, s.y, bgImageBounds.w * cam.zoom, bgImageBounds.h * cam.zoom);
    bgCtx.globalAlpha = 1;
  }

  ctx.clearRect(0, 0, W, H);

  for (const p of paintLayers) {
    const s = worldToScreen(p.x, p.y);
    ctx.beginPath();
    ctx.arc(s.x, s.y, p.r * cam.zoom, 0, Math.PI * 2);
    ctx.fillStyle = SURFACES[p.surface].color;
    ctx.fill();
  }

  if (waypoints.length >= 2) {
    drawTrackRoad();
    drawBarrierSegments();
    drawCentreline();
  }

  drawLegend();

  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const s = worldToScreen(wp.x, wp.y);
    const isStart = i === startingPointIdx;
    const isSel   = i === selectedWP;
    const isBarrierStart = tool === 'barrier' && i === barrierSelStart;
    ctx.beginPath();
    ctx.arc(s.x, s.y, isBarrierStart ? 11 : (isSel ? 9 : (isStart ? 8 : 6)), 0, Math.PI * 2);
    ctx.fillStyle = isBarrierStart ? '#ff8c00' : (isStart ? '#00ff88' : '#e8ff47');
    ctx.fill();
    ctx.strokeStyle = isBarrierStart ? '#fff' : '#000';
    ctx.lineWidth   = isBarrierStart ? 2.5 : 1.5;
    ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.font = 'bold 8px Barlow Condensed';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isStart ? 'SF' : i, s.x, s.y);
  }
}

// ═══════════════════════════════════════════════════
// SPLINE
// ═══════════════════════════════════════════════════
function catmullPoint(p0, p1, p2, p3, t) {
  const t2 = t*t, t3 = t2*t;
  return {
    x: 0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
    y: 0.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3)
  };
}

function buildSplinePoints(segs) {
  const n = waypoints.length;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const p0 = waypoints[(i-1+n)%n], p1 = waypoints[i];
    const p2 = waypoints[(i+1)%n],   p3 = waypoints[(i+2)%n];
    for (let j = 0; j < segs; j++) pts.push({ pt: catmullPoint(p0,p1,p2,p3,j/segs), seg: i });
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
  const kerbW  = Math.max(2, 4  * cam.zoom);

  // White outer edge
  ctx.strokeStyle = 'rgba(200,200,200,0.45)';
  ctx.lineWidth = trackW*2 + kerbW*2;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  screenPts.forEach((p, i) => i===0 ? ctx.moveTo(p.s.x,p.s.y) : ctx.lineTo(p.s.x,p.s.y));
  ctx.closePath(); ctx.stroke();

  // Red/white kerb chevrons
  let dist = 0;
  for (let i = 1; i < screenPts.length; i++) {
    const a = screenPts[i-1].s, b = screenPts[i].s;
    dist += Math.hypot(b.x-a.x, b.y-a.y);
    const phase = Math.floor(dist / 20);
    ctx.strokeStyle = phase%2===0 ? 'rgba(220,30,30,0.75)' : 'rgba(230,230,230,0.65)';
    ctx.lineWidth = trackW*2 + kerbW*2;
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
  }

  // Asphalt centre
  ctx.strokeStyle = 'rgba(55,55,60,0.95)';
  ctx.lineWidth = trackW*2;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  screenPts.forEach((p, i) => i===0 ? ctx.moveTo(p.s.x,p.s.y) : ctx.lineTo(p.s.x,p.s.y));
  ctx.closePath(); ctx.stroke();

  // Start/finish line
  if (startingPointIdx < waypoints.length) {
    const sfPt = worldToScreen(waypoints[startingPointIdx].x, waypoints[startingPointIdx].y);
    ctx.save();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.setLineDash([4,4]);
    const i1 = Math.min(startingPointIdx*16, screenPts.length-1);
    const i2 = Math.min(i1+1, screenPts.length-1);
    if (i2 > i1) {
      const dx = screenPts[i2].s.x-screenPts[i1].s.x, dy = screenPts[i2].s.y-screenPts[i1].s.y;
      const len = Math.hypot(dx,dy)||1;
      const px = -dy/len*(trackW+4), py = dx/len*(trackW+4);
      ctx.beginPath(); ctx.moveTo(sfPt.x-px,sfPt.y-py); ctx.lineTo(sfPt.x+px,sfPt.y+py); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.restore();
  }
}

// ═══════════════════════════════════════════════════
// BARRIER SEGMENTS
//
// FIX 1: Colour strips only appear on the OUTSIDE of the track.
//        Inside barriers show a small "INSIDE" label on the strip instead of a band.
//
// FIX 2: Zoom stability — TRACK_HALF, BAND_W, BAND_GAP are in WORLD units.
//        drawStrip multiplies by cam.zoom once to get screen pixels.
//        Previously the units were mixed (some already zoomed, some not) causing
//        double-scaling on zoom. Now all offsets are in world-px and converted once.
// ═══════════════════════════════════════════════════
function drawBarrierSegments() {
  const splinePts = buildSplinePoints(12);
  const hasSegs  = barrierSegments && barrierSegments.length > 0;
  const hasHover = tool === 'barrier' && barrierSelStart >= 0;
  if (!hasSegs && !hasHover) return;
  if (splinePts.length < 2) return;

  // All in WORLD units (not pre-scaled by cam.zoom).
  // drawStrip will multiply by cam.zoom exactly once.
  const TRACK_HALF_W = 14;   // world-px half-width of asphalt
  const BAND_W_W     = 5;    // world-px width of each colour band
  const BAND_GAP_W   = 2;    // world-px gap between track edge and first band

  // Minimum screen sizes to stay readable at low zoom
  const MIN_TRACK_HALF = 6;
  const MIN_BAND_W     = 3;
  const MIN_BAND_GAP   = 1;

  const N = splinePts.length;
  // Pre-compute miter direction in WORLD space
  const miterRWorld = new Array(N);
  for (let i = 0; i < N; i++) {
    const prev = splinePts[(i-1+N)%N].pt;
    const cur  = splinePts[i].pt;
    const next = splinePts[(i+1)%N].pt;

    const t1x = cur.x-prev.x, t1y = cur.y-prev.y;
    const l1  = Math.hypot(t1x,t1y)||1;
    const n1x = t1y/l1, n1y = -t1x/l1;

    const t2x = next.x-cur.x, t2y = next.y-cur.y;
    const l2  = Math.hypot(t2x,t2y)||1;
    const n2x = t2y/l2, n2y = -t2x/l2;

    let mx = n1x+n2x, my = n1y+n2y;
    const mlen = Math.hypot(mx,my);
    if (mlen > 1e-6) { mx/=mlen; my/=mlen; } else { mx=n1x; my=n1y; }

    const cosHalf = n1x*mx + n1y*my;
    const scale   = cosHalf > 0.3 ? Math.min(1/cosHalf, 3.0) : 1.0;

    miterRWorld[i] = { wx: cur.x, wy: cur.y, mx: mx*scale, my: my*scale };
  }

  // Draw a polyline offset from the spline in WORLD coordinates, then project to screen.
  // side: +1 = right, -1 = left
  function drawStrip(ptIndices, baseOffsetWorld, colorRgba, lineW, side) {
    if (ptIndices.length < 2) return;
    const screenLineW = Math.max(MIN_BAND_W, lineW * cam.zoom);
    ctx.beginPath();
    ptIndices.forEach((pi, k) => {
      const m  = miterRWorld[pi];
      // Offset in world space, then convert to screen
      const wx = m.wx + side * m.mx * baseOffsetWorld;
      const wy = m.wy + side * m.my * baseOffsetWorld;
      const s  = worldToScreen(wx, wy);
      k === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y);
    });
    ctx.strokeStyle = colorRgba;
    ctx.lineWidth   = screenLineW;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.stroke();
  }

  // Draw a colour band on the OUTSIDE only, plus an "INSIDE" label overlay if inside
  function drawBand(ptIndices, slot, colorRgba, side, isInside) {
    const trackHalf = TRACK_HALF_W;
    const bandW     = BAND_W_W;
    const bandGap   = BAND_GAP_W;
    const baseOff   = trackHalf + bandGap + slot * (bandW + bandGap) + bandW * 0.5;

    if (isInside) {
      // For inside barriers: draw a thin dimmed strip + "INSIDE" text label at midpoint
      const dimColor = colorRgba.replace(/[\d.]+\)$/, '0.35)');
      drawStrip(ptIndices, baseOff, dimColor, bandW * 0.6, side > 0 ? +1 : -1);
      // Draw "INSIDE" label at the midpoint of the strip
      const midIdx = ptIndices[Math.floor(ptIndices.length / 2)];
      if (midIdx !== undefined) {
        const m  = miterRWorld[midIdx];
        const sideSign = side > 0 ? +1 : -1;
        const wx = m.wx + sideSign * m.mx * baseOff;
        const wy = m.wy + sideSign * m.my * baseOff;
        const s  = worldToScreen(wx, wy);
        ctx.save();
        ctx.font = `bold ${Math.max(8, 9 * cam.zoom)}px "Barlow Condensed", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = colorRgba.replace(/[\d.]+\)$/, '0.85)');
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 3;
        ctx.fillText('INSIDE', s.x, s.y);
        ctx.shadowBlur = 0;
        ctx.restore();
      }
    } else {
      // Outside: draw full colour band
      drawStrip(ptIndices, baseOff, colorRgba, bandW, side > 0 ? +1 : -1);
    }
  }

  // Committed segments
  if (hasSegs) {
    barrierSegments.forEach(seg => {
      const cfg = SURFACES[seg.surface];
      if (!cfg) return;
      const ptIndices = [];
      splinePts.forEach((p, pi) => { if (p.seg >= seg.from && p.seg <= seg.to) ptIndices.push(pi); });
      if (ptIndices.length < 2) return;

      const side = seg.side;
      if (side === 'both' || side === undefined || side === null) {
        // Both sides: draw outside on +1 side, and inside label on -1 side
        drawBand(ptIndices, seg.lane || 0, cfg.color, +1, false);
        drawBand(ptIndices, seg.lane || 0, cfg.color, -1, true);
      } else {
        const sideNum = (side === 'left' || side === -1 || side === '-1') ? -1 : +1;
        // Determine if this is an inside placement based on whether it's explicitly
        // a negative/left side (for a right-hand corner, inside = left)
        // We rely on the auto-placement logic which sets side directly.
        // For manually placed barriers, the user chose the side explicitly.
        // "outside" side = +1 (right), inside = -1 (left) in general.
        // The isInside flag: if the numeric side value is -1, show as inside.
        const isInside = (sideNum < 0);
        drawBand(ptIndices, seg.lane || 0, cfg.color, sideNum, isInside);
      }
    });
  }

  // Hover preview
  if (hasHover) {
    const hoverSeg = getSegmentNear(mouseWorld.x, mouseWorld.y);
    if (hoverSeg >= 0) {
      const from = Math.min(barrierSelStart, hoverSeg);
      const to   = Math.max(barrierSelStart, hoverSeg);
      const ptIndices = splinePts.map((p,pi) => ({p,pi})).filter(({p}) => p.seg>=from&&p.seg<=to).map(({pi})=>pi);
      if (ptIndices.length >= 2) {
        const hcol = SURFACES[surface].color.replace(/[\d.]+\)$/, '0.5)');
        drawBand(ptIndices, 0, hcol, +1, false);
      }
    }
  }
}

// ═══════════════════════════════════════════════════
// CANVAS LEGEND (side-by-side colour swatches)
// ═══════════════════════════════════════════════════
function _roundRect(cx, x, y, w, h, r) {
  r = Math.min(r, w/2, h/2);
  cx.beginPath();
  cx.moveTo(x+r, y);
  cx.lineTo(x+w-r, y);  cx.quadraticCurveTo(x+w, y,   x+w, y+r);
  cx.lineTo(x+w, y+h-r); cx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  cx.lineTo(x+r, y+h);  cx.quadraticCurveTo(x,   y+h, x,   y+h-r);
  cx.lineTo(x,   y+r);  cx.quadraticCurveTo(x,   y,   x+r, y);
  cx.closePath();
}

function drawLegend() {
  if (typeof barrierSegments === 'undefined') return;
  const usedSet = new Set();
  barrierSegments.forEach(s => usedSet.add(s.surface));
  paintLayers.forEach(p => usedSet.add(p.surface));
  if (usedSet.size === 0) return;

  const used = [...usedSet];
  const swatchW = 54, swatchH = 22, pad = 5, r = 5;
  const totalW  = used.length * (swatchW + pad) - pad + pad*2;
  // Position on the OUTSIDE of canvas (bottom-right area), fixed to canvas coords
  const sx = mainCanvas.width - totalW - 10;
  const sy = mainCanvas.height - swatchH - 12;

  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = '#0d0d18';
  _roundRect(ctx, sx-pad, sy-pad, totalW, swatchH+pad*2, r+2);
  ctx.fill();
  ctx.globalAlpha = 1;

  used.forEach((surf, i) => {
    const cfg = SURFACES[surf];
    if (!cfg) return;
    const x = sx + i*(swatchW+pad), y = sy;
    ctx.fillStyle = cfg.dot;
    _roundRect(ctx, x, y, swatchW, swatchH, r);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.shadowColor = '#000'; ctx.shadowBlur = 4;
    ctx.font = 'bold 8px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(cfg.label.toUpperCase(), x+swatchW/2, y+swatchH/2);
    ctx.shadowBlur = 0;
  });
  ctx.restore();
}

function drawCentreline() {
  const n = waypoints.length;
  ctx.strokeStyle = 'rgba(232,255,71,0.25)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4,8]);
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const p0 = waypoints[(i-1+n)%n], p1 = waypoints[i];
    const p2 = waypoints[(i+1)%n],   p3 = waypoints[(i+2)%n];
    for (let j = 0; j < 8; j++) {
      const pt = catmullPoint(p0,p1,p2,p3,j/8);
      const s  = worldToScreen(pt.x, pt.y);
      i===0&&j===0 ? ctx.moveTo(s.x,s.y) : ctx.lineTo(s.x,s.y);
    }
  }
  ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
}
