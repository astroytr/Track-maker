// TRACK IMAGE → WAYPOINTS  v6.1
// Eyedropper colour picker + grid-path walk
// ═══════════════════════════════════════════════════
let aiImageData = null;
let aiImgW = 0, aiImgH = 0;
let aiRawImage = null;          // full-res ImageData for eyedropper sampling
let aiTrackRGB = null;          // {r,g,b} picked by eyedropper
let aiBgRGB    = null;          // {r,g,b} picked by eyedropper
let aiEyedropperMode = null;    // 'track' | 'bg' | null
let aiPreviewCanvas  = null;
let aiPreviewCtx     = null;

// Legacy vars kept so old references don't crash
let aiTrackColour = 'black';
let aiBgColour    = 'white';

function openAIConvert()  { document.getElementById('ai-modal').classList.add('open'); }
function closeAIConvert() { document.getElementById('ai-modal').classList.remove('open'); aiEyedropperMode = null; }

function aiHandleDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) aiLoadImageFile(file);
}
function aiLoadFile(input) {
  if (input.files[0]) aiLoadImageFile(input.files[0]);
}

function aiLoadImageFile(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const MAX = 700;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      aiImgW = Math.round(img.width  * scale);
      aiImgH = Math.round(img.height * scale);

      // Off-screen canvas at processing resolution
      const c = document.createElement('canvas');
      c.width = aiImgW; c.height = aiImgH;
      const cx = c.getContext('2d');
      cx.drawImage(img, 0, 0, aiImgW, aiImgH);
      aiImageData = cx.getImageData(0, 0, aiImgW, aiImgH);

      // Draw into the visible preview canvas
      aiPreviewCanvas = document.getElementById('ai-preview-canvas');
      aiPreviewCtx    = aiPreviewCanvas.getContext('2d');
      // Fit inside modal width (~500px)
      const dispW = Math.min(500, aiImgW);
      const dispH = Math.round(aiImgH * dispW / aiImgW);
      aiPreviewCanvas.width  = dispW;
      aiPreviewCanvas.height = dispH;
      aiPreviewCtx.drawImage(img, 0, 0, dispW, dispH);

      // Attach eyedropper events
      aiPreviewCanvas.addEventListener('click',      aiCanvasClick,     { passive: false });
      aiPreviewCanvas.addEventListener('mousemove',  aiCanvasMouseMove, { passive: false });
      aiPreviewCanvas.addEventListener('touchstart', aiCanvasTouchStart,{ passive: false });
      aiPreviewCanvas.addEventListener('touchmove',  aiCanvasTouchMove, { passive: false });
      aiPreviewCanvas.addEventListener('touchend',   aiCanvasTouchEnd,  { passive: false });

      document.getElementById('ai-drop').style.display = 'none';
      document.getElementById('ai-preview-wrap').style.display = 'block';
      setAIStatus('Pick track colour and background colour from the image, then Extract', '');
      document.getElementById('ai-run-btn').disabled = false;
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// ── Eyedropper state machine ──
function startEyedropper(mode) {
  aiEyedropperMode = mode;
  document.getElementById('eyedropper-hint').style.display = '';
  aiPreviewCanvas.style.cursor = 'crosshair';
  // highlight active pick button
  document.getElementById('track-pick-btn').style.background =
    mode === 'track' ? 'rgba(167,139,250,0.35)' : 'rgba(167,139,250,0.12)';
  document.getElementById('bg-pick-btn').style.background =
    mode === 'bg' ? 'rgba(167,139,250,0.35)' : 'rgba(167,139,250,0.12)';
}

function cancelEyedropper() {
  aiEyedropperMode = null;
  document.getElementById('eyedropper-hint').style.display = 'none';
  if (aiPreviewCanvas) aiPreviewCanvas.style.cursor = 'crosshair';
  document.getElementById('track-pick-btn').style.background = 'rgba(167,139,250,0.12)';
  document.getElementById('bg-pick-btn').style.background    = 'rgba(167,139,250,0.12)';
  document.getElementById('ai-loupe').style.display = 'none';
}

function aiGetImageXY(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const rx = (clientX - rect.left) / rect.width;
  const ry = (clientY - rect.top)  / rect.height;
  return {
    ix: Math.max(0, Math.min(aiImgW-1, Math.round(rx * aiImgW))),
    iy: Math.max(0, Math.min(aiImgH-1, Math.round(ry * aiImgH))),
    cx: clientX - rect.left,
    cy: clientY - rect.top,
    cw: rect.width,
    ch: rect.height
  };
}

function aiSamplePixel(ix, iy) {
  const i = (iy * aiImgW + ix) * 4;
  const d = aiImageData.data;
  return { r: d[i], g: d[i+1], b: d[i+2] };
}

function rgbToHex(rgb) {
  return '#' + [rgb.r, rgb.g, rgb.b].map(v => v.toString(16).padStart(2,'0')).join('');
}

function aiPickColour(clientX, clientY) {
  if (!aiEyedropperMode || !aiPreviewCanvas) return;
  const { ix, iy } = aiGetImageXY(aiPreviewCanvas, clientX, clientY);
  const rgb = aiSamplePixel(ix, iy);
  const hex = rgbToHex(rgb);
  if (aiEyedropperMode === 'track') {
    aiTrackRGB = rgb;
    document.getElementById('track-swatch').style.background = hex;
    document.getElementById('track-hex').textContent = hex.toUpperCase();
  } else {
    aiBgRGB = rgb;
    document.getElementById('bg-swatch').style.background = hex;
    document.getElementById('bg-hex').textContent = hex.toUpperCase();
  }
  cancelEyedropper();
  aiUpdatePreviewOverlay();
}

function aiShowLoupe(clientX, clientY) {
  if (!aiEyedropperMode || !aiPreviewCanvas) return;
  const loupe = document.getElementById('ai-loupe');
  const { ix, iy, cx, cy, cw, ch } = aiGetImageXY(aiPreviewCanvas, clientX, clientY);
  const LSIZE = 80, ZOOM = 6, HALF = LSIZE/2;
  loupe.width = loupe.height = LSIZE;
  loupe.style.width = loupe.style.height = LSIZE + 'px';
  loupe.style.display = 'block';
  // Position loupe offset from cursor
  let lx = cx + 20, ly = cy - LSIZE - 10;
  if (lx + LSIZE > cw) lx = cx - LSIZE - 20;
  if (ly < 0) ly = cy + 20;
  loupe.style.left = lx + 'px';
  loupe.style.top  = ly + 'px';
  const lc = loupe.getContext('2d');
  lc.imageSmoothingEnabled = false;
  lc.drawImage(aiPreviewCanvas,
    ix - HALF/ZOOM, iy - HALF/ZOOM, LSIZE/ZOOM, LSIZE/ZOOM,
    0, 0, LSIZE, LSIZE);
  // crosshair
  lc.strokeStyle = '#a78bfa'; lc.lineWidth = 1;
  lc.beginPath(); lc.moveTo(HALF,0); lc.lineTo(HALF,LSIZE); lc.stroke();
  lc.beginPath(); lc.moveTo(0,HALF); lc.lineTo(LSIZE,HALF); lc.stroke();
}

function aiCanvasClick(e) {
  if (!aiEyedropperMode) return;
  e.preventDefault();
  aiPickColour(e.clientX, e.clientY);
}
function aiCanvasMouseMove(e) {
  if (!aiEyedropperMode) return;
  aiShowLoupe(e.clientX, e.clientY);
}
function aiCanvasTouchStart(e) {
  if (!aiEyedropperMode) return;
  e.preventDefault();
  const t = e.touches[0];
  aiShowLoupe(t.clientX, t.clientY);
}
function aiCanvasTouchMove(e) {
  if (!aiEyedropperMode) return;
  e.preventDefault();
  const t = e.touches[0];
  aiShowLoupe(t.clientX, t.clientY);
}
function aiCanvasTouchEnd(e) {
  if (!aiEyedropperMode) return;
  e.preventDefault();
  const t = e.changedTouches[0];
  aiPickColour(t.clientX, t.clientY);
}

// ── Preview overlay: tint track pixels purple, BG pixels dark ──
function aiUpdatePreviewOverlay() {
  if (!aiPreviewCtx || !aiImageData) return;
  const tol = parseInt(document.getElementById('ai-tolerance').value);
  const pw = aiPreviewCanvas.width, ph = aiPreviewCanvas.height;
  const overlay = aiPreviewCtx.createImageData(pw, ph);

  for (let py = 0; py < ph; py++) {
    for (let px = 0; px < pw; px++) {
      // map display px → image px
      const ix = Math.round(px * aiImgW / pw);
      const iy = Math.round(py * aiImgH / ph);
      const si = (iy * aiImgW + ix) * 4;
      const r = aiImageData.data[si], g = aiImageData.data[si+1], b = aiImageData.data[si+2];
      const di = (py * pw + px) * 4;
      let isTrack = false, isBg = false;
      if (aiTrackRGB) {
        const dr=r-aiTrackRGB.r, dg=g-aiTrackRGB.g, db=b-aiTrackRGB.b;
        if (dr*dr+dg*dg+db*db < tol*tol) isTrack = true;
      }
      if (aiBgRGB) {
        const dr=r-aiBgRGB.r, dg=g-aiBgRGB.g, db=b-aiBgRGB.b;
        if (dr*dr+dg*dg+db*db < tol*tol) isBg = true;
      }
      if (isTrack) {
        overlay.data[di]=167; overlay.data[di+1]=139; overlay.data[di+2]=250; overlay.data[di+3]=200;
      } else if (isBg) {
        overlay.data[di]=0; overlay.data[di+1]=0; overlay.data[di+2]=0; overlay.data[di+3]=160;
      } else {
        overlay.data[di]=r; overlay.data[di+1]=g; overlay.data[di+2]=b; overlay.data[di+3]=80;
      }
    }
  }
  // Redraw base image first then overlay
  aiPreviewCtx.clearRect(0, 0, pw, ph);
  // Redraw source pixels
  const base = aiPreviewCtx.createImageData(pw, ph);
  for (let py=0; py<ph; py++) for (let px=0; px<pw; px++) {
    const ix=Math.round(px*aiImgW/pw), iy=Math.round(py*aiImgH/ph);
    const si=(iy*aiImgW+ix)*4, di=(py*pw+px)*4;
    base.data[di]=aiImageData.data[si]; base.data[di+1]=aiImageData.data[si+1];
    base.data[di+2]=aiImageData.data[si+2]; base.data[di+3]=255;
  }
  aiPreviewCtx.putImageData(base, 0, 0);
  aiPreviewCtx.putImageData(overlay, 0, 0);
}

function setAIStatus(msg, cls) {
  const el = document.getElementById('ai-status');
  el.textContent = msg;
  el.className = cls ? cls : '';
}
function setAIProgress(pct) {
  const bar  = document.getElementById('ai-progress');
  const fill = document.getElementById('ai-progress-bar');
  bar.style.display = 'block';
  fill.style.width  = pct + '%';
  if (pct >= 100) setTimeout(() => { bar.style.display='none'; fill.style.width='0%'; }, 600);
}

// Legacy stubs so old HTML onclick refs don't crash
function setTrackColour(c) { aiTrackColour = c; }
function setBgColour(c)    { aiBgColour    = c; }
function aiPreviewThresh() {}

// ═══════════════════════════════════════════════════════════════════
// MAIN PIPELINE v6.1
// Exact approach: erase background pixels by colour distance,
// remaining pixels = the track. Thin to centreline via grid
// cell centroids, then nearest-neighbour chain walk to order them.
// ═══════════════════════════════════════════════════════════════════
async function runAIConvert() {
  if (!aiImageData) { setAIStatus('Upload an image first', 'err'); return; }
  if (!aiTrackRGB)  { setAIStatus('Pick the track colour first — tap 🎯 Pick then tap on the track in the image', 'err'); return; }
  if (!aiBgRGB)     { setAIStatus('Pick the background colour first — tap 🎯 Pick then tap on the background', 'err'); return; }

  const btn = document.getElementById('ai-run-btn');
  btn.disabled = true;

  const W = aiImgW, H = aiImgH;
  const data = aiImageData.data;
  const wpCount = parseInt(document.getElementById('ai-wp-count').value);

  // ═══════════════════════════════════════════════════════════════════
  // PIPELINE v6.1 — Background removal → track mesh → ordered waypoints
  //
  // Core idea (user-specified):
  //   1. Remove every pixel that matches the background colour (with tolerance)
  //   2. The remaining pixels ARE the track — no guessing, no skeletonization
  //   3. Subdivide into a fine grid; each occupied cell gets one centroid point
  //   4. Double-BFS on that grid finds the two farthest endpoints of the track
  //   5. Greedy nearest-neighbour walk orders the centroids into a smooth path
  //   6. Downsample → light smooth → world coords
  // ═══════════════════════════════════════════════════════════════════

  setAIStatus('Step 1/4 — Removing background pixels…', '');
  setAIProgress(8);
  await new Promise(r => setTimeout(r, 10));

  // ── Step 1: erase background ──
  // Any pixel within colour-distance TOL of aiBgRGB is background.
  // Tolerance is adaptive: start at 40, expand if nothing survives.
  let bgTol = 50;
  let trackMask, trackCount;

  for (let attempt = 0; attempt < 4; attempt++) {
    const bgTolSq = bgTol * bgTol;
    trackMask  = new Uint8Array(W * H);
    trackCount = 0;
    for (let i = 0; i < W * H; i++) {
      const r = data[i*4], g = data[i*4+1], b = data[i*4+2];
      const dr = r - aiBgRGB.r, dg = g - aiBgRGB.g, db = b - aiBgRGB.b;
      if (dr*dr + dg*dg + db*db > bgTolSq) { trackMask[i] = 1; trackCount++; }
    }
    if (trackCount > 100) break;
    bgTol += 20; // loosen if too strict
  }

  if (trackCount < 100) {
    setAIStatus('Background removal left almost no pixels — try re-picking the background colour', 'err');
    btn.disabled = false; setAIProgress(0); document.getElementById('ai-progress').style.display = 'none';
    return;
  }

  setAIStatus('Step 2/4 — Finding largest track region…', '');
  setAIProgress(25);
  await new Promise(r => setTimeout(r, 10));

  // ── Step 2: flood-fill → keep only the largest connected blob ──
  // (removes noise specks and separate UI elements)
  const label = new Int32Array(W * H).fill(-1);
  let bestId = -1, bestCount = 0, compId = 0;
  const stk = [];
  for (let sy = 0; sy < H; sy++) {
    for (let sx = 0; sx < W; sx++) {
      const idx = sy * W + sx;
      if (!trackMask[idx] || label[idx] !== -1) continue;
      let count = 0;
      stk.push(idx); label[idx] = compId;
      while (stk.length) {
        const cur = stk.pop(); count++;
        const cy = Math.floor(cur / W), cx = cur % W;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dy && !dx) continue;
          const ny = cy + dy, nx = cx + dx;
          if (ny < 0 || ny >= H || nx < 0 || nx >= W) continue;
          const ni = ny * W + nx;
          if (trackMask[ni] && label[ni] === -1) { label[ni] = compId; stk.push(ni); }
        }
      }
      if (count > bestCount) { bestCount = count; bestId = compId; }
      compId++;
    }
  }

  if (bestId === -1 || bestCount < 50) {
    setAIStatus('No connected track found — re-pick colours or try a cleaner image', 'err');
    btn.disabled = false; setAIProgress(0); document.getElementById('ai-progress').style.display = 'none';
    return;
  }

  setAIStatus('Step 3/4 — Building grid centroids…', '');
  setAIProgress(45);
  await new Promise(r => setTimeout(r, 15));

  // ── Step 3: grid of centroids ──
  // cellSize is chosen so the grid is fine enough to capture all curves
  // but coarse enough that each cell has multiple pixels → stable centroid.
  // Target: ~4× more cells than wpCount so we have plenty to subsample from.
  const targetCells = wpCount * 4;
  const cellSize = Math.max(2, Math.min(16, Math.floor(Math.sqrt((W * H) / targetCells))));
  const GW = Math.ceil(W / cellSize);
  const GH = Math.ceil(H / cellSize);

  const cellXSum = new Float64Array(GW * GH);
  const cellYSum = new Float64Array(GW * GH);
  const cellN    = new Int32Array(GW * GH);

  for (let i = 0; i < W * H; i++) {
    if (label[i] !== bestId) continue;
    const px = i % W, py = Math.floor(i / W);
    const gx = Math.floor(px / cellSize), gy = Math.floor(py / cellSize);
    const gi = gy * GW + gx;
    cellXSum[gi] += px; cellYSum[gi] += py; cellN[gi]++;
  }

  const occupied = new Uint8Array(GW * GH);
  for (let gi = 0; gi < GW * GH; gi++) if (cellN[gi] > 0) occupied[gi] = 1;

  setAIStatus('Step 4/4 — Ordering waypoints…', '');
  setAIProgress(62);
  await new Promise(r => setTimeout(r, 15));

  // ── Step 4: double-BFS to find true track endpoints, then greedy walk ──
  function gridNeighbours8(gi) {
    const gx = gi % GW, gy = Math.floor(gi / GW);
    const nb = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dy && !dx) continue;
      const nx = gx + dx, ny = gy + dy;
      if (nx < 0 || nx >= GW || ny < 0 || ny >= GH) continue;
      const ni = ny * GW + nx;
      if (occupied[ni]) nb.push(ni);
    }
    return nb;
  }

  function bfsGrid(startGi) {
    const dist = new Int32Array(GW * GH).fill(-1);
    const q = [startGi]; dist[startGi] = 0; let qi = 0, far = startGi, maxD = 0;
    while (qi < q.length) {
      const cur = q[qi++];
      for (const nb of gridNeighbours8(cur)) {
        if (dist[nb] === -1) {
          dist[nb] = dist[cur] + 1; q.push(nb);
          if (dist[nb] > maxD) { maxD = dist[nb]; far = nb; }
        }
      }
    }
    return { dist, far };
  }

  let seed = -1;
  for (let gi = 0; gi < GW * GH; gi++) if (occupied[gi]) { seed = gi; break; }

  const r1 = bfsGrid(seed);
  const endA = r1.far;
  const r2 = bfsGrid(endA);
  const endB = r2.far;

  // Greedy walk: always step to the unvisited neighbour closest (in image space) to next point
  const visitedG = new Uint8Array(GW * GH);
  const chain = [];
  let cur = endA;
  visitedG[cur] = 1;
  chain.push(cur);

  for (let step = 0; step < GW * GH; step++) {
    const nbs = gridNeighbours8(cur).filter(n => !visitedG[n]);
    if (!nbs.length) break;
    // prefer neighbour with lowest BFS distance to endB (guided walk)
    let best = nbs[0], bestD = r2.dist[best] >= 0 ? r2.dist[best] : 9e9;
    for (const nb of nbs) {
      const d = r2.dist[nb] >= 0 ? r2.dist[nb] : 9e9;
      if (d < bestD) { bestD = d; best = nb; }
    }
    visitedG[best] = 1;
    chain.push(best);
    cur = best;
    if (cur === endB) break;
  }

  if (chain.length < 4) {
    setAIStatus('Could not order the track — re-pick colours', 'err');
    btn.disabled = false; setAIProgress(0); document.getElementById('ai-progress').style.display = 'none';
    return;
  }

  setAIProgress(80);
  await new Promise(r => setTimeout(r, 10));

  // ── Step 5: centroid per cell → raw waypoints ──
  const rawWPs = chain.map(gi => ({
    x: cellXSum[gi] / cellN[gi],
    y: cellYSum[gi] / cellN[gi]
  }));

  // ── Step 6: uniform downsample ──
  const sampled = [];
  const step = rawWPs.length / Math.min(wpCount, rawWPs.length);
  for (let i = 0; i < Math.min(wpCount, rawWPs.length); i++) {
    sampled.push(rawWPs[Math.min(rawWPs.length - 1, Math.round(i * step))]);
  }

  // ── Step 7: 2 passes of light smoothing (window=2) ──
  function smoothPass(pts, r) {
    return pts.map((p, i) => {
      let sx = 0, sy = 0, cnt = 0;
      for (let k = -r; k <= r; k++) {
        const idx = (i + k + pts.length) % pts.length;
        sx += pts[idx].x; sy += pts[idx].y; cnt++;
      }
      return { x: sx / cnt, y: sy / cnt };
    });
  }
  const smoothed = smoothPass(smoothPass(sampled, 2), 2);

  // ── Step 8: scale to world coords ──
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of smoothed) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const tW = maxX - minX || 1, tH = maxY - minY || 1;
  const scale = Math.min(mainCanvas.width * 0.82 / tW, mainCanvas.height * 0.82 / tH) / cam.zoom;
  const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;

  const newWPs = smoothed.map(p => ({
    x: (p.x - midX) * scale,
    y: (p.y - midY) * scale
  }));

  setAIProgress(100);
  waypoints = newWPs;
  updateWPList();
  render();
  setAIStatus(`✓ ${newWPs.length} waypoints · ${bestCount.toLocaleString()} track pixels · cell ${cellSize}px`, 'ok');
  btn.disabled = false;
  showToast(`${newWPs.length} waypoints placed!`);
}


// ═══════════════════════════════════════════════════
