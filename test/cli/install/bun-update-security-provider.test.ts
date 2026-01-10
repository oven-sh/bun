import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
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

// Helper function to write to package_dir
async function write(ctx: TestContext, path: string, content: string | object) {
  await Bun.write(join(ctx.package_dir, path), typeof content === "string" ? content : JSON.stringify(content));
}

describe.concurrent("Security Scanner for bun update", () => {
  test("security scanner blocks bun update on fatal advisory", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "0.1.0": {},
          "0.2.0": {},
        }),
      );

      const scannerCode = `
    export const scanner = {
      version: "1",
      scan: async ({ packages }) => {
        if (packages.length === 0) return [];
        return [
          {
            package: "moo",
            description: "Fatal security issue detected",
            level: "fatal",
            url: "https://example.com/critical",
          },
        ];
      },
    };
  `;

      await write(ctx, "./scanner.ts", scannerCode);
      await write(ctx, "package.json", {
        name: "my-app",
        version: "1.0.0",
        dependencies: {
          moo: "0.1.0",
        },
      });

      // First install without security scanning (to have something to update)
      await using installProc = Bun.spawn({
        cmd: [bunExe(), "install", "--no-summary"],
        env: bunEnv,
        cwd: ctx.package_dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      await installProc.stdout.text();
      await installProc.stderr.text();
      await installProc.exited;

      await write(
        ctx,
        "./bunfig.toml",
        `
[install]
saveTextLockfile = false

[install.security]
scanner = "./scanner.ts"
`,
      );

      await using updateProc = Bun.spawn({
        cmd: [bunExe(), "update", "moo"],
        env: bunEnv,
        cwd: ctx.package_dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [updateOut, updateErr, updateExitCode] = await Promise.all([
        updateProc.stdout.text(),
        updateProc.stderr.text(),
        updateProc.exited,
      ]);

      expect(updateOut).toContain("FATAL: moo");
      expect(updateOut).toContain("Fatal security issue detected");
      expect(updateOut).toContain("Installation aborted due to fatal security advisories");

      expect(updateExitCode).toBe(1);
    });
  });

  test("security scanner does not run on bun update when disabled", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "0.1.0": {},
          "0.2.0": {},
        }),
      );

      await write(ctx, "package.json", {
        name: "my-app",
        version: "1.0.0",
        dependencies: {
          moo: "0.1.0",
        },
      });

      // Remove bunfig.toml to ensure no security scanner
      await write(ctx, "bunfig.toml", "");

      await using installProc = Bun.spawn({
        cmd: [bunExe(), "install", "--no-summary"],
        env: bunEnv,
        cwd: ctx.package_dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      await installProc.stdout.text();
      await installProc.stderr.text();
      await installProc.exited;

      await using updateProc = Bun.spawn({
        cmd: [bunExe(), "update", "moo"],
        env: bunEnv,
        cwd: ctx.package_dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [updateOut, updateErr, updateExitCode] = await Promise.all([
        updateProc.stdout.text(),
        updateProc.stderr.text(),
        updateProc.exited,
      ]);

      expect(updateOut).not.toContain("Security scanner");
      expect(updateOut).not.toContain("WARN:");
      expect(updateOut).not.toContain("FATAL:");

      expect(updateExitCode).toBe(0);
    });
  });
});
