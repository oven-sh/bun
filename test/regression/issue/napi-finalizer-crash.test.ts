import { spawnSync } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

// This test reproduces the NAPI finalizer crash that was happening with node-sqlite3
// The crash was caused by iterator invalidation when finalizers triggered GC operations
// that modified the m_finalizers set during iteration in napi_env__::cleanup()

test("NAPI finalizer iterator invalidation crash fix", async () => {
  // Build the NAPI test addons first
  console.time("Building NAPI addons");
  const buildResult = spawnSync({
    cmd: [bunExe(), "install"],
    cwd: join(__dirname, "../..", "napi", "napi-app"),
    stderr: "pipe",
    stdout: "pipe",
    env: bunEnv,
  });

  if (!buildResult.success) {
    console.error("Failed to build NAPI addons:", buildResult.stderr?.toString());
    throw new Error("NAPI addon build failed");
  }
  console.timeEnd("Building NAPI addons");

  // Create a test script that reproduces the crash scenario
  const testDir = tempDirWithFiles("napi-finalizer-crash-test", {
    "test-crash.js": `
const path = require('path');

// Load the test addon that has problematic finalizers
const addonPath = path.join(__dirname, '../../../napi/napi-app/build/Release/test_finalizer_iterator_invalidation.node');
const addon = require(addonPath);

console.log("Creating objects with problematic finalizers...");

// Create multiple objects with finalizers that will trigger GC operations
// This reproduces the scenario where finalizers call JavaScript code that triggers GC
// which then tries to modify m_finalizers during iteration - causing iterator invalidation
const objects = addon.createProblematicObjects(15);

console.log("Created", objects.length, "objects");
console.log("Initial finalize count:", addon.getFinalizeCount());

// Make objects eligible for GC
objects.splice(0, objects.length);

// Try to trigger some GC to activate finalizers
if (global.gc) {
  console.log("Triggering GC...");
  global.gc();
}

console.log("Current finalize count:", addon.getFinalizeCount());

// This will trigger process exit and the finalizer cleanup process
// Before the fix, this would crash with a segmentation fault due to iterator invalidation
// After the fix, it should complete successfully
console.log("Triggering exit with finalizer cleanup...");
addon.forceCleanupAndExit();
`,
  });

  // Run the test - this would crash before the fix
  const testResult = await Bun.spawn({
    cmd: [bunExe(), "test-crash.js"],
    cwd: testDir,
    env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([testResult.stdout.text(), testResult.stderr.text()]);

  await testResult.exited;

  console.log("Test stdout:", stdout);
  if (stderr) console.log("Test stderr:", stderr);

  // The test should complete successfully (exit code 0) without any segmentation fault
  expect(testResult.exitCode).toBe(0);
  expect(stdout).toContain("Creating objects with problematic finalizers");
  expect(stdout).toContain("Triggering exit with finalizer cleanup");

  // Should not contain crash indicators
  expect(stderr).not.toContain("Segmentation fault");
  expect(stderr).not.toContain("SIGSEGV");
  expect(stderr).not.toContain("signal 11");
  expect(stderr).not.toContain("crashed");

  console.log("✅ NAPI finalizer crash test passed - no segmentation fault occurred");
});
