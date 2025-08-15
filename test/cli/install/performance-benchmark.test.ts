import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

// Performance benchmarks for dependency hoisting with cycle detection
test("benchmark: small dependency tree (10 packages)", async () => {
  const packageJson = {
    name: "bench-small",
    dependencies: {},
  };

  // Create 10 packages with linear dependencies: pkg-0 -> pkg-1 -> pkg-2 -> ... -> pkg-9
  const files = { "package.json": JSON.stringify(packageJson) };

  for (let i = 0; i < 10; i++) {
    const deps = i < 9 ? { [`pkg-${i + 1}`]: `file:./pkg-${i + 1}` } : {};
    files[`pkg-${i}/package.json`] = JSON.stringify({
      name: `pkg-${i}`,
      dependencies: deps,
    });
    packageJson.dependencies[`pkg-${i}`] = `file:./pkg-${i}`;
  }

  const dir = tempDirWithFiles("bench-small", files);

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

  expect(exitCode).toBe(0);
  expect(stderr).not.toContain("panic");
  console.log(`Small tree (10 packages): ${duration.toFixed(2)}ms`);
}, 30000);

test("benchmark: medium dependency tree (50 packages)", async () => {
  const packageJson = {
    name: "bench-medium",
    dependencies: {},
  };

  // Create 50 packages with linear dependencies
  const files = { "package.json": JSON.stringify(packageJson) };

  for (let i = 0; i < 50; i++) {
    const deps = i < 49 ? { [`pkg-${i + 1}`]: `file:./pkg-${i + 1}` } : {};
    files[`pkg-${i}/package.json`] = JSON.stringify({
      name: `pkg-${i}`,
      dependencies: deps,
    });
    packageJson.dependencies[`pkg-${i}`] = `file:./pkg-${i}`;
  }

  const dir = tempDirWithFiles("bench-medium", files);

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

  expect(exitCode).toBe(0);
  expect(stderr).not.toContain("panic");
  console.log(`Medium tree (50 packages): ${duration.toFixed(2)}ms`);
}, 30000);

test("benchmark: wide dependency tree (20 packages, each depends on 5 others)", async () => {
  const packageJson = {
    name: "bench-wide",
    dependencies: {},
  };

  // Create 20 packages where each depends on 5 others (wide tree)
  const files = { "package.json": JSON.stringify(packageJson) };

  for (let i = 0; i < 20; i++) {
    const deps = {};
    // Each package depends on the next 5 packages (cyclically)
    for (let j = 1; j <= 5; j++) {
      const depIndex = (i + j) % 20;
      deps[`pkg-${depIndex}`] = `file:./pkg-${depIndex}`;
    }

    files[`pkg-${i}/package.json`] = JSON.stringify({
      name: `pkg-${i}`,
      dependencies: deps,
    });
    packageJson.dependencies[`pkg-${i}`] = `file:./pkg-${i}`;
  }

  const dir = tempDirWithFiles("bench-wide", files);

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

  expect(exitCode).toBe(0);
  expect(stderr).not.toContain("panic");
  console.log(`Wide tree (20x5 deps): ${duration.toFixed(2)}ms`);
}, 30000);

test("benchmark: complex dependency tree with multiple cycles", async () => {
  const packageJson = {
    name: "bench-complex",
    dependencies: {},
  };

  // Create a complex dependency structure with multiple cycles
  const files = { "package.json": JSON.stringify(packageJson) };

  // Create 15 packages with complex interdependencies
  const depStructure = {
    0: [1, 2, 3], // pkg-0 -> pkg-1, pkg-2, pkg-3
    1: [4, 5], // pkg-1 -> pkg-4, pkg-5
    2: [6, 7], // pkg-2 -> pkg-6, pkg-7
    3: [8, 9], // pkg-3 -> pkg-8, pkg-9
    4: [10, 0], // pkg-4 -> pkg-10, pkg-0 (cycle)
    5: [11, 1], // pkg-5 -> pkg-11, pkg-1 (cycle)
    6: [12, 2], // pkg-6 -> pkg-12, pkg-2 (cycle)
    7: [13, 3], // pkg-7 -> pkg-13, pkg-3 (cycle)
    8: [14, 4], // pkg-8 -> pkg-14, pkg-4
    9: [0, 5], // pkg-9 -> pkg-0, pkg-5 (cycle)
    10: [6, 7], // pkg-10 -> pkg-6, pkg-7
    11: [8, 9], // pkg-11 -> pkg-8, pkg-9
    12: [10, 11], // pkg-12 -> pkg-10, pkg-11
    13: [12, 4], // pkg-13 -> pkg-12, pkg-4
    14: [13, 5], // pkg-14 -> pkg-13, pkg-5
  };

  for (let i = 0; i < 15; i++) {
    const deps = {};
    const depIndices = depStructure[i] || [];

    for (const depIndex of depIndices) {
      deps[`pkg-${depIndex}`] = `file:./pkg-${depIndex}`;
    }

    files[`pkg-${i}/package.json`] = JSON.stringify({
      name: `pkg-${i}`,
      dependencies: deps,
    });
    packageJson.dependencies[`pkg-${i}`] = `file:./pkg-${i}`;
  }

  const dir = tempDirWithFiles("bench-complex", files);

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

  expect(exitCode).toBe(0);
  expect(stderr).not.toContain("panic");
  console.log(`Complex tree (15 packages, multiple cycles): ${duration.toFixed(2)}ms`);
}, 30000);
