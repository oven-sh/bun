import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { VerdaccioRegistry, bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "path";
import { pathToFileURL } from "url";

type Linker = "hoisted" | "isolated";
type Files = Record<string, string>;

const registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

const gitEnv = {
  ...bunEnv,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

const fixturePackageJson = JSON.stringify({
  name: "licenses-fixture",
  version: "1.0.0",
  dependencies: {
    "resolve": "1.9.0",
    "no-deps": "1.0.0",
    "one-dep": "1.0.0",
  },
  devDependencies: {
    "a-dep": "1.0.1",
  },
});

function pkg(fields: Record<string, unknown>) {
  return JSON.stringify({ name: "licenses-fixture", version: "1.0.0", ...fields });
}

// Shape of pnpm's commands/test/licenses/fixtures/workspace-licenses: dependency-less private root, foo with deps+devDeps, bar with deps.
const monorepoFiles: Files = {
  "package.json": JSON.stringify({ name: "mono", private: true, workspaces: ["packages/*"] }),
  "packages/foo/package.json": JSON.stringify({
    name: "foo",
    version: "1.0.0",
    dependencies: { "no-deps": "1.0.0" },
    devDependencies: { "a-dep": "1.0.1" },
  }),
  "packages/bar/package.json": JSON.stringify({
    name: "bar",
    version: "1.0.0",
    dependencies: { resolve: "1.9.0" },
  }),
};

// `--linker` is passed explicitly: an `install-strategy` in the user's ~/.npmrc overrides the bunfig linker.
async function install(dir: string, linker: Linker, ...args: string[]) {
  await using proc = spawn({
    cmd: [bunExe(), "install", "--linker", linker, ...args],
    env: bunEnv,
    cwd: dir,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
}

async function setup(linker: Linker = "hoisted", files: Files = { "package.json": fixturePackageJson }) {
  const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker }, files });
  await install(packageDir, linker);
  return packageDir;
}

// `bun install --production` never writes a lockfile, so the lockfile (with its dev-inclusive tree) is created first.
async function setupProductionInstall(files: Files) {
  const { packageDir } = await registry.createTestDir({ bunfigOpts: { linker: "hoisted" }, files });
  await install(packageDir, "hoisted", "--lockfile-only");
  await install(packageDir, "hoisted", "--production");
  return packageDir;
}

async function licenses(dir: string, ...args: string[]): Promise<[string, string, number]> {
  await using proc = spawn({
    cmd: [bunExe(), "pm", "licenses", ...args],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  return await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
}

async function licensesJson(dir: string, ...args: string[]) {
  const [stdout, stderr, exitCode] = await licenses(dir, ...args, "--json");
  expect(stderr).toBe("");
  const parsed = JSON.parse(stdout);
  expect(exitCode).toBe(0);
  return parsed as Record<string, { name: string; versions: string[]; homepage?: string; author?: string }[]>;
}

function names(parsed: Record<string, { name: string }[]>) {
  return Object.values(parsed)
    .flat()
    .map(entry => entry.name)
    .sort();
}

function patchInstalledManifest(dir: string, pkg: string, fields: Record<string, unknown>) {
  const path = join(dir, "node_modules", pkg, "package.json");
  const manifest = { ...JSON.parse(readFileSync(path, "utf8")), ...fields };
  for (const [key, value] of Object.entries(fields)) if (value === undefined) delete manifest[key];
  writeFileSync(path, JSON.stringify(manifest));
}

const fullJson = {
  MIT: [
    {
      name: "path-parse",
      versions: ["1.0.6"],
      homepage: "https://github.com/jbgutierrez/path-parse#readme",
      author: "Javier Blanco <http://jbgutierrez.info>",
    },
    {
      name: "resolve",
      versions: ["1.9.0"],
      author: "James Halliday <mail@substack.net> (http://substack.net)",
    },
  ],
  Unknown: [
    { name: "a-dep", versions: ["1.0.1"] },
    { name: "no-deps", versions: ["1.0.0", "1.0.1"] },
    { name: "one-dep", versions: ["1.0.0"] },
  ],
};

const prodJson = {
  MIT: fullJson.MIT,
  Unknown: [
    { name: "no-deps", versions: ["1.0.0", "1.0.1"] },
    { name: "one-dep", versions: ["1.0.0"] },
  ],
};

describe("bun pm licenses", () => {
  let hoistedDir: string;

  beforeAll(async () => {
    hoistedDir = await setup();
  });

  test.concurrent("text output groups packages by license, Unknown last", async () => {
    const [stdout, stderr, exitCode] = await licenses(hoistedDir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "MIT (2)
      ├── path-parse@1.0.6
      └── resolve@1.9.0

      Unknown (4)
      ├── a-dep@1.0.1
      ├── no-deps@1.0.0
      ├── no-deps@1.0.1
      └── one-dep@1.0.0"
    `);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  });

  test.concurrent("--json shape", async () => {
    const [stdout, stderr, exitCode] = await licenses(hoistedDir, "--json");
    const parsed = JSON.parse(stdout);
    expect(parsed).toEqual(fullJson);
    expect(Object.keys(parsed)).toEqual(["MIT", "Unknown"]);
    expect(parsed.MIT[1]).not.toHaveProperty("homepage");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  });

  test.concurrent("legacy license shapes", async () => {
    const dir = await setup();
    patchInstalledManifest(dir, "a-dep", { license: { type: "BSD-3-Clause", url: "x" } });
    patchInstalledManifest(dir, "one-dep", { licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] });
    patchInstalledManifest(dir, "no-deps", { licenses: { type: "ISC" } });

    const parsed = await licensesJson(dir);
    expect(Object.keys(parsed)).toEqual(["(MIT OR Apache-2.0)", "BSD-3-Clause", "ISC", "MIT", "Unknown"]);
    expect(parsed["ISC"]).toEqual([{ name: "no-deps", versions: ["1.0.0"] }]);
    expect(parsed["Unknown"]).toEqual([{ name: "no-deps", versions: ["1.0.1"] }]);
    expect(parsed["(MIT OR Apache-2.0)"]).toEqual([{ name: "one-dep", versions: ["1.0.0"] }]);
    expect(parsed["BSD-3-Clause"]).toEqual([{ name: "a-dep", versions: ["1.0.1"] }]);
    expect(parsed["MIT"].map(entry => entry.name)).toEqual(["path-parse", "resolve"]);
  });

  // pnpm license-resolver/test/parseLicenseFromManifest.test.ts, replayed against installed manifests.
  test.concurrent("`license` array and legacy `name` key", async () => {
    const dir = await setup();
    patchInstalledManifest(dir, "a-dep", { license: [{ type: "MIT" }, { type: "Apache-2.0" }] });
    patchInstalledManifest(dir, "one-dep", { licenses: [{ name: "ISC" }] });
    patchInstalledManifest(dir, "no-deps", { license: ["BSD-2-Clause"] });
    patchInstalledManifest(dir, "one-dep/node_modules/no-deps", { license: { name: "0BSD" } });

    const parsed = await licensesJson(dir);
    expect(parsed["(MIT OR Apache-2.0)"]).toEqual([{ name: "a-dep", versions: ["1.0.1"] }]);
    expect(parsed["ISC"]).toEqual([{ name: "one-dep", versions: ["1.0.0"] }]);
    expect(parsed["BSD-2-Clause"]).toEqual([{ name: "no-deps", versions: ["1.0.0"] }]);
    expect(parsed["0BSD"]).toEqual([{ name: "no-deps", versions: ["1.0.1"] }]);
    expect(parsed).not.toHaveProperty("Unknown");
  });

  test.concurrent("empty `license` falls through to `licenses`; `license` wins when both are present", async () => {
    const dir = await setup();
    patchInstalledManifest(dir, "a-dep", { license: "", licenses: [{ type: "MIT" }] });
    patchInstalledManifest(dir, "one-dep", { license: "Apache-2.0", licenses: [{ type: "MIT" }] });

    const parsed = await licensesJson(dir);
    expect(parsed["MIT"].map(entry => entry.name)).toEqual(["a-dep", "path-parse", "resolve"]);
    expect(parsed["Apache-2.0"]).toEqual([{ name: "one-dep", versions: ["1.0.0"] }]);
  });

  test.concurrent("non-string license shapes are Unknown; entries with non-string type are skipped", async () => {
    const dir = await setup();
    patchInstalledManifest(dir, "a-dep", { license: 42 });
    patchInstalledManifest(dir, "one-dep", { licenses: [] });
    patchInstalledManifest(dir, "no-deps", { licenses: [{ url: "x" }] });
    patchInstalledManifest(dir, "resolve", { license: undefined, licenses: [{ type: 42 }, { type: "MIT" }] });

    const parsed = await licensesJson(dir);
    expect(parsed).toEqual({
      MIT: [fullJson.MIT[0], { name: "resolve", versions: ["1.9.0"], author: fullJson.MIT[1].author }],
      Unknown: fullJson.Unknown,
    });
  });

  test.concurrent("repeated legacy entries are not deduplicated", async () => {
    const dir = await setup();
    patchInstalledManifest(dir, "one-dep", { licenses: [{ type: "MIT" }, { type: "MIT" }, { type: "Apache-2.0" }] });

    const parsed = await licensesJson(dir);
    expect(parsed["(MIT OR MIT OR Apache-2.0)"]).toEqual([{ name: "one-dep", versions: ["1.0.0"] }]);
  });

  test.concurrent("one package with two versions: per-license grouping, metadata from the newest version", async () => {
    const dir = await setup();
    patchInstalledManifest(dir, "no-deps", { license: "MIT", homepage: "https://example.com/old" });
    patchInstalledManifest(dir, "one-dep/node_modules/no-deps", {
      license: "MIT",
      homepage: "https://example.com/new",
    });

    const parsed = await licensesJson(dir);
    expect(parsed["MIT"]).toEqual([
      { name: "no-deps", versions: ["1.0.0", "1.0.1"], homepage: "https://example.com/new" },
      ...fullJson.MIT,
    ]);
    expect(parsed["Unknown"]).toEqual([
      { name: "a-dep", versions: ["1.0.1"] },
      { name: "one-dep", versions: ["1.0.0"] },
    ]);
  });

  test.concurrent("versions are ordered by semver, names bytewise", async () => {
    const dir = await setup("hoisted", {
      "package.json": pkg({ dependencies: { "uses-a-dep-9": "1.0.0", "uses-a-dep-10": "1.0.0" } }),
    });

    const [stdout, stderr, exitCode] = await licenses(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "Unknown (4)
      ├── a-dep@1.0.9
      ├── a-dep@1.0.10
      ├── uses-a-dep-10@1.0.0
      └── uses-a-dep-9@1.0.0"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    const parsed = await licensesJson(dir);
    expect(parsed["Unknown"][0]).toEqual({ name: "a-dep", versions: ["1.0.9", "1.0.10"] });
  });

  test.concurrent.each(["--prod", "--production", "-p", "-P"])("%s omits devDependencies (--json)", async flag => {
    const parsed = await licensesJson(hoistedDir, flag);
    expect(JSON.stringify(parsed)).not.toContain("a-dep");
    expect(parsed).toEqual(prodJson);
  });

  test.concurrent("--prod omits devDependencies (text)", async () => {
    const [stdout, stderr, exitCode] = await licenses(hoistedDir, "--prod");
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "MIT (2)
      ├── path-parse@1.0.6
      └── resolve@1.9.0

      Unknown (3)
      ├── no-deps@1.0.0
      ├── no-deps@1.0.1
      └── one-dep@1.0.0"
    `);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  });

  test.concurrent("--prod keeps optionalDependencies", async () => {
    const dir = await setup("hoisted", {
      "package.json": pkg({
        dependencies: { "no-deps": "1.0.0" },
        optionalDependencies: { "one-dep": "1.0.0" },
        devDependencies: { "a-dep": "1.0.1" },
      }),
    });

    expect(await licensesJson(dir, "--prod")).toEqual({
      Unknown: [
        { name: "no-deps", versions: ["1.0.0", "1.0.1"] },
        { name: "one-dep", versions: ["1.0.0"] },
      ],
    });
    expect(names(await licensesJson(dir))).toEqual(["a-dep", "no-deps", "one-dep"]);
  });

  test.concurrent("os/cpu-skipped optional dependencies are omitted, their parent is listed", async () => {
    const dir = await setup("hoisted", { "package.json": pkg({ dependencies: { "optional-native": "1.0.0" } }) });
    const installedNatives = [
      "native-bar-x64",
      "native-foo-x64",
      "native-foo-x86",
      "native-libc-glibc",
      "native-libc-musl",
    ]
      .filter(name => existsSync(join(dir, "node_modules", name, "package.json")))
      .map(name => ({ name, versions: ["1.0.0"] }));
    expect(installedNatives.map(entry => entry.name)).not.toContain("native-foo-x64");

    const [stdout, stderr, exitCode] = await licenses(dir, "--json");
    expect(JSON.parse(stdout)).toEqual({
      Unknown: [...installedNatives, { name: "optional-native", versions: ["1.0.0"] }],
    });
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test.concurrent("isolated linker", async () => {
    const dir = await setup("isolated");
    const [expected] = await licenses(hoistedDir);
    const [stdout, stderr, exitCode] = await licenses(dir);
    expect(stdout).toBe(expected);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "MIT (2)
      ├── path-parse@1.0.6
      └── resolve@1.9.0

      Unknown (4)
      ├── a-dep@1.0.1
      ├── no-deps@1.0.0
      ├── no-deps@1.0.1
      └── one-dep@1.0.0"
    `);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  });

  test.concurrent("isolated linker: scoped transitive dependency is found through the store", async () => {
    const dir = await setup("isolated", { "package.json": pkg({ dependencies: { "two-range-deps": "1.0.0" } }) });
    expect(existsSync(join(dir, "node_modules", "@types", "is-number"))).toBeFalse();
    expect(existsSync(join(dir, "node_modules", ".bun", "@types+is-number@2.0.0"))).toBeTrue();

    expect(await licensesJson(dir)).toEqual({
      Unknown: [
        { name: "@types/is-number", versions: ["2.0.0"] },
        { name: "no-deps", versions: ["1.1.0"] },
        { name: "two-range-deps", versions: ["1.0.0"] },
      ],
    });
  });

  test.concurrent("isolated linker: store entries with a peer hash suffix are matched", async () => {
    const dir = await setup("isolated", {
      "package.json": pkg({ dependencies: { "peer-deps-lvl0": "1.0.0" } }),
    });
    const store = readdirSync(join(dir, "node_modules", ".bun"));
    expect(store.some(name => /^peer-deps-lvl[12]@1\.0\.0\+[0-9a-f]{16}$/.test(name))).toBeTrue();

    expect(await licensesJson(dir)).toEqual({
      Unknown: [
        { name: "no-deps", versions: ["1.0.0"] },
        { name: "peer-deps-lvl0", versions: ["1.0.0"] },
        { name: "peer-deps-lvl1", versions: ["1.0.0"] },
        { name: "peer-deps-lvl2", versions: ["1.0.0"] },
      ],
    });
  });

  // pnpm 'should work with file protocol dependency' (fixtures/with-file-protocol): a license-less folder dep is listed as Unknown.
  test.concurrent.each(["hoisted", "isolated"] as Linker[])("file: dependency is listed (%s)", async linker => {
    const dir = await setup(linker, {
      "package.json": pkg({ dependencies: { "no-deps": "1.0.0", "sub-dep": "file:./sub-dep" } }),
      "sub-dep/package.json": JSON.stringify({ name: "sub-dep", version: "2.5.0" }),
    });

    expect(await licensesJson(dir)).toEqual({
      Unknown: [
        { name: "no-deps", versions: ["1.0.0"] },
        { name: "sub-dep", versions: ["sub-dep"] },
      ],
    });
  });

  test.concurrent.each(["hoisted", "isolated"] as Linker[])("link: dependency is not listed (%s)", async linker => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker },
      files: {
        "package.json": pkg({ dependencies: { "no-deps": "1.0.0", "linked": "link:linked" } }),
        "linked/package.json": JSON.stringify({ name: "linked", version: "1.0.0", license: "MIT" }),
      },
    });
    const env = { ...bunEnv, BUN_INSTALL_GLOBAL_DIR: join(packageDir, ".global") };
    for (const [cmd, cwd] of [
      [[bunExe(), "link"], join(packageDir, "linked")],
      [[bunExe(), "install", "--linker", linker], packageDir],
    ] as const) {
      await using proc = spawn({ cmd: [...cmd], env, cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
    }
    expect(existsSync(join(packageDir, "node_modules", "linked", "package.json"))).toBeTrue();

    await using proc = spawn({
      cmd: [bunExe(), "pm", "licenses", "--json"],
      env,
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(JSON.parse(stdout)).toEqual({ Unknown: [{ name: "no-deps", versions: ["1.0.0"] }] });
    expect(exitCode).toBe(0);
  });

  // pnpm license-scanner 'lists versions installed under different aliases'.
  test.concurrent.each(["hoisted", "isolated"] as Linker[])(
    "npm: alias is listed under the real name (%s)",
    async linker => {
      const dir = await setup(linker, {
        "package.json": pkg({ dependencies: { "no-deps": "1.0.0", "nd2": "npm:no-deps@1.0.1" } }),
      });

      expect(await licensesJson(dir)).toEqual({ Unknown: [{ name: "no-deps", versions: ["1.0.0", "1.0.1"] }] });
    },
  );

  // pnpm 'path should be correct for workspaces' / 'filter outputs'; pnpm#5689 (same output from every directory of a monorepo).
  test.concurrent("workspace root lists every member's dependencies; a member lists only its own closure", async () => {
    const dir = await setup("hoisted", monorepoFiles);

    const fromRoot = await licensesJson(dir);
    expect(names(fromRoot)).toEqual(["a-dep", "no-deps", "path-parse", "resolve"]);
    expect(await licensesJson(join(dir, "packages", "bar"))).toEqual({ MIT: fullJson.MIT });
    expect(await licensesJson(join(dir, "packages", "foo"))).toEqual({
      Unknown: [
        { name: "a-dep", versions: ["1.0.1"] },
        { name: "no-deps", versions: ["1.0.0"] },
      ],
    });
  });

  test.concurrent("--prod inside a workspace drops members' devDependencies", async () => {
    const dir = await setup("hoisted", monorepoFiles);

    expect(names(await licensesJson(dir, "--prod"))).toEqual(["no-deps", "path-parse", "resolve"]);
    expect(await licensesJson(join(dir, "packages", "foo"), "--prod")).toEqual({
      Unknown: [{ name: "no-deps", versions: ["1.0.0"] }],
    });
  });

  test.concurrent("nothing to list prints nothing / {}", async () => {
    const dir = await setup("hoisted", { "package.json": pkg({ devDependencies: { "no-deps": "1.0.0" } }) });

    const [stdout, stderr, exitCode] = await licenses(dir, "--prod");
    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(await licensesJson(dir, "--prod")).toEqual({});
    expect(await licensesJson(dir)).toEqual({ Unknown: [{ name: "no-deps", versions: ["1.0.0"] }] });
  });

  test.concurrent("licenses list / ls aliases", async () => {
    const [[plain, , plainExit], [list, , listExit], [ls, , lsExit]] = await Promise.all([
      licenses(hoistedDir),
      licenses(hoistedDir, "list"),
      licenses(hoistedDir, "ls"),
    ]);
    expect(plain).toContain("MIT (2)");
    expect(list).toBe(plain);
    expect(ls).toBe(plain);
    expect([plainExit, listExit, lsExit]).toEqual([0, 0, 0]);

    const [stdout, stderr, exitCode] = await licenses(hoistedDir, "bogus");
    expect(stdout).toBe("");
    expect(stderr).toContain("Unknown subcommand: bogus");
    expect(exitCode).toBe(1);
  });

  test.concurrent("missing lockfile", async () => {
    const { packageDir } = await registry.createTestDir({ files: { "package.json": fixturePackageJson } });
    const [stdout, stderr, exitCode] = await licenses(packageDir);
    expect(stdout).toBe("");
    expect(stderr).toContain("Lockfile not found");
    expect(exitCode).toBe(1);
  });

  test.concurrent("missing node_modules", async () => {
    const { packageDir } = await registry.createTestDir({ files: { "package.json": fixturePackageJson } });
    await using install = spawn({
      cmd: [bunExe(), "install", "--lockfile-only"],
      env: bunEnv,
      cwd: packageDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited).toBe(0);

    const [stdout, stderr, exitCode] = await licenses(packageDir);
    expect(stdout).toBe("");
    expect(stderr).toContain("node_modules not found");
    expect(exitCode).toBe(1);
  });

  // pnpm#5702: a package that cannot be read must not fail the whole listing; the omission is reported instead of silent.
  test.concurrent(
    "unparsable package.json is reported as Unknown, missing ones are omitted with a warning",
    async () => {
      const dir = await setup();
      writeFileSync(join(dir, "node_modules", "resolve", "package.json"), "{ not json");
      rmSync(join(dir, "node_modules", "one-dep"), { recursive: true, force: true });

      const [stdout, stderr, exitCode] = await licenses(dir, "--json");
      expect(JSON.parse(stdout)).toEqual({
        MIT: [fullJson.MIT[0]],
        Unknown: [
          { name: "a-dep", versions: ["1.0.1"] },
          { name: "no-deps", versions: ["1.0.0"] },
          { name: "resolve", versions: ["1.9.0"] },
        ],
      });
      expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(
        `"warn: omitted 2 packages from the lockfile not found in node_modules"`,
      );
      expect(exitCode).toBe(0);
    },
  );

  // pnpm#8589: the lockfile's resolvable tree hoists the dev subtree's a-dep@1.0.9, but `--production` installs a-dep@1.0.10 there.
  const outHoistedFixture = {
    "package.json": pkg({
      dependencies: { "uses-a-dep-10": "1.0.0" },
      devDependencies: { "uses-a-dep-9": "1.0.0" },
    }),
  };

  test.concurrent("pnpm#8589: --prod after `bun install --production` finds packages hoisted differently", async () => {
    const dir = await setupProductionInstall(outHoistedFixture);
    expect(JSON.parse(readFileSync(join(dir, "node_modules", "a-dep", "package.json"), "utf8")).version).toBe("1.0.10");
    expect(existsSync(join(dir, "node_modules", "uses-a-dep-10", "node_modules"))).toBeFalse();

    const [stdout, stderr, exitCode] = await licenses(dir, "--prod", "--json");
    expect(JSON.parse(stdout)).toEqual({
      Unknown: [
        { name: "a-dep", versions: ["1.0.10"] },
        { name: "uses-a-dep-10", versions: ["1.0.0"] },
      ],
    });
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test.concurrent("pnpm#8589: a different version at the tree path is not misattributed", async () => {
    const dir = await setupProductionInstall(outHoistedFixture);
    patchInstalledManifest(dir, "a-dep", { license: "MIT" });

    const [stdout, stderr, exitCode] = await licenses(dir, "--json");
    expect(JSON.parse(stdout)).toEqual({
      MIT: [{ name: "a-dep", versions: ["1.0.10"] }],
      Unknown: [{ name: "uses-a-dep-10", versions: ["1.0.0"] }],
    });
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(
      `"warn: omitted 2 packages from the lockfile not found in node_modules"`,
    );
    expect(exitCode).toBe(0);
  });

  // The lockfile nests bundled deps under their parent, which is also where the tarball unpacks them.
  test.concurrent.each(["hoisted", "isolated"] as Linker[])(
    "bundled dependencies are listed from inside their parent (%s)",
    async linker => {
      const dir = await setup(linker, { "package.json": pkg({ dependencies: { "bundled-1": "1.0.0" } }) });
      expect(existsSync(join(dir, "node_modules", "bundled-1", "node_modules", "no-deps", "package.json"))).toBeTrue();

      const [stdout, stderr, exitCode] = await licenses(dir, "--json");
      expect(JSON.parse(stdout)).toEqual({
        Unknown: [
          { name: "bundled-1", versions: ["1.0.0"] },
          { name: "no-deps", versions: ["1.0.0"] },
        ],
      });
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    },
  );

  // pnpm#8739: git dependencies are looked up the same way the installer wrote them.
  test.concurrent.each(["hoisted", "isolated"] as Linker[])("git dependency is listed (%s)", async linker => {
    using repoDir = tempDir("licenses-git-repo", {
      "package.json": JSON.stringify({ name: "git-pkg", version: "3.0.0", license: "ISC" }),
    });
    const repo = String(repoDir);
    for (const args of [
      ["init", "-q"],
      ["add", "package.json"],
      ["commit", "-q", "-m", "init", "--no-gpg-sign"],
    ]) {
      await using proc = spawn({ cmd: ["git", ...args], cwd: repo, env: gitEnv, stdout: "ignore", stderr: "pipe" });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("fatal:");
      expect(exitCode).toBe(0);
    }

    const dir = await setup(linker, {
      "package.json": pkg({ dependencies: { "no-deps": "1.0.0", "git-pkg": `git+${pathToFileURL(repo)}` } }),
    });

    const [stdout, stderr, exitCode] = await licenses(dir, "--json");
    const parsed = JSON.parse(stdout);
    expect(Object.keys(parsed)).toEqual(["ISC", "Unknown"]);
    expect(parsed.ISC).toEqual([{ name: "git-pkg", versions: [expect.stringContaining("git+file://")] }]);
    expect(parsed.Unknown).toEqual([{ name: "no-deps", versions: ["1.0.0"] }]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test.concurrent("bun pm help lists licenses", async () => {
    await using proc = spawn({
      cmd: [bunExe(), "pm"],
      env: bunEnv,
      cwd: hoistedDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toContain("bun pm licenses");
    expect(exitCode).toBe(0);
  });
});
