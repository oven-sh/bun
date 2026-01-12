import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("Permission edge cases", () => {
  describe.concurrent("env behavior", () => {
    test("can set and read new env vars in secure mode without --allow-env", async () => {
      // This is expected behavior: scripts can create their own env vars
      // but cannot read inherited/system env vars
      using dir = tempDir("perm-env-set", {
        "test.ts": `
          process.env.MY_NEW_VAR = "my_value";
          console.log("MY_NEW_VAR:", process.env.MY_NEW_VAR);
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

      expect(stdout).toContain("MY_NEW_VAR: my_value");
      expect(exitCode).toBe(0);
    });

    test("cannot read inherited env vars in secure mode without --allow-env", async () => {
      using dir = tempDir("perm-env-inherited", {
        "test.ts": `
          try {
            console.log("HOME:", process.env.HOME);
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
  });

  describe.concurrent("async vs sync spawn", () => {
    test("Bun.spawn (async) requires run permission", async () => {
      using dir = tempDir("perm-spawn-async", {
        "test.ts": `
          try {
            const proc = Bun.spawn([process.execPath, "--version"]);
            await proc.exited;
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

    test("Bun.spawnSync requires run permission", async () => {
      using dir = tempDir("perm-spawn-sync", {
        "test.ts": `
          try {
            Bun.spawnSync([process.execPath, "--version"]);
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
  });

  describe.concurrent("server permissions", () => {
    test("Bun.serve requires net permission", async () => {
      using dir = tempDir("perm-serve", {
        "test.ts": `
          try {
            const server = Bun.serve({
              port: 0,
              fetch() { return new Response("hi"); }
            });
            console.log("port:", server.port);
            server.stop();
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

    test("Bun.serve works with --allow-net", async () => {
      using dir = tempDir("perm-serve-allow", {
        "test.ts": `
          const server = Bun.serve({
            port: 0,
            fetch() { return new Response("hi"); }
          });
          console.log("port:", server.port);
          server.stop();
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", "--allow-net", "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("port:");
      expect(exitCode).toBe(0);
    });
  });

  describe.concurrent("multiple sys kinds", () => {
    test("os.uptime requires sys permission", async () => {
      using dir = tempDir("perm-sys-uptime", {
        "test.ts": `
          import os from "os";
          try {
            console.log("uptime:", os.uptime());
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

    test("os.freemem requires sys permission", async () => {
      using dir = tempDir("perm-sys-freemem", {
        "test.ts": `
          import os from "os";
          try {
            console.log("freemem:", os.freemem());
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

    test("os.homedir requires sys permission", async () => {
      using dir = tempDir("perm-sys-homedir", {
        "test.ts": `
          import os from "os";
          try {
            console.log("homedir:", os.homedir());
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
  });

  describe.concurrent("backwards compatibility", () => {
    test("without --secure flag, all permissions are granted", async () => {
      using dir = tempDir("perm-compat", {
        "test.ts": `
          import os from "os";
          console.log("hostname:", os.hostname());
          console.log("HOME:", process.env.HOME);
          const r = Bun.spawnSync([process.execPath, "--version"]);
          console.log("spawn exit:", r.exitCode);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test.ts"], // No --secure flag
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("hostname:");
      expect(stdout).toContain("HOME:");
      expect(stdout).toContain("spawn exit: 0");
      expect(exitCode).toBe(0);
    });
  });
});
