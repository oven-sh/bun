import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("Node.js permission compatibility", () => {
  describe("CLI flag aliases", () => {
    test("--permission flag works like --secure", async () => {
      using dir = tempDir("perm-nodejs-permission", {
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
        cmd: [bunExe(), "--permission", "--no-prompt", "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout + stderr).toContain("PermissionDenied");
      expect(exitCode).not.toBe(0);
    });

    test("--allow-fs-read flag works like --allow-read", async () => {
      using dir = tempDir("perm-nodejs-fsread", {
        "test.ts": `
          import { readFileSync } from "fs";
          console.log(readFileSync("./secret.txt", "utf8"));
        `,
        "secret.txt": "secret data",
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--permission", "--allow-fs-read", "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout.trim()).toBe("secret data");
      expect(exitCode).toBe(0);
    });

    test("--allow-fs-write flag works like --allow-write", async () => {
      using dir = tempDir("perm-nodejs-fswrite", {
        "test.ts": `
          import { writeFileSync, readFileSync } from "fs";
          writeFileSync("./output.txt", "written data");
          console.log(readFileSync("./output.txt", "utf8"));
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--permission", "--allow-fs-write", "--allow-fs-read", "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout.trim()).toBe("written data");
      expect(exitCode).toBe(0);
    });

    test("--allow-fs-read with path restriction works", async () => {
      using dir = tempDir("perm-nodejs-fsread-path", {
        "test.ts": `
          import { readFileSync } from "fs";
          console.log(readFileSync("./allowed.txt", "utf8"));
        `,
        "allowed.txt": "allowed content",
        "forbidden.txt": "forbidden content",
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--permission", `--allow-fs-read=${String(dir)}/allowed.txt`, "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout.trim()).toBe("allowed content");
      expect(exitCode).toBe(0);
    });

    test("--allow-child-process flag works like --allow-run", async () => {
      using dir = tempDir("perm-nodejs-child", {
        "test.ts": `
          const proc = Bun.spawn(["echo", "hello"]);
          const text = await Bun.readableStreamToText(proc.stdout);
          console.log(text.trim());
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--permission", "--allow-child-process", "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout.trim()).toBe("hello");
      expect(exitCode).toBe(0);
    });
  });

  describe("process.permission.has() API", () => {
    test("returns true for granted permissions", async () => {
      using dir = tempDir("perm-nodejs-api-granted", {
        "test.ts": `
          // In non-secure mode, all permissions are granted
          console.log(process.permission.has("fs.read"));
          console.log(process.permission.has("fs.write"));
          console.log(process.permission.has("net"));
          console.log(process.permission.has("child"));
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout.trim()).toBe("true\ntrue\ntrue\ntrue");
      expect(exitCode).toBe(0);
    });

    test("returns false for denied permissions in secure mode", async () => {
      using dir = tempDir("perm-nodejs-api-denied", {
        "test.ts": `
          console.log(process.permission.has("fs.read"));
          console.log(process.permission.has("fs.write"));
          console.log(process.permission.has("net"));
          console.log(process.permission.has("child"));
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--permission", "--no-prompt", "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout.trim()).toBe("false\nfalse\nfalse\nfalse");
      expect(exitCode).toBe(0);
    });

    test("returns true for specifically allowed permissions", async () => {
      using dir = tempDir("perm-nodejs-api-specific", {
        "test.ts": `
          console.log(process.permission.has("fs.read"));
          console.log(process.permission.has("fs.write"));
          console.log(process.permission.has("net"));
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--permission", "--allow-fs-read", "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout.trim()).toBe("true\nfalse\nfalse");
      expect(exitCode).toBe(0);
    });

    test("works with reference parameter for fs permissions", async () => {
      using dir = tempDir("perm-nodejs-api-ref", {
        "test.ts": `
          const allowedPath = process.argv[2];
          const forbiddenPath = process.argv[3];
          console.log(process.permission.has("fs.read", allowedPath));
          console.log(process.permission.has("fs.read", forbiddenPath));
        `,
        "allowed.txt": "allowed",
        "forbidden.txt": "forbidden",
      });

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "--permission",
          `--allow-fs-read=${String(dir)}/allowed.txt`,
          "test.ts",
          `${String(dir)}/allowed.txt`,
          `${String(dir)}/forbidden.txt`,
        ],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout.trim()).toBe("true\nfalse");
      expect(exitCode).toBe(0);
    });

    test("supports Node.js permission scope names", async () => {
      using dir = tempDir("perm-nodejs-scopes", {
        "test.ts": `
          // Test various Node.js-style scope names
          console.log("fs:", process.permission.has("fs"));
          console.log("fs.read:", process.permission.has("fs.read"));
          console.log("fs.write:", process.permission.has("fs.write"));
          console.log("child:", process.permission.has("child"));
          console.log("child.process:", process.permission.has("child.process"));
          console.log("worker:", process.permission.has("worker"));
          console.log("net:", process.permission.has("net"));
          console.log("env:", process.permission.has("env"));
          console.log("ffi:", process.permission.has("ffi"));
          console.log("addon:", process.permission.has("addon"));
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // In non-secure mode, all permissions should be granted
      const lines = stdout.trim().split("\n");
      for (const line of lines) {
        expect(line).toContain("true");
      }
      expect(exitCode).toBe(0);
    });

    test("returns false for unknown scopes", async () => {
      using dir = tempDir("perm-nodejs-unknown", {
        "test.ts": `
          console.log(process.permission.has("unknown_scope"));
          console.log(process.permission.has(""));
          console.log(process.permission.has("foo.bar.baz"));
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout.trim()).toBe("false\nfalse\nfalse");
      expect(exitCode).toBe(0);
    });

    test("throws on missing scope argument", async () => {
      using dir = tempDir("perm-nodejs-noscope", {
        "test.ts": `
          try {
            // @ts-ignore - testing runtime error
            process.permission.has();
            console.log("NO_ERROR");
          } catch (e) {
            console.log("ERROR:", e.message);
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("ERROR:");
      expect(stdout).not.toContain("NO_ERROR");
      expect(exitCode).toBe(0);
    });
  });
});
