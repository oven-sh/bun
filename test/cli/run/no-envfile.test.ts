import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("--no-env-file disables .env loading", async () => {
  using dir = tempDir("no-env-file", {
    ".env": "FOO=bar",
    "index.js": "console.log(process.env.FOO);",
  });

  // Without --no-env-file, .env should be loaded
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("bar");
    expect(exitCode).toBe(0);
  }

  // With --no-env-file, .env should NOT be loaded
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--no-env-file", "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("undefined");
    expect(exitCode).toBe(0);
  }
});

test("--no-env-file disables .env.local loading", async () => {
  using dir = tempDir("no-env-file-local", {
    ".env": "FOO=bar",
    ".env.local": "FOO=local",
    "index.js": "console.log(process.env.FOO);",
  });

  // Without --no-env-file, .env.local should override .env
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("local");
    expect(exitCode).toBe(0);
  }

  // With --no-env-file, neither should be loaded
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--no-env-file", "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("undefined");
    expect(exitCode).toBe(0);
  }
});

test("--no-env-file disables .env.development.local loading", async () => {
  using dir = tempDir("no-env-file-dev-local", {
    ".env": "FOO=bar",
    ".env.development.local": "FOO=dev-local",
    "index.js": "console.log(process.env.FOO);",
  });

  // Without --no-env-file, .env.development.local should be loaded
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("dev-local");
    expect(exitCode).toBe(0);
  }

  // With --no-env-file, it should NOT be loaded
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--no-env-file", "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("undefined");
    expect(exitCode).toBe(0);
  }
});

test("bunfig env.file = false disables .env loading", async () => {
  using dir = tempDir("bunfig-env-file-false", {
    ".env": "FOO=bar",
    "bunfig.toml": `
[env]
file = false
`,
    "index.js": "console.log(process.env.FOO);",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("undefined");
  expect(exitCode).toBe(0);
});

test("bunfig env = false disables .env loading", async () => {
  using dir = tempDir("bunfig-env-false", {
    ".env": "FOO=bar",
    "bunfig.toml": `
env = false
`,
    "index.js": "console.log(process.env.FOO);",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("undefined");
  expect(exitCode).toBe(0);
});

test("--no-env-file with -e flag", async () => {
  using dir = tempDir("no-env-file-eval", {
    ".env": "FOO=bar",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--no-env-file", "-e", "console.log(process.env.FOO)"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("undefined");
  expect(exitCode).toBe(0);
});

test("--no-env-file combined with --env-file still loads explicit file", async () => {
  using dir = tempDir("no-env-file-with-env-file", {
    ".env": "FOO=bar",
    ".env.custom": "FOO=custom",
    "index.js": "console.log(process.env.FOO);",
  });

  // --no-env-file should skip .env but --env-file should load .env.custom
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--no-env-file", "--env-file", ".env.custom", "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("custom");
  expect(exitCode).toBe(0);
});

test("bunfig env = true still loads .env files", async () => {
  using dir = tempDir("bunfig-env-true", {
    ".env": "FOO=bar",
    "bunfig.toml": `
env = true
`,
    "index.js": "console.log(process.env.FOO);",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("bar");
  expect(exitCode).toBe(0);
});

test("--no-env-file in production mode", async () => {
  using dir = tempDir("no-env-file-production", {
    ".env": "FOO=bar",
    ".env.production": "FOO=prod",
    "index.js": "console.log(process.env.FOO);",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--no-env-file", "index.js"],
    env: { ...bunEnv, NODE_ENV: "production" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("undefined");
  expect(exitCode).toBe(0);
});
