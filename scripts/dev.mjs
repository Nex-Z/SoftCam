import { spawn } from "node:child_process";
import { createServer } from "vite";
import electron from "electron";
const server = await createServer();
await server.listen();
const env = { ...process.env, SOFTCAM_DEV_URL: "http://127.0.0.1:5173/" };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ["."], {
  env,
  stdio: "inherit",
  windowsHide: true,
});
child.on("exit", async (code) => {
  await server.close();
  process.exit(code || 0);
});
