import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "fs";
import { VerdaccioRegistry, bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { isAbsolute, join, sep } from "path";
import { pathToFileURL } from "url";

type Linker = "hoisted" | "isolated";
type Files = Record<string, string>;
type LicenseEntry = {
  name: string;
  versions: string[];
  paths?: string[];
  license: string;
  homepage?: string;
  author?: string;
  description?: string;
};
type Listing = Record<string, LicenseEntry[]>;

const registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

// CI exports BUN_INSTALL_CACHE_DIR, which overrides the harness bunfig's per-test `cache`; concurrent cases sharing one cache race on Windows and share hardlinked manifests on Linux.
const installEnv = (dir: string) => ({ ...bunEnv, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache") });

const gitEnv = {
  ...bunEnv,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

async function gitRepo(manifest: Record<string, unknown>) {
  const repoDir = tempDir("licenses-git-repo", { "package.json": JSON.stringify(manifest) });
  for (const args of [
    ["init", "-q"],
    ["add", "package.json"],
    ["commit", "-q", "-m", "init", "--no-gpg-sign"],
  ]) {
    await using proc = spawn({
      cmd: ["git", ...args],
      cwd: String(repoDir),
      env: gitEnv,
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("fatal:");
    expect(exitCode).toBe(0);
  }
  return repoDir;
}

const HEADER = "bun pm licenses <version> (<revision>)";

const emptyText = (checked: number) => `No packages to list (checked ${checked} packages in bun.lock)`;

function expectEmptyText(stdout: string, checked: number) {
  expect(normalizeBunSnapshot(stdout)).toBe(`${HEADER}\n\n${emptyText(checked)}`);
  expect(stdout).toMatch(/\nNo packages to list \(checked \d+ packages in bun\.lock\) \[\d+\.\d+m?s\]\n$/);
}

const MISSING_NOTE = "note: run 'bun install' first";

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

// Only a devDependency, so `--prod` has nothing to list.
const devOnlyFiles: Files = { "package.json": pkg({ devDependencies: { "no-deps": "1.0.0" } }) };

// pnpm#8589: the lockfile's resolvable tree hoists the dev subtree's a-dep@1.0.9, but `--production` installs a-dep@1.0.10 there.
const outHoistedFiles: Files = {
  "package.json": pkg({
    dependencies: { "uses-a-dep-10": "1.0.0" },
    devDependencies: { "uses-a-dep-9": "1.0.0" },
  }),
};

async function install(dir: string, linker: Linker, ...args: string[]) {
  await using proc = spawn({
    cmd: [bunExe(), "install", "--linker", linker, ...args],
    env: installEnv(dir),
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

// Copies an installed project so a test can edit its node_modules without running its own `bun install`.
// Only the lockfile, the config and every package.json are copied. `bun pm licenses` reads nothing else from
// an installed package (read_package_info in src/runtime/cli/pm_licenses_command.rs).
function clone(src: string) {
  const dir = String(tempDir("licenses-clone", {}));
  for (const name of ["package.json", "bunfig.toml", "bun.lock"]) copyFileSync(join(src, name), join(dir, name));
  copyManifests(join(src, "node_modules"), join(dir, "node_modules"));
  return dir;
}

function copyManifests(from: string, to: string) {
  mkdirSync(to);
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const path = join(from, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`clone() copies hoisted installs only, found a symlink at ${path}`);
    if (entry.isDirectory()) copyManifests(path, join(to, entry.name));
    else if (entry.name === "package.json") copyFileSync(path, join(to, entry.name));
  }
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

async function licensesText(dir: string, ...args: string[]) {
  const [stdout, stderr, exitCode] = await licenses(dir, ...args);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return stdout;
}

function stripPaths(parsed: Listing) {
  for (const entries of Object.values(parsed)) {
    for (const entry of entries) {
      expect(entry.paths).toBeArrayOfSize(entry.versions.length);
      for (const p of entry.paths!) {
        expect(isAbsolute(p)).toBeTrue();
        expect(existsSync(join(p, "package.json"))).toBeTrue();
      }
      delete entry.paths;
    }
  }
  return parsed;
}

async function licensesJsonRaw(dir: string, ...args: string[]) {
  const [stdout, stderr, exitCode] = await licenses(dir, ...args, "--json");
  expect(stderr).toBe("");
  const parsed = JSON.parse(stdout);
  expect(exitCode).toBe(0);
  return parsed as Listing;
}

async function licensesJson(dir: string, ...args: string[]) {
  return stripPaths(await licensesJsonRaw(dir, ...args));
}

function entriesOf(parsed: Listing) {
  return Object.values(parsed).flat();
}

function pathsOf(parsed: Listing, name: string) {
  return entriesOf(parsed).find(entry => entry.name === name)!.paths;
}

const nm = (dir: string, ...rest: string[]) => join(dir, "node_modules", ...rest);
const store = (dir: string, entry: string, ...name: string[]) =>
  join(dir, "node_modules", ".bun", entry, "node_modules", ...name);

async function pm(dir: string, ...args: string[]): Promise<[string, string, number]> {
  await using proc = spawn({
    cmd: [bunExe(), "pm", ...args],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  return await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
}

const u = (name: string, ...versions: string[]): LicenseEntry => ({ name, versions, license: "Unknown" });

function patchInstalledManifest(dir: string, pkg: string, fields: Record<string, unknown>) {
  const path = join(dir, "node_modules", pkg, "package.json");
  const manifest = { ...JSON.parse(readFileSync(path, "utf8")), ...fields };
  for (const [key, value] of Object.entries(fields)) if (value === undefined) delete manifest[key];
  writeFileSync(path, JSON.stringify(manifest));
}

const pathParseDescription = "Node.js path.parse() ponyfill";
const resolveDescription = "resolve like require.resolve() on behalf of files asynchronously and synchronously";
const resolveAuthor = "James Halliday <mail@substack.net> (http://substack.net)";
// resolve@1.9.0's manifest has no `homepage`; the link falls back to its `repository.url`.
const resolveHomepage = "git://github.com/browserify/resolve.git";

const fullJson = {
  MIT: [
    {
      name: "path-parse",
      versions: ["1.0.6"],
      license: "MIT",
      author: "Javier Blanco <http://jbgutierrez.info>",
      description: pathParseDescription,
      homepage: "https://github.com/jbgutierrez/path-parse#readme",
    },
    {
      name: "resolve",
      versions: ["1.9.0"],
      license: "MIT",
      author: resolveAuthor,
      description: resolveDescription,
      homepage: resolveHomepage,
    },
  ],
  Unknown: [u("a-dep", "1.0.1"), u("no-deps", "1.0.0", "1.0.1"), u("one-dep", "1.0.0")],
};

// `fullJson` with the `paths` of a hoisted install of the fixture in `dir`.
const fullJsonWithPaths = (dir: string) => ({
  MIT: [
    { ...fullJson.MIT[0], paths: [nm(dir, "path-parse")] },
    { ...fullJson.MIT[1], paths: [nm(dir, "resolve")] },
  ],
  Unknown: [
    { ...u("a-dep", "1.0.1"), paths: [nm(dir, "a-dep")] },
    { ...u("no-deps", "1.0.0", "1.0.1"), paths: [nm(dir, "no-deps"), nm(dir, "one-dep", "node_modules", "no-deps")] },
    { ...u("one-dep", "1.0.0"), paths: [nm(dir, "one-dep")] },
  ],
});

const prodJson = {
  MIT: fullJson.MIT,
  Unknown: [u("no-deps", "1.0.0", "1.0.1"), u("one-dep", "1.0.0")],
};

const monoJson = { MIT: fullJson.MIT, Unknown: [u("a-dep", "1.0.1"), u("no-deps", "1.0.0")] };
const fooJson = { Unknown: [u("a-dep", "1.0.1"), u("no-deps", "1.0.0")] };
const barJson = { MIT: fullJson.MIT };

describe("bun pm licenses", () => {
  let hoistedDir: string;
  let isolatedDir: string;
  let monoDir: string;
  let devOnlyDir: string;
  let prodInstallDir: string;

  // Tests that edit node_modules work on a clone() of one of these; the shared trees stay untouched.
  beforeAll(async () => {
    [hoistedDir, isolatedDir, monoDir, devOnlyDir, prodInstallDir] = await Promise.all([
      setup(),
      setup("isolated"),
      setup("hoisted", monorepoFiles),
      setup("hoisted", devOnlyFiles),
      setupProductionInstall(outHoistedFiles),
    ]);
  });

  test.concurrent("text output groups packages by license, Unknown last, dev-only packages marked", async () => {
    const [stdout, stderr, exitCode] = await licenses(hoistedDir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      MIT (2)
      ├── path-parse@1.0.6
      └── resolve@1.9.0

      Unknown (4)
      ├── a-dep@1.0.1 (dev)
      ├── no-deps@1.0.0
      ├── no-deps@1.0.1
      └── one-dep@1.0.0

      6 packages across 2 licenses (checked 6 packages in bun.lock)"
    `);
    expect(stdout.split("\n").filter(line => line.endsWith(" (dev)"))).toStrictEqual(["├── a-dep@1.0.1 (dev)"]);
    expect(stdout).not.toContain(hoistedDir);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test.concurrent("--json shape", async () => {
    const [stdout, stderr, exitCode] = await licenses(hoistedDir, "--json");
    expect(stderr).toBe("");
    const parsed = JSON.parse(stdout);
    expect(parsed).toStrictEqual(fullJsonWithPaths(hoistedDir));
    // Same field order as the lines --long prints under an entry.
    const keyOrder = ["name", "versions", "paths", "license", "author", "description", "homepage"];
    expect(Object.keys(parsed.MIT[0])).toStrictEqual(keyOrder);
    expect(Object.keys(parsed.MIT[1])).toStrictEqual(keyOrder);
    expect(Object.keys(parsed.Unknown[0])).toStrictEqual(["name", "versions", "paths", "license"]);
    expect(stripPaths(structuredClone(parsed))).toStrictEqual(fullJson);
    expect(Object.keys(parsed)).toStrictEqual(["MIT", "Unknown"]);
    expect(parsed.MIT[0].description).toBe(pathParseDescription);
    expect(parsed.MIT[1].homepage).toBe(resolveHomepage);
    expect(parsed.Unknown[0]).not.toHaveProperty("description");
    expect(parsed.Unknown[0]).not.toHaveProperty("homepage");
    for (const [key, entries] of Object.entries(parsed as Record<string, LicenseEntry[]>)) {
      expect(entries.map(entry => entry.license)).toStrictEqual(entries.map(() => key));
    }
    expect(stdout).not.toContain("(dev)");
    expect(stdout).not.toContain('"dev"');
    expect(exitCode).toBe(0);
  });

  test.concurrent("legacy license shapes", async () => {
    const dir = clone(hoistedDir);
    patchInstalledManifest(dir, "a-dep", { license: { type: "BSD-3-Clause", url: "x" } });
    patchInstalledManifest(dir, "one-dep", { licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] });
    patchInstalledManifest(dir, "no-deps", { licenses: { type: "ISC" } });

    const parsed = await licensesJson(dir);
    expect(Object.keys(parsed)).toStrictEqual(["BSD-3-Clause", "ISC", "MIT", "(MIT OR Apache-2.0)", "Unknown"]);
    expect(parsed).toStrictEqual({
      "BSD-3-Clause": [{ name: "a-dep", versions: ["1.0.1"], license: "BSD-3-Clause" }],
      "ISC": [{ name: "no-deps", versions: ["1.0.0"], license: "ISC" }],
      "MIT": fullJson.MIT,
      "(MIT OR Apache-2.0)": [{ name: "one-dep", versions: ["1.0.0"], license: "(MIT OR Apache-2.0)" }],
      "Unknown": [u("no-deps", "1.0.1")],
    });
  });

  test.concurrent("groups are ordered case-insensitively, ignoring a leading parenthesis, Unknown last", async () => {
    const dir = await setup("hoisted", {
      "package.json": pkg({
        dependencies: { "resolve": "1.9.0", "no-deps": "1.0.0", "one-dep": "1.0.0", "uses-a-dep-9": "1.0.0" },
        devDependencies: { "a-dep": "1.0.1" },
      }),
    });
    patchInstalledManifest(dir, "a-dep", { license: "mit" });
    patchInstalledManifest(dir, "no-deps", { license: "ISC" });
    patchInstalledManifest(dir, "one-dep/node_modules/no-deps", { license: "BSD-3-Clause" });
    patchInstalledManifest(dir, "one-dep", { licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] });
    patchInstalledManifest(dir, "resolve", { license: "SEE LICENSE IN LICENSE.txt" });
    patchInstalledManifest(dir, "uses-a-dep-9/node_modules/a-dep", { license: "zlib" });

    const [[stdout, stderr, exitCode], parsed] = await Promise.all([licenses(dir), licensesJson(dir)]);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      BSD-3-Clause (1)
      └── no-deps@1.0.1

      ISC (1)
      └── no-deps@1.0.0

      MIT (1)
      └── path-parse@1.0.6

      mit (1)
      └── a-dep@1.0.1 (dev)

      (MIT OR Apache-2.0) (1)
      └── one-dep@1.0.0

      SEE LICENSE IN LICENSE.txt (1)
      └── resolve@1.9.0

      zlib (1)
      └── a-dep@1.0.9

      Unknown (1)
      └── uses-a-dep-9@1.0.0

      8 packages across 8 licenses (checked 8 packages in bun.lock)"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    expect(Object.keys(parsed)).toStrictEqual([
      "BSD-3-Clause",
      "ISC",
      "MIT",
      "mit",
      "(MIT OR Apache-2.0)",
      "SEE LICENSE IN LICENSE.txt",
      "zlib",
      "Unknown",
    ]);
    expect(parsed.mit).toStrictEqual([{ name: "a-dep", versions: ["1.0.1"], license: "mit" }]);
    expect(parsed.zlib).toStrictEqual([{ name: "a-dep", versions: ["1.0.9"], license: "zlib" }]);
    expect(parsed.Unknown).toStrictEqual([u("uses-a-dep-9", "1.0.0")]);
  });

  // pnpm license-resolver/test/parseLicenseFromManifest.test.ts, replayed against installed manifests.
  test.concurrent("`license` array and legacy `name` key", async () => {
    const dir = clone(hoistedDir);
    patchInstalledManifest(dir, "a-dep", { license: [{ type: "MIT" }, { type: "Apache-2.0" }] });
    patchInstalledManifest(dir, "one-dep", { licenses: [{ name: "ISC" }] });
    patchInstalledManifest(dir, "no-deps", { license: ["BSD-2-Clause"] });
    patchInstalledManifest(dir, "one-dep/node_modules/no-deps", { license: { name: "0BSD" } });

    expect(await licensesJson(dir)).toStrictEqual({
      "(MIT OR Apache-2.0)": [{ name: "a-dep", versions: ["1.0.1"], license: "(MIT OR Apache-2.0)" }],
      "0BSD": [{ name: "no-deps", versions: ["1.0.1"], license: "0BSD" }],
      "BSD-2-Clause": [{ name: "no-deps", versions: ["1.0.0"], license: "BSD-2-Clause" }],
      "ISC": [{ name: "one-dep", versions: ["1.0.0"], license: "ISC" }],
      "MIT": fullJson.MIT,
    });
  });

  test.concurrent("empty `license` falls through to `licenses`; `license` wins when both are present", async () => {
    const dir = clone(hoistedDir);
    patchInstalledManifest(dir, "a-dep", { license: "", licenses: [{ type: "MIT" }] });
    patchInstalledManifest(dir, "one-dep", { license: "Apache-2.0", licenses: [{ type: "MIT" }] });

    expect(await licensesJson(dir)).toStrictEqual({
      "Apache-2.0": [{ name: "one-dep", versions: ["1.0.0"], license: "Apache-2.0" }],
      "MIT": [{ name: "a-dep", versions: ["1.0.1"], license: "MIT" }, ...fullJson.MIT],
      "Unknown": [u("no-deps", "1.0.0", "1.0.1")],
    });
  });

  test.concurrent("non-string license shapes are Unknown; entries with non-string type are skipped", async () => {
    const dir = clone(hoistedDir);
    patchInstalledManifest(dir, "a-dep", { license: 42 });
    patchInstalledManifest(dir, "one-dep", { licenses: [] });
    patchInstalledManifest(dir, "no-deps", { licenses: [{ url: "x" }] });
    patchInstalledManifest(dir, "resolve", { license: undefined, licenses: [{ type: 42 }, { type: "MIT" }] });

    expect(await licensesJson(dir)).toStrictEqual(fullJson);
  });

  test.concurrent("repeated legacy entries are not deduplicated", async () => {
    const dir = clone(hoistedDir);
    patchInstalledManifest(dir, "one-dep", { licenses: [{ type: "MIT" }, { type: "MIT" }, { type: "Apache-2.0" }] });

    expect(await licensesJson(dir)).toStrictEqual({
      "(MIT OR MIT OR Apache-2.0)": [{ name: "one-dep", versions: ["1.0.0"], license: "(MIT OR MIT OR Apache-2.0)" }],
      "MIT": fullJson.MIT,
      "Unknown": [u("a-dep", "1.0.1"), u("no-deps", "1.0.0", "1.0.1")],
    });
  });

  test.concurrent("one package with two versions: per-license grouping, metadata from the newest version", async () => {
    const dir = clone(hoistedDir);
    patchInstalledManifest(dir, "no-deps", { license: "MIT", homepage: "https://example.com/old" });
    patchInstalledManifest(dir, "one-dep/node_modules/no-deps", {
      license: "MIT",
      homepage: "https://example.com/new",
    });

    const parsed = await licensesJsonRaw(dir);
    expect(pathsOf(parsed, "no-deps")).toStrictEqual([
      nm(dir, "no-deps"),
      nm(dir, "one-dep", "node_modules", "no-deps"),
    ]);
    expect(stripPaths(parsed)).toStrictEqual({
      MIT: [
        { name: "no-deps", versions: ["1.0.0", "1.0.1"], license: "MIT", homepage: "https://example.com/new" },
        ...fullJson.MIT,
      ],
      Unknown: [u("a-dep", "1.0.1"), u("one-dep", "1.0.0")],
    });
  });

  test.concurrent("--json `license` follows each version's group; an empty description is omitted", async () => {
    const dir = clone(hoistedDir);
    patchInstalledManifest(dir, "no-deps", { license: "ISC", description: "" });
    patchInstalledManifest(dir, "one-dep/node_modules/no-deps", { license: "0BSD", description: "newer" });
    patchInstalledManifest(dir, "a-dep", { licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] });

    const parsed = await licensesJson(dir);
    expect(parsed).toStrictEqual({
      "(MIT OR Apache-2.0)": [{ name: "a-dep", versions: ["1.0.1"], license: "(MIT OR Apache-2.0)" }],
      "0BSD": [{ name: "no-deps", versions: ["1.0.1"], license: "0BSD", description: "newer" }],
      "ISC": [{ name: "no-deps", versions: ["1.0.0"], license: "ISC" }],
      "MIT": fullJson.MIT,
      "Unknown": [u("one-dep", "1.0.0")],
    });
    expect(Object.keys(parsed)).toStrictEqual(["0BSD", "ISC", "MIT", "(MIT OR Apache-2.0)", "Unknown"]);
  });

  test.concurrent("versions are ordered by semver, names bytewise", async () => {
    const dir = await setup("hoisted", {
      "package.json": pkg({ dependencies: { "uses-a-dep-9": "1.0.0", "uses-a-dep-10": "1.0.0" } }),
    });

    const [[stdout, stderr, exitCode], parsed] = await Promise.all([licenses(dir), licensesJson(dir)]);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      Unknown (4)
      ├── a-dep@1.0.9
      ├── a-dep@1.0.10
      ├── uses-a-dep-10@1.0.0
      └── uses-a-dep-9@1.0.0

      4 packages across 1 license (checked 4 packages in bun.lock)"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    expect(parsed).toStrictEqual({
      Unknown: [u("a-dep", "1.0.9", "1.0.10"), u("uses-a-dep-10", "1.0.0"), u("uses-a-dep-9", "1.0.0")],
    });
  });

  test.concurrent("(dev) marks packages only reachable through devDependencies", async () => {
    const dir = await setup("hoisted", {
      "package.json": pkg({ dependencies: { "a-dep": "1.0.9" }, devDependencies: { "uses-a-dep-9": "1.0.0" } }),
    });

    const [[stdout, stderr, exitCode], prodText, [json, jsonStderr, jsonExit], devJson, devText] = await Promise.all([
      licenses(dir),
      licensesText(dir, "--prod"),
      licenses(dir, "--json"),
      licensesJson(dir, "--dev"),
      licensesText(dir, "--dev"),
    ]);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      Unknown (2)
      ├── a-dep@1.0.9
      └── uses-a-dep-9@1.0.0 (dev)

      2 packages across 1 license (checked 2 packages in bun.lock)"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    expect(normalizeBunSnapshot(prodText)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      Unknown (1)
      └── a-dep@1.0.9

      1 package across 1 license (checked 1 package in bun.lock)"
    `);

    expect(jsonStderr).toBe("");
    expect(json).not.toContain("(dev)");
    expect(json).not.toContain('"dev"');
    expect(stripPaths(JSON.parse(json))).toStrictEqual({ Unknown: [u("a-dep", "1.0.9"), u("uses-a-dep-9", "1.0.0")] });
    expect(jsonExit).toBe(0);

    expect(devJson).toStrictEqual({ Unknown: [u("a-dep", "1.0.9"), u("uses-a-dep-9", "1.0.0")] });
    expect(normalizeBunSnapshot(devText)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      Unknown (2)
      ├── a-dep@1.0.9
      └── uses-a-dep-9@1.0.0 (dev)

      2 packages across 1 license (checked 2 packages in bun.lock)"
    `);
  });

  // pnpm detect-dep-types: the marker is per name@version and reaches the transitive dependencies of a devDependency.
  test.concurrent("(dev) propagates through a devDependency's subtree; --dev lists that subtree", async () => {
    const dir = await setup("hoisted", {
      "package.json": pkg({
        dependencies: { "no-deps": "1.0.1", "uses-a-dep-10": "1.0.0" },
        devDependencies: { "one-dep": "1.0.0", "uses-a-dep-9": "1.0.0" },
      }),
    });

    const [text, devText, devJson] = await Promise.all([
      licensesText(dir),
      licensesText(dir, "--dev"),
      licensesJson(dir, "--dev"),
    ]);
    expect(normalizeBunSnapshot(text)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      Unknown (6)
      ├── a-dep@1.0.9 (dev)
      ├── a-dep@1.0.10
      ├── no-deps@1.0.1
      ├── one-dep@1.0.0 (dev)
      ├── uses-a-dep-10@1.0.0
      └── uses-a-dep-9@1.0.0 (dev)

      6 packages across 1 license (checked 6 packages in bun.lock)"
    `);

    expect(normalizeBunSnapshot(devText)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      Unknown (4)
      ├── a-dep@1.0.9 (dev)
      ├── no-deps@1.0.1
      ├── one-dep@1.0.0 (dev)
      └── uses-a-dep-9@1.0.0 (dev)

      4 packages across 1 license (checked 4 packages in bun.lock)"
    `);
    expect(devJson).toStrictEqual({
      Unknown: [u("a-dep", "1.0.9"), u("no-deps", "1.0.1"), u("one-dep", "1.0.0"), u("uses-a-dep-9", "1.0.0")],
    });
  });

  test.concurrent("--dev lists the devDependencies closure", async () => {
    const dir = await setup("hoisted", {
      "package.json": pkg({ dependencies: { "no-deps": "1.0.0" }, devDependencies: { "one-dep": "1.0.0" } }),
    });

    const [devJson, shortFlagJson, devText, hoistedDevText, hoistedDevJson] = await Promise.all([
      licensesJson(dir, "--dev"),
      licensesJson(dir, "-D"),
      licensesText(dir, "--dev"),
      licensesText(hoistedDir, "--dev"),
      licensesJson(hoistedDir, "--dev"),
    ]);
    const expected = { Unknown: [u("no-deps", "1.0.1"), u("one-dep", "1.0.0")] };
    expect(devJson).toStrictEqual(expected);
    expect(shortFlagJson).toStrictEqual(expected);
    expect(normalizeBunSnapshot(devText)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      Unknown (2)
      ├── no-deps@1.0.1 (dev)
      └── one-dep@1.0.0 (dev)

      2 packages across 1 license (checked 2 packages in bun.lock)"
    `);

    expect(normalizeBunSnapshot(hoistedDevText)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      Unknown (1)
      └── a-dep@1.0.1 (dev)

      1 package across 1 license (checked 1 package in bun.lock)"
    `);
    expect(hoistedDevJson).toStrictEqual({ Unknown: [u("a-dep", "1.0.1")] });
  });

  test.concurrent("--dev in a workspace", async () => {
    const bar = join(monoDir, "packages", "bar");
    const [root, foo, barText, barJson] = await Promise.all([
      licensesJson(monoDir, "--dev"),
      licensesJson(join(monoDir, "packages", "foo"), "--dev"),
      licensesText(bar, "--dev"),
      licensesJson(bar, "--dev"),
    ]);
    expect(root).toStrictEqual({ Unknown: [u("a-dep", "1.0.1")] });
    expect(foo).toStrictEqual({ Unknown: [u("a-dep", "1.0.1")] });
    expectEmptyText(barText, 0);
    expect(barJson).toStrictEqual({});
  });

  test.concurrent("--dev cannot be combined with --prod", async () => {
    const results = await Promise.all(
      [
        ["--dev", "--prod"],
        ["--dev", "--omit=dev"],
        ["--prod", "--dev", "--json"],
      ].map(args => licenses(hoistedDir, ...args)),
    );
    for (const [stdout, stderr, exitCode] of results) {
      expect(stdout).toBe("");
      expect(normalizeBunSnapshot(stderr)).toBe("error: --dev cannot be combined with --prod or --omit=dev");
      expect(exitCode).toBe(1);
    }
  });

  test.concurrent.each(["--prod", "--production", "-p", "-P"])("%s omits devDependencies (--json)", async flag => {
    expect(await licensesJson(hoistedDir, flag)).toStrictEqual(prodJson);
  });

  test.concurrent("--prod omits devDependencies (text)", async () => {
    const [stdout, stderr, exitCode] = await licenses(hoistedDir, "--prod");
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      MIT (2)
      ├── path-parse@1.0.6
      └── resolve@1.9.0

      Unknown (3)
      ├── no-deps@1.0.0
      ├── no-deps@1.0.1
      └── one-dep@1.0.0

      5 packages across 2 licenses (checked 5 packages in bun.lock)"
    `);
    expect(stderr).toBe("");
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

    const [prod, all] = await Promise.all([licensesJson(dir, "--prod"), licensesJson(dir)]);
    expect(prod).toStrictEqual({ Unknown: [u("no-deps", "1.0.0", "1.0.1"), u("one-dep", "1.0.0")] });
    expect(all).toStrictEqual({
      Unknown: [u("a-dep", "1.0.1"), u("no-deps", "1.0.0", "1.0.1"), u("one-dep", "1.0.0")],
    });
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
      .map(name => u(name, "1.0.0"));
    expect(installedNatives.map(entry => entry.name)).not.toContain("native-foo-x64");

    expect(await licensesJson(dir)).toStrictEqual({
      Unknown: [...installedNatives, u("optional-native", "1.0.0")],
    });
  });

  test.concurrent("--long prints author, description and homepage under each entry", async () => {
    const [[stdout, stderr, exitCode], lsLong, longJson] = await Promise.all([
      licenses(hoistedDir, "--long"),
      licensesText(hoistedDir, "ls", "--long"),
      licensesJsonRaw(hoistedDir, "--long"),
    ]);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      MIT (2)
      ├── path-parse@1.0.6
      │   Javier Blanco <http://jbgutierrez.info>
      │   Node.js path.parse() ponyfill
      │   https://github.com/jbgutierrez/path-parse#readme
      └── resolve@1.9.0
          James Halliday <mail@substack.net> (http://substack.net)
          resolve like require.resolve() on behalf of files asynchronously and synchronously
          git://github.com/browserify/resolve.git

      Unknown (4)
      ├── a-dep@1.0.1 (dev)
      ├── no-deps@1.0.0
      ├── no-deps@1.0.1
      └── one-dep@1.0.0

      6 packages across 2 licenses (checked 6 packages in bun.lock)"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    expect(normalizeBunSnapshot(lsLong)).toBe(normalizeBunSnapshot(stdout));
    expect(stdout).not.toContain(nm(hoistedDir));

    // --long adds no field to the JSON output: the listing is the one `--json` alone produces.
    expect(longJson).toStrictEqual(fullJsonWithPaths(hoistedDir));
  });

  test.concurrent("--long details are per version in text; --json takes them from the newest version", async () => {
    const dir = clone(hoistedDir);
    patchInstalledManifest(dir, "no-deps", { description: "only a description" });
    patchInstalledManifest(dir, "a-dep", { author: { name: "Ann", email: "ann@example.com" } });

    const [first, firstJson] = await Promise.all([licensesText(dir, "--long"), licensesJson(dir)]);
    expect(normalizeBunSnapshot(first)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      MIT (2)
      ├── path-parse@1.0.6
      │   Javier Blanco <http://jbgutierrez.info>
      │   Node.js path.parse() ponyfill
      │   https://github.com/jbgutierrez/path-parse#readme
      └── resolve@1.9.0
          James Halliday <mail@substack.net> (http://substack.net)
          resolve like require.resolve() on behalf of files asynchronously and synchronously
          git://github.com/browserify/resolve.git

      Unknown (4)
      ├── a-dep@1.0.1 (dev)
      │   Ann <ann@example.com>
      ├── no-deps@1.0.0
      │   only a description
      ├── no-deps@1.0.1
      └── one-dep@1.0.0

      6 packages across 2 licenses (checked 6 packages in bun.lock)"
    `);
    expect(firstJson).toStrictEqual({
      MIT: fullJson.MIT,
      Unknown: [
        { ...u("a-dep", "1.0.1"), author: "Ann <ann@example.com>" },
        u("no-deps", "1.0.0", "1.0.1"),
        u("one-dep", "1.0.0"),
      ],
    });

    patchInstalledManifest(dir, "one-dep/node_modules/no-deps", {
      description: "newest wins\nline two",
      homepage: "https://example.com/new",
    });

    const [second, secondJson] = await Promise.all([licensesText(dir, "--long"), licensesJson(dir)]);
    expect(normalizeBunSnapshot(second)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      MIT (2)
      ├── path-parse@1.0.6
      │   Javier Blanco <http://jbgutierrez.info>
      │   Node.js path.parse() ponyfill
      │   https://github.com/jbgutierrez/path-parse#readme
      └── resolve@1.9.0
          James Halliday <mail@substack.net> (http://substack.net)
          resolve like require.resolve() on behalf of files asynchronously and synchronously
          git://github.com/browserify/resolve.git

      Unknown (4)
      ├── a-dep@1.0.1 (dev)
      │   Ann <ann@example.com>
      ├── no-deps@1.0.0
      │   only a description
      ├── no-deps@1.0.1
      │   newest winsline two
      │   https://example.com/new
      └── one-dep@1.0.0

      6 packages across 2 licenses (checked 6 packages in bun.lock)"
    `);
    expect(secondJson).toStrictEqual({
      MIT: fullJson.MIT,
      Unknown: [
        { ...u("a-dep", "1.0.1"), author: "Ann <ann@example.com>" },
        {
          ...u("no-deps", "1.0.0", "1.0.1"),
          homepage: "https://example.com/new",
          description: "newest wins\nline two",
        },
        u("one-dep", "1.0.0"),
      ],
    });
  });

  test.concurrent("`repository` stands in for a missing `homepage`; `homepage` wins when both are set", async () => {
    const dir = clone(hoistedDir);
    patchInstalledManifest(dir, "a-dep", { repository: "https://github.com/example/a-dep.git" });
    patchInstalledManifest(dir, "one-dep", {
      repository: { type: "git", url: "git+ssh://git@github.com/example/one-dep.git" },
    });
    patchInstalledManifest(dir, "no-deps", {
      homepage: "https://no-deps.example",
      repository: { type: "git", url: "https://github.com/example/no-deps.git" },
    });
    patchInstalledManifest(dir, "one-dep/node_modules/no-deps", { repository: { type: "git" } });
    patchInstalledManifest(dir, "resolve", { repository: undefined });

    const [json, longText] = await Promise.all([licensesJson(dir), licensesText(dir, "--long")]);
    expect(json).toStrictEqual({
      MIT: [
        fullJson.MIT[0],
        {
          name: "resolve",
          versions: ["1.9.0"],
          license: "MIT",
          author: resolveAuthor,
          description: resolveDescription,
        },
      ],
      Unknown: [
        { ...u("a-dep", "1.0.1"), homepage: "https://github.com/example/a-dep.git" },
        u("no-deps", "1.0.0", "1.0.1"),
        { ...u("one-dep", "1.0.0"), homepage: "git+ssh://git@github.com/example/one-dep.git" },
      ],
    });
    expect(normalizeBunSnapshot(longText)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      MIT (2)
      ├── path-parse@1.0.6
      │   Javier Blanco <http://jbgutierrez.info>
      │   Node.js path.parse() ponyfill
      │   https://github.com/jbgutierrez/path-parse#readme
      └── resolve@1.9.0
          James Halliday <mail@substack.net> (http://substack.net)
          resolve like require.resolve() on behalf of files asynchronously and synchronously

      Unknown (4)
      ├── a-dep@1.0.1 (dev)
      │   https://github.com/example/a-dep.git
      ├── no-deps@1.0.0
      │   https://no-deps.example
      ├── no-deps@1.0.1
      └── one-dep@1.0.0
          git+ssh://git@github.com/example/one-dep.git

      6 packages across 2 licenses (checked 6 packages in bun.lock)"
    `);
  });

  test.concurrent(
    "control characters from package.json are stripped in text output but preserved in --json",
    async () => {
      const dir = clone(hoistedDir);
      const evilLicense = "MIT\u001b[31m\nEVIL";
      patchInstalledManifest(dir, "a-dep", { license: evilLicense, description: "tab\there\r\n" });
      patchInstalledManifest(dir, "one-dep", { license: "ISC\nGPL-3.0" });
      patchInstalledManifest(dir, "no-deps", { license: "BSD\t2" });

      const [stdout, parsed] = await Promise.all([licensesText(dir, "--long"), licensesJson(dir)]);
      expect(stdout).not.toContain("\u001b");
      expect(stdout).not.toContain("\r");
      expect(stdout).not.toContain("\t");
      expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
        "bun pm licenses <version> (<revision>)

        BSD2 (1)
        └── no-deps@1.0.0

        ISCGPL-3.0 (1)
        └── one-dep@1.0.0

        MIT (2)
        ├── path-parse@1.0.6
        │   Javier Blanco <http://jbgutierrez.info>
        │   Node.js path.parse() ponyfill
        │   https://github.com/jbgutierrez/path-parse#readme
        └── resolve@1.9.0
            James Halliday <mail@substack.net> (http://substack.net)
            resolve like require.resolve() on behalf of files asynchronously and synchronously
            git://github.com/browserify/resolve.git

        MIT[31mEVIL (1)
        └── a-dep@1.0.1 (dev)
            tabhere

        Unknown (1)
        └── no-deps@1.0.1

        6 packages across 5 licenses (checked 6 packages in bun.lock)"
      `);

      expect(Object.keys(parsed)).toStrictEqual(["BSD\t2", "ISC\nGPL-3.0", "MIT", evilLicense, "Unknown"]);
      expect(parsed[evilLicense]).toStrictEqual([
        { name: "a-dep", versions: ["1.0.1"], license: evilLicense, description: "tab\there\r\n" },
      ]);
      expect(parsed["ISC\nGPL-3.0"]).toStrictEqual([{ name: "one-dep", versions: ["1.0.0"], license: "ISC\nGPL-3.0" }]);
      expect(parsed["BSD\t2"]).toStrictEqual([{ name: "no-deps", versions: ["1.0.0"], license: "BSD\t2" }]);
      expect(parsed.Unknown).toStrictEqual([u("no-deps", "1.0.1")]);
    },
  );

  test.concurrent("--long strips control characters from author, description and homepage", async () => {
    const dir = clone(hoistedDir);
    const author = "Eve\u001b]8;;https://evil.example\u0007click\u001b]8;;\u0007";
    const description = "first\r\nsecond";
    const homepage = "https://example.com/\u001b[2Jx";
    patchInstalledManifest(dir, "a-dep", { author, description, homepage });

    const [stdout, parsed] = await Promise.all([licensesText(dir, "--long"), licensesJson(dir)]);
    expect(stdout).not.toContain("\u001b");
    expect(stdout).not.toContain("\u0007");
    expect(stdout).not.toContain("\r");
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      MIT (2)
      ├── path-parse@1.0.6
      │   Javier Blanco <http://jbgutierrez.info>
      │   Node.js path.parse() ponyfill
      │   https://github.com/jbgutierrez/path-parse#readme
      └── resolve@1.9.0
          James Halliday <mail@substack.net> (http://substack.net)
          resolve like require.resolve() on behalf of files asynchronously and synchronously
          git://github.com/browserify/resolve.git

      Unknown (4)
      ├── a-dep@1.0.1 (dev)
      │   Eve]8;;https://evil.exampleclick]8;;
      │   firstsecond
      │   https://example.com/[2Jx
      ├── no-deps@1.0.0
      ├── no-deps@1.0.1
      └── one-dep@1.0.0

      6 packages across 2 licenses (checked 6 packages in bun.lock)"
    `);

    expect(parsed).toStrictEqual({
      MIT: fullJson.MIT,
      Unknown: [
        { ...u("a-dep", "1.0.1"), author, description, homepage },
        u("no-deps", "1.0.0", "1.0.1"),
        u("one-dep", "1.0.0"),
      ],
    });
  });

  // The expected values are the ones the hoisted tests above assert for `hoistedDir`.
  test.concurrent("isolated linker matches hoisted: marker, --dev and --long", async () => {
    const [[stdout, stderr, exitCode], long, dev, devJson, longJson] = await Promise.all([
      licenses(isolatedDir),
      licensesText(isolatedDir, "--long"),
      licensesText(isolatedDir, "--dev"),
      licensesJson(isolatedDir, "--dev"),
      licensesJson(isolatedDir, "--long"),
    ]);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      MIT (2)
      ├── path-parse@1.0.6
      └── resolve@1.9.0

      Unknown (4)
      ├── a-dep@1.0.1 (dev)
      ├── no-deps@1.0.0
      ├── no-deps@1.0.1
      └── one-dep@1.0.0

      6 packages across 2 licenses (checked 6 packages in bun.lock)"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    expect(normalizeBunSnapshot(long)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      MIT (2)
      ├── path-parse@1.0.6
      │   Javier Blanco <http://jbgutierrez.info>
      │   Node.js path.parse() ponyfill
      │   https://github.com/jbgutierrez/path-parse#readme
      └── resolve@1.9.0
          James Halliday <mail@substack.net> (http://substack.net)
          resolve like require.resolve() on behalf of files asynchronously and synchronously
          git://github.com/browserify/resolve.git

      Unknown (4)
      ├── a-dep@1.0.1 (dev)
      ├── no-deps@1.0.0
      ├── no-deps@1.0.1
      └── one-dep@1.0.0

      6 packages across 2 licenses (checked 6 packages in bun.lock)"
    `);
    expect(normalizeBunSnapshot(dev)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      Unknown (1)
      └── a-dep@1.0.1 (dev)

      1 package across 1 license (checked 1 package in bun.lock)"
    `);
    expect(devJson).toStrictEqual({ Unknown: [u("a-dep", "1.0.1")] });
    expect(longJson).toStrictEqual(fullJson);
  });

  test.concurrent("isolated linker matches hoisted: --filter in a workspace", async () => {
    const isoMono = await setup("isolated", monorepoFiles);
    const [isoJson, isoText] = await Promise.all([
      licensesJson(isoMono, "--filter", "foo"),
      licensesText(isoMono, "--filter", "foo"),
    ]);
    expect(isoJson).toStrictEqual(fooJson);
    expect(normalizeBunSnapshot(isoText)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      Unknown (2)
      ├── a-dep@1.0.1 (dev)
      └── no-deps@1.0.0

      2 packages across 1 license (checked 2 packages in bun.lock)"
    `);
  });

  test.concurrent("isolated linker: scoped transitive dependency is found through the store", async () => {
    const dir = await setup("isolated", { "package.json": pkg({ dependencies: { "two-range-deps": "1.0.0" } }) });
    expect(existsSync(join(dir, "node_modules", "@types", "is-number"))).toBeFalse();
    expect(existsSync(join(dir, "node_modules", ".bun", "@types+is-number@2.0.0"))).toBeTrue();

    const parsed = await licensesJsonRaw(dir);
    expect(pathsOf(parsed, "@types/is-number")).toStrictEqual([
      store(dir, "@types+is-number@2.0.0", "@types", "is-number"),
    ]);
    expect(stripPaths(parsed)).toStrictEqual({
      Unknown: [u("@types/is-number", "2.0.0"), u("no-deps", "1.1.0"), u("two-range-deps", "1.0.0")],
    });
  });

  test.concurrent("paths: isolated installs report the store directory", async () => {
    const parsed = await licensesJsonRaw(isolatedDir);
    expect(Object.fromEntries(entriesOf(parsed).map(entry => [entry.name, entry.paths]))).toStrictEqual({
      "path-parse": [store(isolatedDir, "path-parse@1.0.6", "path-parse")],
      "resolve": [store(isolatedDir, "resolve@1.9.0", "resolve")],
      "a-dep": [store(isolatedDir, "a-dep@1.0.1", "a-dep")],
      "no-deps": [store(isolatedDir, "no-deps@1.0.0", "no-deps"), store(isolatedDir, "no-deps@1.0.1", "no-deps")],
      "one-dep": [store(isolatedDir, "one-dep@1.0.0", "one-dep")],
    });
    expect(stripPaths(parsed)).toStrictEqual(fullJson);
  });

  test.concurrent("isolated linker: store entries with a peer hash suffix are matched", async () => {
    const dir = await setup("isolated", {
      "package.json": pkg({ dependencies: { "peer-deps-lvl0": "1.0.0" } }),
    });
    const storeEntries = readdirSync(join(dir, "node_modules", ".bun"));
    expect(storeEntries.some(name => /^peer-deps-lvl[12]@1\.0\.0\+[0-9a-f]{16}$/.test(name))).toBeTrue();

    const parsed = await licensesJsonRaw(dir);
    const [lvl1Path] = pathsOf(parsed, "peer-deps-lvl1")!;
    expect(lvl1Path).toMatch(new RegExp("peer-deps-lvl1@1\\.0\\.0\\+[0-9a-f]{16}"));
    expect(lvl1Path.startsWith(join(dir, "node_modules", ".bun"))).toBeTrue();
    expect(existsSync(join(lvl1Path, "package.json"))).toBeTrue();
    expect(stripPaths(parsed)).toStrictEqual({
      Unknown: [
        u("no-deps", "1.0.0"),
        u("peer-deps-lvl0", "1.0.0"),
        u("peer-deps-lvl1", "1.0.0"),
        u("peer-deps-lvl2", "1.0.0"),
      ],
    });
  });

  // pnpm 'should work with file protocol dependency' (fixtures/with-file-protocol): a license-less folder dep is listed as Unknown.
  test.concurrent.each(["hoisted", "isolated"] as Linker[])("file: dependency is listed (%s)", async linker => {
    const dir = await setup(linker, {
      "package.json": pkg({ dependencies: { "no-deps": "1.0.0", "sub-dep": "file:./sub-dep" } }),
      "sub-dep/package.json": JSON.stringify({ name: "sub-dep", version: "2.5.0" }),
    });

    const parsed = await licensesJsonRaw(dir);
    expect(pathsOf(parsed, "sub-dep")).toStrictEqual([
      linker === "hoisted" ? nm(dir, "sub-dep") : store(dir, "sub-dep@file+sub-dep", "sub-dep"),
    ]);
    expect(stripPaths(parsed)).toStrictEqual({ Unknown: [u("no-deps", "1.0.0"), u("sub-dep", "sub-dep")] });
  });

  test.concurrent("--prod omits a file: dependency's devDependencies, like bun install --production", async () => {
    const dir = await setup("hoisted", {
      "package.json": pkg({ dependencies: { "no-deps": "1.0.0", "sub-dep": "file:./sub-dep" } }),
      "sub-dep/package.json": JSON.stringify({
        name: "sub-dep",
        version: "2.5.0",
        devDependencies: { "a-dep": "1.0.1" },
      }),
    });

    const [all, prod] = await Promise.all([licensesJson(dir), licensesJson(dir, "--prod")]);
    expect(all).toStrictEqual({ Unknown: [u("a-dep", "1.0.1"), u("no-deps", "1.0.0"), u("sub-dep", "sub-dep")] });
    expect(prod).toStrictEqual({ Unknown: [u("no-deps", "1.0.0"), u("sub-dep", "sub-dep")] });
  });

  test.concurrent.each(["hoisted", "isolated"] as Linker[])("link: dependency is not listed (%s)", async linker => {
    const { packageDir } = await registry.createTestDir({
      bunfigOpts: { linker },
      files: {
        "package.json": pkg({ dependencies: { "no-deps": "1.0.0", "linked": "link:linked" } }),
        "linked/package.json": JSON.stringify({ name: "linked", version: "1.0.0", license: "MIT" }),
      },
    });
    const env = { ...installEnv(packageDir), BUN_INSTALL_GLOBAL_DIR: join(packageDir, ".global") };
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
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stripPaths(JSON.parse(stdout))).toStrictEqual({ Unknown: [u("no-deps", "1.0.0")] });
    expect(exitCode).toBe(0);
  });

  // pnpm license-scanner 'lists versions installed under different aliases'.
  test.concurrent.each(["hoisted", "isolated"] as Linker[])(
    "npm: alias is listed under the real name (%s)",
    async linker => {
      const dir = await setup(linker, {
        "package.json": pkg({ dependencies: { "no-deps": "1.0.0", "nd2": "npm:no-deps@1.0.1" } }),
      });

      expect(await licensesJson(dir)).toStrictEqual({ Unknown: [u("no-deps", "1.0.0", "1.0.1")] });
    },
  );

  // pnpm 'path should be correct for workspaces' / 'filter outputs'; pnpm#5689 (same output from every directory of a monorepo).
  test.concurrent("workspace root lists every member's dependencies; a member lists only its own closure", async () => {
    const [root, bar, foo, text] = await Promise.all([
      licensesJsonRaw(monoDir),
      licensesJsonRaw(join(monoDir, "packages", "bar")),
      licensesJsonRaw(join(monoDir, "packages", "foo")),
      licensesText(monoDir),
    ]);
    expect(pathsOf(root, "a-dep")).toStrictEqual([nm(monoDir, "a-dep")]);
    expect(pathsOf(root, "resolve")).toStrictEqual([nm(monoDir, "resolve")]);
    expect(pathsOf(foo, "a-dep")).toStrictEqual([nm(monoDir, "a-dep")]);
    expect(stripPaths(root)).toStrictEqual(monoJson);
    expect(stripPaths(bar)).toStrictEqual(barJson);
    expect(stripPaths(foo)).toStrictEqual(fooJson);
    expect(normalizeBunSnapshot(text)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      MIT (2)
      ├── path-parse@1.0.6
      └── resolve@1.9.0

      Unknown (2)
      ├── a-dep@1.0.1 (dev)
      └── no-deps@1.0.0

      4 packages across 2 licenses (checked 4 packages in bun.lock)"
    `);
  });

  test.concurrent("(dev) from the root is unmarked when another member needs the package in production", async () => {
    const dir = await setup("hoisted", {
      ...monorepoFiles,
      "packages/foo/package.json": JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: { "no-deps": "1.0.0" },
        devDependencies: { "a-dep": "1.0.1", "resolve": "1.9.0" },
      }),
    });

    const [rootText, fooText] = await Promise.all([licensesText(dir), licensesText(join(dir, "packages", "foo"))]);
    expect(normalizeBunSnapshot(rootText)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      MIT (2)
      ├── path-parse@1.0.6
      └── resolve@1.9.0

      Unknown (2)
      ├── a-dep@1.0.1 (dev)
      └── no-deps@1.0.0

      4 packages across 2 licenses (checked 4 packages in bun.lock)"
    `);
    expect(normalizeBunSnapshot(fooText)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      MIT (2)
      ├── path-parse@1.0.6 (dev)
      └── resolve@1.9.0 (dev)

      Unknown (2)
      ├── a-dep@1.0.1 (dev)
      └── no-deps@1.0.0

      4 packages across 2 licenses (checked 4 packages in bun.lock)"
    `);
  });

  test.concurrent("--prod inside a workspace drops members' devDependencies", async () => {
    const [root, foo] = await Promise.all([
      licensesJson(monoDir, "--prod"),
      licensesJson(join(monoDir, "packages", "foo"), "--prod"),
    ]);
    expect(root).toStrictEqual({ MIT: fullJson.MIT, Unknown: [u("no-deps", "1.0.0")] });
    expect(foo).toStrictEqual({ Unknown: [u("no-deps", "1.0.0")] });
  });

  test.concurrent("--filter selects workspaces from any directory", async () => {
    const bar = join(monoDir, "packages", "bar");
    const [
      foo,
      barByName,
      barByPath,
      fooFromBar,
      barFromBar,
      union,
      star,
      notFoo,
      starNotFoo,
      glob,
      parentGlob,
      packagesGlob,
      rootOnly,
      fooText,
      fooProd,
      fooDev,
      barDev,
    ] = await Promise.all([
      licensesJsonRaw(monoDir, "--filter", "foo"),
      licensesJson(monoDir, "--filter", "bar"),
      licensesJson(monoDir, "--filter", "./packages/bar"),
      licensesJson(bar, "--filter", "foo"),
      licensesJson(bar, "--filter", "./"),
      licensesJson(monoDir, "-F", "foo", "-F", "bar"),
      licensesJson(monoDir, "--filter", "*"),
      licensesJson(monoDir, "--filter", "!foo"),
      licensesJson(monoDir, "--filter", "*", "--filter", "!foo"),
      licensesJson(monoDir, "--filter", "b*"),
      licensesJson(bar, "--filter", "../*"),
      licensesJson(monoDir, "--filter", "./packages/*"),
      licensesText(monoDir, "--filter", "mono"),
      licensesText(monoDir, "--filter", "foo"),
      licensesJson(monoDir, "--filter", "foo", "--prod"),
      licensesJson(monoDir, "--filter", "foo", "--dev"),
      licensesJson(monoDir, "--filter", "bar", "--dev"),
    ]);
    // A filtered listing reports the same hoisted location as the root listing.
    expect(pathsOf(foo, "a-dep")).toStrictEqual([nm(monoDir, "a-dep")]);
    expect(stripPaths(foo)).toStrictEqual(fooJson);
    expect(barByName).toStrictEqual(barJson);
    expect(barByPath).toStrictEqual(barJson);
    expect(fooFromBar).toStrictEqual(fooJson);
    expect(barFromBar).toStrictEqual(barJson);
    expect(union).toStrictEqual(monoJson);
    expect(star).toStrictEqual(monoJson);
    expect(notFoo).toStrictEqual(barJson);
    expect(starNotFoo).toStrictEqual(barJson);
    expect(glob).toStrictEqual(barJson);
    expect(parentGlob).toStrictEqual(monoJson);
    expect(packagesGlob).toStrictEqual(monoJson);
    expectEmptyText(rootOnly, 0);
    expect(normalizeBunSnapshot(fooText)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      Unknown (2)
      ├── a-dep@1.0.1 (dev)
      └── no-deps@1.0.0

      2 packages across 1 license (checked 2 packages in bun.lock)"
    `);
    expect(fooProd).toStrictEqual({ Unknown: [u("no-deps", "1.0.0")] });
    expect(fooDev).toStrictEqual({ Unknown: [u("a-dep", "1.0.1")] });
    expect(barDev).toStrictEqual({});
  });

  test.concurrent("--filter selecting the root lists only the root's own dependencies", async () => {
    const dir = await setup("hoisted", {
      ...monorepoFiles,
      "package.json": JSON.stringify({
        name: "mono",
        private: true,
        workspaces: ["packages/*"],
        dependencies: { "one-dep": "1.0.0" },
      }),
    });

    const [rootOnly, all] = await Promise.all([licensesJson(dir, "--filter", "mono"), licensesJson(dir)]);
    expect(rootOnly).toStrictEqual({ Unknown: [u("no-deps", "1.0.1"), u("one-dep", "1.0.0")] });
    expect(all).toStrictEqual({
      MIT: fullJson.MIT,
      Unknown: [u("a-dep", "1.0.1"), u("no-deps", "1.0.0", "1.0.1"), u("one-dep", "1.0.0")],
    });
  });

  test.concurrent("--filter matching nothing is an error", async () => {
    const [stdout, stderr, exitCode] = await licenses(monoDir, "--filter", "nope", "--json");
    expect(stdout).toBe("");
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(
      `"error: No workspace packages matched the filter "nope""`,
    );
    expect(exitCode).toBe(1);
  });

  test.concurrent("--filter patterns that match nothing are reported when other patterns match", async () => {
    const [[stdout, stderr, exitCode], [text, textStderr, textExit]] = await Promise.all([
      licenses(monoDir, "--filter", "foo", "--filter", "nomatch", "--json"),
      licenses(monoDir, "--filter", "nomatch", "--filter", "alsonone", "-F", "bar"),
    ]);
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(
      `"warn: No workspace packages matched the filter "nomatch""`,
    );
    expect(stripPaths(JSON.parse(stdout))).toStrictEqual(fooJson);
    expect(exitCode).toBe(0);

    expect(normalizeBunSnapshot(textStderr)).toMatchInlineSnapshot(
      `"warn: No workspace packages matched the filters "nomatch", "alsonone""`,
    );
    expect(normalizeBunSnapshot(text)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      MIT (2)
      ├── path-parse@1.0.6
      └── resolve@1.9.0

      2 packages across 1 license (checked 2 packages in bun.lock)"
    `);
    expect(textExit).toBe(0);
  });

  test.concurrent("--filter is rejected by other pm subcommands and works outside a monorepo", async () => {
    const [[stdout, stderr, exitCode], filtered] = await Promise.all([
      pm(hoistedDir, "ls", "--filter", "foo"),
      licensesJson(hoistedDir, "--filter", "licenses-fixture"),
    ]);
    expect(stdout).toBe("");
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(
      `"error: --filter is only supported by \`bun pm licenses\`"`,
    );
    expect(exitCode).toBe(1);

    expect(filtered).toStrictEqual(fullJson);
  });

  test.concurrent("nothing to list prints what was checked and how long it took / {}", async () => {
    const [[stdout, stderr, exitCode], [json, jsonStderr, jsonExit], all] = await Promise.all([
      licenses(devOnlyDir, "--prod"),
      licenses(devOnlyDir, "--prod", "--json"),
      licensesJson(devOnlyDir),
    ]);
    expectEmptyText(stdout, 0);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(json).toBe("{}\n");
    expect(jsonStderr).toBe("");
    expect(jsonExit).toBe(0);
    expect(all).toStrictEqual({ Unknown: [u("no-deps", "1.0.0")] });
  });

  test.concurrent("nothing to list counts the lockfile packages that were checked but not installed", async () => {
    const dir = clone(hoistedDir);
    for (const name of ["a-dep", "no-deps", "one-dep", "path-parse", "resolve"])
      rmSync(nm(dir, name), { recursive: true });

    const [[stdout, stderr, exitCode], [json, jsonStderr, jsonExit]] = await Promise.all([
      licenses(dir),
      licenses(dir, "--json"),
    ]);
    expectEmptyText(stdout, 6);
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
      "warn: 6 packages in bun.lock are not installed and were skipped
      note: run 'bun install' first"
    `);
    expect(exitCode).toBe(0);

    expect(json).toBe("{}\n");
    expect(normalizeBunSnapshot(jsonStderr)).toBe(
      `warn: 6 packages in bun.lock are not installed and were skipped\n${MISSING_NOTE}`,
    );
    expect(jsonExit).toBe(0);
  });

  test.concurrent("--no-summary prints the bare listing without banner or summary", async () => {
    const [[stdout, stderr, exitCode], [empty, emptyStderr, emptyExit]] = await Promise.all([
      licenses(hoistedDir, "--no-summary"),
      licenses(devOnlyDir, "--prod", "--no-summary"),
    ]);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "MIT (2)
      ├── path-parse@1.0.6
      └── resolve@1.9.0

      Unknown (4)
      ├── a-dep@1.0.1 (dev)
      ├── no-deps@1.0.0
      ├── no-deps@1.0.1
      └── one-dep@1.0.0"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    // The empty listing keeps its message but drops the checked-count and timing.
    expect(empty).toBe("No packages to list\n");
    expect(emptyStderr).toBe("");
    expect(emptyExit).toBe(0);
  });

  test.concurrent("--silent still prints the listing but no diagnostics", async () => {
    const dir = clone(hoistedDir);
    rmSync(nm(dir, "path-parse"), { recursive: true });
    const [
      [loud, loudStderr, loudExit],
      [quiet, quietStderr, quietExit],
      [json, jsonStderr, jsonExit],
      [partial, partialStderr, partialExit],
    ] = await Promise.all([
      licenses(dir),
      licenses(dir, "--silent"),
      licenses(dir, "--silent", "--json"),
      licenses(monoDir, "--silent", "-F", "foo", "-F", "nomatch", "--json"),
    ]);
    expect(normalizeBunSnapshot(loudStderr)).toBe(
      `warn: 1 package in bun.lock is not installed and was skipped\n${MISSING_NOTE}`,
    );
    expect(quietStderr).toBe("");
    // The loud run wraps the same listing in the banner and summary.
    expect(loud).toContain(quiet);
    expect(normalizeBunSnapshot(loud)).toStartWith(HEADER);
    expect(normalizeBunSnapshot(quiet)).toMatchInlineSnapshot(`
      "MIT (1)
      └── resolve@1.9.0

      Unknown (4)
      ├── a-dep@1.0.1 (dev)
      ├── no-deps@1.0.0
      ├── no-deps@1.0.1
      └── one-dep@1.0.0"
    `);
    expect([loudExit, quietExit]).toStrictEqual([0, 0]);

    expect(jsonStderr).toBe("");
    expect(stripPaths(JSON.parse(json))).toStrictEqual({ MIT: [fullJson.MIT[1]], Unknown: fullJson.Unknown });
    expect(jsonExit).toBe(0);

    expect(partialStderr).toBe("");
    expect(stripPaths(JSON.parse(partial))).toStrictEqual(fooJson);
    expect(partialExit).toBe(0);
  });

  test.concurrent("--silent suppresses every error but keeps the exit code", async () => {
    const noNodeModules = clone(hoistedDir);
    rmSync(nm(noNodeModules), { recursive: true });
    const noLockfile = (await registry.createTestDir({ files: { "package.json": fixturePackageJson } })).packageDir;

    const cases: [string, string[]][] = [
      [noNodeModules, []],
      [noLockfile, []],
      [hoistedDir, ["--dev", "--prod"]],
      [monoDir, ["--filter", "nomatch"]],
      [monoDir, ["--filter", "nomatch", "--filter", "alsonone", "--json"]],
      [hoistedDir, ["bogus"]],
      [hoistedDir, ["list", "extra"]],
    ];
    const results = await Promise.all(cases.map(([cwd, args]) => licenses(cwd, "--silent", ...args)));
    for (const [i, [stdout, stderr, exitCode]] of results.entries()) {
      const [, args] = cases[i];
      expect({ args, stdout, stderr, exitCode }).toStrictEqual({ args, stdout: "", stderr: "", exitCode: 1 });
    }
  });

  test.concurrent("licenses list / ls aliases", async () => {
    const [[list, listStderr, listExit], [ls, lsStderr, lsExit], [stdout, stderr, exitCode]] = await Promise.all([
      licenses(hoistedDir, "list"),
      licenses(hoistedDir, "ls"),
      licenses(hoistedDir, "bogus"),
    ]);
    // The same listing as the bare `bun pm licenses` above.
    expect(normalizeBunSnapshot(list)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      MIT (2)
      ├── path-parse@1.0.6
      └── resolve@1.9.0

      Unknown (4)
      ├── a-dep@1.0.1 (dev)
      ├── no-deps@1.0.0
      ├── no-deps@1.0.1
      └── one-dep@1.0.0

      6 packages across 2 licenses (checked 6 packages in bun.lock)"
    `);
    expect(normalizeBunSnapshot(ls)).toBe(normalizeBunSnapshot(list));
    expect([listStderr, lsStderr]).toStrictEqual(["", ""]);
    expect([listExit, lsExit]).toStrictEqual([0, 0]);

    expect(stdout).toBe("");
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
      "error: unknown subcommand "bogus" for bun pm licenses
      note: did you mean 'bun pm licenses list'?"
    `);
    expect(exitCode).toBe(1);
  });

  test.concurrent("licenses list / ls reject extra arguments", async () => {
    const subcommands = ["list", "ls"];
    const results = await Promise.all(subcommands.map(subcommand => licenses(hoistedDir, subcommand, "extra")));
    for (const [i, [stdout, stderr, exitCode]] of results.entries()) {
      expect(stdout).toBe("");
      expect(normalizeBunSnapshot(stderr)).toBe(`error: bun pm licenses ${subcommands[i]} does not take arguments`);
      expect(exitCode).toBe(1);
    }
  });

  test.concurrent("missing lockfile", async () => {
    const { packageDir } = await registry.createTestDir({ files: { "package.json": fixturePackageJson } });
    const [stdout, stderr, exitCode] = await licenses(packageDir);
    expect(stdout).toBe("");
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
      "error: missing lockfile, nothing to list
      note: run 'bun install' first"
    `);
    expect(exitCode).toBe(1);
  });

  test.concurrent("missing node_modules", async () => {
    const dir = clone(hoistedDir);
    rmSync(nm(dir), { recursive: true });

    const results = await Promise.all([licenses(dir), licenses(dir, "--json"), licenses(dir, "list")]);
    for (const [stdout, stderr, exitCode] of results) {
      expect(stdout).toBe("");
      expect(normalizeBunSnapshot(stderr)).toBe(`error: node_modules not found, nothing to list\n${MISSING_NOTE}`);
      expect(exitCode).toBe(1);
    }
  });

  // pnpm#5702: a package that cannot be read must not fail the whole listing; the omission is reported instead of silent.
  test.concurrent(
    "unparsable package.json is reported as Unknown, missing ones are omitted with a warning",
    async () => {
      const dir = clone(hoistedDir);
      writeFileSync(nm(dir, "resolve", "package.json"), "{ not json");
      rmSync(nm(dir, "one-dep"), { recursive: true, force: true });

      const [stdout, stderr, exitCode] = await licenses(dir, "--json");
      expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
        "warn: 2 packages in bun.lock are not installed and were skipped
        note: run 'bun install' first"
      `);
      expect(stripPaths(JSON.parse(stdout))).toStrictEqual({
        MIT: [fullJson.MIT[0]],
        Unknown: [u("a-dep", "1.0.1"), u("no-deps", "1.0.0"), u("resolve", "1.9.0")],
      });
      expect(exitCode).toBe(0);
    },
  );

  test.concurrent("pnpm#8589: --prod after `bun install --production` finds packages hoisted differently", async () => {
    const dir = prodInstallDir;
    expect(JSON.parse(readFileSync(nm(dir, "a-dep", "package.json"), "utf8")).version).toBe("1.0.10");
    expect(existsSync(nm(dir, "uses-a-dep-10", "node_modules"))).toBeFalse();

    const parsed = await licensesJsonRaw(dir, "--prod");
    expect(pathsOf(parsed, "a-dep")).toStrictEqual([nm(dir, "a-dep")]);
    expect(stripPaths(parsed)).toStrictEqual({ Unknown: [u("a-dep", "1.0.10"), u("uses-a-dep-10", "1.0.0")] });
  });

  test.concurrent("pnpm#8589: a different version at the tree path is not misattributed", async () => {
    const dir = clone(prodInstallDir);
    patchInstalledManifest(dir, "a-dep", { license: "MIT" });

    const [stdout, stderr, exitCode] = await licenses(dir, "--json");
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
      "warn: 2 packages in bun.lock are not installed and were skipped
      note: run 'bun install' first"
    `);
    expect(stripPaths(JSON.parse(stdout))).toStrictEqual({
      MIT: [{ name: "a-dep", versions: ["1.0.10"], license: "MIT" }],
      Unknown: [u("uses-a-dep-10", "1.0.0")],
    });
    expect(exitCode).toBe(0);
  });

  // The lockfile nests bundled deps under their parent, which is also where the tarball unpacks them.
  test.concurrent.each(["hoisted", "isolated"] as Linker[])(
    "bundled dependencies are listed from inside their parent (%s)",
    async linker => {
      const dir = await setup(linker, { "package.json": pkg({ dependencies: { "bundled-1": "1.0.0" } }) });
      expect(existsSync(nm(dir, "bundled-1", "node_modules", "no-deps", "package.json"))).toBeTrue();

      const parsed = await licensesJsonRaw(dir);
      if (linker === "hoisted") {
        expect(pathsOf(parsed, "bundled-1")).toStrictEqual([nm(dir, "bundled-1")]);
        expect(pathsOf(parsed, "no-deps")).toStrictEqual([nm(dir, "bundled-1", "node_modules", "no-deps")]);
      } else {
        expect(pathsOf(parsed, "bundled-1")).toStrictEqual([store(dir, "bundled-1@1.0.0", "bundled-1")]);
        const noDepsPaths = pathsOf(parsed, "no-deps")!;
        expect(noDepsPaths).toBeArrayOfSize(1);
        expect(noDepsPaths[0]).toEndWith(join("bundled-1", "node_modules", "no-deps"));
      }
      expect(stripPaths(parsed)).toStrictEqual({ Unknown: [u("bundled-1", "1.0.0"), u("no-deps", "1.0.0")] });
    },
  );

  // pnpm#8739: git dependencies are looked up the same way the installer wrote them.
  test.concurrent.each(["hoisted", "isolated"] as Linker[])("git dependency is listed (%s)", async linker => {
    using repoDir = await gitRepo({ name: "git-pkg", version: "3.0.0", license: "ISC" });
    const dir = await setup(linker, {
      "package.json": pkg({ dependencies: { "no-deps": "1.0.0", "git-pkg": `git+${pathToFileURL(String(repoDir))}` } }),
    });

    const parsed = await licensesJsonRaw(dir);
    expect(Object.keys(parsed)).toStrictEqual(["ISC", "Unknown"]);
    const [gitPath] = pathsOf(parsed, "git-pkg")!;
    expect(stripPaths(parsed)).toStrictEqual({
      ISC: [{ name: "git-pkg", versions: [expect.stringContaining("git+file://")], license: "ISC" }],
      Unknown: [u("no-deps", "1.0.0")],
    });
    if (linker === "hoisted") {
      expect(gitPath).toBe(nm(dir, "git-pkg"));
    } else {
      expect(gitPath.startsWith(join(dir, "node_modules", ".bun") + sep)).toBeTrue();
      expect(gitPath).toEndWith(join("node_modules", "git-pkg"));
      expect(gitPath).not.toBe(nm(dir, "git-pkg"));
    }
  });

  test.concurrent("npm version sorts before a git resolution of the same name in text and --json", async () => {
    using repoDir = await gitRepo({ name: "no-deps", version: "9.9.9" });
    const dir = await setup("hoisted", {
      "package.json": pkg({ dependencies: { "no-deps": "1.0.0", "nd": `git+${pathToFileURL(String(repoDir))}` } }),
    });

    const [[stdout, stderr, exitCode], parsed] = await Promise.all([licenses(dir), licensesJsonRaw(dir)]);
    expect(normalizeBunSnapshot(stdout).replace(/git\+file:\/\/\S+/, "git+file://<repo>")).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      Unknown (2)
      ├── no-deps@1.0.0
      └── no-deps@git+file://<repo>

      2 packages across 1 license (checked 2 packages in bun.lock)"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    expect(parsed).toStrictEqual({
      Unknown: [
        {
          name: "no-deps",
          versions: ["1.0.0", expect.stringContaining("git+file://")],
          paths: [nm(dir, "no-deps"), nm(dir, "nd")],
          license: "Unknown",
        },
      ],
    });
  });

  test.concurrent.each(["hoisted", "isolated"] as Linker[])("tarball dependencies are listed (%s)", async linker => {
    const remoteUrl = `${registry.registryUrl()}a-dep/-/a-dep-1.0.1.tgz`;
    const { packageDir: dir } = await registry.createTestDir({
      bunfigOpts: { linker },
      files: {
        "package.json": pkg({
          dependencies: { "no-deps": "1.0.0", "pp": "file:./path-parse-1.0.6.tgz", "ad": remoteUrl },
        }),
      },
    });
    copyFileSync(join(registry.packagesPath, "path-parse", "path-parse-1.0.6.tgz"), join(dir, "path-parse-1.0.6.tgz"));
    await install(dir, linker);

    const parsed = await licensesJsonRaw(dir);
    const [ppPath] = pathsOf(parsed, "path-parse")!;
    const [adPath] = pathsOf(parsed, "a-dep")!;
    expect(stripPaths(parsed)).toStrictEqual({
      MIT: [{ ...fullJson.MIT[0], versions: ["./path-parse-1.0.6.tgz"] }],
      Unknown: [u("a-dep", remoteUrl), u("no-deps", "1.0.0")],
    });
    if (linker === "hoisted") {
      expect(ppPath).toBe(nm(dir, "pp"));
      expect(adPath).toBe(nm(dir, "ad"));
    } else {
      expect(ppPath).toBe(store(dir, "path-parse@.+path-parse-1.0.6.tgz", "path-parse"));
      expect(adPath).toBe(store(dir, `a-dep@${remoteUrl.replace(/[/:]/g, "+")}`, "a-dep"));
    }
  });

  test.concurrent("--omit=dev and bunfig install.production behave like --prod", async () => {
    const dir = clone(hoistedDir);
    const bunfig = readFileSync(join(dir, "bunfig.toml"), "utf8");
    expect(bunfig).toStartWith("[install]\n");
    writeFileSync(join(dir, "bunfig.toml"), bunfig.replace("[install]\n", "[install]\nproduction = true\n"));

    const [omitJson, omitText, omitSplitText, bunfigJson, bunfigText] = await Promise.all([
      licensesJson(hoistedDir, "--omit=dev"),
      licensesText(hoistedDir, "--omit=dev"),
      licensesText(hoistedDir, "--omit", "dev"),
      licensesJson(dir),
      licensesText(dir),
    ]);
    expect(omitJson).toStrictEqual(prodJson);
    // The same listing as `--prod` above.
    expect(normalizeBunSnapshot(omitText)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      MIT (2)
      ├── path-parse@1.0.6
      └── resolve@1.9.0

      Unknown (3)
      ├── no-deps@1.0.0
      ├── no-deps@1.0.1
      └── one-dep@1.0.0

      5 packages across 2 licenses (checked 5 packages in bun.lock)"
    `);
    expect(normalizeBunSnapshot(omitSplitText)).toBe(normalizeBunSnapshot(omitText));

    expect(bunfigJson).toStrictEqual(prodJson);
    expect(normalizeBunSnapshot(bunfigText)).toBe(normalizeBunSnapshot(omitText));
  });

  test.concurrent("--omit=optional drops the optionalDependencies closure", async () => {
    const dir = await setup("hoisted", {
      "package.json": pkg({ dependencies: { "no-deps": "1.0.0" }, optionalDependencies: { "one-dep": "1.0.0" } }),
    });

    const [all, omitJson, omitText] = await Promise.all([
      licensesJson(dir),
      licensesJson(dir, "--omit=optional"),
      licensesText(dir, "--omit=optional"),
    ]);
    expect(all).toStrictEqual({ Unknown: [u("no-deps", "1.0.0", "1.0.1"), u("one-dep", "1.0.0")] });
    expect(omitJson).toStrictEqual({ Unknown: [u("no-deps", "1.0.0")] });
    expect(normalizeBunSnapshot(omitText)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      Unknown (1)
      └── no-deps@1.0.0

      1 package across 1 license (checked 1 package in bun.lock)"
    `);
  });

  test.concurrent("packages reachable only through peerDependencies are listed; --omit=peer drops them", async () => {
    const [dir, transitive] = await Promise.all([
      setup("hoisted", { "package.json": pkg({ peerDependencies: { "no-deps": "1.0.0" } }) }),
      setup("hoisted", { "package.json": pkg({ dependencies: { "has-peer": "1.0.0" } }) }),
    ]);
    expect(existsSync(nm(dir, "no-deps", "package.json"))).toBeTrue();

    const [all, text, omitText, omitJson, transitiveAll, transitiveOmit] = await Promise.all([
      licensesJson(dir),
      licensesText(dir),
      licensesText(dir, "--omit=peer"),
      licensesJson(dir, "--omit=peer"),
      licensesJson(transitive),
      licensesJson(transitive, "--omit=peer"),
    ]);
    expect(all).toStrictEqual({ Unknown: [u("no-deps", "1.0.0")] });
    expect(normalizeBunSnapshot(text)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      Unknown (1)
      └── no-deps@1.0.0

      1 package across 1 license (checked 1 package in bun.lock)"
    `);
    expectEmptyText(omitText, 0);
    expect(omitJson).toStrictEqual({});

    expect(transitiveAll).toStrictEqual({ Unknown: [u("has-peer", "1.0.0"), u("peer-no-deps", "1.0.1")] });
    expect(transitiveOmit).toStrictEqual({ Unknown: [u("has-peer", "1.0.0")] });
  });

  test.concurrent("hoisted linker: scoped packages at their tree location and found by the disk scan", async () => {
    const dir = await setup("hoisted", { "package.json": pkg({ dependencies: { "two-range-deps": "1.0.0" } }) });
    const expected = { Unknown: [u("@types/is-number", "2.0.0"), u("no-deps", "1.1.0"), u("two-range-deps", "1.0.0")] };

    const installed = await licensesJsonRaw(dir);
    expect(pathsOf(installed, "@types/is-number")).toStrictEqual([nm(dir, "@types", "is-number")]);
    expect(stripPaths(installed)).toStrictEqual(expected);

    renameSync(nm(dir, "@types", "is-number"), nm(dir, "@types", "renamed"));
    const renamed = await licensesJsonRaw(dir);
    expect(pathsOf(renamed, "@types/is-number")).toStrictEqual([nm(dir, "@types", "renamed")]);
    expect(stripPaths(renamed)).toStrictEqual(expected);

    mkdirSync(nm(dir, "two-range-deps", "node_modules"));
    renameSync(nm(dir, "@types"), nm(dir, "two-range-deps", "node_modules", "@types"));
    const nested = await licensesJsonRaw(dir);
    expect(pathsOf(nested, "@types/is-number")).toStrictEqual([
      nm(dir, "two-range-deps", "node_modules", "@types", "renamed"),
    ]);
    expect(stripPaths(nested)).toStrictEqual(expected);
  });

  test.concurrent("Auto linker resolves to isolated for a workspace project", async () => {
    const { packageDir: dir } = await registry.createTestDir({ bunfigOpts: {}, files: monorepoFiles });
    await using proc = spawn({
      cmd: [bunExe(), "install"],
      env: installEnv(dir),
      cwd: dir,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [installStderr, installExit] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(installStderr).not.toContain("error:");
    expect(installExit).toBe(0);
    expect(existsSync(nm(dir, ".bun", "no-deps@1.0.0"))).toBeTrue();

    const parsed = await licensesJsonRaw(dir);
    expect(Object.fromEntries(entriesOf(parsed).map(entry => [entry.name, entry.paths]))).toStrictEqual({
      "path-parse": [store(dir, "path-parse@1.0.6", "path-parse")],
      "resolve": [store(dir, "resolve@1.9.0", "resolve")],
      "a-dep": [store(dir, "a-dep@1.0.1", "a-dep")],
      "no-deps": [store(dir, "no-deps@1.0.0", "no-deps")],
    });
    expect(stripPaths(parsed)).toStrictEqual(monoJson);
  });

  test.concurrent("one missing package is reported in the singular", async () => {
    const dir = clone(hoistedDir);
    rmSync(nm(dir, "a-dep"), { recursive: true });

    const [stdout, stderr, exitCode] = await licenses(dir, "--json");
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
      "warn: 1 package in bun.lock is not installed and was skipped
      note: run 'bun install' first"
    `);
    expect(stripPaths(JSON.parse(stdout))).toStrictEqual(prodJson);
    expect(exitCode).toBe(0);
  });

  test.concurrent("hoisted linker falls back to a node_modules/.bun store entry", async () => {
    const dir = clone(hoistedDir);
    mkdirSync(store(dir, "a-dep@1.0.1"), { recursive: true });
    renameSync(nm(dir, "a-dep"), store(dir, "a-dep@1.0.1", "a-dep"));

    const parsed = await licensesJsonRaw(dir);
    expect(pathsOf(parsed, "a-dep")).toStrictEqual([store(dir, "a-dep@1.0.1", "a-dep")]);
    expect(stripPaths(parsed)).toStrictEqual(fullJson);
  });

  test.concurrent("an installed manifest without a version is listed under the lockfile version", async () => {
    const dir = clone(hoistedDir);
    patchInstalledManifest(dir, "resolve", { version: undefined });

    const parsed = await licensesJsonRaw(dir);
    expect(pathsOf(parsed, "resolve")).toStrictEqual([nm(dir, "resolve")]);
    expect(stripPaths(parsed)).toStrictEqual(fullJson);
  });

  test.concurrent("author objects: name/email/url combinations; an empty object omits the author", async () => {
    const dir = clone(hoistedDir);
    patchInstalledManifest(dir, "a-dep", {
      author: { name: "Ann", email: "ann@example.com", url: "https://ann.example" },
    });
    patchInstalledManifest(dir, "one-dep", { author: { email: "one@example.com" } });
    patchInstalledManifest(dir, "one-dep/node_modules/no-deps", { author: { url: "https://nd.example" } });
    patchInstalledManifest(dir, "resolve", { author: {} });

    const [json, longText] = await Promise.all([licensesJson(dir), licensesText(dir, "--long")]);
    expect(json).toStrictEqual({
      MIT: [
        fullJson.MIT[0],
        {
          name: "resolve",
          versions: ["1.9.0"],
          license: "MIT",
          homepage: resolveHomepage,
          description: resolveDescription,
        },
      ],
      Unknown: [
        { ...u("a-dep", "1.0.1"), author: "Ann <ann@example.com> (https://ann.example)" },
        { ...u("no-deps", "1.0.0", "1.0.1"), author: "(https://nd.example)" },
        { ...u("one-dep", "1.0.0"), author: "<one@example.com>" },
      ],
    });
    expect(normalizeBunSnapshot(longText)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      MIT (2)
      ├── path-parse@1.0.6
      │   Javier Blanco <http://jbgutierrez.info>
      │   Node.js path.parse() ponyfill
      │   https://github.com/jbgutierrez/path-parse#readme
      └── resolve@1.9.0
          resolve like require.resolve() on behalf of files asynchronously and synchronously
          git://github.com/browserify/resolve.git

      Unknown (4)
      ├── a-dep@1.0.1 (dev)
      │   Ann <ann@example.com> (https://ann.example)
      ├── no-deps@1.0.0
      ├── no-deps@1.0.1
      │   (https://nd.example)
      └── one-dep@1.0.0
          <one@example.com>

      6 packages across 2 licenses (checked 6 packages in bun.lock)"
    `);
  });

  test.concurrent("--filter matching nothing lists every pattern", async () => {
    const [stdout, stderr, exitCode] = await licenses(monoDir, "--filter", "nope", "--filter", "nada");
    expect(stdout).toBe("");
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(
      `"error: No workspace packages matched the filters "nope", "nada""`,
    );
    expect(exitCode).toBe(1);
  });

  test.concurrent("--json is pretty-printed with inline versions and paths arrays", async () => {
    const [stdout, stderr, exitCode] = await licenses(hoistedDir, "--json");
    expect(stderr).toBe("");
    const dirInJson = JSON.stringify(hoistedDir).slice(1, -1);
    expect(stdout.split(dirInJson).length).toBe(7);
    expect(stdout.replaceAll(dirInJson, "<dir>").replaceAll("\\\\", "/")).toMatchInlineSnapshot(`
      "{
        "MIT": [
          {
            "name": "path-parse",
            "versions": ["1.0.6"],
            "paths": ["<dir>/node_modules/path-parse"],
            "license": "MIT",
            "author": "Javier Blanco <http://jbgutierrez.info>",
            "description": "Node.js path.parse() ponyfill",
            "homepage": "https://github.com/jbgutierrez/path-parse#readme"
          },
          {
            "name": "resolve",
            "versions": ["1.9.0"],
            "paths": ["<dir>/node_modules/resolve"],
            "license": "MIT",
            "author": "James Halliday <mail@substack.net> (http://substack.net)",
            "description": "resolve like require.resolve() on behalf of files asynchronously and synchronously",
            "homepage": "git://github.com/browserify/resolve.git"
          }
        ],
        "Unknown": [
          {
            "name": "a-dep",
            "versions": ["1.0.1"],
            "paths": ["<dir>/node_modules/a-dep"],
            "license": "Unknown"
          },
          {
            "name": "no-deps",
            "versions": ["1.0.0", "1.0.1"],
            "paths": ["<dir>/node_modules/no-deps", "<dir>/node_modules/one-dep/node_modules/no-deps"],
            "license": "Unknown"
          },
          {
            "name": "one-dep",
            "versions": ["1.0.0"],
            "paths": ["<dir>/node_modules/one-dep"],
            "license": "Unknown"
          }
        ]
      }
      "
    `);
    expect(exitCode).toBe(0);
  });

  test.concurrent("a bun.lockb project is read without writing bun.lock or touching bun.lockb", async () => {
    const { packageDir: dir } = await registry.createTestDir({
      bunfigOpts: { linker: "hoisted", saveTextLockfile: false },
      files: { "package.json": fixturePackageJson },
    });
    await install(dir, "hoisted");
    expect(existsSync(join(dir, "bun.lock"))).toBeFalse();
    const lockbBefore = readFileSync(join(dir, "bun.lockb"));
    const packageJsonBefore = readFileSync(join(dir, "package.json"));

    const [json, text] = await Promise.all([licensesJson(dir), licensesText(dir)]);
    expect(json).toStrictEqual(fullJson);
    expect(normalizeBunSnapshot(text)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      MIT (2)
      ├── path-parse@1.0.6
      └── resolve@1.9.0

      Unknown (4)
      ├── a-dep@1.0.1 (dev)
      ├── no-deps@1.0.0
      ├── no-deps@1.0.1
      └── one-dep@1.0.0

      6 packages across 2 licenses (checked 6 packages in bun.lock)"
    `);
    expect(existsSync(join(dir, "bun.lock"))).toBeFalse();
    expect(readFileSync(join(dir, "bun.lockb")).equals(lockbBefore)).toBeTrue();
    expect(readFileSync(join(dir, "package.json")).equals(packageJsonBefore)).toBeTrue();
  });

  test.concurrent("bun pm help lists licenses and its flags", async () => {
    const results = await Promise.all([pm(hoistedDir), pm(hoistedDir, "--help")]);
    for (const [stdout, stderr, exitCode] of results) {
      const start = stdout.indexOf("bun pm licenses");
      const end = stdout.indexOf("bun pm whoami");
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      const block = stdout.slice(start, end);
      for (const flag of ["--json", "--prod", "--dev", "--long", "--filter"]) expect(block).toContain(flag);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    }
  });
});
