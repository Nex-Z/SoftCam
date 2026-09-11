const path = require("node:path");
function physicalCrop(rect, screenSize, viewSize) {
  const x = Math.max(
    0,
    Math.round((rect.x * screenSize.width) / viewSize.width),
  );
  const y = Math.max(
    0,
    Math.round((rect.y * screenSize.height) / viewSize.height),
  );
  const width = Math.min(
    screenSize.width - x,
    Math.round((rect.width * screenSize.width) / viewSize.width),
  );
  const height = Math.min(
    screenSize.height - y,
    Math.round((rect.height * screenSize.height) / viewSize.height),
  );
  if (![x, y, width, height].every(Number.isFinite) || width < 2 || height < 2)
    throw new Error("请选择至少 2 × 2 像素的区域");
  return { x, y, width, height };
}
function within(root, file) {
  const rel = path.relative(root, file);
  return (
    rel !== "" &&
    !rel.startsWith(".." + path.sep) &&
    rel !== ".." &&
    !path.isAbsolute(rel)
  );
}
module.exports = { physicalCrop, within };
