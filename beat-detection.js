// Beat detection for the BeatMarker panel: spectral-flux onsets, tempo estimate,
// and a beat grid. Plain functions, loaded by index.html before panel.js (so
// they are globals in the panel) and exported for Node when `module` exists.

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
  return { values: smoothed, hop, size, sampleRate: buffer.sampleRate };
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

// Onset times, one per onset. The 5-frame smoothing turns a flux spike into a
// plateau of equal values, so a peak is a run that rises from the left and falls
// to the right, reported once at its center. A frame is timed at the center of
// its analysis window, where the onset sits when its flux peaks; timing it at the
// window start put every marker about 13 ms early.
function findOnsetPeaks(onset, threshold) {
  const values = onset.values;
  const peaks = [];
  for (let i = 1; i < values.length - 1; i += 1) {
    if (!(values[i] > threshold && values[i] > values[i - 1])) continue;
    let end = i;
    while (end + 1 < values.length && values[end + 1] === values[i]) end += 1;
    if (end + 1 < values.length && values[end + 1] < values[i]) {
      const frame = (i + end) / 2;
      peaks.push((frame * onset.hop + onset.size / 2) / onset.sampleRate);
    }
    i = end;
  }
  return peaks;
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
  const peaks = findOnsetPeaks(onset, threshold);
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
    // A single onset is only timed to the nearest analysis hop (about 6 ms), so
    // the grid is shifted by the mean offset of every onset that lands near it.
    const residuals = [];
    for (const peak of peaks) {
      const residual = peak - (bestPhase + Math.round((peak - bestPhase) / interval) * interval);
      if (Math.abs(residual) < interval * 0.3) residuals.push(residual);
    }
    firstBeat = bestPhase + residuals.reduce((sum, value) => sum + value, 0) / residuals.length;
  }
  const beats = [];
  for (let time = firstBeat; time < buffer.duration; time += interval) {
    if (time >= 0) beats.push({ time });
  }
  return { bpm, beats, onsetPeaks: peaks };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { fftReal, createOnsetEnvelope, estimateBpm, findOnsetPeaks, detectBeats };
}
