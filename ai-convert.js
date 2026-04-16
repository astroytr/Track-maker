// TRACK IMAGE → WAYPOINTS  v6.4
// ═══════════════════════════════════════════════════
let aiImageData = null;
let aiImgW = 0, aiImgH = 0;
let aiTrackRGB = null;
let aiBgRGB    = null;
let aiEyedropperMode = null;
let aiPreviewCanvas  = null;
let aiPreviewCtx     = null;
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
      const MAX = 600;
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
      const modalBody = document.querySelector('.ai-body');
      const availW = modalBody ? modalBody.clientWidth - 32 : 300;
      const dispW = Math.min(availW, aiImgW);
      const dispH = Math.round(aiImgH * dispW / aiImgW);
      aiPreviewCanvas.width  = dispW;
      aiPreviewCanvas.height = dispH;
      aiPreviewCanvas.style.width  = dispW + 'px';
      aiPreviewCanvas.style.height = dispH + 'px';
      aiPreviewCtx.drawImage(img, 0, 0, dispW, dispH);

      aiPreviewCanvas.addEventListener('click',      aiCanvasClick,      { passive: false });
      aiPreviewCanvas.addEventListener('mousemove',  aiCanvasMouseMove,  { passive: false });
      aiPreviewCanvas.addEventListener('touchstart', aiCanvasTouchStart, { passive: false });
      aiPreviewCanvas.addEventListener('touchmove',  aiCanvasTouchMove,  { passive: false });
      aiPreviewCanvas.addEventListener('touchend',   aiCanvasTouchEnd,   { passive: false });

      document.getElementById('ai-drop').style.display = 'none';
      setAIStatus('Pick track colour and background colour from the image, then Extract', '');
      document.getElementById('ai-run-btn').disabled = false;

      setTimeout(() => aiPreviewCanvas.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 120);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// ── Eyedropper ──
function startEyedropper(mode) {
  if (!aiPreviewCanvas) { setAIStatus('Upload an image first', 'err'); return; }
  aiEyedropperMode = mode;
  document.getElementById('eyedropper-hint').style.display = '';
  aiPreviewCanvas.style.cursor = 'crosshair';
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
    ix: Math.max(0, Math.min(aiImgW - 1, Math.round(rx * aiImgW))),
    iy: Math.max(0, Math.min(aiImgH - 1, Math.round(ry * aiImgH))),
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
  return '#' + [rgb.r, rgb.g, rgb.b].map(v => v.toString(16).padStart(2, '0')).join('');
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
  lc.strokeStyle = '#a78bfa'; lc.lineWidth = 1;
  lc.beginPath(); lc.moveTo(HALF, 0); lc.lineTo(HALF, LSIZE); lc.stroke();
  lc.beginPath(); lc.moveTo(0, HALF); lc.lineTo(LSIZE, HALF); lc.stroke();
}

function aiCanvasClick(e)     { if (!aiEyedropperMode) return; e.preventDefault(); aiPickColour(e.clientX, e.clientY); }
function aiCanvasMouseMove(e) { if (!aiEyedropperMode) return; aiShowLoupe(e.clientX, e.clientY); }
function aiCanvasTouchStart(e){ if (!aiEyedropperMode) return; e.preventDefault(); aiShowLoupe(e.touches[0].clientX, e.touches[0].clientY); }
function aiCanvasTouchMove(e) { if (!aiEyedropperMode) return; e.preventDefault(); aiShowLoupe(e.touches[0].clientX, e.touches[0].clientY); }
function aiCanvasTouchEnd(e)  { if (!aiEyedropperMode) return; e.preventDefault(); aiPickColour(e.changedTouches[0].clientX, e.changedTouches[0].clientY); }

