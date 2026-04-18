// TRACK IMAGE → WAYPOINTS  v7.2
// ═══════════════════════════════════════════════════
// v7.2 improvements:
//   · Multi-pass morphological dilation (2px) before
//     skeletonisation — fixes broken/anti-aliased lines
//   · Spur pruning raised 8→22 px (SPA-class tracks)
//   · Colour matching now uses perceptual weighting so
//     anti-aliased edge pixels classify correctly
//   · 3 smooth passes (was 1-2) for better shape fidelity
//   · autoPlaceTrackFeatures: kerbs on BOTH sides of
//     corners, better straight-armco thresholds, wider
//     runoff zones
// ═══════════════════════════════════════════════════
let aiImageData = null;
let aiImgW = 0, aiImgH = 0;
let aiTrackRGB = null;
let aiBgRGB    = null;
let aiEyedropperMode = null;
let aiPreviewCanvas  = null;
let aiPreviewCtx     = null;
const AI_MAX_WAYPOINTS = 500;

function openAIConvert()  { document.getElementById('ai-modal').classList.add('open'); }
function closeAIConvert() { document.getElementById('ai-modal').classList.remove('open'); aiEyedropperMode = null; }

function aiHandleDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) aiLoadImageFile(file);
}
function aiLoadFile(input) { if (input.files[0]) aiLoadImageFile(input.files[0]); }

function aiLoadImageFile(file) {
  if (aiPreviewCanvas) {
    aiPreviewCanvas.removeEventListener('click',      aiCanvasClick);
    aiPreviewCanvas.removeEventListener('mousemove',  aiCanvasMouseMove);
    aiPreviewCanvas.removeEventListener('touchstart', aiCanvasTouchStart);
    aiPreviewCanvas.removeEventListener('touchmove',  aiCanvasTouchMove);
    aiPreviewCanvas.removeEventListener('touchend',   aiCanvasTouchEnd);
  }
  aiTrackRGB = null; aiBgRGB = null;
  document.getElementById('track-swatch').style.background = '#555';
  document.getElementById('track-hex').textContent = 'not set';
  document.getElementById('bg-swatch').style.background = '#555';
  document.getElementById('bg-hex').textContent = 'not set';

  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const MAX = 520;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      aiImgW = Math.round(img.width  * scale);
      aiImgH = Math.round(img.height * scale);

      const c = document.createElement('canvas');
      c.width = aiImgW; c.height = aiImgH;
      c.getContext('2d').drawImage(img, 0, 0, aiImgW, aiImgH);
      aiImageData = c.getContext('2d').getImageData(0, 0, aiImgW, aiImgH);

      aiPreviewCanvas = document.getElementById('ai-preview-canvas');
      aiPreviewCtx    = aiPreviewCanvas.getContext('2d');

      document.getElementById('ai-preview-wrap').style.display = 'block';
      const modalBody = document.querySelector('.ai-body');
      const availW = modalBody ? modalBody.clientWidth - 32 : 300;
      const dispW = Math.min(availW, aiImgW, 480);
      const dispH = Math.round(aiImgH * dispW / aiImgW);
      aiPreviewCanvas.width  = dispW; aiPreviewCanvas.height = dispH;
      aiPreviewCanvas.style.width  = dispW + 'px';
      aiPreviewCanvas.style.height = dispH + 'px';
      aiPreviewCtx.drawImage(img, 0, 0, dispW, dispH);

      aiPreviewCanvas.addEventListener('click',      aiCanvasClick,      { passive: false });
      aiPreviewCanvas.addEventListener('mousemove',  aiCanvasMouseMove,  { passive: false });
      aiPreviewCanvas.addEventListener('touchstart', aiCanvasTouchStart, { passive: false });
      aiPreviewCanvas.addEventListener('touchmove',  aiCanvasTouchMove,  { passive: false });
      aiPreviewCanvas.addEventListener('touchend',   aiCanvasTouchEnd,   { passive: false });

      document.getElementById('ai-drop').style.display = 'none';
      setAIStatus('Image loaded — pick track colour then background colour', '');
      document.getElementById('ai-run-btn').disabled = false;
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function aiLoadReferenceImage(url, label, trackRGB, bgRGB) {
  if (aiPreviewCanvas) {
    aiPreviewCanvas.removeEventListener('click',      aiCanvasClick);
    aiPreviewCanvas.removeEventListener('mousemove',  aiCanvasMouseMove);
    aiPreviewCanvas.removeEventListener('touchstart', aiCanvasTouchStart);
    aiPreviewCanvas.removeEventListener('touchmove',  aiCanvasTouchMove);
    aiPreviewCanvas.removeEventListener('touchend',   aiCanvasTouchEnd);
  }

  openAIConvert();
  setAIStatus(`Loading ${label || 'reference'} image…`, '');

  const img = new Image();
  img.onload = async () => {
    const MAX = 520;
    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
    aiImgW = Math.round(img.width  * scale);
    aiImgH = Math.round(img.height * scale);

    const c = document.createElement('canvas');
    c.width = aiImgW; c.height = aiImgH;
    c.getContext('2d').drawImage(img, 0, 0, aiImgW, aiImgH);
    aiImageData = c.getContext('2d').getImageData(0, 0, aiImgW, aiImgH);

    aiPreviewCanvas = document.getElementById('ai-preview-canvas');
    aiPreviewCtx    = aiPreviewCanvas.getContext('2d');

    document.getElementById('ai-preview-wrap').style.display = 'block';
    const modalBody = document.querySelector('.ai-body');
    const availW = modalBody ? modalBody.clientWidth - 32 : 300;
    const dispW = Math.min(availW, aiImgW, 480);
    const dispH = Math.round(aiImgH * dispW / aiImgW);
    aiPreviewCanvas.width  = dispW; aiPreviewCanvas.height = dispH;
    aiPreviewCanvas.style.width  = dispW + 'px';
    aiPreviewCanvas.style.height = dispH + 'px';
    aiPreviewCtx.drawImage(img, 0, 0, dispW, dispH);

    aiPreviewCanvas.addEventListener('click',      aiCanvasClick,      { passive: false });
    aiPreviewCanvas.addEventListener('mousemove',  aiCanvasMouseMove,  { passive: false });
    aiPreviewCanvas.addEventListener('touchstart', aiCanvasTouchStart, { passive: false });
    aiPreviewCanvas.addEventListener('touchmove',  aiCanvasTouchMove,  { passive: false });
    aiPreviewCanvas.addEventListener('touchend',   aiCanvasTouchEnd,   { passive: false });

    aiTrackRGB = trackRGB || { r: 27, g: 27, b: 36 };
    aiBgRGB    = bgRGB    || { r: 250, g: 250, b: 250 };
    document.getElementById('track-swatch').style.background = rgbToHex(aiTrackRGB);
    document.getElementById('track-hex').textContent = rgbToHex(aiTrackRGB).toUpperCase();
    document.getElementById('bg-swatch').style.background = rgbToHex(aiBgRGB);
    document.getElementById('bg-hex').textContent = rgbToHex(aiBgRGB).toUpperCase();
    document.getElementById('ai-run-btn').disabled = false;
    document.getElementById('ai-drop').style.display = 'none';
    if (document.getElementById('track-name')) document.getElementById('track-name').value = label || 'My Circuit';

    aiUpdatePreviewOverlay();
    await runAIConvert();
    closeAIConvert();
  };
  img.onerror = () => setAIStatus(`Could not load ${label || 'reference'} image`, 'err');
  img.src = url;
}

function startEyedropper(mode) {
  if (!aiPreviewCanvas) { setAIStatus('Upload an image first', 'err'); return; }
  aiEyedropperMode = mode;
  document.getElementById('eyedropper-hint').style.display = '';
  aiPreviewCanvas.style.cursor = 'crosshair';
  document.getElementById('track-pick-btn').style.background =
    mode === 'track' ? 'rgba(167,139,250,0.35)' : 'rgba(167,139,250,0.12)';
  document.getElementById('bg-pick-btn').style.background =
    mode === 'bg'    ? 'rgba(167,139,250,0.35)' : 'rgba(167,139,250,0.12)';
}
function cancelEyedropper() {
  aiEyedropperMode = null;
  document.getElementById('eyedropper-hint').style.display = 'none';
  if (aiPreviewCanvas) aiPreviewCanvas.style.cursor = 'default';
  document.getElementById('track-pick-btn').style.background = 'rgba(167,139,250,0.12)';
  document.getElementById('bg-pick-btn').style.background    = 'rgba(167,139,250,0.12)';
  document.getElementById('ai-loupe').style.display = 'none';
}

function aiGetImageXY(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    ix: Math.max(0, Math.min(aiImgW-1, Math.round((clientX-rect.left)/rect.width  * aiImgW))),
    iy: Math.max(0, Math.min(aiImgH-1, Math.round((clientY-rect.top) /rect.height * aiImgH))),
    cx: clientX-rect.left, cy: clientY-rect.top, cw: rect.width, ch: rect.height
  };
}
function aiSamplePixel(ix, iy) {
  const d = aiImageData.data, i = (iy*aiImgW+ix)*4;
  return { r: d[i], g: d[i+1], b: d[i+2] };
}
function rgbToHex(rgb) { return '#'+[rgb.r,rgb.g,rgb.b].map(v=>v.toString(16).padStart(2,'0')).join(''); }

