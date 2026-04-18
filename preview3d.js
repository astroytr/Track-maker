// ═══════════════════════════════════════════════════
// 3D PREVIEW — Circuit Forge v7.2
// ═══════════════════════════════════════════════════
let preview3dActive   = false;
let preview3dRenderer = null;
let preview3dScene    = null;
let preview3dCamera   = null;
let preview3dAnimId   = null;

// Single camera state — no orbit/freeroam modes, one camera always
let p3dPos   = { x: 0, y: 200, z: 0 };  // world position
let p3dYaw   = 0;                          // horizontal look (left/right)
let p3dPitch = -0.4;                       // vertical look (up/down)
let p3dKeys  = {};

// Chase cam mode — snaps to behind the static start-line car
let p3dChaseMode = false;
let _p3dChasePos = null;   // {x,y,z,yaw} set by build3DScene from car heading

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
  flat_kerb: { inner: 14.2, outer: 18.2, y: 0.075 },
  rumble:    { inner: 14.8, outer: 19.8, y: 0.085 },
  sausage:   { inner: 18.8, outer: 22.2, y: 0.10  },
  gravel:    { inner: 23.0, outer: 35.0, y: 0.025 },
  sand:      { inner: 23.0, outer: 35.0, y: 0.026 },
  grass:     { inner: 36.0, outer: 50.0, y: 0.02  },
  armco:     { inner: 54.0, outer: 57.0, y: 0.02  },
  tecpro:    { inner: 53.0, outer: 58.0, y: 0.02  },
  tyrewall:  { inner: 52.0, outer: 58.0, y: 0.02  },
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
  document.getElementById('tool-hud').textContent = '3D Preview  ·  1-finger = look  ·  2-finger = move fwd/back  ·  Q = exit';
  build3DScene();
}

