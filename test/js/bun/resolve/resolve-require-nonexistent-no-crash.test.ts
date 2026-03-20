import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test: require() of a nonexistent package should not crash
// due to PackageManager.log pointing at a stale stack-allocated Log
// when the resolve path triggers auto-install network activity.
test("require of nonexistent module does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `try { require("nonexistent-pkg-38391"); } catch (e) {}`],
    env: { ...bunEnv, BUN_INSTALL_GLOBAL_DIR: "/tmp/bun-test-resolve-crash" },
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).not.toContain("AddressSanitizer");
  expect(exitCode).not.toBe(null);
  // Should exit cleanly or with a non-crash error, not SIGABRT (134)
  expect(exitCode).not.toBe(134);
});