function aiPickColour(clientX, clientY) {
  if (!aiEyedropperMode || !aiPreviewCanvas) return;
  const { ix, iy } = aiGetImageXY(aiPreviewCanvas, clientX, clientY);
  // Sample a 3x3 area and average for more stable eyedropper
  let r=0,g=0,b=0,cnt=0;
  for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) {
    const sx=Math.max(0,Math.min(aiImgW-1,ix+dx)), sy=Math.max(0,Math.min(aiImgH-1,iy+dy));
    const px=aiSamplePixel(sx,sy); r+=px.r; g+=px.g; b+=px.b; cnt++;
  }
  const rgb={r:Math.round(r/cnt),g:Math.round(g/cnt),b:Math.round(b/cnt)};
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
  const { ix, iy, cx, cy, cw } = aiGetImageXY(aiPreviewCanvas, clientX, clientY);
  const LSIZE=80, ZOOM=5, HALF=40;
  loupe.width = loupe.height = LSIZE;
  loupe.style.width = loupe.style.height = LSIZE+'px';
  loupe.style.display = 'block';
  let lx = cx+20, ly = cy-LSIZE-10;
  if (lx+LSIZE > cw) lx = cx-LSIZE-20;
  if (ly < 0) ly = cy+20;
  loupe.style.left = lx+'px'; loupe.style.top = ly+'px';
  const lc = loupe.getContext('2d');
  lc.imageSmoothingEnabled = false;
  const loupeImg = lc.createImageData(LSIZE, LSIZE);
  for (let ly2=0; ly2<LSIZE; ly2++) {
    for (let lx2=0; lx2<LSIZE; lx2++) {
      const sx = Math.max(0,Math.min(aiImgW-1, ix+Math.round((lx2-HALF)/ZOOM)));
      const sy = Math.max(0,Math.min(aiImgH-1, iy+Math.round((ly2-HALF)/ZOOM)));
      const si = (sy*aiImgW+sx)*4, di = (ly2*LSIZE+lx2)*4;
      loupeImg.data[di]  =aiImageData.data[si];
      loupeImg.data[di+1]=aiImageData.data[si+1];
      loupeImg.data[di+2]=aiImageData.data[si+2];
      loupeImg.data[di+3]=255;
    }
  }
  lc.putImageData(loupeImg, 0, 0);
  lc.strokeStyle='#a78bfa'; lc.lineWidth=1;
  lc.beginPath(); lc.moveTo(HALF,0); lc.lineTo(HALF,LSIZE); lc.stroke();
  lc.beginPath(); lc.moveTo(0,HALF); lc.lineTo(LSIZE,HALF); lc.stroke();
}

