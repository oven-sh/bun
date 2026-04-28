import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";

// FSWatcher.Arguments / StatWatcher.Arguments had no deinit(), so the
// PathLike parsed from the JS path string was never released by the
// `@hasDecl(Arguments, "deinit")` gate in node_fs_binding.zig.
//
// Separately, PathLike.fromBunString dropped `sliced.underlying` without
// derefing it when returning `.encoded_slice` for non-Latin1 paths in sync
// mode, leaking one WTF::StringImpl ref on every sync fs call.
//
// Non-ASCII path prefixes below force the `.encoded_slice` branch; the long
// tail makes the per-call leak large enough to observe in RSS.

const iterations = isDebug ? 10_000 : 40_000;
const timeout = isDebug ? 180_000 : 60_000;

async function run(code: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--smol", "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toContain("growthMB=");
  expect(exitCode).toBe(0);
}

function fixture(call: string, throwMsg: string): string {
  return /* ts */ `
    import fs from "node:fs";
    const tail = Buffer.alloc(2048, "x").toString();
    function makePath(i) {
      return "/\u65b0\u5efa\u6587\u4ef6\u5939/does-not-exist-" + i + "-" + tail;
    }
    for (let i = 0; i < 500; i++) {
      try { ${call} } catch {}
    }
    Bun.gc(true);
    const before = process.memoryUsage.rss();
    for (let i = 0; i < ${iterations}; i++) {
      try { ${call} } catch {}
    }
    Bun.gc(true);
    const growthMB = (process.memoryUsage.rss() - before) / 1024 / 1024;
    console.log("growthMB=" + growthMB.toFixed(2));
    if (growthMB > 40) {
      throw new Error("${throwMsg}: " + growthMB.toFixed(2) + "MB");
    }
  `;
}

describe("fs.watch argument leaks", () => {
  test(
    "fs.watch does not leak path",
    async () => {
      // Directory does not exist so fs.watch throws, exercising the runSync
      // cleanup path without touching inotify/kqueue limits.
      await run(fixture(`fs.watch(makePath(i), () => {});`, "fs.watch leaked path arguments"));
    },
    timeout,
  );

  test(
    "fs.watchFile does not leak path when argument parsing fails",
    async () => {
      // StatWatcher.Arguments.fromJS parses the path before validating
      // `interval`, and previously had no errdefer for the path. Passing a
      // non-number interval throws after the path allocation, leaking it.
      await run(
        fixture(`fs.watchFile(makePath(i), { interval: "bad" }, () => {});`, "fs.watchFile leaked path arguments"),
      );
    },
    timeout,
  );

  test(
    "sync fs calls do not leak underlying WTF string for non-Latin1 paths",
    async () => {
      // This exercises PathLike.fromBunString directly: existsSync already
      // had Arguments.deinit, so the only leak here is the dropped
      // sliced.underlying ref in the `.encoded_slice` branch.
      await run(fixture(`fs.existsSync(makePath(i));`, "fs.existsSync leaked path arguments"));
    },
    timeout,
  );
});
