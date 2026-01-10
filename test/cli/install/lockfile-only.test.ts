import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { access, writeFile } from "fs/promises";
import { bunExe, bunEnv as env } from "harness";
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

// Default context options for most tests
const defaultOpts = { linker: "hoisted" as const };

describe.concurrent("lockfile-only", () => {
  for (const lockfile of ["bun.lockb", "bun.lock"]) {
    it(`should not download tarballs with --lockfile-only using ${lockfile}`, async () => {
      await withContext(defaultOpts, async ctx => {
        const isLockb = lockfile === "bun.lockb";

        const urls: string[] = [];
        const registry = { "0.0.1": { as: "0.0.1" }, latest: "0.0.1" };

        setContextHandler(ctx, dummyRegistryForContext(ctx, urls, registry));

        await writeFile(
          join(ctx.package_dir, "package.json"),
          JSON.stringify({
            name: "foo",
            dependencies: {
              baz: "0.0.1",
            },
          }),
        );

        const cmd = [bunExe(), "install", "--lockfile-only"];

        if (!isLockb) {
          // the default beforeEach disables --save-text-lockfile in the dummy registry, so we should restore
          // default behaviour
          await writeFile(
            join(ctx.package_dir, "bunfig.toml"),
            `
      [install]
      cache = false
      registry = "${ctx.registry_url}"
      `,
          );
        }

        const { stdout, stderr, exited } = spawn({
          cmd,
          cwd: ctx.package_dir,
          stdout: "pipe",
          stderr: "pipe",
          env,
        });

        const err = await stderr.text();
        const out = await stdout.text();

        expect(err).not.toContain("error:");
        expect(err).toContain("Saved lockfile");

        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          expect.stringContaining("bun install v1."),
          "",
          expect.stringContaining(`Saved ${lockfile}`),
        ]);

        expect(urls.sort()).toEqual([`${ctx.registry_url}baz`]);
        expect(ctx.requested).toBe(1);

        await access(join(ctx.package_dir, lockfile));
        expect(await exited).toBe(0);
      });
    });
  }
});
