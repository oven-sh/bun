import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { VerdaccioRegistry, bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "path";
import { pathToFileURL } from "url";

type Linker = "hoisted" | "isolated";
type Files = Record<string, string>;
type LicenseEntry = {
  name: string;
  versions: string[];
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

const EMPTY_TEXT = "No packages found\n";

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

async function licensesJson(dir: string, ...args: string[]) {
  const [stdout, stderr, exitCode] = await licenses(dir, ...args, "--json");
  expect(stderr).toBe("");
  const parsed = JSON.parse(stdout);
  expect(exitCode).toBe(0);
  return parsed as Record<string, LicenseEntry[]>;
}

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

const fullJson = {
  MIT: [
    {
      name: "path-parse",
      versions: ["1.0.6"],
      license: "MIT",
      homepage: "https://github.com/jbgutierrez/path-parse#readme",
      author: "Javier Blanco <http://jbgutierrez.info>",
      description: pathParseDescription,
    },
    {
      name: "resolve",
      versions: ["1.9.0"],
      license: "MIT",
      author: "James Halliday <mail@substack.net> (http://substack.net)",
      description: resolveDescription,
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
      "MIT (2)
      ├── path-parse@1.0.6
      └── resolve@1.9.0

      Unknown (4)
      ├── a-dep@1.0.1 (dev)
      ├── no-deps@1.0.0
      ├── no-deps@1.0.1
      └── one-dep@1.0.0"
    `);
    expect(stdout.split("\n").filter(line => line.endsWith(" (dev)"))).toEqual(["├── a-dep@1.0.1 (dev)"]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test.concurrent("--json shape", async () => {
    const [stdout, stderr, exitCode] = await licenses(hoistedDir, "--json");
    expect(stderr).toBe("");
    const parsed = JSON.parse(stdout);
    expect(parsed).toEqual(fullJson);
    expect(Object.keys(parsed)).toEqual(["MIT", "Unknown"]);
    expect(parsed.MIT[0].description).toBe(pathParseDescription);
    expect(parsed.MIT[1]).not.toHaveProperty("homepage");
    expect(parsed.Unknown[0]).not.toHaveProperty("description");
    for (const [key, entries] of Object.entries(parsed as Record<string, LicenseEntry[]>)) {
      expect(entries.map(entry => entry.license)).toEqual(entries.map(() => key));
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
    expect(Object.keys(parsed)).toEqual(["(MIT OR Apache-2.0)", "BSD-3-Clause", "ISC", "MIT", "Unknown"]);
    expect(parsed["ISC"]).toEqual([{ name: "no-deps", versions: ["1.0.0"], license: "ISC" }]);
    expect(parsed["Unknown"]).toEqual([u("no-deps", "1.0.1")]);
    expect(parsed["(MIT OR Apache-2.0)"]).toEqual([
      { name: "one-dep", versions: ["1.0.0"], license: "(MIT OR Apache-2.0)" },
    ]);
    expect(parsed["BSD-3-Clause"]).toEqual([{ name: "a-dep", versions: ["1.0.1"], license: "BSD-3-Clause" }]);
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
    expect(parsed["(MIT OR Apache-2.0)"]).toEqual([
      { name: "a-dep", versions: ["1.0.1"], license: "(MIT OR Apache-2.0)" },
    ]);
    expect(parsed["ISC"]).toEqual([{ name: "one-dep", versions: ["1.0.0"], license: "ISC" }]);
    expect(parsed["BSD-2-Clause"]).toEqual([{ name: "no-deps", versions: ["1.0.0"], license: "BSD-2-Clause" }]);
    expect(parsed["0BSD"]).toEqual([{ name: "no-deps", versions: ["1.0.1"], license: "0BSD" }]);
    expect(parsed).not.toHaveProperty("Unknown");
  });

  test.concurrent("empty `license` falls through to `licenses`; `license` wins when both are present", async () => {
    const dir = await setup();
    patchInstalledManifest(dir, "a-dep", { license: "", licenses: [{ type: "MIT" }] });
    patchInstalledManifest(dir, "one-dep", { license: "Apache-2.0", licenses: [{ type: "MIT" }] });

    const parsed = await licensesJson(dir);
    expect(parsed["MIT"].map(entry => entry.name)).toEqual(["a-dep", "path-parse", "resolve"]);
    expect(parsed["Apache-2.0"]).toEqual([{ name: "one-dep", versions: ["1.0.0"], license: "Apache-2.0" }]);
  });

  test.concurrent("non-string license shapes are Unknown; entries with non-string type are skipped", async () => {
    const dir = await setup();
    patchInstalledManifest(dir, "a-dep", { license: 42 });
    patchInstalledManifest(dir, "one-dep", { licenses: [] });
    patchInstalledManifest(dir, "no-deps", { licenses: [{ url: "x" }] });
    patchInstalledManifest(dir, "resolve", { license: undefined, licenses: [{ type: 42 }, { type: "MIT" }] });

    const parsed = await licensesJson(dir);
    expect(parsed).toEqual({
      MIT: [
        fullJson.MIT[0],
        {
          name: "resolve",
          versions: ["1.9.0"],
          license: "MIT",
          author: fullJson.MIT[1].author,
          description: resolveDescription,
        },
      ],
      Unknown: fullJson.Unknown,
    });
  });

  test.concurrent("repeated legacy entries are not deduplicated", async () => {
    const dir = await setup();
    patchInstalledManifest(dir, "one-dep", { licenses: [{ type: "MIT" }, { type: "MIT" }, { type: "Apache-2.0" }] });

    const parsed = await licensesJson(dir);
    expect(parsed["(MIT OR MIT OR Apache-2.0)"]).toEqual([
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
    expect(parsed["MIT"]).toEqual([
      { name: "no-deps", versions: ["1.0.0", "1.0.1"], license: "MIT", homepage: "https://example.com/new" },
      ...fullJson.MIT,
    ]);
    expect(parsed["Unknown"]).toEqual([u("a-dep", "1.0.1"), u("one-dep", "1.0.0")]);
  });

  test.concurrent("--json `license` follows each version's group; an empty description is omitted", async () => {
    const dir = await setup();
    patchInstalledManifest(dir, "no-deps", { license: "ISC", description: "" });
    patchInstalledManifest(dir, "one-dep/node_modules/no-deps", { license: "0BSD", description: "newer" });
    patchInstalledManifest(dir, "a-dep", { licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] });

    expect(await licensesJson(dir)).toEqual({
      "(MIT OR Apache-2.0)": [{ name: "a-dep", versions: ["1.0.1"], license: "(MIT OR Apache-2.0)" }],
      "0BSD": [{ name: "no-deps", versions: ["1.0.1"], license: "0BSD", description: "newer" }],
      "ISC": [{ name: "no-deps", versions: ["1.0.0"], license: "ISC" }],
      "MIT": fullJson.MIT,
      "Unknown": [u("one-dep", "1.0.0")],
    });
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
    expect(parsed["Unknown"][0]).toEqual(u("a-dep", "1.0.9", "1.0.10"));
  });

  test.concurrent("(dev) marks packages only reachable through devDependencies", async () => {
    const dir = await setup("hoisted", {
      "package.json": pkg({ dependencies: { "a-dep": "1.0.9" }, devDependencies: { "uses-a-dep-9": "1.0.0" } }),
    });

    const [stdout, stderr, exitCode] = await licenses(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "Unknown (2)
      ├── a-dep@1.0.9
      └── uses-a-dep-9@1.0.0 (dev)"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    expect(await licensesText(dir, "--prod")).not.toContain("(dev)");

    const [json, jsonStderr, jsonExit] = await licenses(dir, "--json");
    expect(jsonStderr).toBe("");
    expect(json).not.toContain("(dev)");
    expect(json).not.toContain('"dev"');
    expect(JSON.parse(json)).toEqual({ Unknown: [u("a-dep", "1.0.9"), u("uses-a-dep-9", "1.0.0")] });
    expect(jsonExit).toBe(0);

    expect(await licensesJson(dir, "--dev")).toEqual({ Unknown: [u("a-dep", "1.0.9"), u("uses-a-dep-9", "1.0.0")] });
    expect(normalizeBunSnapshot(await licensesText(dir, "--dev"))).toMatchInlineSnapshot(`
      "Unknown (2)
      ├── a-dep@1.0.9
      └── uses-a-dep-9@1.0.0 (dev)"
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
      "Unknown (6)
      ├── a-dep@1.0.9 (dev)
      ├── a-dep@1.0.10
      ├── no-deps@1.0.1
      ├── one-dep@1.0.0 (dev)
      ├── uses-a-dep-10@1.0.0
      └── uses-a-dep-9@1.0.0 (dev)"
    `);

    expect(normalizeBunSnapshot(await licensesText(dir, "--dev"))).toMatchInlineSnapshot(`
      "Unknown (4)
      ├── a-dep@1.0.9 (dev)
      ├── no-deps@1.0.1
      ├── one-dep@1.0.0 (dev)
      └── uses-a-dep-9@1.0.0 (dev)"
    `);
    expect(await licensesJson(dir, "--dev")).toEqual({
      Unknown: [u("a-dep", "1.0.9"), u("no-deps", "1.0.1"), u("one-dep", "1.0.0"), u("uses-a-dep-9", "1.0.0")],
    });
  });

  test.concurrent("--dev lists the devDependencies closure", async () => {
    const dir = await setup("hoisted", {
      "package.json": pkg({ dependencies: { "no-deps": "1.0.0" }, devDependencies: { "one-dep": "1.0.0" } }),
    });

    const expected = { Unknown: [u("no-deps", "1.0.1"), u("one-dep", "1.0.0")] };
    expect(await licensesJson(dir, "--dev")).toEqual(expected);
    expect(await licensesJson(dir, "-D")).toEqual(expected);
    expect(normalizeBunSnapshot(await licensesText(dir, "--dev"))).toMatchInlineSnapshot(`
      "Unknown (2)
      ├── no-deps@1.0.1 (dev)
      └── one-dep@1.0.0 (dev)"
    `);

    expect(normalizeBunSnapshot(await licensesText(hoistedDir, "--dev"))).toMatchInlineSnapshot(`
      "Unknown (1)
      └── a-dep@1.0.1 (dev)"
    `);
    expect(await licensesJson(hoistedDir, "--dev")).toEqual({ Unknown: [u("a-dep", "1.0.1")] });
  });

  test.concurrent("--dev in a workspace", async () => {
    expect(await licensesJson(monoDir, "--dev")).toEqual({ Unknown: [u("a-dep", "1.0.1")] });
    expect(await licensesJson(join(monoDir, "packages", "foo"), "--dev")).toEqual({ Unknown: [u("a-dep", "1.0.1")] });

    const bar = join(monoDir, "packages", "bar");
    expect(await licensesText(bar, "--dev")).toBe(EMPTY_TEXT);
    expect(await licensesJson(bar, "--dev")).toEqual({});
  });

  test.concurrent("--dev cannot be combined with --prod", async () => {
    for (const args of [
      ["--dev", "--prod"],
      ["--dev", "--omit=dev"],
      ["--prod", "--dev", "--json"],
    ]) {
      const [stdout, stderr, exitCode] = await licenses(hoistedDir, ...args);
      expect(stdout).toBe("");
      expect(stderr).toContain("error: --dev cannot be combined with --prod or --omit=dev");
      expect(exitCode).toBe(1);
    }
  });

  test.concurrent.each(["--prod", "--production", "-p", "-P"])("%s omits devDependencies (--json)", async flag => {
    expect(await licensesJson(hoistedDir, flag)).toEqual(prodJson);
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

    expect(await licensesJson(dir, "--prod")).toEqual({
      Unknown: [u("no-deps", "1.0.0", "1.0.1"), u("one-dep", "1.0.0")],
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
      .map(name => u(name, "1.0.0"));
    expect(installedNatives.map(entry => entry.name)).not.toContain("native-foo-x64");

    expect(await licensesJson(dir)).toEqual({
      Unknown: [...installedNatives, u("optional-native", "1.0.0")],
    });
  });

  test.concurrent("--long prints author, description and homepage under each entry", async () => {
    const [stdout, stderr, exitCode] = await licenses(hoistedDir, "--long");
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "MIT (2)
      ├── path-parse@1.0.6
      │   Javier Blanco <http://jbgutierrez.info>
      │   Node.js path.parse() ponyfill
      │   https://github.com/jbgutierrez/path-parse#readme
      └── resolve@1.9.0
          James Halliday <mail@substack.net> (http://substack.net)
          resolve like require.resolve() on behalf of files asynchronously and synchronously

      Unknown (4)
      ├── a-dep@1.0.1 (dev)
      ├── no-deps@1.0.0
      ├── no-deps@1.0.1
      └── one-dep@1.0.0"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    expect(await licensesText(hoistedDir, "ls", "--long")).toBe(stdout);

    const [plainJson, longJson] = await Promise.all([
      licensesText(hoistedDir, "--json"),
      licensesText(hoistedDir, "--long", "--json"),
    ]);
    expect(longJson).toBe(plainJson);
    expect(JSON.parse(longJson)).toEqual(fullJson);
  });

  test.concurrent("--long details are per version in text; --json takes them from the newest version", async () => {
    const dir = await setup();
    patchInstalledManifest(dir, "no-deps", { description: "only a description" });
    patchInstalledManifest(dir, "a-dep", { author: { name: "Ann", email: "ann@example.com" } });

    const first = await licensesText(dir, "--long");
    expect(first).toContain(
      "├── a-dep@1.0.1 (dev)\n│   Ann <ann@example.com>\n├── no-deps@1.0.0\n│   only a description\n├── no-deps@1.0.1\n└── one-dep@1.0.0\n",
    );
    expect(await licensesJson(dir)).toEqual({
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
      "├── no-deps@1.0.0\n│   only a description\n├── no-deps@1.0.1\n│   newest winsline two\n│   https://example.com/new\n└── one-dep@1.0.0\n",
    );
    expect(second.split("\n").some(line => line.startsWith("line two"))).toBeFalse();
    const parsed = await licensesJson(dir);
    expect(parsed.Unknown[1]).toEqual({
      ...u("no-deps", "1.0.0", "1.0.1"),
      homepage: "https://example.com/new",
      description: "newest wins\nline two",
    });
    expect(JSON.stringify(parsed)).not.toContain("only a description");
  });

  test.concurrent(
    "control characters from package.json are stripped in text output but preserved in --json",
    async () => {
      const dir = await setup();
      const evilLicense = "MIT\u001b[31m\nEVIL";
      patchInstalledManifest(dir, "a-dep", { license: evilLicense, description: "tab\there\r\n" });
      patchInstalledManifest(dir, "one-dep", { license: "ISC\nGPL-3.0" });
      patchInstalledManifest(dir, "no-deps", { license: "BSD\t2" });

      const stdout = await licensesText(dir, "--long");
      expect(stdout).not.toContain("\u001b");
      expect(stdout).not.toContain("\r");
      expect(stdout).not.toContain("\t");
      expect(stdout).toContain("MIT[31mEVIL (1)\n└── a-dep@1.0.1 (dev)\n    tabhere\n");
      expect(stdout).toContain("ISCGPL-3.0 (1)\n└── one-dep@1.0.0\n");
      expect(stdout).toContain("BSD2 (1)\n└── no-deps@1.0.0\n");
      expect(stdout.split("\n").filter(line => / \(\d+\)$/.test(line))).toEqual([
        "BSD2 (1)",
        "ISCGPL-3.0 (1)",
        "MIT (2)",
        "MIT[31mEVIL (1)",
        "Unknown (1)",
      ]);
      expect(stdout.split("\n").some(line => line.startsWith("GPL-3.0") || line.startsWith("EVIL"))).toBeFalse();

      const parsed = await licensesJson(dir);
      expect(Object.keys(parsed)).toEqual(["BSD\t2", "ISC\nGPL-3.0", "MIT", evilLicense, "Unknown"]);
      expect(parsed[evilLicense]).toEqual([
        { name: "a-dep", versions: ["1.0.1"], license: evilLicense, description: "tab\there\r\n" },
      ]);
      expect(parsed["ISC\nGPL-3.0"]).toEqual([{ name: "one-dep", versions: ["1.0.0"], license: "ISC\nGPL-3.0" }]);
      expect(parsed["BSD\t2"]).toEqual([{ name: "no-deps", versions: ["1.0.0"], license: "BSD\t2" }]);
      expect(parsed.Unknown).toEqual([u("no-deps", "1.0.1")]);
    },
  );

  test.concurrent("--long strips control characters from author, description and homepage", async () => {
    const dir = await setup();
    const author = "Eve\u001b]8;;https://evil.example\u0007click\u001b]8;;\u0007";
    const description = "first\r\nsecond";
    const homepage = "https://example.com/\u001b[2Jx";
    patchInstalledManifest(dir, "a-dep", { author, description, homepage });

    const stdout = await licensesText(dir, "--long");
    expect(stdout).not.toContain("\u001b");
    expect(stdout).not.toContain("\u0007");
    expect(stdout).not.toContain("\r");
    expect(stdout).toContain(
      "├── a-dep@1.0.1 (dev)\n│   Eve]8;;https://evil.exampleclick]8;;\n│   firstsecond\n│   https://example.com/[2Jx\n├── no-deps@1.0.0\n",
    );
    expect(stdout.split("\n").some(line => line.startsWith("second"))).toBeFalse();

    expect((await licensesJson(dir)).Unknown[0]).toEqual({ ...u("a-dep", "1.0.1"), author, description, homepage });
  });

  test.concurrent("isolated linker matches hoisted: marker, --dev, --long and --filter", async () => {
    const [dir, isoMono] = await Promise.all([setup("isolated"), setup("isolated", monorepoFiles)]);
    const [expected] = await licenses(hoistedDir);
    const [stdout, stderr, exitCode] = await licenses(dir);
    expect(stdout).toBe(expected);
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

    for (const args of [["--long"], ["--dev"], ["--dev", "--json"], ["--long", "--json"]]) {
      expect(await licensesText(dir, ...args)).toBe(await licensesText(hoistedDir, ...args));
    }
    expect(await licensesText(dir, "--long")).toContain("│   Javier Blanco <http://jbgutierrez.info>\n");
    expect(await licensesText(isoMono, "--filter", "foo", "--json")).toBe(
      await licensesText(monoDir, "--filter", "foo", "--json"),
    );
    expect(await licensesText(isoMono, "--filter", "foo")).toContain("├── a-dep@1.0.1 (dev)\n└── no-deps@1.0.0\n");
  });

  test.concurrent("isolated linker: scoped transitive dependency is found through the store", async () => {
    const dir = await setup("isolated", { "package.json": pkg({ dependencies: { "two-range-deps": "1.0.0" } }) });
    expect(existsSync(join(dir, "node_modules", "@types", "is-number"))).toBeFalse();
    expect(existsSync(join(dir, "node_modules", ".bun", "@types+is-number@2.0.0"))).toBeTrue();

    expect(await licensesJson(dir)).toEqual({
      Unknown: [u("@types/is-number", "2.0.0"), u("no-deps", "1.1.0"), u("two-range-deps", "1.0.0")],
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

    expect(await licensesJson(dir)).toEqual({
      Unknown: [u("no-deps", "1.0.0"), u("sub-dep", "sub-dep")],
    });
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

    expect(names(await licensesJson(dir))).toEqual(["a-dep", "no-deps", "sub-dep"]);
    expect(names(await licensesJson(dir, "--prod"))).toEqual(["no-deps", "sub-dep"]);
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
    expect(JSON.parse(stdout)).toEqual({ Unknown: [u("no-deps", "1.0.0")] });
    expect(exitCode).toBe(0);
  });

  // pnpm license-scanner 'lists versions installed under different aliases'.
  test.concurrent.each(["hoisted", "isolated"] as Linker[])(
    "npm: alias is listed under the real name (%s)",
    async linker => {
      const dir = await setup(linker, {
        "package.json": pkg({ dependencies: { "no-deps": "1.0.0", "nd2": "npm:no-deps@1.0.1" } }),
      });

      expect(await licensesJson(dir)).toEqual({ Unknown: [u("no-deps", "1.0.0", "1.0.1")] });
    },
  );

  // pnpm 'path should be correct for workspaces' / 'filter outputs'; pnpm#5689 (same output from every directory of a monorepo).
  test.concurrent("workspace root lists every member's dependencies; a member lists only its own closure", async () => {
    expect(await licensesJson(monoDir)).toEqual(monoJson);
    expect(await licensesJson(join(monoDir, "packages", "bar"))).toEqual(barJson);
    expect(await licensesJson(join(monoDir, "packages", "foo"))).toEqual(fooJson);
    expect(await licensesText(monoDir)).toContain("├── a-dep@1.0.1 (dev)\n└── no-deps@1.0.0\n");
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
      "MIT (2)
      ├── path-parse@1.0.6
      └── resolve@1.9.0

      Unknown (2)
      ├── a-dep@1.0.1 (dev)
      └── no-deps@1.0.0"
    `);
    expect(await licensesText(join(dir, "packages", "foo"))).toContain("├── a-dep@1.0.1 (dev)\n└── no-deps@1.0.0\n");
  });

  test.concurrent("--prod inside a workspace drops members' devDependencies", async () => {
    expect(await licensesJson(monoDir, "--prod")).toEqual({ MIT: fullJson.MIT, Unknown: [u("no-deps", "1.0.0")] });
    expect(await licensesJson(join(monoDir, "packages", "foo"), "--prod")).toEqual({
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
    expect(await licensesJson(monoDir, "--filter", "foo")).toEqual(fooJson);
    expect(await licensesJson(monoDir, "--filter", "bar")).toEqual(barJson);
    expect(await licensesJson(monoDir, "--filter", "./packages/bar")).toEqual(barJson);
    expect(await licensesJson(bar, "--filter", "foo")).toEqual(fooJson);
    expect(await licensesJson(bar, "--filter", "./")).toEqual(barJson);
    expect(union).toEqual(monoJson);
    expect(names(union)).toEqual(monoNames);
    expect(star).toEqual(all);
    expect(all).toEqual(monoJson);
    expect(notFoo).toEqual(barJson);
    expect(starNotFoo).toEqual(barJson);
    expect(glob).toEqual(barJson);
    expect(parentGlob).toEqual(monoJson);
    expect(packagesGlob).toEqual(monoJson);
    expect(rootOnly).toBe(EMPTY_TEXT);
    expect(normalizeBunSnapshot(fooText)).toMatchInlineSnapshot(`
      "Unknown (2)
      ├── a-dep@1.0.1 (dev)
      └── no-deps@1.0.0"
    `);
    expect(await licensesJson(monoDir, "--filter", "foo", "--prod")).toEqual({ Unknown: [u("no-deps", "1.0.0")] });
    expect(await licensesJson(monoDir, "--filter", "foo", "--dev")).toEqual({ Unknown: [u("a-dep", "1.0.1")] });
    expect(await licensesJson(monoDir, "--filter", "bar", "--dev")).toEqual({});
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

    expect(await licensesJson(dir, "--filter", "mono")).toEqual({
      Unknown: [u("no-deps", "1.0.1"), u("one-dep", "1.0.0")],
    });
    expect(await licensesJson(dir)).toEqual({
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

  test.concurrent("--filter is rejected by other pm subcommands and works outside a monorepo", async () => {
    const [stdout, stderr, exitCode] = await pm(hoistedDir, "ls", "--filter", "foo");
    expect(stdout).toBe("");
    expect(stderr).toContain("--filter is only supported by `bun pm licenses`");
    expect(exitCode).toBe(1);

    expect(await licensesJson(hoistedDir, "--filter", "licenses-fixture")).toEqual(fullJson);
  });

  test.concurrent('nothing to list prints "No packages found" / {}', async () => {
    const dir = await setup("hoisted", { "package.json": pkg({ devDependencies: { "no-deps": "1.0.0" } }) });

    const [stdout, stderr, exitCode] = await licenses(dir, "--prod");
    expect(stdout).toBe(EMPTY_TEXT);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const [json, jsonStderr, jsonExit] = await licenses(dir, "--prod", "--json");
    expect(json).toBe("{}\n");
    expect(jsonStderr).toBe("");
    expect(jsonExit).toBe(0);
    expect(await licensesJson(dir)).toEqual({ Unknown: [u("no-deps", "1.0.0")] });
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
    await install(packageDir, "hoisted", "--lockfile-only");

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
      overwriteInstalledManifest(dir, "resolve", "{ not json");
      rmSync(join(dir, "node_modules", "one-dep"), { recursive: true, force: true });

      const [stdout, stderr, exitCode] = await licenses(dir, "--json");
      expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(
        `"warn: omitted 2 packages from the lockfile not found in node_modules"`,
      );
      expect(JSON.parse(stdout)).toEqual({
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

    expect(await licensesJson(dir, "--prod")).toEqual({
      Unknown: [u("a-dep", "1.0.10"), u("uses-a-dep-10", "1.0.0")],
    });
  });

  test.concurrent("pnpm#8589: a different version at the tree path is not misattributed", async () => {
    const dir = await setupProductionInstall(outHoistedFixture);
    patchInstalledManifest(dir, "a-dep", { license: "MIT" });

    const [stdout, stderr, exitCode] = await licenses(dir, "--json");
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(
      `"warn: omitted 2 packages from the lockfile not found in node_modules"`,
    );
    expect(JSON.parse(stdout)).toEqual({
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

      expect(await licensesJson(dir)).toEqual({
        Unknown: [u("bundled-1", "1.0.0"), u("no-deps", "1.0.0")],
      });
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

    const parsed = await licensesJson(dir);
    expect(Object.keys(parsed)).toEqual(["ISC", "Unknown"]);
    expect(parsed.ISC).toEqual([
      { name: "git-pkg", versions: [expect.stringContaining("git+file://")], license: "ISC" },
    ]);
    expect(parsed.Unknown).toEqual([u("no-deps", "1.0.0")]);
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
