// ═══════════════════════════════════════════════════
// HOME SCREEN — Track Manager · Circuit Forge v7.0
// ═══════════════════════════════════════════════════
const STORAGE_PREFIX = 'cf_track_';

function getStoredTracks() {
  const tracks = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
    try {
      const data = JSON.parse(localStorage.getItem(key));
      tracks.push({ storageKey: key, ...data });
    } catch(e) {}
  }
  tracks.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  return tracks;
}

function saveCurrentTrack() {
  if (waypoints.length < 3) { showToast('Add at least 3 waypoints first'); return; }
  const name = (document.getElementById('track-name').value.trim() || 'MY CIRCUIT').toUpperCase();
  const sub  = document.getElementById('track-sub').value.trim() || 'Custom circuit';
  const storageKey = STORAGE_PREFIX + name.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const data = {
    name, sub,
    waypoints:       waypoints.map(w => ({ x: w.x, y: w.y })),
    paintLayers:     paintLayers.map(p => ({ ...p })),
    barrierSegments: barrierSegments.map(b => ({ ...b })),
    startingPointIdx,
    nPerSeg:  parseInt(document.getElementById('nperseg').value) || 12,
    barriers: document.getElementById('barriers-toggle').checked,
    savedAt:  Date.now()
  };
  localStorage.setItem(storageKey, JSON.stringify(data));
  showToast('Track saved!');
  renderHomeTrackList();
}

function loadStoredTrack(storageKey) {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    waypoints        = (data.waypoints || []).map(w => ({ x: w.x, y: w.y }));
    paintLayers      = data.paintLayers     || [];
    barrierSegments  = data.barrierSegments || [];
    startingPointIdx = data.startingPointIdx || 0;
    selectedWP       = -1;
    document.getElementById('track-name').value = data.name || 'MY CIRCUIT';
    document.getElementById('track-sub').value  = data.sub  || '';
    if (data.nPerSeg) {
      document.getElementById('nperseg').value = data.nPerSeg;
      document.getElementById('seg-val').textContent = data.nPerSeg;
    }
    if (data.barriers !== undefined) {
      document.getElementById('barriers-toggle').checked = data.barriers;
    }
    updateWPList();
    updateBarrierList();
    render();
    closeHomeScreen();
    showToast('Track loaded!');
  } catch(e) {
    showToast('Error loading track');
    console.error(e);
  }
}

function deleteStoredTrack(storageKey) {
  if (!confirm('Delete this track? This cannot be undone.')) return;
  localStorage.removeItem(storageKey);
  renderHomeTrackList();
  showToast('Track deleted');
}

function renameStoredTrack(storageKey) {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return;
  let data;
  try { data = JSON.parse(raw); } catch(e) { return; }

  const current = data.name || '';
  const input   = prompt('New track name (the game will use  track_<name>  as the file key):', current);
  if (!input || !input.trim()) return;

  const newName = input.trim().toUpperCase();
  const newKey  = STORAGE_PREFIX + newName.toLowerCase().replace(/[^a-z0-9]/g, '_');

  localStorage.removeItem(storageKey);
  data.name    = newName;
  data.savedAt = Date.now();
  localStorage.setItem(newKey, JSON.stringify(data));

  renderHomeTrackList();
  showToast('Renamed to ' + newName);
}

function uploadExistingTrack() {
  const input    = document.createElement('input');
  input.type     = 'file';
  input.accept   = '.js';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const src = ev.target.result;

        // Parse name
        const nameMatch = src.match(/name\s*:\s*['"`]([^'"`]+)['"`]/);
        const subMatch  = src.match(/sub\s*:\s*['"`]([^'"`]+)['"`]/);

        // Parse waypoints array — handles both [[x,y],...] and [{x,y},...]
        const wpBlockMatch = src.match(/waypoints\s*:\s*\[([\s\S]*?)\]\s*,?\s*\n/);
        let wpArr = [];
        if (wpBlockMatch) {
          try {
            wpArr = JSON.parse('[' + wpBlockMatch[1].replace(/\/\/[^\n]*/g,'') + ']');
          } catch(e2) {}
        }

        const baseName = file.name.replace(/\.js$/i,'').replace(/^track_/i,'').toUpperCase();
        const name     = nameMatch ? nameMatch[1].toUpperCase() : baseName;
        const sub      = subMatch  ? subMatch[1] : 'Imported track';
        const storageKey = STORAGE_PREFIX + name.toLowerCase().replace(/[^a-z0-9]/g,'_');

        const data = {
          name, sub,
          waypoints:       wpArr.map(p => Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x||0, y: p.y||0 }),
          paintLayers:     [],
          barrierSegments: [],
          startingPointIdx: 0,
          savedAt: Date.now()
        };
        localStorage.setItem(storageKey, JSON.stringify(data));
        renderHomeTrackList();
        showToast(`Imported "${name}"`);
      } catch(err) {
        showToast('Could not parse track file');
        console.error(err);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

function renderHomeTrackList() {
  const grid = document.getElementById('home-track-grid');
  if (!grid) return;
  const tracks = getStoredTracks();

  if (tracks.length === 0) {
    grid.innerHTML = '<div class="home-empty">No saved tracks yet — create a track and click Save.</div>';
    return;
  }

  grid.innerHTML = tracks.map(t => {
    const date    = t.savedAt ? new Date(t.savedAt).toLocaleDateString() : '—';
    const wpCount = t.waypoints ? t.waypoints.length : 0;
    const gameKey = 'track_' + (t.name || 'track').toLowerCase().replace(/[^a-z0-9]/g, '_');
    const sk      = t.storageKey.replace(/'/g, "\\'");
    return `<div class="home-track-card">
      <div class="home-track-name">${escHtml(t.name || 'UNNAMED')}</div>
      <div class="home-track-sub">${escHtml(t.sub || '')}</div>
      <div class="home-track-meta">${wpCount} waypoints · ${date}</div>
      <div class="home-track-key">Game key: <code>track_${(t.name||'').toLowerCase().replace(/[^a-z0-9]/g,'_')}</code></div>
      <div class="home-track-actions">
        <button class="home-btn load"   onclick="loadStoredTrack('${sk}')">Load</button>
        <button class="home-btn rename" onclick="renameStoredTrack('${sk}')">Rename</button>
        <button class="home-btn del"    onclick="deleteStoredTrack('${sk}')">Delete</button>
      </div>
    </div>`;
  }).join('');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function openHomeScreen() {
  renderHomeTrackList();
  document.getElementById('home-screen').classList.add('open');
}

function closeHomeScreen() {
  document.getElementById('home-screen').classList.remove('open');
}
