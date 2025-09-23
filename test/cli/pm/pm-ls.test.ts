import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("bun pm ls --json outputs valid JSON", async () => {
  using dir = tempDir("pm-ls-json", {
    "package.json": JSON.stringify({
      name: "test-project",
      version: "1.0.0",
      dependencies: {
        "is-number": "7.0.0",
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

  // Test JSON output
  await using proc = Bun.spawn({
    cmd: [bunExe(), "pm", "ls", "--json"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  // Parse JSON output
  const json = JSON.parse(stdout);
  expect(json).toHaveProperty("name", "test-project");
  expect(json).toHaveProperty("version", "1.0.0");
  expect(json).toHaveProperty("dependencies");
  expect(json.dependencies).toHaveProperty("is-number");
  expect(json.dependencies["is-number"]).toHaveProperty("version", "7.0.0");
  expect(json.dependencies["is-number"]).toHaveProperty("resolved");
  expect(json.dependencies["is-number"]).toHaveProperty("overridden", false);
});

test("bun pm ls --json --depth=0 limits depth", async () => {
  using dir = tempDir("pm-ls-depth", {
    "package.json": JSON.stringify({
      name: "test-project",
      version: "1.0.0",
      dependencies: {
        "is-number": "7.0.0", // This has no dependencies itself
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

  // Test depth=0 (no nested dependencies)
  await using proc = Bun.spawn({
    cmd: [bunExe(), "pm", "ls", "--json", "--depth=0"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  const json = JSON.parse(stdout);
  expect(json.dependencies["is-number"]).toHaveProperty("version");
  expect(json.dependencies["is-number"]).not.toHaveProperty("dependencies");
});

test("bun pm ls --depth limits tree output", async () => {
  using dir = tempDir("pm-ls-tree-depth", {
    "package.json": JSON.stringify({
      name: "test-project",
      version: "1.0.0",
      dependencies: {
        "is-number": "7.0.0",
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

  // Test regular tree with depth=0
  await using proc = Bun.spawn({
    cmd: [bunExe(), "pm", "ls", "--depth=0"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  // Should only show direct dependencies
  const lines = stdout.trim().split("\n");
  expect(lines.length).toBeGreaterThan(0);
  expect(stdout).toContain("is-number@7.0.0");
  // Should not show any nested structure (no more ├── or └──)
  const hasNestedDeps = lines.some(line => line.includes("│"));
  expect(hasNestedDeps).toBe(false);
});
