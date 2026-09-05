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

// Text output is printable text and newlines; any other C0 byte, DEL or C1 character came through from a package.json unescaped.
const RAW_CONTROL = /[\x00-\x09\x0b-\x1f\x7f\x80-\x9f]/;

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

function stripPaths(parsed: Record<string, LicenseEntry[]>) {
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
  return parsed as Record<string, LicenseEntry[]>;
}

async function licensesJson(dir: string, ...args: string[]) {
  return stripPaths(await licensesJsonRaw(dir, ...args));
}

async function licensesEntries(dir: string, ...args: string[]): Promise<LicenseEntry[]> {
  return Object.values(await licensesJsonRaw(dir, ...args)).flat();
}

function pathsOf(entries: LicenseEntry[], name: string) {
  return entries.find(entry => entry.name === name)!.paths;
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

function names(parsed: Record<string, { name: string }[]>) {
  return Object.values(parsed)
    .flat()
    .map(entry => entry.name)
    .sort();
}

const u = (name: string, ...versions: string[]): LicenseEntry => ({ name, versions, license: "Unknown" });

// On Linux/Windows installed files are hardlinks into the cache; unlink first so the cache copy is left alone.
function overwriteInstalledManifest(dir: string, pkg: string, contents: string) {
  const path = join(dir, "node_modules", pkg, "package.json");
  rmSync(path);
  writeFileSync(path, contents);
}

function patchInstalledManifest(dir: string, pkg: string, fields: Record<string, unknown>) {
  const path = join(dir, "node_modules", pkg, "package.json");
  const manifest = { ...JSON.parse(readFileSync(path, "utf8")), ...fields };
  for (const [key, value] of Object.entries(fields)) if (value === undefined) delete manifest[key];
  overwriteInstalledManifest(dir, pkg, JSON.stringify(manifest));
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

const prodJson = {
  MIT: fullJson.MIT,
  Unknown: [u("no-deps", "1.0.0", "1.0.1"), u("one-dep", "1.0.0")],
};

const monoJson = { MIT: fullJson.MIT, Unknown: [u("a-dep", "1.0.1"), u("no-deps", "1.0.0")] };
const fooJson = { Unknown: [u("a-dep", "1.0.1"), u("no-deps", "1.0.0")] };
const barJson = { MIT: fullJson.MIT };
const monoNames = ["a-dep", "no-deps", "path-parse", "resolve"];

describe("bun pm licenses", () => {
  let hoistedDir: string;
  let monoDir: string;

  beforeAll(async () => {
    [hoistedDir, monoDir] = await Promise.all([setup(), setup("hoisted", monorepoFiles)]);
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
    expect(parsed).toStrictEqual({
      MIT: [
        { ...fullJson.MIT[0], paths: [nm(hoistedDir, "path-parse")] },
        { ...fullJson.MIT[1], paths: [nm(hoistedDir, "resolve")] },
      ],
      Unknown: [
        { ...u("a-dep", "1.0.1"), paths: [nm(hoistedDir, "a-dep")] },
        {
          ...u("no-deps", "1.0.0", "1.0.1"),
          paths: [nm(hoistedDir, "no-deps"), nm(hoistedDir, "one-dep", "node_modules", "no-deps")],
        },
        { ...u("one-dep", "1.0.0"), paths: [nm(hoistedDir, "one-dep")] },
      ],
    });
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
    const dir = await setup();
    patchInstalledManifest(dir, "a-dep", { license: { type: "BSD-3-Clause", url: "x" } });
    patchInstalledManifest(dir, "one-dep", { licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] });
    patchInstalledManifest(dir, "no-deps", { licenses: { type: "ISC" } });

    const parsed = await licensesJson(dir);
    expect(Object.keys(parsed)).toStrictEqual(["BSD-3-Clause", "ISC", "MIT", "(MIT OR Apache-2.0)", "Unknown"]);
    expect(parsed["ISC"]).toStrictEqual([{ name: "no-deps", versions: ["1.0.0"], license: "ISC" }]);
    expect(parsed["Unknown"]).toStrictEqual([u("no-deps", "1.0.1")]);
    expect(parsed["(MIT OR Apache-2.0)"]).toStrictEqual([
      { name: "one-dep", versions: ["1.0.0"], license: "(MIT OR Apache-2.0)" },
    ]);
    expect(parsed["BSD-3-Clause"]).toStrictEqual([{ name: "a-dep", versions: ["1.0.1"], license: "BSD-3-Clause" }]);
    expect(parsed["MIT"].map(entry => entry.name)).toStrictEqual(["path-parse", "resolve"]);
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

    const [stdout, stderr, exitCode] = await licenses(dir);
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

    const parsed = await licensesJson(dir);
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
    const dir = await setup();
    patchInstalledManifest(dir, "a-dep", { license: [{ type: "MIT" }, { type: "Apache-2.0" }] });
    patchInstalledManifest(dir, "one-dep", { licenses: [{ name: "ISC" }] });
    patchInstalledManifest(dir, "no-deps", { license: ["BSD-2-Clause"] });
    patchInstalledManifest(dir, "one-dep/node_modules/no-deps", { license: { name: "0BSD" } });

    const parsed = await licensesJson(dir);
    expect(parsed["(MIT OR Apache-2.0)"]).toStrictEqual([
      { name: "a-dep", versions: ["1.0.1"], license: "(MIT OR Apache-2.0)" },
    ]);
    expect(parsed["ISC"]).toStrictEqual([{ name: "one-dep", versions: ["1.0.0"], license: "ISC" }]);
    expect(parsed["BSD-2-Clause"]).toStrictEqual([{ name: "no-deps", versions: ["1.0.0"], license: "BSD-2-Clause" }]);
    expect(parsed["0BSD"]).toStrictEqual([{ name: "no-deps", versions: ["1.0.1"], license: "0BSD" }]);
    expect(parsed).not.toHaveProperty("Unknown");
  });

  test.concurrent("empty `license` falls through to `licenses`; `license` wins when both are present", async () => {
    const dir = await setup();
    patchInstalledManifest(dir, "a-dep", { license: "", licenses: [{ type: "MIT" }] });
    patchInstalledManifest(dir, "one-dep", { license: "Apache-2.0", licenses: [{ type: "MIT" }] });

    const parsed = await licensesJson(dir);
    expect(parsed["MIT"].map(entry => entry.name)).toStrictEqual(["a-dep", "path-parse", "resolve"]);
    expect(parsed["Apache-2.0"]).toStrictEqual([{ name: "one-dep", versions: ["1.0.0"], license: "Apache-2.0" }]);
  });

  test.concurrent("non-string license shapes are Unknown; entries with non-string type are skipped", async () => {
    const dir = await setup();
    patchInstalledManifest(dir, "a-dep", { license: 42 });
    patchInstalledManifest(dir, "one-dep", { licenses: [] });
    patchInstalledManifest(dir, "no-deps", { licenses: [{ url: "x" }] });
    patchInstalledManifest(dir, "resolve", { license: undefined, licenses: [{ type: 42 }, { type: "MIT" }] });

    const parsed = await licensesJson(dir);
    expect(parsed).toStrictEqual(fullJson);
  });

  test.concurrent("repeated legacy entries are not deduplicated", async () => {
    const dir = await setup();
    patchInstalledManifest(dir, "one-dep", { licenses: [{ type: "MIT" }, { type: "MIT" }, { type: "Apache-2.0" }] });

    const parsed = await licensesJson(dir);
    expect(parsed["(MIT OR MIT OR Apache-2.0)"]).toStrictEqual([
      { name: "one-dep", versions: ["1.0.0"], license: "(MIT OR MIT OR Apache-2.0)" },
    ]);
  });

  test.concurrent("one package with two versions: per-license grouping, metadata from the newest version", async () => {
    const dir = await setup();
    patchInstalledManifest(dir, "no-deps", { license: "MIT", homepage: "https://example.com/old" });
    patchInstalledManifest(dir, "one-dep/node_modules/no-deps", {
      license: "MIT",
      homepage: "https://example.com/new",
    });

    const parsed = await licensesJson(dir);
    expect(parsed["MIT"]).toStrictEqual([
      { name: "no-deps", versions: ["1.0.0", "1.0.1"], license: "MIT", homepage: "https://example.com/new" },
      ...fullJson.MIT,
    ]);
    expect(parsed["Unknown"]).toStrictEqual([u("a-dep", "1.0.1"), u("one-dep", "1.0.0")]);
    expect(pathsOf(await licensesEntries(dir), "no-deps")).toStrictEqual([
      nm(dir, "no-deps"),
      nm(dir, "one-dep", "node_modules", "no-deps"),
    ]);
  });

  test.concurrent("--json `license` follows each version's group; an empty description is omitted", async () => {
    const dir = await setup();
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

    const [stdout, stderr, exitCode] = await licenses(dir);
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

    const parsed = await licensesJson(dir);
    expect(parsed["Unknown"][0]).toStrictEqual(u("a-dep", "1.0.9", "1.0.10"));
  });

  test.concurrent("(dev) marks packages only reachable through devDependencies", async () => {
    const dir = await setup("hoisted", {
      "package.json": pkg({ dependencies: { "a-dep": "1.0.9" }, devDependencies: { "uses-a-dep-9": "1.0.0" } }),
    });

    const [stdout, stderr, exitCode] = await licenses(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      Unknown (2)
      ├── a-dep@1.0.9
      └── uses-a-dep-9@1.0.0 (dev)

      2 packages across 1 license (checked 2 packages in bun.lock)"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    expect(await licensesText(dir, "--prod")).not.toContain("(dev)");

    const [json, jsonStderr, jsonExit] = await licenses(dir, "--json");
    expect(jsonStderr).toBe("");
    expect(json).not.toContain("(dev)");
    expect(json).not.toContain('"dev"');
    expect(stripPaths(JSON.parse(json))).toStrictEqual({ Unknown: [u("a-dep", "1.0.9"), u("uses-a-dep-9", "1.0.0")] });
    expect(jsonExit).toBe(0);

    expect(await licensesJson(dir, "--dev")).toStrictEqual({
      Unknown: [u("a-dep", "1.0.9"), u("uses-a-dep-9", "1.0.0")],
    });
    expect(normalizeBunSnapshot(await licensesText(dir, "--dev"))).toMatchInlineSnapshot(`
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

    expect(normalizeBunSnapshot(await licensesText(dir))).toMatchInlineSnapshot(`
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

    expect(normalizeBunSnapshot(await licensesText(dir, "--dev"))).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      Unknown (4)
      ├── a-dep@1.0.9 (dev)
      ├── no-deps@1.0.1
      ├── one-dep@1.0.0 (dev)
      └── uses-a-dep-9@1.0.0 (dev)

      4 packages across 1 license (checked 4 packages in bun.lock)"
    `);
    expect(await licensesJson(dir, "--dev")).toStrictEqual({
      Unknown: [u("a-dep", "1.0.9"), u("no-deps", "1.0.1"), u("one-dep", "1.0.0"), u("uses-a-dep-9", "1.0.0")],
    });
  });

  test.concurrent("--dev lists the devDependencies closure", async () => {
    const dir = await setup("hoisted", {
      "package.json": pkg({ dependencies: { "no-deps": "1.0.0" }, devDependencies: { "one-dep": "1.0.0" } }),
    });

    const expected = { Unknown: [u("no-deps", "1.0.1"), u("one-dep", "1.0.0")] };
    expect(await licensesJson(dir, "--dev")).toStrictEqual(expected);
    expect(await licensesJson(dir, "-D")).toStrictEqual(expected);
    expect(normalizeBunSnapshot(await licensesText(dir, "--dev"))).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      Unknown (2)
      ├── no-deps@1.0.1 (dev)
      └── one-dep@1.0.0 (dev)

      2 packages across 1 license (checked 2 packages in bun.lock)"
    `);

    expect(normalizeBunSnapshot(await licensesText(hoistedDir, "--dev"))).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      Unknown (1)
      └── a-dep@1.0.1 (dev)

      1 package across 1 license (checked 1 package in bun.lock)"
    `);
    expect(await licensesJson(hoistedDir, "--dev")).toStrictEqual({ Unknown: [u("a-dep", "1.0.1")] });
  });

  test.concurrent("--dev in a workspace", async () => {
    expect(await licensesJson(monoDir, "--dev")).toStrictEqual({ Unknown: [u("a-dep", "1.0.1")] });
    expect(await licensesJson(join(monoDir, "packages", "foo"), "--dev")).toStrictEqual({
      Unknown: [u("a-dep", "1.0.1")],
    });

    const bar = join(monoDir, "packages", "bar");
    expectEmptyText(await licensesText(bar, "--dev"), 0);
    expect(await licensesJson(bar, "--dev")).toStrictEqual({});
  });

  test.concurrent("--dev cannot be combined with --prod", async () => {
    for (const args of [
      ["--dev", "--prod"],
      ["--dev", "--omit=dev"],
      ["--prod", "--dev", "--json"],
    ]) {
      const [stdout, stderr, exitCode] = await licenses(hoistedDir, ...args);
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

    expect(await licensesJson(dir, "--prod")).toStrictEqual({
      Unknown: [u("no-deps", "1.0.0", "1.0.1"), u("one-dep", "1.0.0")],
    });
    expect(names(await licensesJson(dir))).toStrictEqual(["a-dep", "no-deps", "one-dep"]);
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
    const [stdout, stderr, exitCode] = await licenses(hoistedDir, "--long");
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

    expect(normalizeBunSnapshot(await licensesText(hoistedDir, "ls", "--long"))).toBe(normalizeBunSnapshot(stdout));
    expect(stdout).not.toContain(nm(hoistedDir));

    const [plainJson, longJson] = await Promise.all([
      licensesText(hoistedDir, "--json"),
      licensesText(hoistedDir, "--long", "--json"),
    ]);
    expect(longJson).toBe(plainJson);
    expect(stripPaths(JSON.parse(longJson))).toStrictEqual(fullJson);
  });

  test.concurrent("--long details are per version in text; --json takes them from the newest version", async () => {
    const dir = await setup();
    patchInstalledManifest(dir, "no-deps", { description: "only a description" });
    patchInstalledManifest(dir, "a-dep", { author: { name: "Ann", email: "ann@example.com" } });

    const first = await licensesText(dir, "--long");
    expect(first).toContain(
      "├── a-dep@1.0.1 (dev)\n│   Ann <ann@example.com>\n├── no-deps@1.0.0\n│   only a description\n├── no-deps@1.0.1\n└── one-dep@1.0.0\n",
    );
    expect(await licensesJson(dir)).toStrictEqual({
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

    const second = await licensesText(dir, "--long");
    expect(second).toContain(
      "├── no-deps@1.0.0\n│   only a description\n├── no-deps@1.0.1\n│   newest wins\\nline two\n│   https://example.com/new\n└── one-dep@1.0.0\n",
    );
    expect(second.split("\n").some(line => line.startsWith("line two"))).toBeFalse();
    const parsed = await licensesJson(dir);
    expect(parsed.Unknown[1]).toStrictEqual({
      ...u("no-deps", "1.0.0", "1.0.1"),
      homepage: "https://example.com/new",
      description: "newest wins\nline two",
    });
    expect(JSON.stringify(parsed)).not.toContain("only a description");
  });

  test.concurrent("`repository` stands in for a missing `homepage`; `homepage` wins when both are set", async () => {
    const dir = await setup();
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

    expect(await licensesJson(dir)).toStrictEqual({
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
    expect(normalizeBunSnapshot(await licensesText(dir, "--long"))).toMatchInlineSnapshot(`
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
    "control characters from package.json are escaped in text output but preserved in --json",
    async () => {
      const dir = await setup();
      const evilLicense = "MIT\u001b[31m\nEVIL";
      patchInstalledManifest(dir, "a-dep", { license: evilLicense, description: "tab\there\r\n" });
      patchInstalledManifest(dir, "one-dep", { license: "ISC\nGPL-3.0" });
      patchInstalledManifest(dir, "no-deps", { license: "BSD\t2" });

      // --no-summary drops the "bun pm licenses v<version> (<short sha>)" banner. A short sha can be all
      // digits, and the banner would then pass the group-header filter below.
      const stdout = await licensesText(dir, "--long", "--no-summary");
      expect(stdout).not.toMatch(RAW_CONTROL);
      expect(stdout).toContain("MIT\\x1b[31m\\nEVIL (1)\n└── a-dep@1.0.1 (dev)\n    tab\\there\\r\\n\n");
      expect(stdout).toContain("ISC\\nGPL-3.0 (1)\n└── one-dep@1.0.0\n");
      expect(stdout).toContain("BSD\\t2 (1)\n└── no-deps@1.0.0\n");
      expect(stdout.split("\n").filter(line => / \(\d+\)$/.test(line))).toStrictEqual([
        "BSD\\t2 (1)",
        "ISC\\nGPL-3.0 (1)",
        "MIT (2)",
        "MIT\\x1b[31m\\nEVIL (1)",
        "Unknown (1)",
      ]);
      expect(stdout.split("\n").some(line => line.startsWith("GPL-3.0") || line.startsWith("EVIL"))).toBeFalse();

      const parsed = await licensesJson(dir);
      expect(Object.keys(parsed)).toStrictEqual(["BSD\t2", "ISC\nGPL-3.0", "MIT", evilLicense, "Unknown"]);
      expect(parsed[evilLicense]).toStrictEqual([
        { name: "a-dep", versions: ["1.0.1"], license: evilLicense, description: "tab\there\r\n" },
      ]);
      expect(parsed["ISC\nGPL-3.0"]).toStrictEqual([{ name: "one-dep", versions: ["1.0.0"], license: "ISC\nGPL-3.0" }]);
      expect(parsed["BSD\t2"]).toStrictEqual([{ name: "no-deps", versions: ["1.0.0"], license: "BSD\t2" }]);
      expect(parsed.Unknown).toStrictEqual([u("no-deps", "1.0.1")]);
    },
  );

  test.concurrent("--long escapes control characters in author, description and homepage", async () => {
    const dir = await setup();
    const author = "Eve\u001b]8;;https://evil.example\u0007click\u001b]8;;\u0007";
    const description = "first\r\nsecond";
    const homepage = "https://example.com/\u001b[2Jx";
    patchInstalledManifest(dir, "a-dep", { author, description, homepage });

    const stdout = await licensesText(dir, "--long");
    expect(stdout).not.toMatch(RAW_CONTROL);
    expect(stdout).toContain(
      "├── a-dep@1.0.1 (dev)\n" +
        "│   Eve\\x1b]8;;https://evil.example\\x07click\\x1b]8;;\\x07\n" +
        "│   first\\r\\nsecond\n" +
        "│   https://example.com/\\x1b[2Jx\n" +
        "├── no-deps@1.0.0\n",
    );
    expect(stdout.split("\n").some(line => line.startsWith("second"))).toBeFalse();

    expect((await licensesJson(dir)).Unknown[0]).toStrictEqual({
      ...u("a-dep", "1.0.1"),
      author,
      description,
      homepage,
    });
  });

  // U+009B is the one-character form of ESC [ and, unlike the ASCII controls above, is accepted in a file name and a
  // package name, so a tarball carries it into both halves of the name@version column. A backslash and U+00A9 (encoded
  // with the same lead byte as U+009B) must come through unchanged.
  test.concurrent(
    "C1 controls and DEL are escaped in the license, the name@version column and --long fields",
    async () => {
      const C1 = "\u009b";
      const manifest = {
        name: `dep-${C1}`,
        version: "1.0.0",
        license: `MIT${C1}31m`,
        author: `Eve${C1}2J \\ \u007f \u00a9`,
        description: `one${C1}two`,
        homepage: `https://example.com/${C1}x`,
      };
      const tarball = `dep-${C1}.tgz`;
      const { packageDir: dir } = await registry.createTestDir({
        bunfigOpts: { linker: "hoisted" },
        files: { "package.json": pkg({ dependencies: { dep: `file:./${tarball}` } }) },
      });
      const archive = new Bun.Archive({ "package/package.json": JSON.stringify(manifest) }, { compress: "gzip" });
      writeFileSync(join(dir, tarball), await archive.bytes());
      await install(dir, "hoisted");

      const stdout = await licensesText(dir, "--long");
      expect(stdout).not.toMatch(RAW_CONTROL);
      expect(stdout).toContain(
        "MIT\\u009b31m (1)\n" +
          "└── dep-\\u009b@./dep-\\u009b.tgz\n" +
          "    Eve\\u009b2J \\ \\x7f \u00a9\n" +
          "    one\\u009btwo\n" +
          "    https://example.com/\\u009bx\n",
      );

      const { name, license, author, description, homepage } = manifest;
      expect(await licensesJson(dir)).toStrictEqual({
        [license]: [{ name, versions: [`./${tarball}`], license, author, description, homepage }],
      });
    },
  );

  test.concurrent("isolated linker matches hoisted: marker, --dev and --long", async () => {
    const dir = await setup("isolated");
    const [[expected], [stdout, stderr, exitCode]] = await Promise.all([licenses(hoistedDir), licenses(dir)]);
    expect(normalizeBunSnapshot(stdout)).toBe(normalizeBunSnapshot(expected));
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

    const [isoLong, hoistedLong, isoDev, hoistedDev, isoDevJson, hoistedDevJson, isoLongJson, hoistedLongJson] =
      await Promise.all([
        licensesText(dir, "--long"),
        licensesText(hoistedDir, "--long"),
        licensesText(dir, "--dev"),
        licensesText(hoistedDir, "--dev"),
        licensesJson(dir, "--dev"),
        licensesJson(hoistedDir, "--dev"),
        licensesJson(dir, "--long"),
        licensesJson(hoistedDir, "--long"),
      ]);
    expect(normalizeBunSnapshot(isoLong)).toBe(normalizeBunSnapshot(hoistedLong));
    expect(normalizeBunSnapshot(isoDev)).toBe(normalizeBunSnapshot(hoistedDev));
    expect(isoDevJson).toStrictEqual(hoistedDevJson);
    expect(isoLongJson).toStrictEqual(hoistedLongJson);
    expect(isoLong).toContain("│   Javier Blanco <http://jbgutierrez.info>\n");
  });

  test.concurrent("isolated linker matches hoisted: --filter in a workspace", async () => {
    const isoMono = await setup("isolated", monorepoFiles);
    const [isoJson, hoistedJson, isoText] = await Promise.all([
      licensesJson(isoMono, "--filter", "foo"),
      licensesJson(monoDir, "--filter", "foo"),
      licensesText(isoMono, "--filter", "foo"),
    ]);
    expect(isoJson).toStrictEqual(hoistedJson);
    expect(isoText).toContain("├── a-dep@1.0.1 (dev)\n└── no-deps@1.0.0\n");
  });

  test.concurrent("isolated linker: scoped transitive dependency is found through the store", async () => {
    const dir = await setup("isolated", { "package.json": pkg({ dependencies: { "two-range-deps": "1.0.0" } }) });
    expect(existsSync(join(dir, "node_modules", "@types", "is-number"))).toBeFalse();
    expect(existsSync(join(dir, "node_modules", ".bun", "@types+is-number@2.0.0"))).toBeTrue();

    expect(await licensesJson(dir)).toStrictEqual({
      Unknown: [u("@types/is-number", "2.0.0"), u("no-deps", "1.1.0"), u("two-range-deps", "1.0.0")],
    });
    expect(pathsOf(await licensesEntries(dir), "@types/is-number")).toStrictEqual([
      store(dir, "@types+is-number@2.0.0", "@types", "is-number"),
    ]);
  });

  test.concurrent("paths: isolated installs report the store directory", async () => {
    const dir = await setup("isolated");
    const entries = await licensesEntries(dir);
    expect(Object.fromEntries(entries.map(entry => [entry.name, entry.paths]))).toStrictEqual({
      "path-parse": [store(dir, "path-parse@1.0.6", "path-parse")],
      "resolve": [store(dir, "resolve@1.9.0", "resolve")],
      "a-dep": [store(dir, "a-dep@1.0.1", "a-dep")],
      "no-deps": [store(dir, "no-deps@1.0.0", "no-deps"), store(dir, "no-deps@1.0.1", "no-deps")],
      "one-dep": [store(dir, "one-dep@1.0.0", "one-dep")],
    });
    expect(await licensesJson(dir)).toStrictEqual(fullJson);
  });

  test.concurrent("isolated linker: store entries with a peer hash suffix are matched", async () => {
    const dir = await setup("isolated", {
      "package.json": pkg({ dependencies: { "peer-deps-lvl0": "1.0.0" } }),
    });
    const storeEntries = readdirSync(join(dir, "node_modules", ".bun"));
    expect(storeEntries.some(name => /^peer-deps-lvl[12]@1\.0\.0\+[0-9a-f]{16}$/.test(name))).toBeTrue();

    expect(await licensesJson(dir)).toStrictEqual({
      Unknown: [
        u("no-deps", "1.0.0"),
        u("peer-deps-lvl0", "1.0.0"),
        u("peer-deps-lvl1", "1.0.0"),
        u("peer-deps-lvl2", "1.0.0"),
      ],
    });

    const [lvl1Path] = pathsOf(await licensesEntries(dir), "peer-deps-lvl1")!;
    expect(lvl1Path).toMatch(new RegExp("peer-deps-lvl1@1\\.0\\.0\\+[0-9a-f]{16}"));
    expect(lvl1Path.startsWith(join(dir, "node_modules", ".bun"))).toBeTrue();
    expect(existsSync(join(lvl1Path, "package.json"))).toBeTrue();
  });

  // pnpm 'should work with file protocol dependency' (fixtures/with-file-protocol): a license-less folder dep is listed as Unknown.
  test.concurrent.each(["hoisted", "isolated"] as Linker[])("file: dependency is listed (%s)", async linker => {
    const dir = await setup(linker, {
      "package.json": pkg({ dependencies: { "no-deps": "1.0.0", "sub-dep": "file:./sub-dep" } }),
      "sub-dep/package.json": JSON.stringify({ name: "sub-dep", version: "2.5.0" }),
    });

    expect(await licensesJson(dir)).toStrictEqual({
      Unknown: [u("no-deps", "1.0.0"), u("sub-dep", "sub-dep")],
    });
    expect(pathsOf(await licensesEntries(dir), "sub-dep")).toStrictEqual([
      linker === "hoisted" ? nm(dir, "sub-dep") : store(dir, "sub-dep@file+sub-dep", "sub-dep"),
    ]);
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

    expect(names(await licensesJson(dir))).toStrictEqual(["a-dep", "no-deps", "sub-dep"]);
    expect(names(await licensesJson(dir, "--prod"))).toStrictEqual(["no-deps", "sub-dep"]);
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
    expect(await licensesJson(monoDir)).toStrictEqual(monoJson);
    expect(await licensesJson(join(monoDir, "packages", "bar"))).toStrictEqual(barJson);
    expect(await licensesJson(join(monoDir, "packages", "foo"))).toStrictEqual(fooJson);
    expect(await licensesText(monoDir)).toContain("├── a-dep@1.0.1 (dev)\n└── no-deps@1.0.0\n");

    const fromRoot = await licensesEntries(monoDir);
    expect(pathsOf(fromRoot, "a-dep")).toStrictEqual([nm(monoDir, "a-dep")]);
    expect(pathsOf(fromRoot, "resolve")).toStrictEqual([nm(monoDir, "resolve")]);
    expect(pathsOf(await licensesEntries(monoDir, "--filter", "foo"), "a-dep")).toStrictEqual([nm(monoDir, "a-dep")]);
    expect(pathsOf(await licensesEntries(join(monoDir, "packages", "foo")), "a-dep")).toStrictEqual([
      nm(monoDir, "a-dep"),
    ]);
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

    expect(normalizeBunSnapshot(await licensesText(dir))).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      MIT (2)
      ├── path-parse@1.0.6
      └── resolve@1.9.0

      Unknown (2)
      ├── a-dep@1.0.1 (dev)
      └── no-deps@1.0.0

      4 packages across 2 licenses (checked 4 packages in bun.lock)"
    `);
    expect(await licensesText(join(dir, "packages", "foo"))).toContain("├── a-dep@1.0.1 (dev)\n└── no-deps@1.0.0\n");
  });

  test.concurrent("--prod inside a workspace drops members' devDependencies", async () => {
    expect(await licensesJson(monoDir, "--prod")).toStrictEqual({
      MIT: fullJson.MIT,
      Unknown: [u("no-deps", "1.0.0")],
    });
    expect(await licensesJson(join(monoDir, "packages", "foo"), "--prod")).toStrictEqual({
      Unknown: [u("no-deps", "1.0.0")],
    });
  });

  test.concurrent("--filter selects workspaces from any directory", async () => {
    const bar = join(monoDir, "packages", "bar");
    const [union, star, all, notFoo, starNotFoo, glob, parentGlob, packagesGlob, rootOnly, fooText] = await Promise.all(
      [
        licensesJson(monoDir, "-F", "foo", "-F", "bar"),
        licensesJson(monoDir, "--filter", "*"),
        licensesJson(monoDir),
        licensesJson(monoDir, "--filter", "!foo"),
        licensesJson(monoDir, "--filter", "*", "--filter", "!foo"),
        licensesJson(monoDir, "--filter", "b*"),
        licensesJson(bar, "--filter", "../*"),
        licensesJson(monoDir, "--filter", "./packages/*"),
        licensesText(monoDir, "--filter", "mono"),
        licensesText(monoDir, "--filter", "foo"),
      ],
    );
    expect(await licensesJson(monoDir, "--filter", "foo")).toStrictEqual(fooJson);
    expect(await licensesJson(monoDir, "--filter", "bar")).toStrictEqual(barJson);
    expect(await licensesJson(monoDir, "--filter", "./packages/bar")).toStrictEqual(barJson);
    expect(await licensesJson(bar, "--filter", "foo")).toStrictEqual(fooJson);
    expect(await licensesJson(bar, "--filter", "./")).toStrictEqual(barJson);
    expect(union).toStrictEqual(monoJson);
    expect(names(union)).toStrictEqual(monoNames);
    expect(star).toStrictEqual(all);
    expect(all).toStrictEqual(monoJson);
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
    expect(await licensesJson(monoDir, "--filter", "foo", "--prod")).toStrictEqual({
      Unknown: [u("no-deps", "1.0.0")],
    });
    expect(await licensesJson(monoDir, "--filter", "foo", "--dev")).toStrictEqual({ Unknown: [u("a-dep", "1.0.1")] });
    expect(await licensesJson(monoDir, "--filter", "bar", "--dev")).toStrictEqual({});
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

    expect(await licensesJson(dir, "--filter", "mono")).toStrictEqual({
      Unknown: [u("no-deps", "1.0.1"), u("one-dep", "1.0.0")],
    });
    expect(await licensesJson(dir)).toStrictEqual({
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
    const [stdout, stderr, exitCode] = await licenses(monoDir, "--filter", "foo", "--filter", "nomatch", "--json");
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(
      `"warn: No workspace packages matched the filter "nomatch""`,
    );
    expect(stripPaths(JSON.parse(stdout))).toStrictEqual(fooJson);
    expect(exitCode).toBe(0);

    const [text, textStderr, textExit] = await licenses(
      monoDir,
      "--filter",
      "nomatch",
      "--filter",
      "alsonone",
      "-F",
      "bar",
    );
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
    const [stdout, stderr, exitCode] = await pm(hoistedDir, "ls", "--filter", "foo");
    expect(stdout).toBe("");
    expect(stderr).toContain("--filter is only supported by `bun pm licenses`");
    expect(exitCode).toBe(1);

    expect(await licensesJson(hoistedDir, "--filter", "licenses-fixture")).toStrictEqual(fullJson);
  });

  test.concurrent("nothing to list prints what was checked and how long it took / {}", async () => {
    const dir = await setup("hoisted", { "package.json": pkg({ devDependencies: { "no-deps": "1.0.0" } }) });

    const [stdout, stderr, exitCode] = await licenses(dir, "--prod");
    expectEmptyText(stdout, 0);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const [json, jsonStderr, jsonExit] = await licenses(dir, "--prod", "--json");
    expect(json).toBe("{}\n");
    expect(jsonStderr).toBe("");
    expect(jsonExit).toBe(0);
    expect(await licensesJson(dir)).toStrictEqual({ Unknown: [u("no-deps", "1.0.0")] });
  });

  test.concurrent("nothing to list counts the lockfile packages that were checked but not installed", async () => {
    const dir = await setup();
    for (const name of ["a-dep", "no-deps", "one-dep", "path-parse", "resolve"])
      rmSync(nm(dir, name), { recursive: true });

    const [stdout, stderr, exitCode] = await licenses(dir);
    expectEmptyText(stdout, 6);
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
      "warn: 6 packages in bun.lock are not installed and were skipped
      note: run 'bun install' first"
    `);
    expect(exitCode).toBe(0);

    const [json, jsonStderr, jsonExit] = await licenses(dir, "--json");
    expect(json).toBe("{}\n");
    expect(normalizeBunSnapshot(jsonStderr)).toBe(
      `warn: 6 packages in bun.lock are not installed and were skipped\n${MISSING_NOTE}`,
    );
    expect(jsonExit).toBe(0);
  });

  test.concurrent("--no-summary prints the bare listing without banner or summary", async () => {
    const [stdout, stderr, exitCode] = await licenses(hoistedDir, "--no-summary");
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
    const dir = await setup("hoisted", { "package.json": pkg({ devDependencies: { "no-deps": "1.0.0" } }) });
    const [empty, emptyStderr, emptyExit] = await licenses(dir, "--prod", "--no-summary");
    expect(empty).toBe("No packages to list\n");
    expect(emptyStderr).toBe("");
    expect(emptyExit).toBe(0);
  });

  test.concurrent("--silent still prints the listing but no diagnostics", async () => {
    const dir = await setup();
    rmSync(nm(dir, "path-parse"), { recursive: true });
    const [[loud, loudStderr, loudExit], [quiet, quietStderr, quietExit]] = await Promise.all([
      licenses(dir),
      licenses(dir, "--silent"),
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

    const [json, jsonStderr, jsonExit] = await licenses(dir, "--silent", "--json");
    expect(jsonStderr).toBe("");
    expect(stripPaths(JSON.parse(json))).toStrictEqual({ MIT: [fullJson.MIT[1]], Unknown: fullJson.Unknown });
    expect(jsonExit).toBe(0);

    const [partial, partialStderr, partialExit] = await licenses(
      monoDir,
      "--silent",
      "-F",
      "foo",
      "-F",
      "nomatch",
      "--json",
    );
    expect(partialStderr).toBe("");
    expect(stripPaths(JSON.parse(partial))).toStrictEqual(fooJson);
    expect(partialExit).toBe(0);
  });

  test.concurrent("--silent suppresses every error but keeps the exit code", async () => {
    const noNodeModules = await setup();
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
    for (const [cwd, args] of cases) {
      const [stdout, stderr, exitCode] = await licenses(cwd, "--silent", ...args);
      expect({ args, stdout, stderr, exitCode }).toStrictEqual({ args, stdout: "", stderr: "", exitCode: 1 });
    }
  });

  test.concurrent("licenses list / ls aliases", async () => {
    const [[plain, , plainExit], [list, , listExit], [ls, , lsExit]] = await Promise.all([
      licenses(hoistedDir),
      licenses(hoistedDir, "list"),
      licenses(hoistedDir, "ls"),
    ]);
    expect(plain).toContain("MIT (2)");
    expect(normalizeBunSnapshot(list)).toBe(normalizeBunSnapshot(plain));
    expect(normalizeBunSnapshot(ls)).toBe(normalizeBunSnapshot(plain));
    expect([plainExit, listExit, lsExit]).toStrictEqual([0, 0, 0]);

    const [stdout, stderr, exitCode] = await licenses(hoistedDir, "bogus");
    expect(stdout).toBe("");
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
      "error: unknown subcommand "bogus" for bun pm licenses
      note: did you mean 'bun pm licenses list'?"
    `);
    expect(exitCode).toBe(1);
  });

  test.concurrent("licenses list / ls reject extra arguments", async () => {
    for (const subcommand of ["list", "ls"]) {
      const [stdout, stderr, exitCode] = await licenses(hoistedDir, subcommand, "extra");
      expect(stdout).toBe("");
      expect(normalizeBunSnapshot(stderr)).toBe(`error: bun pm licenses ${subcommand} does not take arguments`);
      expect(exitCode).toBe(1);
    }
  });

  test.concurrent("missing lockfile", async () => {
    const { packageDir } = await registry.createTestDir({ files: { "package.json": fixturePackageJson } });
    const [stdout, stderr, exitCode] = await licenses(packageDir);
    expect(stdout).toBe("");
    expect(stderr).toContain("error: missing lockfile");
    expect(stderr).toContain(MISSING_NOTE);
    expect(exitCode).toBe(1);
  });

  test.concurrent("missing node_modules", async () => {
    const { packageDir } = await registry.createTestDir({ files: { "package.json": fixturePackageJson } });
    await install(packageDir, "hoisted", "--lockfile-only");

    for (const args of [[], ["--json"], ["list"]]) {
      const [stdout, stderr, exitCode] = await licenses(packageDir, ...args);
      expect(stdout).toBe("");
      expect(normalizeBunSnapshot(stderr)).toBe(`error: node_modules not found, nothing to list\n${MISSING_NOTE}`);
      expect(exitCode).toBe(1);
    }
  });

  // pnpm#5702: a package that cannot be read must not fail the whole listing; the omission is reported instead of silent.
  test.concurrent(
    "unparsable package.json is reported as Unknown, missing ones are omitted with a warning",
    async () => {
      const dir = await setup();
      overwriteInstalledManifest(dir, "resolve", "{ not json");
      rmSync(join(dir, "node_modules", "one-dep"), { recursive: true, force: true });

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

    expect(await licensesJson(dir, "--prod")).toStrictEqual({
      Unknown: [u("a-dep", "1.0.10"), u("uses-a-dep-10", "1.0.0")],
    });
    expect(pathsOf(await licensesEntries(dir, "--prod"), "a-dep")).toStrictEqual([nm(dir, "a-dep")]);
  });

  test.concurrent("pnpm#8589: a different version at the tree path is not misattributed", async () => {
    const dir = await setupProductionInstall(outHoistedFixture);
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
      expect(existsSync(join(dir, "node_modules", "bundled-1", "node_modules", "no-deps", "package.json"))).toBeTrue();

      expect(await licensesJson(dir)).toStrictEqual({
        Unknown: [u("bundled-1", "1.0.0"), u("no-deps", "1.0.0")],
      });

      const entries = await licensesEntries(dir);
      if (linker === "hoisted") {
        expect(pathsOf(entries, "bundled-1")).toStrictEqual([nm(dir, "bundled-1")]);
        expect(pathsOf(entries, "no-deps")).toStrictEqual([nm(dir, "bundled-1", "node_modules", "no-deps")]);
      } else {
        expect(pathsOf(entries, "bundled-1")).toStrictEqual([store(dir, "bundled-1@1.0.0", "bundled-1")]);
        const noDepsPaths = pathsOf(entries, "no-deps")!;
        expect(noDepsPaths).toBeArrayOfSize(1);
        expect(noDepsPaths[0]).toEndWith(join("bundled-1", "node_modules", "no-deps"));
      }
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
    const [gitPath] = pathsOf(Object.values(parsed).flat(), "git-pkg")!;
    expect(stripPaths(parsed).ISC).toStrictEqual([
      { name: "git-pkg", versions: [expect.stringContaining("git+file://")], license: "ISC" },
    ]);
    expect(parsed.Unknown).toStrictEqual([u("no-deps", "1.0.0")]);
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

    const [stdout, stderr, exitCode] = await licenses(dir);
    expect(normalizeBunSnapshot(stdout).replace(/git\+file:\/\/\S+/, "git+file://<repo>")).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      Unknown (2)
      ├── no-deps@1.0.0
      └── no-deps@git+file://<repo>

      2 packages across 1 license (checked 2 packages in bun.lock)"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    const [entry] = await licensesEntries(dir);
    expect(entry.name).toBe("no-deps");
    expect(entry.versions).toStrictEqual(["1.0.0", expect.stringContaining("git+file://")]);
    expect(entry.paths).toStrictEqual([nm(dir, "no-deps"), nm(dir, "nd")]);
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
    const entries = Object.values(parsed).flat();
    const [ppPath] = pathsOf(entries, "path-parse")!;
    const [adPath] = pathsOf(entries, "a-dep")!;
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
    expect(await licensesJson(hoistedDir, "--omit=dev")).toStrictEqual(prodJson);
    expect(await licensesText(hoistedDir, "--omit=dev")).not.toContain("(dev)");
    expect(normalizeBunSnapshot(await licensesText(hoistedDir, "--omit", "dev"))).toBe(
      normalizeBunSnapshot(await licensesText(hoistedDir, "--prod")),
    );

    const dir = await setup();
    const bunfig = readFileSync(join(dir, "bunfig.toml"), "utf8");
    expect(bunfig).toStartWith("[install]\n");
    writeFileSync(join(dir, "bunfig.toml"), bunfig.replace("[install]\n", "[install]\nproduction = true\n"));
    expect(await licensesJson(dir)).toStrictEqual(prodJson);
    const text = await licensesText(dir);
    expect(text).not.toContain("a-dep");
    expect(text).not.toContain("(dev)");
  });

  test.concurrent("--omit=optional drops the optionalDependencies closure", async () => {
    const dir = await setup("hoisted", {
      "package.json": pkg({ dependencies: { "no-deps": "1.0.0" }, optionalDependencies: { "one-dep": "1.0.0" } }),
    });

    expect(await licensesJson(dir)).toStrictEqual({ Unknown: [u("no-deps", "1.0.0", "1.0.1"), u("one-dep", "1.0.0")] });
    expect(await licensesJson(dir, "--omit=optional")).toStrictEqual({ Unknown: [u("no-deps", "1.0.0")] });
    expect(normalizeBunSnapshot(await licensesText(dir, "--omit=optional"))).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      Unknown (1)
      └── no-deps@1.0.0

      1 package across 1 license (checked 1 package in bun.lock)"
    `);
  });

  test.concurrent("packages reachable only through peerDependencies are listed; --omit=peer drops them", async () => {
    const dir = await setup("hoisted", { "package.json": pkg({ peerDependencies: { "no-deps": "1.0.0" } }) });
    expect(existsSync(nm(dir, "no-deps", "package.json"))).toBeTrue();

    expect(await licensesJson(dir)).toStrictEqual({ Unknown: [u("no-deps", "1.0.0")] });
    expect(normalizeBunSnapshot(await licensesText(dir))).toMatchInlineSnapshot(`
      "bun pm licenses <version> (<revision>)

      Unknown (1)
      └── no-deps@1.0.0

      1 package across 1 license (checked 1 package in bun.lock)"
    `);
    expectEmptyText(await licensesText(dir, "--omit=peer"), 0);
    expect(await licensesJson(dir, "--omit=peer")).toStrictEqual({});

    const transitive = await setup("hoisted", { "package.json": pkg({ dependencies: { "has-peer": "1.0.0" } }) });
    expect(await licensesJson(transitive)).toStrictEqual({
      Unknown: [u("has-peer", "1.0.0"), u("peer-no-deps", "1.0.1")],
    });
    expect(await licensesJson(transitive, "--omit=peer")).toStrictEqual({ Unknown: [u("has-peer", "1.0.0")] });
  });

  test.concurrent("hoisted linker: scoped packages at their tree location and found by the disk scan", async () => {
    const dir = await setup("hoisted", { "package.json": pkg({ dependencies: { "two-range-deps": "1.0.0" } }) });
    const expected = { Unknown: [u("@types/is-number", "2.0.0"), u("no-deps", "1.1.0"), u("two-range-deps", "1.0.0")] };

    expect(await licensesJson(dir)).toStrictEqual(expected);
    expect(pathsOf(await licensesEntries(dir), "@types/is-number")).toStrictEqual([nm(dir, "@types", "is-number")]);

    renameSync(nm(dir, "@types", "is-number"), nm(dir, "@types", "renamed"));
    expect(await licensesJson(dir)).toStrictEqual(expected);
    expect(pathsOf(await licensesEntries(dir), "@types/is-number")).toStrictEqual([nm(dir, "@types", "renamed")]);

    mkdirSync(nm(dir, "two-range-deps", "node_modules"));
    renameSync(nm(dir, "@types"), nm(dir, "two-range-deps", "node_modules", "@types"));
    expect(await licensesJson(dir)).toStrictEqual(expected);
    expect(pathsOf(await licensesEntries(dir), "@types/is-number")).toStrictEqual([
      nm(dir, "two-range-deps", "node_modules", "@types", "renamed"),
    ]);
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
    expect(
      Object.fromEntries(Object.values(parsed).flatMap(entries => entries.map(e => [e.name, e.paths]))),
    ).toStrictEqual({
      "path-parse": [store(dir, "path-parse@1.0.6", "path-parse")],
      "resolve": [store(dir, "resolve@1.9.0", "resolve")],
      "a-dep": [store(dir, "a-dep@1.0.1", "a-dep")],
      "no-deps": [store(dir, "no-deps@1.0.0", "no-deps")],
    });
    expect(stripPaths(parsed)).toStrictEqual(monoJson);
  });

  test.concurrent("one missing package is reported in the singular", async () => {
    const dir = await setup();
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
    const dir = await setup();
    mkdirSync(store(dir, "a-dep@1.0.1"), { recursive: true });
    renameSync(nm(dir, "a-dep"), store(dir, "a-dep@1.0.1", "a-dep"));

    const [stdout, stderr, exitCode] = await licenses(dir, "--json");
    expect(stderr).toBe("");
    const parsed: Record<string, LicenseEntry[]> = JSON.parse(stdout);
    expect(pathsOf(Object.values(parsed).flat(), "a-dep")).toStrictEqual([store(dir, "a-dep@1.0.1", "a-dep")]);
    expect(stripPaths(parsed)).toStrictEqual(fullJson);
    expect(exitCode).toBe(0);
  });

  test.concurrent("an installed manifest without a version is listed under the lockfile version", async () => {
    const dir = await setup();
    patchInstalledManifest(dir, "resolve", { version: undefined });

    const [stdout, stderr, exitCode] = await licenses(dir, "--json");
    expect(stderr).toBe("");
    const parsed: Record<string, LicenseEntry[]> = JSON.parse(stdout);
    expect(pathsOf(parsed.MIT, "resolve")).toStrictEqual([nm(dir, "resolve")]);
    expect(stripPaths(parsed)).toStrictEqual(fullJson);
    expect(exitCode).toBe(0);
  });

  test.concurrent("author objects: name/email/url combinations; an empty object omits the author", async () => {
    const dir = await setup();
    patchInstalledManifest(dir, "a-dep", {
      author: { name: "Ann", email: "ann@example.com", url: "https://ann.example" },
    });
    patchInstalledManifest(dir, "one-dep", { author: { email: "one@example.com" } });
    patchInstalledManifest(dir, "one-dep/node_modules/no-deps", { author: { url: "https://nd.example" } });
    patchInstalledManifest(dir, "resolve", { author: {} });

    expect(await licensesJson(dir)).toStrictEqual({
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
    expect(normalizeBunSnapshot(await licensesText(dir, "--long"))).toMatchInlineSnapshot(`
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

    expect(await licensesJson(dir)).toStrictEqual(fullJson);
    expect(await licensesText(dir)).toContain("MIT (2)\n");
    expect(existsSync(join(dir, "bun.lock"))).toBeFalse();
    expect(readFileSync(join(dir, "bun.lockb")).equals(lockbBefore)).toBeTrue();
    expect(readFileSync(join(dir, "package.json")).equals(packageJsonBefore)).toBeTrue();
  });

  test.concurrent("bun pm help lists licenses and its flags", async () => {
    for (const args of [[], ["--help"]]) {
      const [stdout, stderr, exitCode] = await pm(hoistedDir, ...args);
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
