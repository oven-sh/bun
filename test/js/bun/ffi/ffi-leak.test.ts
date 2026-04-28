import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Each linkSymbols() call allocates a native FFI struct plus per-symbol
// TinyCC compiler state. Before the fix, FFI.finalize() was empty, so none
// of that memory was released when the JS wrapper was garbage collected.
//
// We GC periodically so that, when finalize() does its job, the freed
// native memory is reused by the next batch and RSS stays flat. When
// finalize() is a no-op the TCC state simply piles up and RSS climbs.
test("linkSymbols() does not leak FFI struct and TCC state on GC", async () => {
  const code = /* js */ `
    const { linkSymbols, JSCallback } = require("bun:ffi");

    const cb = new JSCallback(() => 42, { returns: "int32_t", args: [] });
    const ptr = cb.ptr;

    function churn(iterations) {
      for (let i = 0; i < iterations; i++) {
        linkSymbols({
          fn: { returns: "int32_t", args: [], ptr },
        });
        if (i % 100 === 0) Bun.gc(true);
      }
      Bun.gc(true);
    }

    // Warm up: let the allocator and JIT stabilise.
    churn(500);
    const before = process.memoryUsage.rss();
    churn(3000);
    const after = process.memoryUsage.rss();

    const growthMB = (after - before) / 1024 / 1024;
    console.log(JSON.stringify({ growthMB }));

    cb.close();
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--smol", "-e", code],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const { growthMB } = JSON.parse(stdout.trim());
  // Without the finalize fix this grows ~50 MB (release) / ~90 MB (debug+ASAN).
  // With the fix it stays under ~10 MB.
  expect(growthMB).toBeLessThan(30);
  expect(exitCode).toBe(0);
}, 60_000);
