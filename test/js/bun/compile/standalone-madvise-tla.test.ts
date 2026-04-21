// PR #29320: hintSourcePagesDontNeed() must be reached even when the
// entrypoint has top-level await. loadEntryPoint() returns a promise without
// blocking, so the call site at bun.js.zig:466 is hit synchronously before the
// main event loop spins — TLA resolution happens later in that loop.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, tempDir } from "harness";
import path from "node:path";

// Relies on Output.debugWarn which is compiled out in release builds.
test.skipIf(isWindows || !isDebug)("standalone madvise hint fires with top-level await entrypoint", async () => {
  using dir = tempDir("standalone-madvise-tla", {
    "entry.ts": `
      console.log("before-await");
      await new Promise<void>(r => setTimeout(r, 0));
      console.log("after-await");
    `,
  });

  const out = path.join(String(dir), "compiled");
  const build = Bun.spawnSync({
    cmd: [bunExe(), "build", "--compile", path.join(String(dir), "entry.ts"), "--outfile", out],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  expect(build.stderr.toString()).not.toContain("error:");
  expect(build.exitCode).toBe(0);

  await using proc = Bun.spawn({
    cmd: [out],
    env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: undefined },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("before-await");
  expect(stdout).toContain("after-await");
  // Output.debugWarn is debug-build-only; this proves the call site is reached
  // before the event loop drives the TLA to completion.
  expect(stderr).toContain("hintSourcePagesDontNeed: MADV_DONTNEED");
  expect(exitCode).toBe(0);
});