// FIX #4: Preview overlay now uses the same midpoint classifier as the pipeline
// (dT < dB) instead of the old fixed-tolerance approach, so what you see matches
// what gets extracted.
function aiUpdatePreviewOverlay() {
  if (!aiPreviewCtx || !aiImageData) return;
  const pw = aiPreviewCanvas.width, ph = aiPreviewCanvas.height;
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
  if (!aiTrackRGB && !aiBgRGB) return;

  for (let py = 0; py < ph; py++) {
    for (let px = 0; px < pw; px++) {
      const ix = Math.round(px * aiImgW / pw);
      const iy = Math.round(py * aiImgH / ph);
      const si = (iy * aiImgW + ix) * 4;
      const r = aiImageData.data[si], g = aiImageData.data[si+1], b = aiImageData.data[si+2];
      let isTrack = false, isBg = false;
      if (aiTrackRGB && aiBgRGB) {
        // Use the same classifier as the pipeline: midpoint decision boundary
        const dT = colDist2(r, g, b, aiTrackRGB);
        const dB = colDist2(r, g, b, aiBgRGB);
        isTrack = dT < dB;
        isBg    = !isTrack;
      } else if (aiTrackRGB) {
        const dT = colDist2(r, g, b, aiTrackRGB);
        isTrack = dT < 40*40;
      } else if (aiBgRGB) {
        const dB = colDist2(r, g, b, aiBgRGB);
        isBg = dB < 40*40;
      }
      if (isTrack) { aiPreviewCtx.globalAlpha=0.65; aiPreviewCtx.fillStyle='rgb(167,139,250)'; aiPreviewCtx.fillRect(px,py,1,1); }
      else if (isBg){ aiPreviewCtx.globalAlpha=0.55; aiPreviewCtx.fillStyle='rgb(0,0,0)';       aiPreviewCtx.fillRect(px,py,1,1); }
    }
  }
  aiPreviewCtx.globalAlpha = 1;
}

function setAIStatus(msg, cls) {
  const el = document.getElementById('ai-status');
  el.textContent = msg;
  el.className = cls || '';
}
function setAIProgress(pct) {
  const bar = document.getElementById('ai-progress'), fill = document.getElementById('ai-progress-bar');
  bar.style.display = 'block'; fill.style.width = pct + '%';
  if (pct >= 100) setTimeout(() => { bar.style.display='none'; fill.style.width='0%'; }, 600);
}

function setTrackColour(c) { aiTrackColour = c; }
function setBgColour(c)    { aiBgColour = c; }
function aiPreviewThresh() {}

