// Temporary: see zz-diagnose-preload.js.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

test("diagnose", async () => {
  const code = `
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { open: socket => false && socket.end(), data() {}, error() {} },
    });
    let closed = 0;
    (() => {
      for (let i = 0; i < 20; i++) {
        const client = new Bun.RedisClient("redis://127.0.0.1:" + server.port, {"tls":{"cert":"x","key":"y"}});
        client.onclose = () => closed++;
        client.get("k").catch(() => {});
      }
    })();
    while (closed < 20) {
      Bun.gc(true);
      await new Promise(setImmediate);
    }
    Bun.gc(true);
    console.log(require("bun:jsc").heapStats().objectTypeCounts.RedisClient ?? 0, "left");
    globalThis.diagnoseNow?.();
    server.stop(true);
  `;
  for (const mode of ["control", "log", "zero"]) {
    const preload = mode === "control" ? [] : ["--preload", join(import.meta.dir, "zz-diagnose-preload.js")];
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...preload, "-e", code],
      env: { ...bunEnv, DIAG_MODE: mode },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 25_000,
    });
    const [stdout, stderr, exit] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    console.log(`DIAG ===== ${mode}: code ${exit} signal ${proc.signalCode}`);
    for (const line of (stdout + stderr).split("\n")) console.log("DIAG " + line);
  }
  expect("diagnostic").toBe("removed");
}, 85_000);
