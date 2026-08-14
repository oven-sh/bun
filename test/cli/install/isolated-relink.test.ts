import { file, write } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { lstat, realpath } from "fs/promises";
import { VerdaccioRegistry, bunEnv, bunExe } from "harness";
import { dirname, join } from "path";

const registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

async function install(dir: string): Promise<[stdout: string, stderr: string, exitCode: number]> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--linker", "isolated"],
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache") },
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  return Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
}

// Store entry names may carry hash suffixes, so reach one-range-dep's store node_modules through the top-level link.
async function nestedNoDeps(packageDir: string) {
  const storeEntry = await realpath(join(packageDir, "node_modules", "one-range-dep"));
  return join(dirname(storeEntry), "no-deps");
}

function nestedNoDepsPackageJson(link: string) {
  return file(join(link, "package.json")).json();
}

test("an existing store entry is re-linked when an override re-resolves its dependency", async () => {
  const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });

  await write(packageJson, JSON.stringify({ name: "foo", dependencies: { "one-range-dep": "1.0.0" } }));
  const [, firstErr, firstExitCode] = await install(packageDir);
  expect(firstErr).not.toContain("error:");
  expect(firstExitCode).toBe(0);
  const link = await nestedNoDeps(packageDir);
  expect(await nestedNoDepsPackageJson(link)).toEqual({ name: "no-deps", version: "1.1.0" });

  await write(
    packageJson,
    JSON.stringify({
      name: "foo",
      dependencies: { "one-range-dep": "1.0.0" },
      overrides: { "no-deps": "1.0.0" },
    }),
  );
  const [out, err, exitCode] = await install(packageDir);
  expect(await nestedNoDepsPackageJson(link)).toEqual({ name: "no-deps", version: "1.0.0" });
  expect(out).toMatch(/\d+ packages? installed/);
  expect(out).not.toContain("(no changes)");
  expect(err).not.toContain("error:");
  expect(exitCode).toBe(0);

  const linkMtime = (await lstat(link)).mtimeMs;
  const [again, againErr, againExitCode] = await install(packageDir);
  expect(again).toContain("(no changes)");
  expect(againErr).not.toContain("error:");
  expect(againExitCode).toBe(0);
  expect((await lstat(link)).mtimeMs).toBe(linkMtime);
  expect(await nestedNoDepsPackageJson(link)).toEqual({ name: "no-deps", version: "1.0.0" });
});
