import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { tmpdir } from "os";
import { join } from "path";

test("--no-envfile disables .env loading", async () => {
  const dir = mkdtempSync(join(tmpdir(), "no-envfile-"));
  try {
    writeFileSync(join(dir, ".env"), "FOO=bar");
    writeFileSync(join(dir, "index.js"), "console.log(process.env.FOO);");

    // Without --no-envfile, .env should be loaded
    const proc1 = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.exited]);

    expect(stdout1.trim()).toBe("bar");
    expect(exitCode1).toBe(0);

    // With --no-envfile, .env should NOT be loaded
    const proc2 = Bun.spawn({
      cmd: [bunExe(), "--no-envfile", "index.js"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.exited]);

    expect(stdout2.trim()).toBe("undefined");
    expect(exitCode2).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--no-envfile disables .env.local loading", async () => {
  const dir = mkdtempSync(join(tmpdir(), "no-envfile-local-"));
  try {
    writeFileSync(join(dir, ".env"), "FOO=bar");
    writeFileSync(join(dir, ".env.local"), "FOO=local");
    writeFileSync(join(dir, "index.js"), "console.log(process.env.FOO);");

    // Without --no-envfile, .env.local should override .env
    const proc1 = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.exited]);

    expect(stdout1.trim()).toBe("local");
    expect(exitCode1).toBe(0);

    // With --no-envfile, neither should be loaded
    const proc2 = Bun.spawn({
      cmd: [bunExe(), "--no-envfile", "index.js"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.exited]);

    expect(stdout2.trim()).toBe("undefined");
    expect(exitCode2).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--no-envfile disables .env.development.local loading", async () => {
  const dir = mkdtempSync(join(tmpdir(), "no-envfile-dev-local-"));
  try {
    writeFileSync(join(dir, ".env"), "FOO=bar");
    writeFileSync(join(dir, ".env.development.local"), "FOO=dev-local");
    writeFileSync(join(dir, "index.js"), "console.log(process.env.FOO);");

    // Without --no-envfile, .env.development.local should be loaded
    const proc1 = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.exited]);

    expect(stdout1.trim()).toBe("dev-local");
    expect(exitCode1).toBe(0);

    // With --no-envfile, it should NOT be loaded
    const proc2 = Bun.spawn({
      cmd: [bunExe(), "--no-envfile", "index.js"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.exited]);

    expect(stdout2.trim()).toBe("undefined");
    expect(exitCode2).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bunfig env.file = false disables .env loading", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunfig-env-file-false-"));
  try {
    writeFileSync(join(dir, ".env"), "FOO=bar");
    writeFileSync(
      join(dir, "bunfig.toml"),
      `
[env]
file = false
`,
    );
    writeFileSync(join(dir, "index.js"), "console.log(process.env.FOO);");

    const proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout.trim()).toBe("undefined");
    expect(exitCode).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bunfig env = false disables .env loading", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunfig-env-false-"));
  try {
    writeFileSync(join(dir, ".env"), "FOO=bar");
    writeFileSync(
      join(dir, "bunfig.toml"),
      `
env = false
`,
    );
    writeFileSync(join(dir, "index.js"), "console.log(process.env.FOO);");

    const proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout.trim()).toBe("undefined");
    expect(exitCode).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--no-envfile with -e flag", async () => {
  const dir = mkdtempSync(join(tmpdir(), "no-envfile-eval-"));
  try {
    writeFileSync(join(dir, ".env"), "FOO=bar");

    const proc = Bun.spawn({
      cmd: [bunExe(), "--no-envfile", "-e", "console.log(process.env.FOO)"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout.trim()).toBe("undefined");
    expect(exitCode).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--no-envfile combined with --env-file still loads explicit file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "no-envfile-with-env-file-"));
  try {
    writeFileSync(join(dir, ".env"), "FOO=bar");
    writeFileSync(join(dir, ".env.custom"), "FOO=custom");
    writeFileSync(join(dir, "index.js"), "console.log(process.env.FOO);");

    // --no-envfile should skip .env but --env-file should load .env.custom
    const proc = Bun.spawn({
      cmd: [bunExe(), "--no-envfile", "--env-file", ".env.custom", "index.js"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout.trim()).toBe("custom");
    expect(exitCode).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bunfig env = true still loads .env files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunfig-env-true-"));
  try {
    writeFileSync(join(dir, ".env"), "FOO=bar");
    writeFileSync(
      join(dir, "bunfig.toml"),
      `
env = true
`,
    );
    writeFileSync(join(dir, "index.js"), "console.log(process.env.FOO);");

    const proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout.trim()).toBe("bar");
    expect(exitCode).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--no-envfile in production mode", async () => {
  const dir = mkdtempSync(join(tmpdir(), "no-envfile-production-"));
  try {
    writeFileSync(join(dir, ".env"), "FOO=bar");
    writeFileSync(join(dir, ".env.production"), "FOO=prod");
    writeFileSync(join(dir, "index.js"), "console.log(process.env.FOO);");

    const proc = Bun.spawn({
      cmd: [bunExe(), "--no-envfile", "index.js"],
      env: { ...bunEnv, NODE_ENV: "production" },
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout.trim()).toBe("undefined");
    expect(exitCode).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
