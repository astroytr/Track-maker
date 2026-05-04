// ═══════════════════════════════════════════════════
// 3D PREVIEW — Circuit Forge v7.4
// Mobile-first: Lambert materials, no shadows,
// InstancedMesh for repeated objects, merged ribbons,
// pixel-ratio capped at 1.5, miter-cap corner fix,
// distinct sand/gravel colours
// ═══════════════════════════════════════════════════
let preview3dActive   = false;
let preview3dRenderer = null;
let preview3dScene    = null;
let preview3dCamera   = null;
let preview3dAnimId   = null;

const P3D_ROAD_Y = 0.02;

let p3dPos   = { x: 0, y: 200, z: 0 };
let p3dYaw   = 0;
let p3dPitch = -0.4;
let p3dKeys      = {};
let _p3dTrackSpan = 200; // updated each build3DScene call

let p3dChaseMode = false;
let _p3dChasePos = null;

// ─── Surface lane layout (car body = 1.8wu wide, 3.8wu long) ──────
const SURF_COLOR_3D = {
  flat_kerb:      0xe8392a,
  rumble:         0xdd3333,
  gravel:         0x9a8a78,
  sand:           0xe8c87a,
  grass:          0x3a7a3a,
  armco:          0xcccccc,
  tecpro:         0x3a5fa8,
  tyrewall:       0x222222,
  concrete:       0x9a9a98,
  concrete_fence: 0x9a9a98,
};

const P3D_SURFACE_LANES = {
  // Offsets EXACTLY match render.js SURFACE_LANES (world units from centreline)
  // Track half-width = 7u. Layout: road → kerb → grass/runoff → barrier
  flat_kerb:      { inner:  7.0, outer:  8.1, y: 0.05  },
  rumble:         { inner:  8.1, outer:  8.6, y: 0.10  },
  grass:          { inner:  9.2, outer: 25.5, y: 0.005 },
  gravel:         { inner:  9.2, outer: 23.0, y: 0.01  },
  sand:           { inner:  9.2, outer: 23.0, y: 0.01  },
  tecpro:         { inner: 20.5, outer: 22.5, y: 0.90  },
  armco:          { inner: 22.5, outer: 23.5, y: 0.40  },
  tyrewall:       { inner: 20.5, outer: 22.9, y: 0.25  },
  concrete:       { inner: 22.5, outer: 23.5, y: 0.49  },
  concrete_fence: { inner: 22.5, outer: 23.5, y: 0.49  },
};

function p3dLane(surface, lane = 0) {
  const cfg = P3D_SURFACE_LANES[surface] || P3D_SURFACE_LANES.flat_kerb;
  const extra = Math.max(0, lane || 0) * 5.5;  // matches render.js LANE_STEP
  return {
    inner:  cfg.inner + extra,
    outer:  cfg.outer + extra,
    center: (cfg.inner + cfg.outer) * 0.5 + extra,
    y:      cfg.y
  };
}

function p3dSignedBand(lane, side) {
  return side < 0 ? [-lane.outer, -lane.inner] : [lane.inner, lane.outer];
}

// ─── Tight-corner detection — skip instanced objects in hairpins ──
function p3dIsHairpin(normals, i, threshold = 0.42) {
  const n = normals.length;
  const a = normals[i], b = normals[(i + 1) % n];
  const dot = a.px * b.px + a.pz * b.pz;
  return dot < (1.0 - threshold);
}

// ─── Miter-cap corner fix ──────────────────────────────────────────
// Bisects the two adjacent edge normals and scales the result so
// ribbon edges meet cleanly at corners instead of overlapping/gapping.
// Clamped to maxMiter to prevent hairpin spikes.
function p3dMiterNormal(normals, i, maxMiter = 4.0) {
  const n    = normals.length;
  const cur  = normals[i];
  const prev = normals[(i - 1 + n) % n];

  let bx = cur.px + prev.px;
  let bz = cur.pz + prev.pz;
  const blen = Math.sqrt(bx*bx + bz*bz) || 1;
  bx /= blen; bz /= blen;

  const dot = bx * cur.px + bz * cur.pz;
  const miterScale = dot > 0.001 ? Math.min(1.0 / dot, maxMiter) : maxMiter;

  return { px: bx * miterScale, pz: bz * miterScale };
}

function toggle3DPreview() {
  if (preview3dActive) { close3DPreview(); } else { open3DPreview(); }
}