function aiCanvasClick(e)     { if (!aiEyedropperMode) return; e.preventDefault(); aiPickColour(e.clientX, e.clientY); }
function aiCanvasMouseMove(e) { if (!aiEyedropperMode) return; aiShowLoupe(e.clientX, e.clientY); }
function aiCanvasTouchStart(e){ if (!aiEyedropperMode) return; e.preventDefault(); aiShowLoupe(e.touches[0].clientX, e.touches[0].clientY); }
function aiCanvasTouchMove(e) { if (!aiEyedropperMode) return; e.preventDefault(); aiShowLoupe(e.touches[0].clientX, e.touches[0].clientY); }
function aiCanvasTouchEnd(e)  { if (!aiEyedropperMode) return; e.preventDefault(); aiPickColour(e.changedTouches[0].clientX, e.changedTouches[0].clientY); }

function aiUpdatePreviewOverlay() {
  if (!aiPreviewCtx || !aiImageData) return;
  const pw = aiPreviewCanvas.width, ph = aiPreviewCanvas.height;
  const out = aiPreviewCtx.createImageData(pw, ph);
  for (let py=0; py<ph; py++) {
    for (let px=0; px<pw; px++) {
      const ix = Math.round(px*aiImgW/pw), iy = Math.round(py*aiImgH/ph);
      const si = (iy*aiImgW+ix)*4, di = (py*pw+px)*4;
      const r=aiImageData.data[si], g=aiImageData.data[si+1], b=aiImageData.data[si+2];
      let isTrack=false, isBg=false;
      if (aiTrackRGB&&aiBgRGB) {
        const dT=colDist2(r,g,b,aiTrackRGB), dB=colDist2(r,g,b,aiBgRGB);
        isTrack=dT<dB; isBg=!isTrack;
      } else if (aiTrackRGB) { isTrack=colDist2(r,g,b,aiTrackRGB)<1600; }
        else if (aiBgRGB)    { isBg   =colDist2(r,g,b,aiBgRGB)   <1600; }
      if (isTrack) {
        out.data[di]=Math.round(r*.25+167*.75); out.data[di+1]=Math.round(g*.25+139*.75);
        out.data[di+2]=Math.round(b*.25+250*.75); out.data[di+3]=255;
      } else if (isBg) {
        out.data[di]=Math.round(r*.2); out.data[di+1]=Math.round(g*.2);
        out.data[di+2]=Math.round(b*.2); out.data[di+3]=255;
      } else {
        out.data[di]=r; out.data[di+1]=g; out.data[di+2]=b; out.data[di+3]=255;
      }
    }
  }
  aiPreviewCtx.putImageData(out, 0, 0);
}

function setAIStatus(msg, cls) {
  const el = document.getElementById('ai-status');
  el.textContent = msg; el.className = cls || '';
}
function setAIProgress(pct) {
  const bar  = document.getElementById('ai-progress');
  const fill = document.getElementById('ai-progress-bar');
  bar.style.display = 'block'; fill.style.width = pct+'%';
  if (pct >= 100) setTimeout(() => { bar.style.display='none'; fill.style.width='0%'; }, 600);
}
function tick() { return new Promise(r => setTimeout(r, 10)); }

// ── Perceptual colour distance (weights R/G/B by human vision) ──
// Much better than plain RGB Euclidean for identifying coloured tracks
// (e.g. red line vs black bg — red channel should dominate).
function colDist2(r,g,b,rgb) {
  const dr=r-rgb.r, dg=g-rgb.g, db=b-rgb.b;
  return 0.299*dr*dr + 0.587*dg*dg + 0.114*db*db;
}