// ═══════════════════════════════════════════════════════════════════
// PIPELINE v6.4
//
//   1. Build a BINARY MASK: pixel is "track" if closer to aiTrackRGB
//      than to aiBgRGB in colour space.
//   2. Morphological dilation (3×3) fills micro-gaps in thin stroke images
//      before thinning, preventing skeleton fragmentation.  [NEW]
//   3. Keep only the largest connected region (removes UI chrome, noise).
//   4. Zhang-Suen thinning → 1px skeleton.
//   5. Spur pruning: remove dead-end branches < 15px so the walker never
//      has to choose at stub junctions.  [NEW]
//   6. Walk skeleton with heading-continuity chain follower.
//   7. Loop closure: if track is a closed circuit, explicitly append start
//      point so waypoints form a true loop.  [NEW]
//   8. Uniform resample + 3-pass curvature-aware smooth (tension 0.65).  [NEW]
// ═══════════════════════════════════════════════════════════════════
async function runAIConvert() {
  if (!aiImageData) { setAIStatus('Upload an image first', 'err'); return; }
  if (!aiTrackRGB)  { setAIStatus('Pick the track colour first', 'err'); return; }
  if (!aiBgRGB)     { setAIStatus('Pick the background colour first', 'err'); return; }

  const btn = document.getElementById('ai-run-btn');
  btn.disabled = true;

  const W = aiImgW, H = aiImgH;
  const data = aiImageData.data;
  const wpCount = parseInt(document.getElementById('ai-wp-count').value);

  // ── Step 1: Colour-distance binary mask ──
  setAIStatus('Step 1/5 — Classifying pixels…', '');
  setAIProgress(8);
  await tick();

  const mask = new Uint8Array(W * H);
  let trackCount = 0;
  for (let i = 0; i < W * H; i++) {
    const r = data[i*4], g = data[i*4+1], b = data[i*4+2];
    const dT = colDist2(r, g, b, aiTrackRGB);
    const dB = colDist2(r, g, b, aiBgRGB);
    if (dT < dB) { mask[i] = 1; trackCount++; }
  }

  if (trackCount < 50) {
    setAIStatus('Too few track pixels — re-pick colours', 'err');
    btn.disabled = false; return;
  }

  // ── Step 2: Morphological dilation to fill micro-gaps ──
  // Thin stroke images (like reference outlines) can produce a fragmented mask.
  // A single 3×3 dilation pass expands each track pixel to its 8-neighbours,
  // bridging 1-pixel gaps so Zhang-Suen sees a continuous band to thin.
  setAIStatus('Step 2/5 — Filling gaps…', '');
  setAIProgress(16);
  await tick();

  const dilated = morphDilate(mask, W, H);

  // ── Step 3: Keep largest connected component ──
  setAIStatus('Step 3/5 — Finding track region…', '');
  setAIProgress(26);
  await tick();

  const comp = largestComponent(dilated, W, H);

  // ── Step 4: Zhang-Suen thinning → 1px skeleton ──
  setAIStatus('Step 4/5 — Skeletonising track…', '');
  setAIProgress(38);
  await tick();

  const skel = zhangSuenThin(comp, W, H);

  // ── Spur pruning: remove dead-end branches shorter than MIN_SPUR px ──
  // After thinning, junction artefacts leave short stubs. The walker's
  // heading heuristic handles most of them, but explicitly removing short
  // spurs means it never has to choose at those junctions at all.
  const MIN_SPUR = 15;
  pruneSpurs(skel, W, H, MIN_SPUR);

  // ── Step 5: Walk skeleton into ordered chain ──
  setAIStatus('Step 5/5 — Ordering waypoints…', '');
  setAIProgress(65);
  await tick();

  const chain = walkSkeleton(skel, W, H);

  if (chain.length < 4) {
    setAIStatus('Could not trace skeleton — try a cleaner image or re-pick colours', 'err');
    btn.disabled = false; return;
  }

  // ── Loop closure ──
  // If the first and last skeleton points are within CLOSE_THRESH pixels,
  // the track is a closed circuit. Append the start point so the resampler
  // and smoother treat it as a true closed loop.
  const CLOSE_THRESH = 8;
  const fc = chain[0], lc = chain[chain.length - 1];
  const closeDist = Math.sqrt((fc.x-lc.x)**2 + (fc.y-lc.y)**2);
  if (closeDist <= CLOSE_THRESH && closeDist > 0) {
    chain.push({ x: fc.x, y: fc.y });
  }

  setAIProgress(82);
  await tick();

  // ── Uniform resample ──
  const sampled = uniformResample(chain, wpCount);

  // ── Smooth (3 passes, curvature-aware, tension 0.65) ──
  // Extra pass + higher tension cleans staircase pixel-grid artefacts on
  // straights while the curvature-aware window still protects hairpins.
  let pts = sampled;
  for (let p = 0; p < 3; p++) pts = smoothPass(pts, 3, 0.65);

  // ── Scale to world coords ──
  let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
  for (const p of pts) {
    if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x;
    if(p.y<minY)minY=p.y; if(p.y>maxY)maxY=p.y;
  }
  const tW=maxX-minX||1, tH=maxY-minY||1;
  const sc = Math.min(mainCanvas.width*0.82/tW, mainCanvas.height*0.82/tH) / cam.zoom;
  const midX=(minX+maxX)/2, midY=(minY+maxY)/2;
  const newWPs = pts.map(p => ({ x:(p.x-midX)*sc, y:(p.y-midY)*sc }));

  setAIProgress(100);
  waypoints = newWPs;
  updateWPList();

  // ── Auto-place barriers into barrierSegments so the renderer picks them up ──
  autoPlaceTrackFeatures(newWPs);

  render();
  setAIStatus(`✓ ${newWPs.length} waypoints — barriers & surfaces auto-placed`, 'ok');
  btn.disabled = false;
  showToast(`${newWPs.length} waypoints placed! Barriers auto-generated.`);
}

// ── Helpers ──

function tick() { return new Promise(r => setTimeout(r, 10)); }

function colDist2(r, g, b, rgb) {
  const dr=r-rgb.r, dg=g-rgb.g, db=b-rgb.b;
  return dr*dr + dg*dg + db*db;
}

// Morphological 3×3 dilation.
// Every background pixel adjacent (8-connected) to a foreground pixel becomes
// foreground. Result is written to a new array so the pass is consistent.
function morphDilate(mask, W, H) {
  const out = new Uint8Array(mask);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (mask[y*W+x]) continue; // already set
      let hit = false;
      outer: for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (mask[(y+dy)*W+(x+dx)]) { hit = true; break outer; }
        }
      }
      if (hit) out[y*W+x] = 1;
    }
  }
  return out;
}

