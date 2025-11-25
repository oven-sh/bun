// https://github.com/oven-sh/bun/issues/19678
// Use of pprof package causing crash in URLSearchParams::getAll
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

    // Debug output
    if (exitCode !== 0) {
      console.log("Exit code:", exitCode);
      console.log("Stdout:", stdout);
      console.log("Stderr:", stderr);
    }

    // Should not crash with segmentation fault
    expect(stderr).not.toContain("Segmentation fault");
    expect(stderr).not.toContain("panic");
    expect(stdout).toContain("SUCCESS");
    expect(exitCode).toBe(0);
  } finally {
    // Cleanup
    rmSync(testDir, { recursive: true, force: true });
  }
}, 120000); // 2 minute timeout for npm install + profiling
