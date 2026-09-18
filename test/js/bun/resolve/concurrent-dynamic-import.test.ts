import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Two dynamic imports of the same specifier issued before the first async
// transpile/fetch settles must both resolve. Under the new C++ module loader
// each call gets its own embedder fetch promise (the registry entry is created
// only after the first fetch settles), so the loser of that race must still be
// resolved by Bun__onFulfillAsyncModule rather than left pending forever.
test("concurrent dynamic imports of the same module both resolve", async () => {
  using dir = tempDir("concurrent-dyn-import", {
    "shared.ts": `export const heavy = "H";`,
    "modules.ts": `import { heavy } from "./shared";\nexport const lazy = heavy + "-lazy";`,
    "entry.mjs": `
      const first = import("./modules.ts");
      const second = import("./modules.ts");
      const [a, b] = await Promise.all([first, second]);
      if (a.lazy !== "H-lazy" || b.lazy !== "H-lazy") throw new Error("wrong value");
      console.log("ok");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

// Work pool threads transpile the static imports of a module. A worker keeps its parse arena (one mimalloc heap)
// while it has more modules to transpile, and frees it when it runs out of tasks. --smol gives every module a fresh heap.
test.concurrent.each([
  { smol: false, name: "a burst of imports creates no allocator heap per module, and no heap outlives the burst" },
  { smol: true, name: "--smol: a burst of imports creates a heap per module, and no heap outlives the burst" },
])("$name", async ({ smol }) => {
  const count = 100;
  const files: Record<string, string> = {
    "entry.ts": Array.from({ length: count }, (_, i) => `import "./m${i}.ts";`).join("\n"),
    "main.mjs": `
      import { heapStats } from "bun:jsc";
      // "total" counts mi_heap_new() calls, "current" counts the heaps that are alive.
      const heaps = () => heapStats().mimalloc.heaps;
      const before = heaps();
      await import("./entry.ts");
      const created = heaps().total - before.total;
      // A worker frees its arena on its own thread, so the last heap can go away after the import resolves.
      const deadline = performance.now() + 3000;
      while (heaps().current > before.current && performance.now() < deadline) {
        await new Promise(resolve => setImmediate(resolve));
      }
      console.log(JSON.stringify({ created, alive: heaps().current - before.current }));
    `,
  };
  for (let i = 0; i < count; i++) files[`m${i}.ts`] = `export const v${i}: number = ${i};`;
  using dir = tempDir("import-burst-heaps", files);

  await using proc = Bun.spawn({
    cmd: [bunExe(), ...(smol ? ["--smol"] : []), "main.mjs"],
    cwd: String(dir),
    // Two workers do not drain the queue faster than the loader fills it, so they run out of tasks near the end only.
    env: { ...bunEnv, UV_THREADPOOL_SIZE: "2" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { created, alive } = JSON.parse(stdout);
  // One heap per module is count + 1 on every run. With reuse, 860 runs of release and debug builds gave 2 to 10.
  if (smol) expect(created).toBeGreaterThan(count);
  else expect(created).toBeLessThan((count * 3) / 4);
  expect(alive).toBe(0);
  expect(exitCode).toBe(0);
});
