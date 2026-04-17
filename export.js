// ═══════════════════════════════════════════════════
// EXPORT — Circuit Forge v7.0
// Generates a standalone track_*.js file compatible
// with the modified physics.js (buildScene hook)
// ═══════════════════════════════════════════════════

// ── Surface colours + 3D config ─────────────────────
const EXPORT_SURF = {
  flat_kerb: { color3d: '0xe8392a', label: 'Flat Kerb',    type: 'kerb',    h: 0.04 },
  sausage:   { color3d: '0xf5c518', label: 'Sausage Kerb', type: 'sausage', h: 0.20 },
  rumble:    { color3d: '0xdd3333', label: 'Rumble Strip',  type: 'kerb',    h: 0.06 },
  gravel:    { color3d: '0xc8b89a', label: 'Gravel',        type: 'runoff',  h: 0.01 },
  sand:      { color3d: '0xe3cf98', label: 'Sand',          type: 'runoff',  h: 0.01 },
  grass:     { color3d: '0x3a7a3a', label: 'Grass',         type: 'runoff',  h: 0.01 },
  armco:     { color3d: '0xcccccc', label: 'Armco Wall',    type: 'wall',    h: 0.90 },
  tecpro:    { color3d: '0x3a5fa8', label: 'Tecpro',        type: 'tecpro',  h: 1.00 },
  tyrewall:  { color3d: '0x222222', label: 'Tyre Wall',     type: 'tyres',   h: 0.92 },
};

const EXPORT_LANES = {
  flat_kerb: { inner: 14.2, outer: 18.2, y: 0.075 },
  rumble:    { inner: 14.8, outer: 19.8, y: 0.085 },
  sausage:   { inner: 18.8, outer: 22.2, y: 0.10 },
  gravel:    { inner: 23.0, outer: 35.0, y: 0.025 },
  sand:      { inner: 23.0, outer: 35.0, y: 0.026 },
  grass:     { inner: 36.0, outer: 50.0, y: 0.02 },
  armco:     { inner: 54.0, outer: 57.0, y: 0.02 },
  tecpro:    { inner: 53.0, outer: 58.0, y: 0.02 },
  tyrewall:  { inner: 52.0, outer: 58.0, y: 0.02 },
};

function expLane(surface, lane = 0) {
  const cfg = EXPORT_LANES[surface] || EXPORT_LANES.flat_kerb;
  const extra = Math.max(0, lane || 0) * 4.5;
  return {
    inner: cfg.inner + extra,
    outer: cfg.outer + extra,
    center: (cfg.inner + cfg.outer) * 0.5 + extra,
    y: cfg.y
  };
}

function expSignedBand(lane, side) {
  return side < 0 ? [-lane.outer, -lane.inner] : [lane.inner, lane.outer];
}

// ── Catmull-Rom (same as render.js) ─────────────────
function expCatmull(p0,p1,p2,p3,t) {
  const t2=t*t,t3=t2*t;
  return {
    x:0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
    y:0.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3)
  };
}

function expBuildSpline(wps, spp) {
  const n=wps.length, pts=[];
  for (let i=0;i<n;i++) {
    const p0=wps[(i-1+n)%n],p1=wps[i],p2=wps[(i+1)%n],p3=wps[(i+2)%n];
    for (let j=0;j<spp;j++) {
      const pt=expCatmull(p0,p1,p2,p3,j/spp);
      pts.push({x:pt.x,y:pt.y,wpIdx:i});
    }
  }
  return pts;
}

// ── Pre-compute normal at spline point ───────────────
function expNormal(pts, i) {
  const n=pts.length;
  const prev=pts[(i-1+n)%n], next=pts[(i+1)%n];
  const dx=next.x-prev.x, dy=next.y-prev.y;
  const len=Math.sqrt(dx*dx+dy*dy)||1;
  return { nx: dy/len, ny: -dx/len };
}

// ── Build geometry lines for inline THREE.js code ───
function genRibbonGeom(id, pts, innerOff, outerOff, y) {
  const rows = pts.map((p,i) => {
    const {nx,ny}=expNormal(pts,i);
    return `[${(p.x+nx*innerOff).toFixed(2)},${y},${(p.y+ny*innerOff).toFixed(2)},${(p.x+nx*outerOff).toFixed(2)},${y},${(p.y+ny*outerOff).toFixed(2)}]`;
  });
  return rows.join(',\n      ');
}

