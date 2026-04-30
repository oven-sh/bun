import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// Blob.fromDOMFormData pushes each FormData entry's bytes — including the
// full NodeFS.readFile result for Bun.file() entries — into a StringJoiner.
// If a subsequent entry's read fails (e.g. ENOENT), the failure path used to
// return an empty Blob without calling joiner.deinit(). The arena defer only
// frees the joiner's Node structs; each node's data slice has its own owner
// allocator (bun.default_allocator / the readFile buffer) that is only freed
// by StringJoiner.done() or StringJoiner.deinit(), so every file buffer read
// for earlier entries was leaked.
test("FormData serialization does not leak prior file buffers when a later file read fails", async () => {
  const fileSize = 256 * 1024;
  const iterations = 100;

  // Own the scratch file in the parent so cleanup is guaranteed via `using`
  // even if the child is SIGTERMed on test timeout (process.on("exit") in the
  // child wouldn't run in that case).
  using dir = tempDir("formdata-file-error-leak", {
    "real.bin": Buffer.alloc(fileSize, "a"),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--smol", join(import.meta.dir, "FormData-file-error-leak-fixture.ts")],
    env: {
      ...bunEnv,
      REAL_PATH: join(String(dir), "real.bin"),
      MISSING_PATH: join(String(dir), "missing.bin"),
      ITERATIONS: String(iterations),
      WARMUP: "10",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) console.error(stderr);

  const result = JSON.parse(stdout.trim());
  const expectedLeakMB = (fileSize * iterations) / (1024 * 1024);
  console.log(
    `FormData file-error leak: ${result.iterations} iterations, growth ${result.growthMB} MB (pre-fix ~${expectedLeakMB} MB)`,
  );

  // Without the fix: ~25 MB growth (256 KiB × 100). With the fix: ~0.
  // Threshold is well under half the expected leak to leave headroom for
  // unrelated allocator noise while still catching the regression.
  expect(result.growthMB).toBeLessThan(10);
  expect(exitCode).toBe(0);
});
