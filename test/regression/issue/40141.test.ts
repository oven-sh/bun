import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/40141
// Messages posted to a module Worker while its entry module is inside an
// unsettled top-level await were dispatched before any 'message' listener
// existed, so they were silently lost.

test.concurrent("messages posted during a worker's top-level await are delivered once it settles", async () => {
  using dir = tempDir("worker-tla-buffer", {
    "worker.ts": `
      import { existsSync } from "node:fs";
      // Tells the parent the worker is running; the parent then posts its
      // batch while this module is still inside the top-level await below.
      postMessage("started");
      while (!existsSync("flag")) {
        await new Promise(r => setTimeout(r, 5));
      }
      self.onmessage = e => postMessage(e.data);
      postMessage("ready");
    `,
    "main.ts": `
      const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
      // Posted before the worker has even started: buffered while Pending.
      worker.postMessage("early");
      const got: any[] = [];
      worker.onmessage = async e => {
        if (e.data === "started") {
          // The worker is inside its top-level await: it cannot settle until
          // the flag file exists, and we write it only after posting.
          for (let i = 0; i < 7; i++) worker.postMessage(i);
          await Bun.write("flag", "1");
          return;
        }
        got.push(e.data);
        if (got.length === 9) {
          console.log(JSON.stringify(got));
          worker.terminate();
        }
      };
      // Failsafe so the failure mode is a diagnostic, not a hang.
      const failsafe = setTimeout(() => {
        console.log("TIMEOUT " + JSON.stringify(got));
        process.exit(1);
      }, 15_000);
      failsafe.unref?.();
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe(JSON.stringify(["ready", "early", 0, 1, 2, 3, 4, 5, 6]));
  expect(exitCode).toBe(0);
});

test.concurrent(
  "a message listener installed before the first await receives messages during the top-level await",
  async () => {
    using dir = tempDir("worker-tla-listener", {
      "worker.ts": `
      self.onmessage = e => postMessage(e.data);
      postMessage("started");
      // Never settles: delivery must not wait for it because a listener exists.
      await new Promise(() => {});
    `,
      "main.ts": `
      const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
      const got: any[] = [];
      worker.onmessage = e => {
        if (e.data === "started") {
          for (let i = 0; i < 3; i++) worker.postMessage(i);
          return;
        }
        got.push(e.data);
        if (got.length === 3) {
          console.log(JSON.stringify(got));
          worker.terminate();
        }
      };
      // Failsafe so the failure mode is a diagnostic, not a hang.
      const failsafe = setTimeout(() => {
        console.log("TIMEOUT " + JSON.stringify(got));
        process.exit(1);
      }, 15_000);
      failsafe.unref?.();
    `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe(JSON.stringify([0, 1, 2]));
    expect(exitCode).toBe(0);
  },
);
