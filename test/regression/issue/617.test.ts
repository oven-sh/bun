import { expect, test, describe } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Test that `bun create` respects custom registry configuration
// Issue: https://github.com/oven-sh/bun/issues/617

describe("bun create respects custom registry", () => {
  test(
    "BUN_CONFIG_REGISTRY environment variable",
    async () => {
      const customRegistry = "http://127.0.0.1:12345";

      using dir = tempDir("bun-create-registry-env", {});

      await using proc = Bun.spawn({
        cmd: [bunExe(), "create", "elysia", "my-app"],
        cwd: String(dir),
        env: {
          ...bunEnv,
          BUN_CONFIG_REGISTRY: customRegistry,
        },
        stderr: "pipe",
        stdout: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // The command should fail because no server is running on 127.0.0.1:12345.
      // If bun ignored the env var and used npmjs.org, it would succeed.
      const output = (stdout + stderr).toLowerCase();
      expect(output).toContain("error");
      expect(exitCode).not.toBe(0);
    },
    { timeout: 30_000 },
  );

  test(
    "NPM_CONFIG_REGISTRY environment variable",
    async () => {
      const customRegistry = "http://127.0.0.1:12346";

      using dir = tempDir("bun-create-npm-registry-env", {});

      await using proc = Bun.spawn({
        cmd: [bunExe(), "create", "elysia", "my-app"],
        cwd: String(dir),
        env: {
          ...bunEnv,
          NPM_CONFIG_REGISTRY: customRegistry,
        },
        stderr: "pipe",
        stdout: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      const output = (stdout + stderr).toLowerCase();
      expect(output).toContain("error");
      expect(exitCode).not.toBe(0);
    },
    { timeout: 30_000 },
  );

  test(
    "bunfig.toml registry configuration",
    async () => {
      const customRegistry = "http://127.0.0.1:12347/";

      using dir = tempDir("bun-create-bunfig-registry", {
        "bunfig.toml": ["[install]", `registry = "${customRegistry}"`, ""].join("\n"),
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "create", "elysia", "my-app"],
        cwd: String(dir),
        env: bunEnv,
        stderr: "pipe",
        stdout: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      const output = (stdout + stderr).toLowerCase();
      expect(output).toContain("error");
      expect(exitCode).not.toBe(0);
    },
    { timeout: 30_000 },
  );

  test(
    "default registry works when no custom registry is set",
    async () => {
      using dir = tempDir("bun-create-default-registry", {});

      await using proc = Bun.spawn({
        cmd: [bunExe(), "create", "elysia", "my-app"],
        cwd: String(dir),
        env: bunEnv,
        stderr: "pipe",
        stdout: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // The command should succeed with the default registry
      expect(stderr).not.toContain("error");
      expect(exitCode).toBe(0);
    },
    { timeout: 60_000 },
  );
});