function ribbonMeshCode(varName, pts, innerOff, outerOff, yBase, colorStr) {
  if (pts.length < 2) return '';
  const n = pts.length;
  const posArr = [], idxArr = [];
  pts.forEach((p,i) => {
    const {nx,ny}=expNormal(pts,i);
    posArr.push(`${(p.x+nx*innerOff).toFixed(2)},${yBase},${(p.y+ny*innerOff).toFixed(2)}`);
    posArr.push(`${(p.x+nx*outerOff).toFixed(2)},${yBase},${(p.y+ny*outerOff).toFixed(2)}`);
    if (i<n-1){const b=i*2;idxArr.push(`${b},${b+1},${b+2},${b+1},${b+3},${b+2}`);}
  });
  return `  {
    const _g=new THREE.BufferGeometry();
    _g.setAttribute('position',new THREE.BufferAttribute(new Float32Array([${posArr.join(',')}]),3));
    _g.setIndex([${idxArr.join(',')}]);
    addObj(new THREE.Mesh(_g,new THREE.MeshLambertMaterial({color:${colorStr},side:THREE.DoubleSide})));
  }`;
}

function wallMeshCode(pts, sideOff, yBase, h, colorStr) {
  if (pts.length < 2) return '';
  const n = pts.length;
  const posArr = [], idxArr = [];
  pts.forEach((p,i) => {
    const {nx,ny}=expNormal(pts,i);
    const ox=p.x+nx*sideOff, oz=p.y+ny*sideOff;
    posArr.push(`${ox.toFixed(2)},${yBase},${oz.toFixed(2)}`);
    posArr.push(`${ox.toFixed(2)},${(yBase+h).toFixed(2)},${oz.toFixed(2)}`);
    if (i<n-1){const b=i*2;idxArr.push(`${b},${b+1},${b+2},${b+1},${b+3},${b+2}`);}
  });
  return `  {
    const _g=new THREE.BufferGeometry();
    _g.setAttribute('position',new THREE.BufferAttribute(new Float32Array([${posArr.join(',')}]),3));
    _g.setIndex([${idxArr.join(',')}]);
    addObj(new THREE.Mesh(_g,new THREE.MeshLambertMaterial({color:${colorStr}})));
  }`;
}

function instancedBoxCode(pts, sideOff, bw, bh, bd, colorStr, stepEvery) {
  if (pts.length < 2) return '';
  const items = [];
  for (let i=0;i<pts.length-1;i+=stepEvery) {
    const p=pts[i];
    const {nx,ny}=expNormal(pts,i);
    items.push(`[${(p.x+nx*sideOff).toFixed(2)},${(bh/2).toFixed(2)},${(p.y+ny*sideOff).toFixed(2)}]`);
  }
  if (items.length===0) return '';
  return `  {
    const _bpos=[${items.join(',')}];
    const _bmat=new THREE.MeshLambertMaterial({color:${colorStr}});
    _bpos.forEach(function(p){
      const _m=new THREE.Mesh(new THREE.BoxGeometry(${bw},${bh},${bd}),_bmat);
      _m.position.set(p[0],p[1],p[2]);
      addObj(_m);
    });
  }`;
}

function instancedCylCode(pts, sideOff, r, stackH, stackN, colorStr, stepEvery) {
  if (pts.length < 2) return '';
  const items = [];
  for (let i=0;i<pts.length-1;i+=stepEvery) {
    const p=pts[i];
    const {nx,ny}=expNormal(pts,i);
    items.push(`[${(p.x+nx*sideOff).toFixed(2)},${(p.y+ny*sideOff).toFixed(2)}]`);
  }
  if (items.length===0) return '';
  const yPositions = [];
  for (let s=0;s<stackN;s++) yPositions.push((s+0.5)*stackH);
  return `  {
    const _cpos=[${items.join(',')}];
    const _cmat=new THREE.MeshLambertMaterial({color:${colorStr}});
    const _ypos=[${yPositions.join(',')}];
    _cpos.forEach(function(p){
      _ypos.forEach(function(y){
        const _m=new THREE.Mesh(new THREE.CylinderGeometry(${r},${r},${stackH},10),_cmat);
        _m.position.set(p[0],y,p[1]);
        addObj(_m);
      });
    });
  }`;
}

