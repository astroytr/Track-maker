// ═══════════════════════════════════════════════════
// 3D PREVIEW — Circuit Forge v7.2
// FIX v7.1: surface Y heights scaled up above ground plane
// FIX v7.2: ribbon normals use centered differences +
//           sign-consistency pass to eliminate bowtie
//           / twisted-quad distortion on sharp bends.
// ═══════════════════════════════════════════════════
let preview3dActive   = false;
let preview3dRenderer = null;
let preview3dScene    = null;
let preview3dCamera   = null;
let preview3dAnimId   = null;
let p3dOrbit          = { ax: 0, ay: 0.5, dist: 380 };
let p3dOrbitTarget    = { cx: 0, cz: 0 };

const SURF_COLOR_3D = {
  flat_kerb: 0xe8392a,
  sausage:   0xf5c518,
  rumble:    0xdd3333,
  gravel:    0xc8b89a,
  sand:      0xe3cf98,
  grass:     0x3a7a3a,
  armco:     0xcccccc,
  tecpro:    0x3a5fa8,
  tyrewall:  0x222222,
};

const P3D_SURFACE_LANES = {
  flat_kerb: { inner: 14.2, outer: 18.2, y: 0.80 },
  rumble:    { inner: 14.8, outer: 19.8, y: 0.90 },
  sausage:   { inner: 18.8, outer: 22.2, y: 1.00 },
  gravel:    { inner: 23.0, outer: 35.0, y: 0.50 },
  sand:      { inner: 23.0, outer: 35.0, y: 0.50 },
  grass:     { inner: 36.0, outer: 50.0, y: 0.30 },
  armco:     { inner: 54.0, outer: 57.0, y: 0.50 },
  tecpro:    { inner: 53.0, outer: 58.0, y: 0.50 },
  tyrewall:  { inner: 52.0, outer: 58.0, y: 0.50 },
};

function p3dLane(surface, lane = 0) {
  const cfg = P3D_SURFACE_LANES[surface] || P3D_SURFACE_LANES.flat_kerb;
  const extra = Math.max(0, lane || 0) * 4.5;
  return {
    inner: cfg.inner + extra,
    outer: cfg.outer + extra,
    center: (cfg.inner + cfg.outer) * 0.5 + extra,
    y: cfg.y
  };
}

function p3dSignedBand(lane, side) {
  return side < 0 ? [-lane.outer, -lane.inner] : [lane.inner, lane.outer];
}

function toggle3DPreview() {
  if (preview3dActive) { close3DPreview(); } else { open3DPreview(); }
}

function open3DPreview() {
  if (waypoints.length < 3) { showToast('Need at least 3 waypoints for 3D view'); return; }
  if (typeof THREE === 'undefined') { showToast('3D engine still loading — try again in a moment'); return; }
  preview3dActive = true;
  document.getElementById('preview3d-overlay').style.display = 'flex';
  document.getElementById('btn-3d-toggle').classList.add('active-3d');
  document.getElementById('btn-3d-toggle').textContent = '← 2D View';
  document.getElementById('tool-hud').textContent = '3D Preview  ·  drag = orbit  ·  scroll = zoom  ·  Q = exit';
  build3DScene();
}

function close3DPreview() {
  preview3dActive = false;
  if (preview3dAnimId) { cancelAnimationFrame(preview3dAnimId); preview3dAnimId = null; }
  if (preview3dRenderer) { preview3dRenderer.dispose(); preview3dRenderer = null; }
  preview3dScene  = null;
  preview3dCamera = null;
  const ol = document.getElementById('preview3d-overlay');
  if (ol) { ol.style.display = 'none'; ol.innerHTML = ''; }
  const btn = document.getElementById('btn-3d-toggle');
  if (btn) { btn.classList.remove('active-3d'); btn.textContent = '3D Preview'; }
  const hudMap = {
    waypoint:'Waypoint — click to place', paint:'Paint — drag to paint surface',
    erase:'Erase — drag to erase', pan:'Pan — drag to move · scroll/pinch zoom',
    barrier:'Barrier — tap start waypoint'
  };
  const hud = document.getElementById('tool-hud');
  if (hud) hud.textContent = hudMap[tool] || tool;
}