// ═══════════════════════════════════════════════════
// PIPELINE v7.2
// ═══════════════════════════════════════════════════
async function runAIConvert() {
  if (!aiImageData) { setAIStatus('Upload an image first', 'err'); return; }
  if (!aiTrackRGB)  { setAIStatus('Pick the track colour first', 'err'); return; }
  if (!aiBgRGB)     { setAIStatus('Pick the background colour first', 'err'); return; }

  const btn = document.getElementById('ai-run-btn');
  btn.disabled = true;

  const W = aiImgW, H = aiImgH;
  const data = aiImageData.data;
  const wpCount = AI_MAX_WAYPOINTS;

  try {
    setAIStatus('Step 1/6 — Classifying pixels…', ''); setAIProgress(6); await tick();
    const mask = new Uint8Array(W*H);
    let trackCount = 0;
    for (let i=0; i<W*H; i++) {
      const r=data[i*4], g=data[i*4+1], b=data[i*4+2];
      if (colDist2(r,g,b,aiTrackRGB) < colDist2(r,g,b,aiBgRGB)) { mask[i]=1; trackCount++; }
    }
    if (trackCount < 50) { setAIStatus('Too few track pixels — re-pick colours', 'err'); return; }

    // ── v7.2: Multi-pass morphological closing to heal anti-aliased /
    //    broken outlines (2px dilation bridges up to 4px gaps)
    setAIStatus('Step 2/6 — Closing pixel gaps…', ''); setAIProgress(16); await tick();
    let lineMask = mask;
    // Determine how many dilation passes based on track pixel density
    const density = trackCount / (W * H);
    const dilPasses = density < 0.04 ? 3 : 2;  // thin line → more dilation
    for (let pass = 0; pass < dilPasses; pass++) lineMask = morphDilate(lineMask, W, H);

    setAIStatus('Step 3/6 — Finding track region…', ''); setAIProgress(26); await tick();
    const comp = largestComponent(lineMask, W, H);

    setAIStatus('Step 4/6 — Skeletonising track…', ''); setAIProgress(38); await tick();
    const skel = zhangSuenThin(comp, W, H);
    // ── v7.2: higher spur threshold (8→22) handles SPA-style complex geometry
    pruneSpurs(skel, W, H, 22);
    // Second pruning pass to get stubborn short spurs
    pruneSpurs(skel, W, H, 10);

    setAIStatus('Step 5/6 — Tracing centreline…', ''); setAIProgress(52); await tick();
    const chain = walkSkeleton(skel, W, H);

    if (chain.length < 4) { setAIStatus('Could not trace skeleton — try re-picking colours', 'err'); return; }

    // Close loop if endpoints are nearby
    const CLOSE_THRESH = Math.max(8, Math.min(W, H) * 0.04);
    const fc = chain[0], lc = chain[chain.length-1];
    if (Math.hypot(fc.x-lc.x, fc.y-lc.y) <= CLOSE_THRESH && chain.length > 1) {
      chain.push({ x: fc.x, y: fc.y });
    }

    setAIStatus('Step 6/6 — Fitting waypoints…', ''); setAIProgress(68); await tick();

    const sampled = uniformResample(chain, wpCount);
    // ── v7.2: 3 smooth passes for cleaner shape
    let pts = sampled;
    for (let p=0; p<3; p++) pts = smoothPass(pts, 3, 0.42);

    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for (const p of pts) { minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y); }
    const sc = Math.min(mainCanvas.width*.82/(maxX-minX||1), mainCanvas.height*.82/(maxY-minY||1)) / cam.zoom;
    const mx=(minX+maxX)/2, my=(minY+maxY)/2;
    let newWPs = pts.map(p => ({ x:(p.x-mx)*sc, y:(p.y-my)*sc }));
    newWPs = cleanupConvertedWaypoints(newWPs);

    setAIProgress(88); await tick();



    setAIProgress(100);
    waypoints = newWPs;
    startingPointIdx = chooseStartFinishIndex(newWPs);
    updateWPList();
    autoPlaceTrackFeatures(newWPs);
    render();
    setAIStatus(`✓ ${newWPs.length} waypoints · barriers & surfaces auto-placed`, 'ok');
    showToast(`${newWPs.length} waypoints placed!`);

  } finally {
    btn.disabled = false;
  }
}

// ── Morphological 3×3 dilation ──
function morphDilate(mask, W, H) {
  const out = new Uint8Array(mask);
  for (let y=1; y<H-1; y++) {
    for (let x=1; x<W-1; x++) {
      if (mask[y*W+x]) continue;
      outer: for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) {
        if (mask[(y+dy)*W+(x+dx)]) { out[y*W+x]=1; break outer; }
      }
    }
  }
  return out;
}

// ── Single-pixel gap bridging (kept for reference, pipeline now uses morphDilate) ──
function bridgeTinyGaps(mask, W, H) {
  const out = new Uint8Array(mask);
  for (let y=1; y<H-1; y++) {
    for (let x=1; x<W-1; x++) {
      const i = y*W+x;
      if (mask[i]) continue;
      const horizontal = mask[y*W+x-1] && mask[y*W+x+1];
      const vertical = mask[(y-1)*W+x] && mask[(y+1)*W+x];
      const diagA = mask[(y-1)*W+x-1] && mask[(y+1)*W+x+1];
      const diagB = mask[(y-1)*W+x+1] && mask[(y+1)*W+x-1];
      if (horizontal || vertical || diagA || diagB) out[i] = 1;
    }
  }
  return out;
}

// ── Largest connected component (4-connectivity) ──
function largestComponent(mask, W, H) {
  const DIRS=[[-1,0],[1,0],[0,-1],[0,1]];
  const label=new Int32Array(W*H).fill(-1);
  let bestId=-1, bestCount=0, compId=0;
  const stk=[];
  for (let sy=0; sy<H; sy++) {
    for (let sx=0; sx<W; sx++) {
      const idx=sy*W+sx;
      if (!mask[idx]||label[idx]!==-1) continue;
      let count=0; stk.push(idx); label[idx]=compId;
      while (stk.length) {
        const cur=stk.pop(); count++;
        const cy=(cur/W)|0, cx=cur%W;
        for (const [dy,dx] of DIRS) {
          const ny=cy+dy, nx=cx+dx;
          if (ny<0||ny>=H||nx<0||nx>=W) continue;
          const ni=ny*W+nx;
          if (mask[ni]&&label[ni]===-1) { label[ni]=compId; stk.push(ni); }
        }
      }
      if (count>bestCount) { bestCount=count; bestId=compId; }
      compId++;
    }
  }
  const out=new Uint8Array(W*H);
  for (let i=0; i<W*H; i++) if (label[i]===bestId) out[i]=1;
  return out;
}