function largestComponent(mask, W, H) {
  // Use 4-connectivity (N/S/E/W only, no diagonals).
  // Why: with 8-connectivity, two track segments that pass close together
  // (like Raidillon and the pit straight at Spa) can share a diagonal
  // neighbour, merging into one fat blob. The skeleton of a fat blob sprouts
  // branches at every merge point, confusing the chain walker.
  // 4-connectivity keeps near-parallel segments as separate regions and
  // only the TRUE largest one (the full track loop) survives the filter.
  const DIRS = [[-1,0],[1,0],[0,-1],[0,1]]; // N S W E
  const label = new Int32Array(W * H).fill(-1);
  let bestId = -1, bestCount = 0, compId = 0;
  const stk = [];
  for (let sy = 0; sy < H; sy++) {
    for (let sx = 0; sx < W; sx++) {
      const idx = sy*W+sx;
      if (!mask[idx] || label[idx] !== -1) continue;
      let count = 0;
      stk.push(idx); label[idx] = compId;
      while (stk.length) {
        const cur = stk.pop(); count++;
        const cy = Math.floor(cur/W), cx = cur%W;
        for (const [dy,dx] of DIRS) {
          const ny=cy+dy, nx=cx+dx;
          if (ny<0||ny>=H||nx<0||nx>=W) continue;
          const ni=ny*W+nx;
          if (mask[ni] && label[ni]===-1) { label[ni]=compId; stk.push(ni); }
        }
      }
      if (count > bestCount) { bestCount=count; bestId=compId; }
      compId++;
    }
  }
  const out = new Uint8Array(W*H);
  for (let i=0; i<W*H; i++) if (label[i]===bestId) out[i]=1;
  return out;
}

// Zhang-Suen parallel thinning — produces a 1-pixel-wide skeleton
function zhangSuenThin(mask, W, H) {
  const img = new Uint8Array(mask); // copy
  let changed = true;
  const toDelete = [];

  while (changed) {
    changed = false;

    // Sub-iteration 1
    toDelete.length = 0;
    for (let y=1; y<H-1; y++) {
      for (let x=1; x<W-1; x++) {
        const i = y*W+x;
        if (!img[i]) continue;
        const [A, B, p2, p4, p6, p8] = zsParams(img, x, y, W);
        if (B>=2 && B<=6 && A===1 && p2*p4*p6===0 && p4*p6*p8===0) {
          toDelete.push(i); changed = true;
        }
      }
    }
    for (const i of toDelete) img[i] = 0;

    // Sub-iteration 2
    toDelete.length = 0;
    for (let y=1; y<H-1; y++) {
      for (let x=1; x<W-1; x++) {
        const i = y*W+x;
        if (!img[i]) continue;
        const [A, B, p2, p4, p6, p8] = zsParams(img, x, y, W);
        if (B>=2 && B<=6 && A===1 && p2*p4*p8===0 && p2*p6*p8===0) {
          toDelete.push(i); changed = true;
        }
      }
    }
    for (const i of toDelete) img[i] = 0;
  }
  return img;
}

function zsParams(img, x, y, W) {
  // 8-neighbours in order: p2=N, p3=NE, p4=E, p5=SE, p6=S, p7=SW, p8=W, p9=NW
  const p2=img[(y-1)*W+x], p3=img[(y-1)*W+(x+1)], p4=img[y*W+(x+1)], p5=img[(y+1)*W+(x+1)];
  const p6=img[(y+1)*W+x], p7=img[(y+1)*W+(x-1)], p8=img[y*W+(x-1)], p9=img[(y-1)*W+(x-1)];
  const B = p2+p3+p4+p5+p6+p7+p8+p9;
  // A = number of 0→1 transitions in the ordered sequence
  const seq=[p2,p3,p4,p5,p6,p7,p8,p9,p2];
  let A=0; for(let k=0;k<8;k++) if(!seq[k]&&seq[k+1]) A++;
  return [A, B, p2, p4, p6, p8];
}

