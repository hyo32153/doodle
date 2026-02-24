import { CLASSES } from './classes.js';

const MODEL_URL = 'https://yining1023.github.io/doodleNet/demo/DoodleClassifier_345/model/model.json';
const TOP_K = 3;
const DEBOUNCE_MS = 300;
const MODEL_INPUT_SIZE = 28;

// DOM elements
const canvas = document.getElementById('drawing-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const clearBtn = document.getElementById('clear-btn');
const undoBtn = document.getElementById('undo-btn');
const predictionsEl = document.getElementById('predictions');
const statusEl = document.getElementById('status');
const previewCanvas = document.getElementById('preview-canvas');
const previewCtx = previewCanvas.getContext('2d');

// State
let model = null;
let isDrawing = false;
let strokes = [];       // Array of strokes, each stroke is an array of {x, y}
let currentStroke = [];
let debounceTimer = null;

// --- Model Loading ---

async function loadModel() {
  try {
    model = await tf.loadLayersModel(MODEL_URL);
    statusEl.textContent = 'Model ready - start drawing!';
    statusEl.className = 'status-bar ready';
  } catch (err) {
    statusEl.textContent = `Failed to load model: ${err.message}`;
    statusEl.className = 'status-bar error';
    console.error('Model load error:', err);
  }
}

// --- Canvas Drawing ---

function initCanvas() {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#000000';
}

function getPointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  if (e.touches) {
    return {
      x: (e.touches[0].clientX - rect.left) * scaleX,
      y: (e.touches[0].clientY - rect.top) * scaleY,
    };
  }
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

function startDrawing(e) {
  e.preventDefault();
  if (!model) return;
  isDrawing = true;
  const pos = getPointerPos(e);
  currentStroke = [pos];
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
}

function draw(e) {
  e.preventDefault();
  if (!isDrawing) return;
  const pos = getPointerPos(e);
  currentStroke.push(pos);
  ctx.lineTo(pos.x, pos.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
}

function stopDrawing(e) {
  if (e) e.preventDefault();
  if (!isDrawing) return;
  isDrawing = false;
  if (currentStroke.length > 0) {
    strokes.push([...currentStroke]);
    currentStroke = [];
  }
  schedulePrediction();
}

// --- Preprocessing (coordinate-based, line-thickness independent) ---

function getInputTensor() {
  if (strokes.length === 0) return null;

  // Collect all points to find bounding box
  const allPoints = strokes.flat();
  if (allPoints.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of allPoints) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const drawW = maxX - minX;
  const drawH = maxY - minY;

  // Handle single-point (dot) drawing
  if (drawW < 1 && drawH < 1) return null;

  // Fit into 20x20 area centered in 28x28 (Quick Draw standard: 20px content + 4px padding each side)
  const contentSize = 20;
  const offset = 4;
  const maxDim = Math.max(drawW, drawH);
  const scale = contentSize / maxDim;

  // Center the shorter axis
  const scaledW = drawW * scale;
  const scaledH = drawH * scale;
  const offsetX = offset + (contentSize - scaledW) / 2;
  const offsetY = offset + (contentSize - scaledH) / 2;

  // Render strokes onto a 28x28 offscreen canvas with fixed stroke width
  const offscreen = document.createElement('canvas');
  offscreen.width = MODEL_INPUT_SIZE;
  offscreen.height = MODEL_INPUT_SIZE;
  const offCtx = offscreen.getContext('2d');

  // White background
  offCtx.fillStyle = '#ffffff';
  offCtx.fillRect(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);

  // Draw strokes with normalized coordinates
  offCtx.strokeStyle = '#000000';
  offCtx.lineCap = 'round';
  offCtx.lineJoin = 'round';
  offCtx.lineWidth = 1.5; // Consistent stroke width at 28x28 scale

  for (const stroke of strokes) {
    if (stroke.length < 1) continue;
    offCtx.beginPath();
    const startX = (stroke[0].x - minX) * scale + offsetX;
    const startY = (stroke[0].y - minY) * scale + offsetY;
    offCtx.moveTo(startX, startY);

    for (let i = 1; i < stroke.length; i++) {
      const px = (stroke[i].x - minX) * scale + offsetX;
      const py = (stroke[i].y - minY) * scale + offsetY;
      offCtx.lineTo(px, py);
    }
    offCtx.stroke();
  }

  // Read pixels and convert to tensor
  const imageData = offCtx.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  const pixels = imageData.data;

  const input = new Float32Array(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE);
  for (let i = 0; i < MODEL_INPUT_SIZE * MODEL_INPUT_SIZE; i++) {
    const r = pixels[i * 4];
    input[i] = (255 - r) / 255; // Invert: white bg -> 0, black stroke -> 1
  }

  // Update debug preview (shows what the model actually sees)
  const previewData = previewCtx.createImageData(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  for (let i = 0; i < input.length; i++) {
    const v = Math.round(input[i] * 255);
    previewData.data[i * 4] = v;
    previewData.data[i * 4 + 1] = v;
    previewData.data[i * 4 + 2] = v;
    previewData.data[i * 4 + 3] = 255;
  }
  previewCtx.putImageData(previewData, 0, 0);

  return tf.tensor4d(input, [1, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, 1]);
}

// --- Prediction ---

function schedulePrediction() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(predict, DEBOUNCE_MS);
}

async function predict() {
  if (!model) return;

  // Check if canvas is essentially blank
  if (strokes.length === 0) {
    renderPredictions([]);
    return;
  }

  const inputTensor = getInputTensor();
  if (!inputTensor) {
    renderPredictions([]);
    return;
  }

  const outputTensor = model.predict(inputTensor);
  const probabilities = await outputTensor.data();

  // Clean up tensors
  inputTensor.dispose();
  outputTensor.dispose();

  // Get top-K predictions
  const indexed = Array.from(probabilities).map((prob, idx) => ({ idx, prob }));
  indexed.sort((a, b) => b.prob - a.prob);
  const topK = indexed.slice(0, TOP_K).map(item => ({
    className: CLASSES[item.idx].replace(/_/g, ' '),
    confidence: item.prob,
  }));

  renderPredictions(topK);
}

// --- Rendering Predictions ---

function renderPredictions(predictions) {
  if (predictions.length === 0) {
    predictionsEl.innerHTML = '<p class="placeholder-text">Draw something to start...</p>';
    return;
  }

  predictionsEl.innerHTML = predictions.map(p => {
    const pct = (p.confidence * 100).toFixed(1);
    return `
      <div class="prediction-item">
        <div class="label-row">
          <span class="class-name">${p.className}</span>
          <span class="confidence">${pct}%</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

// --- Undo / Clear ---

function clearCanvas() {
  strokes = [];
  currentStroke = [];
  initCanvas();
  renderPredictions([]);
}

function undo() {
  if (strokes.length === 0) return;
  strokes.pop();
  redrawAllStrokes();
  schedulePrediction();
}

function redrawAllStrokes() {
  initCanvas();
  for (const stroke of strokes) {
    if (stroke.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);
    for (let i = 1; i < stroke.length; i++) {
      ctx.lineTo(stroke[i].x, stroke[i].y);
    }
    ctx.stroke();
  }
}

// --- Event Listeners ---

// Mouse events
canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseleave', stopDrawing);

// Touch events
canvas.addEventListener('touchstart', startDrawing, { passive: false });
canvas.addEventListener('touchmove', draw, { passive: false });
canvas.addEventListener('touchend', stopDrawing, { passive: false });
canvas.addEventListener('touchcancel', stopDrawing, { passive: false });

// Buttons
clearBtn.addEventListener('click', clearCanvas);
undoBtn.addEventListener('click', undo);

// --- Init ---

initCanvas();
loadModel();
