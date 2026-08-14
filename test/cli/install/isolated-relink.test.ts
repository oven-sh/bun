import { file, write } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { lstat, realpath } from "fs/promises";
import { VerdaccioRegistry, bunEnv, bunExe, normalizeBunSnapshot } from "harness";
import { dirname, join } from "path";

const registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

// `--linker` is passed explicitly: an `install-strategy` in the user's ~/.npmrc overrides the bunfig linker.
async function install(dir: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", ...args, "--linker", "isolated"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  return stdout;
}

// Store entry names may carry hash suffixes, so reach one-range-dep's store node_modules through the top-level link.
async function nestedNoDeps(packageDir: string) {
  const storeEntry = await realpath(join(packageDir, "node_modules", "one-range-dep"));
  return join(dirname(storeEntry), "no-deps");
}

function nestedNoDepsPackageJson(link: string) {
  return file(join(link, "package.json")).json();
}

test.concurrent("an existing store entry is re-linked when an override re-resolves its dependency", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
  const storeHashPath = join(packageDir, "node_modules", ".bun", ".store-hash");
  const storeHash = file(storeHashPath);

  await write(packageJson, JSON.stringify({ name: "foo", dependencies: { "one-range-dep": "1.0.0" } }));
  await install(packageDir);
  const link = await nestedNoDeps(packageDir);
  expect(await nestedNoDepsPackageJson(link)).toEqual({ name: "no-deps", version: "1.1.0" });
  const storeHashAfterFirstInstall = await storeHash.text();

  await write(
    packageJson,
    JSON.stringify({
      name: "foo",
      dependencies: { "one-range-dep": "1.0.0" },
      overrides: { "no-deps": "1.0.0" },
    }),
  );
  const out = await install(packageDir);
  expect(await nestedNoDepsPackageJson(link)).toEqual({ name: "no-deps", version: "1.0.0" });
  expect(out).toMatch(/\d+ packages? installed/);
  expect(out).not.toContain("(no changes)");
  expect(await storeHash.text()).not.toBe(storeHashAfterFirstInstall);

  const linkMtime = (await lstat(link)).mtimeMs;
  const storeHashMtime = (await lstat(storeHashPath)).mtimeMs;
  const again = await install(packageDir);
  expect(normalizeBunSnapshot(again)).toContain("(no changes)");
  expect((await lstat(link)).mtimeMs).toBe(linkMtime);
  expect(await nestedNoDepsPackageJson(link)).toEqual({ name: "no-deps", version: "1.0.0" });
  expect(await storeHash.exists()).toBe(true);
  expect((await lstat(storeHashPath)).mtimeMs).toBe(storeHashMtime);
});
