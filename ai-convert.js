// TRACK IMAGE → WAYPOINTS  v6.2
// Eyedropper colour picker + centreline skeleton + full-circuit walk
// ═══════════════════════════════════════════════════
let aiImageData = null;
let aiImgW = 0, aiImgH = 0;
let aiRawImage = null;
let aiTrackRGB = null;
let aiBgRGB    = null;
let aiEyedropperMode = null;
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
  // Remove any stale listeners before adding new ones
  if (aiPreviewCanvas) {
    aiPreviewCanvas.removeEventListener('click',      aiCanvasClick);
    aiPreviewCanvas.removeEventListener('mousemove',  aiCanvasMouseMove);
    aiPreviewCanvas.removeEventListener('touchstart', aiCanvasTouchStart);
    aiPreviewCanvas.removeEventListener('touchmove',  aiCanvasTouchMove);
    aiPreviewCanvas.removeEventListener('touchend',   aiCanvasTouchEnd);
  }

  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const MAX = 700;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      aiImgW = Math.round(img.width  * scale);
      aiImgH = Math.round(img.height * scale);

      const c = document.createElement('canvas');
      c.width = aiImgW; c.height = aiImgH;
      const cx = c.getContext('2d');
      cx.drawImage(img, 0, 0, aiImgW, aiImgH);
      aiImageData = cx.getImageData(0, 0, aiImgW, aiImgH);

      aiPreviewCanvas = document.getElementById('ai-preview-canvas');
      aiPreviewCtx    = aiPreviewCanvas.getContext('2d');
      document.getElementById('ai-preview-wrap').style.display = 'block';
      const modalBody = aiPreviewCanvas.closest('.ai-body') || document.querySelector('.ai-body');
      const availW = modalBody ? modalBody.clientWidth - 40 : 300;
      const dispW = Math.min(availW, aiImgW, 500);
      const dispH = Math.round(aiImgH * dispW / aiImgW);
      aiPreviewCanvas.width  = dispW;
      aiPreviewCanvas.height = dispH;
      aiPreviewCanvas.style.width  = dispW + 'px';
      aiPreviewCanvas.style.height = dispH + 'px';
      aiPreviewCtx.drawImage(img, 0, 0, dispW, dispH);

      aiPreviewCanvas.addEventListener('click',      aiCanvasClick,     { passive: false });
      aiPreviewCanvas.addEventListener('mousemove',  aiCanvasMouseMove, { passive: false });
      aiPreviewCanvas.addEventListener('touchstart', aiCanvasTouchStart,{ passive: false });
      aiPreviewCanvas.addEventListener('touchmove',  aiCanvasTouchMove, { passive: false });
      aiPreviewCanvas.addEventListener('touchend',   aiCanvasTouchEnd,  { passive: false });

      document.getElementById('ai-drop').style.display = 'none';
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
  if (aiPreviewCanvas) aiPreviewCanvas.style.cursor = 'crosshair';
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
  // Always sample from the original image data — never from the display canvas
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

