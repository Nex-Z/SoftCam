import { packager } from "@electron/packager";
import {
  mkdir,
  cp,
  writeFile,
  readFile,
  stat,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = process.cwd(),
  stamp = Date.now(),
  stage = path.join(root, "artifacts", `package-${stamp}`);
await mkdir(stage, { recursive: true });
for (const dir of ["desktop", "dist"])
  await cp(path.join(root, dir), path.join(stage, dir), { recursive: true });
await cp(path.join(root, "resources/icon.png"), path.join(stage, "icon.png"));
const pkg = JSON.parse(await readFile("package.json", "utf8"));
await writeFile(
  path.join(stage, "package.json"),
  JSON.stringify({
    name: "softcam",
    version: pkg.version,
    main: "desktop/main.cjs",
    description: pkg.description,
  }),
);
const ffmpeg =
  process.env.SOFTCAM_FFMPEG ||
  execFileSync("where.exe", ["ffmpeg.exe"], { encoding: "utf8" })
    .trim()
    .split(/\r?\n/)[0];
const ffprobe = path.join(path.dirname(ffmpeg), "ffprobe.exe");
const bin = path.join(stage, "bin");
await mkdir(bin);
await cp(ffmpeg, path.join(bin, "ffmpeg.exe"));
await cp(ffprobe, path.join(bin, "ffprobe.exe"));
await cp(
  "engine/target/release/softcam-engine.exe",
  path.join(bin, "softcam-engine.exe"),
);
const licenses = path.join(stage, "licenses");
await mkdir(licenses);
await writeFile(
  path.join(licenses, "FFmpeg-build.txt"),
  execFileSync(ffmpeg, ["-version"], { encoding: "utf8" }),
);
const ffLicense = path.join(path.dirname(ffmpeg), "../LICENSE");
try {
  await cp(ffLicense, path.join(licenses, "FFmpeg-LICENSE.txt"));
} catch {
  throw new Error(
    "FFmpeg license file missing next to its distribution; supply it before packaging",
  );
}
for (const name of ["react", "react-dom", "lucide-react"]) {
  const dir = path.join(root, "node_modules", name);
  const entries = await readdir(dir);
  const license = entries.find((n) => /^licen[sc]e/i.test(n));
  if (license)
    await cp(
      path.join(dir, license),
      path.join(licenses, `${name}-LICENSE.txt`),
    );
}
const metadata = JSON.parse(
  execFileSync(
    "cargo",
    [
      "metadata",
      "--format-version",
      "1",
      "--manifest-path",
      "engine/Cargo.toml",
    ],
    { encoding: "utf8", maxBuffer: 10000000 },
  ),
);
const manifest = [];
for (const p of metadata.packages) {
  if (!p.source) continue;
  manifest.push({
    name: p.name,
    version: p.version,
    license: p.license,
    source: p.repository,
  });
  const dir = path.dirname(p.manifest_path);
  for (const file of await readdir(dir)) {
    if (
      /^licen[sc]e|^copying/i.test(file) &&
      (await stat(path.join(dir, file))).isFile()
    )
      await cp(
        path.join(dir, file),
        path.join(licenses, `${p.name}-${p.version}-${file}`),
      );
  }
}
await writeFile(
  path.join(licenses, "Rust-dependencies.json"),
  JSON.stringify(manifest, null, 2),
);
await cp("THIRD_PARTY.md", path.join(licenses, "THIRD_PARTY.md"));
await cp("README.md", path.join(stage, "使用说明.md"));
const electronVersion = JSON.parse(
  await readFile("node_modules/electron/package.json", "utf8"),
).version;
const out = await packager({
  dir: stage,
  out: path.join(root, "release", pkg.version),
  name: "SoftCam",
  platform: "win32",
  arch: "x64",
  electronVersion,
  icon: path.join(root, "resources/icon.ico"),
  asar: true,
  prune: false,
  overwrite: true,
  ignore: [/^\/bin($|\/)/, /^\/licenses($|\/)/],
  extraResource: [bin, licenses],
  appCopyright: "SoftCam contributors",
  win32metadata: {
    CompanyName: "SoftCam",
    FileDescription: "SoftCam screen recorder",
    ProductName: "SoftCam",
  },
});
await cp("README.md", path.join(out[0], "使用说明.md"));
await writeFile(
  path.join(out[0], "BUILD.json"),
  JSON.stringify(
    {
      version: pkg.version,
      electron: electronVersion,
      platform: "win32-x64",
      engineSha256: createHash("sha256")
        .update(await readFile(path.join(bin, "softcam-engine.exe")))
        .digest("hex"),
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
try {
  await cp("VALIDATION.md", path.join(out[0], "验证记录.md"));
} catch {}
const zip = path.join(root, "release", `SoftCam-${pkg.version}-win-x64.zip`);
const psQuote = (s) => "'" + s.replaceAll("'", "''") + "'";
execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-Command",
    `Compress-Archive -LiteralPath ${psQuote(out[0])} -DestinationPath ${psQuote(zip)} -Force -CompressionLevel Optimal`,
  ],
  { stdio: "inherit", windowsHide: true },
);
const hash = createHash("sha256")
  .update(await readFile(zip))
  .digest("hex");
await writeFile(zip + ".sha256", `${hash}  ${path.basename(zip)}\n`);
console.log(
  `Packaged ${zip} (${Math.round((await stat(zip)).size / 1048576)} MB)`,
);
