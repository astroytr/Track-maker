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
let barrierSegments = [];   // {from, to, surface}
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
  flat_kerb: { color: 'rgba(232,57,42,0.55)',  label: 'Flat Kerb',    dot: '#e8392a' },
  sausage:   { color: 'rgba(245,197,24,0.65)',  label: 'Sausage Kerb', dot: '#f5c518' },
  rumble:    { color: 'rgba(200,50,50,0.50)',   label: 'Rumble Strip', dot: '#d44444' },
  gravel:    { color: 'rgba(200,184,154,0.60)', label: 'Gravel/Sand',  dot: '#c8b89a' },
  grass:     { color: 'rgba(40,110,40,0.55)',   label: 'Grass',        dot: '#3a7a3a' },
  armco:     { color: 'rgba(180,180,180,0.70)', label: 'Armco Wall',   dot: '#aaaaaa' },
  tecpro:    { color: 'rgba(40,80,180,0.65)',   label: 'Tecpro',       dot: '#3a5fa8' },
  tyrewall:  { color: 'rgba(30,30,30,0.80)',    label: 'Tyre Wall',    dot: '#333333' },
};

// ═══════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════
function render() {
  const W = mainCanvas.width, H = mainCanvas.height;

  bgCtx.clearRect(0, 0, W, H);
  // Grid
  bgCtx.strokeStyle = 'rgba(255,255,255,0.04)';
  bgCtx.lineWidth = 1;
  const gridSize = 50 * cam.zoom;
  const offX = (-cam.x * cam.zoom + W / 2) % gridSize;
  const offY = (-cam.y * cam.zoom + H / 2) % gridSize;
  for (let x = offX; x < W; x += gridSize) { bgCtx.beginPath(); bgCtx.moveTo(x, 0); bgCtx.lineTo(x, H); bgCtx.stroke(); }
  for (let y = offY; y < H; y += gridSize) { bgCtx.beginPath(); bgCtx.moveTo(0, y); bgCtx.lineTo(W, y); bgCtx.stroke(); }

  // Background image
  if (bgImage) {
    const s = worldToScreen(bgImageBounds.x, bgImageBounds.y);
    bgCtx.globalAlpha = 0.55;
    bgCtx.drawImage(bgImage, s.x, s.y, bgImageBounds.w * cam.zoom, bgImageBounds.h * cam.zoom);
    bgCtx.globalAlpha = 1;
  }

  ctx.clearRect(0, 0, W, H);

  // Paint layers
  for (const p of paintLayers) {
    const s = worldToScreen(p.x, p.y);
    const cfg = SURFACES[p.surface];
    ctx.beginPath();
    ctx.arc(s.x, s.y, p.r * cam.zoom, 0, Math.PI * 2);
    ctx.fillStyle = cfg.color;
    ctx.fill();
  }

  // Draw track centreline as a two-colour road strip
  if (waypoints.length >= 2) {
    drawTrackRoad();
    drawBarrierSegments();
    drawCentreline();
  }

  // Waypoints
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const s = worldToScreen(wp.x, wp.y);
    const isStart = i === startingPointIdx;
    const isSel = i === selectedWP;
    const isBarrierStart = tool === 'barrier' && i === barrierSelStart;
    ctx.beginPath();
    ctx.arc(s.x, s.y, isBarrierStart ? 11 : (isSel ? 9 : (isStart ? 8 : 6)), 0, Math.PI * 2);
    ctx.fillStyle = isBarrierStart ? '#ff8c00' : (isStart ? '#00ff88' : '#e8ff47');
    ctx.fill();
    ctx.strokeStyle = isBarrierStart ? '#fff' : '#000';
    ctx.lineWidth = isBarrierStart ? 2.5 : 1.5;
    ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.font = 'bold 8px Barlow Condensed';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isStart ? 'SF' : i, s.x, s.y);
  }
}

function catmullPoint(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
  };
}

// Build full spline point array
function buildSplinePoints(segs) {
  const n = waypoints.length;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const p0 = waypoints[(i - 1 + n) % n];
    const p1 = waypoints[i];
    const p2 = waypoints[(i + 1) % n];
    const p3 = waypoints[(i + 2) % n];
    for (let j = 0; j < segs; j++) {
      pts.push({ pt: catmullPoint(p0, p1, p2, p3, j / segs), seg: i });
    }
  }
  return pts;
}

