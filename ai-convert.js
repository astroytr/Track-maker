// TRACK IMAGE → WAYPOINTS  v6.1 (FIXED EYEDROPPER)
// ═══════════════════════════════════════════════════
let aiImageData = null;
let aiImgW = 0, aiImgH = 0;
let aiRawImage = null;

let aiTrackRGB = null;
let aiBgRGB    = null;
let aiEyedropperMode = null;

let aiPreviewCanvas  = null;
let aiPreviewCtx     = null;

// Legacy
let aiTrackColour = 'black';
let aiBgColour    = 'white';

function openAIConvert()  { document.getElementById('ai-modal').classList.add('open'); }
function closeAIConvert() { document.getElementById('ai-modal').classList.remove('open'); aiEyedropperMode = null; }

// ═══════════════════════════════════════════════════
// IMAGE LOAD
// ═══════════════════════════════════════════════════
function aiLoadImageFile(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {

      const MAX = 700;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      aiImgW = Math.round(img.width * scale);
      aiImgH = Math.round(img.height * scale);

      const c = document.createElement('canvas');
      c.width = aiImgW;
      c.height = aiImgH;

      const cx = c.getContext('2d');
      cx.drawImage(img, 0, 0, aiImgW, aiImgH);
      aiImageData = cx.getImageData(0, 0, aiImgW, aiImgH);

      aiPreviewCanvas = document.getElementById('ai-preview-canvas');
      aiPreviewCtx = aiPreviewCanvas.getContext('2d');

      document.getElementById('ai-preview-wrap').style.display = 'block';

      const modalBody = aiPreviewCanvas.closest('.ai-body');
      const availW = modalBody ? modalBody.clientWidth - 40 : 300;

      const dispW = Math.min(availW, aiImgW, 500);
      const dispH = Math.round(aiImgH * dispW / aiImgW);

      aiPreviewCanvas.width  = dispW;
      aiPreviewCanvas.height = dispH;

      aiPreviewCtx.drawImage(img, 0, 0, dispW, dispH);

      aiPreviewCanvas.addEventListener('click', aiCanvasClick);
      aiPreviewCanvas.addEventListener('mousemove', aiCanvasMouseMove);

      document.getElementById('ai-drop').style.display = 'none';
      setAIStatus('Pick colours then Extract', '');

      document.getElementById('ai-run-btn').disabled = false;
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// ═══════════════════════════════════════════════════
// ✅ FIXED COLOR SAMPLING (from canvas)
// ═══════════════════════════════════════════════════
function aiSamplePixelFromCanvas(cx, cy) {
  const pixel = aiPreviewCtx.getImageData(cx, cy, 1, 1).data;
  return { r: pixel[0], g: pixel[1], b: pixel[2] };
}

// ═══════════════════════════════════════════════════
// EYEDROPPER
// ═══════════════════════════════════════════════════
function startEyedropper(mode) {
  aiEyedropperMode = mode;
  aiPreviewCanvas.style.cursor = 'crosshair';
}

function cancelEyedropper() {
  aiEyedropperMode = null;
}

function aiPickColour(clientX, clientY) {
  if (!aiEyedropperMode) return;

  const rect = aiPreviewCanvas.getBoundingClientRect();
  const cx = Math.floor(clientX - rect.left);
  const cy = Math.floor(clientY - rect.top);

  const rgb = aiSamplePixelFromCanvas(cx, cy);
  const hex = rgbToHex(rgb);

  if (aiEyedropperMode === 'track') {
    aiTrackRGB = rgb;
    document.getElementById('track-swatch').style.background = hex;
  } else {
    aiBgRGB = rgb;
    document.getElementById('bg-swatch').style.background = hex;
  }

  cancelEyedropper();
}

function aiCanvasClick(e) {
  if (!aiEyedropperMode) return;
  aiPickColour(e.clientX, e.clientY);
}

// ═══════════════════════════════════════════════════
// ✅ FIXED LOUPE (uses canvas coords)
// ═══════════════════════════════════════════════════
function aiCanvasMouseMove(e) {
  if (!aiEyedropperMode) return;

  const loupe = document.getElementById('ai-loupe');
  const rect = aiPreviewCanvas.getBoundingClientRect();

  const cx = Math.floor(e.clientX - rect.left);
  const cy = Math.floor(e.clientY - rect.top);

  const LSIZE = 80;
  const ZOOM = 6;

  loupe.width = LSIZE;
  loupe.height = LSIZE;
  loupe.style.display = 'block';

  const lc = loupe.getContext('2d');
  lc.imageSmoothingEnabled = false;

  lc.drawImage(
    aiPreviewCanvas,
    cx - LSIZE/(2*ZOOM),
    cy - LSIZE/(2*ZOOM),
    LSIZE/ZOOM,
    LSIZE/ZOOM,
    0,
    0,
    LSIZE,
    LSIZE
  );
}

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════
function rgbToHex(rgb) {
  return '#' + [rgb.r, rgb.g, rgb.b]
    .map(v => v.toString(16).padStart(2,'0'))
    .join('');
}

function setAIStatus(msg) {
  document.getElementById('ai-status').textContent = msg;
}
