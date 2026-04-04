import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/27931
// Workers processing many tasks should not crash on exit due to
// pending libuv I/O requests accessing a freed JSC VM during shutdown.
test("workers processing many tasks do not crash on exit", async () => {
  using dir = tempDir("issue-27931", {
    "main.js": `
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const path = require("path");

if (!isMainThread) {
  const crypto = require("crypto");
  for (let i = workerData.start; i < workerData.total; i += workerData.step) {
    const hash = crypto.createHash("md5").update(crypto.randomBytes(4096)).digest("hex");
    parentPort.postMessage({ id: i, hash });
  }
} else {
  const NUM_WORKERS = 4;
  const NUM_TASKS = 40;
  let completed = 0;
  let exited = 0;
  for (let i = 0; i < NUM_WORKERS; i++) {
    const w = new Worker(path.join(__dirname, "main.js"), {
      workerData: { start: i, step: NUM_WORKERS, total: NUM_TASKS }
    });
    w.on("message", () => { completed++; });
    w.on("exit", (code) => {
      if (++exited === NUM_WORKERS) {
        console.log("completed:" + completed);
      }
    });
  }
}
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();

  expect(stdout).toContain("completed:40");
  expect(exitCode).toBe(0);
}, 30_000);
