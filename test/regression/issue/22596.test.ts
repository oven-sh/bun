import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("napi_reference_unref can be called from finalizers without crashing", async () => {
  // This test ensures that napi_reference_unref can be called during GC
  // without triggering the NAPI_CHECK_ENV_NOT_IN_GC assertion.
  // This was causing crashes with packages like rolldown-vite when used with Nuxt.
  // See: https://github.com/oven-sh/bun/issues/22596

  const code = `
    // This test ensures that napi_reference_unref can be called during GC
    // without triggering the NAPI_CHECK_ENV_NOT_IN_GC assertion.
    // The actual crash would happen with native modules that call
    // napi_reference_unref from finalizers (like in rolldown-vite).
    
    // Create objects that will be garbage collected
    let refs = [];
    for (let i = 0; i < 100; i++) {
      refs.push({ data: new ArrayBuffer(1024 * 1024) }); // 1MB buffers
    }
    
    // Clear references to trigger GC
    refs = null;
    
    // Force garbage collection
    if (global.gc) {
      global.gc();
      global.gc(); // Run twice to ensure finalizers run
    }
    
    console.log("SUCCESS: No crash during GC with napi_reference_unref");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--expose-gc", "-e", code],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("SUCCESS");
  expect(stderr).not.toContain("panic");
  expect(stderr).not.toContain("Aborted");
  expect(stderr).not.toContain("NAPI");
});
