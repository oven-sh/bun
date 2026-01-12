import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("bunfig.toml permissions", () => {
  describe.concurrent("basic permissions", () => {
    test("secure = true enables secure mode", async () => {
      using dir = tempDir("perm-bunfig-secure", {
        "bunfig.toml": `
[permissions]
secure = true
no-prompt = true
`,
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
        cmd: [bunExe(), "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout + stderr).toContain("PermissionDenied");
      expect(exitCode).not.toBe(0);
    });

    test("allow-all = true grants all permissions", async () => {
      using dir = tempDir("perm-bunfig-allow-all", {
        "bunfig.toml": `
[permissions]
secure = true
allow-all = true
`,
        "test.ts": `
          console.log("HOME:", process.env.HOME);
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

      expect(stdout).toContain("HOME:");
      expect(exitCode).toBe(0);
    });
  });

  describe.concurrent("allow-env", () => {
    test("allow-env = true allows all env vars", async () => {
      using dir = tempDir("perm-bunfig-env-all", {
        "bunfig.toml": `
[permissions]
secure = true
allow-env = true
`,
        "test.ts": `
          console.log("BUN_TEST_VAR:", process.env.BUN_TEST_VAR);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test.ts"],
        cwd: String(dir),
        env: { ...bunEnv, BUN_TEST_VAR: "hello_from_bunfig" },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("BUN_TEST_VAR: hello_from_bunfig");
      expect(exitCode).toBe(0);
    });

    test("allow-env array allows specific vars", async () => {
      using dir = tempDir("perm-bunfig-env-array", {
        "bunfig.toml": `
[permissions]
secure = true
allow-env = ["BUN_ALLOWED_VAR"]
no-prompt = true
`,
        "test.ts": `
          console.log("BUN_ALLOWED_VAR:", process.env.BUN_ALLOWED_VAR);
          try {
            console.log("BUN_DENIED_VAR:", process.env.BUN_DENIED_VAR);
          } catch (e) {
            console.log("DENIED:", e.message);
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test.ts"],
        cwd: String(dir),
        env: { ...bunEnv, BUN_ALLOWED_VAR: "allowed", BUN_DENIED_VAR: "denied" },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("BUN_ALLOWED_VAR: allowed");
      expect(stdout + stderr).toContain("PermissionDenied");
    });

    test("allow-env string allows single var", async () => {
      using dir = tempDir("perm-bunfig-env-string", {
        "bunfig.toml": `
[permissions]
secure = true
allow-env = "BUN_SINGLE_VAR"
`,
        "test.ts": `
          console.log("BUN_SINGLE_VAR:", process.env.BUN_SINGLE_VAR);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test.ts"],
        cwd: String(dir),
        env: { ...bunEnv, BUN_SINGLE_VAR: "single_value" },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("BUN_SINGLE_VAR: single_value");
      expect(exitCode).toBe(0);
    });
  });

  describe.concurrent("allow-read", () => {
    test("allow-read = true allows all file reads", async () => {
      using dir = tempDir("perm-bunfig-read-all", {
        "bunfig.toml": `
[permissions]
secure = true
allow-read = true
`,
        "data.txt": "hello world",
        "test.ts": `
          const content = await Bun.file("data.txt").text();
          console.log("content:", content);
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

      expect(stdout).toContain("content: hello world");
      expect(exitCode).toBe(0);
    });

    test("allow-read array allows specific paths", async () => {
      using dir = tempDir("perm-bunfig-read-array", {
        "bunfig.toml": "",
        "allowed.txt": "allowed content",
        "denied.txt": "denied content",
        "test.ts": "",
      });

      // Write bunfig with actual path
      await Bun.write(
        `${String(dir)}/bunfig.toml`,
        `
[permissions]
secure = true
allow-read = ["${String(dir)}/allowed.txt"]
no-prompt = true
`,
      );

      await Bun.write(
        `${String(dir)}/test.ts`,
        `
          const allowed = await Bun.file("${String(dir)}/allowed.txt").text();
          console.log("allowed:", allowed);
          try {
            const denied = await Bun.file("${String(dir)}/denied.txt").text();
            console.log("denied:", denied);
          } catch (e) {
            console.log("DENIED:", e.message);
          }
        `,
      );

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("allowed: allowed content");
      expect(stdout + stderr).toContain("PermissionDenied");
    });
  });

  describe.concurrent("deny-* overrides allow-*", () => {
    test("deny-env overrides allow-env", async () => {
      using dir = tempDir("perm-bunfig-deny-env", {
        "bunfig.toml": `
[permissions]
secure = true
allow-env = true
deny-env = ["BUN_SECRET"]
no-prompt = true
`,
        "test.ts": `
          console.log("BUN_PUBLIC:", process.env.BUN_PUBLIC);
          try {
            console.log("BUN_SECRET:", process.env.BUN_SECRET);
          } catch (e) {
            console.log("DENIED:", e.message);
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test.ts"],
        cwd: String(dir),
        env: { ...bunEnv, BUN_PUBLIC: "public", BUN_SECRET: "secret" },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("BUN_PUBLIC: public");
      expect(stdout + stderr).toContain("PermissionDenied");
    });
  });

  describe.concurrent("allow-net", () => {
    test("allow-net array allows specific hosts", async () => {
      using dir = tempDir("perm-bunfig-net", {
        "bunfig.toml": `
[permissions]
secure = true
allow-net = ["example.com"]
`,
        "test.ts": `
          const perm = Bun.permissions.querySync({ name: "net", host: "example.com:443" });
          console.log("example.com:", perm.state);
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

      expect(stdout).toContain("example.com: granted");
      expect(exitCode).toBe(0);
    });
  });

  describe.concurrent("allow-sys", () => {
    test("allow-sys array allows specific kinds", async () => {
      using dir = tempDir("perm-bunfig-sys", {
        "bunfig.toml": `
[permissions]
secure = true
allow-sys = ["hostname"]
`,
        "test.ts": `
          import os from "os";
          console.log("hostname:", os.hostname());
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

      expect(stdout).toContain("hostname:");
      expect(exitCode).toBe(0);
    });
  });

  describe.concurrent("allow-run", () => {
    test("allow-run array allows specific commands", async () => {
      using dir = tempDir("perm-bunfig-run", {
        "bunfig.toml": "",
        "test.ts": `
          const result = Bun.spawnSync([process.execPath, "--version"]);
          console.log("exit:", result.exitCode);
        `,
      });

      // Get bun basename for allow-run
      const bunBasename = bunExe().split("/").pop()?.split("\\").pop() || "bun";

      await Bun.write(
        `${String(dir)}/bunfig.toml`,
        `
[permissions]
secure = true
allow-run = ["${bunBasename}"]
`,
      );

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test.ts"],
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

  describe.concurrent("CLI flags override bunfig", () => {
    test("--allow-all overrides bunfig restrictions", async () => {
      using dir = tempDir("perm-bunfig-override", {
        "bunfig.toml": `
[permissions]
secure = true
no-prompt = true
# No allow-env = script should fail without CLI override
`,
        "test.ts": `
          console.log("BUN_TEST:", process.env.BUN_TEST);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "-A", "test.ts"],
        cwd: String(dir),
        env: { ...bunEnv, BUN_TEST: "override_works" },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("BUN_TEST: override_works");
      expect(exitCode).toBe(0);
    });

    test("--secure flag works without bunfig", async () => {
      using dir = tempDir("perm-cli-secure", {
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

  describe.concurrent("bunfig.json support", () => {
    test("permissions work in bunfig.json", async () => {
      using dir = tempDir("perm-bunfig-json", {
        "bunfig.json": JSON.stringify({
          permissions: {
            secure: true,
            "allow-env": ["BUN_JSON_VAR"],
          },
        }),
        "test.ts": `
          console.log("BUN_JSON_VAR:", process.env.BUN_JSON_VAR);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test.ts"],
        cwd: String(dir),
        env: { ...bunEnv, BUN_JSON_VAR: "json_works" },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("BUN_JSON_VAR: json_works");
      expect(exitCode).toBe(0);
    });
  });
});
