import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

describe("Granular permissions", () => {
  describe.concurrent("env wildcards", () => {
    test("--allow-env=HOME* allows HOME and HOMEBREW_PREFIX", async () => {
      using dir = tempDir("perm-env-wildcard", {
        "test.ts": `
          console.log("HOME:", process.env.HOME);
          console.log("HOMEBREW_PREFIX:", process.env.HOMEBREW_PREFIX || "not-set");
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", "--allow-env=HOME*", "test.ts"],
        cwd: String(dir),
        env: { ...bunEnv, HOMEBREW_PREFIX: "/opt/homebrew" },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("HOME:");
      expect(stdout).toContain("HOMEBREW_PREFIX:");
      expect(exitCode).toBe(0);
    });

    test("--allow-env=HOME* denies PATH", async () => {
      using dir = tempDir("perm-env-wildcard-deny", {
        "test.ts": `
          try {
            console.log("PATH:", process.env.PATH);
          } catch (e) {
            console.log("ERROR:", e.message);
            process.exit(1);
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", "--allow-env=HOME*", "test.ts"],
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

  describe.concurrent("multiple values", () => {
    test("--allow-env=HOME,USER,PATH allows all three", async () => {
      using dir = tempDir("perm-env-multi", {
        "test.ts": `
          console.log("HOME:", process.env.HOME ? "set" : "not-set");
          console.log("USER:", process.env.USER ? "set" : "not-set");
          console.log("PATH:", process.env.PATH ? "set" : "not-set");
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", "--allow-env=HOME,USER,PATH", "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("HOME: set");
      expect(stdout).toContain("USER: set");
      expect(stdout).toContain("PATH: set");
      expect(exitCode).toBe(0);
    });

    test("--allow-net=example.com,httpbin.org allows both hosts", async () => {
      using dir = tempDir("perm-net-multi", {
        "test.ts": `
          const r1 = await fetch("https://example.com");
          console.log("example.com:", r1.status);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", "--allow-net=example.com,httpbin.org", "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("example.com: 200");
      expect(exitCode).toBe(0);
    });

    test.skipIf(isWindows)("--allow-run=echo,ls allows both commands", async () => {
      using dir = tempDir("perm-run-multi", {
        "test.ts": `
          const r1 = Bun.spawnSync(["echo", "hello"]);
          console.log("echo exit:", r1.exitCode);
          const r2 = Bun.spawnSync(["ls"]);
          console.log("ls exit:", r2.exitCode);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", "--allow-run=echo,ls", "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("echo exit: 0");
      expect(stdout).toContain("ls exit: 0");
      expect(exitCode).toBe(0);
    });
  });

  describe.concurrent("sys granular kinds", () => {
    test("--allow-sys=hostname allows only hostname", async () => {
      using dir = tempDir("perm-sys-hostname-only", {
        "test.ts": `
          import os from "os";
          console.log("hostname:", os.hostname());
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", "--allow-sys=hostname", "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("hostname:");
      expect(exitCode).toBe(0);
    });

    test("--allow-sys=hostname denies cpus", async () => {
      using dir = tempDir("perm-sys-hostname-deny-cpus", {
        "test.ts": `
          import os from "os";
          try {
            console.log("cpus:", os.cpus()[0].model);
          } catch (e) {
            console.log("ERROR:", e.message);
            process.exit(1);
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", "--allow-sys=hostname", "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout + stderr).toContain("PermissionDenied");
      expect(exitCode).not.toBe(0);
    });

    test("--allow-sys=hostname,cpus allows both", async () => {
      using dir = tempDir("perm-sys-multi", {
        "test.ts": `
          import os from "os";
          console.log("hostname:", os.hostname());
          console.log("cpus:", os.cpus().length);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", "--allow-sys=hostname,cpus", "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("hostname:");
      expect(stdout).toContain("cpus:");
      expect(exitCode).toBe(0);
    });
  });

  describe.concurrent("run command matching", () => {
    test("--allow-run=echo matches /bin/echo (basename)", async () => {
      using dir = tempDir("perm-run-basename", {
        "test.ts": `
          const result = Bun.spawnSync(["echo", "test"]);
          console.log("exit:", result.exitCode);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", "--allow-run=echo", "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("exit: 0");
      expect(exitCode).toBe(0);
    });

    test("--allow-run=/bin/echo matches exact path", async () => {
      using dir = tempDir("perm-run-exact", {
        "test.ts": `
          const result = Bun.spawnSync(["echo", "test"]);
          console.log("exit:", result.exitCode);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", "--allow-run=/bin/echo", "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("exit: 0");
      expect(exitCode).toBe(0);
    });
  });

  describe.concurrent("net host matching", () => {
    test("--allow-net=example.com matches example.com:443", async () => {
      using dir = tempDir("perm-net-host-port", {
        "test.ts": `
          const r = await fetch("https://example.com");
          console.log("status:", r.status);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", "--allow-net=example.com", "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("status: 200");
      expect(exitCode).toBe(0);
    });
  });
});
