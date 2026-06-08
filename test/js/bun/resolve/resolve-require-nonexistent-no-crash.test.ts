import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression test: require() of a nonexistent package should not crash
// due to PackageManager.log pointing at a stale stack-allocated Log
// when the resolve path triggers auto-install network activity.
test("require of nonexistent module does not crash", async () => {
  using installDir = tempDir("resolve-require-nonexistent-no-crash-", {});
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `try { require("nonexistent-pkg-38391"); } catch (e) {}`],
    env: { ...bunEnv, BUN_INSTALL_GLOBAL_DIR: String(installDir) },
    stderr: "inherit",
  });

  const exitCode = await proc.exited;

  expect(exitCode).toBe(0);
});
