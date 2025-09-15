import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("bun pm ls --json separates dependency types correctly", async () => {
  using dir = tempDir("pm-ls-types", {
    "package.json": JSON.stringify({
      name: "test-dep-types",
      version: "1.0.0",
      dependencies: {
        "is-number": "7.0.0",
      },
      devDependencies: {
        "is-odd": "3.0.1",
      },
      optionalDependencies: {
        "is-even": "1.0.0",
      },
    }),
  });

  // Install dependencies
  await using installProc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
  });

  const installExitCode = await installProc.exited;
  expect(installExitCode).toBe(0);

  // Test JSON output with separated dependency types
  await using proc = Bun.spawn({
    cmd: [bunExe(), "pm", "ls", "--json"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  const json = JSON.parse(stdout);

  // Check that dependencies are in the right sections
  expect(json).toHaveProperty("dependencies");
  expect(json.dependencies).toHaveProperty("is-number");
  expect(json.dependencies["is-number"]).toHaveProperty("from", "7.0.0");

  expect(json).toHaveProperty("devDependencies");
  expect(json.devDependencies).toHaveProperty("is-odd");
  expect(json.devDependencies["is-odd"]).toHaveProperty("from", "3.0.1");

  expect(json).toHaveProperty("optionalDependencies");
  expect(json.optionalDependencies).toHaveProperty("is-even");
  expect(json.optionalDependencies["is-even"]).toHaveProperty("from", "1.0.0");

  // Ensure no mixing between sections
  expect(json.dependencies).not.toHaveProperty("is-odd");
  expect(json.dependencies).not.toHaveProperty("is-even");
  expect(json.devDependencies).not.toHaveProperty("is-number");
  expect(json.devDependencies).not.toHaveProperty("is-even");
  expect(json.optionalDependencies).not.toHaveProperty("is-number");
  expect(json.optionalDependencies).not.toHaveProperty("is-odd");
});

test("bun pm ls --json --depth=1 includes nested deps without 'from' field", async () => {
  using dir = tempDir("pm-ls-nested-from", {
    "package.json": JSON.stringify({
      name: "test-nested",
      version: "1.0.0",
      dependencies: {
        "is-odd": "3.0.1", // This depends on is-number
      },
    }),
  });

  // Install dependencies
  await using installProc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
  });

  const installExitCode = await installProc.exited;
  expect(installExitCode).toBe(0);

  // Test JSON output with depth=1
  await using proc = Bun.spawn({
    cmd: [bunExe(), "pm", "ls", "--json", "--depth=1"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  const json = JSON.parse(stdout);

  // Root dependency should have 'from' field
  expect(json.dependencies["is-odd"]).toHaveProperty("from", "3.0.1");

  // Nested dependencies should NOT have 'from' field
  if (json.dependencies["is-odd"].dependencies?.["is-number"]) {
    expect(json.dependencies["is-odd"].dependencies["is-number"]).not.toHaveProperty("from");
    expect(json.dependencies["is-odd"].dependencies["is-number"]).toHaveProperty("version");
    expect(json.dependencies["is-odd"].dependencies["is-number"]).toHaveProperty("resolved");
  }
});