// Draw a two-colour road: dark asphalt body + coloured kerb stripes on edges
function drawTrackRoad() {
  const splinePts = buildSplinePoints(10);
  if (splinePts.length < 2) return;
  const screenPts = splinePts.map(p => ({ s: worldToScreen(p.pt.x, p.pt.y), seg: p.seg }));

  const trackW = Math.max(6, 14 * cam.zoom);   // total road half-width in px
  const kerbW  = Math.max(2, 4  * cam.zoom);   // kerb stripe width in px

  // Draw asphalt body
  ctx.strokeStyle = 'rgba(60,60,65,0.85)';
  ctx.lineWidth = trackW * 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  screenPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.s.x, p.s.y) : ctx.lineTo(p.s.x, p.s.y));
  ctx.closePath();
  ctx.stroke();

  // Draw outer white edge line
  ctx.strokeStyle = 'rgba(220,220,220,0.5)';
  ctx.lineWidth = trackW * 2 + kerbW * 2;
  ctx.beginPath();
  screenPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.s.x, p.s.y) : ctx.lineTo(p.s.x, p.s.y));
  ctx.closePath();
  ctx.stroke();

  // Redraw asphalt on top to mask centre of outer line
  ctx.strokeStyle = 'rgba(55,55,60,0.9)';
  ctx.lineWidth = trackW * 2;
  ctx.beginPath();
  screenPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.s.x, p.s.y) : ctx.lineTo(p.s.x, p.s.y));
  ctx.closePath();
  ctx.stroke();

  // Alternating red/white kerb chevrons on edge (simplified: alternating colour every ~20px)
  let dist = 0;
  for (let i = 1; i < screenPts.length; i++) {
    const a = screenPts[i-1].s, b = screenPts[i].s;
    const dx = b.x - a.x, dy = b.y - a.y;
    const segLen = Math.hypot(dx, dy);
    dist += segLen;
    const chevronSize = 20;
    const phase = Math.floor(dist / chevronSize);
    ctx.strokeStyle = phase % 2 === 0 ? 'rgba(220,30,30,0.7)' : 'rgba(220,220,220,0.6)';
    ctx.lineWidth = kerbW * 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    // Mask centre again
    ctx.strokeStyle = 'rgba(55,55,60,0.9)';
    ctx.lineWidth = trackW * 2 - kerbW * 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // Start/finish line
  if (startingPointIdx < waypoints.length) {
    const sfPt = worldToScreen(waypoints[startingPointIdx].x, waypoints[startingPointIdx].y);
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.setLineDash([4, 4]);
    const perpLen = trackW + 4;
    // Draw a short perpendicular bar
    const i1 = Math.min(startingPointIdx * 10, screenPts.length - 1);
    const i2 = Math.min(i1 + 1, screenPts.length - 1);
    if (i2 > i1) {
      const dx = screenPts[i2].s.x - screenPts[i1].s.x;
      const dy = screenPts[i2].s.y - screenPts[i1].s.y;
      const len = Math.hypot(dx, dy) || 1;
      const px = -dy / len * perpLen, py = dx / len * perpLen;
      ctx.beginPath();
      ctx.moveTo(sfPt.x - px, sfPt.y - py);
      ctx.lineTo(sfPt.x + px, sfPt.y + py);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }
}

// Draw barrier segments as thick coloured lines on the track
function drawBarrierSegments() {
  const splinePts = buildSplinePoints(10);
  if (!barrierSegments.length) return;
  for (const seg of barrierSegments) {
    const cfg = SURFACES[seg.surface];
    const relevant = splinePts.filter(p => p.seg >= seg.from && p.seg <= seg.to);
    if (relevant.length < 2) continue;
    ctx.strokeStyle = cfg.color.replace(/[\d.]+\)$/, '0.9)');
    ctx.lineWidth = Math.max(4, 7 * cam.zoom);
    ctx.lineCap = 'round';
    ctx.beginPath();
    relevant.forEach((p, i) => {
      const s = worldToScreen(p.pt.x, p.pt.y);
      i === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y);
    });
    ctx.stroke();
  }
  // Draw barrier hover highlight
  if (tool === 'barrier' && barrierSelStart >= 0) {
    const hoverSeg = getSegmentNear(mouseWorld.x, mouseWorld.y);
    if (hoverSeg >= 0) {
      const from = Math.min(barrierSelStart, hoverSeg);
      const to   = Math.max(barrierSelStart, hoverSeg);
      const relevant = splinePts.filter(p => p.seg >= from && p.seg <= to);
      if (relevant.length >= 2) {
        const cfg = SURFACES[surface];
        ctx.strokeStyle = cfg.color.replace(/[\d.]+\)$/, '0.6)');
        ctx.lineWidth = Math.max(6, 10 * cam.zoom);
        ctx.lineCap = 'round';
        ctx.beginPath();
        relevant.forEach((p, i) => {
          const s = worldToScreen(p.pt.x, p.pt.y);
          i === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y);
        });
        ctx.stroke();
      }
    }
  }
}

function drawCentreline() {
  const n = waypoints.length;
  ctx.strokeStyle = 'rgba(232,255,71,0.25)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 8]);
  ctx.beginPath();
  const segs = 8;
  for (let i = 0; i < n; i++) {
    const p0 = waypoints[(i - 1 + n) % n];
    const p1 = waypoints[i];
    const p2 = waypoints[(i + 1) % n];
    const p3 = waypoints[(i + 2) % n];
    for (let j = 0; j < segs; j++) {
      const pt = catmullPoint(p0, p1, p2, p3, j / segs);
      const s = worldToScreen(pt.x, pt.y);
      if (i === 0 && j === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    }
  }
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
}

// ═══════════════════════════════════════════════════
