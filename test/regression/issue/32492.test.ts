// https://github.com/oven-sh/bun/issues/32492
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";

test("concurrent bun build does not stall on worker-pool shutdown", async () => {
  const N_MODULES = 40;
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "repro-32492", version: "0.0.0" }),
  };
  // A chain of modules so each entry bundles real work and warms the pool.
  for (let i = 1; i <= N_MODULES; i++) {
    const next = i + 1;
    files[`src/m${i}.ts`] =
      i < N_MODULES
        ? `import { v${next} } from "./m${next}";\nexport const v${i} = ${i} + v${next};\nexport function f${i}() { return v${i} * 2; }\n`
        : `export const v${i} = ${i};\nexport function f${i}() { return v${i} * 2; }\n`;
  }
  const entries = ["browser", "node", "bun", "worker", "schema", "graph", "media", "compress"];
  for (const e of entries) {
    files[`src/${e}-entry.ts`] = `import { v1, f1 } from "./m1";\nconsole.log("${e}", v1, f1());\n`;
  }

  using dir = tempDir("bun-build-pool-shutdown", files);
  const root = String(dir);

  const CONCURRENCY = 24;
  // #32492 was a ~10s stall at pool shutdown when the idle-futex first-wait
  // timeout was 10s. #34009 lowered that timeout to 100ms, after which the
  // 16-round version of this test no longer distinguishes a reverted
  // Event::wake fix on current main (verified empirically). This test is now a
  // coarse guard against multi-second shutdown stalls plus a concurrent-build
  // smoke test; 4 rounds x 24 builds covers that on debug/ASAN and release
  // keeps 16 because it's cheap.
  const ROUNDS = isASAN || isDebug ? 4 : 16;
  const STALL_MS = 9000;

  const buildOnce = async (i: number) => {
    const entry = entries[i % entries.length];
    const started = Date.now();
    // Bundle to stdout (no --outdir) so we can assert on the bundle contents
    // and skip per-build output directories. The regression is in thread pool
    // shutdown, which runs identically regardless of the output sink.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--target=browser", "--packages=external", `./src/${entry}-entry.ts`],
      env: bunEnv,
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { entry, ms: Date.now() - started, exitCode, stdout, stderr };
  };

  for (let round = 0; round < ROUNDS; round++) {
    const results = await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => buildOnce(i)));
    for (const r of results) {
      // Assert the bundle actually walked the 40-module chain before checking
      // the exit code so a failure surfaces the build output.
      expect(r.stderr).toBe("");
      expect(r.stdout).toContain(`var v${N_MODULES} = ${N_MODULES};`);
      expect(r.stdout).toContain("var v1 = 1 + v2;");
      expect(r.stdout).toContain(`console.log("${r.entry}", v1, f1());`);
      expect(r.exitCode).toBe(0);
    }
    const slowestMs = Math.max(...results.map(r => r.ms));
    expect(slowestMs).toBeLessThan(STALL_MS);
  }
}, 120_000);
