#!/usr/bin/env node
// ═══════════════════════════════════════════════════
// Circuit Forge — Auto Version Watcher
// ═══════════════════════════════════════════════════
// Watches all app files. When any file changes it:
//   1. Increments the patch number  (v7.2.0 → v7.2.1)
//   2. Rewrites the version in index.html in 3 places:
//        · HTML comment at the top
//        · <title> tag
//        · home-sub span  (visible in the UI)
//   3. Logs a timestamped line to version-history.log
//
// USAGE (run once in your project folder):
//   node watch-version.js
//
// To bump minor version manually:
//   node watch-version.js --minor
//
// To bump major version manually:
//   node watch-version.js --major
// ═══════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

// ── Files to watch ───────────────────────────────────
const WATCH_FILES = [
  'render.js',
  'tools.js',
  'export.js',
  'home.js',
  'ai-convert.js',
  'init.js',
  'style.css',
];
const INDEX_FILE   = 'index.html';
const LOG_FILE     = 'version-history.log';
const DEBOUNCE_MS  = 400; // wait 400ms after last change before writing

// ── Parse current version from index.html ────────────
function readVersion() {
  const html = fs.readFileSync(INDEX_FILE, 'utf8');
  const m = html.match(/CIRCUIT FORGE[^v]*v(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return { major: 7, minor: 2, patch: 0 };
  return {
    major: parseInt(m[1]),
    minor: parseInt(m[2]),
    patch: parseInt(m[3] || '0'),
  };
}

// ── Bump version ─────────────────────────────────────
function bumpVersion(v, type) {
  if (type === 'major') return { major: v.major + 1, minor: 0, patch: 0 };
  if (type === 'minor') return { major: v.major, minor: v.minor + 1, patch: 0 };
  return { major: v.major, minor: v.minor, patch: v.patch + 1 };
}

function vStr(v) {
  return `v${v.major}.${v.minor}.${v.patch}`;
}

// ── Write new version into index.html ────────────────
function writeVersion(newV, changedFile) {
  let html = fs.readFileSync(INDEX_FILE, 'utf8');
  const vs = vStr(newV);

  // 1. HTML comment at top  e.g.  CIRCUIT FORGE — Track Studio  v7.2
  html = html.replace(
    /(CIRCUIT FORGE[^\n]*?)v\d+\.\d+(?:\.\d+)?/g,
    (_, prefix) => `${prefix}${vs}`
  );

  // 2. <title> tag
  html = html.replace(
    /(<title>CIRCUIT FORGE\s*)v\d+\.\d+(?:\.\d+)?/,
    `$1${vs}`
  );

  // 3. cf-version span in the home screen
  html = html.replace(
    /(<span id="cf-version">)v\d+\.\d+(?:\.\d+)?(<\/span>)/,
    `$1${vs}$2`
  );

  fs.writeFileSync(INDEX_FILE, html, 'utf8');

  // ── Log entry ──────────────────────────────────────
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const logLine = `[${timestamp}]  ${vs.padEnd(12)}  changed: ${changedFile}\n`;
  fs.appendFileSync(LOG_FILE, logLine, 'utf8');

  console.log(`\x1b[32m✔ ${vs}\x1b[0m  ← ${changedFile}  \x1b[90m${timestamp}\x1b[0m`);
}

// ── Manual bump from CLI args ─────────────────────────
const args = process.argv.slice(2);
if (args.includes('--major') || args.includes('--minor')) {
  const type = args.includes('--major') ? 'major' : 'minor';
  const cur  = readVersion();
  const newV = bumpVersion(cur, type);
  writeVersion(newV, `manual --${type}`);
  console.log(`Bumped ${type}: ${vStr(cur)} → ${vStr(newV)}`);
  process.exit(0);
}

// ── Watcher ───────────────────────────────────────────
const watchDir  = process.cwd();
let debounceTimer = null;
let lastChanged   = '';

function onChange(filename) {
  if (!WATCH_FILES.includes(filename)) return;
  lastChanged = filename;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    try {
      const cur  = readVersion();
      const newV = bumpVersion(cur, 'patch');
      writeVersion(newV, lastChanged);
    } catch (e) {
      console.error('\x1b[31mVersion write failed:\x1b[0m', e.message);
    }
  }, DEBOUNCE_MS);
}

// Watch each file individually for best cross-platform reliability
WATCH_FILES.forEach(f => {
  const full = path.join(watchDir, f);
  if (!fs.existsSync(full)) {
    console.warn(`\x1b[33m⚠ Not found (will skip): ${f}\x1b[0m`);
    return;
  }
  fs.watch(full, (eventType) => {
    if (eventType === 'change') onChange(f);
  });
});

const cur = readVersion();
console.log(`\x1b[36mCircuit Forge version watcher running\x1b[0m`);
console.log(`Current version: \x1b[33m${vStr(cur)}\x1b[0m`);
console.log(`Watching: ${WATCH_FILES.filter(f => fs.existsSync(path.join(watchDir, f))).join(', ')}`);
console.log(`\x1b[90mEvery save → patch bump. Ctrl+C to stop.\x1b[0m\n`);
