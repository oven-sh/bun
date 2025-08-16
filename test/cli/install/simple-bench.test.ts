import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

// Simple performance test with common patterns
test("benchmark: React-like dependency pattern", async () => {
  // Simulate a typical React project structure
  const dir = tempDirWithFiles("react-bench", {
    "package.json": JSON.stringify({
      name: "react-bench",
      dependencies: {
        "comp-a": "file:./comp-a",
        "comp-b": "file:./comp-b",
        "comp-c": "file:./comp-c",
        "shared": "file:./shared",
      },
    }),
    "comp-a/package.json": JSON.stringify({
      name: "comp-a",
      dependencies: {
        "shared": "file:../shared",
        "react": "^18.0.0",
      },
    }),
    "comp-b/package.json": JSON.stringify({
      name: "comp-b",
      dependencies: {
        "shared": "file:../shared",
        "comp-a": "file:../comp-a",
        "react": "^18.0.0",
      },
    }),
    "comp-c/package.json": JSON.stringify({
      name: "comp-c",
      dependencies: {
        "shared": "file:../shared",
        "comp-b": "file:../comp-b",
        "react": "^18.0.0",
      },
    }),
    "shared/package.json": JSON.stringify({
      name: "shared",
      dependencies: {
        "lodash": "^4.17.21",
      },
    }),
  });

  const times = [];

  // Run 3 times and take average
  for (let i = 0; i < 3; i++) {
    // Clean lockfile
    await Bun.spawn({
      cmd: ["rm", "-f", "bun.lock"],
      cwd: dir,
    }).exited;

    const start = performance.now();

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const duration = performance.now() - start;
    times.push(duration);

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("panic");
  }

  const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(`React-like pattern (3 runs avg): ${avgTime.toFixed(2)}ms`);
  console.log(`Individual times: ${times.map(t => t.toFixed(2)).join(", ")}ms`);
}, 60000);

test("benchmark: No circular dependencies baseline", async () => {
  // Simple linear dependency chain (no cycles)
  const dir = tempDirWithFiles("linear-bench", {
    "package.json": JSON.stringify({
      name: "linear-bench",
      dependencies: {
        "pkg-1": "file:./pkg-1",
      },
    }),
    "pkg-1/package.json": JSON.stringify({
      name: "pkg-1",
      dependencies: {
        "pkg-2": "file:../pkg-2",
      },
    }),
    "pkg-2/package.json": JSON.stringify({
      name: "pkg-2",
      dependencies: {
        "pkg-3": "file:../pkg-3",
      },
    }),
    "pkg-3/package.json": JSON.stringify({
      name: "pkg-3",
      dependencies: {
        "lodash": "^4.17.21",
      },
    }),
  });

  const times = [];

  // Run 5 times for good statistical significance
  for (let i = 0; i < 5; i++) {
    // Clean lockfile
    await Bun.spawn({
      cmd: ["rm", "-f", "bun.lock"],
      cwd: dir,
    }).exited;

    const start = performance.now();

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const duration = performance.now() - start;
    times.push(duration);

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("panic");
  }

  const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);

  console.log(`Linear dependencies (5 runs avg): ${avgTime.toFixed(2)}ms`);
  console.log(`Range: ${minTime.toFixed(2)}ms - ${maxTime.toFixed(2)}ms`);
}, 60000);
