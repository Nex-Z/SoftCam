const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const path = require("node:path");
const assert = require("node:assert/strict");
(async () => {
  const child = spawn(
    path.resolve("engine/target/release/softcam-engine.exe"),
    [],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  const messages = [];
  const response = new Promise((resolve, reject) => {
    child.on("error", reject);
    createInterface({ input: child.stdout }).on("line", (line) => {
      const m = JSON.parse(line);
      messages.push(m);
      if (messages.length === 4) resolve(messages);
    });
  });
  child.stdin.write(
    "not-json\n" +
      JSON.stringify({ v: 2, id: 1, method: "sources" }) +
      "\n" +
      JSON.stringify({ v: 1, id: 2, method: "not-a-method" }) +
      "\n" +
      JSON.stringify({ v: 1, id: 3, method: "sources", params: {} }) +
      "\n",
  );
  const result = await response;
  assert(result.find((m) => m.id === null)?.error.code === "INVALID_JSON");
  assert(result.find((m) => m.id === 1)?.error);
  assert(result.find((m) => m.id === 2)?.error);
  assert(result.find((m) => m.id === 3)?.result.monitors.length);
  child.stdin.end();
  await new Promise((r) => child.once("exit", r));
  console.log(
    "PROTOCOL PASS: malformed JSON, version, unknown method, subsequent valid request",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