// ─── Scale helpers ──────────────────────────────────
function p3dGetScaledData() {
  if (waypoints.length === 0) return { wps: [], factor: 1, cx: 0, cy: 0 };
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  waypoints.forEach(w => {
    minX=Math.min(minX,w.x); maxX=Math.max(maxX,w.x);
    minY=Math.min(minY,w.y); maxY=Math.max(maxY,w.y);
  });
  const cx=(minX+maxX)/2, cy=(minY+maxY)/2;
  const span=Math.max(maxX-minX,maxY-minY);
  const factor=span>0?500/span:1;
  let wps=waypoints.map(w=>({x:(w.x-cx)*factor,z:(w.y-cy)*factor}));
  if (startingPointIdx>0) wps=[...wps.slice(startingPointIdx),...wps.slice(0,startingPointIdx)];
  return { wps, factor, cx, cy };
}

// ─── Catmull-Rom spline ────────────────────────────
function p3dCatmull(p0,p1,p2,p3,t) {
  const t2=t*t,t3=t2*t;
  return {
    x:0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
    z:0.5*((2*p1.z)+(-p0.z+p2.z)*t+(2*p0.z-5*p1.z+4*p2.z-p3.z)*t2+(-p0.z+3*p1.z-3*p2.z+p3.z)*t3)
  };
}

function p3dBuildSpline(wps, spp) {
  const n=wps.length, pts=[];
  for (let i=0;i<n;i++) {
    const p0=wps[(i-1+n)%n],p1=wps[i],p2=wps[(i+1)%n],p3=wps[(i+2)%n];
    for (let j=0;j<spp;j++) pts.push(p3dCatmull(p0,p1,p2,p3,j/spp));
  }
  return pts;
}

// ─── Compute per-point lateral normals ────────────
// Centered-difference tangents rotated 90° into the XZ
// plane, then oriented so that "positive offset = track
// right side" is consistent for the whole loop.
//
// The old sign-consistency pass (flip if dot<0 with
// predecessor) caused cumulative drift on closed-loop
// tracks — by halfway round the circuit left/right had
// swapped, producing the overlap artefact.
//
// Fix: compute the signed area (shoelace) of the polyline
// to determine winding order (CW vs CCW), then orient
// every normal so "positive offset" always points outward.
// This is stable regardless of how many tight corners
// the track has.
function p3dComputeNormals(spPts) {
  const n = spPts.length;

  // Raw centered-difference perpendiculars (arbitrary sign)
  const normals = spPts.map((p, i) => {
    const prev = spPts[(i - 1 + n) % n];
    const next = spPts[(i + 1) % n];
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.sqrt(dx*dx + dz*dz) || 1;
    return { px: dz / len, pz: -dx / len };
  });

  // Signed area (shoelace) — positive = CCW in XZ, negative = CW
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = spPts[i], b = spPts[(i + 1) % n];
    area += a.x * b.z - b.x * a.z;
  }
  // For CCW winding the perpendicular already points outward;
  // for CW it points inward — flip all normals to compensate.
  if (area > 0) {
    for (let i = 0; i < n; i++) {
      normals[i].px = -normals[i].px;
      normals[i].pz = -normals[i].pz;
    }
  }

  return normals;
}

