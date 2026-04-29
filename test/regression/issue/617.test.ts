import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Test that `bun create` respects custom registry configuration
// Issue: https://github.com/oven-sh/bun/issues/617

// Base env with all registry env vars cleared to prevent CI env interference.
const cleanEnv: NodeJS.Dict<string> = {
  ...bunEnv,
  BUN_CONFIG_REGISTRY: undefined,
  NPM_CONFIG_REGISTRY: undefined,
  npm_config_registry: undefined,
};

// Stub server that returns 500 for all requests, tracking hits to prove
// bun create actually contacted it.
function stubRegistry() {
  const hits = { count: 0 };
  const server = Bun.serve({
    port: 0,
    fetch: () => {
      hits.count++;
      return new Response("stub registry", { status: 500 });
    },
  });
  return { server, url: `http://127.0.0.1:${server.port}`, hits };
}

describe("bun create respects custom registry", () => {
  test(
    "BUN_CONFIG_REGISTRY environment variable",
    async () => {
      const stub = stubRegistry();
      await using server = stub.server;

      using dir = tempDir("bun-create-registry-env", {});

      await using proc = Bun.spawn({
        cmd: [bunExe(), "create", "elysia", "my-app", "--no-install", "--no-git"],
        cwd: String(dir),
        env: {
          ...cleanEnv,
          BUN_CONFIG_REGISTRY: stub.url,
        },
        stderr: "pipe",
        stdout: "pipe",
      });

      await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stub.hits.count).toBeGreaterThan(0);
      expect(await proc.exited).not.toBe(0);
    },
    { timeout: 30_000 },
  );

  test(
    "NPM_CONFIG_REGISTRY environment variable",
    async () => {
      const stub = stubRegistry();
      await using server = stub.server;

      using dir = tempDir("bun-create-npm-registry-env", {});

      await using proc = Bun.spawn({
        cmd: [bunExe(), "create", "elysia", "my-app", "--no-install", "--no-git"],
        cwd: String(dir),
        env: {
          ...cleanEnv,
          NPM_CONFIG_REGISTRY: stub.url,
        },
        stderr: "pipe",
        stdout: "pipe",
      });

      await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stub.hits.count).toBeGreaterThan(0);
      expect(await proc.exited).not.toBe(0);
    },
    { timeout: 30_000 },
  );

  test(
    "npm_config_registry environment variable (lowercase)",
    async () => {
      const stub = stubRegistry();
      await using server = stub.server;

      using dir = tempDir("bun-create-npm-config-registry-lc", {});

      await using proc = Bun.spawn({
        cmd: [bunExe(), "create", "elysia", "my-app", "--no-install", "--no-git"],
        cwd: String(dir),
        env: {
          ...cleanEnv,
          npm_config_registry: stub.url,
        },
        stderr: "pipe",
        stdout: "pipe",
      });

      await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stub.hits.count).toBeGreaterThan(0);
      expect(await proc.exited).not.toBe(0);
    },
    { timeout: 30_000 },
  );

  test(
    "bunfig.toml registry configuration",
    async () => {
      const stub = stubRegistry();
      await using server = stub.server;

      using dir = tempDir("bun-create-bunfig-registry", {
        "bunfig.toml": ["[install]", `registry = "${stub.url}/"`, ""].join("\n"),
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "create", "elysia", "my-app", "--no-install", "--no-git"],
        cwd: String(dir),
        env: cleanEnv,
        stderr: "pipe",
        stdout: "pipe",
      });

      await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stub.hits.count).toBeGreaterThan(0);
      expect(await proc.exited).not.toBe(0);
    },
    { timeout: 30_000 },
  );

  test(
    "bunfig.toml $ENV_VAR registry expansion",
    async () => {
      const stub = stubRegistry();
      await using server = stub.server;

      using dir = tempDir("bun-create-bunfig-env-expansion", {
        "bunfig.toml": ["[install]", `registry = "$TEST_CUSTOM_REGISTRY"`, ""].join("\n"),
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "create", "elysia", "my-app", "--no-install", "--no-git"],
        cwd: String(dir),
        env: {
          ...cleanEnv,
          TEST_CUSTOM_REGISTRY: stub.url,
        },
        stderr: "pipe",
        stdout: "pipe",
      });

      await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stub.hits.count).toBeGreaterThan(0);
      expect(await proc.exited).not.toBe(0);
    },
    { timeout: 30_000 },
  );

  test(
    "BUN_CONFIG_REGISTRY overrides bunfig.toml registry",
    async () => {
      const stub = stubRegistry();
      await using server = stub.server;

      using dir = tempDir("bun-create-env-overrides-bunfig", {
        "bunfig.toml": ["[install]", `registry = "https://registry.npmjs.org/"`, ""].join("\n"),
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "create", "elysia", "my-app", "--no-install", "--no-git"],
        cwd: String(dir),
        env: {
          ...cleanEnv,
          BUN_CONFIG_REGISTRY: stub.url,
        },
        stderr: "pipe",
        stdout: "pipe",
      });

      await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stub.hits.count).toBeGreaterThan(0);
      expect(await proc.exited).not.toBe(0);
    },
    { timeout: 30_000 },
  );
});
