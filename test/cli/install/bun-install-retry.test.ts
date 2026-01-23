import { file, spawn } from "bun";
import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { access, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, readdirSorted, tmpdirSync, toBeValidBin, toBeWorkspaceLink, toHaveBins } from "harness";
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

expect.extend({
  toHaveBins,
  toBeValidBin,
  toBeWorkspaceLink,
});

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

describe.concurrent("bun-install-retry", () => {
  it("retries on 500", async () => {
    await withContext(defaultOpts, async ctx => {
      const add_dir = tmpdirSync();
      const port = new URL(ctx.registry_url).port;
      const urls: string[] = [];
      setContextHandler(ctx, dummyRegistryForContext(ctx, urls, undefined, 4));
      await writeFile(
        join(ctx.package_dir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "0.0.1",
        }),
      );
      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "add", "BaR", "--linker=hoisted"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });
      const err = await stderr.text();
      expect(err).not.toContain("error:");
      expect(err).toContain("Saved lockfile");
      const out = await stdout.text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun add v1."),
        "",
        "installed BaR@0.0.2",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(urls.sort()).toEqual([
        `${ctx.registry_url}BaR`,
        `${ctx.registry_url}BaR`,
        `${ctx.registry_url}BaR`,
        `${ctx.registry_url}BaR`,
        `${ctx.registry_url}BaR`,
        `${ctx.registry_url}BaR`,
        `${ctx.registry_url}BaR-0.0.2.tgz`,
        `${ctx.registry_url}BaR-0.0.2.tgz`,
        `${ctx.registry_url}BaR-0.0.2.tgz`,
        `${ctx.registry_url}BaR-0.0.2.tgz`,
        `${ctx.registry_url}BaR-0.0.2.tgz`,
        `${ctx.registry_url}BaR-0.0.2.tgz`,
      ]);
      expect(ctx.requested).toBe(12);
      await Promise.all([
        (async () => expect(await readdirSorted(join(ctx.package_dir, "node_modules"))).toEqual([".cache", "BaR"]))(),
        (async () =>
          expect(await readdirSorted(join(ctx.package_dir, "node_modules", "BaR"))).toEqual(["package.json"]))(),
        (async () =>
          expect(await file(join(ctx.package_dir, "node_modules", "BaR", "package.json")).json()).toEqual({
            name: "bar",
            version: "0.0.2",
          }))(),
        (async () =>
          expect(await file(join(ctx.package_dir, "package.json")).text()).toEqual(
            JSON.stringify(
              {
                name: "foo",
                version: "0.0.1",
                dependencies: {
                  BaR: "^0.0.2",
                },
              },
              null,
              2,
            ),
          ))(),
        async () => await access(join(ctx.package_dir, "bun.lockb")),
      ]);
    });
  });
});
