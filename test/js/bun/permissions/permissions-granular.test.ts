import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

describe("Granular permissions", () => {
  describe.concurrent("env wildcards", () => {
    test("--allow-env=BUN_TEST_* allows matching env vars", async () => {
      using dir = tempDir("perm-env-wildcard", {
        "test.ts": `
          console.log("BUN_TEST_VAR1:", process.env.BUN_TEST_VAR1);
          console.log("BUN_TEST_VAR2:", process.env.BUN_TEST_VAR2);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", "--allow-env=BUN_TEST_*", "test.ts"],
        cwd: String(dir),
        env: { ...bunEnv, BUN_TEST_VAR1: "value1", BUN_TEST_VAR2: "value2" },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("BUN_TEST_VAR1: value1");
      expect(stdout).toContain("BUN_TEST_VAR2: value2");
      expect(exitCode).toBe(0);
    });

    test("--allow-env=BUN_TEST_* denies OTHER_VAR", async () => {
      using dir = tempDir("perm-env-wildcard-deny", {
        "test.ts": `
          try {
            console.log("OTHER_VAR:", process.env.OTHER_VAR);
          } catch (e) {
            console.log("ERROR:", e.message);
            process.exit(1);
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", "--no-prompt", "--allow-env=BUN_TEST_*", "test.ts"],
        cwd: String(dir),
        env: { ...bunEnv, OTHER_VAR: "other_value" },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout + stderr).toContain("PermissionDenied");
      expect(exitCode).not.toBe(0);
    });
  });

  describe.concurrent("multiple values", () => {
    test("--allow-env=VAR1,VAR2,VAR3 allows all three", async () => {
      using dir = tempDir("perm-env-multi", {
        "test.ts": `
          console.log("VAR1:", process.env.VAR1);
          console.log("VAR2:", process.env.VAR2);
          console.log("VAR3:", process.env.VAR3);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", "--allow-env=VAR1,VAR2,VAR3", "test.ts"],
        cwd: String(dir),
        env: { ...bunEnv, VAR1: "a", VAR2: "b", VAR3: "c" },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("VAR1: a");
      expect(stdout).toContain("VAR2: b");
      expect(stdout).toContain("VAR3: c");
      expect(exitCode).toBe(0);
    });

    test("--allow-net=example.com,httpbin.org allows both hosts", async () => {
      using dir = tempDir("perm-net-multi", {
        "test.ts": `
          // Use querySync to check permissions without making actual network requests
          const perm1 = Bun.permissions.querySync({ name: "net", host: "example.com:443" });
          const perm2 = Bun.permissions.querySync({ name: "net", host: "httpbin.org:443" });
          console.log("example.com:", perm1.state);
          console.log("httpbin.org:", perm2.state);
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

      expect(stdout).toContain("example.com: granted");
      expect(stdout).toContain("httpbin.org: granted");
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
    test("--allow-run=<basename> matches spawned process", async () => {
      // Use bun itself for cross-platform testing
      using dir = tempDir("perm-run-basename", {
        "test.ts": `
          const result = Bun.spawnSync([process.execPath, "--version"]);
          console.log("exit:", result.exitCode);
        `,
      });

      // Get the basename of the bun executable for the allow-run flag
      const bunBasename = bunExe().split("/").pop()?.split("\\").pop() || "bun";

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", `--allow-run=${bunBasename}`, "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("exit: 0");
      expect(exitCode).toBe(0);
    });

    test("--allow-run=<exact-path> matches spawned process", async () => {
      // Use bun itself for cross-platform testing
      using dir = tempDir("perm-run-exact", {
        "test.ts": `
          const result = Bun.spawnSync([process.execPath, "--version"]);
          console.log("exit:", result.exitCode);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--secure", `--allow-run=${bunExe()}`, "test.ts"],
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
          // Use querySync to check permissions without making actual network requests
          const perm = Bun.permissions.querySync({ name: "net", host: "example.com:443" });
          console.log("permission:", perm.state);
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

      expect(stdout).toContain("permission: granted");
      expect(exitCode).toBe(0);
    });
  });
});
