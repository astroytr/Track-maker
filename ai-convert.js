// TRACK IMAGE → WAYPOINTS  v7.0
// ═══════════════════════════════════════════════════
let aiImageData = null;
let aiImgW = 0, aiImgH = 0;
let aiTrackRGB = null;
let aiBgRGB    = null;
let aiEyedropperMode = null;
let aiPreviewCanvas  = null;
let aiPreviewCtx     = null;
const AI_MAX_WAYPOINTS = 800;

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
      const MAX = 700;
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
  const tol = parseInt(document.getElementById('ai-tolerance')?.value || '40');
  const tolSq = tol * tol;
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
      } else if (aiTrackRGB) { isTrack=colDist2(r,g,b,aiTrackRGB)<tolSq; }
        else if (aiBgRGB)    { isBg   =colDist2(r,g,b,aiBgRGB)   <tolSq; }
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
function colDist2(r,g,b,rgb) { const dr=r-rgb.r,dg=g-rgb.g,db=b-rgb.b; return dr*dr+dg*dg+db*db; }

// ═══════════════════════════════════════════════════
// PIPELINE v7.0
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
    setAIStatus('Step 1/5 — Classifying pixels…', ''); setAIProgress(8); await tick();
    const mask = new Uint8Array(W*H);
    let trackCount = 0;
    for (let i=0; i<W*H; i++) {
      const r=data[i*4], g=data[i*4+1], b=data[i*4+2];
      if (colDist2(r,g,b,aiTrackRGB) < colDist2(r,g,b,aiBgRGB)) { mask[i]=1; trackCount++; }
    }
    if (trackCount < 50) { setAIStatus('Too few track pixels — re-pick colours', 'err'); return; }

    setAIStatus('Step 2/5 — Filling gaps…', ''); setAIProgress(16); await tick();
    const dilated = morphDilate(mask, W, H);

    setAIStatus('Step 3/5 — Finding track region…', ''); setAIProgress(26); await tick();
    const comp = largestComponent(dilated, W, H);

    setAIStatus('Step 4/5 — Skeletonising track…', ''); setAIProgress(38); await tick();
    const skel = zhangSuenThin(comp, W, H);
    pruneSpurs(skel, W, H, 15);

    setAIStatus('Step 5/5 — Ordering waypoints…', ''); setAIProgress(65); await tick();
    const chain = walkSkeleton(skel, W, H);

    if (chain.length < 4) { setAIStatus('Could not trace skeleton — try re-picking colours', 'err'); return; }

    const CLOSE_THRESH = 8;
    const fc = chain[0], lc = chain[chain.length-1];
    if (Math.hypot(fc.x-lc.x, fc.y-lc.y) <= CLOSE_THRESH && chain.length > 1) {
      chain.push({ x: fc.x, y: fc.y });
    }

    setAIProgress(80); await tick();

    const sampled = uniformResample(chain, wpCount);
    const smoothPasses = wpCount >= 200 ? 5 : wpCount >= 100 ? 4 : 3;
    let pts = sampled;
    for (let p=0; p<smoothPasses; p++) pts = smoothPass(pts, 3, 0.65);

    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for (const p of pts) { minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y); }
    const sc = Math.min(mainCanvas.width*.82/(maxX-minX||1), mainCanvas.height*.82/(maxY-minY||1)) / cam.zoom;
    const mx=(minX+maxX)/2, my=(minY+maxY)/2;
    let newWPs = pts.map(p => ({ x:(p.x-mx)*sc, y:(p.y-my)*sc }));

    setAIProgress(90); await tick();

    setAIProgress(100);
    waypoints = newWPs;
    startingPointIdx = 0;
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
  for (let pass=0; pass<minLen; pass++) {
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

// ── Walk skeleton ──
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

  let startPtIdx=0;
  for (let k=0;k<skelPts.length;k++) { if (neighbours(skelPts[k]).length===1) { startPtIdx=k; break; } }

  const visited=new Uint8Array(skelPts.length), chain=[];
  let hdx=0, hdy=0, cur=startPtIdx;
  while (true) {
    visited[cur]=1; chain.push({x:skelPts[cur].x, y:skelPts[cur].y});
    const nbs=neighbours(skelPts[cur]).filter(n=>!visited[n]);
    if (!nbs.length) break;
    const cp=skelPts[cur];
    if (nbs.length===1||(hdx===0&&hdy===0)) { cur=nbs[0]; }
    else {
      let best=nbs[0], bestScore=-Infinity;
      for (const n of nbs) {
        const dx=skelPts[n].x-cp.x, dy=skelPts[n].y-cp.y;
        const s=hdx*dx+hdy*dy;
        if (s>bestScore) { bestScore=s; best=n; }
      }
      cur=best;
    }
    const ndx=skelPts[cur].x-cp.x, ndy=skelPts[cur].y-cp.y;
    hdx=hdx*.7+ndx*.3; hdy=hdy*.7+ndy*.3;
  }

  if (chain.length < skelPts.length*.8) {
    let bestExtra=[];
    for (let k=0;k<skelPts.length;k++) {
      if (visited[k]) continue;
      const frag=[]; let fc2=k; const fvis=new Uint8Array(skelPts.length); let fhdx=0,fhdy=0;
      while (true) {
        if (visited[fc2]||fvis[fc2]) break;
        fvis[fc2]=1; frag.push({x:skelPts[fc2].x,y:skelPts[fc2].y});
        const fnbs=neighbours(skelPts[fc2]).filter(n=>!visited[n]&&!fvis[n]);
        if (!fnbs.length) break;
        let fb=fnbs[0],fbS=-Infinity;
        for (const n of fnbs) { const dx=skelPts[n].x-skelPts[fc2].x,dy=skelPts[n].y-skelPts[fc2].y; const s=fhdx*dx+fhdy*dy; if(s>fbS){fbS=s;fb=n;} }
        const ndx2=skelPts[fb].x-skelPts[fc2].x,ndy2=skelPts[fb].y-skelPts[fc2].y;
        fhdx=fhdx*.7+ndx2*.3; fhdy=fhdy*.7+ndy2*.3; fc2=fb;
      }
      if (frag.length>bestExtra.length) bestExtra=frag;
    }
    if (bestExtra.length>chain.length*.1) chain.push(...bestExtra);
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

  const CURV_BOOST=3.5;
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
  const MAX_R=5;
  return pts.map((p,i) => {
    const r=Math.max(1,Math.round(MAX_R*(1-Math.min(1,curvature[i]/Math.PI))*tension));
    const sigma=r/2; let sx=0,sy=0,sw=0;
    for (let k=-r;k<=r;k++) {
      const j=(i+k+n)%n, w=Math.exp(-(k*k)/(2*sigma*sigma));
      sx+=pts[j].x*w; sy+=pts[j].y*w; sw+=w;
    }
    return {x:sx/sw, y:sy/sw};
  });
}

// ═══════════════════════════════════════════════════
// AUTO FEATURE PLACEMENT v4.1
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

  const curvatures = new Float32Array(n);
  for (let i=0;i<n;i++) {
    curvatures[i]=(rawCurv[(i-2+n)%n]+rawCurv[(i-1+n)%n]+rawCurv[i]+rawCurv[(i+1)%n]+rawCurv[(i+2)%n])/5;
  }

  let sum=0, sum2=0;
  for (let i=0;i<n;i++) { sum+=curvatures[i]; sum2+=curvatures[i]**2; }
  const mean=sum/n;
  const stddev=Math.sqrt(Math.max(0, sum2/n-mean*mean));
  const CORNER_THRESH = Math.max(0.12, mean + 0.3 * stddev);
  const MIN_ZONE = Math.max(2, Math.floor(n * 0.015));

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

  const cornerZones = buildZones(isCorner);

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
    const entryLen = Math.max(1, Math.floor(len * 0.25));
    const exitLen  = Math.max(1, Math.floor(len * 0.25));
    const stats = zoneStats(z);
    const isTight = stats.maxCurv > Math.PI * 0.40;
    const isFast  = stats.maxCurv < Math.PI * 0.22 && stats.avgSegLen > 4;
    const isMed   = !isTight && !isFast;

    pushZone({ from:z.from, to:Math.min(z.from+entryLen, z.to) }, 'rumble', stats.insideSide, 0);
    pushZone({
      from: Math.max(z.from, apex - Math.floor(len*0.2)),
      to:   Math.min(z.to,   apex + Math.floor(len*0.2))
    }, 'sausage', stats.insideSide, 1);
    pushZone({ from:Math.max(z.from, z.to-exitLen), to:z.to }, 'flat_kerb', stats.insideSide, 0);
    pushZone(z, isTight ? 'armco' : isFast ? 'tecpro' : 'gravel', stats.outsideSide, 0);

    if (isTight) {
      pushZone({
        from: Math.max(z.from, apex - Math.floor(len*0.12)),
        to:   Math.min(z.to,   apex + Math.floor(len*0.12))
      }, 'tyrewall', stats.outsideSide, 1);
    } else if (isMed) {
      pushZone({
        from: Math.max(z.from, apex - Math.floor(len*0.35)),
        to:   Math.min(z.to,   apex + Math.floor(len*0.35))
      }, 'grass', stats.outsideSide, 1);
    }
  });

  const straightFlags = isCorner.map(v => !v);
  const straightZones = buildZones(straightFlags).filter(z => z.to - z.from + 1 >= Math.max(6, Math.floor(n * 0.04)));
  straightZones.forEach(z => {
    const len = z.to - z.from + 1;
    const trimmed = {
      from: Math.min(z.to, z.from + Math.floor(len * 0.15)),
      to:   Math.max(z.from, z.to - Math.floor(len * 0.15))
    };
    if (trimmed.to > trimmed.from) {
      pushZone(trimmed, 'armco', 1, 0);
      pushZone(trimmed, 'armco', -1, 0);
    }
  });

  if (typeof updateBarrierList === 'function') updateBarrierList();
}