// ─── Flat ribbon geometry (road, kerbs, runoff) ───
function p3dRibbon(spPts, innerOff, outerOff, yBase=0) {
  const n = spPts.length;
  if (n < 2) return new THREE.BufferGeometry();

  const normals = p3dComputeNormals(spPts);
  const pos=[], nor=[], uv=[], idx=[];

  // n+1 vertex pairs to close the loop cleanly
  for (let i=0; i<=n; i++) {
    const ci = i % n;
    const { px, pz } = normals[ci];
    const c = spPts[ci];
    pos.push(
      c.x + px*innerOff, yBase, c.z + pz*innerOff,
      c.x + px*outerOff, yBase, c.z + pz*outerOff
    );
    nor.push(0,1,0, 0,1,0);
    const s = i / n;
    uv.push(s,0, s,1);
  }

  // n quads from n+1 rows of 2 vertices each
  for (let i=0; i<n; i++) {
    const b = i*2;
    idx.push(b,b+1,b+2, b+1,b+3,b+2);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute('normal',   new THREE.Float32BufferAttribute(nor,3));
  g.setAttribute('uv',       new THREE.Float32BufferAttribute(uv,2));
  g.setIndex(idx);
  return g;
}

// ─── Vertical barrier strip (armco, sausage ridge) ─
// FIX v7.2: also uses p3dComputeNormals to avoid twist
function p3dBarrierRibbon(pts, sideOff, yBase, height) {
  const n = pts.length;
  if (n < 2) return new THREE.BufferGeometry();

  const normals = p3dComputeNormals(pts);
  const pos=[], nor=[], idx=[];

  for (let i=0; i<=n; i++) {
    const ci = i % n;
    const { px, pz } = normals[ci];
    const c = pts[ci];
    const ox = c.x + px*sideOff;
    const oz = c.z + pz*sideOff;
    pos.push(ox, yBase, oz,  ox, yBase+height, oz);
    nor.push(px,0,pz, px,0,pz);
  }

  for (let i=0; i<n; i++) {
    const b = i*2;
    idx.push(b,b+1,b+2, b+1,b+3,b+2);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute('normal',   new THREE.Float32BufferAttribute(nor,3));
  g.setIndex(idx);
  return g;
}

// ─── Place barrier 3D objects ──────────────────────
function p3dPlaceBarrier(scene, surface, spPts, TH, side, laneIndex) {
  const sides = (side==='both'||!side) ? [-1,1] : [(side==='left'||side===-1) ? -1 : 1];
  const normals = p3dComputeNormals(spPts);

  sides.forEach(s => {
    const lane  = p3dLane(surface, laneIndex || 0);
    const off   = lane.center * s;
    const color = SURF_COLOR_3D[surface] || 0xaaaaaa;
    const mat   = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });

    if (surface==='armco') {
      scene.add(new THREE.Mesh(p3dBarrierRibbon(spPts, off, 0.5, 6.0), mat));
      scene.add(new THREE.Mesh(p3dBarrierRibbon(spPts, off+0.15*s, 2.0, 0.5), mat));
    } else if (surface==='tecpro') {
      for (let i=0;i<spPts.length-1;i+=3) {
        const p=spPts[i];
        const { px, pz } = normals[i];
        const m=new THREE.Mesh(new THREE.BoxGeometry(1.1,10.0,1.1), mat);
        m.position.set(p.x+px*off, 5.0, p.z+pz*off);
        scene.add(m);
      }
    } else if (surface==='tyrewall') {
      for (let i=0;i<spPts.length-1;i+=4) {
        const p=spPts[i];
        const { px, pz } = normals[i];
        const m=new THREE.Mesh(new THREE.CylinderGeometry(0.55,0.55,4.0,10), mat);
        m.position.set(p.x+px*off, 2.0, p.z+pz*off);
        scene.add(m);
        const m2=new THREE.Mesh(new THREE.CylinderGeometry(0.55,0.55,4.0,10), mat);
        m2.position.set(p.x+px*off, 6.0, p.z+pz*off);
        scene.add(m2);
      }
    } else if (surface==='sausage') {
      const kOff = lane.center * s;
      const whiteMat = new THREE.MeshLambertMaterial({color:0xffffff, side:THREE.DoubleSide});
      scene.add(new THREE.Mesh(p3dRibbon(spPts,kOff-1.5,kOff+1.5,0.99), whiteMat));
      scene.add(new THREE.Mesh(p3dBarrierRibbon(spPts,kOff,0.5,2.5), mat));
    } else if (surface==='flat_kerb') {
      const band = p3dSignedBand(lane, s);
      scene.add(new THREE.Mesh(p3dRibbon(spPts,band[0],band[1],lane.y), mat));
    } else if (surface==='rumble') {
      const band = p3dSignedBand(lane, s);
      scene.add(new THREE.Mesh(p3dRibbon(spPts,band[0],band[1],lane.y), mat));
    } else if (surface==='gravel' || surface==='sand') {
      const band = p3dSignedBand(lane, s);
      scene.add(new THREE.Mesh(p3dRibbon(spPts,band[0],band[1],lane.y), mat));
    } else if (surface==='grass') {
      const band = p3dSignedBand(lane, s);
      scene.add(new THREE.Mesh(p3dRibbon(spPts,band[0],band[1],lane.y), mat));
    }
  });
}

