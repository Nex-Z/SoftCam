const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const { EventEmitter } = require("node:events");
class Engine extends EventEmitter {
  constructor(exe, env) {
    super();
    this.next = 0;
    this.pending = new Map();
    this.child = spawn(exe, [], {
      env: { ...process.env, ...env },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      try {
        const m = JSON.parse(line);
        if (m.event) this.emit("event", m);
        else {
          const p = this.pending.get(m.id);
          if (!p) return;
          this.pending.delete(m.id);
          m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
        }
      } catch (e) {
        this.emit("log", String(e));
      }
    });
    this.child.stderr.on("data", (d) => this.emit("log", d.toString()));
    const fail = (e) => {
      for (const p of this.pending.values()) p.reject(e);
      this.pending.clear();
      if (!this.closing)
        this.emit("event", {
          event: "engineError",
          data: { message: e.message },
        });
    };
    this.child.on("error", fail);
    this.child.on("exit", (code) =>
      fail(new Error(`录制引擎已退出 (${code})，请重新启动 SoftCam`)),
    );
  }
  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.child.stdin.writable)
        return reject(new Error("录制引擎不可用"));
      const id = ++this.next;
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(
        JSON.stringify({ v: 1, id, method, params }) + "\n",
        (e) => {
          if (e) {
            this.pending.delete(id);
            reject(e);
          }
        },
      );
    });
  }
  close() {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = new Promise((resolve) => {
      if (this.child.exitCode !== null || !this.child.pid) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        this.child.kill();
        resolve();
      }, 30000);
      this.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      this.child.stdin.end();
    });
    return this.closePromise;
  }
}
module.exports = { Engine };
