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

// ─── Surface lane layout — exactly mirrors render.js SURFACE_LANES ──
// render.js constants: TRACK_HALF_WIDTH=7, BARRIER_INNER=9.0, BARRIER_OUTER=26.0
const P3D_SURFACE_LANES = {
  flat_kerb:      { inner:  7.0, outer:  8.1, y: 0.05  },
  rumble:         { inner:  7.0, outer:  8.6, y: 0.10  },
  grass:          { inner:  8.1, outer: 26.0, y: 0.005 },
  gravel:         { inner:  9.2, outer: 23.0, y: 0.01  },
  sand:           { inner:  9.2, outer: 23.0, y: 0.01  },
  tyrewall:       { inner: 23.0, outer: 23.9, y: 0.25  },
  armco:          { inner: 23.9, outer: 24.9, y: 0.40  },
  tecpro:         { inner: 24.9, outer: 25.8, y: 0.90  },
  concrete:       { inner: 23.9, outer: 24.9, y: 0.49  },
  concrete_fence: { inner: 23.9, outer: 24.9, y: 0.49  },
};

function p3dLane(surface, lane = 0) {
  const cfg = P3D_SURFACE_LANES[surface] || P3D_SURFACE_LANES.flat_kerb;
  const extra = Math.max(0, lane || 0) * 5.5;
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

// ─── Ray-cast overlap-prevention — ported from render.js _getBarrierGeo ──
// For each spline point, shoots a perpendicular ray on each side and finds
// the distance D to the nearest foreign road section. All barriers/surfaces
// are clamped to D/2 so they physically cannot cross into another section.
function p3dComputeSafeOffsets(spPts) {
  const n = spPts.length;
  if (n < 2) return { safeL: null, safeR: null, normalsL: null, normalsR: null };

  const OUTER_IDEAL = 26.0;
  const SAFETY_GAP  = 1.5;
  const RAY_MAX     = OUTER_IDEAL * 2 + SAFETY_GAP + 1;
  const CELL        = OUTER_IDEAL;

  // Winding-aware normal propagation (mirrors render.js _buildNormalsForBarrier)
  function buildNormals3D(pts, sideSign) {
    const len = pts.length;
    const raw = pts.map((p, i) => {
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(len - 1, i + 1)];
      const dx = next.x - prev.x, dz = next.z - prev.z;
      const l = Math.sqrt(dx*dx + dz*dz) || 1;
      let px = dz / l, pz = -dx / l;
      if (sideSign === 1) { px = -px; pz = -pz; }
      return { px, pz };
    });
    let area = 0;
    for (let i = 0; i < len; i++) {
      const a = pts[i], b = pts[(i + 1) % len];
      area += a.x * b.z - b.x * a.z;
    }
    const windSign = area >= 0 ? 1 : -1;
    // sideSign=0 → left (render sideNum=-1), sideSign=1 → right (render sideNum=+1)
    const expectedSign = sideSign === 0 ? windSign : -windSign;
    const p0 = pts[0], p1 = pts[1 % len];
    const dx0 = p1.x - p0.x, dz0 = p1.z - p0.z;
    const l0 = Math.sqrt(dx0*dx0 + dz0*dz0) || 1;
    const refX = (dz0 / l0) * expectedSign;
    const refZ = (-dx0 / l0) * expectedSign;
    const out = new Array(len);
    out[0] = (raw[0].px * refX + raw[0].pz * refZ < 0)
      ? { px: -raw[0].px, pz: -raw[0].pz }
      : { px:  raw[0].px, pz:  raw[0].pz };
    for (let i = 1; i < len; i++) {
      const prev = out[i - 1], c = raw[i];
      const d = prev.px * c.px + prev.pz * c.pz;
      if (d < 0) {
        out[i] = { px: -c.px, pz: -c.pz };
      } else if (d < 0.6) {
        let bx = prev.px * 0.6 + c.px * 0.4, bz = prev.pz * 0.6 + c.pz * 0.4;
        const bl = Math.sqrt(bx*bx + bz*bz) || 1;
        out[i] = { px: bx / bl, pz: bz / bl };
      } else {
        out[i] = { px: c.px, pz: c.pz };
      }
    }
    if (len > 1) out[len - 1] = { px: out[len - 2].px, pz: out[len - 2].pz };
    return out;
  }

  const normalsL = buildNormals3D(spPts, 0);
  const normalsR = buildNormals3D(spPts, 1);

  // Spatial grid of centreline segments for fast ray intersection
  const segGrid = new Map();
  function gKey(cx, cz) { return cx + ',' + cz; }
  function gAdd(cx, cz, idx) {
    const k = gKey(cx, cz);
    let b = segGrid.get(k); if (!b) { b = []; segGrid.set(k, b); } b.push(idx);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = spPts[i], b = spPts[(i + 1) % n];
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    const z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
    for (let cx = Math.floor(x0/CELL); cx <= Math.floor(x1/CELL); cx++)
      for (let cz = Math.floor(z0/CELL); cz <= Math.floor(z1/CELL); cz++)
        gAdd(cx, cz, i);
  }

  const wpCount = (typeof waypoints !== 'undefined' && waypoints.length > 0)
    ? waypoints.length : Math.max(1, Math.round(n / 14));
  const segsPerWp = Math.max(1, Math.round(n / wpCount));
  const SKIP_SEGS = Math.max(8, segsPerWp);

  function rayHit(p, nx, nz, selfSeg) {
    let bestT = RAY_MAX;
    const steps = Math.ceil(RAY_MAX / (CELL * 0.5));
    const visited = new Set();
    for (let s = 0; s <= steps; s++) {
      const t = (s / steps) * RAY_MAX;
      if (t > bestT) break;
      const qx = p.x + nx * t, qz = p.z + nz * t;
      const cx = Math.floor(qx / CELL), cz = Math.floor(qz / CELL);
      for (let dcx = -1; dcx <= 1; dcx++) {
        for (let dcz = -1; dcz <= 1; dcz++) {
          const k = gKey(cx + dcx, cz + dcz);
          if (visited.has(k)) continue; visited.add(k);
          const bucket = segGrid.get(k); if (!bucket) continue;
          for (let bi = 0; bi < bucket.length; bi++) {
            const j = bucket[bi];
            const di = Math.min(Math.abs(j - selfSeg), n - Math.abs(j - selfSeg));
            if (di < SKIP_SEGS) continue;
            const a = spPts[j], b = spPts[(j + 1) % n];
            const ex = b.x - a.x, ez = b.z - a.z;
            const det = nx * (-ez) - nz * (-ex);
            if (Math.abs(det) < 1e-9) continue;
            const rx = a.x - p.x, rz = a.z - p.z;
            const tt = (rx * (-ez) - rz * (-ex)) / det;
            if (tt <= 0 || tt >= bestT) continue;
            const uu = (nx * rz - nz * rx) / det;
            if (uu < 0 || uu > 1) continue;
            bestT = tt;
          }
        }
      }
    }
    return bestT;
  }

  const freeL = new Float64Array(n);
  const freeR = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    freeL[i] = rayHit(spPts[i], normalsL[i].px, normalsL[i].pz, i);
    freeR[i] = rayHit(spPts[i], normalsR[i].px, normalsR[i].pz, i);
  }

  // Windowed-min then triple box-blur — same smoothing as render.js
  const SMOOTH_WIN = Math.max(6, segsPerWp * 3);
  function windowedMin(src) {
    const out = new Float64Array(src.length);
    for (let i = 0; i < src.length; i++) {
      let m = src[i];
      for (let k = -SMOOTH_WIN; k <= SMOOTH_WIN; k++) {
        const j = ((i + k) % src.length + src.length) % src.length;
        if (src[j] < m) m = src[j];
      }
      out[i] = m;
    }
    return out;
  }
  function boxBlur(src, r) {
    const out = new Float64Array(src.length), w = r * 2 + 1;
    for (let i = 0; i < src.length; i++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += src[((i+k) % src.length + src.length) % src.length];
      out[i] = s / w;
    }
    return out;
  }
  const blurR = Math.max(3, Math.floor(segsPerWp * 1.5));
  const blurR2 = Math.max(2, Math.floor(segsPerWp));
  const smoothL = boxBlur(boxBlur(boxBlur(windowedMin(freeL), blurR), blurR), blurR2);
  const smoothR = boxBlur(boxBlur(boxBlur(windowedMin(freeR), blurR), blurR), blurR2);

  // Safe cap = D/2 - SAFETY_GAP/2 (same formula as render.js offsetsFor)
  const safeL = new Float64Array(n);
  const safeR = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    safeL[i] = smoothL[i] / 2 - SAFETY_GAP / 2;
    safeR[i] = smoothR[i] / 2 - SAFETY_GAP / 2;
  }

  return { safeL, safeR, normalsL, normalsR };
}