// ── Zhang-Suen parallel thinning ──
function zhangSuenThin(mask, W, H) {
  const img=new Uint8Array(mask);
  let changed=true;
  const toDelete=[];
  while (changed) {
    changed=false; toDelete.length=0;
    for (let y=1; y<H-1; y++) for (let x=1; x<W-1; x++) {
      const i=y*W+x; if (!img[i]) continue;
      const [A,B,p2,p4,p6,p8]=zsParams(img,x,y,W);
      if (B>=2&&B<=6&&A===1&&p2*p4*p6===0&&p4*p6*p8===0) { toDelete.push(i); changed=true; }
    }
    for (const i of toDelete) img[i]=0;
    toDelete.length=0;
    for (let y=1; y<H-1; y++) for (let x=1; x<W-1; x++) {
      const i=y*W+x; if (!img[i]) continue;
      const [A,B,p2,p4,p6,p8]=zsParams(img,x,y,W);
      if (B>=2&&B<=6&&A===1&&p2*p4*p8===0&&p2*p6*p8===0) { toDelete.push(i); changed=true; }
    }
    for (const i of toDelete) img[i]=0;
  }
  return img;
}
function zsParams(img,x,y,W) {
  const p2=img[(y-1)*W+x],p3=img[(y-1)*W+(x+1)],p4=img[y*W+(x+1)],p5=img[(y+1)*W+(x+1)];
  const p6=img[(y+1)*W+x],p7=img[(y+1)*W+(x-1)],p8=img[y*W+(x-1)],p9=img[(y-1)*W+(x-1)];
  const B=p2+p3+p4+p5+p6+p7+p8+p9;
  const seq=[p2,p3,p4,p5,p6,p7,p8,p9,p2]; let A=0;
  for (let k=0;k<8;k++) if (!seq[k]&&seq[k+1]) A++;
  return [A,B,p2,p4,p6,p8];
}

// ── Spur pruning ──
function pruneSpurs(skel, W, H, minLen) {
  function nb8(idx) {
    const x=idx%W, y=(idx/W)|0; let c=0;
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) {
      if (!dy&&!dx) continue;
      const nx=x+dx, ny=y+dy;
      if (nx>=0&&nx<W&&ny>=0&&ny<H&&skel[ny*W+nx]) c++;
    }
    return c;
  }
  for (let pass=0; pass<minLen*2; pass++) {
    let removed=false;
    for (let i=0; i<W*H; i++) {
      if (!skel[i]||nb8(i)!==1) continue;
      let len=0, cur=i; const vis=new Set();
      while (true) {
        vis.add(cur); len++;
        if (len>=minLen) break;
        const cx=cur%W, cy=(cur/W)|0; let next=-1;
        for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) {
          if (!dy&&!dx) continue;
          const nx2=cx+dx, ny2=cy+dy;
          if (nx2<0||nx2>=W||ny2<0||ny2>=H) continue;
          const ni=ny2*W+nx2;
          if (skel[ni]&&!vis.has(ni)) { next=ni; break; }
        }
        if (next===-1) break;
        if (nb8(next)>=3) break;
        cur=next;
      }
      if (len<minLen) { for (const vi of vis) skel[vi]=0; removed=true; }
    }
    if (!removed) break;
  }
}

// ── Walk skeleton — momentum-biased DFS with junction handling ──
function walkSkeleton(skel, W, H) {
  const skelPts=[], idx2pt=new Int32Array(W*H).fill(-1);
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    if (!skel[y*W+x]) continue;
    idx2pt[y*W+x]=skelPts.length; skelPts.push({x,y,idx:y*W+x});
  }
  if (!skelPts.length) return [];

  function neighbours(pt) {
    const nb=[];
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) {
      if (!dy&&!dx) continue;
      const nx=pt.x+dx, ny=pt.y+dy;
      if (nx<0||nx>=W||ny<0||ny>=H) continue;
      const ni=ny*W+nx;
      if (skel[ni]&&idx2pt[ni]!==-1) nb.push(idx2pt[ni]);
    }
    return nb;
  }

  // Prefer endpoint starting (degree-1 nodes) on left side
  let startPtIdx=0;
  let leftScore=Infinity;
  const endpoints=[];
  for (let k=0;k<skelPts.length;k++) {
    const deg = neighbours(skelPts[k]).length;
    if (deg===1) endpoints.push(k);
    const score = skelPts[k].x + skelPts[k].y * 0.015;
    if (score < leftScore) { leftScore = score; startPtIdx = k; }
  }
  if (endpoints.length) {
    startPtIdx = endpoints.reduce((best,k) => skelPts[k].x < skelPts[best].x ? k : best, endpoints[0]);
  }

  const visited=new Uint8Array(skelPts.length), chain=[];
  let hdx=0, hdy=0, cur=startPtIdx;
  while (true) {
    visited[cur]=1; chain.push({x:skelPts[cur].x, y:skelPts[cur].y});
    const nbs=neighbours(skelPts[cur]).filter(n=>!visited[n]);
    if (!nbs.length) break;
    const cp=skelPts[cur];
    if (nbs.length===1||(hdx===0&&hdy===0)) { cur=nbs[0]; }
    else {
      // At junction: pick neighbour most aligned with current heading
      let best=nbs[0], bestScore=-Infinity;
      for (const n of nbs) {
        const dx=skelPts[n].x-cp.x, dy=skelPts[n].y-cp.y;
        // Momentum score
        const s=hdx*dx+hdy*dy;
        if (s>bestScore) { bestScore=s; best=n; }
      }
      cur=best;
    }
    const ndx=skelPts[cur].x-cp.x, ndy=skelPts[cur].y-cp.y;
    // Smooth heading update (more weight on new direction for better tracking)
    hdx=hdx*.55+ndx*.45; hdy=hdy*.55+ndy*.45;
  }
  return chain;
}

