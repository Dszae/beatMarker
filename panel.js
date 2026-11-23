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