// Clamp an ideal offset to the per-point safe cap, with a hard floor.
function p3dSafeOff(ideal, safeCap, floor) {
  return Math.max(floor, Math.min(ideal, safeCap));
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
      const innerOff = lane.inner * s, outerOff = lane.outer * s;
      const [geoA, geoB] = p3dKerbRibbon(spPts, innerOff, outerOff, lane.y, 6);
      scene.add(new THREE.Mesh(geoA, new THREE.MeshLambertMaterial({ color: 0xe8392a, side: dblSide })));
      scene.add(new THREE.Mesh(geoB, new THREE.MeshLambertMaterial({ color: 0xffffff, side: dblSide })));

    } else if (surface === 'rumble') {
      // Arched corrugated humps — semicircular cross-section, alternating red/white
      const redMat   = new THREE.MeshLambertMaterial({ color: 0xdd3333, side: dblSide });
      const whiteMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: dblSide });
      const inner = lane.inner * s, outer = lane.outer * s;
      const lInner = inner, lOuter = outer;
      const W = Math.abs(lOuter - lInner), peakH = 0.04, radSegs = 6, humpEvery = 4;
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
            const lateralOff = lInner + (lOuter - lInner) * t;
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
      const innerOff = lane.inner * s, outerOff = lane.outer * s;
      scene.add(new THREE.Mesh(p3dRibbon(spPts, innerOff, outerOff, lane.y, true),
        new THREE.MeshLambertMaterial({ color: 0x9a8a78, side: dblSide })));

    } else if (surface === 'sand') {
      const innerOff = lane.inner * s, outerOff = lane.outer * s;
      scene.add(new THREE.Mesh(p3dRibbon(spPts, innerOff, outerOff, lane.y + 0.02, true),
        new THREE.MeshLambertMaterial({ color: 0xe8c87a, side: dblSide })));

    } else if (surface === 'grass') {
      const innerOff = lane.inner * s, outerOff = lane.outer * s;
      scene.add(new THREE.Mesh(p3dRibbon(spPts, innerOff, outerOff, lane.y, true),
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

  // ── Compute per-point safe offset caps (render.js ray-cast algorithm) ──
  // safeL[i] / safeR[i] = maximum offset on left/right at spline point i
  // before crossing into a foreign road section. All barriers and runoff
  // surfaces are clamped to these caps so overlap is impossible.
  const { safeL, safeR, normalsL: safeNormL, normalsR: safeNormR } =
    p3dComputeSafeOffsets(spPts);

  // Helper: get safe cap for spline index i on a given signed side (s=+1 or -1)
  function getSafeCap(i, s) {
    if (!safeL || !safeR) return 26.0;
    return s > 0 ? safeR[i] : safeL[i];
  }

  // ── Pull render.js barrier geometry (the exact same polys as 2D view) ──
  // _getBarrierGeo() returns world-space {x,y}[] arrays for inner/outer/kerb
  // on both sides, built with the winding-aware miter-bisector pipeline.
  // We convert y→z to get 3D world coords and use these as the ground truth
  // for ALL barrier/surface placement — no separate recomputation needed.
  const _rGeo = (typeof _getBarrierGeo === 'function') ? _getBarrierGeo() : null;

  // Convert render.js 2D world poly {x,y}[] to 3D {x,z}[], recentred to
  // match p3dGetScaledData()'s (cx,cy) offset.
  function r2d3(poly2d) {
    if (!poly2d) return null;
    return poly2d.map(p => ({ x: p.x - cx, z: p.y - cy }));
  }

  // Per-side render.js polys in 3D coords (null-safe fallback to null)
  const rInnerL = _rGeo ? r2d3(_rGeo['-1'].innerWorld) : null;
  const rOuterL = _rGeo ? r2d3(_rGeo['-1'].outerWorld) : null;
  const rKerbL  = _rGeo ? r2d3(_rGeo['-1'].kerbWorld)  : null;
  const rInnerR = _rGeo ? r2d3(_rGeo['1'].innerWorld)  : null;
  const rOuterR = _rGeo ? r2d3(_rGeo['1'].outerWorld)  : null;
  const rKerbR  = _rGeo ? r2d3(_rGeo['1'].kerbWorld)   : null;

  // Helper: build a flat ribbon mesh between two same-length world-poly arrays.
  // ptsA and ptsB are {x,z}[] arrays — ribbon fills between them.
  // closedLoop=true appends the first point to seal the seam.
  function p3dRibbonFromPolys(ptsA, ptsB, yBase, closedLoop = true) {
    if (!ptsA || !ptsB || ptsA.length < 2) return null;
    const aArr = closedLoop ? [...ptsA, ptsA[0]] : ptsA;
    const bArr = closedLoop ? [...ptsB, ptsB[0]] : ptsB;
    const n = Math.min(aArr.length, bArr.length);
    const pos = [], idx = [];
    for (let i = 0; i < n; i++) {
      pos.push(aArr[i].x, yBase, aArr[i].z,  bArr[i].x, yBase, bArr[i].z);
    }
    for (let i = 0; i < n - 1; i++) {
      const b = i * 2;
      idx.push(b, b+1, b+2,  b+1, b+3, b+2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    return geo;
  }

  // Helper: build a vertical wall from a {x,z}[] polyline.
  // closedLoop=true appends the first point to seal the seam.
  function p3dWallFromPoly(pts3, yBase, height, closedLoop = true) {
    if (!pts3 || pts3.length < 2) return null;
    const arr = closedLoop ? [...pts3, pts3[0]] : pts3;
    const n = arr.length;
    const pos = [], idx = [];
    for (let i = 0; i < n; i++) {
      pos.push(arr[i].x, yBase,        arr[i].z,
               arr[i].x, yBase+height, arr[i].z);
    }
    for (let i = 0; i < n - 1; i++) {
      const b = i * 2;
      idx.push(b, b+2, b+1,  b+1, b+2, b+3);  // front
      idx.push(b, b+1, b+2,  b+1, b+3, b+2);  // back
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    return geo;
  }

  // Helper: per-point tangent direction for a {x,z}[] poly (for instanced asset rotation)
  function p3dPolyTangent(pts3, i) {
    const n = pts3.length;
    const prev = pts3[Math.max(0, i-1)], next = pts3[Math.min(n-1, i+1)];
    const dx = next.x - prev.x, dz = next.z - prev.z;
    return Math.atan2(dx, dz);
  }

  // Asphalt road surface
  preview3dScene.add(new THREE.Mesh(
    p3dRibbon(spPts, -TH, TH, P3D_ROAD_Y),
    new THREE.MeshLambertMaterial({ color: 0x333338, ...dblSide })
  ));

  // ── Perimeter barrier — white wall extruded from render.js outerWorld polys ──
  // One continuous wall on each side, exactly matching the 2D view boundary.
  // H=1.0u, DoubleSide so visible from both inside and outside the track.
  {
    const barrierMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const WALL_H = 1.0;
    [rOuterL, rOuterR].forEach(oPts => {
      if (!oPts || oPts.length < 2) return;
      const wallGeo = p3dWallFromPoly(oPts, P3D_ROAD_Y, WALL_H, true);
      if (wallGeo) preview3dScene.add(new THREE.Mesh(wallGeo, barrierMat));
    });
    // Fallback if render.js geo unavailable — spline-offset wall both sides
    if (!rOuterL && !rOuterR) {
      const fallbackMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      for (const off of [26.0, -26.0]) {
        const geo = p3dBarrierRibbon(spPts, off, P3D_ROAD_Y, 1.0, 0.0, false);
        preview3dScene.add(new THREE.Mesh(geo, fallbackMat));
      }
    }
  }

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

  // ── Joystick sensitivity — always-visible top bar slider ──────────
  if (typeof window._p3dSensitivity !== 'number') window._p3dSensitivity = 0.30;

  const sensBar = document.createElement('div');
  sensBar.style.cssText = 'position:absolute;top:10px;left:50%;transform:translateX(-50%);' +
    'z-index:201;display:flex;align-items:center;gap:8px;' +
    'background:rgba(0,0,0,0.55);border:1px solid rgba(255,255,255,0.25);border-radius:20px;' +
    'padding:6px 14px;font-family:sans-serif;color:#fff;font-size:12px;white-space:nowrap;' +
    'touch-action:none;user-select:none;';
  const sensLbl = document.createElement('span');
  sensLbl.textContent = '🎚';
  sensLbl.style.cssText = 'font-size:14px;';
  const sensSlider = document.createElement('input');
  sensSlider.type = 'range';
  sensSlider.min = '5';
  sensSlider.max = '200';
  sensSlider.step = '5';
  sensSlider.value = String(Math.round(window._p3dSensitivity * 100));
  sensSlider.style.cssText = 'width:110px;touch-action:none;accent-color:#a78bfa;';
  const sensVal = document.createElement('span');
  sensVal.style.cssText = 'min-width:34px;text-align:right;opacity:0.85;font-size:11px;';

  function paintSens() {
    sensVal.textContent = window._p3dSensitivity.toFixed(2) + '×';
  }
  paintSens();
  sensSlider.addEventListener('input', () => {
    window._p3dSensitivity = Math.max(0.05, parseInt(sensSlider.value, 10) / 100);
    paintSens();
  });
  sensBar.appendChild(sensLbl);
  sensBar.appendChild(sensSlider);
  sensBar.appendChild(sensVal);
  joyOl.appendChild(sensBar);

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
