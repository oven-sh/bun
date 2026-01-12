import { describe, expect, test } from "bun:test";
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

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

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

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

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

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

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

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

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

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

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

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

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

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

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

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("default allowed");
    expect(exitCode).toBe(0);
  });

  describe("fs.open permission checks", () => {
    test("fs.open with 'r' flag requires read permission", async () => {
      using dir = tempDir("perm-fs-open-read", {
        "test.ts": `
          import { openSync, closeSync } from "fs";
          try {
            const fd = openSync("./data.txt", "r");
            closeSync(fd);
            console.log("SUCCESS");
          } catch (e) {
            console.log("ERROR:", e.message);
            process.exit(1);
          }
        `,
        "data.txt": "test data",
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", "--no-prompt", "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout + stderr).toContain("PermissionDenied");
      expect(exitCode).not.toBe(0);
    });

    test("fs.open with 'r' flag allowed with --allow-read", async () => {
      using dir = tempDir("perm-fs-open-read-allow", {
        "test.ts": `
          import { openSync, closeSync, readSync } from "fs";
          const fd = openSync("./data.txt", "r");
          const buf = Buffer.alloc(9);
          readSync(fd, buf);
          closeSync(fd);
          console.log(buf.toString());
        `,
        "data.txt": "test data",
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", "--allow-read", "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout.trim()).toBe("test data");
      expect(exitCode).toBe(0);
    });

    test("fs.open with 'w' flag requires write permission", async () => {
      using dir = tempDir("perm-fs-open-write", {
        "test.ts": `
          import { openSync, closeSync } from "fs";
          try {
            const fd = openSync("./output.txt", "w");
            closeSync(fd);
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

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout + stderr).toContain("PermissionDenied");
      expect(exitCode).not.toBe(0);
    });

    test("fs.open with 'w' flag allowed with --allow-write", async () => {
      using dir = tempDir("perm-fs-open-write-allow", {
        "test.ts": `
          import { openSync, closeSync, writeSync, readFileSync } from "fs";
          const fd = openSync("./output.txt", "w");
          writeSync(fd, "written data");
          closeSync(fd);
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

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout.trim()).toBe("written data");
      expect(exitCode).toBe(0);
    });

    test("fs.open with 'r+' flag requires write permission", async () => {
      using dir = tempDir("perm-fs-open-rw", {
        "test.ts": `
          import { openSync, closeSync } from "fs";
          try {
            const fd = openSync("./data.txt", "r+");
            closeSync(fd);
            console.log("SUCCESS");
          } catch (e) {
            console.log("ERROR:", e.message);
            process.exit(1);
          }
        `,
        "data.txt": "test data",
      });

      // --allow-read should NOT be enough for r+ since it also writes
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", "--allow-read", "--no-prompt", "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout + stderr).toContain("PermissionDenied");
      expect(exitCode).not.toBe(0);
    });
  });

  describe("fs.statfs permission checks", () => {
    test("fs.statfs requires sys permission", async () => {
      using dir = tempDir("perm-fs-statfs", {
        "test.ts": `
          import { statfsSync } from "fs";
          try {
            const stats = statfsSync(".");
            console.log("bsize:", stats.bsize);
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

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout + stderr).toContain("PermissionDenied");
      expect(exitCode).not.toBe(0);
    });

    test("fs.statfs allowed with --allow-sys", async () => {
      using dir = tempDir("perm-fs-statfs-allow", {
        "test.ts": `
          import { statfsSync } from "fs";
          const stats = statfsSync(".");
          console.log("bsize:", stats.bsize);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", "--allow-sys", "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("bsize:");
      expect(exitCode).toBe(0);
    });

    test("fs.statfs allowed with --allow-sys=statfs", async () => {
      using dir = tempDir("perm-fs-statfs-granular", {
        "test.ts": `
          import { statfsSync } from "fs";
          const stats = statfsSync(".");
          console.log("bsize:", stats.bsize);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", "--allow-sys=statfs", "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("bsize:");
      expect(exitCode).toBe(0);
    });
  });
});
