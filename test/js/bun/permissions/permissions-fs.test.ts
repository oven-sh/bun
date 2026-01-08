import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("File system permissions", () => {
  test("fs.readFile denied in secure mode without --allow-read", async () => {
    using dir = tempDir("perm-fs-test", {
      "test.ts": `
        import { readFileSync } from "fs";
        try {
          console.log(readFileSync("./secret.txt", "utf8"));
        } catch (e) {
          console.log("ERROR:", e.message);
          process.exit(1);
        }
      `,
      "secret.txt": "secret data",
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

  test("fs.readFile allowed with --allow-read", async () => {
    using dir = tempDir("perm-fs-test-allow", {
      "test.ts": `
        import { readFileSync } from "fs";
        console.log(readFileSync("./secret.txt", "utf8"));
      `,
      "secret.txt": "secret data",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "--allow-read", "test.ts"],
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

    expect(stdout.trim()).toBe("secret data");
    expect(exitCode).toBe(0);
  });

  test("fs.writeFile denied in secure mode without --allow-write", async () => {
    using dir = tempDir("perm-fs-write-test", {
      "test.ts": `
        import { writeFileSync } from "fs";
        try {
          writeFileSync("./output.txt", "test data");
          console.log("SUCCESS");
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

  test("fs.writeFile allowed with --allow-write", async () => {
    using dir = tempDir("perm-fs-write-allow", {
      "test.ts": `
        import { writeFileSync, readFileSync } from "fs";
        writeFileSync("./output.txt", "test data");
        console.log(readFileSync("./output.txt", "utf8"));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "--allow-write", "--allow-read", "test.ts"],
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

    expect(stdout.trim()).toBe("test data");
    expect(exitCode).toBe(0);
  });

  test("granular --allow-read=<path> works", async () => {
    using dir = tempDir("perm-fs-granular", {
      "test.ts": `
        import { readFileSync } from "fs";
        console.log(readFileSync("./allowed.txt", "utf8"));
      `,
      "allowed.txt": "allowed content",
      "forbidden.txt": "forbidden content",
    });

    // Allow read only for allowed.txt
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", `--allow-read=${String(dir)}/allowed.txt`, "test.ts"],
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

    expect(stdout.trim()).toBe("allowed content");
    expect(exitCode).toBe(0);
  });

  test("--deny-read takes precedence over --allow-read", async () => {
    using dir = tempDir("perm-fs-deny", {
      "test.ts": `
        import { readFileSync } from "fs";
        try {
          console.log(readFileSync("./secret.txt", "utf8"));
        } catch (e) {
          console.log("ERROR:", e.message);
          process.exit(1);
        }
      `,
      "secret.txt": "secret data",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "--allow-read", `--deny-read=${String(dir)}/secret.txt`, "test.ts"],
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

  test("-A allows all permissions", async () => {
    using dir = tempDir("perm-fs-all", {
      "test.ts": `
        import { readFileSync, writeFileSync } from "fs";
        writeFileSync("./output.txt", "written");
        console.log(readFileSync("./output.txt", "utf8"));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "-A", "test.ts"],
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

    expect(stdout.trim()).toBe("written");
    expect(exitCode).toBe(0);
  });

  test("without --secure, permissions are allowed by default", async () => {
    using dir = tempDir("perm-fs-default", {
      "test.ts": `
        import { readFileSync } from "fs";
        console.log(readFileSync("./secret.txt", "utf8"));
      `,
      "secret.txt": "default allowed",
    });

    // No --secure flag
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.ts"],
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

    expect(stdout.trim()).toBe("default allowed");
    expect(exitCode).toBe(0);
  });
});