// Spur pruning — iteratively removes dead-end branches shorter than minLen.
//
// A spur is a chain of pixels where one end has exactly 1 neighbour (endpoint)
// and the chain is shorter than minLen before reaching a junction (3+ neighbours).
// We repeatedly peel endpoints until no short spurs remain.
// This runs in O(skelPx * minLen) worst case and typically converges in minLen passes.
function pruneSpurs(skel, W, H, minLen) {
  function nb8count(idx) {
    const x = idx % W, y = Math.floor(idx / W);
    let c = 0;
    for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) {
      if (!dy&&!dx) continue;
      const nx=x+dx, ny=y+dy;
      if (nx<0||nx>=W||ny<0||ny>=H) continue;
      if (skel[ny*W+nx]) c++;
    }
    return c;
  }

  for (let pass = 0; pass < minLen; pass++) {
    let removed = false;
    for (let i = 0; i < W*H; i++) {
      if (!skel[i]) continue;
      if (nb8count(i) === 1) {
        // It's an endpoint — walk the spur to see how long it is
        let len = 0, cur = i;
        const visited = new Set();
        while (true) {
          visited.add(cur);
          len++;
          if (len >= minLen) break; // spur is long enough, keep it
          const cx = cur % W, cy = Math.floor(cur / W);
          let next = -1;
          for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) {
            if (!dy&&!dx) continue;
            const nx=cx+dx, ny=cy+dy;
            if (nx<0||nx>=W||ny<0||ny>=H) continue;
            const ni=ny*W+nx;
            if (skel[ni] && !visited.has(ni)) { next=ni; break; }
          }
          if (next === -1) break; // dead end of short isolated segment
          const nNb = nb8count(next);
          if (nNb >= 3) break; // reached a junction — spur ends here
          cur = next;
        }
        if (len < minLen) {
          // Remove all pixels in this spur
          for (const vi of visited) skel[vi] = 0;
          removed = true;
        }
      }
    }
    if (!removed) break; // stable
  }
}

// Walk skeleton into an ordered chain using direction continuity.
//
// Tracks current heading (dx, dy) and scores each candidate neighbour by
// alignment with that heading (dot product). The most-aligned neighbour wins,
// so the walker hugs the existing direction of travel through every junction.
function walkSkeleton(skel, W, H) {
  const skelPts = [];
  const idx2pt  = new Int32Array(W*H).fill(-1);
  for (let y=0; y<H; y++) for (let x=0; x<W; x++) {
    if (!skel[y*W+x]) continue;
    idx2pt[y*W+x] = skelPts.length;
    skelPts.push({ x, y, idx: y*W+x });
  }
  if (skelPts.length === 0) return [];

  function neighbours(pt) {
    const nb = [];
    for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) {
      if (!dy&&!dx) continue;
      const nx=pt.x+dx, ny=pt.y+dy;
      if (nx<0||nx>=W||ny<0||ny>=H) continue;
      const ni=ny*W+nx;
      if (skel[ni] && idx2pt[ni]!==-1) nb.push(idx2pt[ni]);
    }
    return nb;
  }

  // Find a true endpoint (exactly 1 neighbour) as the start.
  // If the skeleton is a pure closed loop there are no endpoints — fall back
  // to any pixel (the loop closure logic in runAIConvert handles the rest).
  let startPtIdx = 0;
  for (let k=0; k<skelPts.length; k++) {
    if (neighbours(skelPts[k]).length === 1) { startPtIdx = k; break; }
  }

  const visited = new Uint8Array(skelPts.length);
  const chain   = [];

  let hdx = 0, hdy = 0;
  let cur = startPtIdx;

  while (true) {
    visited[cur] = 1;
    chain.push({ x: skelPts[cur].x, y: skelPts[cur].y });

    const nbs = neighbours(skelPts[cur]).filter(n => !visited[n]);
    if (nbs.length === 0) break;

    const cp = skelPts[cur];

    if (nbs.length === 1 || (hdx === 0 && hdy === 0)) {
      cur = nbs[0];
    } else {
      let best = nbs[0], bestScore = -Infinity;
      for (const n of nbs) {
        const dx = skelPts[n].x - cp.x;
        const dy = skelPts[n].y - cp.y;
        const score = hdx * dx + hdy * dy;
        if (score > bestScore) { bestScore = score; best = n; }
      }
      cur = best;
    }

    // Update heading as exponential moving average for smooth direction tracking
    const ndx = skelPts[cur].x - cp.x;
    const ndy = skelPts[cur].y - cp.y;
    hdx = hdx * 0.7 + ndx * 0.3;
    hdy = hdy * 0.7 + ndy * 0.3;
  }

  // If < 80% of skeleton pixels are in chain, the skeleton had branches and the
  // walker stopped early. Collect any unvisited segments and append the longest.
  if (chain.length < skelPts.length * 0.8) {
    let bestExtra = [];
    for (let k=0; k<skelPts.length; k++) {
      if (visited[k]) continue;
      const frag = [];
      let fc = k;
      const fvis = new Uint8Array(skelPts.length);
      let fhdx=0, fhdy=0;
      while (true) {
        if (visited[fc] || fvis[fc]) break;
        fvis[fc] = 1;
        frag.push({ x: skelPts[fc].x, y: skelPts[fc].y });
        const fnbs = neighbours(skelPts[fc]).filter(n => !visited[n] && !fvis[n]);
        if (fnbs.length === 0) break;
        let fb = fnbs[0], fbScore = -Infinity;
        for (const n of fnbs) {
          const dx=skelPts[n].x-skelPts[fc].x, dy=skelPts[n].y-skelPts[fc].y;
          const s = fhdx*dx + fhdy*dy;
          if (s > fbScore) { fbScore=s; fb=n; }
        }
        const ndx2=skelPts[fb].x-skelPts[fc].x, ndy2=skelPts[fb].y-skelPts[fc].y;
        fhdx=fhdx*0.7+ndx2*0.3; fhdy=fhdy*0.7+ndy2*0.3;
        fc = fb;
      }
      if (frag.length > bestExtra.length) bestExtra = frag;
    }
    if (bestExtra.length > chain.length * 0.1) {
      chain.push(...bestExtra);
    }
  }

  return chain;
}

