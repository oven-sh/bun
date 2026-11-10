import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";

// The collector learns of a WebAssembly.Memory's initial size from the wrapper of its first `buffer`. Memories that
// are created, used through their buffer and dropped have to make it collect. With fast memories the allocator asks
// for collections as well, because there are few of them; without (BoundsChecking mode: the ninth live memory, a
// 64-bit memory, no fault handler) nothing else does.
async function run(shape: "dropped" | "ring" | "grown", options: Record<string, string>) {
  const script = `
    const pages = 64, rounds = 256, ring = new Array(8);
    const before = process.memoryUsage.rss();
    for (let i = 0; i < rounds; i++) {
      const memory = new WebAssembly.Memory({ initial: pages });
      let buffer = memory.buffer;
      new Uint8Array(buffer).fill(i);
      if (${shape === "grown"}) { memory.grow(1); buffer = memory.buffer; }
      if (${shape === "ring"}) ring[i & 7] = buffer;
    }
    console.log("grew", Math.round((process.resourceUsage().maxRSS * 1024 - before) / 1048576), "MB");
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, ...options, BUN_JSC_logGC: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const log = stdout + stderr;
  const grew = Number(/^grew (-?\d+) MB$/m.exec(log)?.[1]);
  expect(exitCode).toBe(0);
  return { grew, collections: (log.match(/=> (Eden|Full)Collection/g) ?? []).length };
}

describe.each([
  ["BoundsChecking", { BUN_JSC_useWasmFastMemory: "0" }],
  ["Signaling", {}],
])("memories of 4 MB, written from end to end, in %s mode", (_, options) => {
  // 256 memories are 1,024 MB. Nothing holds more than eight.
  test.each(["dropped", "ring", "grown"] as const)(
    "%s",
    async shape => {
      const { grew, collections } = await run(shape, options);
      expect(collections).toBeGreaterThan(1);
      expect(grew).toBeLessThan(isASAN || isDebug ? 600 : 400);
    },
    30_000,
  );
});
