import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { writeFile } from "fs/promises";
import { bunEnv as env, bunExe } from "harness";
import { join } from "path";
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
  setDefaultTimeout(1000 * 60 * 5);
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

      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "test-offline",
          version: "1.0.0",
          dependencies: {
            "no-deps": "1.0.0",
          },
        }),
      );

      // Try to install with --offline flag (no cache yet)
      const { stderr, exited } = spawn({
        cmd: [bunExe(), "install", "--offline"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "inherit",
        stderr: "pipe",
        env,
      });

      const err = await stderr.text();
      expect(err).toContain("offline mode");
      expect(await exited).toBe(1);
      // No network requests should have been made
      expect(urls).toBeEmpty();
    });
  });

  it("should work when package is already in cache", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls));

      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "test-offline-cached",
          version: "1.0.0",
          dependencies: {
            "no-deps": "1.0.0",
          },
        }),
      );

      // First install to populate cache
      const { exited: firstExited } = spawn({
        cmd: [bunExe(), "install"],
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
      await Bun.spawn({
        cmd: ["rm", "-rf", "node_modules"],
        cwd: ctx.package_dir,
      }).exited;

      // Now install with --offline flag (should use cache)
      const { stderr, exited } = spawn({
        cmd: [bunExe(), "install", "--offline"],
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

      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "test-offline-env",
          version: "1.0.0",
          dependencies: {
            "no-deps": "1.0.0",
          },
        }),
      );

      // Try to install with BUN_CONFIG_OFFLINE=1 (no cache yet)
      const { stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
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
      expect(err).toContain("offline mode");
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

      // Install with --offline flag
      const proc = spawn({
        cmd: [bunExe(), "install", "--offline"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "inherit",
        stderr: "pipe",
        env,
      });

      await proc.exited;
      // Verify no network requests were made
      expect(networkRequestCount).toBe(0);
    });
  });
});
