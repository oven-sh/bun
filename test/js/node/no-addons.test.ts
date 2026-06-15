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

describe("worker execArgv --no-addons parsing matches RunCommand clap", () => {
  // A value token following a value-taking flag (`-r x`, `--title x`, ...)
  // must not be treated as the first positional when scanning execArgv, and
  // the value is consumed regardless of its own content (even `--` or a
  // `-`-prefixed string).
  const body = `try { process.dlopen({ exports: {} }, "/nonexistent.node"); } catch (e) { require("node:worker_threads").parentPort.postMessage(e.code); }`;
  test.each([
    [["--no-addons"], "ERR_DLOPEN_DISABLED"],
    [["-r", "./preload.js", "--no-addons"], "ERR_DLOPEN_DISABLED"],
    [["--require", "./preload.js", "--no-addons"], "ERR_DLOPEN_DISABLED"],
    [["--title", "foo", "--no-addons"], "ERR_DLOPEN_DISABLED"],
    [["--port", "3000", "--no-addons"], "ERR_DLOPEN_DISABLED"],
    [["-e", "void 0", "--no-addons"], "ERR_DLOPEN_DISABLED"],
    [["--no-addons", "-r", "./preload.js"], "ERR_DLOPEN_DISABLED"],
    // chained shorts ending in a value-taking short pull the next token
    [["-br", "./preload.js", "--no-addons"], "ERR_DLOPEN_DISABLED"],
    // the value is consumed via raw iter.next(), even if it is `--`
    [["-r", "--", "--no-addons"], "ERR_DLOPEN_DISABLED"],
    // here `--no-addons` is `-r`'s value, not a flag; addons stay enabled
    [["-r", "--no-addons"], "ERR_DLOPEN_FAILED"],
  ])("%j", async (execArgv, expected) => {
    const worker = new Worker(body, { eval: true, execArgv });
    try {
      const code = await new Promise((resolve, reject) => {
        worker.on("message", resolve);
        worker.on("error", reject);
      });
      expect(code).toBe(expected);
    } finally {
      await worker.terminate();
    }
  });
});
