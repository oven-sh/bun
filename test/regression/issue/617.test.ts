import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Test that `bun create` respects custom registry configuration
// Issue: https://github.com/oven-sh/bun/issues/617

test(
  "bun create respects BUN_CONFIG_REGISTRY environment variable",
  async () => {
    // Use localhost on a port that doesn't exist to verify bun tries to connect there
    // instead of the default registry.npmjs.org
    const customRegistry = "http://127.0.0.1:12345";

    using dir = tempDir("bun-create-test", {
      // Empty directory for creating the app
    });

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

    // The command should fail because no server is running on 127.0.0.1:12345
    const output = stdout + stderr;

    // Verify we got a connection error (not a 404 from npmjs.org)
    // ConnectionRefused means it tried to connect to our custom registry
    expect(output.toLowerCase()).toContain("error");
    expect(exitCode).not.toBe(0);
  },
  { timeout: 30000 },
);

test(
  "bun create respects NPM_CONFIG_REGISTRY environment variable",
  async () => {
    const customRegistry = "http://127.0.0.1:12346";

    using dir = tempDir("bun-create-npm-test", {});

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

    // The command should fail because no server is running on our custom port
    const output = stdout + stderr;
    expect(output.toLowerCase()).toContain("error");
    expect(exitCode).not.toBe(0);
  },
  { timeout: 30000 },
);

test(
  "bun create respects bunfig.toml registry configuration",
  async () => {
    const customRegistry = "http://127.0.0.1:12347/";

    using dir = tempDir("bun-create-bunfig-test", {
      "bunfig.toml": `[install]
registry = "${customRegistry}"
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "create", "elysia", "my-app"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The command should fail because no server is running on our custom port
    const output = stdout + stderr;
    expect(output.toLowerCase()).toContain("error");
    expect(exitCode).not.toBe(0);
  },
  { timeout: 30000 },
);

test(
  "bun create works with default registry when no custom registry is set",
  async () => {
    using dir = tempDir("bun-create-default-test", {});

    await using proc = Bun.spawn({
      cmd: [bunExe(), "create", "elysia", "my-app"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The command should succeed with the default registry
    expect(exitCode).toBe(0);
  },
  { timeout: 60000 },
);
