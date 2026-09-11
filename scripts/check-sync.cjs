const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const file = process.argv[2];
if (!file) throw new Error("Supply recorded fixture video");
const video = execFileSync(
  "ffmpeg",
  [
    "-v",
    "error",
    "-i",
    file,
    "-vf",
    "crop=32:32:40:80,scale=1:1,format=gray",
    "-f",
    "rawvideo",
    "pipe:1",
  ],
  { maxBuffer: 10000000, windowsHide: true },
);
const raw = execFileSync(
  "ffmpeg",
  [
    "-v",
    "error",
    "-i",
    file,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "48000",
    "-f",
    "f32le",
    "pipe:1",
  ],
  { maxBuffer: 10000000, windowsHide: true },
);
const info = JSON.parse(
  execFileSync(
    "ffprobe",
    ["-v", "error", "-show_streams", "-of", "json", file],
    { windowsHide: true },
  ),
);
const rate = info.streams
  .find((s) => s.codec_type === "video")
  .r_frame_rate.split("/")
  .map(Number);
const fps = rate[0] / rate[1];
const flashes = [];
for (let i = 1; i < video.length - fps * 0.25; i++)
  if (video[i] > 220 && video[i - 1] <= 220) flashes.push(i / fps);
const energies = [];
for (let offset = 0; offset + 480 * 4 <= raw.length; offset += 480 * 4) {
  let re = 0,
    im = 0;
  for (let i = 0; i < 480; i++) {
    const v = raw.readFloatLE(offset + i * 4),
      a = (2 * Math.PI * 1000 * i) / 48000;
    re += v * Math.cos(a);
    im += v * Math.sin(a);
  }
  energies.push(Math.sqrt(re * re + im * im) / 480);
}
const threshold = Math.max(...energies) * 0.35;
const beeps = [];
for (let i = 1; i < energies.length; i++)
  if (energies[i] > threshold && energies[i - 1] <= threshold)
    beeps.push(i * 0.01);
const offsets = flashes
  .map((t) => ({
    video: t,
    audio: beeps.reduce(
      (a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a),
      Infinity,
    ),
  }))
  .filter((x) => Number.isFinite(x.audio))
  .map((x) => ({ ...x, offsetMs: Math.round((x.audio - x.video) * 1000) }));
const result = {
  fps,
  flashes,
  beeps,
  offsets,
  passed:
    offsets.length >= 2 && offsets.every((o) => Math.abs(o.offsetMs) <= 100),
};
console.log(JSON.stringify(result, null, 2));
fs.writeFileSync(file + ".sync.json", JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
