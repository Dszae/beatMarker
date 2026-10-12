/* global cep */

const $ = (selector) => document.querySelector(selector);
const status = $("#status");
const analyzeButton = $("#analyze");
const writeButton = $("#write");
const fileInput = $("#audio-file");
const fileName = $("#file-name");
const waveform = $("#waveform");
const bpmInput = $("#bpm");
const sensitivityInput = $("#sensitivity");
const sensitivityValue = $("#sensitivity-value");
const offsetInput = $("#offset");
let decodedBuffer = null;
let detection = null;

function setStatus(message, type = "") {
  status.textContent = message;
  status.className = `status ${type}`;
}

function evalScript(script) {
  return new Promise((resolve, reject) => {
    if (!window.__adobe_cep__) {
      reject(new Error("Open this panel inside After Effects."));
      return;
    }
    window.__adobe_cep__.evalScript(script, (result) => resolve(result));
  });
}

function escapeForExtendScript(value) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function getTarget() {
  const raw = await evalScript("getTargetInfo()");
  const target = JSON.parse(raw);
  if (!target.ok) throw new Error(target.message);
  return target;
}

function drawWaveform(buffer, beatTimes = []) {
  const canvas = waveform;
  const context = canvas.getContext("2d");
  const width = canvas.width = Math.max(600, canvas.clientWidth * 2);
  const height = canvas.height = Math.max(140, canvas.clientHeight * 2);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#11151b";
  context.fillRect(0, 0, width, height);
  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / width));
  context.strokeStyle = "#6b7787";
  context.lineWidth = 1.5;
  context.beginPath();
  for (let x = 0; x < width; x += 1) {
    const start = x * step;
    let min = 1;
    let max = -1;
    for (let j = 0; j < step && start + j < data.length; j += 1) {
      const value = data[start + j];
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    context.moveTo(x, (1 + min) * height / 2);
    context.lineTo(x, (1 + max) * height / 2);
  }
  context.stroke();
  context.strokeStyle = "#ffb84d";
  context.lineWidth = 2;
  beatTimes.forEach((time) => {
    const x = time / buffer.duration * width;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  });
}

function fftReal(input) {
  const n = input.length;
  const real = new Float32Array(input);
  const imag = new Float32Array(n);
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const value = real[i];
      real[i] = real[j];
      real[j] = value;
    }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = -2 * Math.PI / length;
    const wReal = Math.cos(angle);
    const wImag = Math.sin(angle);
    for (let start = 0; start < n; start += length) {
      let currentReal = 1;
      let currentImag = 0;
      for (let i = 0; i < length / 2; i += 1) {
        const even = start + i;
        const odd = even + length / 2;
        const oddReal = real[odd] * currentReal - imag[odd] * currentImag;
        const oddImag = real[odd] * currentImag + imag[odd] * currentReal;
        real[odd] = real[even] - oddReal;
        imag[odd] = imag[even] - oddImag;
        real[even] += oddReal;
        imag[even] += oddImag;
        const nextReal = currentReal * wReal - currentImag * wImag;
        currentImag = currentReal * wImag + currentImag * wReal;
        currentReal = nextReal;
      }
    }
  }
  return { real, imag };
}

function createOnsetEnvelope(buffer) {
  const samples = buffer.getChannelData(0);
  const size = 1024;
  const hop = 256;
  const bins = size / 2;
  const frames = Math.floor((samples.length - size) / hop);
  const envelope = new Float32Array(frames);
  const previous = new Float32Array(bins);
  for (let frame = 0; frame < frames; frame += 1) {
    const offset = frame * hop;
    const input = new Float32Array(size);
    for (let i = 0; i < size; i += 1) {
      input[i] = samples[offset + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)));
    }
    const spectrum = fftReal(input);
    let flux = 0;
    for (let bin = 1; bin < bins; bin += 1) {
      const magnitude = Math.log1p(Math.hypot(spectrum.real[bin], spectrum.imag[bin]));
      flux += Math.max(0, magnitude - previous[bin]);
      previous[bin] = magnitude;
    }
    envelope[frame] = flux;
  }
  const smoothed = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let total = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(frames - 1, i + 2); j += 1) total += envelope[j];
    smoothed[i] = total / 5;
  }
  return { values: smoothed, hop, sampleRate: buffer.sampleRate };
}