// ─── Main scene builder ────────────────────────────
function build3DScene() {
  const ol = document.getElementById('preview3d-overlay');
  ol.innerHTML = '';

  const cnv = document.createElement('canvas');
  cnv.style.cssText = 'width:100%;height:100%;display:block;';
  ol.appendChild(cnv);

  const hud = document.createElement('div');
  hud.className = 'preview3d-hud';
  hud.innerHTML = '<span>Drag = orbit</span><span>Scroll = zoom</span><span>Q = exit</span>';
  ol.appendChild(hud);

  const backBtn = document.createElement('button');
  backBtn.className = 'preview3d-exit-btn';
  backBtn.textContent = '← Back to 2D';
  backBtn.onclick = close3DPreview;
  ol.appendChild(backBtn);

  // ── Renderer ──
  preview3dRenderer = new THREE.WebGLRenderer({ canvas: cnv, antialias: true });
  preview3dRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  preview3dRenderer.setSize(ol.clientWidth, ol.clientHeight);
  preview3dRenderer.shadowMap.enabled = true;

  // ── Scene ──
  preview3dScene = new THREE.Scene();
  preview3dScene.background = new THREE.Color(0x87ceeb);
  preview3dScene.fog = new THREE.Fog(0x87ceeb, 300, 900);

  // ── Camera ──
  preview3dCamera = new THREE.PerspectiveCamera(55, ol.clientWidth/ol.clientHeight, 0.5, 2000);

  // ── Lights ──
  preview3dScene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const sun = new THREE.DirectionalLight(0xfffae0, 0.85);
  sun.position.set(200, 300, 150); sun.castShadow=true;
  preview3dScene.add(sun);

  // ── Ground (y=0) ──
  const gnd = new THREE.Mesh(
    new THREE.PlaneGeometry(3000,3000),
    new THREE.MeshLambertMaterial({color:0x2d5a1b})
  );
  gnd.rotation.x=-Math.PI/2; gnd.receiveShadow=true;
  preview3dScene.add(gnd);

  // ── Scaled data ──
  const { wps, factor, cx, cy } = p3dGetScaledData();
  if (wps.length < 2) return;
  const n = wps.length;
  const SPP = 14;   // spline points per waypoint segment
  const spPts = p3dBuildSpline(wps, SPP);

  // Centroid for camera target
  const scx = wps.reduce((s,p)=>s+p.x,0)/n;
  const scz = wps.reduce((s,p)=>s+p.z,0)/n;
  p3dOrbitTarget = { cx: scx, cz: scz };

  const TH = 14;
  const dblSide = { side: THREE.DoubleSide };

  // ── Asphalt (y=0.5) — DoubleSide so normals don't hide it ──
  preview3dScene.add(new THREE.Mesh(
    p3dRibbon(spPts, -TH, TH, 0.5),
    new THREE.MeshLambertMaterial({color:0x333338, ...dblSide})
  ));

  // ── Outer kerb edge band (y=0.4) ──
  preview3dScene.add(new THREE.Mesh(
    p3dRibbon(spPts, TH, TH+2.5, 0.4),
    new THREE.MeshLambertMaterial({color:0xff4444, ...dblSide})
  ));
  preview3dScene.add(new THREE.Mesh(
    p3dRibbon(spPts, -TH-2.5, -TH, 0.4),
    new THREE.MeshLambertMaterial({color:0xff4444, ...dblSide})
  ));

  // ── White edge line ──
  preview3dScene.add(new THREE.Mesh(
    p3dRibbon(spPts, TH-0.8, TH+0.8, 0.55),
    new THREE.MeshLambertMaterial({color:0xffffff, ...dblSide})
  ));
  preview3dScene.add(new THREE.Mesh(
    p3dRibbon(spPts, -TH-0.8, -TH+0.8, 0.55),
    new THREE.MeshLambertMaterial({color:0xffffff, ...dblSide})
  ));

  // NOTE: paintLayers are 2D identification markers only — they are
  // intentionally NOT rendered in 3D. Surface elements come from
  // barrierSegments below, which are auto-placed by autoPlaceTrackFeatures().

  // ── Barrier segments ──
  p3dMergeBarrierSegments(barrierSegments, n).forEach(seg => {
    const fromIdx = Math.round(seg.from / n * spPts.length);
    const toIdx   = Math.min(Math.round(seg.to   / n * spPts.length), spPts.length - 1);
    const segPts  = spPts.slice(fromIdx, toIdx + 1);
    if (segPts.length < 2) return;
    p3dPlaceBarrier(preview3dScene, seg.surface, segPts, TH, seg.side, seg.lane || 0);
  });

  // ── Camera + controls ──
  updateP3DCamera();
  setupP3DControls(cnv);

  function loop() {
    preview3dAnimId = requestAnimationFrame(loop);
    preview3dRenderer.render(preview3dScene, preview3dCamera);
  }
  loop();
}

