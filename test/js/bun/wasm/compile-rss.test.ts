import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";
import { join } from "node:path";

// JSC compiles wasm on a pool of AutomaticThreads, one per core. Each thread
// has its own mimalloc heap, and only the owner can return that heap's freed
// pages to the OS. Before oven-sh/WebKit#567 an idle compiler thread kept
// everything it had freed until it exited after 10 s without work, so RSS
// after `WebAssembly.compile` grew with the core count and not with the live
// modules (oven-sh/bun#41438). The threads now release their heap after
// 100 ms idle.
//
// ASAN builds link JSC against the sanitizer allocator, not mimalloc. The
// release path does not exist there, and ASAN's own per-thread caches hold
// hundreds of MB per compile on their own.
test.skipIf(isASAN)("idle wasm compiler threads release the memory they freed (oven-sh/bun#41438)", async () => {
  // A fixed thread count keeps the number stable across hosts. With 16
  // threads the unfixed build sits 100 to 115 MiB above the baseline for
  // the full 10 s on a 16-core Linux x64 box. The fixed build settles at
  // 4 to 6 MiB there and about 15 MiB on Linux aarch64 CI, within 1 s.
  const settledMiB = 30;
  // Far under the 10 s AutomaticThread timeout, so an unfixed build cannot
  // pass by outliving its compiler threads.
  const deadlineMs = 3000;

  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "compile-rss-fixture.mjs")],
    env: {
      ...bunEnv,
      BUN_JSC_numberOfWasmCompilerThreads: "16",
      SETTLED_MIB: String(settledMiB),
      DEADLINE_MS: String(deadlineMs),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
  // The whole measurement is in the object so a failure prints it.
  expect({ ...result, settled: result.settledAfterMs >= 0 && result.deltaMiB <= settledMiB }).toMatchObject({
    moduleBytes: expect.any(Number),
    settled: true,
  });
  expect(exitCode).toBe(0);
});
