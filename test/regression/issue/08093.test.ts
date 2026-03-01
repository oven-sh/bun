import { file, spawn } from "bun";
import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { access, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, readdirSorted } from "harness";
import { join } from "path";
import {
  createTestContext,
  destroyTestContext,
  dummyAfterAll,
  dummyBeforeAll,
  dummyRegistryForContext,
  setContextHandler,
  type TestContext,
} from "./../../cli/install/dummy.registry";

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

describe.concurrent("issue-08093", () => {
  it("should install vendored node_modules with hardlink", async () => {
    await withContext(defaultOpts, async ctx => {
      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, {
          "0.0.1": {},
          latest: "0.0.1",
        }),
      );
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
          dependencies: {
            "vendor-baz": "0.0.1",
          },
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install", "--backend", "hardlink", "--linker=hoisted"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });

      expect(stderr).toBeDefined();
      const err = await stderr.text();
      expect(err).toContain("Saved lockfile");
      expect(stdout).toBeDefined();
      const out = await stdout.text();
      expect(out).toContain("1 package installed");

      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([`${ctx.registry_url}vendor-baz`, `${ctx.registry_url}vendor-baz-0.0.1.tgz`]);
      expect(ctx.requested).toBe(2);

      expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "vendor-baz"]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "vendor-baz"))).toEqual([
        "cjs",
        "index.js",
        "package.json",
      ]);
      expect(await readdirSorted(join(ctx.package_dir, "node_modules", "vendor-baz", "cjs", "node_modules"))).toEqual([
        "foo-dep",
      ]);
      expect(
        await readdirSorted(join(ctx.package_dir, "node_modules", "vendor-baz", "cjs", "node_modules", "foo-dep")),
      ).toEqual(["index.js"]);

      expect(await file(join(ctx.package_dir, "node_modules", "vendor-baz", "package.json")).json()).toEqual({
        name: "vendor-baz",
        version: "0.0.1",
      });
      await access(join(ctx.package_dir, "bun.lockb"));
    });
  });
});
