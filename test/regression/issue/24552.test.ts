// Test for https://github.com/oven-sh/bun/issues/24552
// Segmentation fault when NAPI finalizers run during env teardown
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

test("NAPI finalizers should not crash during subprocess teardown", async () => {
  const addonPath = join(__dirname, "../../napi/napi-app/build/Debug/test_finalizer_on_teardown.node");

  // Spawn a subprocess that loads NAPI modules with finalizers
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      // Load the NAPI addon
      const addon = require('${addonPath}');

      // Create objects with finalizers
      const objects = addon.createObjects(20);

      // Let them be garbage collected
      // Force GC if available
      if (global.gc) {
        global.gc();
      }

      // Log that we're exiting normally
      console.log("Exiting normally");

      // Process will exit here, triggering finalizers
      // Before the fix, this would crash with segfault at address 0x0
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The process should exit successfully without crashing
  expect(exitCode).toBe(0);
  expect(stdout).toContain("Exiting normally");

  // Should not have segfault or crash messages
  expect(stderr).not.toContain("Segmentation fault");
  expect(stderr).not.toContain("panic");
});

test("NAPI finalizers in loop scenario (like rspack)", async () => {
  const addonPath = join(__dirname, "../../napi/napi-app/build/Debug/test_finalizer_on_teardown.node");

  // Simulate running rspack/rsbuild for multiple configs in a loop
  const configs = ["config1", "config2", "config3"];

  for (const config of configs) {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const addon = require('${addonPath}');
        const objects = addon.createObjects(10);
        console.log('Processing ${config}');
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain(`Processing ${config}`);
    expect(stderr).not.toContain("Segmentation fault");
    expect(stderr).not.toContain("panic");
  }
});
