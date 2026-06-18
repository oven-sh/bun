// https://github.com/oven-sh/bun/issues/32492
//
// Running several `bun build` processes at once (as `concurrently` / `turbo` do)
// made some of them take ~10,000ms instead of ~10ms. Each CLI `bun build` owns
// its bundler worker pool and shuts it down when the build finishes. The pool's
// shutdown woke idle workers only when the wake-event's prior state happened to
// be WAITING, but a worker can be genuinely parked while that state is
// transiently cleared by a concurrent consumer. When shutdown raced that window
// the parked worker was never woken and slept until its 10s idle-futex timeout,
// stalling the whole build by ~10s. The stall is non-deterministic and only
// shows up under CPU contention, so this fires many builds concurrently.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test(
  "concurrent bun build does not stall on worker-pool shutdown",
  async () => {
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
    const ROUNDS = 16;
    // The stall, when it happens, is the fixed ~10s idle-futex timeout. A normal
    // bundle here is a few hundred ms even under ASAN + heavy contention, so any
    // build over this threshold is the regression.
    const STALL_MS = 5000;

    const buildOnce = async (round: number, i: number) => {
      const entry = entries[i % entries.length];
      const started = Date.now();
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--target=browser",
          "--sourcemap=external",
          "--packages=external",
          "--outdir",
          `${root}/out/d${round}_${i}`,
          `./src/${entry}-entry.ts`,
        ],
        env: bunEnv,
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { ms: Date.now() - started, exitCode, stdout, stderr };
    };

    for (let round = 0; round < ROUNDS; round++) {
      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, (_, i) => buildOnce(round, i)),
      );
      const failed = results.find(r => r.exitCode !== 0);
      if (failed) {
        throw new Error(`bun build exited with ${failed.exitCode}\nstdout:\n${failed.stdout}\nstderr:\n${failed.stderr}`);
      }
      const slowestMs = Math.max(...results.map(r => r.ms));
      expect(slowestMs).toBeLessThan(STALL_MS);
    }
  },
  120_000,
);