function p3dMergeBarrierSegments(segments, wpCount) {
  if (!segments || !segments.length) return [];
  const gapTolerance = Math.max(2, Math.floor((wpCount || 1) * 0.02));
  const sorted = segments.slice().sort((a,b) =>
    String(a.surface).localeCompare(String(b.surface)) ||
    String(a.side || 'both').localeCompare(String(b.side || 'both')) ||
    (a.lane || 0) - (b.lane || 0) ||
    a.from - b.from
  );
  const merged = [];
  for (const seg of sorted) {
    const prev = merged[merged.length - 1];
    const compatible = prev && prev.surface === seg.surface &&
      (prev.side || 'both') === (seg.side || 'both') &&
      (prev.lane || 0) === (seg.lane || 0) && !!prev.auto === !!seg.auto;
    if (compatible && seg.from <= prev.to + gapTolerance) {
      prev.to = Math.max(prev.to, seg.to);
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

function updateP3DCamera() {
  if (!preview3dCamera) return;
  const { cx, cz } = p3dOrbitTarget;
  const r     = p3dOrbit.dist;
  const theta = p3dOrbit.ax;
  const phi   = Math.max(0.08, Math.min(Math.PI/2 - 0.04, p3dOrbit.ay));
  preview3dCamera.position.set(
    cx + r * Math.sin(phi) * Math.cos(theta),
    r  * Math.cos(phi),
    cz + r * Math.sin(phi) * Math.sin(theta)
  );
  preview3dCamera.lookAt(cx, 0, cz);
}

function setupP3DControls(cnv) {
  let dragging=false, lx=0, ly=0;
  cnv.addEventListener('mousedown', e=>{dragging=true; lx=e.clientX; ly=e.clientY;});
  window.addEventListener('mouseup',  ()=>dragging=false);
  cnv.addEventListener('mousemove', e=>{
    if (!dragging) return;
    p3dOrbit.ax -= (e.clientX-lx)*0.004;
    p3dOrbit.ay += (e.clientY-ly)*0.004;
    lx=e.clientX; ly=e.clientY;
    updateP3DCamera();
  });
  cnv.addEventListener('wheel', e=>{
    p3dOrbit.dist = Math.max(40, Math.min(1200, p3dOrbit.dist + e.deltaY*0.5));
    updateP3DCamera();
  }, {passive:true});

  let ltx=0,lty=0, lastPinchDist=0;
  cnv.addEventListener('touchstart', e=>{
    if (e.touches.length===1){ltx=e.touches[0].clientX;lty=e.touches[0].clientY;}
    if (e.touches.length===2){
      const dx=e.touches[0].clientX-e.touches[1].clientX;
      const dy=e.touches[0].clientY-e.touches[1].clientY;
      lastPinchDist=Math.sqrt(dx*dx+dy*dy);
    }
  },{passive:true});
  cnv.addEventListener('touchmove', e=>{
    e.preventDefault();
    if (e.touches.length===1){
      p3dOrbit.ax -= (e.touches[0].clientX-ltx)*0.004;
      p3dOrbit.ay += (e.touches[0].clientY-lty)*0.004;
      ltx=e.touches[0].clientX; lty=e.touches[0].clientY;
    }
    if (e.touches.length===2){
      const dx=e.touches[0].clientX-e.touches[1].clientX;
      const dy=e.touches[0].clientY-e.touches[1].clientY;
      const dist=Math.sqrt(dx*dx+dy*dy);
      p3dOrbit.dist=Math.max(40,Math.min(1200,p3dOrbit.dist*(lastPinchDist/dist)));
      lastPinchDist=dist;
    }
    updateP3DCamera();
  },{passive:false});

  window.addEventListener('resize', ()=>{
    const ol=document.getElementById('preview3d-overlay');
    if(!ol||!preview3dRenderer||!preview3dCamera) return;
    preview3dRenderer.setSize(ol.clientWidth, ol.clientHeight);
    preview3dCamera.aspect = ol.clientWidth / ol.clientHeight;
    preview3dCamera.updateProjectionMatrix();
  });
}

window.addEventListener('keydown', e=>{
  if (!preview3dActive) return;
  if (e.key==='q'||e.key==='Q') { close3DPreview(); e.preventDefault(); }
});
