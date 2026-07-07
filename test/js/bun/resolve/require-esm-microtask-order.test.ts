// require(esm) drives the C++ module loader through a private synchronous
// queue so the loader's own pipeline reactions don't yield to user microtasks.
// That diversion must NOT capture user-visible continuations: an `await`
// inside an evaluated module body (AsyncFunctionResume) is a normal microtask
// and has to interleave with one queued *before* the require() in FIFO order.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("require(esm) does not run user `await` continuations ahead of earlier microtasks", async () => {
  using dir = tempDir("require-esm-microtask-order", {
    "esm.mjs": `
      globalThis.__order ??= [];
      // Fire-and-forget async IIFE — its first await resumes via
      // AsyncFunctionResume, which is what the sync queue must NOT divert.
      (async () => {
        await Promise.resolve();
        globalThis.__order.push("await-inside-esm");
      })();
      export const loaded = true;
    `,
    "entry.cjs": `
      globalThis.__order = [];
      Promise.resolve().then(() => globalThis.__order.push("then-before-require"));
      const m = require("./esm.mjs");
      if (!m.loaded) throw new Error("esm not loaded");
      globalThis.__order.push("after-require");
      queueMicrotask(() => {
        // By now both earlier microtasks have drained in FIFO order.
        console.log(JSON.stringify(globalThis.__order));
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual(["after-require", "then-before-require", "await-inside-esm"]);
  expect(exitCode).toBe(0);
});