function estimateBpm(onset) {
  const values = onset.values;
  const minLag = Math.floor(60 / 180 * onset.sampleRate / onset.hop);
  const maxLag = Math.ceil(60 / 60 * onset.sampleRate / onset.hop);
  let bestLag = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let score = 0;
    for (let i = lag; i < values.length; i += 1) score += values[i] * values[i - lag];
    const bpm = 60 * onset.sampleRate / onset.hop / lag;
    const octaveBias = bpm < 80 ? 0.92 : bpm > 160 ? 0.96 : 1;
    score *= octaveBias;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  return 60 * onset.sampleRate / onset.hop / bestLag;
}

function detectBeats(buffer, bpmOverride, sensitivity) {
  const onset = createOnsetEnvelope(buffer);
  const estimatedBpm = estimateBpm(onset);
  const bpm = bpmOverride > 0 ? bpmOverride : estimatedBpm;
  const interval = 60 / bpm;
  const values = onset.values;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const threshold = mean + Math.sqrt(variance) * (1.7 - sensitivity * 0.9);
  const peaks = [];
  for (let i = 2; i < values.length - 2; i += 1) {
    if (values[i] > threshold && values[i] >= values[i - 1] && values[i] >= values[i + 1]) {
      peaks.push(i * onset.hop / onset.sampleRate);
    }
  }
  let firstBeat = peaks[0] || 0;
  if (peaks.length > 1) {
    const phaseCandidates = peaks.slice(0, 12);
    let bestPhase = phaseCandidates[0];
    let bestScore = -Infinity;
    phaseCandidates.forEach((candidate) => {
      let score = 0;
      for (let time = candidate; time < buffer.duration; time += interval) {
        const nearest = peaks.reduce((distance, peak) => Math.min(distance, Math.abs(peak - time)), Infinity);
        score += Math.max(0, 1 - nearest / (interval * 0.3));
      }
      if (score > bestScore) { bestScore = score; bestPhase = candidate; }
    });
    firstBeat = bestPhase;
  }
  const beats = [];
  for (let time = firstBeat; time < buffer.duration; time += interval) {
    if (time >= 0) beats.push({ time });
  }
  return { bpm, beats, onsetPeaks: peaks };
}

async function loadFile(file) {
  setStatus("Decoding audio...");
  const context = new AudioContext();
  decodedBuffer = await context.decodeAudioData(await file.arrayBuffer());
  await context.close();
  fileName.textContent = `${file.name} | ${decodedBuffer.duration.toFixed(2)}s`;
  drawWaveform(decodedBuffer);
  analyzeButton.disabled = false;
  setStatus("Audio ready. Tune sensitivity, then analyze.", "ready");
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (file) loadFile(file).catch((error) => setStatus(error.message, "error"));
});

sensitivityInput.addEventListener("input", () => {
  sensitivityValue.textContent = Number(sensitivityInput.value).toFixed(2);
});

analyzeButton.addEventListener("click", async () => {
  if (!decodedBuffer) return;
  analyzeButton.disabled = true;
  setStatus("Finding transients and locking the beat grid...");
  await new Promise((resolve) => setTimeout(resolve, 20));
  detection = detectBeats(decodedBuffer, Number(bpmInput.value), Number(sensitivityInput.value));
  drawWaveform(decodedBuffer, detection.beats.map((beat) => beat.time));
  bpmInput.value = detection.bpm.toFixed(1);
  writeButton.disabled = false;
  setStatus(`${detection.beats.length} beats found at ${detection.bpm.toFixed(1)} BPM.`, "ready");
  analyzeButton.disabled = false;
});

writeButton.addEventListener("click", async () => {
  if (!detection) return;
  try {
    const target = await getTarget();
    const offset = Number(offsetInput.value) / 1000;
    const payload = JSON.stringify({
      bpm: detection.bpm,
      replaceExisting: $("#replace").checked,
      beats: detection.beats.map((beat) => ({ time: Math.max(0, beat.time + offset) }))
    }).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const result = JSON.parse(await evalScript(`writeBeatMarkers('${payload}')`));
    if (!result.ok) throw new Error(result.message);
    setStatus(`Wrote ${result.count} markers to ${result.target}.`, "ready");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

$("#clear").addEventListener("click", async () => {
  try {
    const result = JSON.parse(await evalScript("clearBeatMarkers()"));
    if (!result.ok) throw new Error(result.message);
    setStatus(`Cleared markers from ${result.target}.`, "ready");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

$("#refresh-target").addEventListener("click", async () => {
  try {
    const target = await getTarget();
    $("#target").textContent = target.hasAudioLayer ? `Audio layer: ${target.layerName}` : `Composition: ${target.compName}`;
  } catch (error) {
    $("#target").textContent = error.message;
  }
});

$("#refresh-target").click();
