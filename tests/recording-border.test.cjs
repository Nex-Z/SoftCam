const test = require("node:test");
const assert = require("node:assert/strict");
const { borderBounds } = require("../desktop/recording-border.cjs");

test("recording border restores selection on a negative-origin 150% display", () => {
  assert.deepEqual(
    borderBounds(
      {
        width: 1920,
        height: 1080,
        crop: { x: 30, y: 45, width: 600, height: 450 },
      },
      { bounds: { x: -1280, y: -200, width: 1280, height: 720 } },
    ),
    { x: -1260, y: -170, width: 400, height: 300 },
  );
});
test("full monitor border covers display bounds", () => {
  const bounds = { x: 100, y: -900, width: 1600, height: 900 };
  assert.deepEqual(
    borderBounds({ width: 3200, height: 1800 }, { bounds }),
    bounds,
  );
});
test("edge rounding keeps cropped border inside its display", () => {
  assert.deepEqual(
    borderBounds(
      {
        width: 1920,
        height: 1080,
        crop: { x: 1001, y: 501, width: 919, height: 579 },
      },
      { bounds: { x: 0, y: 0, width: 1280, height: 720 } },
    ),
    { x: 1001 / 1.5, y: 334, width: 919 / 1.5, height: 386 },
  );
});
