// ═══════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════
function buildExportCode() {
  const name = document.getElementById('track-name').value.trim() || 'MY CIRCUIT';
  const sub  = document.getElementById('track-sub').value.trim()  || 'Custom circuit';
  const barriers = document.getElementById('barriers-toggle').checked;
  const nPerSeg  = document.getElementById('nperseg').value;
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/__+/g, '_');

  let wps = waypoints;
  let scaleNote = '';
  if (wps.length > 0) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    wps.forEach(w => { minX = Math.min(minX, w.x); maxX = Math.max(maxX, w.x); minY = Math.min(minY, w.y); maxY = Math.max(maxY, w.y); });
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const span = Math.max(maxX - minX, maxY - minY);
    const factor = span > 0 ? 600 / span : 1;
    wps = wps.map(w => ({ x: (w.x - cx) * factor, y: (w.y - cy) * factor }));
    scaleNote = `  // Auto-scaled: 1px ≈ ${(1 / factor).toFixed(2)} game-units.\n`;
  }

  const surfaceCounts = {};
  paintLayers.forEach(p => { surfaceCounts[p.surface] = (surfaceCounts[p.surface] || 0) + 1; });
  const surfList = Object.entries(surfaceCounts).map(([k, v]) => `${SURFACES[k]?.label || k}(${v})`).join(', ');
  const wpLines = wps.map((w, i) => `      [${w.x.toFixed(1)}, ${w.y.toFixed(1)}],${i === 0 ? '  // SF line' : ''}`).join('\n');
  const paintSummary = paintLayers.length > 0 ? `\n  // Paint zones: ${surfList}\n  // (${paintLayers.length} paint blobs)` : '';
  const barrierLines = barrierSegments.length > 0
    ? `\n    barriers_detail: [\n${barrierSegments.map(b => `      { from: ${b.from}, to: ${b.to}, surface: '${b.surface}' }`).join(',\n')}\n    ],`
    : '';

  return `  // ── ${name} ──────────────────────────────────────────
  ${key}: {
    name: '${name}',
    sub:  '${sub}',
    barriers: ${barriers},
    startingPoint: ${startingPointIdx},
${scaleNote}    waypoints: [
${wpLines}
    ],
    nPerSeg: ${nPerSeg},${barrierLines}${paintSummary}
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
  const full = `// ── Track export from CIRCUIT FORGE ──\n// Paste inside TRACK_DEFS in tracks.js\n\n${buildExportCode()}\n`;
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