// Resample chain to exactly N evenly-spaced points using true arc-length
// parameterisation.
function uniformResample(chain, N) {
  if (chain.length < 2) return chain;

  const arcLen = [0];
  for (let i = 1; i < chain.length; i++) {
    const dx = chain[i].x - chain[i-1].x;
    const dy = chain[i].y - chain[i-1].y;
    arcLen.push(arcLen[i-1] + Math.sqrt(dx*dx + dy*dy));
  }
  const totalLen = arcLen[arcLen.length - 1];
  if (totalLen === 0) return chain;

  const out = [];
  let seg = 0;

  for (let i = 0; i < N; i++) {
    const target = (i / (N - 1)) * totalLen;
    while (seg < arcLen.length - 2 && arcLen[seg + 1] < target) seg++;
    const t0 = arcLen[seg], t1 = arcLen[seg + 1];
    const span = t1 - t0;
    const alpha = span < 1e-9 ? 0 : (target - t0) / span;
    const p0 = chain[seg], p1 = chain[Math.min(seg + 1, chain.length - 1)];
    out.push({
      x: p0.x + alpha * (p1.x - p0.x),
      y: p0.y + alpha * (p1.y - p0.y),
    });
  }
  return out;
}

// Curvature-aware Gaussian smooth.
// High-curvature points (hairpins) get a small window to preserve corners;
// low-curvature straights get a wider window to suppress pixel-grid noise.
function smoothPass(pts, _unusedRadius, tension = 0.65) {
  const n = pts.length;
  if (n < 3) return pts;

  const curvature = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur  = pts[i];
    const next = pts[(i + 1) % n];
    const ax = cur.x - prev.x, ay = cur.y - prev.y;
    const bx = next.x - cur.x, by = next.y - cur.y;
    const la = Math.sqrt(ax*ax + ay*ay), lb = Math.sqrt(bx*bx + by*by);
    if (la < 1e-9 || lb < 1e-9) { curvature[i] = 0; continue; }
    const cos = Math.max(-1, Math.min(1, (ax*bx + ay*by) / (la * lb)));
    curvature[i] = Math.acos(cos);
  }

  const MAX_R = 5;

  return pts.map((p, i) => {
    const curv01 = Math.min(1, curvature[i] / Math.PI);
    const r = Math.max(1, Math.round(MAX_R * (1 - curv01) * tension));
    const sigma = r / 2;
    let sx = 0, sy = 0, sw = 0;
    for (let k = -r; k <= r; k++) {
      const j = (i + k + n) % n;
      const w = Math.exp(-(k * k) / (2 * sigma * sigma));
      sx += pts[j].x * w;
      sy += pts[j].y * w;
      sw += w;
    }
    return { x: sx / sw, y: sy / sw };
  });
}

