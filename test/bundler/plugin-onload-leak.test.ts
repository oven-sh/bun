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
//
// There is a separate pre-existing per-import ParseTask leak in
// resolveImportRecords; to keep this test independent of that leak's state
// we measure a control (real-file imports, no onLoad) and a test case
// (virtual imports with onLoad) that share the same import-resolution work,
// then assert on the difference — which isolates the Load-struct
// contribution.
test("Bun.build onLoad plugin does not leak the Load struct per matched file", async () => {
  const moduleCount = 100;
  const iterations = 20;

  const files: Record<string, string> = {
    // control entry: imports real files so ParseTask allocation matches the
    // virtual case, but no onLoad is registered -> no Load structs created.
    "control.ts":
      Array.from({ length: moduleCount }, (_, i) => `import "./real/m${i}.ts";`).join("\n") +
      "\nexport const ok = 1;\n",
    // test entry: imports virtual modules that the onLoad plugin matches.
    "virtual.ts":
      Array.from({ length: moduleCount }, (_, i) => `import "virtual:m${i}";`).join("\n") + "\nexport const ok = 1;\n",
    "build.ts": /* ts */ `
        import { heapStats } from "bun:jsc";

        const plugin: import("bun").BunPlugin = {
          name: "virtual",
          setup(build) {
            build.onResolve({ filter: /^virtual:/ }, args => ({ path: args.path, namespace: "virtual" }));
            build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({ contents: "export default 1;", loader: "js" }));
          },
        };

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

        async function measure(entry: string, plugins: import("bun").BunPlugin[]): Promise<number> {
          async function once() {
            const result = await Bun.build({ entrypoints: [entry], plugins, target: "bun" });
            if (!result.success) throw new AggregateError(result.logs, "build failed");
          }
          // Warm up: let per-build heaps and caches reach steady state.
          for (let i = 0; i < 3; i++) await once();
          const before = liveBlocks();
          for (let i = 0; i < ${iterations}; i++) await once();
          return liveBlocks() - before;
        }

        const control = await measure("./control.ts", []);
        const withOnLoad = await measure("./virtual.ts", [plugin]);
        const onLoadContribution = withOnLoad - control;
        const perOnLoad = ${moduleCount} * ${iterations};

        console.error("control:", control, " with onLoad:", withOnLoad, " onLoad contribution:", onLoadContribution, "(", perOnLoad, "matches )");

        // With the leak, onLoadContribution is ~perOnLoad (one Load struct per
        // match). Without the leak it is ~0. Threshold at half gives wide
        // margin either side and stays correct whether or not the unrelated
        // ParseTask leak is present.
        const threshold = Math.floor(perOnLoad * 0.5);
        if (onLoadContribution > threshold) {
          throw new Error(
            "onLoad leaked " + onLoadContribution + " live mimalloc blocks over " + ${iterations} + " builds (threshold " + threshold + ")",
          );
        }
      `,
  };
  for (let i = 0; i < moduleCount; i++) files[`real/m${i}.ts`] = "export default 1;\n";

  using dir = tempDir("bundler-onload-leak", files);

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
  // 46 Bun.build() calls take ~30s under debug ASAN; default 5s is not enough.
}, 90_000);