// ── Generate barrier 3D code block ──────────────────
function genBarrierCode(seg, pts) {
  const surf = seg.surface;
  const cfg  = EXPORT_SURF[surf];
  if (!cfg) return '';
  const sides = (seg.side==='both'||!seg.side) ? [-1,1] : [(seg.side==='left'||seg.side===-1)?-1:1];
  let code = '';
  const TH = 14;
  sides.forEach(s => {
    const lane = expLane(surf, seg.lane || 0);
    const off = lane.center * s;
    const kOff = lane.center * s;
    const col = cfg.color3d;
    if (surf==='armco') {
      code += wallMeshCode(pts, off, 0.02, 0.90, col) + '\n';
      // Armco corrugation rail
      code += wallMeshCode(pts, off+0.08*s, 0.28, 0.07, col) + '\n';
    } else if (surf==='tecpro') {
      code += instancedBoxCode(pts, off, 1.15, 1.00, 1.15, col, 3) + '\n';
      code += instancedBoxCode(pts, off, 1.15, 1.00, 1.15,
        '0x2a3f7a', 4) + '\n';
    } else if (surf==='tyrewall') {
      code += instancedCylCode(pts, off, 0.55, 0.48, 2, col, 4) + '\n';
    } else if (surf==='sausage') {
      code += ribbonMeshCode('_sk',pts,kOff-1.8,kOff+1.8,0.03,'0xffffff') + '\n';
      code += wallMeshCode(pts, kOff, 0.02, 0.18, col) + '\n';
    } else if (surf==='flat_kerb') {
      const band = expSignedBand(lane, s);
      const halfBand = s < 0 ? [-lane.center, -lane.inner] : [lane.inner, lane.center];
      code += ribbonMeshCode('_fk',pts,band[0],band[1],lane.y,col) + '\n';
      code += ribbonMeshCode('_fkw',pts,halfBand[0],halfBand[1],lane.y,'0xffffff') + '\n';
    } else if (surf==='rumble') {
      const band = expSignedBand(lane, s);
      code += ribbonMeshCode('_rm',pts,band[0],band[1],lane.y,col) + '\n';
    } else if (surf==='gravel' || surf==='sand') {
      const band = expSignedBand(lane, s);
      code += ribbonMeshCode('_gv',pts,band[0],band[1],lane.y,col) + '\n';
    } else if (surf==='grass') {
      const band = expSignedBand(lane, s);
      code += ribbonMeshCode('_gs',pts,band[0],band[1],lane.y,col) + '\n';
    }
  });
  return code;
}

