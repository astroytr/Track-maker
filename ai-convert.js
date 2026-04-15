// TRACK IMAGE → WAYPOINTS  v6.3
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

function aiUpdatePreviewOverlay() {
  if (!aiPreviewCtx || !aiImageData) return;
  const tol = 40;
  const tolSq = tol * tol;
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
      if (aiTrackRGB) { const dr=r-aiTrackRGB.r,dg=g-aiTrackRGB.g,db=b-aiTrackRGB.b; if(dr*dr+dg*dg+db*db<tolSq) isTrack=true; }
      if (aiBgRGB)    { const dr=r-aiBgRGB.r,   dg=g-aiBgRGB.g,   db=b-aiBgRGB.b;    if(dr*dr+dg*dg+db*db<tolSq) isBg=true; }
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
// PIPELINE v6.3
//
// The key insight this version gets right:
//   1. Build a BINARY MASK: pixel is "track" if it's closer to aiTrackRGB
//      than to aiBgRGB in colour space. This uses BOTH picked colours
//      properly instead of just erasing background.
//   2. Keep only the largest connected region (removes UI chrome, noise).
//   3. Compute a TRUE MEDIAL AXIS via iterative border erosion (Zhang-Suen
//      thinning). This gives a 1-pixel-wide skeleton that follows the
//      exact centreline of the track band — no gaps, no doubles.
//   4. Walk the skeleton with a simple chain-following algorithm that
//      never backtracks, producing correctly ordered waypoints.
//   5. Uniform resample + smooth → world coords.
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
  // A pixel belongs to "track" if dist-to-trackRGB < dist-to-bgRGB.
  // This properly uses BOTH colours — much more accurate than bg-only removal.
  setAIStatus('Step 1/4 — Classifying pixels…', '');
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

  // ── Step 2: Keep largest connected component ──
  setAIStatus('Step 2/4 — Finding track region…', '');
  setAIProgress(20);
  await tick();

  const comp = largestComponent(mask, W, H);
  // comp is a Uint8Array where 1 = belongs to largest region

  // ── Step 3: Zhang-Suen thinning → 1px skeleton ──
  setAIStatus('Step 3/4 — Skeletonising track…', '');
  setAIProgress(35);
  await tick();

  const skel = zhangSuenThin(comp, W, H);

  // ── Step 4: Walk skeleton into ordered chain ──
  setAIStatus('Step 4/4 — Ordering waypoints…', '');
  setAIProgress(65);
  await tick();

  const chain = walkSkeleton(skel, W, H);

  if (chain.length < 4) {
    setAIStatus('Could not trace skeleton — try a cleaner image or re-pick colours', 'err');
    btn.disabled = false; return;
  }

  setAIProgress(82);
  await tick();

  // ── Uniform resample ──
  const sampled = uniformResample(chain, wpCount);

  // ── Smooth (3 passes, window 3) ──
  let pts = sampled;
  for (let p = 0; p < 3; p++) pts = smoothPass(pts, 3);

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
  render();
  setAIStatus(`✓ ${newWPs.length} waypoints extracted`, 'ok');
  btn.disabled = false;
  showToast(`${newWPs.length} waypoints placed!`);
}

// ── Helpers ──

function tick() { return new Promise(r => setTimeout(r, 10)); }

function colDist2(r, g, b, rgb) {
  const dr=r-rgb.r, dg=g-rgb.g, db=b-rgb.b;
  return dr*dr + dg*dg + db*db;
}

function largestComponent(mask, W, H) {
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
        for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) {
          if (!dy && !dx) continue;
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

// Walk skeleton: find an endpoint (1 neighbour) or any pixel, then follow
// the chain greedily without revisiting. Handles both open and closed loops.
function walkSkeleton(skel, W, H) {
  // Build neighbour list for each skeleton pixel
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

  // Find an endpoint (pixel with exactly 1 skeleton neighbour) to start from
  // If none (pure loop), start from any pixel
  let startPtIdx = 0;
  for (let k=0; k<skelPts.length; k++) {
    if (neighbours(skelPts[k]).length === 1) { startPtIdx = k; break; }
  }

  const visited = new Uint8Array(skelPts.length);
  const chain = [];
  let cur = startPtIdx;

  while (true) {
    visited[cur] = 1;
    chain.push({ x: skelPts[cur].x, y: skelPts[cur].y });
    const nbs = neighbours(skelPts[cur]).filter(n => !visited[n]);
    if (nbs.length === 0) break;
    // Pick the neighbour that is spatially closest (avoids diagonal jumps)
    const cp = skelPts[cur];
    let best = nbs[0], bestD = Infinity;
    for (const n of nbs) {
      const dx=skelPts[n].x-cp.x, dy=skelPts[n].y-cp.y;
      const d=dx*dx+dy*dy;
      if (d<bestD) { bestD=d; best=n; }
    }
    cur = best;
  }

  return chain;
}

// Resample chain to exactly N evenly-spaced points
function uniformResample(chain, N) {
  if (chain.length <= N) return chain;
  const step = (chain.length - 1) / (N - 1);
  const out = [];
  for (let i = 0; i < N; i++) {
    out.push(chain[Math.min(chain.length-1, Math.round(i*step))]);
  }
  return out;
}

function smoothPass(pts, r) {
  const n = pts.length;
  return pts.map((p, i) => {
    let sx=0, sy=0, cnt=0;
    for (let k=-r; k<=r; k++) {
      const j=(i+k+n)%n;
      sx+=pts[j].x; sy+=pts[j].y; cnt++;
    }
    return { x:sx/cnt, y:sy/cnt };
  });
}

// ═══════════════════════════════════════════════════