// FIX: Loupe always draws from original aiImageData, not the display canvas.
// This ensures the loupe shows true colours even after the overlay is applied.
function aiShowLoupe(clientX, clientY) {
  if (!aiEyedropperMode || !aiPreviewCanvas || !aiImageData) return;
  const loupe = document.getElementById('ai-loupe');
  const { ix, iy, cx, cy, cw, ch } = aiGetImageXY(aiPreviewCanvas, clientX, clientY);
  const LSIZE = 80, ZOOM = 5, HALF = Math.floor(LSIZE / 2);
  loupe.width = loupe.height = LSIZE;
  loupe.style.width = loupe.style.height = LSIZE + 'px';
  loupe.style.display = 'block';

  let lx = cx + 20, ly = cy - LSIZE - 10;
  if (lx + LSIZE > cw) lx = cx - LSIZE - 20;
  if (ly < 0) ly = cy + 20;
  loupe.style.left = lx + 'px';
  loupe.style.top  = ly + 'px';

  const lc = loupe.getContext('2d');
  lc.imageSmoothingEnabled = false;

  // Build loupe pixels directly from aiImageData (original colours, never overlay)
  const loupeImg = lc.createImageData(LSIZE, LSIZE);
  for (let ly2 = 0; ly2 < LSIZE; ly2++) {
    for (let lx2 = 0; lx2 < LSIZE; lx2++) {
      const srcX = Math.max(0, Math.min(aiImgW - 1, ix + Math.round((lx2 - HALF) / ZOOM)));
      const srcY = Math.max(0, Math.min(aiImgH - 1, iy + Math.round((ly2 - HALF) / ZOOM)));
      const si = (srcY * aiImgW + srcX) * 4;
      const di = (ly2 * LSIZE + lx2) * 4;
      loupeImg.data[di]   = aiImageData.data[si];
      loupeImg.data[di+1] = aiImageData.data[si+1];
      loupeImg.data[di+2] = aiImageData.data[si+2];
      loupeImg.data[di+3] = 255;
    }
  }
  lc.putImageData(loupeImg, 0, 0);

  // Crosshair over loupe
  lc.strokeStyle = '#a78bfa';
  lc.lineWidth = 1;
  lc.beginPath(); lc.moveTo(HALF, 0); lc.lineTo(HALF, LSIZE); lc.stroke();
  lc.beginPath(); lc.moveTo(0, HALF); lc.lineTo(LSIZE, HALF); lc.stroke();
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

// FIX: Overlay compositing — draw base image first, then paint overlay on top
// using globalAlpha so the original image remains visible.
function aiUpdatePreviewOverlay() {
  if (!aiPreviewCtx || !aiImageData) return;
  const tol = parseInt(document.getElementById('ai-tolerance').value) || 40;
  const pw = aiPreviewCanvas.width, ph = aiPreviewCanvas.height;

  // Step 1: redraw the original image as the base
  const base = aiPreviewCtx.createImageData(pw, ph);
  for (let py = 0; py < ph; py++) {
    for (let px = 0; px < pw; px++) {
      const ix = Math.round(px * aiImgW / pw);
      const iy = Math.round(py * aiImgH / ph);
      const si = (iy * aiImgW + ix) * 4;
      const di = (py * pw + px) * 4;
      base.data[di]   = aiImageData.data[si];
      base.data[di+1] = aiImageData.data[si+1];
      base.data[di+2] = aiImageData.data[si+2];
      base.data[di+3] = 255;
    }
  }
  aiPreviewCtx.putImageData(base, 0, 0);

  // Step 2: paint overlay on top using globalAlpha (proper blending)
  if (!aiTrackRGB && !aiBgRGB) return;
  const tolSq = tol * tol;
  for (let py = 0; py < ph; py++) {
    for (let px = 0; px < pw; px++) {
      const ix = Math.round(px * aiImgW / pw);
      const iy = Math.round(py * aiImgH / ph);
      const si = (iy * aiImgW + ix) * 4;
      const r = aiImageData.data[si], g = aiImageData.data[si+1], b = aiImageData.data[si+2];

      let isTrack = false, isBg = false;
      if (aiTrackRGB) {
        const dr = r - aiTrackRGB.r, dg = g - aiTrackRGB.g, db = b - aiTrackRGB.b;
        if (dr*dr + dg*dg + db*db < tolSq) isTrack = true;
      }
      if (aiBgRGB) {
        const dr = r - aiBgRGB.r, dg = g - aiBgRGB.g, db = b - aiBgRGB.b;
        if (dr*dr + dg*dg + db*db < tolSq) isBg = true;
      }

      if (isTrack) {
        // Purple tint for track pixels — draw a 1×1 filled rect with alpha
        aiPreviewCtx.globalAlpha = 0.72;
        aiPreviewCtx.fillStyle = 'rgb(167,139,250)';
        aiPreviewCtx.fillRect(px, py, 1, 1);
      } else if (isBg) {
        // Dark tint for background pixels
        aiPreviewCtx.globalAlpha = 0.62;
        aiPreviewCtx.fillStyle = 'rgb(0,0,0)';
        aiPreviewCtx.fillRect(px, py, 1, 1);
      }
    }
  }
  aiPreviewCtx.globalAlpha = 1;
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

// Legacy stubs
function setTrackColour(c) { aiTrackColour = c; }
function setBgColour(c)    { aiBgColour    = c; }
function aiPreviewThresh() {}

// ═══════════════════════════════════════════════════════════════════
// MAIN PIPELINE v6.2
// Key improvements over v6.1:
//   • Centreline extraction via distance transform + local maxima
//     → walk follows track centre, not the full track width
//   • Full-circuit walk: continues past endB to capture the whole loop
//     → closed circuits are fully traced, not just half
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

  // ── Step 1: Background removal ──
  setAIStatus('Step 1/5 — Removing background pixels…', '');
  setAIProgress(5);
  await new Promise(r => setTimeout(r, 10));

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
    bgTol += 20;
  }

  if (trackCount < 100) {
    setAIStatus('Background removal left almost no pixels — try re-picking the background colour', 'err');
    btn.disabled = false; setAIProgress(0); document.getElementById('ai-progress').style.display = 'none';
    return;
  }

  // ── Step 2: Keep largest connected component ──
  setAIStatus('Step 2/5 — Finding largest track region…', '');
  setAIProgress(18);
  await new Promise(r => setTimeout(r, 10));

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

  // ── Step 3: Centreline extraction via distance transform + local maxima ──
  // BFS from background-adjacent pixels gives each track pixel its distance
  // to the nearest background. Pixels that are local maxima lie on the
  // centreline — equidistant from both edges of the track.
  setAIStatus('Step 3/5 — Extracting track centreline…', '');
  setAIProgress(32);
  await new Promise(r => setTimeout(r, 15));

  const distFromBg = new Int32Array(W * H).fill(-1);
  const bfsQ = [];
  let bfsQHead = 0;

  // Seed: track pixels that are adjacent to a non-track (background) pixel
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (label[i] !== bestId) continue;
      let adjBg = false;
      for (let dy = -1; dy <= 1 && !adjBg; dy++) {
        for (let dx = -1; dx <= 1 && !adjBg; dx++) {
          if (!dy && !dx) continue;
          const ny = y + dy, nx = x + dx;
          if (ny < 0 || ny >= H || nx < 0 || nx >= W) { adjBg = true; break; }
          const ni = ny * W + nx;
          if (label[ni] !== bestId) adjBg = true;
        }
      }
      if (adjBg) { distFromBg[i] = 0; bfsQ.push(i); }
    }
  }

  // BFS inward
  while (bfsQHead < bfsQ.length) {
    const cur = bfsQ[bfsQHead++];
    const cy = Math.floor(cur / W), cx = cur % W;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dy && !dx) continue;
        const ny = cy + dy, nx = cx + dx;
        if (ny < 0 || ny >= H || nx < 0 || nx >= W) continue;
        const ni = ny * W + nx;
        if (label[ni] === bestId && distFromBg[ni] === -1) {
          distFromBg[ni] = distFromBg[cur] + 1;
          bfsQ.push(ni);
        }
      }
    }
  }

  // Centreline = pixels where distance is a local maximum (>= all 8 neighbours)
  // We also keep pixels with distance=0 (single-pixel-wide track edges)
  // to ensure connectivity on thin parts.
  const centrelineMask = new Uint8Array(W * H);
  let centrelineCount = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (distFromBg[i] < 0) continue; // not a track pixel
      const d = distFromBg[i];
      let isLocalMax = true;
      for (let dy = -1; dy <= 1 && isLocalMax; dy++) {
        for (let dx = -1; dx <= 1 && isLocalMax; dx++) {
          if (!dy && !dx) continue;
          const ni = (y + dy) * W + (x + dx);
          if (distFromBg[ni] > d) isLocalMax = false;
        }
      }
      if (isLocalMax) { centrelineMask[i] = 1; centrelineCount++; }
    }
  }

  // Fallback: if centreline is too sparse (very thin track), use full track
  const maskToUse = centrelineCount >= 30 ? centrelineMask : trackMask;

  // ── Step 4: Grid of centroids (on centreline) ──
  setAIStatus('Step 4/5 — Building grid centroids…', '');
  setAIProgress(50);
  await new Promise(r => setTimeout(r, 15));

  const targetCells = wpCount * 4;
  const cellSize = Math.max(2, Math.min(16, Math.floor(Math.sqrt((W * H) / targetCells))));
  const GW = Math.ceil(W / cellSize);
  const GH = Math.ceil(H / cellSize);

  const cellXSum = new Float64Array(GW * GH);
  const cellYSum = new Float64Array(GW * GH);
  const cellN    = new Int32Array(GW * GH);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!maskToUse[i] || label[i] !== bestId) continue;
      const gx = Math.floor(x / cellSize), gy = Math.floor(y / cellSize);
      const gi = gy * GW + gx;
      cellXSum[gi] += x; cellYSum[gi] += y; cellN[gi]++;
    }
  }

  const occupied = new Uint8Array(GW * GH);
  for (let gi = 0; gi < GW * GH; gi++) if (cellN[gi] > 0) occupied[gi] = 1;

  // ── Step 5: Full-circuit walk ──
  // Double-BFS to find antipodal endpoints, then greedy walk the entire loop.
  // The key fix: after reaching endB, we continue walking any unvisited
  // neighbours — this captures the full closed circuit instead of half.
  setAIStatus('Step 5/5 — Ordering waypoints…', '');
  setAIProgress(65);
  await new Promise(r => setTimeout(r, 15));

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
    const q = [startGi]; dist[startGi] = 0;
    let qi = 0, far = startGi, maxD = 0;
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
  if (seed === -1) {
    setAIStatus('No grid cells found — re-pick colours', 'err');
    btn.disabled = false; setAIProgress(0); document.getElementById('ai-progress').style.display = 'none';
    return;
  }

  const r1   = bfsGrid(seed);
  const endA = r1.far;
  const r2   = bfsGrid(endA);
  const endB = r2.far;

  // Greedy walk starting from endA.
  // Phase 1 (guided): prefer cells with decreasing distance to endB.
  // Phase 2 (unguided): after reaching endB, continue to any unvisited neighbour.
  // This ensures the full closed loop is captured.
  const visitedG = new Uint8Array(GW * GH);
  const chain = [];
  let cur = endA;
  visitedG[cur] = 1;
  chain.push(cur);
  let guidedPhase = true;

  for (let step = 0; step < GW * GH; step++) {
    const nbs = gridNeighbours8(cur).filter(n => !visitedG[n]);
    if (!nbs.length) break;

    let best;
    if (guidedPhase) {
      // Guide toward endB using BFS distance
      best = nbs[0];
      let bestD = r2.dist[best] >= 0 ? r2.dist[best] : 9e9;
      for (const nb of nbs) {
        const d = r2.dist[nb] >= 0 ? r2.dist[nb] : 9e9;
        if (d < bestD) { bestD = d; best = nb; }
      }
      if (cur === endB) guidedPhase = false; // switch to free walk
    } else {
      // Free walk: pick nearest unvisited neighbour in image space
      const cx = (cur % GW) * cellSize, cy = Math.floor(cur / GW) * cellSize;
      best = nbs[0];
      let bestDist = Infinity;
      for (const nb of nbs) {
        const nx = (nb % GW) * cellSize, ny = Math.floor(nb / GW) * cellSize;
        const d = (nx - cx) * (nx - cx) + (ny - cy) * (ny - cy);
        if (d < bestDist) { bestDist = d; best = nb; }
      }
    }

    visitedG[best] = 1;
    chain.push(best);
    cur = best;
  }

  if (chain.length < 4) {
    setAIStatus('Could not order the track — re-pick colours', 'err');
    btn.disabled = false; setAIProgress(0); document.getElementById('ai-progress').style.display = 'none';
    return;
  }

  setAIProgress(82);
  await new Promise(r => setTimeout(r, 10));

  // ── Step 6: Centroid per cell → raw waypoints ──
  const rawWPs = chain.map(gi => ({
    x: cellXSum[gi] / cellN[gi],
    y: cellYSum[gi] / cellN[gi]
  }));

  // ── Step 7: Uniform downsample ──
  const sampled = [];
  const step = rawWPs.length / Math.min(wpCount, rawWPs.length);
  for (let i = 0; i < Math.min(wpCount, rawWPs.length); i++) {
    sampled.push(rawWPs[Math.min(rawWPs.length - 1, Math.round(i * step))]);
  }

  // ── Step 8: Light smoothing (2 passes, window=2) ──
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

  // ── Step 9: Scale to world coords ──
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
  setAIStatus(`✓ ${newWPs.length} waypoints · ${bestCount.toLocaleString()} track pixels · centreline: ${centrelineCount} px`, 'ok');
  btn.disabled = false;
  showToast(`${newWPs.length} waypoints placed!`);
}

// ═══════════════════════════════════════════════════
