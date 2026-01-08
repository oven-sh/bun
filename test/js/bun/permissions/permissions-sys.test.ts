import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("System info permissions", () => {
  test("os.hostname denied in secure mode without --allow-sys", async () => {
    using dir = tempDir("perm-sys-test", {
      "test.ts": `
        import os from "os";
        try {
          console.log("HOSTNAME:", os.hostname());
        } catch (e) {
          console.log("ERROR:", e.message);
          process.exit(1);
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "--no-prompt", "test.ts"],
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

    expect(stdout + stderr).toContain("PermissionDenied");
    expect(exitCode).not.toBe(0);
  });

  test("os.hostname allowed with --allow-sys", async () => {
    using dir = tempDir("perm-sys-allow", {
      "test.ts": `
        import os from "os";
        console.log("HOSTNAME:", os.hostname());
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "--allow-sys", "test.ts"],
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

    expect(stdout).toContain("HOSTNAME:");
    expect(exitCode).toBe(0);
  });

  test("os.cpus denied in secure mode without --allow-sys", async () => {
    using dir = tempDir("perm-sys-cpus", {
      "test.ts": `
        import os from "os";
        try {
          console.log("CPUS:", os.cpus().length);
        } catch (e) {
          console.log("ERROR:", e.message);
          process.exit(1);
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "--no-prompt", "test.ts"],
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

    expect(stdout + stderr).toContain("PermissionDenied");
    expect(exitCode).not.toBe(0);
  });

  test("os.networkInterfaces denied in secure mode without --allow-sys", async () => {
    using dir = tempDir("perm-sys-net", {
      "test.ts": `
        import os from "os";
        try {
          console.log("INTERFACES:", Object.keys(os.networkInterfaces()).length);
        } catch (e) {
          console.log("ERROR:", e.message);
          process.exit(1);
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "--no-prompt", "test.ts"],
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

    expect(stdout + stderr).toContain("PermissionDenied");
    expect(exitCode).not.toBe(0);
  });

  test("granular --allow-sys=<kind> works", async () => {
    using dir = tempDir("perm-sys-granular", {
      "test.ts": `
        import os from "os";
        console.log("HOSTNAME:", os.hostname());
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "--allow-sys=hostname", "test.ts"],
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

    expect(stdout).toContain("HOSTNAME:");
    expect(exitCode).toBe(0);
  });
});
