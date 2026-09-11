import { writeFile, readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
const n = 128,
  rows = Buffer.alloc((n * 4 + 1) * n);
const rounded = (x, y, cx, cy, w, h, r) => {
  const dx = Math.abs(x - cx) - (w / 2 - r),
    dy = Math.abs(y - cy) - (h / 2 - r);
  return (
    Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) +
      Math.min(Math.max(dx, dy), 0) <=
    r
  );
};
for (let y = 0; y < n; y++)
  for (let x = 0; x < n; x++) {
    const offset = y * (n * 4 + 1) + 1 + x * 4;
    const blue = rounded(x, y, 64, 64, 120, 120, 32);
    const border =
      rounded(x, y, 53, 64, 52, 46, 11) && !rounded(x, y, 53, 64, 38, 32, 5);
    const lens =
      x >= 77 &&
      x <= 101 &&
      y >= 45 + (101 - x) * 0.5 &&
      y <= 83 - (101 - x) * 0.5;
    rows.set(
      blue
        ? border || lens
          ? [255, 255, 255, 255]
          : [24, 119, 239, 255]
        : [0, 0, 0, 0],
      offset,
    );
  }
function crc32(b) {
  let crc = 0xffffffff;
  for (const v of b) {
    crc ^= v;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type),
    len = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(n, 0);
header.writeUInt32BE(n, 4);
header[8] = 8;
header[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(rows)),
  chunk("IEND", Buffer.alloc(0)),
]);
await writeFile("resources/icon.png", png);
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico[6] = n;
ico[7] = n;
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18);
await writeFile("resources/icon.ico", Buffer.concat([ico, png]));
