import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, VerdaccioRegistry } from "harness";
import { join } from "path";

let registry: VerdaccioRegistry;

beforeAll(async () => {
  registry = new VerdaccioRegistry();
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// https://github.com/oven-sh/bun/issues/11806
// `bun add` inside a workspace member whose package.json contains escaped
// backslashes (`"testRegex": ".*\\.spec\\.ts$"`) rewrote the file in a way that
// no longer parsed.
test("11806", async () => {
  const apiPackageJson = {
    "name": "api",
    "jest": {
      "testRegex": ".*\\.spec\\.ts$",
    },
    "devDependencies": {
      "no-deps": "^1.0.0",
    },
  };

  using dir = tempDir("11806", {
    "bunfig.toml": `[install]\ncache = false\nregistry = "${registry.registryUrl()}"\n`,
    "package.json": JSON.stringify({
      "name": "project",
      "workspaces": ["apps/*"],
    }),
    "apps": {
      "api": {
        "package.json": JSON.stringify(apiPackageJson),
      },
    },
  });
  const apiDir = join(String(dir), "apps", "api");

  const install = await run(["install"], apiDir);
  expect(install).toMatchObject({ exitCode: 0 });

  const add = await run(["add", "--dev", "a-dep"], apiDir);
  expect(add).toMatchObject({ exitCode: 0 });

  // The rewritten package.json must still parse, keep the escaped regex as-is,
  // and contain the new dependency.
  const rewritten = JSON.parse(await Bun.file(join(apiDir, "package.json")).text());
  expect(rewritten.jest).toEqual(apiPackageJson.jest);
  expect(Object.keys(rewritten.devDependencies).sort()).toEqual(["a-dep", "no-deps"]);

  // And a second install still accepts it.
  expect(await run(["install"], apiDir)).toMatchObject({ exitCode: 0 });
});
