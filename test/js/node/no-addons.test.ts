import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunExe, bunEnv as env } from "harness";
import { Worker } from "node:worker_threads";

test("--no-addons throws an error on process.dlopen", () => {
  const { stdout, stderr, exitCode } = spawnSync({
    cmd: [bunExe(), "--no-addons", "-p", "process.dlopen()"],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const err = stderr.toString();
  const out = stdout.toString();
  expect(exitCode).toBe(1);
  expect(out).toBeEmpty();
  expect(err).toContain("\nerror: Cannot load native addon because loading addons is disabled.");
});

describe("worker execArgv honors --no-addons after value-taking flags", () => {
  // The value token for `-r` / `--title` / `--port` / `-e` must not be
  // treated as the first positional when parsing the worker's execArgv.
  const body = `try { process.dlopen({ exports: {} }, "/nonexistent.node"); } catch (e) { require("node:worker_threads").parentPort.postMessage(e.code); }`;
  test.each([
    [["--no-addons"]],
    [["-r", "./preload.js", "--no-addons"]],
    [["--require", "./preload.js", "--no-addons"]],
    [["--title", "foo", "--no-addons"]],
    [["--port", "3000", "--no-addons"]],
    [["-e", "void 0", "--no-addons"]],
    [["--no-addons", "-r", "./preload.js"]],
  ])("%j", async execArgv => {
    const worker = new Worker(body, { eval: true, execArgv });
    try {
      const code = await new Promise((resolve, reject) => {
        worker.on("message", resolve);
        worker.on("error", reject);
      });
      expect(code).toBe("ERR_DLOPEN_DISABLED");
    } finally {
      await worker.terminate();
    }
  });
});
