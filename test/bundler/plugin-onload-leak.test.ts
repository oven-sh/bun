import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// JSBundler.Load is heap-allocated (bun.default_allocator.create) for every
// file an onLoad plugin matches, but Load.deinit() never destroyed the
// allocation — unlike the sibling Resolve.deinit(). In a watch/dev-server
// loop this is unbounded growth.
//
// RSS is too noisy for a ~200-byte-per-file leak in debug/ASAN builds, so we
// use heapStats({dump:true}).mimallocDump to count live blocks in the main
// mimalloc heap (seq 0) directly — bun.default_allocator allocates there.
// Each unfreed Load struct is one live block; (moduleCount * iterations)
// leaked blocks is an unambiguous signal that survives allocator noise.
test(
  "Bun.build onLoad plugin does not leak the Load struct per matched file",
  async () => {
    const moduleCount = 100;
    const iterations = 20;
    const imports = Array.from({ length: moduleCount }, (_, i) => `import "virtual:mod${i}";`).join("\n");

    using dir = tempDir("bundler-onload-leak", {
      "index.ts": imports + "\nexport const ok = 1;\n",
      "build.ts": /* ts */ `
        import { heapStats } from "bun:jsc";

        const plugin: import("bun").BunPlugin = {
          name: "virtual",
          setup(build) {
            build.onResolve({ filter: /^virtual:/ }, args => ({ path: args.path, namespace: "virtual" }));
            build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({ contents: "export default 1;", loader: "js" }));
          },
        };

        async function once() {
          const result = await Bun.build({ entrypoints: ["./index.ts"], plugins: [plugin], target: "bun" });
          if (!result.success) throw new AggregateError(result.logs, "build failed");
        }

        function liveBlocks(): number {
          Bun.gc(true);
          const dump = heapStats({ dump: true }).mimallocDump;
          let total = 0;
          for (const heap of dump.heaps) {
            if (heap.seq !== 0) continue; // main heap == bun.default_allocator
            for (const page of heap.pages) total += page.used;
          }
          return total;
        }

        // Warm up: let per-build heaps and caches reach steady state.
        for (let i = 0; i < 3; i++) await once();
        const before = liveBlocks();

        for (let i = 0; i < ${iterations}; i++) await once();
        const after = liveBlocks();

        const delta = after - before;
        const perOnLoad = ${moduleCount} * ${iterations};
        console.error("live block delta:", delta, "over", ${iterations}, "builds (", perOnLoad, "onLoad matches )");
        // There is a separate pre-existing ParseTask leak of ~perOnLoad blocks
        // in the import-resolution path that is not addressed here; the
        // threshold sits between "one per-onLoad leak" and "two per-onLoad
        // leaks" so the Load-struct leak alone trips it.
        const threshold = Math.floor(perOnLoad * 1.5);
        if (delta > threshold) {
          throw new Error("leaked " + delta + " live mimalloc blocks over " + ${iterations} + " builds (threshold " + threshold + ")");
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--smol", "build.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("leaked");
    expect(stderr).not.toContain("build failed");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  },
  120_000,
);