function close3DPreview() {
  preview3dActive = false;
  if (preview3dAnimId) { cancelAnimationFrame(preview3dAnimId); preview3dAnimId = null; }
  p3dKeys = {};
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

// ─── Use world coordinates directly (same as 2D renderer) ──────────
function p3dGetScaledData() {
  if (waypoints.length === 0) return { wps: [], cx: 0, cy: 0 };
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  waypoints.forEach(w => {
    minX=Math.min(minX,w.x); maxX=Math.max(maxX,w.x);
    minY=Math.min(minY,w.y); maxY=Math.max(maxY,w.y);
  });
  const cx=(minX+maxX)/2, cy=(minY+maxY)/2;
  let wps = waypoints.map(w => ({ x: w.x - cx, z: w.y - cy }));
  if (startingPointIdx>0) wps=[...wps.slice(startingPointIdx),...wps.slice(0,startingPointIdx)];
  return { wps, cx, cy };
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
// plane, oriented so "positive offset" consistently points
// away from the track's centroid at every point.
//
// Previous approaches (sign-consistency pass, global
// shoelace flip) both fail on tracks with S-bends or
// inward loops because they assume a single consistent
// winding direction for the whole shape.
//
// This approach works per-point: for each spline point,
// check which side of the track the overall centroid lies
// on (dot product of normal vs centroid-to-point vector).
// If the normal points toward the centroid, flip it.
// "Positive offset" then always means "away from centre".
function p3dComputeNormals(spPts) {
  const n = spPts.length;

  // Step 1 — raw perpendiculars (arbitrary sign)
  const raw = spPts.map((p, i) => {
    const prev = spPts[(i - 1 + n) % n];
    const next = spPts[(i + 1) % n];
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.sqrt(dx*dx + dz*dz) || 1;
    return { px: dz / len, pz: -dx / len };
  });

  // Step 2 — shoelace signed area to get winding direction
  // CCW (area>0): left-hand normal already points outward
  // CW  (area<0): flip all normals
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = spPts[i], b = spPts[(i + 1) % n];
    area += a.x * b.z - b.x * a.z;
  }
  const windSign = area >= 0 ? 1 : -1;

  // Step 3 — seed point 0 with the correct winding sign
  const out = new Array(n);
  out[0] = { px: raw[0].px * windSign, pz: raw[0].pz * windSign };

  // Step 4 — propagate forward: each normal inherits sign from
  // its predecessor so local flips never cascade into twisted quads
  for (let i = 1; i < n; i++) {
    const dot = raw[i].px * out[i-1].px + raw[i].pz * out[i-1].pz;
    const s = dot >= 0 ? 1 : -1;
    out[i] = { px: raw[i].px * s, pz: raw[i].pz * s };
  }

  return out;
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
      // Wall: yBase=0.02, height=0.90 — matches export.js wallMeshCode
      scene.add(new THREE.Mesh(p3dBarrierRibbon(spPts, off, 0.02, 0.90), mat));
      // Corrugation rail: yBase=0.28, height=0.07
      scene.add(new THREE.Mesh(p3dBarrierRibbon(spPts, off + 0.08*s, 0.28, 0.07), mat));
    } else if (surface==='tecpro') {
      // BoxGeometry(1.15, 1.00, 1.15), step every 3 pts — matches export.js
      for (let i=0; i<spPts.length-1; i+=3) {
        const p=spPts[i], { px, pz } = normals[i];
        const m=new THREE.Mesh(new THREE.BoxGeometry(1.15,1.00,1.15), mat);
        m.position.set(p.x+px*off, 0.50, p.z+pz*off);
        scene.add(m);
        const m2=new THREE.Mesh(new THREE.BoxGeometry(1.15,1.00,1.15),
          new THREE.MeshLambertMaterial({color:0x2a3f7a, side:THREE.DoubleSide}));
        m2.position.set(p.x+px*off, 0.50, p.z+pz*off);
        scene.add(m2);
      }
    } else if (surface==='tyrewall') {
      // CylinderGeometry(r=0.55, h=0.48) stacked ×2 — matches export.js
      for (let i=0; i<spPts.length-1; i+=4) {
        const p=spPts[i], { px, pz } = normals[i];
        const m=new THREE.Mesh(new THREE.CylinderGeometry(0.55,0.55,0.48,10), mat);
        m.position.set(p.x+px*off, 0.24, p.z+pz*off);
        scene.add(m);
        const m2=new THREE.Mesh(new THREE.CylinderGeometry(0.55,0.55,0.48,10), mat);
        m2.position.set(p.x+px*off, 0.72, p.z+pz*off);
        scene.add(m2);
      }
    } else if (surface==='sausage') {
      // White base ribbon ±1.8, then yellow wall yBase=0.02 height=0.18
      const kOff = lane.center * s;
      const whiteMat = new THREE.MeshLambertMaterial({color:0xffffff, side:THREE.DoubleSide});
      scene.add(new THREE.Mesh(p3dRibbon(spPts, kOff-1.8, kOff+1.8, 0.03), whiteMat));
      scene.add(new THREE.Mesh(p3dBarrierRibbon(spPts, kOff, 0.02, 0.18), mat));
    } else if (surface==='flat_kerb') {
      const band = p3dSignedBand(lane, s);
      const halfBand = s < 0 ? [-lane.center, -lane.inner] : [lane.inner, lane.center];
      scene.add(new THREE.Mesh(p3dRibbon(spPts,band[0],band[1],lane.y), mat));
      scene.add(new THREE.Mesh(p3dRibbon(spPts,halfBand[0],halfBand[1],lane.y),
        new THREE.MeshLambertMaterial({color:0xffffff, side:THREE.DoubleSide})));
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
  hud.style.top = '50px';
  hud.innerHTML = '<span>1-finger = look</span><span>2-finger = fwd/back</span><span>WASD = move</span><span>Q = exit</span>';
  ol.appendChild(hud);

  const backBtn = document.createElement('button');
  backBtn.className = 'preview3d-exit-btn';
  backBtn.style.top = '50px';
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
  preview3dScene.fog = new THREE.Fog(0x87ceeb, 8000, 20000);

  // ── Camera ──
  preview3dCamera = new THREE.PerspectiveCamera(60, ol.clientWidth/ol.clientHeight, 0.5, 40000);

  // ── Lights ──
  preview3dScene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const sun = new THREE.DirectionalLight(0xfffae0, 0.90);
  sun.position.set(1000, 1500, 800); sun.castShadow=true;
  preview3dScene.add(sun);

  // ── Ground (y=0) ──
  const gnd = new THREE.Mesh(
    new THREE.PlaneGeometry(60000,60000),
    new THREE.MeshLambertMaterial({color:0x2d5a1b})
  );
  gnd.rotation.x=-Math.PI/2; gnd.receiveShadow=true;
  preview3dScene.add(gnd);

  // ── World-space data ──
  const { wps, cx, cy } = p3dGetScaledData();
  if (wps.length < 2) return;
  const n = wps.length;
  const SPP = 14;
  const spPts = p3dBuildSpline(wps, SPP);

  // Track span for initial camera distance
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  wps.forEach(w=>{ minX=Math.min(minX,w.x);maxX=Math.max(maxX,w.x);minZ=Math.min(minZ,w.z);maxZ=Math.max(maxZ,w.z); });
  const trackSpan = Math.max(maxX-minX, maxZ-minZ);

  // TW=14 in game, h=TW/2=7, car scale=1.0
  const TH_BASE = typeof TRACK_HALF_WIDTH !== 'undefined' ? TRACK_HALF_WIDTH : 7;
  const TH = TH_BASE;
  const dblSide = { side: THREE.DoubleSide };

  // ── Asphalt — y=0.01 matches physics.js exactly ──
  const ROAD_Y = 0.01;
  preview3dScene.add(new THREE.Mesh(
    p3dRibbon(spPts, -TH, TH, ROAD_Y),
    new THREE.MeshLambertMaterial({color:0x333338, ...dblSide})
  ));

  // ── Outer kerb edge band ──
  preview3dScene.add(new THREE.Mesh(
    p3dRibbon(spPts, TH, TH+0.7, ROAD_Y + 0.01),
    new THREE.MeshLambertMaterial({color:0xff4444, ...dblSide})
  ));
  preview3dScene.add(new THREE.Mesh(
    p3dRibbon(spPts, -TH-0.7, -TH, ROAD_Y + 0.01),
    new THREE.MeshLambertMaterial({color:0xff4444, ...dblSide})
  ));

  // ── White edge line ──
  preview3dScene.add(new THREE.Mesh(
    p3dRibbon(spPts, TH-0.08, TH+0.08, ROAD_Y + 0.02),
    new THREE.MeshLambertMaterial({color:0xffffff, ...dblSide})
  ));
  preview3dScene.add(new THREE.Mesh(
    p3dRibbon(spPts, -TH-0.08, -TH+0.08, ROAD_Y + 0.02),
    new THREE.MeshLambertMaterial({color:0xffffff, ...dblSide})
  ));

  // ── Start / Finish line — matches physics.js PlaneGeometry at y=0.03 ──
  const sfSegLen = Math.min(6, Math.floor(spPts.length * 0.01)) || 3;
  const sfSeg = spPts.slice(0, sfSegLen + 1);
  const chkW = TH / 4;
  for (let c = 0; c < 4; c++) {
    const inner = -TH + c * chkW * 2;
    const outer = inner + chkW;
    const color = c % 2 === 0 ? 0xffffff : 0x111111;
    preview3dScene.add(new THREE.Mesh(
      p3dRibbon(sfSeg, inner, outer, ROAD_Y + 0.02),
      new THREE.MeshLambertMaterial({ color, ...dblSide })
    ));
    preview3dScene.add(new THREE.Mesh(
      p3dRibbon(sfSeg, -(inner), -(outer), ROAD_Y + 0.02),
      new THREE.MeshLambertMaterial({ color: c % 2 === 0 ? 0x111111 : 0xffffff, ...dblSide })
    ));
  }

  // ── Static car on starting line ──
  // Car geometry is in ~car-sized units; scale it so body width ≈ 1/5 of track width
  const carScale = 1.0; // matches physics.js exactly — no scaling applied in game

  const sfPt = spPts[0];
  const sfNext = spPts[Math.min(4, spPts.length - 1)];
  const sfDx = sfNext.x - sfPt.x, sfDz = sfNext.z - sfPt.z;
  const sfYaw = Math.atan2(sfDx, sfDz);

  const p3dCarGroup = new THREE.Group();

  // Body
  const p3dBody = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.58, 3.8),
    new THREE.MeshLambertMaterial({ color: 0xe63946 })
  );
  p3dBody.position.set(0, 0.52, 0);
  p3dCarGroup.add(p3dBody);

  // Cabin
  const p3dCabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.38, 0.43, 1.75),
    new THREE.MeshLambertMaterial({ color: 0xb02832 })
  );
  p3dCabin.position.set(0, 0.98, -0.18);
  p3dCarGroup.add(p3dCabin);

  // Windscreen
  const p3dWs = new THREE.Mesh(
    new THREE.BoxGeometry(1.28, 0.34, 0.05),
    new THREE.MeshLambertMaterial({ color: 0x7ad8f0, transparent: true, opacity: 0.75 })
  );
  p3dWs.position.set(0, 0.96, 0.69);
  p3dCarGroup.add(p3dWs);

  // Wheels
  const p3dWGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 14);
  const p3dWMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  for (const [wx, wz] of [[-1,-1.3],[1,-1.3],[-1,1.3],[1,1.3]]) {
    const whl = new THREE.Mesh(p3dWGeo, p3dWMat);
    whl.rotation.z = Math.PI / 2;
    whl.position.set(wx, 0.36, wz);
    p3dCarGroup.add(whl);
  }

  // Scale and place at start line — offset slightly to the right of centre
  p3dCarGroup.scale.setScalar(carScale);
  // Place car so wheels sit on road surface (ROAD_Y)
  p3dCarGroup.position.set(sfPt.x, ROAD_Y + 0.36 * carScale, sfPt.z);
  p3dCarGroup.rotation.y = sfYaw;
  preview3dScene.add(p3dCarGroup);

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

  // ── Compute chase cam position from start-line car (mirrors physics.js updateCamera chase) ──
  // S.ch=5 (cam height), S.cd=9 (distance behind), FOV=60 — same as game
  const CHASE_H = 5, CHASE_D = 9;
  const csh = Math.cos(sfYaw), snh = Math.sin(sfYaw);
  _p3dChasePos = {
    x:   sfPt.x - snh * CHASE_D,
    y:   ROAD_Y + CHASE_H,
    z:   sfPt.z - csh * CHASE_D,
    yaw: sfYaw,             // look toward car (heading direction)
    tx:  sfPt.x,
    ty:  ROAD_Y + 0.65,     // lookAt height matches physics.js
    tz:  sfPt.z
  };

  // Initial camera: above track, angled down, facing the track
  p3dChaseMode = false;
  p3dPos.x = 0;
  p3dPos.y = trackSpan * 0.6;
  p3dPos.z = -trackSpan * 0.5;
  p3dYaw   = 0;
  p3dPitch = -0.5;
  preview3dCamera.fov = 60;
  preview3dCamera.updateProjectionMatrix();
  _applyCamera();
  setupP3DControls(cnv);

  // ── Chase cam toggle button ──
  const chaseBtn = document.createElement('button');
  chaseBtn.className = 'preview3d-exit-btn';
  chaseBtn.style.cssText += ';right:auto;left:12px;top:50px;background:rgba(0,0,0,0.55);font-size:11px;padding:6px 10px;';
  chaseBtn.textContent = '🎥 Chase Cam';
  chaseBtn.onclick = () => {
    p3dChaseMode = !p3dChaseMode;
    if (p3dChaseMode) {
      // Snap to chase position and set FOV to match game
      const cp = _p3dChasePos;
      p3dPos.x = cp.x; p3dPos.y = cp.y; p3dPos.z = cp.z;
      // Compute yaw/pitch from chase position to car position (lookAt equivalent)
      const dx = cp.tx - cp.x, dy = cp.ty - cp.y, dz = cp.tz - cp.z;
      p3dYaw   = Math.atan2(dx, dz);
      p3dPitch = Math.atan2(dy, Math.sqrt(dx*dx + dz*dz));
      preview3dCamera.fov = 60;
      preview3dCamera.updateProjectionMatrix();
      _applyCamera();
      chaseBtn.style.borderColor = '#a78bfa';
      chaseBtn.style.color = '#a78bfa';
    } else {
      preview3dCamera.fov = 60;
      preview3dCamera.updateProjectionMatrix();
      chaseBtn.style.borderColor = '';
      chaseBtn.style.color = '';
    }
  };
  ol.appendChild(chaseBtn);

  // Key tracking
  window.addEventListener('keydown', e=>{ if (preview3dActive) p3dKeys[e.code]=true; });
  window.addEventListener('keyup',   e=>{ p3dKeys[e.code]=false; });

  let lastT = performance.now();
  function loop() {
    preview3dAnimId = requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;
    updateFreeRoamCamera(dt);
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

function _applyCamera() {
  if (!preview3dCamera) return;
  preview3dCamera.position.set(p3dPos.x, p3dPos.y, p3dPos.z);
  preview3dCamera.rotation.order = 'YXZ';
  preview3dCamera.rotation.y = p3dYaw;
  preview3dCamera.rotation.x = p3dPitch;
}

function setupP3DControls(cnv) {
  // ── Mouse: drag = look (yaw/pitch), scroll = move forward/back ──
  let dragging = false, lx = 0, ly = 0;
  cnv.addEventListener('mousedown', e => { dragging = true; lx = e.clientX; ly = e.clientY; });
  window.addEventListener('mouseup', () => dragging = false);
  cnv.addEventListener('mousemove', e => {
    if (!dragging) return;
    const dx = e.clientX - lx, dy = e.clientY - ly;
    lx = e.clientX; ly = e.clientY;
    p3dYaw   -= dx * 0.004;
    p3dPitch  = Math.max(-1.4, Math.min(1.4, p3dPitch - dy * 0.004));
    _applyCamera();
  });
  cnv.addEventListener('wheel', e => {
    // Scroll = move forward/back along look direction
    const spd = 8;
    const sy = Math.sin(p3dYaw), cy2 = Math.cos(p3dYaw);
    const fwd = e.deltaY < 0 ? 1 : -1;
    p3dPos.x += sy * spd * fwd * Math.abs(e.deltaY) * 0.05;
    p3dPos.z += cy2 * spd * fwd * Math.abs(e.deltaY) * 0.05;
    _applyCamera();
  }, { passive: true });

  // ── Touch controls ──
  // 1 finger slide left/right/up/down → look left/right/up/down  (yaw + pitch)
  // 2 fingers slide up/down           → move forward / backward   (along look dir)
  let _t1x = 0, _t1y = 0;
  let _t2my = 0;
  let _twoActive = false;

  cnv.addEventListener('touchstart', e => {
    e.preventDefault();
    const n = e.touches.length;
    if (n === 1) {
      _t1x = e.touches[0].clientX;
      _t1y = e.touches[0].clientY;
      _twoActive = false;
    }
    if (n >= 2) {
      _twoActive = true;
      _t2my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    }
  }, { passive: false });

  cnv.addEventListener('touchmove', e => {
    e.preventDefault();
    const n = e.touches.length;

    if (n === 1 && !_twoActive) {
      // 1-finger: look left/right and up/down
      const dx = e.touches[0].clientX - _t1x;
      const dy = e.touches[0].clientY - _t1y;
      _t1x = e.touches[0].clientX;
      _t1y = e.touches[0].clientY;
      p3dYaw   -= dx * 0.006;
      p3dPitch  = Math.max(-1.4, Math.min(1.4, p3dPitch - dy * 0.006));
      _applyCamera();
    }

    if (n >= 2) {
      _twoActive = true;
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const dy = my - _t2my;   // positive = fingers moved down = move backward
      _t2my = my;

      // Move forward/back along the horizontal look direction (ignore pitch for movement)
      const spd = 6;
      const sy  = Math.sin(p3dYaw), cy2 = Math.cos(p3dYaw);
      p3dPos.x -= sy  * dy * spd;
      p3dPos.z -= cy2 * dy * spd;
      _applyCamera();
    }
  }, { passive: false });

  cnv.addEventListener('touchend', e => {
    if (e.touches.length < 2) _twoActive = false;
    if (e.touches.length === 1) {
      _t1x = e.touches[0].clientX;
      _t1y = e.touches[0].clientY;
    }
  }, { passive: true });

  window.addEventListener('resize', () => {
    const ol = document.getElementById('preview3d-overlay');
    if (!ol || !preview3dRenderer || !preview3dCamera) return;
    preview3dRenderer.setSize(ol.clientWidth, ol.clientHeight);
    preview3dCamera.aspect = ol.clientWidth / ol.clientHeight;
    preview3dCamera.updateProjectionMatrix();
  });
}

// ── Keyboard movement (called every frame) ──
function updateFreeRoamCamera(dt) {
  if (!preview3dCamera) return;
  const speed = (p3dKeys['ShiftLeft'] || p3dKeys['ShiftRight']) ? 800 : 200;
  const s = speed * dt;
  const sy = Math.sin(p3dYaw), cy2 = Math.cos(p3dYaw);
  if (p3dKeys['KeyW'] || p3dKeys['ArrowUp'])    { p3dPos.x += sy * s; p3dPos.z += cy2 * s; }
  if (p3dKeys['KeyS'] || p3dKeys['ArrowDown'])  { p3dPos.x -= sy * s; p3dPos.z -= cy2 * s; }
  if (p3dKeys['KeyA'] || p3dKeys['ArrowLeft'])  { p3dPos.x -= cy2 * s; p3dPos.z += sy * s; }
  if (p3dKeys['KeyD'] || p3dKeys['ArrowRight']) { p3dPos.x += cy2 * s; p3dPos.z -= sy * s; }
  if (p3dKeys['KeyE']) p3dPos.y += s;
  if (p3dKeys['KeyQ']) p3dPos.y = Math.max(5, p3dPos.y - s);
  _applyCamera();
}

window.addEventListener('keydown', e=>{
  if (!preview3dActive) return;
  if (e.key==='q'||e.key==='Q') { close3DPreview(); e.preventDefault(); }
});
