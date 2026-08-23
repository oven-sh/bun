// Fault-injection test: mock server so no Postgres is needed. All wire bytes
// come from wire-frames.ts via the fixture.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import path from "node:path";

const fixture = path.join(import.meta.dir, "postgres-json-bind-leak.fixture.ts");

// https://github.com/oven-sh/bun/issues/40102
test("json/jsonb bind parameter does not leak the stringified payload", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: {
      ...bunEnv,
      // ASAN's quarantine pins freed blocks; disable it so RSS reflects frees.
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0", "thread_local_quarantine_size_kb=0"]
        .filter(Boolean)
        .join(":"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr.trim()).toBe("");
  const { deltaMiB } = JSON.parse(stdout.trim());
  // Unfixed: ~300 × 512 KiB retained (≈160 MiB). Fixed: allocator slack only
  // (≈10 MiB Linux release, ≈30 MiB macOS, more under debug/ASAN).
  expect(deltaMiB).toBeLessThan(isASAN || isDebug ? 80 : 60);
  expect(exitCode).toBe(0);
});