function open3DPreview() {
  if (waypoints.length < 3) { showToast('Need at least 3 waypoints for 3D view'); return; }
  if (typeof THREE === 'undefined') { showToast('3D engine still loading — try again in a moment'); return; }
  preview3dActive = true;
  document.getElementById('preview3d-overlay').style.display = 'flex';
  const btn = document.getElementById('btn-3d-toggle');
  if (btn) { btn.classList.add('active-3d'); btn.textContent = '← 2D View'; }
  const hud = document.getElementById('tool-hud');
  if (hud) hud.textContent = '3D Preview  ·  Left stick = look  ·  Right stick = move  ·  Q = exit';
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

// ─── World coords (same as 2D renderer) ───────────────────────────
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

// ─── Catmull-Rom spline ────────────────────────────────────────────
function p3dCatmull(p0,p1,p2,p3,t) {
  const t2=t*t, t3=t2*t;
  return {
    x: 0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
    z: 0.5*((2*p1.z)+(-p0.z+p2.z)*t+(2*p0.z-5*p1.z+4*p2.z-p3.z)*t2+(-p0.z+3*p1.z-3*p2.z+p3.z)*t3)
  };
}

function p3dBuildSpline(wps, spp) {
  const n=wps.length, pts=[];
  for (let i=0;i<n;i++) {
    const p0=wps[(i-1+n)%n], p1=wps[i], p2=wps[(i+1)%n], p3=wps[(i+2)%n];
    for (let j=0;j<spp;j++) pts.push(p3dCatmull(p0,p1,p2,p3,j/spp));
  }
  return pts;
}

// ─── Per-point lateral normals (winding-aware, propagated) ────────
function p3dComputeNormals(spPts) {
  // Closed loop version — wraps endpoints (use for full track spline only)
  const n = spPts.length;
  const raw = spPts.map((p, i) => {
    const prev = spPts[(i - 1 + n) % n];
    const next = spPts[(i + 1) % n];
    const dx = next.x - prev.x, dz = next.z - prev.z;
    const len = Math.sqrt(dx*dx + dz*dz) || 1;
    return { px: dz / len, pz: -dx / len };
  });
  let area = 0;
  for (let i=0; i<n; i++) {
    const a=spPts[i], b=spPts[(i+1)%n];
    area += a.x*b.z - b.x*a.z;
  }
  const windSign = area >= 0 ? 1 : -1;
  const out = new Array(n);
  out[0] = { px: raw[0].px * windSign, pz: raw[0].pz * windSign };
  for (let i=1; i<n; i++) {
    const dot = raw[i].px * out[i-1].px + raw[i].pz * out[i-1].pz;
    const s = dot >= 0 ? 1 : -1;
    out[i] = { px: raw[i].px * s, pz: raw[i].pz * s };
  }
  return out;
}

function p3dComputeNormalsOpen(pts) {
  // Open path version — no endpoint wrap, forward/backward differences at ends
  const n = pts.length;
  const raw = pts.map((p, i) => {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    const dx = next.x - prev.x, dz = next.z - prev.z;
    const len = Math.sqrt(dx*dx + dz*dz) || 1;
    return { px: dz / len, pz: -dx / len };
  });
  // Seed sign from middle segment direction (more stable than endpoints)
  // Use cross product of first forward vector to determine consistent winding
  const mid = Math.floor(n / 2);
  const fdx = pts[Math.min(mid+1,n-1)].x - pts[mid].x;
  const fdz = pts[Math.min(mid+1,n-1)].z - pts[mid].z;
  // raw normal cross forward: if px*fdz - pz*fdx > 0, normal points left of travel
  const cross = raw[mid].px * fdz - raw[mid].pz * fdx;
  const windSign = cross >= 0 ? 1 : -1;
  const out = new Array(n);
  out[0] = { px: raw[0].px * windSign, pz: raw[0].pz * windSign };
  for (let i=1; i<n; i++) {
    const dot = raw[i].px * out[i-1].px + raw[i].pz * out[i-1].pz;
    const s = dot >= 0 ? 1 : -1;
    out[i] = { px: raw[i].px * s, pz: raw[i].pz * s };
  }
  return out;
}

// ─── Flat ribbon geometry (miter-corrected) ───────────────────────
function p3dRibbon(spPts, innerOff, outerOff, yBase=0, isOpen=false) {
  const n = spPts.length;
  if (n < 2) return new THREE.BufferGeometry();
  const normals = isOpen ? p3dComputeNormalsOpen(spPts) : p3dComputeNormals(spPts);
  const pos=[], nor=[], uv=[], idx=[];
  // closed loop: emit n+1 verts (last == first to close seam)
  // open path:   emit n verts only, no wrap
  const count = isOpen ? n : n + 1;
  for (let i=0; i<count; i++) {
    const ci = i % n;
    let px, pz;
    if (isOpen && (i === 0 || i === n - 1)) {
      // At endpoints of open paths just use the raw normal, no miter
      px = normals[ci].px; pz = normals[ci].pz;
    } else {
      const m = p3dMiterNormal(normals, ci);
      px = m.px; pz = m.pz;
    }
    const c = spPts[ci];
    pos.push(
      c.x + px*innerOff, yBase, c.z + pz*innerOff,
      c.x + px*outerOff, yBase, c.z + pz*outerOff
    );
    nor.push(0,1,0, 0,1,0);
    const s = i / (count - 1);
    uv.push(s,0, s,1);
  }
  const quads = isOpen ? n - 1 : n;
  for (let i=0; i<quads; i++) {
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

// ─── Alternating-colour kerb ribbon (miter-corrected) ─────────────
function p3dKerbRibbon(spPts, innerOff, outerOff, yBase, segLen) {
  const n = spPts.length;
  if (n < 2) return [new THREE.BufferGeometry(), new THREE.BufferGeometry()];
  const normals = p3dComputeNormalsOpen(spPts);
  const posA=[], norA=[], posB=[], norB=[];
  const idxA=[], idxB=[];
  let viA=0, viB=0;

  for (let i=0; i<n-1; i++) {
    const i1 = i + 1;
    const getPx = (idx) => (idx === 0 || idx === n-1)
      ? { px: normals[idx].px, pz: normals[idx].pz }
      : p3dMiterNormal(normals, idx);
    const { px: px0, pz: pz0 } = getPx(i);
    const { px: px1, pz: pz1 } = getPx(i1);
    const c0 = spPts[i], c1 = spPts[i1];

    const blockIdx = Math.floor(i / segLen);
    const isA = blockIdx % 2 === 0;

    const verts = [
      c0.x + px0*innerOff, yBase, c0.z + pz0*innerOff,
      c0.x + px0*outerOff, yBase, c0.z + pz0*outerOff,
      c1.x + px1*innerOff, yBase, c1.z + pz1*innerOff,
      c1.x + px1*outerOff, yBase, c1.z + pz1*outerOff,
    ];

    if (isA) {
      posA.push(...verts);
      norA.push(0,1,0, 0,1,0, 0,1,0, 0,1,0);
      idxA.push(viA, viA+1, viA+2, viA+1, viA+3, viA+2);
      viA += 4;
    } else {
      posB.push(...verts);
      norB.push(0,1,0, 0,1,0, 0,1,0, 0,1,0);
      idxB.push(viB, viB+1, viB+2, viB+1, viB+3, viB+2);
      viB += 4;
    }
  }

  function makeGeo(pos, nor, idx) {
    if (!idx.length) return new THREE.BufferGeometry();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal',   new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    return g;
  }

  return [makeGeo(posA, norA, idxA), makeGeo(posB, norB, idxB)];
}

// ─── Sausage kerb — tube profile along miter-corrected spline ─────
function p3dSausageRibbon(spPts, sideOff, normals) {
  const n = spPts.length;
  const pts3 = spPts.map((p, i) => {
    // Skip miter at open-path endpoints to avoid wrap-around spike
    const { px, pz } = (i === 0 || i === n - 1) ? normals[i] : p3dMiterNormal(normals, i);
    return new THREE.Vector3(p.x + px*sideOff, 0, p.z + pz*sideOff);
  });
  const curve = new THREE.CatmullRomCurve3(pts3, false, 'catmullrom', 0.5);
  return new THREE.TubeGeometry(curve, pts3.length * 2, 0.18, 6, false);
}

// ─── Thick rail ribbon — front+back+top faces, real depth ─────────
// sideOff: signed lateral offset. depth: thickness toward centreline.
function p3dBarrierRibbon(pts, sideOff, yBase, height, depth=0.08, isOpen=true) {
  const n = pts.length;
  if (n < 2) return new THREE.BufferGeometry();
  const normals = isOpen ? p3dComputeNormalsOpen(pts) : p3dComputeNormals(pts);
  const pos=[], nor=[], idx=[];
  const backOff = sideOff - depth * Math.sign(sideOff || 1);
  for (let i=0; i<n; i++) {
    let px, pz;
    if (i===0||i===n-1) { px=normals[i].px; pz=normals[i].pz; }
    else { const m=p3dMiterNormal(normals,i); px=m.px; pz=m.pz; }
    const c=pts[i];
    const fx=c.x+px*sideOff, fz=c.z+pz*sideOff;
    const bx=c.x+px*backOff,  bz=c.z+pz*backOff;
    const nx=normals[i].px, nz=normals[i].pz;
    pos.push(fx,yBase,fz, fx,yBase+height,fz, bx,yBase,bz, bx,yBase+height,bz);
    nor.push(nx,0,nz, nx,0,nz, -nx,0,-nz, -nx,0,-nz);
  }
  for (let i=0; i<n-1; i++) {
    const b=i*4;
    idx.push(b,b+1,b+4, b+1,b+5,b+4);       // front
    idx.push(b+2,b+6,b+3, b+3,b+6,b+7);     // back
    idx.push(b+1,b+3,b+5, b+3,b+7,b+5);     // top
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute('normal',  new THREE.Float32BufferAttribute(nor,3));
  g.setIndex(idx);
  return g;
}

// ─── InstancedMesh helper ─────────────────────────────────────────
function p3dBuildInstanced(stepPts, normals, sideOff, stepEvery, geo, mat, yOff) {
  const dummy = new THREE.Object3D();
  const count = Math.ceil(stepPts.length / stepEvery);
  if (count === 0) return null;

  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.castShadow    = false;
  mesh.receiveShadow = false;

  let instanceIdx = 0;
  for (let i=0; i<stepPts.length; i += stepEvery) {
    if (p3dIsHairpin(normals, i)) continue;
    const p = stepPts[i];
    const { px, pz } = normals[i];
    const angle = Math.atan2(px, pz);
    dummy.position.set(p.x + px*sideOff, yOff, p.z + pz*sideOff);
    dummy.rotation.set(0, angle, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(instanceIdx++, dummy.matrix);
  }

  mesh.count = instanceIdx;
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

// ─── Place barrier 3D objects — all surfaces ──────────────────────
function p3dPlaceBarrier(scene, surface, spPts, TH, side, laneIndex) {
  const sides = (side==='both'||!side) ? [-1,1] : [(side==='left'||side===-1) ? -1 : 1];
  const normals = p3dComputeNormalsOpen(spPts);
  const dblSide = THREE.DoubleSide;
  const n = spPts.length;

  sides.forEach(s => {
    const lane  = p3dLane(surface, laneIndex || 0);

    if (surface === 'armco') {
      // W-beam armco: wide corrugated face (depth 0.22u) + galvanised colour
      const railMat  = new THREE.MeshLambertMaterial({ color: 0xd4dce6, side: dblSide });
      const railDark = new THREE.MeshLambertMaterial({ color: 0x9aaabb, side: dblSide });
      const postMat  = new THREE.MeshLambertMaterial({ color: 0x6a7a88, side: dblSide });
      const sideOff  = lane.center * s;
      const H = 0.82;
      // Two wide W-beam rails — each 0.28 tall, deep profile (0.22u depth)
      // Top rail: 0.48–0.76, Bottom rail: 0.08–0.36 — realistic armco proportions
      for (const [yb, mat] of [[0.08, railMat],[0.48, railDark]]) {
        scene.add(new THREE.Mesh(p3dBarrierRibbon(spPts, sideOff, yb, 0.28, 0.22), mat));
        // Front face highlight strip (thin, bright) to suggest W corrugation
        scene.add(new THREE.Mesh(p3dBarrierRibbon(spPts, sideOff, yb + 0.10, 0.08, 0.02), railMat));
      }
      // Posts: thinner, more frequent (every 3 pts), set back from face
      const postGeo = new THREE.BoxGeometry(0.08, H, 0.08);
      const dummy   = new THREE.Object3D();
      const stepEvery = 3;
      const postMesh  = new THREE.InstancedMesh(postGeo, postMat, Math.ceil(n / stepEvery) + 1);
      let pi = 0;
      for (let i = 0; i < n; i += stepEvery) {
        const p = spPts[i], nm = normals[i];
        dummy.position.set(
          p.x + nm.px * (sideOff - 0.24 * s),
          P3D_ROAD_Y + H / 2,
          p.z + nm.pz * (sideOff - 0.24 * s)
        );
        dummy.rotation.set(0, Math.atan2(nm.px, nm.pz), 0);
        dummy.updateMatrix();
        postMesh.setMatrixAt(pi++, dummy.matrix);
      }
      postMesh.count = pi;
      postMesh.instanceMatrix.needsUpdate = true;
      scene.add(postMesh);

    } else if (surface === 'tecpro') {
      const BH = 0.90;
      const blockMat  = new THREE.MeshLambertMaterial({ color: 0x3a5fa8, side: dblSide });
      const stripeMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
      const sideOff   = lane.center * s;
      const blockGeo  = new THREE.BoxGeometry(1.0, BH, 1.0);
      const stripeGeo = new THREE.BoxGeometry(1.02, 0.09, 1.02);
      const dummy = new THREE.Object3D();
      const stepEvery = 3;
      const count = Math.ceil(n / stepEvery);
      for (const [yOff, geo, mat] of [
        [P3D_ROAD_Y + BH*0.5, blockGeo, blockMat], [P3D_ROAD_Y + BH*1.5, blockGeo, blockMat],
        [P3D_ROAD_Y + BH*0.5, stripeGeo, stripeMat], [P3D_ROAD_Y + BH*1.5, stripeGeo, stripeMat],
      ]) {
        const mesh = new THREE.InstancedMesh(geo, mat, count);
        let idx = 0;
        for (let i = 0; i < n; i += stepEvery) {
          if (p3dIsHairpin(normals, i)) continue;
          const p = spPts[i], nm = normals[i];
          dummy.position.set(p.x + nm.px*sideOff, yOff, p.z + nm.pz*sideOff);
          dummy.rotation.set(0, Math.atan2(nm.px, nm.pz), 0);
          dummy.updateMatrix();
          mesh.setMatrixAt(idx++, dummy.matrix);
        }
        mesh.count = idx; mesh.instanceMatrix.needsUpdate = true;
        scene.add(mesh);
      }

    } else if (surface === 'tyrewall') {
      const tyrMat  = new THREE.MeshLambertMaterial({ color: 0x111111, side: dblSide });
      const swMat   = new THREE.MeshLambertMaterial({ color: 0xdddddd });
      const tyrGeo  = new THREE.CylinderGeometry(0.46, 0.46, 0.48, 12, 1);
      const swGeo   = new THREE.CylinderGeometry(0.47, 0.47, 0.05, 12, 1);
      const sideOff = lane.center * s;
      const dummy   = new THREE.Object3D();
      const stepEvery = 4;
      const count = Math.ceil(n / stepEvery);
      for (const [yOff, geo, mat] of [
        [P3D_ROAD_Y + 0.24, tyrGeo, tyrMat], [P3D_ROAD_Y + 0.72, tyrGeo, tyrMat],
        [P3D_ROAD_Y + 0.24, swGeo, swMat],   [P3D_ROAD_Y + 0.72, swGeo, swMat],
      ]) {
        const mesh = new THREE.InstancedMesh(geo, mat, count);
        let idx = 0;
        for (let i = 0; i < n; i += stepEvery) {
          if (p3dIsHairpin(normals, i)) continue;
          const p = spPts[i], nm = normals[i];
          dummy.position.set(p.x + nm.px*sideOff, yOff, p.z + nm.pz*sideOff);
          dummy.rotation.set(0, Math.atan2(nm.px, nm.pz), 0);
          dummy.updateMatrix();
          mesh.setMatrixAt(idx++, dummy.matrix);
        }
        mesh.count = idx; mesh.instanceMatrix.needsUpdate = true;
        scene.add(mesh);
      }

    } else if (surface === 'concrete') {
      // Jersey F-shape concrete wall: lower block (H=0.65, W=0.55) + upper narrower block (H=0.32, W=0.28)
      const concMatLo  = new THREE.MeshLambertMaterial({ color: 0x9a9a98, side: dblSide });
      const concMatUp  = new THREE.MeshLambertMaterial({ color: 0xb0b0ae, side: dblSide });
      const sideOff    = lane.center * s;
      const lH = 0.65, lW = 0.55, uH = 0.32, uW = 0.28;
      const geoLo = new THREE.BoxGeometry(lW, lH, 1.0);
      const geoUp = new THREE.BoxGeometry(uW, uH, 1.0);
      const dummy  = new THREE.Object3D();
      const stepEvery = 3;
      const count = Math.ceil(n / stepEvery);
      for (const [yOff, geo, mat] of [
        [P3D_ROAD_Y + lH * 0.5,          geoLo, concMatLo],
        [P3D_ROAD_Y + lH + uH * 0.5,     geoUp, concMatUp],
      ]) {
        const mesh = new THREE.InstancedMesh(geo, mat, count);
        let idx = 0;
        for (let i = 0; i < n; i += stepEvery) {
          if (p3dIsHairpin(normals, i)) continue;
          const p = spPts[i], nm = normals[i];
          dummy.position.set(p.x + nm.px * sideOff, yOff, p.z + nm.pz * sideOff);
          dummy.rotation.set(0, Math.atan2(nm.px, nm.pz), 0);
          dummy.updateMatrix();
          mesh.setMatrixAt(idx++, dummy.matrix);
        }
        mesh.count = idx; mesh.instanceMatrix.needsUpdate = true;
        scene.add(mesh);
      }

    } else if (surface === 'concrete_fence') {
      // Concrete wall + catch fence (same wall + vertical posts + net ribbon)
      const concMatLo  = new THREE.MeshLambertMaterial({ color: 0x9a9a98, side: dblSide });
      const concMatUp  = new THREE.MeshLambertMaterial({ color: 0xb0b0ae, side: dblSide });
      const postMat    = new THREE.MeshLambertMaterial({ color: 0x777880, side: dblSide });
      const netMat     = new THREE.MeshLambertMaterial({ color: 0xc0c8cc, transparent: true, opacity: 0.55, side: dblSide });
      const sideOff    = lane.center * s;
      const lH = 0.65, lW = 0.55, uH = 0.32, uW = 0.28;
      const fenceH = 2.3, wallH = lH + uH;
      const geoLo   = new THREE.BoxGeometry(lW, lH, 1.0);
      const geoUp   = new THREE.BoxGeometry(uW, uH, 1.0);
      const postGeo = new THREE.BoxGeometry(0.06, fenceH, 0.06);
      const dummy   = new THREE.Object3D();
      const stepEvery = 3;
      const count = Math.ceil(n / stepEvery);
      for (const [yOff, geo, mat] of [
        [P3D_ROAD_Y + lH * 0.5,      geoLo, concMatLo],
        [P3D_ROAD_Y + lH + uH * 0.5, geoUp, concMatUp],
        [P3D_ROAD_Y + wallH + fenceH * 0.5, postGeo, postMat],
      ]) {
        const mesh = new THREE.InstancedMesh(geo, mat, count);
        let idx = 0;
        for (let i = 0; i < n; i += stepEvery) {
          if (p3dIsHairpin(normals, i)) continue;
          const p = spPts[i], nm = normals[i];
          dummy.position.set(p.x + nm.px * sideOff, yOff, p.z + nm.pz * sideOff);
          dummy.rotation.set(0, Math.atan2(nm.px, nm.pz), 0);
          dummy.updateMatrix();
          mesh.setMatrixAt(idx++, dummy.matrix);
        }
        mesh.count = idx; mesh.instanceMatrix.needsUpdate = true;
        scene.add(mesh);
      }
      // Net ribbon along fence height
      const netInner = sideOff - 0.04 * s, netOuter = sideOff + 0.04 * s;
      scene.add(new THREE.Mesh(
        p3dBarrierRibbon(spPts, sideOff, wallH, fenceH, 0.04),
        netMat
      ));

    } else if (surface === 'flat_kerb') {
      const inner = lane.inner * s, outer = lane.outer * s;
      const lo = Math.min(inner, outer), hi = Math.max(inner, outer);
      const [geoA, geoB] = p3dKerbRibbon(spPts, lo, hi, lane.y, 6);
      scene.add(new THREE.Mesh(geoA, new THREE.MeshLambertMaterial({ color: 0xe8392a, side: dblSide })));
      scene.add(new THREE.Mesh(geoB, new THREE.MeshLambertMaterial({ color: 0xffffff, side: dblSide })));

    } else if (surface === 'rumble') {
      // Arched corrugated humps — semicircular cross-section, alternating red/white
      const redMat   = new THREE.MeshLambertMaterial({ color: 0xdd3333, side: dblSide });
      const whiteMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: dblSide });
      const inner = lane.inner * s, outer = lane.outer * s;
      const lo = Math.min(inner, outer), hi = Math.max(inner, outer);
      const W = Math.abs(hi - lo), peakH = 0.04, radSegs = 6, humpEvery = 4;
      const totalHumps = Math.floor(n / humpEvery);
      for (let h = 0; h < totalHumps; h++) {
        const i0 = h * humpEvery;
        const i1 = Math.min(i0 + humpEvery, n - 1);
        const mat = h % 2 === 0 ? redMat : whiteMat;
        const p0 = spPts[i0], p1 = spPts[i1];
        const nm0 = normals[i0], nm1 = normals[i1];
        const pos = [], idx = [];
        const rowSize = radSegs + 1;
        for (const [pi, nm] of [[p0, nm0], [p1, nm1]]) {
          for (let r = 0; r <= radSegs; r++) {
            const t = r / radSegs;
            const lateralOff = lo + t * W;
            const archY = Math.sin(Math.PI * t) * peakH + 0.02;
            pos.push(pi.x + nm.px*lateralOff, archY, pi.z + nm.pz*lateralOff);
          }
        }
        for (let r = 0; r < radSegs; r++) {
          const a=r, b=r+1, c=rowSize+r, d=rowSize+r+1;
          idx.push(a,c,b, b,c,d);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        scene.add(new THREE.Mesh(geo, mat));
      }

    } else if (surface === 'gravel') {
      const inner = lane.inner * s, outer = lane.outer * s;
      const lo = Math.min(inner, outer), hi = Math.max(inner, outer);
      scene.add(new THREE.Mesh(p3dRibbon(spPts, lo, hi, lane.y, true),
        new THREE.MeshLambertMaterial({ color: 0x9a8a78, side: dblSide })));

    } else if (surface === 'sand') {
      const inner = lane.inner * s, outer = lane.outer * s;
      const lo = Math.min(inner, outer), hi = Math.max(inner, outer);
      scene.add(new THREE.Mesh(p3dRibbon(spPts, lo, hi, lane.y + 0.02, true),
        new THREE.MeshLambertMaterial({ color: 0xe8c87a, side: dblSide })));

    } else if (surface === 'grass') {
      const inner = lane.inner * s, outer = lane.outer * s;
      const lo = Math.min(inner, outer), hi = Math.max(inner, outer);
      scene.add(new THREE.Mesh(p3dRibbon(spPts, lo, hi, lane.y, true),
        new THREE.MeshLambertMaterial({ color: 0x3a7a3a, side: dblSide })));
    }
  });
}

// ─── Main scene builder ───────────────────────────────────────────
function build3DScene() {
  const ol = document.getElementById('preview3d-overlay');
  ol.innerHTML = '';

  const cnv = document.createElement('canvas');
  cnv.style.cssText = 'width:100%;height:100%;display:block;';
  ol.appendChild(cnv);

  const hud = document.createElement('div');
  hud.className = 'preview3d-hud';
  hud.style.top = '50px';
  hud.innerHTML = '<span>Left stick = look</span><span>Right stick = move XYZ</span><span>WASD = move</span><span>Q = exit</span>';
  ol.appendChild(hud);

  const backBtn = document.createElement('button');
  backBtn.className = 'preview3d-exit-btn';
  backBtn.style.top = '50px';
  backBtn.textContent = '← Back to 2D';
  backBtn.onclick = close3DPreview;
  ol.appendChild(backBtn);

  preview3dRenderer = new THREE.WebGLRenderer({ canvas: cnv, antialias: true });
  preview3dRenderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  preview3dRenderer.setSize(ol.clientWidth, ol.clientHeight);
  preview3dRenderer.shadowMap.enabled = false;

  preview3dScene = new THREE.Scene();
  preview3dScene.background = new THREE.Color(0x87ceeb);
  preview3dScene.fog = new THREE.Fog(0x87ceeb, 200, 5000); // updated after trackSpan computed

  preview3dCamera = new THREE.PerspectiveCamera(60, ol.clientWidth/ol.clientHeight, 0.5, 200000);

  preview3dScene.add(new THREE.AmbientLight(0xffffff, 0.70));
  const sun = new THREE.DirectionalLight(0xfffae0, 0.85);
  sun.position.set(1000, 1500, 800);
  sun.castShadow = false;
  preview3dScene.add(sun);
  const fill = new THREE.DirectionalLight(0xc8d8ff, 0.25);
  fill.position.set(-800, 400, -600);
  preview3dScene.add(fill);

  const gnd = new THREE.Mesh(
    new THREE.PlaneGeometry(60000, 60000),
    new THREE.MeshLambertMaterial({ color: 0x2d5a1b })
  );
  gnd.rotation.x = -Math.PI / 2;
  gnd.receiveShadow = false;
  preview3dScene.add(gnd);

  const { wps, cx, cy } = p3dGetScaledData();
  if (wps.length < 2) return;
  const n = wps.length;
  const SPP = 14;
  const spPts = p3dBuildSpline(wps, SPP);

  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  wps.forEach(w => { minX=Math.min(minX,w.x);maxX=Math.max(maxX,w.x);minZ=Math.min(minZ,w.z);maxZ=Math.max(maxZ,w.z); });
  const trackSpan = Math.max(maxX - minX, maxZ - minZ);
  _p3dTrackSpan = trackSpan;

  const TH = typeof TRACK_HALF_WIDTH !== 'undefined' ? TRACK_HALF_WIDTH : 7;
  const dblSide = { side: THREE.DoubleSide };


  preview3dScene.add(new THREE.Mesh(
    p3dRibbon(spPts, -TH, TH, P3D_ROAD_Y),
    new THREE.MeshLambertMaterial({ color: 0x333338, ...dblSide })
  ));

  // Flat kerb — alternating red/white at track edge, always present
  {
    const kerbInner = TH, kerbOuter = TH + 1.2;
    const [gKA, gKB] = p3dKerbRibbon(spPts, kerbInner, kerbOuter, P3D_ROAD_Y + 0.05, 6);
    const [gKC, gKD] = p3dKerbRibbon(spPts, -kerbOuter, -kerbInner, P3D_ROAD_Y + 0.05, 6);
    preview3dScene.add(new THREE.Mesh(gKA, new THREE.MeshLambertMaterial({ color: 0xe8392a, ...dblSide })));
    preview3dScene.add(new THREE.Mesh(gKB, new THREE.MeshLambertMaterial({ color: 0xffffff, ...dblSide })));
    preview3dScene.add(new THREE.Mesh(gKC, new THREE.MeshLambertMaterial({ color: 0xe8392a, ...dblSide })));
    preview3dScene.add(new THREE.Mesh(gKD, new THREE.MeshLambertMaterial({ color: 0xffffff, ...dblSide })));
  }

  // ── Full-track grass band (always present, both sides) ──
  // Mirrors render.js drawPermanentGrassBand: inner=9.2, outer=26u
  {
    const grassMat = new THREE.MeshLambertMaterial({ color: 0x2d5a1b, side: THREE.DoubleSide });
    for (const s of [1, -1]) {
      preview3dScene.add(new THREE.Mesh(
        p3dRibbon(spPts, s * 8.1, s * 26.0, 0.001),
        grassMat
      ));
    }
  }

  // ── Full-track armco perimeter (always present, like every real circuit) ──
  // Sits at 24u from centreline — outside any user-placed surface.
  // User armco/tecpro/tyrewall segments paint over specific sections.
  {
    const armcoRailMat = new THREE.MeshLambertMaterial({ color: 0xc0c8d0, side: THREE.DoubleSide });
    const armcoPostMat = new THREE.MeshLambertMaterial({ color: 0x778088, side: THREE.DoubleSide });
    const defaultArmcoOff = 24.0;
    const postGeo = new THREE.BoxGeometry(0.08, 0.82, 0.08);
    const fullNormalsArmco = p3dComputeNormals(spPts);
    const dummy = new THREE.Object3D();
    for (const s of [1, -1]) {
      const sideOff = defaultArmcoOff * s;
      for (const [yb, col] of [[0.06, 0xd4dce6],[0.52, 0x9aaabb]]) {
        const railM = new THREE.MeshLambertMaterial({ color: col, side: THREE.DoubleSide });
        preview3dScene.add(new THREE.Mesh(p3dBarrierRibbon(spPts, sideOff, yb, 0.32, 0.22, false), railM));
        preview3dScene.add(new THREE.Mesh(p3dBarrierRibbon(spPts, sideOff, yb + 0.12, 0.08, 0.02, false), railM));
      }
      const postCount = Math.ceil(spPts.length / 3) + 1;
      const postMesh = new THREE.InstancedMesh(postGeo, armcoPostMat, postCount);
      let pi = 0;
      for (let i = 0; i < spPts.length; i += 3) {
        const p = spPts[i], nm = fullNormalsArmco[i];
        dummy.position.set(
          p.x + nm.px * (sideOff - 0.24 * s),
          P3D_ROAD_Y + 0.41,
          p.z + nm.pz * (sideOff - 0.24 * s)
        );
        dummy.rotation.set(0, Math.atan2(nm.px, nm.pz), 0);
        dummy.updateMatrix();
        postMesh.setMatrixAt(pi++, dummy.matrix);
      }
      postMesh.count = pi;
      postMesh.instanceMatrix.needsUpdate = true;
      preview3dScene.add(postMesh);
    }
  }

  preview3dScene.add(new THREE.Mesh(
    p3dRibbon(spPts, TH - 0.08, TH + 0.08, P3D_ROAD_Y + 0.12),
    new THREE.MeshLambertMaterial({ color: 0xffffff, ...dblSide })
  ));
  preview3dScene.add(new THREE.Mesh(
    p3dRibbon(spPts, -TH - 0.08, -TH + 0.08, P3D_ROAD_Y + 0.12),
    new THREE.MeshLambertMaterial({ color: 0xffffff, ...dblSide })
  ));

  const sfSegLen = Math.min(6, Math.floor(spPts.length * 0.01)) || 3;
  const sfSeg = spPts.slice(0, sfSegLen + 1);
  const chkW = TH / 4;
  for (let c = 0; c < 4; c++) {
    const inner = -TH + c * chkW * 2;
    const outer = inner + chkW;
    const colorA = c % 2 === 0 ? 0xffffff : 0x111111;
    const colorB = c % 2 === 0 ? 0x111111 : 0xffffff;
    preview3dScene.add(new THREE.Mesh(
      p3dRibbon(sfSeg, inner, outer, P3D_ROAD_Y + 0.02),
      new THREE.MeshLambertMaterial({ color: colorA, ...dblSide })
    ));
    preview3dScene.add(new THREE.Mesh(
      p3dRibbon(sfSeg, -inner, -outer, P3D_ROAD_Y + 0.02),
      new THREE.MeshLambertMaterial({ color: colorB, ...dblSide })
    ));
  }

  const sfPt   = spPts[0];
  const sfNext = spPts[Math.min(4, spPts.length - 1)];
  const sfDx   = sfNext.x - sfPt.x, sfDz = sfNext.z - sfPt.z;
  const sfYaw  = Math.atan2(sfDx, sfDz);
  const carScale = 1.0;

  const p3dCarGroup = new THREE.Group();
  const p3dBody = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.58, 3.8),
    new THREE.MeshLambertMaterial({ color: 0xe63946 })
  );
  p3dBody.position.set(0, 0.52, 0);
  p3dCarGroup.add(p3dBody);

  const p3dCabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.38, 0.43, 1.75),
    new THREE.MeshLambertMaterial({ color: 0xb02832 })
  );
  p3dCabin.position.set(0, 0.98, -0.18);
  p3dCarGroup.add(p3dCabin);

  const p3dWs = new THREE.Mesh(
    new THREE.BoxGeometry(1.28, 0.34, 0.05),
    new THREE.MeshLambertMaterial({ color: 0x7ad8f0, transparent: true, opacity: 0.75 })
  );
  p3dWs.position.set(0, 0.96, 0.69);
  p3dCarGroup.add(p3dWs);

  const p3dWGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 14);
  const p3dWMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  for (const [wx, wz] of [[-1,-1.3],[1,-1.3],[-1,1.3],[1,1.3]]) {
    const whl = new THREE.Mesh(p3dWGeo, p3dWMat);
    whl.rotation.z = Math.PI / 2;
    whl.position.set(wx, 0.36, wz);
    p3dCarGroup.add(whl);
  }

  p3dCarGroup.scale.setScalar(carScale);
  p3dCarGroup.position.set(sfPt.x, P3D_ROAD_Y + 0.36 * carScale, sfPt.z);
  p3dCarGroup.rotation.y = sfYaw;
  preview3dScene.add(p3dCarGroup);

  // ── Start/Finish gantry ──────────────────────────────────────────
  // Matches asset-viewer: two poles (H=4.5u), crossbar, chequered banner
  {
    const poleH     = 4.5;
    const roadW     = TH * 2;
    const poleMat   = new THREE.MeshLambertMaterial({ color: 0xcccccc });
    const bannerMat = new THREE.MeshLambertMaterial({ color: 0x111111, side: THREE.DoubleSide });
    const poleGeoG  = new THREE.CylinderGeometry(0.04, 0.04, poleH, 8);
    const poleR     = new THREE.Mesh(poleGeoG, poleMat);
    const poleL     = new THREE.Mesh(poleGeoG, poleMat);
    const crossbar  = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, roadW + 0.6, 8), poleMat);
    const banner    = new THREE.Mesh(new THREE.PlaneGeometry(roadW + 0.4, 0.55), bannerMat);
    const sfGroup   = new THREE.Group();
    poleR.position.set( TH + 0.3, poleH / 2, 0);
    poleL.position.set(-(TH + 0.3), poleH / 2, 0);
    crossbar.rotation.z = Math.PI / 2;
    crossbar.position.set(0, poleH - 0.1, 0);
    banner.position.set(0, poleH - 0.38, 0);
    sfGroup.add(poleR, poleL, crossbar, banner);
    sfGroup.position.set(sfPt.x, P3D_ROAD_Y, sfPt.z);
    sfGroup.rotation.y = sfYaw;
    preview3dScene.add(sfGroup);
  }

  // ── Distance boards (200 / 100 / 50 m) — right side, just before S/F ──
  {
    const boardData = [
      { z: -3.5, color: 0x111111 },
      { z:  0.0, color: 0xe8392a },
      { z:  3.5, color: 0x111111 },
    ];
    const postH = 2.8, boardW = 0.52, boardH = 0.78;
    const sideX = TH + 1.0;
    const postMat2 = new THREE.MeshLambertMaterial({ color: 0xaaaaaa });
    const postGeoD = new THREE.CylinderGeometry(0.04, 0.04, postH, 8);
    const sfGroup2 = new THREE.Group();
    boardData.forEach(b => {
      const bMat  = new THREE.MeshLambertMaterial({ color: b.color });
      const post  = new THREE.Mesh(postGeoD, postMat2);
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.06, boardH, boardW), bMat);
      post.position.set(sideX, postH / 2, b.z);
      board.position.set(sideX - 0.05, postH - boardH / 2 - 0.08, b.z);
      sfGroup2.add(post, board);
    });
    sfGroup2.position.set(sfPt.x, P3D_ROAD_Y, sfPt.z);
    sfGroup2.rotation.y = sfYaw;
    preview3dScene.add(sfGroup2);
  }

  // ── FIA/WEC auto-surface placement ──────────────────────────────────────────
  // Rules sourced from FIA Appendix O, WEC circuit homologation guidelines:
  //
  // BARRIERS (by impact angle & speed):
  //   Straights (low angle): Armco perimeter (always), concrete+fence where space is tight
  //   High-speed corners (high angle, runoff): TecPro at END of runoff ~20-22u
  //   Slow/tight corners: Tyre wall at ~20u (perpendicular impacts)
  //   Street-type / no runoff: Concrete wall close to track
  //
  // RUNOFF:
  //   Corner outside: gravel trap (normal) or sand (very slow tight hairpin)
  //   Both sides corner entry/exit: rumble strip outside flat kerb
  //   Slow-apex inside: sausage kerb on flat kerb
  //
  // TRACKSIDE:
  //   Distance boards (300/200/100/50m): right side, before every braking zone
  //   S/F gantry: already placed above
  //   Marshal posts: max 200m apart — placed every corner exit, right of travel
  {
    const spl = spPts.length;
    const autoNormals = p3dComputeNormals(spPts);

    // ── Curvature, signed turn direction, arc-length per point ──
    const curvature  = new Float32Array(spl);
    const cornerSign = new Float32Array(spl);
    const arcLen     = new Float32Array(spl); // cumulative arc length along spline
    for (let i = 0; i < spl; i++) {
      const p0 = spPts[(i - 1 + spl) % spl], p1 = spPts[i], p2 = spPts[(i + 1) % spl];
      const v1x = p1.x - p0.x, v1z = p1.z - p0.z;
      const v2x = p2.x - p1.x, v2z = p2.z - p1.z;
      const cross = v1x * v2z - v1z * v2x;
      const len = (Math.sqrt(v1x*v1x+v1z*v1z) * Math.sqrt(v2x*v2x+v2z*v2z)) || 1;
      curvature[i]  = Math.abs(cross) / len;
      cornerSign[i] = Math.sign(cross); // +1=left turn, -1=right turn
      const dx = p1.x - p0.x, dz = p1.z - p0.z;
      arcLen[i] = (i === 0 ? 0 : arcLen[i-1]) + Math.sqrt(dx*dx + dz*dz);
    }
    const totalArcLen = arcLen[spl - 1];

    // FIA thresholds (tuned to SPP=14 spline density)
    const CORNER_THRESH = 0.018;  // curvature → corner
    const SLOW_THRESH   = 0.045;  // curvature → slow/tight corner (hairpin)
    const MARGIN        = 14;     // dilate corner zones (spline pts)

    const inCorner  = new Uint8Array(spl);
    const isSlow    = new Uint8Array(spl);
    for (let i = 0; i < spl; i++) {
      if (curvature[i] > CORNER_THRESH) {
        for (let d = -MARGIN; d <= MARGIN; d++) inCorner[(i + d + spl) % spl] = 1;
      }
      if (curvature[i] > SLOW_THRESH) {
        for (let d = -MARGIN; d <= MARGIN; d++) isSlow[(i + d + spl) % spl] = 1;
      }
    }

    // User-painted runoff — skip auto-placement where user has already painted
    const userRunoffPts = new Set();
    p3dMergeBarrierSegments(
      barrierSegments.filter(s => ['gravel','sand','grass'].includes(s.surface)), n
    ).forEach(seg => {
      const fi = Math.round(seg.from / n * spl) % spl;
      const ti = Math.round(seg.to   / n * spl) % spl;
      const end = (ti <= fi) ? fi + spl : ti;
      for (let i = fi; i <= end; i++) userRunoffPts.add(i % spl);
    });

    // ── Helpers ──
    function collectRuns(predFn) {
      const runs = [];
      let start = -1;
      for (let i = 0; i <= spl; i++) {
        const ii = i % spl;
        if (predFn(ii) && start === -1) { start = i; }
        else if (!predFn(ii) && start !== -1) { runs.push({ from: start, to: i - 1 }); start = -1; }
      }
      return runs;
    }
    function runPts(run) {
      const pts = [];
      for (let i = run.from; i <= run.to; i++) pts.push(spPts[i % spl]);
      return pts;
    }
    function dominantSign(run) {
      let s = 0;
      for (let i = run.from; i <= run.to; i++) s += cornerSign[i % spl];
      return s > 0 ? 1 : -1;
    }
    function runNormal(run, j) { return autoNormals[(run.from + j) % spl]; }

    // ── Shared materials ──
    const gravelMat  = new THREE.MeshLambertMaterial({ color: 0x9a8a78, side: THREE.DoubleSide });
    const sandMat    = new THREE.MeshLambertMaterial({ color: 0xe8c87a, side: THREE.DoubleSide });
    const tyreMat    = new THREE.MeshLambertMaterial({ color: 0x111111, side: THREE.DoubleSide });
    const tyrSwMat   = new THREE.MeshLambertMaterial({ color: 0xdddddd, side: THREE.DoubleSide });
    const tecBlueMat = new THREE.MeshLambertMaterial({ color: 0x3a5fa8, side: THREE.DoubleSide });
    const tecWhtMat  = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const armRailMat = new THREE.MeshLambertMaterial({ color: 0xd4dce6, side: THREE.DoubleSide });
    const armPostMat = new THREE.MeshLambertMaterial({ color: 0x6a7a88, side: THREE.DoubleSide });
    const concLoMat  = new THREE.MeshLambertMaterial({ color: 0x9a9a98, side: THREE.DoubleSide });
    const concUpMat  = new THREE.MeshLambertMaterial({ color: 0xb0b0ae, side: THREE.DoubleSide });
    const netMat     = new THREE.MeshLambertMaterial({ color: 0xc0c8cc, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    const sausageMat = new THREE.MeshLambertMaterial({ color: 0xffd700, side: THREE.DoubleSide });
    const rumRedMat  = new THREE.MeshLambertMaterial({ color: 0xdd3333, side: THREE.DoubleSide });
    const rumWhtMat  = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const dummy      = new THREE.Object3D();

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 1. PERIMETER ARMCO — both sides, full track
    //    FIA: continuous armco at outer boundary (24u).
    //    Armco is the base barrier everywhere; TecPro/concrete
    //    layer on TOP of this in specific zones below.
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {
      const ARMCO_OFF = 24.0;
      const postGeo   = new THREE.BoxGeometry(0.08, 0.82, 0.08);
      for (const s of [1, -1]) {
        const off = ARMCO_OFF * s;
        // Two W-beam rails
        for (const [yb, col] of [[0.06, 0xd4dce6],[0.44, 0x9aaabb]]) {
          const mat = new THREE.MeshLambertMaterial({ color: col, side: THREE.DoubleSide });
          preview3dScene.add(new THREE.Mesh(p3dBarrierRibbon(spPts, off, yb, 0.28, 0.22, false), mat));
          preview3dScene.add(new THREE.Mesh(p3dBarrierRibbon(spPts, off, yb + 0.10, 0.08, 0.02, false), mat));
        }
        // Posts every ~3.6u (instanced)
        const postCount = Math.ceil(spl / 3) + 1;
        const postMesh  = new THREE.InstancedMesh(postGeo, armPostMat, postCount);
        let pi = 0;
        for (let i = 0; i < spl; i += 3) {
          const p = spPts[i], nm = autoNormals[i];
          dummy.position.set(p.x + nm.px*(off - 0.24*s), P3D_ROAD_Y + 0.41, p.z + nm.pz*(off - 0.24*s));
          dummy.rotation.set(0, Math.atan2(nm.px, nm.pz), 0);
          dummy.updateMatrix();
          postMesh.setMatrixAt(pi++, dummy.matrix);
        }
        postMesh.count = pi; postMesh.instanceMatrix.needsUpdate = true;
        preview3dScene.add(postMesh);
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 2. STRAIGHTS — TecPro in front of armco
    //    FIA: high-speed straight → low impact angle → energy-
    //    absorbing barrier. TecPro sits just inside armco (22.5u).
    //    Two rows stacked (real-world double-stack = 1.8m).
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {
      const straightRuns = collectRuns(i => !inCorner[i]);
      const BH = 0.90, TECPRO_OFF = 22.5;
      const blockGeo  = new THREE.BoxGeometry(1.0, BH, 1.0);
      const stripeGeo = new THREE.BoxGeometry(1.02, 0.09, 1.02);
      straightRuns.forEach(run => {
        const pts = runPts(run);
        if (pts.length < 2) return;
        for (const s of [1, -1]) {
          const off = TECPRO_OFF * s;
          const step = 3, count = Math.ceil(pts.length / step) + 1;
          for (const [yOff, geo, mat] of [
            [P3D_ROAD_Y + BH*0.5, blockGeo, tecBlueMat],
            [P3D_ROAD_Y + BH*1.5, blockGeo, tecBlueMat],
            [P3D_ROAD_Y + BH*0.5, stripeGeo, tecWhtMat],
            [P3D_ROAD_Y + BH*1.5, stripeGeo, tecWhtMat],
          ]) {
            const mesh = new THREE.InstancedMesh(geo, mat, count);
            let idx = 0;
            for (let j = 0; j < pts.length; j += step) {
              if (p3dIsHairpin(autoNormals, (run.from + j) % spl)) continue;
              const p = pts[j], nm = runNormal(run, j);
              dummy.position.set(p.x + nm.px*off, yOff, p.z + nm.pz*off);
              dummy.rotation.set(0, Math.atan2(nm.px, nm.pz), 0);
              dummy.updateMatrix();
              mesh.setMatrixAt(idx++, dummy.matrix);
            }
            mesh.count = idx; mesh.instanceMatrix.needsUpdate = true;
            preview3dScene.add(mesh);
          }
        }
      });
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 3. HIGH-SPEED CORNERS — gravel runoff + TecPro at end
    //    FIA: runoff between track and barrier. TecPro at END
    //    of runoff (20.5u), NOT on kerb edge. Gravel 9.2–20u.
    //    Only on OUTSIDE of corner (dominantSign side).
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {
      const fastCornerRuns = collectRuns(i => inCorner[i] && !isSlow[i] && !userRunoffPts.has(i));
      fastCornerRuns.forEach(run => {
        const pts = runPts(run);
        if (pts.length < 2) return;
        const ds = dominantSign(run);
        // Gravel trap: 9.2u → 20u outside
        const gInner = P3D_SURFACE_LANES.gravel.inner * ds;
        const gOuter = 20.0 * ds;
        preview3dScene.add(new THREE.Mesh(
          p3dRibbon(pts, gInner, gOuter, P3D_ROAD_Y + 0.001, true), gravelMat));
        // TecPro at end of runoff (20.5u), single row
        const BH = 0.90, off = 20.5 * ds, step = 3;
        const blockGeo  = new THREE.BoxGeometry(1.0, BH, 1.0);
        const stripeGeo = new THREE.BoxGeometry(1.02, 0.09, 1.02);
        const count = Math.ceil(pts.length / step) + 1;
        for (const [yOff, geo, mat] of [
          [P3D_ROAD_Y + BH*0.5, blockGeo, tecBlueMat],
          [P3D_ROAD_Y + BH*0.5, stripeGeo, tecWhtMat],
        ]) {
          const mesh = new THREE.InstancedMesh(geo, mat, count);
          let idx = 0;
          for (let j = 0; j < pts.length; j += step) {
            if (p3dIsHairpin(autoNormals, (run.from + j) % spl)) continue;
            const p = pts[j], nm = runNormal(run, j);
            dummy.position.set(p.x + nm.px*off, yOff, p.z + nm.pz*off);
            dummy.rotation.set(0, Math.atan2(nm.px, nm.pz), 0);
            dummy.updateMatrix();
            mesh.setMatrixAt(idx++, dummy.matrix);
          }
          mesh.count = idx; mesh.instanceMatrix.needsUpdate = true;
          preview3dScene.add(mesh);
        }
      });
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 4. SLOW/TIGHT CORNERS — sand runoff + tyre wall
    //    FIA: hairpins & chicanes use sand (stops cars gently).
    //    Tyre wall directly at runoff edge (~20u) — absorbs
    //    near-perpendicular slow impacts. Two stacked rows.
    //    Inside of slow corner: sausage kerb on flat kerb.
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {
      const slowCornerRuns = collectRuns(i => isSlow[i] && !userRunoffPts.has(i));
      const tyrGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.48, 10, 1);
      const swGeo  = new THREE.CylinderGeometry(0.47, 0.47, 0.05, 10, 1);

      slowCornerRuns.forEach(run => {
        const pts = runPts(run);
        if (pts.length < 2) return;
        const ds = dominantSign(run);
        // Sand trap: 9.2u → 19.5u outside only
        const sInner = P3D_SURFACE_LANES.sand.inner * ds;
        const sOuter = 19.5 * ds;
        preview3dScene.add(new THREE.Mesh(
          p3dRibbon(pts, sInner, sOuter, P3D_ROAD_Y + 0.01, true), sandMat));
        // Tyre wall at 20u, two rows stacked
        const step = 4, count = Math.ceil(pts.length / step) + 1;
        for (const [yOff, geo, mat] of [
          [P3D_ROAD_Y + 0.24, tyrGeo, tyreMat],
          [P3D_ROAD_Y + 0.72, tyrGeo, tyreMat],
          [P3D_ROAD_Y + 0.24, swGeo,  tyrSwMat],
          [P3D_ROAD_Y + 0.72, swGeo,  tyrSwMat],
        ]) {
          const mesh = new THREE.InstancedMesh(geo, mat, count);
          let idx = 0;
          for (let j = 0; j < pts.length; j += step) {
            if (p3dIsHairpin(autoNormals, (run.from + j) % spl)) continue;
            const p = pts[j], nm = runNormal(run, j);
            dummy.position.set(p.x + nm.px*20.0*ds, yOff, p.z + nm.pz*20.0*ds);
            dummy.rotation.set(0, Math.atan2(nm.px, nm.pz), 0);
            dummy.updateMatrix();
            mesh.setMatrixAt(idx++, dummy.matrix);
          }
          mesh.count = idx; mesh.instanceMatrix.needsUpdate = true;
          preview3dScene.add(mesh);
        }
        // Sausage kerb on inside of slow corner (on top of flat kerb)
        const sausOff = (TH + 0.6) * (-ds);
        const curve3 = new THREE.CatmullRomCurve3(
          pts.map((p, j) => {
            const nm = runNormal(run, j);
            return new THREE.Vector3(p.x + nm.px*sausOff, P3D_ROAD_Y + 0.18, p.z + nm.pz*sausOff);
          })
        );
        const tubeGeo = new THREE.TubeGeometry(curve3, pts.length * 2, 0.18, 8, false);
        preview3dScene.add(new THREE.Mesh(tubeGeo, sausageMat));
      });
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 5. RUMBLE STRIPS — both sides at ALL corners
    //    FIA: rumble at corner entry & exit both sides,
    //    immediately outside flat kerb (7.0–8.6u).
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {
      const rumbleRuns = collectRuns(i => inCorner[i]);
      rumbleRuns.forEach(run => {
        const pts = runPts(run);
        if (pts.length < 2) return;
        const inner = P3D_SURFACE_LANES.rumble.inner;
        const outer = P3D_SURFACE_LANES.rumble.outer;
        const W = outer - inner, peakH = 0.04, radSegs = 6, humpEvery = 4;
        for (const s of [1, -1]) {
          const lo = inner * s, hi = outer * s;
          const lLo = Math.min(lo, hi), lHi = Math.max(lo, hi);
          const totalHumps = Math.floor(pts.length / humpEvery);
          for (let h = 0; h < totalHumps; h++) {
            const i0 = h * humpEvery, i1 = Math.min(i0 + humpEvery, pts.length - 1);
            const mat = h % 2 === 0 ? rumRedMat : rumWhtMat;
            const p0 = pts[i0], p1 = pts[i1];
            const nm0 = runNormal(run, i0), nm1 = runNormal(run, i1);
            const pos = [], idxArr = [];
            const rowSize = radSegs + 1;
            for (const [pi, nm] of [[p0, nm0], [p1, nm1]]) {
              for (let r = 0; r <= radSegs; r++) {
                const t = r / radSegs;
                const latOff = lLo + t * W;
                pos.push(pi.x + nm.px*latOff, Math.sin(Math.PI*t)*peakH + 0.02, pi.z + nm.pz*latOff);
              }
            }
            for (let r = 0; r < radSegs; r++) {
              const a=r, b=r+1, c=rowSize+r, d=rowSize+r+1;
              idxArr.push(a,c,b, b,c,d);
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            geo.setIndex(idxArr); geo.computeVertexNormals();
            preview3dScene.add(new THREE.Mesh(geo, mat));
          }
        }
      });
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 6. DISTANCE BOARDS — right side approaching every
    //    significant braking zone (corner entry).
    //    FIA/circuit design: 300, 200, 100, 50m boards on
    //    right (outside of turn), 1u outside track edge.
    //    Placed at the spline point just BEFORE each corner.
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    {
      const postH = 2.8, boardW = 0.52, boardH = 0.78;
      const sideOff = TH + 1.2; // just outside track edge
      const postGeoD = new THREE.CylinderGeometry(0.04, 0.04, postH, 8);
      const postMatD = new THREE.MeshLambertMaterial({ color: 0xaaaaaa });
      // Boards: 300m=white, 200m=black, 100m=red, 50m=black (real FIA spec)
      const boards = [
        { dist: 42, color: 0xffffff, textColor: 0x111111, label: '300' }, // ~300m at 1u≈1.1m
        { dist: 28, color: 0x111111, textColor: 0xffffff, label: '200' },
        { dist: 14, color: 0xe8392a, textColor: 0xffffff, label: '100' },
        { dist:  7, color: 0x111111, textColor: 0xffffff, label:  '50' },
      ];

      // Find corner entries: first point of each corner run
      const cornerEntries = [];
      let wasCorner = false;
      for (let i = 0; i < spl; i++) {
        if (inCorner[i] && !wasCorner) cornerEntries.push(i);
        wasCorner = !!inCorner[i];
      }

      cornerEntries.forEach(entryIdx => {
        // Corner outside sign at entry
        const ds = -cornerSign[entryIdx] || 1; // boards on right of travel
        boards.forEach(b => {
          // Walk back along spline by b.dist points from corner entry
          const boardIdx = ((entryIdx - b.dist) + spl) % spl;
          const p   = spPts[boardIdx];
          const nm  = autoNormals[boardIdx];
          const bMat = new THREE.MeshLambertMaterial({ color: b.color });
          const post  = new THREE.Mesh(postGeoD, postMatD);
          const board = new THREE.Mesh(new THREE.BoxGeometry(0.06, boardH, boardW), bMat);
          const fwd   = spPts[(boardIdx + 1) % spl];
          const ang   = Math.atan2(fwd.x - p.x, fwd.z - p.z);
          // Place on track-right side
          const px = p.x + nm.px * sideOff * ds;
          const pz = p.z + nm.pz * sideOff * ds;
          post.position.set(px, P3D_ROAD_Y + postH/2, pz);
          post.rotation.y = ang;
          board.position.set(px - nm.px*ds*0.1, P3D_ROAD_Y + postH - boardH/2 - 0.08, pz - nm.pz*ds*0.1);
          board.rotation.y = ang;
          preview3dScene.add(post);
          preview3dScene.add(board);
        });
      });
    }
  }

  // ── User-placed barrier segments ──
  p3dMergeBarrierSegments(barrierSegments, n).forEach(seg => {
    const spl = spPts.length;
    const fromIdx = Math.round(seg.from / n * spl) % spl;
    const toIdx   = Math.round(seg.to   / n * spl) % spl;
    let segPts;
    if (seg.to < seg.from) {
      segPts = [...spPts.slice(fromIdx), ...spPts.slice(0, toIdx + 1)];
    } else if (toIdx < fromIdx) {
      segPts = spPts.slice(fromIdx);
    } else {
      segPts = spPts.slice(fromIdx, toIdx + 1);
    }
    if (segPts.length < 2) return;
    p3dPlaceBarrier(preview3dScene, seg.surface, segPts, TH, seg.side, seg.lane || 0);
  });

  // ── Paint layers → 3D (the freehand brush strokes from 2D view) ──
  // paintLayers are stored in 2D canvas coords centred at (cx,cy).
  // We mirror the same scaling p3dGetScaledData() uses: subtract (cx,cy).
  if (typeof paintLayers !== 'undefined' && paintLayers.length > 0) {
    const matCache = {};
    const paintOrder = ['grass','gravel','sand','rumble','flat_kerb','armco','tecpro','tyrewall','concrete','concrete_fence'];
    const sorted3dPaint = paintLayers.slice().sort((a, b) => {
      return paintOrder.indexOf(b.surface) - paintOrder.indexOf(a.surface);
    });
    sorted3dPaint.forEach(p => {
      const color = SURF_COLOR_3D[p.surface];
      if (color === undefined) return;
      if (!matCache[p.surface]) {
        matCache[p.surface] = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
      }
      const px3 = p.x - cx;
      const pz3 = p.y - cy;
      const lane = P3D_SURFACE_LANES[p.surface] || P3D_SURFACE_LANES.flat_kerb;
      const r3 = Math.max(1, p.r * 0.92);
      // Flat disc lying on the ground at correct surface height
      const geo = new THREE.CircleGeometry(r3, 16);
      const mesh = new THREE.Mesh(geo, matCache[p.surface]);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(px3, lane.y + 0.01, pz3);
      preview3dScene.add(mesh);
    });
  }

  const CHASE_H = 5, CHASE_D = 9;
  const csh = Math.cos(sfYaw), snh = Math.sin(sfYaw);
  _p3dChasePos = {
    x:   sfPt.x - snh * CHASE_D,
    y:   P3D_ROAD_Y + CHASE_H,
    z:   sfPt.z - csh * CHASE_D,
    yaw: sfYaw,
    tx:  sfPt.x,
    ty:  P3D_ROAD_Y + 0.65,
    tz:  sfPt.z
  };

  p3dChaseMode = false;
  // Start above track centre, angled down — trackSpan scales position to circuit size
  p3dPos.x = 0;
  p3dPos.y = Math.max(40, trackSpan * 0.45);
  p3dPos.z = -Math.max(30, trackSpan * 0.35);
  p3dYaw   = 0;
  p3dPitch = -0.55;  // ~31° down — sees track clearly on open
  // Scale fog to circuit size
  preview3dScene.fog.near = trackSpan * 1.2;
  preview3dScene.fog.far  = trackSpan * 6.0;
  preview3dCamera.fov = 60;
  preview3dCamera.updateProjectionMatrix();
  _applyCamera();
  setupP3DControls(cnv);

  const chaseBtn = document.createElement('button');
  chaseBtn.className = 'preview3d-exit-btn';
  chaseBtn.style.cssText += ';right:auto;left:12px;top:50px;background:rgba(0,0,0,0.55);font-size:11px;padding:6px 10px;';
  chaseBtn.textContent = '🎥 Chase Cam';
  chaseBtn.onclick = () => {
    p3dChaseMode = !p3dChaseMode;
    if (p3dChaseMode) {
      const cp = _p3dChasePos;
      p3dPos.x = cp.x; p3dPos.y = cp.y; p3dPos.z = cp.z;
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

  window.addEventListener('keydown', e => { if (preview3dActive) p3dKeys[e.code] = true; });
  window.addEventListener('keyup',   e => { p3dKeys[e.code] = false; });

  let lastT = performance.now();
  function loop() {
    preview3dAnimId = requestAnimationFrame(loop);
    const now = performance.now();
    const dt  = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;
    updateFreeRoamCamera(dt);
    preview3dRenderer.render(preview3dScene, preview3dCamera);
  }
  loop();
}

// ─── Merge adjacent barrier segments ──────────────────────────────
function p3dMergeBarrierSegments(segments, wpCount) {
  if (!segments || !segments.length) return [];
  const gapTolerance = Math.max(2, Math.floor((wpCount || 1) * 0.02));
  const sorted = segments.slice().sort((a, b) =>
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

// ─── Camera helpers ───────────────────────────────────────────────
function _applyCamera() {
  if (!preview3dCamera) return;
  preview3dCamera.position.set(p3dPos.x, p3dPos.y, p3dPos.z);
  preview3dCamera.rotation.order = 'YXZ';
  preview3dCamera.rotation.y = p3dYaw;
  preview3dCamera.rotation.x = p3dPitch;
}

function setupP3DControls(cnv) {
  // ── Mouse drag (desktop look) ─────────────────────
  let dragging = false, lx = 0, ly = 0;
  cnv.addEventListener('mousedown', e => { dragging = true; lx = e.clientX; ly = e.clientY; });
  window.addEventListener('mouseup', () => dragging = false);
  cnv.addEventListener('mousemove', e => {
    if (!dragging) return;
    const dx = e.clientX - lx, dy = e.clientY - ly;
    lx = e.clientX; ly = e.clientY;
    const sens = (typeof window._p3dSensitivity === 'number') ? window._p3dSensitivity : 0.65;
    p3dYaw   -= dx * 0.004 * (sens / 0.45);
    p3dPitch  = Math.max(-1.4, Math.min(1.4, p3dPitch - dy * 0.004 * (sens / 0.45)));
    _applyCamera();
  });
  cnv.addEventListener('wheel', e => {
    const spd = 8;
    const sy = Math.sin(p3dYaw), cy2 = Math.cos(p3dYaw);
    const fwd = e.deltaY < 0 ? 1 : -1;
    p3dPos.x += sy  * spd * fwd * Math.abs(e.deltaY) * 0.05;
    p3dPos.z += cy2 * spd * fwd * Math.abs(e.deltaY) * 0.05;
    _applyCamera();
  }, { passive: true });

  // ── Dual joystick (mobile) ────────────────────────
  const joyOl = document.getElementById('preview3d-overlay');

  function makeJoystick(side, label) {
    const RADIUS = 52, KNOB = 22;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;bottom:28px;' + side + ':20px;' +
      'width:' + (RADIUS*2) + 'px;height:' + (RADIUS*2) + 'px;border-radius:50%;' +
      'background:rgba(255,255,255,0.10);border:2px solid rgba(255,255,255,0.30);' +
      'touch-action:none;user-select:none;z-index:200;';
    const knob = document.createElement('div');
    knob.style.cssText = 'position:absolute;width:' + (KNOB*2) + 'px;height:' + (KNOB*2) + 'px;' +
      'border-radius:50%;background:rgba(255,255,255,0.45);' +
      'top:' + (RADIUS-KNOB) + 'px;left:' + (RADIUS-KNOB) + 'px;pointer-events:none;';
    const lbl = document.createElement('div');
    lbl.textContent = label;
    lbl.style.cssText = 'position:absolute;bottom:-20px;left:0;width:100%;text-align:center;' +
      'color:rgba(255,255,255,0.55);font-size:11px;pointer-events:none;';
    wrap.appendChild(knob);
    wrap.appendChild(lbl);
    joyOl.appendChild(wrap);

    let active = false, tid = -1, ox = 0, oy = 0;
    const axis = { x: 0, y: 0 };

    function setKnob(nx, ny) {
      const cx = Math.max(-1, Math.min(1, nx));
      const cy = Math.max(-1, Math.min(1, ny));
      knob.style.left = (RADIUS - KNOB + cx * (RADIUS - KNOB)) + 'px';
      knob.style.top  = (RADIUS - KNOB + cy * (RADIUS - KNOB)) + 'px';
      axis.x = cx; axis.y = cy;
    }

    wrap.addEventListener('touchstart', e => {
      e.preventDefault();
      const t = e.changedTouches[0];
      tid = t.identifier;
      const r = wrap.getBoundingClientRect();
      ox = r.left + RADIUS; oy = r.top + RADIUS;
      active = true;
      knob.style.background = 'rgba(255,255,255,0.70)';
    }, { passive: false });

    window.addEventListener('touchmove', e => {
      if (!active) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier !== tid) continue;
        setKnob((t.clientX - ox) / (RADIUS - KNOB), (t.clientY - oy) / (RADIUS - KNOB));
      }
    }, { passive: true });

    window.addEventListener('touchend', e => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier !== tid) continue;
        active = false; setKnob(0, 0);
        knob.style.background = 'rgba(255,255,255,0.45)';
      }
    }, { passive: true });

    return axis;
  }

  window._p3dJoystickLook = makeJoystick('left',  'LOOK');
  window._p3dJoystickMove = makeJoystick('right', 'MOVE');

  // ── Joystick sensitivity control ───────────────────────────────────
  // A button on the HUD opens a small slider that scales BOTH joysticks
  // at once. Default is reduced from the old hard-coded 2.5× rate.
  if (typeof window._p3dSensitivity !== 'number') window._p3dSensitivity = 0.65;

  const sensBtn = document.createElement('button');
  sensBtn.className = 'preview3d-exit-btn';
  sensBtn.style.cssText += ';right:auto;left:12px;top:92px;background:rgba(0,0,0,0.55);' +
    'font-size:11px;padding:6px 10px;';
  sensBtn.textContent = '🎚 Sensitivity';

  const sensPanel = document.createElement('div');
  sensPanel.style.cssText = 'position:absolute;left:12px;top:128px;z-index:201;display:none;' +
    'background:rgba(0,0,0,0.78);border:1px solid rgba(255,255,255,0.35);border-radius:8px;' +
    'padding:10px 12px;color:#fff;font-size:12px;min-width:200px;font-family:sans-serif;';
  const sensLabel = document.createElement('div');
  sensLabel.style.cssText = 'margin-bottom:6px;display:flex;justify-content:space-between;';
  const sensTitle = document.createElement('span');
  sensTitle.textContent = 'Joystick sensitivity';
  const sensValue = document.createElement('span');
  sensValue.style.cssText = 'opacity:0.85;';
  sensLabel.appendChild(sensTitle);
  sensLabel.appendChild(sensValue);
  sensPanel.appendChild(sensLabel);
  const sensSlider = document.createElement('input');
  sensSlider.type = 'range';
  sensSlider.min = '5';   // 0.05×
  sensSlider.max = '300'; // 3.00×
  sensSlider.step = '5';
  sensSlider.value = String(Math.round(window._p3dSensitivity * 100));
  sensSlider.style.cssText = 'width:100%;touch-action:none;';
  sensPanel.appendChild(sensSlider);
  const sensHint = document.createElement('div');
  sensHint.style.cssText = 'margin-top:6px;opacity:0.6;font-size:10px;';
  sensHint.textContent = 'Affects both LOOK and MOVE joysticks';
  sensPanel.appendChild(sensHint);

  function paintSens() {
    sensValue.textContent = window._p3dSensitivity.toFixed(2) + '×';
  }
  paintSens();
  sensSlider.addEventListener('input', () => {
    window._p3dSensitivity = Math.max(0.05, parseInt(sensSlider.value, 10) / 100);
    paintSens();
  });
  sensBtn.onclick = () => {
    const open = sensPanel.style.display !== 'none';
    sensPanel.style.display = open ? 'none' : 'block';
    sensBtn.style.borderColor = open ? '' : '#a78bfa';
    sensBtn.style.color       = open ? '' : '#a78bfa';
  };
  joyOl.appendChild(sensBtn);
  joyOl.appendChild(sensPanel);

  // ▲▼ buttons for Y-axis (altitude)
  const udWrap = document.createElement('div');
  udWrap.style.cssText = 'position:absolute;bottom:28px;right:132px;display:flex;flex-direction:column;gap:6px;z-index:200;';
  function makeUDBtn(lbl) {
    const b = document.createElement('button');
    b.textContent = lbl;
    b.style.cssText = 'width:42px;height:42px;border-radius:8px;background:rgba(255,255,255,0.15);' +
      'border:1.5px solid rgba(255,255,255,0.35);color:#fff;font-size:20px;touch-action:none;';
    b._held = false;
    b.addEventListener('touchstart', e => { e.preventDefault(); b._held = true; }, { passive: false });
    b.addEventListener('touchend',   () => b._held = false);
    b.addEventListener('mousedown',  () => b._held = true);
    b.addEventListener('mouseup',    () => b._held = false);
    udWrap.appendChild(b);
    return b;
  }
  window._p3dBtnUp   = makeUDBtn('▲');
  window._p3dBtnDown = makeUDBtn('▼');
  joyOl.appendChild(udWrap);

  window.addEventListener('resize', () => {
    const ol2 = document.getElementById('preview3d-overlay');
    if (!ol2 || !preview3dRenderer || !preview3dCamera) return;
    preview3dRenderer.setSize(ol2.clientWidth, ol2.clientHeight);
    preview3dCamera.aspect = ol2.clientWidth / ol2.clientHeight;
    preview3dCamera.updateProjectionMatrix();
  });
}

function updateFreeRoamCamera(dt) {
  if (!preview3dCamera) return;
  const speed = (p3dKeys['ShiftLeft'] || p3dKeys['ShiftRight']) ? Math.max(800, _p3dTrackSpan * 4) : Math.max(200, _p3dTrackSpan * 1.2);
  const s = speed * dt;
  const sy = Math.sin(p3dYaw), cy2 = Math.cos(p3dYaw);

  // Keyboard
  if (p3dKeys['KeyW'] || p3dKeys['ArrowUp'])    { p3dPos.x += sy * s; p3dPos.z += cy2 * s; }
  if (p3dKeys['KeyS'] || p3dKeys['ArrowDown'])  { p3dPos.x -= sy * s; p3dPos.z -= cy2 * s; }
  if (p3dKeys['KeyA'] || p3dKeys['ArrowLeft'])  { p3dPos.x -= cy2 * s; p3dPos.z += sy * s; }
  if (p3dKeys['KeyD'] || p3dKeys['ArrowRight']) { p3dPos.x += cy2 * s; p3dPos.z -= sy * s; }
  if (p3dKeys['KeyE']) p3dPos.y += s;
  if (p3dKeys['KeyZ']) p3dPos.y = Math.max(5, p3dPos.y - s);  // Z=descend (Q=exit)

  // User-controlled sensitivity multiplier (set by the on-screen slider).
  const sens = (typeof window._p3dSensitivity === 'number') ? window._p3dSensitivity : 0.65;

  // Left joystick = look
  const look = window._p3dJoystickLook;
  if (look && (look.x !== 0 || look.y !== 0)) {
    p3dYaw   -= look.x * 3.0 * sens * dt;
    p3dPitch  = Math.max(-1.4, Math.min(1.4, p3dPitch - look.y * 3.0 * sens * dt));
  }

  // Right joystick = move (fwd/back/strafe)
  const move = window._p3dJoystickMove;
  if (move && (move.x !== 0 || move.y !== 0)) {
    const jSpd = s * 3.5 * sens;
    p3dPos.x += ( sy * (-move.y) + cy2 * move.x) * jSpd;
    p3dPos.z += (cy2 * (-move.y) - sy  * move.x) * jSpd;
  }

  // ▲▼ buttons = altitude
  const btnU = window._p3dBtnUp, btnD = window._p3dBtnDown;
  if (btnU && btnU._held) p3dPos.y += s * 1.5;
  if (btnD && btnD._held) p3dPos.y = Math.max(5, p3dPos.y - s * 1.5);

  _applyCamera();
}

window.addEventListener('keydown', e => {
  if (!preview3dActive) return;
  if (e.key === 'q' || e.key === 'Q') { close3DPreview(); e.preventDefault(); }
});
