import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/27931
// Workers processing many tasks should not crash on exit due to
// pending libuv I/O requests accessing a freed JSC VM during shutdown.
test("workers processing many tasks do not crash on exit", async () => {
  using dir = tempDir("issue-27931", {
    "main.js": `
const { Worker } = require("worker_threads");
const path = require("path");

const NUM_WORKERS = 4;
const NUM_TASKS = 40;

async function main() {
  let completedTasks = 0;

  const promises = [];
  for (let i = 0; i < NUM_WORKERS; i++) {
    promises.push(new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, "worker.js"), {
        workerData: { start: i, step: NUM_WORKERS, total: NUM_TASKS }
      });
      worker.on("message", () => { completedTasks++; });
      worker.on("exit", () => resolve());
      worker.on("error", reject);
    }));
  }

  await Promise.all(promises);
  console.log("completed:" + completedTasks);
}

main().catch(e => { console.error(e); process.exit(1); });
`,
    "worker.js": `
const { parentPort, workerData } = require("worker_threads");
const crypto = require("crypto");

const { start, step, total } = workerData;
for (let i = start; i < total; i += step) {
  const hash = crypto.createHash("md5").update(crypto.randomBytes(4096)).digest("hex");
  parentPort.postMessage({ id: i, hash });
}
`,
  });

  const result = Bun.spawnSync({
    cmd: [bunExe(), "main.js"],
    cwd: String(dir),
    env: bunEnv,
  });

  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();

  expect(stderr).not.toContain("panic");
  expect(stderr).not.toContain("Segmentation fault");
  expect(stdout).toContain("completed:40");
  expect(result.exitCode).toBe(0);
}, 30_000);
