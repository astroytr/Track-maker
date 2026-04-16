// ═══════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════
function buildExportCode() {
  const name = document.getElementById('track-name').value.trim() || 'MY CIRCUIT';
  const sub  = document.getElementById('track-sub').value.trim()  || 'Custom circuit';
  const barriers = document.getElementById('barriers-toggle').checked;
  const nPerSeg  = document.getElementById('nperseg').value;
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/__+/g, '_');

  // ── Scale to match tracks.js real-world metre units (TW = 14m) ──
  // Target span ~500m, matching the spa track (~600 units wide at 1 unit = 1 metre).
  let wps = waypoints;
  let scaleNote = '';
  if (wps.length > 0) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    wps.forEach(w => { minX = Math.min(minX, w.x); maxX = Math.max(maxX, w.x); minY = Math.min(minY, w.y); maxY = Math.max(maxY, w.y); });
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const span = Math.max(maxX - minX, maxY - minY);
    const TARGET = 500;
    const factor = span > 0 ? TARGET / span : 1;
    wps = wps.map(w => ({ x: (w.x - cx) * factor, y: (w.y - cy) * factor }));
    scaleNote = `    // Scale: 1 canvas-px = ${(1 / factor).toFixed(3)} m. Span ~${TARGET} m.\n`;
  }

  // Rotate so startingPointIdx is first (SF line = index 0, matching tracks.js convention)
  if (startingPointIdx > 0 && wps.length > 0) {
    wps = [...wps.slice(startingPointIdx), ...wps.slice(0, startingPointIdx)];
  }

  const wpLines = wps.map((w, i) => `      [${w.x.toFixed(1)}, ${w.y.toFixed(1)}],${i === 0 ? '  // SF line' : ''}`).join('\n');

  const barrierLines = barrierSegments.length > 0
    ? `\n    barriers_detail: [\n${barrierSegments.map(b => `      { from: ${b.from}, to: ${b.to}, surface: '${b.surface}', side: '${b.side || 'both'}', lane: ${b.lane || 0} }`).join(',\n')}\n    ],`
    : '';

  return `  // -- ${name} --
  // Paste inside TRACK_DEFS in tracks.js
  ${key}: {
    name: '${name}',
    sub:  '${sub}',
    barriers: ${barriers},
${scaleNote}    waypoints: [
${wpLines}
    ],
    nPerSeg: ${nPerSeg},${barrierLines}
  },`;
}

function openExport() {
  if (waypoints.length < 3) { alert('Add at least 3 waypoints before exporting.'); return; }
  document.getElementById('export-code').value = buildExportCode();
  document.getElementById('export-modal').classList.add('open');
}
function closeExport() { document.getElementById('export-modal').classList.remove('open'); }

function copyExport() {
  const ta = document.getElementById('export-code');
  ta.select();
  navigator.clipboard.writeText(ta.value)
    .then(() => showToast('Copied!'))
    .catch(() => { document.execCommand('copy'); showToast('Copied!'); });
}

function downloadTrack() {
  const name = (document.getElementById('track-name').value.trim() || 'track').toLowerCase().replace(/[^a-z0-9]/g, '_');
  const full = `// -- Track export from CIRCUIT FORGE --\n// Paste inside TRACK_DEFS in tracks.js\n\n${buildExportCode()}\n`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([full], { type: 'text/javascript' }));
  a.download = `track_${name}.js`;
  a.click();
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}
