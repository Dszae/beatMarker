// Runs jsx/host.jsx (plain ExtendScript) in a Node VM with minimal stand-ins for
// the After Effects objects it touches. Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const HOST = fs.readFileSync(path.join(__dirname, "..", "jsx", "host.jsx"), "utf8");

function markerProperty() {
  return { numKeys: 0, placed: [], setValueAtTime(time, value) { this.placed.push({ time, comment: value.comment }); }, removeKey() { this.numKeys -= 1; } };
}

function aeWith({ layer }) {
  class CompItem {}
  const comp = Object.assign(new CompItem(), { name: "Comp", markerProperty: markerProperty(), selectedLayers: layer ? [layer] : [] });
  const context = {
    CompItem,
    MarkerValue: function MarkerValue(comment) { this.comment = comment; },
    app: { project: { activeItem: comp }, beginUndoGroup() {}, endUndoGroup() {} },
    JSON,
  };
  vm.createContext(context);
  vm.runInContext(HOST, context);
  return { context, comp };
}

const payload = JSON.stringify({ bpm: 120, replaceExisting: false, beats: [{ time: 0.5 }, { time: 1.0 }] });

test("layer markers are placed in composition time, after the layer's start", () => {
  // An audio layer that starts 5 s into the composition: the beat 0.5 s into the
  // file plays at 5.5 s in the composition.
  const layer = { name: "Song", canSetAudio: true, startTime: 5, stretch: 100, marker: markerProperty() };
  const { context } = aeWith({ layer });
  assert.strictEqual(JSON.parse(context.writeBeatMarkers(payload)).ok, true);
  assert.deepStrictEqual(layer.marker.placed.map((m) => m.time), [5.5, 6.0]);
});

test("a time-stretched layer stretches the beat times with it", () => {
  const layer = { name: "Song", canSetAudio: true, startTime: 2, stretch: 200, marker: markerProperty() };
  const { context } = aeWith({ layer });
  context.writeBeatMarkers(payload);
  assert.deepStrictEqual(layer.marker.placed.map((m) => m.time), [3, 4]);
});

test("composition markers use the beat times as they are", () => {
  const { context, comp } = aeWith({ layer: null });
  context.writeBeatMarkers(payload);
  assert.deepStrictEqual(comp.markerProperty.placed.map((m) => m.time), [0.5, 1.0]);
});
