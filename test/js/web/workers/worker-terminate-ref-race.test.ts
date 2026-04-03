// Regression test: calling `worker.ref()` / `worker.unref()` / `worker.terminate()`
// on a Worker whose background thread is concurrently finishing its
// `exitAndDeinit` path must not race with the Zig `WebWorker` being freed.
//
// Before the fix, the worker thread would free its `WebWorker` struct as soon
// as its event loop exited, but the C++ `Worker` still held the raw `impl_`
// pointer. A `worker.terminate()` / `worker.ref()` / `worker.unref()` call on
// the parent thread would then dereference freed (ASAN-poisoned) memory in
// `setRefInternal`, producing a use-after-poison on CI's ASAN lane.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("terminate + ref/unref on exiting worker does not UAF", { timeout: 60_000 }, async () => {
  // The fixture creates many workers that stay alive (setInterval), terminates
  // them, yields to let their exit paths run on worker threads, then calls
  // ref()/unref()/terminate() again. The yields make the race window wide
  // enough that ASAN reliably catches the use-after-poison without the fix.
  const fixture = /* js */ `
    const code = "setInterval(() => {}, 1000); onmessage=()=>{};";
    const url = "data:application/javascript," + encodeURIComponent(code);
    for (let round = 0; round < 20; round++) {
      const workers = [];
      for (let i = 0; i < 20; i++) workers.push(new Worker(url));
      // Let the workers actually start.
      await new Promise(r => setTimeout(r, 5));
      for (const w of workers) w.terminate();
      // Let the worker threads finish exitAndDeinit.
      await new Promise(r => setTimeout(r, 10));
      // These calls race with the worker threads tearing down the Zig
      // WebWorker. Before the fix they would touch freed memory.
      for (const w of workers) { w.ref(); w.unref(); w.terminate(); }
      Bun.gc(true);
    }
    console.log("OK");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // ASAN writes "AddressSanitizer: use-after-poison" / "SUMMARY: AddressSanitizer"
  // to stderr. The JSC wasm-fault-handler warning is unrelated and harmless.
  expect(stderr).not.toContain("AddressSanitizer");
  expect(stderr).not.toContain("use-after-poison");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});
