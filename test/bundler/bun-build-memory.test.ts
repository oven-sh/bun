import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDirWithFiles } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/34053
// Every in-process Bun.build() stranded the bundle's native memory: the
// per-build mi_heaps were destroyed, but their freed arena slices were only
// scheduled for a delayed purge that back-to-back builds never let run, so
// RSS grew by roughly one module graph per build while heapUsed stayed flat.
// Gated to debug/ASAN like the sourcemap-leak test in bun-build-api.test.ts
// because release mimalloc page retention makes RSS too noisy to threshold.
// In its own file (not bun-build-api.test.ts) so the RSS measurement does not
// share a process-wide allocator with hundreds of unrelated builds.
test.skipIf(!isDebug && !isASAN)(
  "Bun.build does not strand native memory across sequential builds",
  async () => {
    const dir = tempDirWithFiles("bun-build-rss-leak", {
      "run.ts": `
        import { mkdirSync, writeFileSync } from "fs";
        import { join } from "path";

        const root = process.argv[2];
        const src = join(root, "src");
        mkdirSync(src, { recursive: true });
        const MODULES = 400;
        for (let i = 0; i < MODULES; i++) {
          let body = \`export const v\${i} = (x: number): number => {\\n\`;
          for (let k = 0; k < 20; k++) body += \`  x = (x + \${k}) * 1.0001;\\n\`;
          body += \`  return x + \${i};\\n};\\n\`;
          writeFileSync(join(src, \`m\${i}.ts\`), body);
        }
        let entry = "";
        for (let i = 0; i < MODULES; i++) entry += \`import { v\${i} } from "./m\${i}";\\n\`;
        entry += \`export const all = [\${Array.from({ length: MODULES }, (_, i) => \`v\${i}\`).join(",")}];\\n\`;
        writeFileSync(join(src, "entry.ts"), entry);

        async function build() {
          const res = await Bun.build({
            entrypoints: [join(src, "entry.ts")],
            outdir: join(root, "out"),
            target: "browser",
          });
          if (!res.success) throw new AggregateError(res.logs, "build failed");
        }
        async function settle() {
          for (let i = 0; i < 4; i++) { Bun.gc(true); await Bun.sleep(10); }
        }
        for (let i = 0; i < 2; i++) await build();
        await settle();
        const before = process.memoryUsage.rss();
        for (let i = 0; i < 8; i++) await build();
        await settle();
        const after = process.memoryUsage.rss();
        console.log(JSON.stringify({ before, after, growth: after - before }));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--smol", join(dir, "run.ts"), join(dir, "work")],
      env: {
        ...bunEnv,
        // ASAN's freed-memory quarantine retains ~4MB per measured build,
        // which would drown the ~4MB/build mimalloc signal this test guards.
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=1"].filter(Boolean).join(":"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // stderr is not asserted empty (debug/ASAN builds emit benign warnings);
    // surface it when the fixture did not reach its final print.
    if (exitCode !== 0 || !stdout.trim()) {
      throw new Error(`fixture failed (exit ${exitCode}):\n${stderr}`);
    }
    const { growth } = JSON.parse(stdout.trim());
    // Observed (2 warmup + 8 measured builds, settled, quarantine_size_mb=1):
    // ~8-10MB with the forced purge, ~30-34MB without it.
    expect(growth).toBeLessThan(20 * 1024 * 1024);
    expect(exitCode).toBe(0);
  },
  120_000,
);