// ═══════════════════════════════════════════════════
// ═══════════════════════════════════════════════════
// AUTO FEATURE PLACEMENT  v2.0
//
// Analyses curvature of the extracted waypoints and writes
// directly into barrierSegments[] — the same array the renderer
// already uses for the manual barrier tool — so barriers appear
// immediately after AI extraction with no extra steps.
//
// Surface mapping:
//   Straights  → flat_kerb  (red/white)
//   Corners    → gravel     (tan)     ← outer runoff
//   Corners    → sausage    (yellow)  ← inner raised kerb
// Each zone becomes one barrierSegments entry, stacking as
// parallel bands thanks to the updated drawBarrierSegments().
// ═══════════════════════════════════════════════════

function autoPlaceTrackFeatures(wps) {
  if (!wps || wps.length < 4) return;

  const n = wps.length;
  const isClosed = (() => {
    const dx = wps[0].x - wps[n-1].x, dy = wps[0].y - wps[n-1].y;
    return Math.sqrt(dx*dx + dy*dy) < 20;
  })();

  // ── Curvature per waypoint ──────────────────────────────
  // Angle (radians) between incoming and outgoing tangents.
  // High = sharp corner, low = straight.
  const curvatures = wps.map((p, i) => {
    if (!isClosed && (i === 0 || i === n - 1)) return 0;
    const prev = wps[(i - 1 + n) % n];
    const next = wps[(i + 1) % n];
    const ax = p.x - prev.x, ay = p.y - prev.y;
    const bx = next.x - p.x, by = next.y - p.y;
    const la = Math.sqrt(ax*ax + ay*ay), lb = Math.sqrt(bx*bx + by*by);
    if (la < 1e-9 || lb < 1e-9) return 0;
    const dot = (ax*bx + ay*by) / (la * lb);
    return Math.acos(Math.max(-1, Math.min(1, dot)));
  });

  // ── Tunable thresholds ──────────────────────────────────
  const CORNER_THRESH  = 0.22;   // rad — above = corner
  const MIN_ZONE_LEN   = 3;      // min consecutive wps to form a zone
  // ────────────────────────────────────────────────────────

  const isCorner = curvatures.map(c => c > CORNER_THRESH);

  // Group consecutive same-type waypoints into zones
  function buildZones(flag) {
    const zones = [];
    let start = -1;
    for (let i = 0; i <= n; i++) {
      const on = i < n && flag[i];
      if (on  && start === -1) { start = i; }
      if (!on && start !== -1) {
        if (i - start >= MIN_ZONE_LEN) zones.push({ from: start, to: i - 1 });
        start = -1;
      }
    }
    return zones;
  }

  const cornerZones   = buildZones(isCorner);
  const straightZones = buildZones(isCorner.map(c => !c));

  // Clear any previous auto-placed barriers so re-running doesn't stack duplicates.
  // We tag auto-placed entries so manual ones are untouched.
  if (typeof barrierSegments !== 'undefined') {
    // Remove entries previously auto-placed (tagged with auto:true)
    for (let i = barrierSegments.length - 1; i >= 0; i--) {
      if (barrierSegments[i].auto) barrierSegments.splice(i, 1);
    }
  } else {
    window.barrierSegments = [];
  }

  // Helper to push a zone as a barrier segment
  function pushZone(zone, surfaceType) {
    barrierSegments.push({
      from:    zone.from,
      to:      zone.to,
      surface: surfaceType,
      auto:    true          // flag so we can clear on re-run
    });
  }

  // Straights → flat_kerb (the red/white edge stripe)
  straightZones.forEach(z => pushZone(z, 'flat_kerb'));

  // Corners → two bands: gravel on the outside runoff, sausage as raised inner kerb
  cornerZones.forEach(z => {
    pushZone(z, 'gravel');   // outer runoff — tan
    pushZone(z, 'sausage');  // raised kerb  — yellow, stacks inside gravel
  });

  // Update the sidebar barrier list if it exists
  if (typeof updateBarrierList === 'function') updateBarrierList();

  const nCorner   = cornerZones.length;
  const nStraight = straightZones.length;
  console.log(`[autoPlace] ${nCorner} corner zones (gravel+sausage) · ${nStraight} straight zones (flat_kerb)`);
}
