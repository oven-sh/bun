import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { rm, writeFile } from "fs/promises";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

// Create a clean environment without npm registry overrides
// This ensures bunfig.toml settings are respected
function createCleanEnv(): NodeJS.Dict<string> {
  const cleanEnv = { ...bunEnv };
  // Delete all npm/bun registry-related env vars that could override bunfig.toml
  delete cleanEnv.npm_config_registry;
  delete cleanEnv.NPM_CONFIG_REGISTRY;
  delete cleanEnv.BUN_CONFIG_REGISTRY;
  // Also delete any global cache settings that could interfere
  delete cleanEnv.BUN_INSTALL_CACHE_DIR;
  delete cleanEnv.npm_config_cache;
  // Clear offline env overrides to keep tests deterministic
  delete cleanEnv.BUN_CONFIG_OFFLINE;
  delete cleanEnv.BUN_CONFIG_PREFER_OFFLINE;
  return cleanEnv;
}
const env = createCleanEnv();
import {
  createTestContext,
  destroyTestContext,
  dummyAfterAll,
  dummyBeforeAll,
  dummyRegistryForContext,
  setContextHandler,
  type TestContext,
} from "./dummy.registry.js";

beforeAll(() => {
  dummyBeforeAll();
});

afterAll(dummyAfterAll);

// Helper function that sets up test context and ensures cleanup
async function withContext(
  opts: { linker?: "hoisted" | "isolated" } | undefined,
  fn: (ctx: TestContext) => Promise<void>,
): Promise<void> {
  const ctx = await createTestContext(opts ? { linker: opts.linker! } : undefined);
  try {
    await fn(ctx);
  } finally {
    destroyTestContext(ctx);
  }
}

const defaultOpts = { linker: "hoisted" as const };

describe("bun install --offline", () => {
  it("should fail when package is not in cache", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));

      // Use a fresh cache directory and mock registry
      const cacheDir = join(ctx.package_dir, ".bun-cache-empty");
      const bunfigPath = join(ctx.package_dir, "bunfig.toml");
      const bunfigContent = `
[install]
cache = "${cacheDir}"
registry = "${ctx.registry_url}"
saveTextLockfile = false
linker = "hoisted"
`;
      await writeFile(bunfigPath, bunfigContent);

      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "test-offline",
          version: "1.0.0",
          dependencies: {
            "bar": "0.0.2",
          },
        }),
      );

      // Try to install with --offline flag (no cache yet)
      const { stderr, exited } = spawn({
        cmd: [bunExe(), "install", "--offline", `--config=${bunfigPath}`],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "inherit",
        stderr: "pipe",
        env,
      });

      const err = await stderr.text();
      // In offline mode with empty cache, should fail (either "offline mode" or "No version")
      expect(err).toMatch(/offline mode|No version matching|failed to resolve/);
      expect(await exited).toBe(1);
      // No network requests should have been made in offline mode
      expect(urls).toBeEmpty();
    });
  });

  it("should work when package is already in cache", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));

      // Override bunfig.toml to enable caching for this test
      const cacheDir = join(ctx.package_dir, ".bun-cache");
      const bunfigPath = join(ctx.package_dir, "bunfig.toml");
      const bunfigContent = `
[install]
cache = "${cacheDir}"
registry = "${ctx.registry_url}"
saveTextLockfile = false
linker = "hoisted"
`;
      await writeFile(bunfigPath, bunfigContent);

      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "test-offline-cached",
          version: "1.0.0",
          dependencies: {
            bar: "", // Empty string means "latest", mock registry returns 0.0.2
          },
        }),
      );

      // First install to populate cache
      // Use --registry flag to ensure mock registry is used (overrides all other settings)
      const { exited: firstExited } = spawn({
        cmd: [bunExe(), "install", `--registry=${ctx.registry_url}`, `--config=${bunfigPath}`],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "inherit",
        stderr: "pipe",
        env,
      });
      expect(await firstExited).toBe(0);

      const urlCountAfterFirstInstall = urls.length;
      expect(urlCountAfterFirstInstall).toBeGreaterThan(0);

      // Remove node_modules to force reinstall
      await rm(join(ctx.package_dir, "node_modules"), { recursive: true, force: true });

      // Now install with --offline flag (should use cache)
      const { exited } = spawn({
        cmd: [bunExe(), "install", "--offline", `--config=${bunfigPath}`],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "inherit",
        stderr: "pipe",
        env,
      });

      expect(await exited).toBe(0);
      // No additional network requests should have been made
      expect(urls.length).toBe(urlCountAfterFirstInstall);
    });
  });

  it("should work with BUN_CONFIG_OFFLINE environment variable", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));

      // Use a fresh cache directory and mock registry
      const cacheDir = join(ctx.package_dir, ".bun-cache-env");
      const bunfigPath = join(ctx.package_dir, "bunfig.toml");
      const bunfigContent = `
[install]
cache = "${cacheDir}"
registry = "${ctx.registry_url}"
saveTextLockfile = false
linker = "hoisted"
`;
      await writeFile(bunfigPath, bunfigContent);

      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "test-offline-env",
          version: "1.0.0",
          dependencies: {
            "bar": "0.0.2",
          },
        }),
      );

      // Try to install with BUN_CONFIG_OFFLINE=1 (no cache yet)
      const { stderr, exited } = spawn({
        cmd: [bunExe(), "install", `--config=${bunfigPath}`],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "inherit",
        stderr: "pipe",
        env: {
          ...env,
          BUN_CONFIG_OFFLINE: "1",
        },
      });

      const err = await stderr.text();
      // In offline mode with empty cache, should fail (either "offline mode" or "No version")
      expect(err).toMatch(/offline mode|No version matching|failed to resolve/);
      expect(await exited).toBe(1);
      expect(urls).toBeEmpty();
    });
  });

  it("should not make network requests in offline mode", async () => {
    await withContext(defaultOpts, async ctx => {
      let networkRequestCount = 0;
      setContextHandler(ctx, async () => {
        networkRequestCount++;
        return new Response("Not found", { status: 404 });
      });

      // Configure bunfig.toml to point to mock registry
      const cacheDir = join(ctx.package_dir, ".bun-cache-no-network");
      const bunfigPath = join(ctx.package_dir, "bunfig.toml");
      const bunfigContent = `
[install]
cache = "${cacheDir}"
registry = "${ctx.registry_url}"
saveTextLockfile = false
linker = "hoisted"
`;
      await writeFile(bunfigPath, bunfigContent);

      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "test-offline-no-network",
          version: "1.0.0",
          dependencies: {
            "some-package": "1.0.0",
          },
        }),
      );

      // Install with --offline flag (bound to mock registry via bunfig)
      const proc = spawn({
        cmd: [bunExe(), "install", "--offline", `--config=${bunfigPath}`],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "inherit",
        stderr: "pipe",
        env,
      });

      await proc.exited;
      // Verify no network requests were made to the mock registry
      expect(networkRequestCount).toBe(0);
    });
  });
});