// ── Main export builder ──────────────────────────────
function buildExportCode() {
  const name     = (document.getElementById('track-name').value.trim() || 'MY CIRCUIT').toUpperCase();
  const sub      = document.getElementById('track-sub').value.trim()  || 'Custom circuit';
  const barriers = document.getElementById('barriers-toggle').checked;
  const nPerSeg  = parseInt(document.getElementById('nperseg').value) || 12;
  const key      = 'track_' + name.toLowerCase().replace(/[^a-z0-9]/g,'_').replace(/__+/g,'_');

  if (waypoints.length < 3) return '';

  // ── Scale waypoints ──────────────────────────────
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  waypoints.forEach(w=>{minX=Math.min(minX,w.x);maxX=Math.max(maxX,w.x);minY=Math.min(minY,w.y);maxY=Math.max(maxY,w.y);});
  const cx=(minX+maxX)/2, cy=(minY+maxY)/2;
  const span=Math.max(maxX-minX,maxY-minY);
  const factor=span>0?500/span:1;

  let wps=waypoints.map(w=>({x:(w.x-cx)*factor,y:(w.y-cy)*factor}));
  if (startingPointIdx>0) wps=[...wps.slice(startingPointIdx),...wps.slice(0,startingPointIdx)];

  const wpLines=wps.map((w,i)=>`      [${w.x.toFixed(1)}, ${w.y.toFixed(1)}],${i===0?'  // SF line':''}`).join('\n');

  // ── Build spline for barrier geometry ───────────
  const spPts = expBuildSpline(wps, nPerSeg);

  // ── Scale paint layers ───────────────────────────
  const scaledPaint = paintLayers.map(p=>({
    x: (p.x-cx)*factor,
    z: (p.y-cy)*factor,
    r: Math.max(1, p.r*factor*0.45),
    surface: p.surface
  }));

  // ── Generate paint circle code ───────────────────
  let paintCode = '';
  if (scaledPaint.length > 0) {
    const grouped = {};
    scaledPaint.forEach(p=>{(grouped[p.surface]=grouped[p.surface]||[]).push(p);});
    Object.entries(grouped).forEach(([surf,ps])=>{
      const cfg=EXPORT_SURF[surf];
      if (!cfg) return;
      const col=cfg.color3d;
      const items=ps.map(p=>`[${p.x.toFixed(1)},${p.z.toFixed(1)},${p.r.toFixed(1)}]`).join(',');
      paintCode += `  // ${cfg.label} patches\n`;
      const lane = expLane(surf, 0);
      paintCode += `  {const _mat=new THREE.MeshLambertMaterial({color:${col}});[${items}].forEach(function(p){const _m=new THREE.Mesh(new THREE.CylinderGeometry(p[2],p[2],0.07,12),_mat);_m.position.set(p[0],${(lane.y + 0.01).toFixed(3)},p[1]);addObj(_m);});}\n`;
    });
  }

  // ── Generate barrier segment code ────────────────
  let barrierCode = '';
  if (barrierSegments.length > 0) {
    barrierSegments.forEach((seg,bi) => {
      const fromIdx=Math.round(seg.from/waypoints.length*spPts.length);
      const toIdx=Math.min(Math.round(seg.to/waypoints.length*spPts.length),spPts.length-1);
      const segPts=spPts.slice(fromIdx,toIdx+1);
      if (segPts.length<2) return;
      const cfg=EXPORT_SURF[seg.surface];
      barrierCode += `  // Barrier ${bi}: ${cfg?cfg.label:seg.surface} WP${seg.from}→${seg.to}\n`;
      barrierCode += genBarrierCode(seg, segPts) + '\n';
    });
  }

  // ── Assemble final file ──────────────────────────
  return `// ═══════════════════════════════════════════════════
// ${name}
// Generated by Circuit Forge v7.0
// Upload as: ${key}.js  (drop into your racing game folder)
// ═══════════════════════════════════════════════════
(function () {
  'use strict';

  var trackData = {
    name: '${name}',
    sub:  '${sub}',
    sky:  0x87ceeb,
    fog:  [0x87ceeb, 200, 750],

    waypoints: [
${wpLines}
    ],

    nPerSeg:  ${nPerSeg},
    barriers: ${barriers},

    buildScene: function (_ref) {
      var addObj = _ref.addObj, THREE = _ref.THREE, TW = _ref.TW, scene = _ref.scene;

      // ── Ground ──────────────────────────────────
      var _gnd = new THREE.Mesh(
        new THREE.PlaneGeometry(3000, 3000),
        new THREE.MeshLambertMaterial({ color: 0x2d5a1b })
      );
      _gnd.rotation.x = -Math.PI / 2;
      _gnd.receiveShadow = true;
      addObj(_gnd);

${paintCode}
${barrierCode}
    }
  };

  if (typeof registerTrack === 'function') {
    registerTrack('${key}', trackData);
  } else if (typeof module !== 'undefined' && module.exports) {
    module.exports = trackData;
  } else {
    window['${key}'] = trackData;
  }
})();
`;
}

function openExport() {
  if (waypoints.length < 3) { alert('Add at least 3 waypoints before exporting.'); return; }
  const code = buildExportCode();
  document.getElementById('export-code').value = code;
  document.getElementById('export-modal').classList.add('open');
}
function closeExport() { document.getElementById('export-modal').classList.remove('open'); }

function copyExport() {
  const ta = document.getElementById('export-code');
  ta.select();
  navigator.clipboard.writeText(ta.value)
    .then(()=>showToast('Copied!'))
    .catch(()=>{ document.execCommand('copy'); showToast('Copied!'); });
}

function downloadTrack() {
  if (waypoints.length < 3) { showToast('Need at least 3 waypoints'); return; }
  const code = buildExportCode();
  const name = (document.getElementById('track-name').value.trim() || 'track').toLowerCase().replace(/[^a-z0-9]/g,'_');
  const fname = 'track_' + name + '.js';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  a.download = fname;
  a.click();
  showToast('Downloaded ' + fname);
}

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2400);
}