// ── Curvature-adaptive resample ──
function uniformResample(chain, N) {
  if (chain.length < 2) return chain;
  const arcLen=[0];
  for (let i=1;i<chain.length;i++) {
    const dx=chain[i].x-chain[i-1].x, dy=chain[i].y-chain[i-1].y;
    arcLen.push(arcLen[i-1]+Math.sqrt(dx*dx+dy*dy));
  }
  const totalLen=arcLen[arcLen.length-1];
  if (totalLen===0) return chain;

  const curvW=new Float64Array(chain.length);
  for (let i=1;i<chain.length-1;i++) {
    const ax=chain[i].x-chain[i-1].x,ay=chain[i].y-chain[i-1].y;
    const bx=chain[i+1].x-chain[i].x,by=chain[i+1].y-chain[i].y;
    const la=Math.sqrt(ax*ax+ay*ay),lb=Math.sqrt(bx*bx+by*by);
    if (la<1e-9||lb<1e-9) continue;
    curvW[i]=Math.acos(Math.max(-1,Math.min(1,(ax*bx+ay*by)/(la*lb))));
  }

  const CURV_BOOST=4.0;
  const density=new Float64Array(chain.length); let totalDensity=0;
  for (let i=0;i<chain.length-1;i++) {
    const segArc=arcLen[i+1]-arcLen[i];
    const avgCurv=(curvW[i]+curvW[Math.min(i+1,chain.length-1)])*.5;
    density[i]=segArc*(1+CURV_BOOST*avgCurv); totalDensity+=density[i];
  }
  const cumDensity=[0];
  for (let i=0;i<density.length-1;i++) cumDensity.push(cumDensity[i]+density[i]);

  const out=[]; let seg=0;
  for (let i=0;i<N;i++) {
    const target=(i/(N-1))*totalDensity;
    while (seg<cumDensity.length-2&&cumDensity[seg+1]<target) seg++;
    const t0=cumDensity[seg],t1=cumDensity[Math.min(seg+1,cumDensity.length-1)];
    const alpha=t1-t0<1e-9?0:(target-t0)/(t1-t0);
    const al0=arcLen[seg],al1=arcLen[Math.min(seg+1,arcLen.length-1)];
    const targetArc=al0+alpha*(al1-al0);
    let cseg=0;
    while (cseg<arcLen.length-2&&arcLen[cseg+1]<targetArc) cseg++;
    const ca0=arcLen[cseg],ca1=arcLen[Math.min(cseg+1,arcLen.length-1)];
    const calpha=ca1-ca0<1e-9?0:(targetArc-ca0)/(ca1-ca0);
    const p0=chain[cseg],p1=chain[Math.min(cseg+1,chain.length-1)];
    out.push({x:p0.x+calpha*(p1.x-p0.x), y:p0.y+calpha*(p1.y-p0.y)});
  }
  return out;
}

// ── Curvature-aware smooth ──
function smoothPass(pts, _r, tension=0.65) {
  const n=pts.length; if (n<3) return pts;
  const curvature=new Float32Array(n);
  for (let i=0;i<n;i++) {
    const prev=pts[(i-1+n)%n],cur=pts[i],next=pts[(i+1)%n];
    const ax=cur.x-prev.x,ay=cur.y-prev.y,bx=next.x-cur.x,by=next.y-cur.y;
    const la=Math.sqrt(ax*ax+ay*ay),lb=Math.sqrt(bx*bx+by*by);
    curvature[i]=la<1e-9||lb<1e-9?0:Math.acos(Math.max(-1,Math.min(1,(ax*bx+ay*by)/(la*lb))));
  }
  const MAX_R=6;
  return pts.map((p,i) => {
    // Tight corners get smaller smoothing radius to preserve shape
    const r=Math.max(1,Math.round(MAX_R*(1-Math.min(1,curvature[i]/Math.PI))*tension));
    const sigma=r/2; let sx=0,sy=0,sw=0;
    for (let k=-r;k<=r;k++) {
      const j=(i+k+n)%n, w=Math.exp(-(k*k)/(2*sigma*sigma));
      sx+=pts[j].x*w; sy+=pts[j].y*w; sw+=w;
    }
    return {x:sx/sw, y:sy/sw};
  });
}

