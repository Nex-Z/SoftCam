const fs = require("node:fs");
for (const file of process.argv.slice(2)) {
  const b = fs.readFileSync(file),
    pe = b.readUInt32LE(0x3c),
    count = b.readUInt16LE(pe + 6),
    opt = pe + 24,
    sectionStart = opt + b.readUInt16LE(pe + 20);
  const sections = [];
  for (let i = 0; i < count; i++) {
    const s = sectionStart + i * 40;
    sections.push({
      va: b.readUInt32LE(s + 12),
      size: b.readUInt32LE(s + 8),
      raw: b.readUInt32LE(s + 20),
    });
  }
  const offset = (rva) => {
    const s = sections.find((s) => rva >= s.va && rva < s.va + s.size);
    if (!s) throw new Error("Invalid RVA");
    return rva - s.va + s.raw;
  };
  const directory = opt + (b.readUInt16LE(opt) === 0x20b ? 112 : 96),
    imports = b.readUInt32LE(directory + 8);
  let at = offset(imports);
  const names = [];
  while (b.readUInt32LE(at + 12)) {
    const start = offset(b.readUInt32LE(at + 12));
    names.push(b.toString("utf8", start, b.indexOf(0, start)));
    at += 20;
  }
  console.log(JSON.stringify({ file, imports: names }, null, 2));
  if (names.some((n) => /^(vcruntime|msvcp)d/i.test(n))) process.exitCode = 1;
}
