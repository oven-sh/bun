import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { rm, writeFile } from "fs/promises";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

// Convert paths to forward slashes for TOML compatibility (Windows backslashes are escape chars)
const tomlPath = (p: string) => p.replaceAll("\\", "/");

// Create a clean environment without npm registry overrides
function createCleanEnv(): NodeJS.Dict<string> {
  const cleanEnv = { ...bunEnv };
  delete cleanEnv.npm_config_registry;
  delete cleanEnv.NPM_CONFIG_REGISTRY;
  delete cleanEnv.BUN_CONFIG_REGISTRY;
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

async function withContext(
  opts: { linker?: "hoisted" | "isolated" } | undefined,
  fn: (ctx: TestContext) => Promise<void>,
): Promise<void> {
  const ctx = await createTestContext(opts?.linker ? { linker: opts.linker } : undefined);
  try {
    await fn(ctx);
  } finally {
    destroyTestContext(ctx);
  }
}

const defaultOpts = { linker: "hoisted" as const };

describe("bun install --prefer-offline", () => {
  it("should use cached packages without network when available", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));

      const cacheDir = join(ctx.package_dir, ".bun-cache");
      const bunfigPath = join(ctx.package_dir, "bunfig.toml");
      const bunfigContent = `
[install]
cache = "${tomlPath(cacheDir)}"
registry = "${ctx.registry_url}"
saveTextLockfile = false
linker = "hoisted"
`;
      await writeFile(bunfigPath, bunfigContent);

      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "test-prefer-offline",
          version: "1.0.0",
          dependencies: {
            bar: "",
          },
        }),
      );

      // First install to populate cache
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

      // Install with --prefer-offline (should use cache, no network)
      const { exited } = spawn({
        cmd: [bunExe(), "install", "--prefer-offline", `--config=${bunfigPath}`],
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

  it("should fall back to network when package is not in cache", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));

      const cacheDir = join(ctx.package_dir, ".bun-cache");
      const bunfigPath = join(ctx.package_dir, "bunfig.toml");
      const bunfigContent = `
[install]
cache = "${tomlPath(cacheDir)}"
registry = "${ctx.registry_url}"
saveTextLockfile = false
linker = "hoisted"
`;
      await writeFile(bunfigPath, bunfigContent);

      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "test-prefer-offline-fallback",
          version: "1.0.0",
          dependencies: {
            bar: "0.0.2",
          },
        }),
      );

      // Install with --prefer-offline (cache is empty, should fetch from network)
      const { exited, stderr } = spawn({
        cmd: [bunExe(), "install", "--prefer-offline", `--registry=${ctx.registry_url}`, `--config=${bunfigPath}`],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "inherit",
        stderr: "pipe",
        env,
      });

      const err = await stderr.text();
      expect(err).not.toContain("error:");
      expect(await exited).toBe(0);
      // Network requests should have been made (fell back to network)
      expect(urls.length).toBeGreaterThan(0);
    });
  });

  it("should work with BUN_CONFIG_PREFER_OFFLINE environment variable", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));

      const cacheDir = join(ctx.package_dir, ".bun-cache");
      const bunfigPath = join(ctx.package_dir, "bunfig.toml");
      const bunfigContent = `
[install]
cache = "${tomlPath(cacheDir)}"
registry = "${ctx.registry_url}"
saveTextLockfile = false
linker = "hoisted"
`;
      await writeFile(bunfigPath, bunfigContent);

      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "test-prefer-offline-env",
          version: "1.0.0",
          dependencies: {
            bar: "",
          },
        }),
      );

      // First install to populate cache
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

      // Remove node_modules
      await rm(join(ctx.package_dir, "node_modules"), { recursive: true, force: true });

      // Install with BUN_CONFIG_PREFER_OFFLINE=1
      const { exited } = spawn({
        cmd: [bunExe(), "install", `--config=${bunfigPath}`],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "inherit",
        stderr: "pipe",
        env: {
          ...env,
          BUN_CONFIG_PREFER_OFFLINE: "1",
        },
      });

      expect(await exited).toBe(0);
      // No additional network requests
      expect(urls.length).toBe(urlCountAfterFirstInstall);
    });
  });

  it("should work with bunfig.toml preferOffline setting", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));

      const cacheDir = join(ctx.package_dir, ".bun-cache");
      const bunfigPath = join(ctx.package_dir, "bunfig.toml");

      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "test-prefer-offline-bunfig",
          version: "1.0.0",
          dependencies: {
            bar: "",
          },
        }),
      );

      // First install without preferOffline to populate cache
      const bunfigContentFirst = `
[install]
cache = "${tomlPath(cacheDir)}"
registry = "${ctx.registry_url}"
saveTextLockfile = false
linker = "hoisted"
`;
      await writeFile(bunfigPath, bunfigContentFirst);

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

      // Remove node_modules
      await rm(join(ctx.package_dir, "node_modules"), { recursive: true, force: true });

      // Update bunfig.toml with preferOffline = true
      const bunfigContentWithPreferOffline = `
[install]
cache = "${tomlPath(cacheDir)}"
registry = "${ctx.registry_url}"
saveTextLockfile = false
linker = "hoisted"
preferOffline = true
`;
      await writeFile(bunfigPath, bunfigContentWithPreferOffline);

      // Install again (should use cache due to preferOffline)
      const { exited } = spawn({
        cmd: [bunExe(), "install", `--config=${bunfigPath}`],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "inherit",
        stderr: "pipe",
        env,
      });

      expect(await exited).toBe(0);
      // No additional network requests
      expect(urls.length).toBe(urlCountAfterFirstInstall);
    });
  });
});