function cleanupConvertedWaypoints(pts) {
  if (!pts || pts.length < 4) return pts || [];
  const minGap = 2.5;
  const deduped = [];
  for (const p of pts) {
    const last = deduped[deduped.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minGap) deduped.push(p);
  }
  if (deduped.length > 3 && Math.hypot(deduped[0].x - deduped[deduped.length - 1].x, deduped[0].y - deduped[deduped.length - 1].y) < minGap) deduped.pop();

  const n = deduped.length;
  if (n < 4) return deduped;
  const cleaned = [];
  for (let i=0; i<n; i++) {
    const prev = deduped[(i-1+n)%n], cur = deduped[i], next = deduped[(i+1)%n];
    const a = Math.hypot(cur.x-prev.x, cur.y-prev.y);
    const b = Math.hypot(next.x-cur.x, next.y-cur.y);
    const c = Math.hypot(next.x-prev.x, next.y-prev.y);
    if (a < minGap * 1.4 && b < minGap * 1.4 && c < minGap * 2.1) continue;
    cleaned.push(cur);
  }
  return cleaned.length >= 3 ? cleaned : deduped;
}

function chooseStartFinishIndex(wps) {
  if (!wps || wps.length < 3) return 0;
  const n = wps.length;
  let best = 0, bestScore = -Infinity;
  for (let i=0; i<n; i++) {
    const prev=wps[(i-1+n)%n], cur=wps[i], next=wps[(i+1)%n];
    const ax=cur.x-prev.x, ay=cur.y-prev.y, bx=next.x-cur.x, by=next.y-cur.y;
    const la=Math.hypot(ax,ay), lb=Math.hypot(bx,by);
    if (la < 1e-6 || lb < 1e-6) continue;
    // Look further ahead for a long straight leading into this point
    const la2=Math.hypot(wps[(i-2+n)%n].x-prev.x, wps[(i-2+n)%n].y-prev.y);
    const straightness = (ax*bx+ay*by)/(la*lb);
    const lengthScore = Math.min(80, la + lb + la2 * 0.5);
    const bottomBias = cur.y * 0.015;
    const score = straightness * 130 + lengthScore + bottomBias;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

// ═══════════════════════════════════════════════════
// AUTO FEATURE PLACEMENT v7.2
// Improvements:
//   · Kerbs on BOTH inside AND outside of corners
//   · Wider runoff zones (gravel/sand stretch further)
//   · Better corner classification (tight/medium/fast)
//   · Armco on all but very fast straights
//   · Grass margins on long straights between barriers
// ═══════════════════════════════════════════════════
function autoPlaceTrackFeatures(wps) {
  if (!wps || wps.length < 4) return;
  const n = wps.length;

  const rawCurv = new Float32Array(n);
  const signedTurn = new Float32Array(n);
  const segLen = new Float32Array(n);
  for (let i=0; i<n; i++) {
    const prev=wps[(i-1+n)%n], cur=wps[i], next=wps[(i+1)%n];
    const ax=cur.x-prev.x,ay=cur.y-prev.y, bx=next.x-cur.x,by=next.y-cur.y;
    const la=Math.sqrt(ax*ax+ay*ay), lb=Math.sqrt(bx*bx+by*by);
    segLen[i] = lb;
    if (la<1e-9||lb<1e-9) continue;
    rawCurv[i]=Math.acos(Math.max(-1,Math.min(1,(ax*bx+ay*by)/(la*lb))));
    signedTurn[i]=(ax*by-ay*bx)/(la*lb);
  }

  // 5-point smoothed curvature
  const curvatures = new Float32Array(n);
  for (let i=0;i<n;i++) {
    curvatures[i]=(rawCurv[(i-2+n)%n]*0.1 + rawCurv[(i-1+n)%n]*0.2 + rawCurv[i]*0.4 + rawCurv[(i+1)%n]*0.2 + rawCurv[(i+2)%n]*0.1);
  }

  let sum=0, sum2=0;
  for (let i=0;i<n;i++) { sum+=curvatures[i]; sum2+=curvatures[i]**2; }
  const mean=sum/n;
  const stddev=Math.sqrt(Math.max(0, sum2/n-mean*mean));
  // v7.2: slightly lower threshold to catch more corners
  const CORNER_THRESH = Math.max(0.10, mean + 0.25 * stddev);
  const MIN_ZONE = Math.max(2, Math.floor(n * 0.012));

  const isCorner = Array.from(curvatures).map(c => c > CORNER_THRESH);

  function buildZones(flags) {
    const zones=[];
    let start=-1;
    for (let i=0;i<=n;i++) {
      const on=i<n&&flags[i];
      if (on&&start===-1) start=i;
      if (!on&&start!==-1) {
        if (i-start>=MIN_ZONE) zones.push({ from:Math.max(0,start-1), to:Math.min(n-1,i) });
        start=-1;
      }
    }
    return zones;
  }

  const cornerZones = mergeNearbyZones(buildZones(isCorner), Math.max(2, Math.floor(n * 0.018)));

  if (typeof barrierSegments !== 'undefined') {
    for (let i=barrierSegments.length-1; i>=0; i--) {
      if (barrierSegments[i].auto) barrierSegments.splice(i,1);
    }
  } else { window.barrierSegments = []; }

  function wrapIndex(i) { return ((i % n) + n) % n; }

  function zoneStats(zone) {
    let turn=0, curv=0, len=0, samples=0;
    for (let i=zone.from; i<=zone.to; i++) {
      const idx = wrapIndex(i);
      turn += signedTurn[idx]; curv = Math.max(curv, curvatures[idx]);
      len += segLen[idx]; samples++;
    }
    const avgTurn = samples ? turn / samples : 0;
    return {
      insideSide:  avgTurn >= 0 ? 1 : -1,
      outsideSide: avgTurn >= 0 ? -1 : 1,
      maxCurv: curv,
      avgSegLen: samples ? len / samples : 0
    };
  }

  function pushZone(zone, surf, side, lane) {
    barrierSegments.push({ from:zone.from, to:zone.to, surface:surf, side, lane:lane||0, auto:true });
  }

  cornerZones.forEach(z => {
    const len = z.to - z.from + 1;
    const apex = Math.floor((z.from + z.to) / 2);
    const entryLen = Math.max(1, Math.floor(len * 0.30));
    const exitLen  = Math.max(1, Math.floor(len * 0.30));
    const stats = zoneStats(z);
    const isTight = stats.maxCurv > Math.PI * 0.38;
    const isFast  = stats.maxCurv < Math.PI * 0.20 && stats.avgSegLen > 3.5;
    const isMed   = !isTight && !isFast;

    // ── Inside kerbs ──
    // Entry rumble
    pushZone({ from:z.from, to:Math.min(z.from+entryLen, z.to) }, 'rumble', stats.insideSide, 0);
    // Apex sausage kerb
    pushZone({
      from: Math.max(z.from, apex - Math.floor(len*0.22)),
      to:   Math.min(z.to,   apex + Math.floor(len*0.22))
    }, 'sausage', stats.insideSide, 1);
    // Exit flat kerb
    pushZone({ from:Math.max(z.from, z.to-exitLen), to:z.to }, 'flat_kerb', stats.insideSide, 0);

    // ── v7.2: Outside kerbs — flat kerb on outside of all corners ──
    pushZone({ from:z.from, to:z.to }, 'flat_kerb', stats.outsideSide, 0);

    // ── Outside runoff ──
    pushZone(z, isTight ? 'armco' : isFast ? 'tecpro' : 'gravel', stats.outsideSide, 1);

    if (isTight) {
      pushZone({
        from: Math.max(z.from, apex - Math.floor(len*0.15)),
        to:   Math.min(z.to,   apex + Math.floor(len*0.15))
      }, 'tyrewall', stats.outsideSide, 2);
    } else if (isMed) {
      // v7.2: wider grass margin
      pushZone({
        from: Math.max(z.from, apex - Math.floor(len*0.45)),
        to:   Math.min(z.to,   apex + Math.floor(len*0.45))
      }, 'grass', stats.outsideSide, 2);
    } else if (isFast) {
      // Fast: sand trap, then armco behind it
      pushZone({
        from: Math.max(z.from, apex - Math.floor(len*0.30)),
        to:   Math.min(z.to,   apex + Math.floor(len*0.30))
      }, 'sand', stats.outsideSide, 2);
      pushZone({
        from: Math.max(z.from, apex - Math.floor(len*0.20)),
        to:   Math.min(z.to,   apex + Math.floor(len*0.20))
      }, 'armco', stats.outsideSide, 3);
    }
  });

  // ── Straights: armco on both sides ──
  const straightFlags = isCorner.map(v => !v);
  const straightZones = mergeNearbyZones(buildZones(straightFlags), Math.max(3, Math.floor(n * 0.025)))
    // v7.2: lower minimum length for straight detection (was 0.07)
    .filter(z => z.to - z.from + 1 >= Math.max(6, Math.floor(n * 0.05)));

  straightZones.forEach(z => {
    const len = z.to - z.from + 1;
    // v7.2: apply armco on ALL straights (not just short ones) but trim ends
    const trimLen = Math.floor(len * 0.12);
    const trimmed = {
      from: Math.min(z.to, z.from + trimLen),
      to:   Math.max(z.from, z.to - trimLen)
    };
    if (trimmed.to > trimmed.from) {
      pushZone(trimmed, 'armco', 1, 0);
      pushZone(trimmed, 'armco', -1, 0);
      // v7.2: grass behind armco on long straights
      if (len > Math.floor(n * 0.12)) {
        pushZone(trimmed, 'grass', 1, 1);
        pushZone(trimmed, 'grass', -1, 1);
      }
    }
  });

  normalizeAutoFeatureSegments();
  if (typeof updateBarrierList === 'function') updateBarrierList();
}

function normalizeAutoFeatureSegments() {
  if (typeof barrierSegments === 'undefined' || !barrierSegments.length) return;
  const n = waypoints.length || 1;
  const gapTolerance = Math.max(2, Math.floor(n * 0.02));
  barrierSegments = barrierSegments
    .filter(s => s && s.to > s.from && s.surface)
    .sort((a,b) => (a.from-b.from) || (a.to-b.to) || String(a.surface).localeCompare(String(b.surface)));
  const merged = [];
  for (const seg of barrierSegments) {
    const prev = merged[merged.length - 1];
    if (prev && prev.auto && seg.auto && prev.surface === seg.surface && prev.side === seg.side && (prev.lane || 0) === (seg.lane || 0) && seg.from <= prev.to + gapTolerance) {
      prev.to = Math.max(prev.to, seg.to);
    } else {
      merged.push(seg);
    }
  }
  barrierSegments = merged;
}

function mergeNearbyZones(zones, gapTolerance) {
  if (!zones.length) return zones;
  const merged = [];
  zones.sort((a,b) => a.from - b.from);
  for (const zone of zones) {
    const prev = merged[merged.length - 1];
    if (prev && zone.from <= prev.to + gapTolerance) {
      prev.to = Math.max(prev.to, zone.to);
    } else {
      merged.push({ ...zone });
    }
  }
  return merged;
}
