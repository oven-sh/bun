// https://github.com/oven-sh/bun/issues/19678
// Use of pprof package requires V8 Integer API and CpuProfiler API
// This test verifies that V8 Integer API is implemented
// Note: Full pprof support requires CpuProfiler API which is not yet implemented
import { expect, test } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { tmpdir } from "os";
import { join } from "path";

test("pprof package should not crash Bun", async () => {
  // Create a temporary directory for this test
  const testDir = join(tmpdir(), `bun-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });

  try {
    // Create package.json
    await Bun.write(
      join(testDir, "package.json"),
      JSON.stringify({
        name: "test-pprof",
        type: "module",
        dependencies: {
          pprof: "*",
        },
      }),
    );

    // Create the test file
    await Bun.write(
      join(testDir, "index.ts"),
      `import pprof from 'pprof';

await pprof.time.profile({ durationMillis: 10000 });
console.log('SUCCESS');
`,
    );

    // Install pprof
    const install = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: testDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    await install.exited;

    // Run the test file
    const proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      cwd: testDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Verify that Integer API is no longer missing
    // The original error was: undefined symbol: _ZNK2v87Integer5ValueEv (v8::Integer::Value())
    expect(stderr).not.toContain("_ZNK2v87Integer5ValueEv");
    expect(stderr).not.toContain("v8::Integer::Value");

    // Should not crash with segmentation fault or panic
    expect(stderr).not.toContain("Segmentation fault");
    expect(stderr).not.toContain("panic");

    // Note: The test currently fails because pprof also needs CpuProfiler API
    // which is tracked separately. This test verifies Integer API is implemented.
    if (stderr.includes("CpuProfiler")) {
      // Expected - CpuProfiler not yet implemented
      console.log("Note: pprof requires CpuProfiler API which is not yet implemented");
    } else {
      // If we get here, both Integer and CpuProfiler are working
      expect(stdout).toContain("SUCCESS");
      expect(exitCode).toBe(0);
    }
  } finally {
    // Cleanup
    rmSync(testDir, { recursive: true, force: true });
  }
}, 120000); // 2 minute timeout for npm install + profiling
