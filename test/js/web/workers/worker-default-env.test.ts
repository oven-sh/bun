import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Without an options object the worker must still start from the parent's
// process.env as it is now, exactly like `new Worker(url, {})` does, rather
// than from the environment the process was launched with.
describe.concurrent("new Worker(url) without options", () => {
  test("copies the parent's current process.env", async () => {
    using dir = tempDir("worker-default-env", {
      "worker.js": `
        postMessage({
          setAtRuntime: process.env.BUN_TEST_SET_AT_RUNTIME ?? null,
          deletedAtRuntime: process.env.BUN_TEST_DELETED_AT_RUNTIME ?? null,
        });
      `,
      "main.js": `
        process.env.BUN_TEST_SET_AT_RUNTIME = "yes";
        delete process.env.BUN_TEST_DELETED_AT_RUNTIME;
        const worker = new Worker(new URL("./worker.js", import.meta.url).href);
        worker.onerror = e => { console.error(e.message); process.exit(1); };
        worker.onmessage = e => {
          console.log(JSON.stringify(e.data));
          worker.terminate();
        };
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: { ...bunEnv, BUN_TEST_DELETED_AT_RUNTIME: "launch" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ result: JSON.parse(stdout), stderr, exitCode }).toEqual({
      result: { setAtRuntime: "yes", deletedAtRuntime: null },
      stderr: "",
      exitCode: 0,
    });
  });

  test("inside a worker, copies the env that worker was given", async () => {
    using dir = tempDir("worker-default-env-nested", {
      "inner.js": `postMessage(process.env.BUN_TEST_OUTER_ENV ?? null);`,
      "outer.js": `
        const inner = new Worker(new URL("./inner.js", import.meta.url).href);
        inner.onmessage = e => { postMessage(e.data); inner.terminate(); };
      `,
      "main.js": `
        const outer = new Worker(new URL("./outer.js", import.meta.url).href, {
          env: { BUN_TEST_OUTER_ENV: "from-outer-option" },
        });
        outer.onerror = e => { console.error(e.message); process.exit(1); };
        outer.onmessage = e => {
          console.log(JSON.stringify(e.data));
          outer.terminate();
        };
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ result: JSON.parse(stdout), stderr, exitCode }).toEqual({
      result: "from-outer-option",
      stderr: "",
      exitCode: 0,
    });
  });
});
