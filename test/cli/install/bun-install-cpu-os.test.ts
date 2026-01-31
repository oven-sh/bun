import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { rm, writeFile } from "fs/promises";
import { bunEnv, bunExe, readdirSorted, toMatchNodeModulesAt } from "harness";
import { join } from "path";
import {
  createTestContext,
  destroyTestContext,
  dummyAfterAll,
  dummyBeforeAll,
  dummyRegistryForContext,
  setContextHandler,
  type TestContext,
} from "./dummy.registry";

expect.extend({
  toMatchNodeModulesAt,
});

beforeAll(() => {
  setDefaultTimeout(1000 * 60 * 5);
  dummyBeforeAll();
});
afterAll(dummyAfterAll);

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

describe.concurrent("bun install --cpu and --os flags", () => {
  it("should filter dependencies by CPU architecture", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "1.0.0": {
            cpu: ["x64"],
          },
        }),
      );

      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "test-cpu-filter",
          version: "1.0.0",
          dependencies: {
            "dep-x64-only": "1.0.0",
          },
        }),
      );

      // Install with arm64 CPU - should skip the x64-only dependency
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install", "--cpu", "arm64"],
        cwd: ctx.package_dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await exited;
      expect(exitCode).toBe(0);

      // The package should not be installed
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache"]);

      // Install with x64 CPU - should install the dependency
      await rm(join(ctx.package_dir, "node_modules"), { recursive: true, force: true });
      await rm(join(ctx.package_dir, "bun.lockb"), { force: true });

      const { exited: exited2 } = spawn({
        cmd: [bunExe(), "install", "--cpu", "x64"],
        cwd: ctx.package_dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode2 = await exited2;
      expect(exitCode2).toBe(0);

      // The package should be installed
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "dep-x64-only"]);
    });
  });

  it("should filter dependencies by OS", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "1.0.0": {
            os: ["linux"],
          },
        }),
      );

      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "test-os-filter",
          version: "1.0.0",
          dependencies: {
            "dep-linux-only": "1.0.0",
          },
        }),
      );

      // Install with darwin OS - should skip the linux-only dependency
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install", "--os", "darwin"],
        cwd: ctx.package_dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await exited;
      expect(exitCode).toBe(0);

      // The package should not be installed
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache"]);

      // Install with linux OS - should install the dependency
      await rm(join(ctx.package_dir, "node_modules"), { recursive: true, force: true });
      await rm(join(ctx.package_dir, "bun.lockb"), { force: true });

      const { exited: exited2 } = spawn({
        cmd: [bunExe(), "install", "--os", "linux"],
        cwd: ctx.package_dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode2 = await exited2;
      expect(exitCode2).toBe(0);

      // The package should be installed
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "dep-linux-only"]);
    });
  });

  it("should filter dependencies by both CPU and OS", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "1.0.0": {
            cpu: ["arm64"],
            os: ["darwin"],
          },
          "2.0.0": {
            cpu: ["x64"],
            os: ["linux"],
          },
          "3.0.0": {},
        }),
      );

      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "test-cpu-os-filter",
          version: "1.0.0",
          optionalDependencies: {
            "dep-darwin-arm64": "1.0.0",
            "dep-linux-x64": "2.0.0",
            "dep-universal": "3.0.0",
          },
        }),
      );

      // Install with linux/x64 - should only install linux-x64 and universal deps
      const { exited } = spawn({
        cmd: [bunExe(), "install", "--cpu", "x64", "--os", "linux"],
        cwd: ctx.package_dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await exited;
      expect(exitCode).toBe(0);

      // Check which packages were installed
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([
        ".cache",
        "dep-linux-x64",
        "dep-universal",
      ]);
    });
  });

  it("should handle multiple CPU architectures in package metadata", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "1.0.0": {
            cpu: ["x64", "arm64"],
          },
        }),
      );

      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "test-multi-cpu",
          version: "1.0.0",
          dependencies: {
            "dep-multi-cpu": "1.0.0",
          },
        }),
      );

      // Install with arm64 - should install since arm64 is in the list
      const { exited } = spawn({
        cmd: [bunExe(), "install", "--cpu", "arm64"],
        cwd: ctx.package_dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await exited;
      expect(exitCode).toBe(0);

      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "dep-multi-cpu"]);
    });
  });

  it("should error on invalid CPU architecture", async () => {
    await withContext(defaultOpts, async ctx => {
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "test-invalid-cpu",
          version: "1.0.0",
          dependencies: {},
        }),
      );

      const { stderr, exited } = spawn({
        cmd: [bunExe(), "install", "--cpu", "invalid-cpu"],
        cwd: ctx.package_dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await exited;
      const stderrText = await stderr.text();

      expect(exitCode).toBe(1);
      expect(stderrText).toContain("Invalid CPU architecture");
      expect(stderrText).toContain("invalid-cpu");
    });
  });

  it("should error on invalid OS", async () => {
    await withContext(defaultOpts, async ctx => {
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "test-invalid-os",
          version: "1.0.0",
          dependencies: {},
        }),
      );

      const { stderr, exited } = spawn({
        cmd: [bunExe(), "install", "--os", "invalid-os"],
        cwd: ctx.package_dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await exited;
      const stderrText = await stderr.text();

      expect(exitCode).toBe(1);
      expect(stderrText).toContain("Invalid operating system");
      expect(stderrText).toContain("invalid-os");
    });
  });

  it("should skip installing packages with negated CPU/OS", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "1.0.0": {
            cpu: ["!arm64"],
          },
          "2.0.0": {
            os: ["!linux"],
          },
        }),
      );

      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "test-negated",
          version: "1.0.0",
          optionalDependencies: {
            "dep-not-arm64": "1.0.0",
            "dep-not-linux": "2.0.0",
          },
        }),
      );

      // Install with arm64 - should skip dep-not-arm64
      const { exited } = spawn({
        cmd: [bunExe(), "install", "--cpu", "arm64", "--os", "darwin"],
        cwd: ctx.package_dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await exited;
      expect(exitCode).toBe(0);

      // Should skip dep-not-arm64 and install dep-not-linux
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "dep-not-linux"]);
    });
  });

  it("should support multiple CPU architectures", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "1.0.0": {
            cpu: ["x64"],
          },
          "2.0.0": {
            cpu: ["arm64"],
          },
          "3.0.0": {
            cpu: ["ppc64"],
          },
        }),
      );

      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "test-multiple-cpu",
          version: "1.0.0",
          optionalDependencies: {
            "dep-x64": "1.0.0",
            "dep-arm64": "2.0.0",
            "dep-ppc64": "3.0.0",
          },
        }),
      );

      // Install with multiple CPU architectures - should install both x64 and arm64 deps
      const { exited } = spawn({
        cmd: [bunExe(), "install", "--cpu", "x64", "--cpu", "arm64"],
        cwd: ctx.package_dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await exited;
      expect(exitCode).toBe(0);

      // Should install x64 and arm64 deps, skip ppc64
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "dep-arm64", "dep-x64"]);
    });
  });

  it("should support multiple operating systems", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "1.0.0": {
            os: ["linux"],
          },
          "2.0.0": {
            os: ["darwin"],
          },
          "3.0.0": {
            os: ["win32"],
          },
        }),
      );

      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "test-multiple-os",
          version: "1.0.0",
          optionalDependencies: {
            "dep-linux": "1.0.0",
            "dep-darwin": "2.0.0",
            "dep-win32": "3.0.0",
          },
        }),
      );

      // Install with multiple OS - should install both linux and darwin deps
      const { exited } = spawn({
        cmd: [bunExe(), "install", "--os", "linux", "--os", "darwin"],
        cwd: ctx.package_dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await exited;
      expect(exitCode).toBe(0);

      // Should install linux and darwin deps, skip win32
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "dep-darwin", "dep-linux"]);
    });
  });

  it("should support multiple CPU and OS combinations", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "1.0.0": {
            cpu: ["x64"],
            os: ["linux"],
          },
          "2.0.0": {
            cpu: ["arm64"],
            os: ["darwin"],
          },
          "3.0.0": {
            cpu: ["x64"],
            os: ["darwin"],
          },
          "4.0.0": {
            cpu: ["arm64"],
            os: ["linux"],
          },
        }),
      );

      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "test-multiple-combo",
          version: "1.0.0",
          optionalDependencies: {
            "dep-x64-linux": "1.0.0",
            "dep-arm64-darwin": "2.0.0",
            "dep-x64-darwin": "3.0.0",
            "dep-arm64-linux": "4.0.0",
          },
        }),
      );

      // Install with multiple CPU and OS - should match any combination
      const { exited } = spawn({
        cmd: [bunExe(), "install", "--cpu", "x64", "--cpu", "arm64", "--os", "linux"],
        cwd: ctx.package_dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await exited;
      expect(exitCode).toBe(0);

      // Should install packages that match (x64 OR arm64) AND linux
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([
        ".cache",
        "dep-arm64-linux",
        "dep-x64-linux",
      ]);
    });
  });

  it("should support * wildcard for all architectures", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "1.0.0": {
            cpu: ["x64"],
          },
          "2.0.0": {
            cpu: ["arm64"],
          },
          "3.0.0": {
            cpu: ["ppc64"],
          },
        }),
      );

      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "test-wildcard-cpu",
          version: "1.0.0",
          optionalDependencies: {
            "dep-x64": "1.0.0",
            "dep-arm64": "2.0.0",
            "dep-ppc64": "3.0.0",
          },
        }),
      );

      // Install with * wildcard - should install all packages regardless of CPU
      const { exited } = spawn({
        cmd: [bunExe(), "install", "--cpu", "*"],
        cwd: ctx.package_dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await exited;
      expect(exitCode).toBe(0);

      // Should install all CPU-specific deps
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([
        ".cache",
        "dep-arm64",
        "dep-ppc64",
        "dep-x64",
      ]);
    });
  });

  it("should support * wildcard for all operating systems", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "1.0.0": {
            os: ["linux"],
          },
          "2.0.0": {
            os: ["darwin"],
          },
          "3.0.0": {
            os: ["win32"],
          },
        }),
      );

      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "test-wildcard-os",
          version: "1.0.0",
          optionalDependencies: {
            "dep-linux": "1.0.0",
            "dep-darwin": "2.0.0",
            "dep-win32": "3.0.0",
          },
        }),
      );

      // Install with * wildcard - should install all packages regardless of OS
      const { exited } = spawn({
        cmd: [bunExe(), "install", "--os", "*"],
        cwd: ctx.package_dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await exited;
      expect(exitCode).toBe(0);

      // Should install all OS-specific deps
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([
        ".cache",
        "dep-darwin",
        "dep-linux",
        "dep-win32",
      ]);
    });
  });

  it("should support negation with ! prefix", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "1.0.0": {
            cpu: ["x64"],
          },
          "2.0.0": {
            cpu: ["arm64"],
          },
          "3.0.0": {
            cpu: ["ppc64"],
          },
        }),
      );

      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "test-negation",
          version: "1.0.0",
          optionalDependencies: {
            "dep-x64": "1.0.0",
            "dep-arm64": "2.0.0",
            "dep-ppc64": "3.0.0",
          },
        }),
      );

      // Install with negation - exclude x64 packages
      const { exited } = spawn({
        cmd: [bunExe(), "install", "--cpu", "*", "--cpu", "!x64"],
        cwd: ctx.package_dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await exited;
      expect(exitCode).toBe(0);

      // Should skip x64 dep and install other CPU deps
      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "dep-arm64", "dep-ppc64"]);
    });
  });
});
