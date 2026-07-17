import { test, expect } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";

// Regression guard for a heap-use-after-free observed under ASAN during
// back-to-back Bun.build() calls that enable sourcemaps and fail with a
// link-time "no matching export" error. `compute_data_for_source_map`
// schedules source-map tasks onto the work pool, then `link()` returns Err,
// and the caller waits on the source-map WaitGroups before dropping the
// heap-allocated BundleV2. The last worker's `WaitGroup::finish()` must not
// touch `self` after publishing count==0 because that lets `wait()` return
// and the owner free the WaitGroup; the slow-path `Mutex::lock()` that
// followed would then write to freed memory. The window needs the worker to
// be futex-parked in `Mutex::lock_slow` past the drop, so this is a stress
// loop rather than a deterministic probe. ASAN-only: release builds would
// just silently write to freed-but-unreused memory.
test.skipIf(!isASAN)(
  "Bun.build sourcemap + link-time error drops BundleV2 only after the last source-map WaitGroup::finish() is done",
  async () => {
    const N_FILES = 8;
    const N_ITER = 300;

    const files: Record<string, string> = {
      "package.json": `{"type":"module"}`,
    };
    let entry = "";
    for (let i = 0; i < N_FILES; i++) {
      entry += `import { v${i} } from "./leaf${i}";\n`;
    }
    entry += `export const out = [${Array.from({ length: N_FILES }, (_, i) => `v${i}`).join(",")}];\n`;
    files["entry.ts"] = entry;
    // leaf0 imports a binding that entry.ts does not export: a link-time
    // error detected after source-map tasks are already scheduled.
    files["leaf0.ts"] = `import { DOES_NOT_EXIST } from "./entry";\nexport const v0 = DOES_NOT_EXIST;\n`;
    for (let i = 1; i < N_FILES; i++) {
      files[`leaf${i}.ts`] = `export const v${i} = ${i};\n`;
    }

    // Inline runner so a single child process performs every iteration.
    files["run.ts"] = `
const { join } = require("path");
const dir = process.argv[2];
const iters = parseInt(process.argv[3], 10);
let failed = 0;
for (let i = 0; i < iters; i++) {
  try {
    await Bun.build({
      entrypoints: [join(dir, "entry.ts")],
      sourcemap: "external",
      outdir: join(dir, "out"),
    });
    console.error("unexpected success at iter", i);
    process.exit(1);
  } catch {
    failed++;
  }
}
console.log("failed=" + failed + " of " + iters);
`;

    using dir = tempDir("bun-build-sourcemap-link-error-uaf", files);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run.ts", String(dir), String(N_ITER)],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // ASAN aborts the child with a heap-use-after-free report on stderr when
    // the race fires; otherwise every iteration rejects with a build error.
    expect(stderr).not.toContain("AddressSanitizer");
    expect(stderr).not.toContain("heap-use-after-free");
    expect(stdout.trim()).toBe(`failed=${N_ITER} of ${N_ITER}`);
    expect(exitCode).toBe(0);
  },
  60_000,
);
