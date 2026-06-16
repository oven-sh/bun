import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";

// The inner `Transpiler` is constructed with the process-global allocator
// (`bun.default_allocator` in the reference implementation). Constructing a
// `Bun.Transpiler` must not `mi_heap_new()` a dedicated mimalloc heap per
// instance; each owned heap pins tens of KB of segment metadata for the
// object's lifetime.
test("new Bun.Transpiler() does not create a per-instance mimalloc heap", () => {
  // Warm up: first construction may lazily initialize shared state.
  new Bun.Transpiler({ loader: "ts" });
  Bun.gc(true);

  const before = heapStats({ dump: true }).mimallocDump.heaps.length;

  const instances: Bun.Transpiler[] = [];
  const N = 64;
  for (let i = 0; i < N; i++) {
    instances.push(new Bun.Transpiler({ loader: "ts" }));
  }

  const after = heapStats({ dump: true }).mimallocDump.heaps.length;

  // Allow a small slack for unrelated lazy heap creation, but nowhere near
  // one heap per instance.
  expect(after - before).toBeLessThan(N / 4);

  // Keep `instances` live across the measurement and verify they still work.
  expect(instances[0].transformSync("export const x: number = 1;")).toContain("const x = 1");
  expect(instances[N - 1].transformSync("export const y: number = 2;")).toContain("const y = 2");
});
