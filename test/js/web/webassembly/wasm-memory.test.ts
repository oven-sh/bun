import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

describe("WebAssembly.Memory", () => {
  // A signaling ("fast") wasm memory reserves 4 GiB of address space up front. JSC takes that
  // reservation from the malloc that backs Gigacage, which in release builds is mimalloc, and an
  // allocation that large bypasses mimalloc's arenas and is mapped from the OS directly. mimalloc
  // used to place each one at a fresh, ever increasing hint address, and its page map keeps a
  // 64 KiB submap for every 512 MiB of address space it has ever seen. So every memory that was
  // created and collected left 64 KiB of committed memory behind, for every way of creating one.
  describe.concurrent("releases everything once the memory is collected", () => {
    for (const mode of ["memory", "instance", "instantiate"]) {
      test(mode, async () => {
        const count = 600;
        await using proc = Bun.spawn({
          cmd: [bunExe(), join(import.meta.dir, "wasm-memory-release-fixture.js"), mode, String(count)],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
        expect(result).toMatchObject({ mode, count });
        // With the leak this is a steady 64 KiB (65.3 measured). Without it, what is left is GC and
        // allocator noise spread over `count` memories: about 1 KiB.
        expect(result.perMemoryKiB).toBeLessThan(24);
        expect(exitCode).toBe(0);
      });
    }
  });
});
