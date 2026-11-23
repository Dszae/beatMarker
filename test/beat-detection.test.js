// Synthetic click tracks with known beat times, run through the panel's real
// beat detection. Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const { detectBeats } = require("../beat-detection.js");

const SAMPLE_RATE = 44100;

function clickTrack(bpm, seconds = 20, firstClick = 0.5) {
  const data = new Float32Array(SAMPLE_RATE * seconds);
  const clicks = [];
  for (let time = firstClick; time < seconds - 0.5; time += 60 / bpm) {
    clicks.push(time);
    const start = Math.round(time * SAMPLE_RATE);
    for (let i = 0; i < 400; i += 1) {
      data[start + i] += Math.sin(2 * Math.PI * 1000 * i / SAMPLE_RATE) * Math.exp(-i / 80);
    }
  }
  return { clicks, buffer: { sampleRate: SAMPLE_RATE, duration: seconds, getChannelData: () => data } };
}

const nearest = (times, target) => times.reduce((best, t) => (Math.abs(t - target) < Math.abs(best - target) ? t : best), Infinity);

for (const bpm of [90, 120, 140]) {
  test(`${bpm} BPM click track: one onset per click, on time`, () => {
    const { clicks, buffer } = clickTrack(bpm);
    const result = detectBeats(buffer, 0, 0.5);
    // Each click is one onset, not a plateau of several.
    assert.strictEqual(result.onsetPeaks.length, clicks.length);
    for (const peak of result.onsetPeaks) {
      const error = peak - nearest(clicks, peak);
      assert.ok(Math.abs(error) < 0.01, `onset ${(error * 1000).toFixed(1)} ms from its click`);
    }
    assert.ok(Math.abs(result.bpm - bpm) < 1, `estimated ${result.bpm.toFixed(2)} BPM`);
  });
}

test("with the tempo entered, beat markers land within 3 ms of the clicks", () => {
  // At 30 fps a frame is 33 ms; markers ~13 ms early could round to the frame before.
  // The BPM field is set, as the panel allows, so the grid spacing is exact and only
  // the onset timing decides where the markers fall.
  const { clicks, buffer } = clickTrack(120);
  const { beats } = detectBeats(buffer, 120, 0.5);
  for (const beat of beats.filter((b) => b.time < clicks[clicks.length - 1])) {
    const error = beat.time - nearest(clicks, beat.time);
    assert.ok(Math.abs(error) < 0.003, `marker ${(error * 1000).toFixed(1)} ms from its click`);
  }
});
