const test = require("node:test");
const assert = require("node:assert/strict");
const { physicalCrop, within } = require("../desktop/policy.cjs");
test("150% DPI converts display-local selection to physical pixels", () =>
  assert.deepEqual(
    physicalCrop(
      { x: 20, y: 30, width: 400, height: 300 },
      { width: 1920, height: 1080 },
      { width: 1280, height: 720 },
    ),
    { x: 30, y: 45, width: 600, height: 450 },
  ));
test("negative desktop position does not enter monitor-local coordinates", () =>
  assert.deepEqual(
    physicalCrop(
      { x: 0, y: 0, width: 200, height: 100 },
      { width: 2560, height: 1440 },
      { width: 1280, height: 720 },
    ),
    { x: 0, y: 0, width: 400, height: 200 },
  ));
test("selection clamps at monitor edge", () =>
  assert.deepEqual(
    physicalCrop(
      { x: 90, y: 90, width: 50, height: 50 },
      { width: 100, height: 100 },
      { width: 100, height: 100 },
    ),
    { x: 90, y: 90, width: 10, height: 10 },
  ));
test("invalid and empty selections rejected", () => {
  assert.throws(() =>
    physicalCrop(
      { x: 0, y: 0, width: 0, height: 0 },
      { width: 100, height: 100 },
      { width: 100, height: 100 },
    ),
  );
  assert.throws(() =>
    physicalCrop(
      { x: NaN, y: 0, width: 20, height: 20 },
      { width: 100, height: 100 },
      { width: 100, height: 100 },
    ),
  );
});
test("path containment rejects siblings", () => {
  assert.equal(within("C:\\data", "C:\\data-other\\file"), false);
  assert.equal(within("C:\\data", "C:\\data\\file"), true);
});
