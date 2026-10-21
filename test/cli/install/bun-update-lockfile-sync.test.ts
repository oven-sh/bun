import { Archive, file, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFile, exists } from "fs/promises";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "path";
import { TestRegistry } from "registry";

// Registry: no-deps 1.0.0/1.0.1/1.1.0/2.0.0, @types/no-deps 1.0.0/2.0.0, a-dep 1.0.1..1.0.10, what-bin 1.0.0/1.5.0,
// one-range-dep@1.0.0 -> no-deps ^1.0.0, dep-with-tags 1.0.0..3.0.1 (latest=3.0.0, pre-2=2.0.1).

const verdaccio = new TestRegistry();

beforeAll(async () => {
  await verdaccio.start();
});

afterAll(() => {
  verdaccio.stop();
});

type Json = Record<string, any>;
const GROUPS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;

// CI exports one BUN_INSTALL_CACHE_DIR per file, which overrides bunfig's cache; concurrent cases sharing a cache race on Windows.
const envFor = (dir: string) => ({ ...bunEnv, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache") });

const SAVED = "Saved lockfile";
const PROGRESS_LINES = /^(?:Resolving dependencies|Resolved, downloaded and extracted \[\d+\])(?:\n|$)/gm;

// A name declared in two groups makes every install and update print this warning (two source excerpts that quote
// the test dir's path) before the rest of its stderr.
const duplicateWarning = (rest = "") =>
  new RegExp(
    `^(?:.*\\n){2}warn: Duplicate dependency: "no-deps" specified in package\\.json\\n(?:.*\\n){4}note: "no-deps" originally specified here\\n.*${rest && `\\n${rest}`}$`,
  );

// Both streams come back normalized for inline snapshots. stderr also loses the two progress lines every resolving
// run prints, so callers assert the rest of it exactly.
async function tryRun(dir: string, rel: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: join(dir, rel),
    env: envFor(dir),
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return {
    stdout: normalizeBunSnapshot(stdout),
    stderr: normalizeBunSnapshot(stderr).replace(PROGRESS_LINES, ""),
    exitCode,
  };
}

// A run that succeeds prints nothing to stderr but `Saved lockfile`, and that only when it rewrote bun.lock. A case
// whose point is that nothing may be written checks that `stderr` is empty. The whole result is checked at once, so
// a failure shows stdout and stderr next to the exit code.
async function runIn(dir: string, rel: string, ...args: string[]) {
  const result = await tryRun(dir, rel, ...args);
  expect(result).toEqual({
    stdout: expect.any(String),
    stderr: expect.stringMatching(/^(?:Saved lockfile)?$/),
    exitCode: 0,
  });
  return result;
}

const run = (dir: string, ...args: string[]) => runIn(dir, "", ...args);

// An install rewrites bun.lock unless `--frozen-lockfile` forbids it, and says so. `stderr` pins a different
// expectation: "" for a second install that must leave bun.lock alone, or the warning a run is known to print.
async function install(dir: string, opts: { frozen?: boolean; stderr?: string | RegExp } = {}) {
  const result = await tryRun(dir, "", "install", ...(opts.frozen ? ["--frozen-lockfile"] : []));
  const stderr = opts.stderr ?? (opts.frozen ? "" : SAVED);
  expect(result).toEqual({
    stdout: expect.any(String),
    stderr: typeof stderr === "string" ? stderr : expect.stringMatching(stderr),
    exitCode: 0,
  });
}

function json(contents: Json | string) {
  return typeof contents === "string" ? contents : JSON.stringify(contents, null, 2) + "\n";
}

async function setup(
  files: Record<string, Json | string>,
  opts: { exact?: boolean; text?: boolean; install?: boolean; stderr?: string | RegExp } = {},
): Promise<string> {
  const { packageDir: dir } = await verdaccio.createTestDir({
    bunfigOpts: { linker: "hoisted", saveTextLockfile: opts.text ?? true },
    files: Object.fromEntries(Object.entries(files).map(([path, contents]) => [path, json(contents)])),
  });
  if (opts.exact) await appendFile(join(dir, "bunfig.toml"), "exact = true\n");
  if (opts.install !== false) await install(dir, { stderr: opts.stderr });
  return dir;
}

const pkg = (dir: string, rel = ""): Promise<Json> => file(join(dir, rel, "package.json")).json();
const pkgText = (dir: string, rel = "") => file(join(dir, rel, "package.json")).text();
const writePkg = (dir: string, contents: Json, rel = "") => write(join(dir, rel, "package.json"), json(contents));
const lockText = (dir: string) => file(join(dir, "bun.lock")).text();
const lock = async (dir: string): Promise<Json> => Bun.JSONC.parse(await lockText(dir)) as Json;

const installed = (dir: string, name: string): Promise<Json> =>
  file(join(dir, "node_modules", name, "package.json")).json();

// Every `<name>@<version>` bun.lock resolved (of one name, or of all), sorted and deduplicated.
async function resolutions(dir: string, name?: string): Promise<string[]> {
  const entries = Object.values((await lock(dir)).packages) as [string, ...unknown[]][];
  const all = entries.map(entry => entry[0]).filter(res => name === undefined || res.startsWith(`${name}@`));
  return [...new Set(all)].sort();
}

async function reinstall(dir: string, contents: Json, rel = "") {
  await writePkg(dir, contents, rel);
  await install(dir);
}

function declaredLiteral(manifest: Json, name: string): string | undefined {
  for (const group of GROUPS) {
    const literal = manifest[group]?.[name];
    if (literal !== undefined) return literal;
  }
}

// bun.lock repeats each workspace's dependency groups, plus the root's overrides, catalog and catalogs, and a
// `--frozen-lockfile` install must accept it as is. With `reinstall`, a plain install must leave it byte-identical too.
// A field is compared when either file has it, so a stale copy in bun.lock of a field package.json dropped fails too.
async function expectInSync(
  dir: string,
  workspaces: string[] = [""],
  opts: { stderr?: string | RegExp; reinstall?: boolean } = {},
) {
  const lockfile = await lock(dir);
  const declared: Json = {};
  const locked: Json = {};
  for (const key of workspaces) {
    const manifest = await pkg(dir, key);
    declared[key] = {};
    locked[key] = {};
    for (const group of GROUPS) {
      const lockedGroup = lockfile.workspaces[key]?.[group];
      if (manifest[group] === undefined && lockedGroup === undefined) continue;
      declared[key][group] = manifest[group];
      locked[key][group] = lockedGroup;
    }
    if (key !== "") continue;
    const overrides = manifest.overrides ?? manifest.resolutions;
    if (overrides !== undefined || lockfile.overrides !== undefined) {
      declared[key].overrides = Object.fromEntries(
        Object.entries(overrides ?? {}).map(([name, value]) => [
          name,
          typeof value === "string" && value.startsWith("$") ? declaredLiteral(manifest, value.slice(1)) : value,
        ]),
      );
      locked[key].overrides = lockfile.overrides;
    }
    const catalog = manifest.workspaces?.catalog ?? manifest.catalog;
    if (catalog !== undefined || lockfile.catalog !== undefined) {
      declared[key].catalog = catalog;
      locked[key].catalog = lockfile.catalog;
    }
    const catalogs = manifest.workspaces?.catalogs ?? manifest.catalogs;
    if (catalogs !== undefined || lockfile.catalogs !== undefined) {
      declared[key].catalogs = catalogs;
      locked[key].catalogs = lockfile.catalogs;
    }
  }
  expect(locked).toStrictEqual(declared);
  await install(dir, { frozen: true, stderr: opts.stderr ?? "" });
  if (!opts.reinstall) return;
  const before = await lockText(dir);
  await install(dir, { stderr: opts.stderr ?? "" });
  expect(await lockText(dir)).toBe(before);
}

const root = (fields: Json): Json => ({ name: "foo", ...fields });
const wsRoot = (fields: Json = {}): Json => ({ name: "root", workspaces: ["packages/*"], ...fields });
const member = (name: string, fields: Json = {}): Json => ({ name, version: "1.0.0", ...fields });

const WORKSPACES = (rootFields: Json, members: Record<string, Json>) => ({
  "package.json": wsRoot(rootFields),
  ...Object.fromEntries(
    Object.entries(members).map(([name, fields]) => [`packages/${name}/package.json`, member(name, fields)]),
  ),
});
const MONOREPO = (pkg1: Json = {}, rootFields: Json = {}) => WORKSPACES(rootFields, { pkg1 });
const PKG1 = "packages/pkg1";
const PKG2 = "packages/pkg2";

describe.concurrent("bun update rewrites bun.lock together with package.json", () => {
  test("bun update", async () => {
    const dir = await setup({
      "package.json": root({ dependencies: { "no-deps": "^1.0.0", aliased: "npm:no-deps@~1.0.0" } }),
    });
    expect((await run(dir, "update")).stderr).toBe(SAVED);
    const expected = { "no-deps": "^1.1.0", aliased: "npm:no-deps@~1.0.1" };
    expect((await pkg(dir)).dependencies).toStrictEqual(expected);
    expect((await lock(dir)).workspaces[""].dependencies).toStrictEqual(expected);
    await expectInSync(dir, [""], { reinstall: true });
  });

  test("bun update --latest", async () => {
    const dir = await setup({
      "package.json": root({ dependencies: { "no-deps": "~1.0.0", aliased: "npm:no-deps@~1.0.0" } }),
    });
    expect((await run(dir, "update", "--latest")).stderr).toBe(SAVED);
    const expected = { "no-deps": "~2.0.0", aliased: "npm:no-deps@~2.0.0" };
    expect((await pkg(dir)).dependencies).toStrictEqual(expected);
    expect((await lock(dir)).workspaces[""]).toStrictEqual({ name: "foo", dependencies: expected });
    await expectInSync(dir);
  });

  test.each(GROUPS.flatMap(group => [[], ["no-deps"], ["-r"]].map(args => [group, args] as const)))(
    "bun update --latest moves a %s entry with args %j",
    async (group, args) => {
      const dir = await setup({ "package.json": root({ [group]: { "no-deps": "^1.0.0" } }) });
      await run(dir, "update", ...args, "--latest");
      expect((await pkg(dir))[group]).toStrictEqual({ "no-deps": "^2.0.0" });
      expect(await resolutions(dir, "no-deps")).toStrictEqual(["no-deps@2.0.0"]);
      await expectInSync(dir);
    },
  );

  test.each([[[]], [["-r"]]])(
    "bun update --latest %j leaves an optional dependency that does not resolve as written",
    async args => {
      await using registry = Bun.serve({ port: 0, fetch: () => new Response("not found", { status: 404 }) });
      const optionalDependencies = { "not-in-this-registry": "^1.0.0" };
      using tmp = tempDir("update-latest-unresolved", {
        "package.json": json(root({ optionalDependencies })),
        "bunfig.toml": `[install]\nregistry = "${registry.url.href}"\nsaveTextLockfile = true\n`,
      });
      const dir = String(tmp);
      // Each run warns about the 404.
      expect(await tryRun(dir, "", "install")).toMatchObject({ exitCode: 0 });
      expect(await tryRun(dir, "", "update", "--latest", ...args)).toMatchObject({ exitCode: 0 });
      expect((await pkg(dir)).optionalDependencies).toStrictEqual(optionalDependencies);
      expect((await lock(dir)).workspaces[""].optionalDependencies).toStrictEqual(optionalDependencies);
    },
  );

  // The sibling isn't in the registry. The range links it, and `latest` doesn't replace the range.
  test.each([[[]], [["-r"]], [["pkg2"]]])(
    "bun update --latest %j leaves a range that links a workspace",
    async args => {
      const files = WORKSPACES({}, { pkg1: { dependencies: { pkg2: "^1.0.0", "no-deps": "^1.0.0" } }, pkg2: {} });
      const dir = await setup(files);
      await runIn(dir, PKG1, "update", "--latest", ...args);
      expect((await pkg(dir, PKG1)).dependencies).toStrictEqual({
        pkg2: "^1.0.0",
        "no-deps": args[0] === "pkg2" ? "^1.0.0" : "^2.0.0",
      });
      expect(await resolutions(dir, "pkg2")).toStrictEqual(["pkg2@workspace:packages/pkg2"]);
      await expectInSync(dir, ["", PKG1, PKG2]);
    },
  );

  test.each([
    ["*", "2.0.0"],
    ["1", "1.1.0"],
    ["1.x", "1.1.0"],
    [">=1.0.0", "2.0.0"],
    ["1.0.0 - 1.0.1", "1.0.1"],
  ])("bun update leaves a %s range as written and moves bun.lock to %s", async (literal, resolved) => {
    const dir = await setup({ "package.json": root({ dependencies: { "no-deps": "1.0.0" } }) });
    await reinstall(dir, root({ dependencies: { "no-deps": literal } }));
    expect(await resolutions(dir)).toStrictEqual(["no-deps@1.0.0"]);
    const pkgBefore = await pkgText(dir);
    const { stdout, stderr } = await run(dir, "update");
    expect(stderr).toBe(SAVED);
    expect(stdout).toContain(`\n^ no-deps 1.0.0 -> ${resolved}`);
    expect(await pkgText(dir)).toBe(pkgBefore);
    expect((await lock(dir)).workspaces[""].dependencies).toStrictEqual({ "no-deps": literal });
    expect(await resolutions(dir)).toStrictEqual([`no-deps@${resolved}`]);
    expect(await installed(dir, "no-deps")).toMatchObject({ version: resolved });
    await expectInSync(dir);
  });

  test("bun update on a * range that already resolves the newest version leaves both files byte-identical", async () => {
    const dir = await setup({ "package.json": root({ dependencies: { "no-deps": "*" } }) });
    const [pkgBefore, lockBefore] = await Promise.all([pkgText(dir), lockText(dir)]);
    const { stdout, stderr } = await run(dir, "update");
    expect(stderr).toBe("");
    expect(stdout).toMatchInlineSnapshot(`
      "bun update <version> (<revision>)

      Checked 1 install across 2 packages (no changes)"
    `);
    expect(await pkgText(dir)).toBe(pkgBefore);
    expect(await lockText(dir)).toBe(lockBefore);
  });

  test("bun update --latest rewrites a * range", async () => {
    const dir = await setup({ "package.json": root({ dependencies: { "no-deps": "*" } }) });
    expect((await run(dir, "update", "--latest")).stderr).toBe(SAVED);
    expect((await pkg(dir)).dependencies).toStrictEqual({ "no-deps": "^2.0.0" });
    expect((await lock(dir)).workspaces[""].dependencies).toStrictEqual({ "no-deps": "^2.0.0" });
    await expectInSync(dir);
  });

  test("bun update <name> keeps the pin style", async () => {
    const dir = await setup({ "package.json": root({ dependencies: { "no-deps": "~1.0.0" } }) });
    expect((await run(dir, "update", "no-deps")).stderr).toBe(SAVED);
    expect((await pkg(dir)).dependencies).toStrictEqual({ "no-deps": "~1.0.1" });
    expect((await lock(dir)).workspaces[""].dependencies).toStrictEqual({ "no-deps": "~1.0.1" });
    await expectInSync(dir);
  });

  test("bun update <name> on an exact literal", async () => {
    const dir = await setup({ "package.json": root({ dependencies: { "no-deps": "1.0.0" } }) });
    expect((await run(dir, "update", "no-deps")).stderr).toBe("");
    expect((await pkg(dir)).dependencies).toStrictEqual({ "no-deps": "1.0.0" });
    expect((await lock(dir)).workspaces[""].dependencies).toStrictEqual({ "no-deps": "1.0.0" });
    await expectInSync(dir);
  });

  test("bun update <name> keeps a * literal and leaves the unnamed sibling alone", async () => {
    const dir = await setup({ "package.json": root({ dependencies: { "no-deps": "1.0.0", "a-dep": "1.0.1" } }) });
    await reinstall(dir, root({ dependencies: { "no-deps": "*", "a-dep": "^1.0.1" } }));
    expect((await run(dir, "update", "no-deps")).stderr).toBe(SAVED);
    const expected = { "no-deps": "*", "a-dep": "^1.0.1" };
    expect((await pkg(dir)).dependencies).toStrictEqual(expected);
    expect((await lock(dir)).workspaces[""].dependencies).toStrictEqual(expected);
    expect(await resolutions(dir)).toStrictEqual(["a-dep@1.0.1", "no-deps@2.0.0"]);
    await expectInSync(dir);
  });

  test("bun update <alias> keeps the alias", async () => {
    const dir = await setup({ "package.json": root({ dependencies: { aliased: "npm:no-deps@~1.0.0" } }) });
    expect((await run(dir, "update", "aliased")).stderr).toBe(SAVED);
    expect((await pkg(dir)).dependencies).toStrictEqual({ aliased: "npm:no-deps@~1.0.1" });
    expect((await lock(dir)).workspaces[""].dependencies).toStrictEqual({ aliased: "npm:no-deps@~1.0.1" });
    await expectInSync(dir);
  });

  test("bun update <name>@<range>", async () => {
    const dir = await setup({ "package.json": root({ dependencies: { "no-deps": "~1.0.0" } }) });
    expect((await run(dir, "update", "no-deps@^1.0.0")).stderr).toBe(SAVED);
    expect((await pkg(dir)).dependencies).toStrictEqual({ "no-deps": "~1.1.0" });
    expect((await lock(dir)).workspaces[""].dependencies).toStrictEqual({ "no-deps": "~1.1.0" });
    await expectInSync(dir);
  });

  // `bun install` warns about a name declared in two groups, so these two allow warnings.
  const inBothGroups = (version: string) =>
    root({ dependencies: { "no-deps": version }, devDependencies: { "no-deps": version } });

  test("bun update <name> with the name in dependencies and devDependencies", async () => {
    const dir = await setup({ "package.json": inBothGroups("~1.0.0") }, { stderr: duplicateWarning(SAVED) });
    const { stderr, exitCode } = await tryRun(dir, "", "update", "no-deps");
    expect(stderr).toMatch(duplicateWarning(SAVED));
    expect(exitCode).toBe(0);
    const manifest = await pkg(dir);
    expect(manifest.dependencies).toStrictEqual({ "no-deps": "~1.0.1" });
    expect(manifest.devDependencies).toStrictEqual({ "no-deps": "~1.0.0" });
    await expectInSync(dir, [""], { stderr: duplicateWarning() });
  });

  // If there are two entries for one name, an install picks the second of each pair here.
  test.each([
    ["dependencies", "devDependencies"],
    ["dependencies", "optionalDependencies"],
    ["devDependencies", "optionalDependencies"],
  ])(
    "bun update --latest <name> with the name in %s and %s moves the entry an install picks",
    async (other, picked) => {
      const stderr = (rest = "") => (picked === "devDependencies" ? duplicateWarning(rest) : rest);
      const declared = (version: string) =>
        root({ [other]: { "no-deps": "^1.0.0" }, [picked]: { "no-deps": version } });
      const dir = await setup({ "package.json": declared("~1.0.0") }, { stderr: stderr(SAVED) });
      expect(await resolutions(dir, "no-deps")).toStrictEqual(["no-deps@1.0.1"]);
      expect(await tryRun(dir, "", "update", "--latest", "no-deps")).toMatchObject({ exitCode: 0 });
      expect(await pkg(dir)).toStrictEqual(declared("~2.0.0"));
      expect(await resolutions(dir, "no-deps")).toStrictEqual(["no-deps@2.0.0"]);
      await install(dir, { frozen: true, stderr: stderr() });
      // The same package.json resolves to what was locked.
      await file(join(dir, "bun.lock")).delete();
      await install(dir, { stderr: stderr(SAVED) });
      expect(await resolutions(dir, "no-deps")).toStrictEqual(["no-deps@2.0.0"]);
    },
  );

  test("bun update with the name in dependencies and devDependencies moves one group", async () => {
    const dir = await setup({ "package.json": inBothGroups("1.0.0") }, { stderr: duplicateWarning(SAVED) });
    await writePkg(dir, inBothGroups("~1.0.0"));
    const { stdout, stderr, exitCode } = await tryRun(dir, "", "update");
    expect(stderr).toMatch(duplicateWarning(SAVED));
    expect(stdout).toMatchInlineSnapshot(`
      "bun update <version> (<revision>)

      ^ no-deps 1.0.0 -> 1.0.1 (v2.0.0 available)

      1 package installed"
    `);
    expect(exitCode).toBe(0);
    const manifest = await pkg(dir);
    expect([manifest.dependencies["no-deps"], manifest.devDependencies["no-deps"]].sort()).toStrictEqual([
      "~1.0.0",
      "~1.0.1",
    ]);
    await expectInSync(dir, [""], { stderr: duplicateWarning() });
  });

  test("install.exact", async () => {
    const dir = await setup({ "package.json": root({ dependencies: { "no-deps": "^1.0.0" } }) }, { exact: true });
    expect((await run(dir, "update")).stderr).toBe(SAVED);
    expect((await pkg(dir)).dependencies).toStrictEqual({ "no-deps": "1.1.0" });
    expect((await lock(dir)).workspaces[""].dependencies).toStrictEqual({ "no-deps": "1.1.0" });
    await expectInSync(dir);
  });

  // The peer range is published: an exact version there rejects every other version a consumer has.
  test.each([
    [["-E"], "1.0.10", "^1.0.0"],
    [["-E", "-r"], "1.0.10", "^1.0.0"],
    [["-E", "no-deps"], "^1.0.1", "^1.0.0"],
    [["-E", "--latest"], "1.0.10", "^2.0.0"],
    [["-E", "--latest", "no-deps"], "^1.0.1", "^2.0.0"],
  ])("bun update %j does not pin a peerDependencies range", async (args, dependency, peer) => {
    const library = (dependency: string, peer: string) =>
      root({ dependencies: { "a-dep": dependency }, peerDependencies: { "no-deps": peer } });
    const dir = await setup({ "package.json": library("1.0.1", "1.0.0") });
    await reinstall(dir, library("^1.0.1", "^1.0.0"));
    await run(dir, "update", ...args);
    expect(await pkg(dir)).toStrictEqual(library(dependency, peer));
    await expectInSync(dir);
  });

  test.each([">=1.0.0", "^1.0.0 || ^2.0.0", "*"].flatMap(range => [[], ["-r"]].map(args => [range, args] as const)))(
    "bun update --latest leaves the peerDependencies range %s with args %j",
    async (range, args) => {
      const dir = await setup({ "package.json": root({ peerDependencies: { "no-deps": "1.0.0" } }) });
      await reinstall(dir, root({ peerDependencies: { "no-deps": range } }));
      const pkgBefore = await pkgText(dir);
      expect((await run(dir, "update", "--latest", ...args)).stderr).toBe(SAVED);
      expect(await pkgText(dir)).toBe(pkgBefore);
      expect(await resolutions(dir, "no-deps")).toStrictEqual(["no-deps@2.0.0"]);
      await expectInSync(dir);
    },
  );

  // A library tests against the catalog's version and lists the versions it supports by hand.
  test.each([">=1.0.0", "^1.0.0 || ^2.0.0", "*"])(
    "bun update --latest keeps the peerDependencies range %s when devDependencies uses catalog:",
    async range => {
      const library = { devDependencies: { "no-deps": "catalog:" }, peerDependencies: { "no-deps": range } };
      for (const update of [
        (dir: string) => run(dir, "update", "--latest", "-r"),
        (dir: string) => runIn(dir, PKG1, "update", "--latest"),
      ]) {
        const dir = await setup(MONOREPO(library, { catalog: { "no-deps": "^1.0.0" } }));
        expect((await update(dir)).stderr).toBe(SAVED);
        expect(await pkg(dir, PKG1)).toMatchObject(library);
        expect((await pkg(dir)).catalog).toStrictEqual({ "no-deps": "^2.0.0" });
        expect(await resolutions(dir, "no-deps")).toStrictEqual(["no-deps@2.0.0"]);
        await expectInSync(dir);
      }
    },
  );

  // Naming a workspace member used to rewrite the entry linking it to `workspace:*` (or, with --latest / an explicit
  // range, to send the name to the registry), and to add an entry to a root that did not declare the member.
  test.each([
    ["workspace:^", ["pkg1"]],
    ["workspace:~", ["pkg1"]],
    ["workspace:1.0.0", ["pkg1"]],
    ["^1.0.0", ["pkg1"]],
    ["workspace:^", ["pkg1", "--latest"]],
    ["workspace:^", ["pkg1@^1.0.0"]],
    ["workspace:^", ["pkg1@latest"]],
  ])("a %s entry linking a workspace member is kept as written by bun update %j", async (literal, args) => {
    const dir = await setup(MONOREPO({}, { dependencies: { pkg1: literal } }));
    const [pkgBefore, lockBefore] = await Promise.all([pkgText(dir), lockText(dir)]);
    expect((await run(dir, "update", ...args)).stderr).toBe("");
    expect(await pkgText(dir)).toBe(pkgBefore);
    expect(await lockText(dir)).toBe(lockBefore);
  });

  // Same rule for the other non-registry kinds: the registry has a no-deps, so naming this entry with --latest or an
  // explicit spec used to replace the folder with the registry package (exit 0).
  test.each([[["no-deps"]], [["no-deps", "--latest"]], [["no-deps@^1.0.0"]], [["no-deps@latest"]]])(
    "a file: entry is kept as written by bun update %j",
    async args => {
      const dir = await setup({
        "package.json": root({ dependencies: { "no-deps": "file:./local-no-deps" } }),
        "local-no-deps/package.json": { name: "no-deps", version: "1.0.0" },
      });
      const [pkgBefore, lockBefore] = await Promise.all([pkgText(dir), lockText(dir)]);
      expect((await run(dir, "update", ...args)).stderr).toBe("");
      expect(await pkgText(dir)).toBe(pkgBefore);
      expect(await lockText(dir)).toBe(lockBefore);
      expect(await installed(dir, "no-deps")).toMatchObject({ version: "1.0.0" });
    },
  );

  test("bun update <workspace member> from a member declaring it keeps the entry as written", async () => {
    const dir = await setup(WORKSPACES({}, { pkg1: {}, pkg2: { dependencies: { pkg1: "workspace:~" } } }));
    const [pkgBefore, lockBefore] = await Promise.all([pkgText(dir, PKG2), lockText(dir)]);
    expect((await runIn(dir, PKG2, "update", "pkg1")).stderr).toBe("");
    expect(await pkgText(dir, PKG2)).toBe(pkgBefore);
    expect(await lockText(dir)).toBe(lockBefore);
  });

  test("bun update <workspace member> -r keeps every workspace's entry as written", async () => {
    const dir = await setup(
      WORKSPACES(
        { dependencies: { pkg1: "workspace:^" } },
        { pkg1: {}, pkg2: { dependencies: { pkg1: "workspace:1.0.0" } } },
      ),
    );
    const [rootBefore, pkg2Before, lockBefore] = await Promise.all([pkgText(dir), pkgText(dir, PKG2), lockText(dir)]);
    expect((await run(dir, "update", "pkg1", "-r")).stderr).toBe("");
    expect(await pkgText(dir)).toBe(rootBefore);
    expect(await pkgText(dir, PKG2)).toBe(pkg2Before);
    expect(await lockText(dir)).toBe(lockBefore);
  });

  test("bun update <workspace member> does not add it to a root that does not declare it", async () => {
    const dir = await setup(MONOREPO());
    const [pkgBefore, lockBefore] = await Promise.all([pkgText(dir), lockText(dir)]);
    expect((await run(dir, "update", "pkg1")).stderr).toBe("");
    expect(await pkgText(dir)).toBe(pkgBefore);
    expect(await lockText(dir)).toBe(lockBefore);
  });

  test.each([[[]], [["--latest"]]])("bun update %j leaves folder, tarball and workspace literals alone", async args => {
    const dependencies = {
      "no-deps": "^1.0.0",
      "folder-dep": "file:./folder-target",
      "tgz-dep": "file:./tgz-dep-1.0.0.tgz",
      pkg1: "workspace:*",
    };
    const dir = await setup(
      {
        ...MONOREPO({}, { dependencies }),
        "folder-target/package.json": { name: "folder-dep", version: "1.0.0" },
      },
      { install: false },
    );
    await Archive.write(
      join(dir, "tgz-dep-1.0.0.tgz"),
      { "package/package.json": JSON.stringify({ name: "tgz-dep", version: "1.0.0" }) },
      { compress: "gzip" },
    );
    await install(dir);
    expect((await run(dir, "update", ...args)).stderr).toBe(SAVED);
    const expected = { ...dependencies, "no-deps": args.length ? "^2.0.0" : "^1.1.0" };
    expect((await pkg(dir)).dependencies).toStrictEqual(expected);
    expect((await lock(dir)).workspaces[""].dependencies).toStrictEqual(expected);
    await expectInSync(dir, ["", PKG1]);
  });

  test("bun update -r", async () => {
    const dir = await setup(MONOREPO({ dependencies: { "no-deps": "~1.0.0" } }));
    expect((await run(dir, "update", "-r")).stderr).toBe(SAVED);
    expect((await pkg(dir, PKG1)).dependencies).toStrictEqual({ "no-deps": "~1.0.1" });
    expect((await lock(dir)).workspaces[PKG1].dependencies).toStrictEqual({ "no-deps": "~1.0.1" });
    await expectInSync(dir, ["", PKG1]);
  });

  test("bun update -r keeps a member's 1.x literal", async () => {
    const dir = await setup(MONOREPO({ dependencies: { "no-deps": "1.0.0" } }));
    await reinstall(dir, member("pkg1", { dependencies: { "no-deps": "1.x" } }), PKG1);
    expect(await resolutions(dir)).toStrictEqual(["no-deps@1.0.0", "pkg1@workspace:packages/pkg1"]);
    const { stdout, stderr } = await run(dir, "update", "-r");
    expect(stderr).toBe(SAVED);
    expect(stdout).toMatchInlineSnapshot(`
      "bun update <version> (<revision>)

      ^ no-deps 1.0.0 -> 1.1.0 (v2.0.0 available)

      1 package installed"
    `);
    expect((await pkg(dir, PKG1)).dependencies).toStrictEqual({ "no-deps": "1.x" });
    expect((await lock(dir)).workspaces[PKG1].dependencies).toStrictEqual({ "no-deps": "1.x" });
    expect(await resolutions(dir)).toStrictEqual(["no-deps@1.1.0", "pkg1@workspace:packages/pkg1"]);
    await expectInSync(dir, ["", PKG1]);
  });

  test("bun update -r keeps a member's dist-tag literal", async () => {
    const dir = await setup(MONOREPO({ dependencies: { "dep-with-tags": "pre-2", "no-deps": "~1.0.0" } }));
    expect((await run(dir, "update", "-r")).stderr).toBe(SAVED);
    const expected = { "dep-with-tags": "pre-2", "no-deps": "~1.0.1" };
    expect((await pkg(dir, PKG1)).dependencies).toStrictEqual(expected);
    expect((await lock(dir)).workspaces[PKG1].dependencies).toStrictEqual(expected);
    expect(await resolutions(dir)).toStrictEqual([
      "dep-with-tags@2.0.1",
      "no-deps@1.0.1",
      "pkg1@workspace:packages/pkg1",
    ]);
    await expectInSync(dir, ["", PKG1]);
  });

  test("bun update -r --latest replaces a member's dist-tag literal with the latest version", async () => {
    const dir = await setup(MONOREPO({ dependencies: { "dep-with-tags": "pre-2", "no-deps": "~1.0.0" } }));
    expect((await run(dir, "update", "-r", "--latest")).stderr).toBe(SAVED);
    const expected = { "dep-with-tags": "^3.0.0", "no-deps": "~2.0.0" };
    expect((await pkg(dir, PKG1)).dependencies).toStrictEqual(expected);
    expect((await lock(dir)).workspaces[PKG1].dependencies).toStrictEqual(expected);
    expect(await resolutions(dir)).toStrictEqual([
      "dep-with-tags@3.0.0",
      "no-deps@2.0.0",
      "pkg1@workspace:packages/pkg1",
    ]);
    await expectInSync(dir, ["", PKG1]);
  });

  test("bun update <name> --filter <workspace> rewrites only the selected member", async () => {
    const dir = await setup(
      MONOREPO({ dependencies: { "no-deps": "~1.0.0", "a-dep": "^1.0.1" } }, { dependencies: { "no-deps": "~1.0.0" } }),
    );
    expect((await run(dir, "update", "no-deps", "--filter", "pkg1")).stderr).toBe(SAVED);
    expect((await pkg(dir, PKG1)).dependencies).toStrictEqual({ "no-deps": "~1.0.1", "a-dep": "^1.0.1" });
    expect((await pkg(dir)).dependencies).toStrictEqual({ "no-deps": "~1.0.0" });
    await expectInSync(dir, ["", PKG1], { reinstall: true });
  });

  test("bun update <name> -r --latest rewrites only the workspaces that declare the name", async () => {
    const dir = await setup(
      WORKSPACES(
        { dependencies: { "no-deps": "~1.0.0" } },
        { pkg1: { dependencies: { "a-dep": "1.0.1" } }, pkg2: { dependencies: { "no-deps": "~1.0.0" } } },
      ),
    );
    expect((await run(dir, "update", "no-deps", "-r", "--latest")).stderr).toBe(SAVED);
    expect((await pkg(dir)).dependencies).toStrictEqual({ "no-deps": "~2.0.0" });
    expect((await pkg(dir, PKG2)).dependencies).toStrictEqual({ "no-deps": "~2.0.0" });
    expect((await pkg(dir, PKG1)).dependencies).toStrictEqual({ "a-dep": "1.0.1" });
    expect(await resolutions(dir)).toStrictEqual([
      "a-dep@1.0.1",
      "no-deps@2.0.0",
      "pkg1@workspace:packages/pkg1",
      "pkg2@workspace:packages/pkg2",
    ]);
    await expectInSync(dir, ["", PKG1, PKG2]);
  });

  test("bun update <name>@<version> -r keeps each workspace's operator", async () => {
    const dir = await setup(
      WORKSPACES({ dependencies: { "no-deps": "1.0.0" } }, { pkg1: { dependencies: { "no-deps": "1.0.0" } } }),
    );
    await writePkg(dir, wsRoot({ dependencies: { "no-deps": "^1.0.0" } }));
    await reinstall(dir, member("pkg1", { dependencies: { "no-deps": "~1.0.0" } }), PKG1);
    expect(await resolutions(dir)).toStrictEqual(["no-deps@1.0.0", "pkg1@workspace:packages/pkg1"]);
    expect((await run(dir, "update", "no-deps@1.0.1", "-r")).stderr).toBe(SAVED);
    expect((await pkg(dir)).dependencies).toStrictEqual({ "no-deps": "^1.0.1" });
    expect((await pkg(dir, PKG1)).dependencies).toStrictEqual({ "no-deps": "~1.0.1" });
    expect(await resolutions(dir)).toStrictEqual(["no-deps@1.0.1", "pkg1@workspace:packages/pkg1"]);
    await expectInSync(dir, ["", PKG1]);
  });

  test("bun update <name> -r --dry-run writes nothing", async () => {
    const dir = await setup(MONOREPO({ dependencies: { "no-deps": "1.0.0" } }));
    await reinstall(dir, member("pkg1", { dependencies: { "no-deps": "~1.0.0" } }), PKG1);
    const [pkgBefore, lockBefore] = await Promise.all([pkgText(dir, PKG1), lockText(dir)]);
    const { stdout, stderr } = await run(dir, "update", "no-deps", "-r", "--dry-run");
    expect(stderr).toBe("");
    expect(stdout).toMatchInlineSnapshot(`
      "bun update <version> (<revision>)

      ^ no-deps 1.0.0 -> 1.0.1 (v2.0.0 available)

      1 package would be updated"
    `);
    expect(await pkgText(dir, PKG1)).toBe(pkgBefore);
    expect(await lockText(dir)).toBe(lockBefore);
  });

  test("bun update from a workspace member", async () => {
    const dir = await setup(MONOREPO({ dependencies: { "no-deps": "~1.0.0" } }));
    expect((await runIn(dir, PKG1, "update")).stderr).toBe(SAVED);
    expect((await pkg(dir, PKG1)).dependencies).toStrictEqual({ "no-deps": "~1.0.1" });
    expect((await lock(dir)).workspaces[PKG1].dependencies).toStrictEqual({ "no-deps": "~1.0.1" });
    await expectInSync(dir, ["", PKG1]);
  });
});

describe.concurrent("named update is scoped to the invoking workspace", () => {
  test("from the root, another workspace's row stays put; -r moves it too", async () => {
    const dir = await setup(
      WORKSPACES({ dependencies: { "no-deps": "1.0.0" } }, { pkg1: { dependencies: { "no-deps": "1.0.0" } } }),
    );
    await writePkg(dir, wsRoot({ dependencies: { "no-deps": "^1.0.0" } }));
    await reinstall(dir, member("pkg1", { dependencies: { "no-deps": "~1.0.0" } }), PKG1);
    expect(await resolutions(dir)).toStrictEqual(["no-deps@1.0.0", "pkg1@workspace:packages/pkg1"]);

    expect((await run(dir, "update", "no-deps")).stderr).toBe(SAVED);
    expect((await pkg(dir)).dependencies).toStrictEqual({ "no-deps": "^1.1.0" });
    expect((await pkg(dir, PKG1)).dependencies).toStrictEqual({ "no-deps": "~1.0.0" });
    expect((await lock(dir)).workspaces[PKG1].dependencies).toStrictEqual({ "no-deps": "~1.0.0" });
    expect(await resolutions(dir)).toStrictEqual(["no-deps@1.0.0", "no-deps@1.1.0", "pkg1@workspace:packages/pkg1"]);
    await expectInSync(dir, ["", PKG1]);

    expect((await run(dir, "update", "no-deps", "-r")).stderr).toBe(SAVED);
    expect((await pkg(dir)).dependencies).toStrictEqual({ "no-deps": "^1.1.0" });
    expect((await pkg(dir, PKG1)).dependencies).toStrictEqual({ "no-deps": "~1.0.1" });
    expect(await resolutions(dir)).toStrictEqual(["no-deps@1.0.1", "no-deps@1.1.0", "pkg1@workspace:packages/pkg1"]);
    await expectInSync(dir, ["", PKG1]);
  });

  test("inside a member, a sibling's row is not re-resolved", async () => {
    const dir = await setup(
      WORKSPACES(
        {},
        { pkg1: { dependencies: { "no-deps": "1.0.0" } }, pkg2: { dependencies: { "no-deps": "1.0.0" } } },
      ),
    );
    await writePkg(dir, member("pkg1", { dependencies: { "no-deps": "^1.0.0" } }), PKG1);
    await reinstall(dir, member("pkg2", { dependencies: { "no-deps": "~1.0.0" } }), PKG2);
    expect(await resolutions(dir)).toStrictEqual([
      "no-deps@1.0.0",
      "pkg1@workspace:packages/pkg1",
      "pkg2@workspace:packages/pkg2",
    ]);

    expect((await runIn(dir, PKG1, "update", "no-deps")).stderr).toBe(SAVED);
    expect((await pkg(dir, PKG1)).dependencies).toStrictEqual({ "no-deps": "^1.1.0" });
    expect((await pkg(dir, PKG2)).dependencies).toStrictEqual({ "no-deps": "~1.0.0" });
    expect((await lock(dir)).workspaces[PKG2].dependencies).toStrictEqual({ "no-deps": "~1.0.0" });
    expect(await resolutions(dir)).toStrictEqual([
      "no-deps@1.0.0",
      "no-deps@1.1.0",
      "pkg1@workspace:packages/pkg1",
      "pkg2@workspace:packages/pkg2",
    ]);
    await expectInSync(dir, ["", PKG1, PKG2]);
  });

  test("bun update <name> --filter <workspace> from the root leaves the root's own row out of scope", async () => {
    const dir = await setup(
      WORKSPACES(
        { dependencies: { "no-deps": "1.0.0" } },
        { pkg1: { dependencies: { "no-deps": "1.0.0" } }, pkg2: { dependencies: { "no-deps": "1.0.0" } } },
      ),
    );
    await writePkg(dir, wsRoot({ dependencies: { "no-deps": "^1.0.0" } }));
    await writePkg(dir, member("pkg1", { dependencies: { "no-deps": "~1.0.0" } }), PKG1);
    await reinstall(dir, member("pkg2", { dependencies: { "no-deps": "~1.0.0" } }), PKG2);
    expect(await resolutions(dir)).toStrictEqual([
      "no-deps@1.0.0",
      "pkg1@workspace:packages/pkg1",
      "pkg2@workspace:packages/pkg2",
    ]);

    expect((await run(dir, "update", "no-deps", "--filter", "pkg1")).stderr).toBe(SAVED);
    expect((await pkg(dir, PKG1)).dependencies).toStrictEqual({ "no-deps": "~1.0.1" });
    expect((await pkg(dir)).dependencies).toStrictEqual({ "no-deps": "^1.0.0" });
    expect((await pkg(dir, PKG2)).dependencies).toStrictEqual({ "no-deps": "~1.0.0" });
    const { workspaces } = await lock(dir);
    expect(workspaces[""].dependencies).toStrictEqual({ "no-deps": "^1.0.0" });
    expect(workspaces[PKG2].dependencies).toStrictEqual({ "no-deps": "~1.0.0" });
    expect(await resolutions(dir)).toStrictEqual([
      "no-deps@1.0.1",
      "pkg1@workspace:packages/pkg1",
      "pkg2@workspace:packages/pkg2",
    ]);
    await expectInSync(dir, ["", PKG1, PKG2]);
  });

  test("a name declared only by another workspace is an error that points at -r", async () => {
    const dir = await setup(WORKSPACES({}, { pkg1: { dependencies: { "no-deps": "1.0.0" } } }));
    await reinstall(dir, member("pkg1", { dependencies: { "no-deps": "~1.0.0" } }), PKG1);
    const [pkgBefore, lockBefore] = await Promise.all([pkgText(dir, PKG1), lockText(dir)]);
    const { stdout, stderr, exitCode } = await tryRun(dir, "", "update", "no-deps");
    expect(stderr).toMatchInlineSnapshot(`
      "error: "no-deps" is not a dependency of this workspace
          bun update -r no-deps
          bun update --filter pkg1 no-deps"
    `);
    expect(stdout).toMatchInlineSnapshot(`"bun update <version> (<revision>)"`);
    expect(await pkgText(dir, PKG1)).toBe(pkgBefore);
    expect(await lockText(dir)).toBe(lockBefore);
    expect(exitCode).toBe(1);
  });
});

describe.concurrent("npm: aliases", () => {
  const ROWS: { pinned?: string; before: string; args: string[]; after: string; installs: [string, string] }[] = [
    {
      before: "npm:no-deps@~1.0.0",
      args: ["aliased", "--latest"],
      after: "npm:no-deps@~2.0.0",
      installs: ["no-deps", "2.0.0"],
    },
    { before: "npm:no-deps", args: [], after: "npm:no-deps", installs: ["no-deps", "2.0.0"] },
    { before: "npm:no-deps", args: ["aliased"], after: "npm:no-deps", installs: ["no-deps", "2.0.0"] },
    {
      pinned: "npm:no-deps@1.0.0",
      before: "npm:no-deps@*",
      args: [],
      after: "npm:no-deps@*",
      installs: ["no-deps", "2.0.0"],
    },
    {
      before: "npm:@types/no-deps",
      args: ["--latest"],
      after: "npm:@types/no-deps@^2.0.0",
      installs: ["@types/no-deps", "2.0.0"],
    },
    {
      before: "npm:dep-with-tags@pre-2",
      args: ["--latest"],
      after: "npm:dep-with-tags@^3.0.0",
      installs: ["dep-with-tags", "3.0.0"],
    },
    {
      before: "npm:no-deps@~1.0.0",
      args: ["aliased@2.0.0"],
      after: "npm:no-deps@~2.0.0",
      installs: ["no-deps", "2.0.0"],
    },
    { before: "npm:no-deps@^1.0.0", args: ["aliased"], after: "npm:no-deps@^1.1.0", installs: ["no-deps", "1.1.0"] },
  ];

  test.each(ROWS)(
    '"aliased": "$before" + bun update $args -> "$after"',
    async ({ pinned, before, args, after, installs }) => {
      const dir = await setup({ "package.json": root({ dependencies: { aliased: pinned ?? before } }) });
      if (pinned !== undefined) {
        await reinstall(dir, root({ dependencies: { aliased: before } }));
        expect(await installed(dir, "aliased")).toMatchObject({ version: "1.0.0" });
      }
      const { stderr } = await run(dir, "update", ...args);
      expect(stderr).toBe(before === after && pinned === undefined ? "" : SAVED);
      expect((await pkg(dir)).dependencies).toStrictEqual({ aliased: after });
      expect((await lock(dir)).workspaces[""].dependencies).toStrictEqual({ aliased: after });
      const [name, version] = installs;
      expect(await installed(dir, "aliased")).toMatchObject({ name, version });
      await expectInSync(dir);
    },
  );

  test("bun update <alias>@npm:<other> retargets the alias", async () => {
    const dir = await setup({ "package.json": root({ dependencies: { aliased: "npm:no-deps@~1.0.0" } }) });
    expect((await run(dir, "update", "aliased@npm:a-dep")).stderr).toBe(SAVED);
    expect((await pkg(dir)).dependencies).toStrictEqual({ aliased: "npm:a-dep@~1.0.10" });
    expect(await installed(dir, "aliased")).toMatchObject({ name: "a-dep", version: "1.0.10" });
    await expectInSync(dir);
  });

  test("bun update <new>@npm:<scoped>@<range> refuses to add; bun add keeps the target", async () => {
    const dir = await setup({ "package.json": root({ dependencies: { "a-dep": "1.0.1" } }) });
    const [pkgBefore, lockBefore] = await Promise.all([pkgText(dir), lockText(dir)]);
    const { stdout, stderr, exitCode } = await tryRun(dir, "", "update", "new-alias@npm:@types/no-deps@^1.0.0");
    expect(stderr).toMatchInlineSnapshot(`
      "error: "new-alias" is not in bun.lock
          bun add new-alias"
    `);
    expect(stdout).toMatchInlineSnapshot(`"bun update <version> (<revision>)"`);
    expect(exitCode).toBe(1);
    expect(await pkgText(dir)).toBe(pkgBefore);
    expect(await lockText(dir)).toBe(lockBefore);

    expect((await run(dir, "add", "new-alias@npm:@types/no-deps@^1.0.0")).stderr).toBe(SAVED);
    const expected = { "a-dep": "1.0.1", "new-alias": "npm:@types/no-deps@^1.0.0" };
    expect((await pkg(dir)).dependencies).toStrictEqual(expected);
    expect((await lock(dir)).workspaces[""].dependencies).toStrictEqual(expected);
    expect(await installed(dir, "new-alias")).toMatchObject({ name: "@types/no-deps", version: "1.0.0" });
    await expectInSync(dir);
  });

  test("bun update <alias>@npm:<scoped>@<range> retargets a scoped alias in the declared pin style", async () => {
    const dir = await setup({ "package.json": root({ dependencies: { aliased: "npm:no-deps@~1.0.0" } }) });
    expect((await run(dir, "update", "aliased@npm:@types/no-deps@^1.0.0")).stderr).toBe(SAVED);
    expect((await pkg(dir)).dependencies).toStrictEqual({ aliased: "npm:@types/no-deps@~1.0.0" });
    expect(await installed(dir, "aliased")).toMatchObject({ name: "@types/no-deps", version: "1.0.0" });
    await expectInSync(dir);
  });
});

describe.concurrent("bun add", () => {
  test.each([
    { args: ["no-deps"], expected: { "no-deps": "^2.0.0" } },
    { args: ["no-deps", "--exact"], expected: { "no-deps": "2.0.0" } },
    { args: ["no-deps@~1.0.0"], expected: { "no-deps": "~1.0.0" } },
    { args: ["no-deps@latest"], expected: { "no-deps": "^2.0.0" } },
    { args: ["x@npm:no-deps@~1.0.0"], expected: { x: "npm:no-deps@~1.0.0" } },
    { args: ["x@npm:no-deps@latest"], expected: { x: "npm:no-deps@^2.0.0" } },
    { args: ["x@npm:no-deps"], expected: { x: "npm:no-deps@^2.0.0" } },
    { args: ["x@npm:no-deps", "--exact"], expected: { x: "npm:no-deps@2.0.0" } },
  ])("bun add $args", async ({ args, expected }) => {
    const dir = await setup({ "package.json": root({}) }, { install: false });
    expect((await run(dir, "add", ...args)).stderr).toBe(SAVED);
    expect((await pkg(dir)).dependencies).toStrictEqual(expected);
    expect((await lock(dir)).workspaces[""].dependencies).toStrictEqual(expected);
    const [name, literal] = Object.entries(expected)[0];
    const version = literal.endsWith("~1.0.0") ? "1.0.1" : "2.0.0";
    expect(await installed(dir, name)).toMatchObject({ name: "no-deps", version });
    await expectInSync(dir);
  });

  test("bun add <workspace>@workspace:*", async () => {
    const dir = await setup(MONOREPO());
    expect((await run(dir, "add", "pkg1@workspace:*")).stderr).toBe(SAVED);
    expect((await pkg(dir)).dependencies).toStrictEqual({ pkg1: "workspace:*" });
    expect((await lock(dir)).workspaces[""].dependencies).toStrictEqual({ pkg1: "workspace:*" });
    await expectInSync(dir, ["", PKG1]);
  });

  // The spelling decides what `bun pm pack` / `bun publish` replace the range with (`^1.0.0`, `~1.0.0`, `1.0.0`); it used to be saved as `workspace:*`.
  test.each(["workspace:^", "workspace:~", "workspace:1.0.0", "workspace:^1.0.0"])(
    "bun add <workspace>@%s keeps the spelling",
    async literal => {
      const dir = await setup(MONOREPO());
      expect((await run(dir, "add", `pkg1@${literal}`)).stderr).toBe(SAVED);
      expect((await pkg(dir)).dependencies).toStrictEqual({ pkg1: literal });
      expect((await lock(dir)).workspaces[""].dependencies).toStrictEqual({ pkg1: literal });
      await expectInSync(dir, ["", PKG1]);
    },
  );

  test("bun add <workspace>@workspace:^ -d without a lockfile", async () => {
    const dir = await setup(MONOREPO(), { install: false });
    expect((await run(dir, "add", "pkg1@workspace:^", "-d")).stderr).toBe(SAVED);
    const manifest = await pkg(dir);
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.devDependencies).toStrictEqual({ pkg1: "workspace:^" });
    expect((await lock(dir)).workspaces[""].devDependencies).toStrictEqual({ pkg1: "workspace:^" });
    await expectInSync(dir, ["", PKG1]);
  });

  test("bun add <workspace>@workspace:~ from another member", async () => {
    const dir = await setup(WORKSPACES({}, { pkg1: {}, pkg2: {} }));
    expect((await runIn(dir, PKG2, "add", "pkg1@workspace:~")).stderr).toBe(SAVED);
    expect((await pkg(dir, PKG2)).dependencies).toStrictEqual({ pkg1: "workspace:~" });
    expect((await lock(dir)).workspaces[PKG2].dependencies).toStrictEqual({ pkg1: "workspace:~" });
    expect((await pkg(dir)).dependencies).toBeUndefined();
    await expectInSync(dir, ["", PKG1, PKG2]);
  });

  // The member resolves the same as before, so the install keeps bun.lock's old row; the entry must still take the new spelling.
  test.each(["workspace:*", "1.0.0"])(
    "bun add <workspace>@workspace:~ replaces an existing %s entry",
    async existing => {
      const dir = await setup(MONOREPO({}, { dependencies: { pkg1: existing } }));
      expect((await run(dir, "add", "pkg1@workspace:~")).stderr).toBe(SAVED);
      expect((await pkg(dir)).dependencies).toStrictEqual({ pkg1: "workspace:~" });
      expect((await lock(dir)).workspaces[""].dependencies).toStrictEqual({ pkg1: "workspace:~" });
      await expectInSync(dir, ["", PKG1]);
    },
  );

  test("bun add <workspace>@workspace:^ rewrites an entry listed in devDependencies in place", async () => {
    const dir = await setup(MONOREPO({}, { devDependencies: { pkg1: "workspace:*" } }));
    expect((await run(dir, "add", "pkg1@workspace:^")).stderr).toBe(SAVED);
    const manifest = await pkg(dir);
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.devDependencies).toStrictEqual({ pkg1: "workspace:^" });
    expect((await lock(dir)).workspaces[""].devDependencies).toStrictEqual({ pkg1: "workspace:^" });
    await expectInSync(dir, ["", PKG1]);
  });

  test("bun add <workspace>@workspace:^ --filter keeps the spelling in every target", async () => {
    const dir = await setup(WORKSPACES({}, { pkg1: {}, pkg2: {} }));
    expect((await run(dir, "add", "pkg1@workspace:^", "--filter", "pkg2", "--filter", "root")).stderr).toBe(SAVED);
    expect((await pkg(dir)).dependencies).toStrictEqual({ pkg1: "workspace:^" });
    expect((await pkg(dir, PKG2)).dependencies).toStrictEqual({ pkg1: "workspace:^" });
    const { workspaces } = await lock(dir);
    expect(workspaces[""].dependencies).toStrictEqual({ pkg1: "workspace:^" });
    expect(workspaces[PKG2].dependencies).toStrictEqual({ pkg1: "workspace:^" });
    await expectInSync(dir, ["", PKG1, PKG2]);
  });

  // A member linked through a plain range is still saved as `workspace:*`.
  test.each(["1.0.0", "^1.0.0"])("bun add <workspace>@%s saves workspace:*", async range => {
    const dir = await setup(MONOREPO());
    expect((await run(dir, "add", `pkg1@${range}`)).stderr).toBe(SAVED);
    expect((await pkg(dir)).dependencies).toStrictEqual({ pkg1: "workspace:*" });
    expect((await lock(dir)).workspaces[""].dependencies).toStrictEqual({ pkg1: "workspace:*" });
    await expectInSync(dir, ["", PKG1]);
  });

  test("bun add --filter", async () => {
    const dir = await setup(MONOREPO());
    expect((await run(dir, "add", "x@npm:no-deps@latest", "--filter", "pkg1")).stderr).toBe(SAVED);
    expect((await pkg(dir, PKG1)).dependencies).toStrictEqual({ x: "npm:no-deps@^2.0.0" });
    expect((await lock(dir)).workspaces[PKG1].dependencies).toStrictEqual({ x: "npm:no-deps@^2.0.0" });
    await expectInSync(dir, ["", PKG1]);
  });

  test("bun add --lockfile-only", async () => {
    const dir = await setup({ "package.json": root({}) }, { install: false });
    expect((await run(dir, "add", "no-deps", "--lockfile-only")).stderr).toBe(SAVED);
    expect((await pkg(dir)).dependencies).toStrictEqual({ "no-deps": "^2.0.0" });
    expect(await exists(join(dir, "node_modules"))).toBe(false);
    await expectInSync(dir);
  });

  test("bun add --trust", async () => {
    const dir = await setup({ "package.json": root({}) }, { install: false });
    expect((await run(dir, "add", "uses-what-bin@1.0.0", "--trust")).stderr).toBe(SAVED);
    expect(await pkg(dir)).toStrictEqual({
      name: "foo",
      dependencies: { "uses-what-bin": "1.0.0" },
      trustedDependencies: ["uses-what-bin"],
    });
    expect(await exists(join(dir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBe(true);
    await expectInSync(dir);
  });

  test("bun add --trust of a package already listed in devDependencies", async () => {
    const dir = await setup({ "package.json": root({ devDependencies: { "uses-what-bin": "1.0.0" } }) });
    expect((await run(dir, "add", "uses-what-bin@1.0.0", "--trust")).stderr).toBe(SAVED);
    expect(await pkg(dir)).toStrictEqual({
      name: "foo",
      devDependencies: { "uses-what-bin": "1.0.0" },
      trustedDependencies: ["uses-what-bin"],
    });
    expect(await exists(join(dir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBe(true);
    await expectInSync(dir);
  });
});

describe.concurrent("catalogs", () => {
  const CATALOG_REPO = (catalog: Json = { "no-deps": "^1.0.0", aliased: "npm:no-deps" }, protocol = "catalog:") =>
    MONOREPO(
      { dependencies: Object.fromEntries(Object.keys(catalog).map(name => [name, protocol])) },
      { workspaces: { packages: ["packages/*"], catalog } },
    );

  async function expectCatalog(dir: string, expected: Json) {
    expect((await pkg(dir)).workspaces.catalog).toStrictEqual(expected);
    expect((await lock(dir)).catalog).toStrictEqual(expected);
  }

  test("bun update", async () => {
    const dir = await setup(CATALOG_REPO());
    expect((await run(dir, "update")).stderr).toBe(SAVED);
    await expectCatalog(dir, { "no-deps": "^1.1.0", aliased: "npm:no-deps" });
    expect((await pkg(dir, PKG1)).dependencies).toStrictEqual({ "no-deps": "catalog:", aliased: "catalog:" });
    await expectInSync(dir, ["", PKG1]);
  });

  test.each([[""], [PKG1]])("bun update --latest from '%s'", async cwd => {
    const dir = await setup(CATALOG_REPO());
    expect((await runIn(dir, cwd, "update", "--latest")).stderr).toBe(SAVED);
    await expectCatalog(dir, { "no-deps": "^2.0.0", aliased: "npm:no-deps@^2.0.0" });
    expect(await resolutions(dir)).toStrictEqual(["no-deps@2.0.0", "pkg1@workspace:packages/pkg1"]);
    await expectInSync(dir, ["", PKG1]);
  });

  test("bun update keeps a dist-tag catalog entry", async () => {
    const dir = await setup(CATALOG_REPO({ "dep-with-tags": "pre-2" }));
    expect((await run(dir, "update")).stderr).toBe("");
    await expectCatalog(dir, { "dep-with-tags": "pre-2" });
    expect(await installed(dir, "dep-with-tags")).toMatchObject({ version: "2.0.1" });
    await expectInSync(dir, ["", PKG1]);
  });

  test("bun update --latest replaces a dist-tag catalog entry with the latest version", async () => {
    const dir = await setup(CATALOG_REPO({ "dep-with-tags": "pre-2" }));
    expect((await run(dir, "update", "--latest")).stderr).toBe(SAVED);
    await expectCatalog(dir, { "dep-with-tags": "^3.0.0" });
    expect(await installed(dir, "dep-with-tags")).toMatchObject({ version: "3.0.0" });
    await expectInSync(dir, ["", PKG1]);
  });

  test("bun update keeps a 1.x catalog entry", async () => {
    const dir = await setup(CATALOG_REPO({ "no-deps": "1.x" }));
    expect((await run(dir, "update")).stderr).toBe("");
    await expectCatalog(dir, { "no-deps": "1.x" });
    expect(await resolutions(dir)).toStrictEqual(["no-deps@1.1.0", "pkg1@workspace:packages/pkg1"]);
    expect((await pkg(dir, PKG1)).dependencies).toStrictEqual({ "no-deps": "catalog:" });
    await expectInSync(dir, ["", PKG1]);
  });

  test("bun update keeps a * catalog entry and moves only bun.lock", async () => {
    const dir = await setup(CATALOG_REPO({ "no-deps": "1.0.0" }));
    await reinstall(dir, wsRoot({ workspaces: { packages: ["packages/*"], catalog: { "no-deps": "*" } } }));
    expect(await resolutions(dir)).toStrictEqual(["no-deps@1.0.0", "pkg1@workspace:packages/pkg1"]);
    expect((await run(dir, "update")).stderr).toBe(SAVED);
    await expectCatalog(dir, { "no-deps": "*" });
    expect(await resolutions(dir)).toStrictEqual(["no-deps@2.0.0", "pkg1@workspace:packages/pkg1"]);
    expect((await pkg(dir, PKG1)).dependencies).toStrictEqual({ "no-deps": "catalog:" });
    await expectInSync(dir, ["", PKG1]);
  });

  const ALIASED_CATALOG = { aliased: "npm:no-deps@~1.0.0", tagged: "npm:dep-with-tags@pre-2" };

  test("bun update bumps an aliased catalog range in place and keeps an aliased dist-tag", async () => {
    const dir = await setup(CATALOG_REPO(ALIASED_CATALOG));
    expect((await run(dir, "update")).stderr).toBe(SAVED);
    await expectCatalog(dir, { aliased: "npm:no-deps@~1.0.1", tagged: "npm:dep-with-tags@pre-2" });
    expect(await installed(dir, "aliased")).toMatchObject({ name: "no-deps", version: "1.0.1" });
    expect(await installed(dir, "tagged")).toMatchObject({ name: "dep-with-tags", version: "2.0.1" });
    expect((await pkg(dir, PKG1)).dependencies).toStrictEqual({ aliased: "catalog:", tagged: "catalog:" });
    await expectInSync(dir, ["", PKG1]);
  });

  test("bun update --latest rewrites aliased catalog entries and keeps the alias prefix", async () => {
    const dir = await setup(CATALOG_REPO(ALIASED_CATALOG));
    expect((await run(dir, "update", "--latest")).stderr).toBe(SAVED);
    await expectCatalog(dir, { aliased: "npm:no-deps@~2.0.0", tagged: "npm:dep-with-tags@^3.0.0" });
    expect(await installed(dir, "aliased")).toMatchObject({ name: "no-deps", version: "2.0.0" });
    expect(await installed(dir, "tagged")).toMatchObject({ name: "dep-with-tags", version: "3.0.0" });
    expect(await resolutions(dir)).toStrictEqual([
      "dep-with-tags@3.0.0",
      "no-deps@2.0.0",
      "pkg1@workspace:packages/pkg1",
    ]);
    await expectInSync(dir, ["", PKG1]);
  });

  test.each([
    [[], { "no-deps": "^1.1.0", aliased: "npm:no-deps@~1.0.1" }, "1.1.0"],
    [["--latest"], { "no-deps": "^2.0.0", aliased: "npm:no-deps@~2.0.0" }, "2.0.0"],
  ])("bun update %j rewrites the singular catalog referenced as catalog:default", async (args, expected, version) => {
    const dir = await setup(CATALOG_REPO({ "no-deps": "^1.0.0", aliased: "npm:no-deps@~1.0.0" }, "catalog:default"));
    expect((await run(dir, "update", ...args)).stderr).toBe(SAVED);
    await expectCatalog(dir, expected);
    expect(await installed(dir, "no-deps")).toMatchObject({ version });
    expect((await pkg(dir, PKG1)).dependencies).toStrictEqual({
      "no-deps": "catalog:default",
      aliased: "catalog:default",
    });
    await expectInSync(dir, ["", PKG1]);
  });

  test("bun update --latest with install.exact pins a catalog entry", async () => {
    const dir = await setup(CATALOG_REPO({ "no-deps": "^1.0.0", aliased: "npm:no-deps@~1.0.0" }), { exact: true });
    expect((await run(dir, "update", "--latest")).stderr).toBe(SAVED);
    await expectCatalog(dir, { "no-deps": "2.0.0", aliased: "npm:no-deps@2.0.0" });
    expect(await installed(dir, "no-deps")).toMatchObject({ version: "2.0.0" });
    await expectInSync(dir, ["", PKG1]);
  });

  test("bun update with install.exact pins a catalog range in place", async () => {
    const dir = await setup(CATALOG_REPO({ "no-deps": "^1.0.0" }), { exact: true });
    expect((await run(dir, "update")).stderr).toBe(SAVED);
    await expectCatalog(dir, { "no-deps": "1.1.0" });
    expect(await installed(dir, "no-deps")).toMatchObject({ version: "1.1.0" });
    await expectInSync(dir, ["", PKG1]);
  });

  test.each([
    [{}, []],
    [{ devDependencies: { "no-deps": "catalog:" } }, []],
    [{}, ["-r"]],
  ])("install.exact does not pin a catalog range that a peer uses (also in %j, args %j)", async (groups, args) => {
    const catalog = { "no-deps": "^1.1.0", "a-dep": "^1.0.1" };
    const pkg1 = { dependencies: { "a-dep": "catalog:" }, peerDependencies: { "no-deps": "catalog:" }, ...groups };
    const dir = await setup(MONOREPO(pkg1, { workspaces: { packages: ["packages/*"], catalog } }), { exact: true });
    expect((await run(dir, "update", ...args)).stderr).toBe(SAVED);
    await expectCatalog(dir, { "no-deps": "^1.1.0", "a-dep": "1.0.10" });
    await expectInSync(dir, ["", PKG1]);
  });

  test("bun update --latest keeps the = prefix of a catalog entry", async () => {
    const dir = await setup(CATALOG_REPO({ "no-deps": "=1.0.0" }));
    const [pkgBefore, lockBefore] = await Promise.all([pkgText(dir), lockText(dir)]);
    expect((await run(dir, "update")).stderr).toBe("");
    expect(await pkgText(dir)).toBe(pkgBefore);
    expect(await lockText(dir)).toBe(lockBefore);
    expect((await run(dir, "update", "--latest")).stderr).toBe(SAVED);
    await expectCatalog(dir, { "no-deps": "=2.0.0" });
    expect(await installed(dir, "no-deps")).toMatchObject({ version: "2.0.0" });
    await expectInSync(dir, ["", PKG1]);
  });

  // pkg1 uses `no-deps` and it is at `latest`; no dependency uses `a-dep`, whose `latest` is 1.0.10. No entry moves.
  const SETTLED_REPO = MONOREPO(
    { dependencies: { "no-deps": "catalog:" } },
    { workspaces: { packages: ["packages/*"], catalog: { "no-deps": "2.0.0", "a-dep": "1.0.1" } } },
  );

  test.each([
    [[], ""],
    [["-r"], ""],
    [["--filter", "*"], ""],
    [[], PKG1],
    [["-r"], PKG1],
  ])("bun update --latest %j from '%s' leaves a catalog that does not move as written", async (flags, cwd) => {
    const dir = await setup(SETTLED_REPO);
    const [pkgBefore, lockBefore] = await Promise.all([pkgText(dir), lockText(dir)]);
    await runIn(dir, cwd, "update", "--latest", ...flags);
    expect(await pkgText(dir)).toBe(pkgBefore);
    expect(await lockText(dir)).toBe(lockBefore);
    await expectInSync(dir, ["", PKG1]);
  });

  test("a second bun update --latest -r changes nothing", async () => {
    const dir = await setup(CATALOG_REPO({ "no-deps": "^1.0.0" }));
    await run(dir, "update", "--latest", "-r");
    await expectCatalog(dir, { "no-deps": "^2.0.0" });
    const [pkgBefore, lockBefore] = await Promise.all([pkgText(dir), lockText(dir)]);
    await run(dir, "update", "--latest", "-r");
    expect(await pkgText(dir)).toBe(pkgBefore);
    expect(await lockText(dir)).toBe(lockBefore);
    await expectInSync(dir, ["", PKG1]);
  });

  test("bun add --catalog --filter", async () => {
    const dir = await setup(CATALOG_REPO());
    expect((await run(dir, "add", "a-dep", "--catalog", "--filter", "pkg1")).stderr).toBe(SAVED);
    await expectCatalog(dir, { "no-deps": "^1.0.0", aliased: "npm:no-deps", "a-dep": "^1.0.10" });
    expect((await pkg(dir, PKG1)).dependencies).toStrictEqual({
      "no-deps": "catalog:",
      aliased: "catalog:",
      "a-dep": "catalog:",
    });
    await expectInSync(dir, ["", PKG1]);
  });
});

describe.concurrent("$ref overrides", () => {
  test("$name follows the rewritten dependency; a literal override stays as written", async () => {
    const overrides = { "no-deps": "$no-deps", "one-range-dep": "1.0.0" };
    const dir = await setup({
      "package.json": root({ dependencies: { "no-deps": "1.0.0", "one-range-dep": "1.0.0" }, overrides }),
    });
    await writePkg(dir, root({ dependencies: { "no-deps": "^1.0.0", "one-range-dep": "1.0.0" }, overrides }));
    expect((await run(dir, "update")).stderr).toBe(SAVED);
    const manifest = await pkg(dir);
    expect(manifest.dependencies).toStrictEqual({ "no-deps": "^1.1.0", "one-range-dep": "1.0.0" });
    expect(manifest.overrides).toStrictEqual(overrides);
    expect((await lock(dir)).overrides).toStrictEqual({ "no-deps": "^1.1.0", "one-range-dep": "1.0.0" });
    await expectInSync(dir);
  });

  test("$alias follows the rewritten alias", async () => {
    const dir = await setup({
      "package.json": root({ dependencies: { a1: "npm:no-deps@^1.0.0" }, overrides: { a1: "$a1" } }),
    });
    expect((await run(dir, "update")).stderr).toBe(SAVED);
    expect((await pkg(dir)).dependencies).toStrictEqual({ a1: "npm:no-deps@^1.1.0" });
    expect((await lock(dir)).overrides).toStrictEqual({ a1: "npm:no-deps@^1.1.0" });
    await expectInSync(dir);
  });

  // The override key (no-deps, a transitive dependency of one-range-dep) is not the updated direct dependency.
  test("bun update <name> re-resolves a package whose $name override value changed", async () => {
    const overrides = { "no-deps": "$dep-with-tags" };
    const deps = (tags: string) =>
      root({ dependencies: { "one-range-dep": "1.0.0", "dep-with-tags": tags }, overrides });
    const dir = await setup({ "package.json": deps("1.0.0") });
    expect(await resolutions(dir, "no-deps")).toStrictEqual(["no-deps@1.0.0"]);

    await reinstall(dir, deps("^1.0.0"));
    expect(await resolutions(dir, "no-deps")).toStrictEqual(["no-deps@1.0.0"]);

    await run(dir, "update", "dep-with-tags");
    expect((await pkg(dir)).dependencies).toStrictEqual({ "one-range-dep": "1.0.0", "dep-with-tags": "^1.0.1" });
    const lockfile = await lock(dir);
    expect(lockfile.overrides).toStrictEqual({ "no-deps": "^1.0.1" });
    expect(lockfile.packages["one-range-dep/no-deps"]).toBeUndefined();
    expect(await resolutions(dir, "no-deps")).toStrictEqual(["no-deps@1.1.0"]);
    expect(await installed(dir, "no-deps")).toMatchObject({ version: "1.1.0" });
    await expectInSync(dir, [""], { reinstall: true });
  });

  // The overridden row belongs to the package version the update adds in this run.
  test("bun update <name> re-resolves the overridden row of the package version it adds", async () => {
    const overrides = { "no-deps": "$normal-dep-and-dev-dep" };
    const deps = (range: string) => root({ dependencies: { "normal-dep-and-dev-dep": range }, overrides });
    const dir = await setup({ "package.json": deps("1.0.0") });
    expect(await resolutions(dir, "no-deps")).toStrictEqual(["no-deps@1.0.0"]);

    await reinstall(dir, deps("^1.0.0"));
    expect(await resolutions(dir, "no-deps")).toStrictEqual(["no-deps@1.0.0"]);

    await run(dir, "update", "normal-dep-and-dev-dep");
    expect((await pkg(dir)).dependencies).toStrictEqual({ "normal-dep-and-dev-dep": "^1.0.2" });
    expect((await lock(dir)).overrides).toStrictEqual({ "no-deps": "^1.0.2" });
    expect(await resolutions(dir, "no-deps")).toStrictEqual(["no-deps@1.1.0"]);
    expect(await installed(dir, "no-deps")).toMatchObject({ version: "1.1.0" });
    await expectInSync(dir, [""], { reinstall: true });
  });

  test("a peer row follows the re-resolved package", async () => {
    const overrides = { "no-deps": "$dep-with-tags" };
    const deps = (tags: string) =>
      root({ dependencies: { "one-range-dep": "1.0.0", "1-peer-dep-a": "1.0.0", "dep-with-tags": tags }, overrides });
    const dir = await setup({ "package.json": deps("1.0.0") });
    expect(await resolutions(dir, "no-deps")).toStrictEqual(["no-deps@1.0.0"]);

    await reinstall(dir, deps("^1.0.0"));
    await run(dir, "update", "dep-with-tags");
    const { packages } = await lock(dir);
    expect(packages["no-deps"][0]).toBe("no-deps@1.1.0");
    expect(packages["1-peer-dep-a/no-deps"]).toBeUndefined();
    expect(await resolutions(dir, "no-deps")).toStrictEqual(["no-deps@1.1.0"]);
    await expectInSync(dir, [""], { reinstall: true });
  });

  // no-deps is reached through the peer row only: nothing provides it, so the row resolves again on its own.
  test("a peer row without a provider resolves again", async () => {
    const overrides = { "no-deps": "$dep-with-tags" };
    const deps = (tags: string) =>
      root({ dependencies: { "1-peer-dep-a": "1.0.0", "dep-with-tags": tags }, overrides });
    const dir = await setup({ "package.json": deps("1.0.0") });
    expect(await resolutions(dir, "no-deps")).toStrictEqual(["no-deps@1.0.0"]);

    await reinstall(dir, deps("^1.0.0"));
    await run(dir, "update", "dep-with-tags");
    expect((await lock(dir)).overrides).toStrictEqual({ "no-deps": "^1.0.1" });
    expect(await resolutions(dir, "no-deps")).toStrictEqual(["no-deps@1.1.0"]);
    await expectInSync(dir, [""], { reinstall: true });
  });

  test("bun update <name> re-resolves an optional row whose $name override value changed", async () => {
    const overrides = { "no-deps": "$dep-with-tags" };
    const deps = (tags: string) =>
      root({ dependencies: { "duplicate-optional": "1.0.1", "dep-with-tags": tags }, overrides });
    const dir = await setup({ "package.json": deps("1.0.0") });
    expect(await resolutions(dir, "no-deps")).toStrictEqual(["no-deps@1.0.0"]);

    await reinstall(dir, deps("^1.0.0"));
    await run(dir, "update", "dep-with-tags");
    expect((await lock(dir)).overrides).toStrictEqual({ "no-deps": "^1.0.1" });
    expect(await resolutions(dir, "no-deps")).toStrictEqual(["no-deps@1.1.0"]);
    expect(await installed(dir, "no-deps")).toMatchObject({ version: "1.1.0" });
    await expectInSync(dir, [""], { reinstall: true });
  });

  // The root declares the override; only the member declares the dependency it refers to.
  test("bun update <name> in a member re-resolves a package whose root $name override value changed", async () => {
    const overrides = { "no-deps": "$dep-with-tags" };
    const memberDeps = (tags: string) => ({ "one-range-dep": "1.0.0", "dep-with-tags": tags });
    const dir = await setup(MONOREPO({ dependencies: memberDeps("1.0.0") }, { overrides }));
    expect(await resolutions(dir, "no-deps")).toStrictEqual(["no-deps@1.0.0"]);

    await reinstall(dir, member("pkg1", { dependencies: memberDeps("^1.0.0") }), PKG1);
    await runIn(dir, PKG1, "update", "dep-with-tags");
    expect((await pkg(dir, PKG1)).dependencies).toStrictEqual(memberDeps("^1.0.1"));
    expect((await lock(dir)).overrides).toStrictEqual({ "no-deps": "^1.0.1" });
    expect(await resolutions(dir, "no-deps")).toStrictEqual(["no-deps@1.1.0"]);
    await install(dir, { frozen: true });
  });

  // After the update the members disagree on the referent, so the rule is dropped with a warning, as the next `bun install` would do.
  test("bun update <name> in one of two members that declare a root $name referent drops the rule", async () => {
    const overrides = { "no-deps": "$dep-with-tags" };
    const dir = await setup(
      WORKSPACES(
        { overrides },
        {
          pkg1: { dependencies: { "one-range-dep": "1.0.0", "dep-with-tags": "1.0.0" } },
          pkg2: { dependencies: { "dep-with-tags": "1.0.0" } },
        },
      ),
    );
    expect(await resolutions(dir, "no-deps")).toStrictEqual(["no-deps@1.0.0"]);

    await writePkg(
      dir,
      member("pkg1", { dependencies: { "one-range-dep": "1.0.0", "dep-with-tags": "^1.0.0" } }),
      PKG1,
    );
    await reinstall(dir, member("pkg2", { dependencies: { "dep-with-tags": "^1.0.0" } }), PKG2);
    const { stderr, exitCode } = await tryRun(dir, PKG1, "update", "dep-with-tags");
    expect(stderr).toContain('workspaces declare different versions of "dep-with-tags"');
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    expect((await pkg(dir, PKG1)).dependencies).toStrictEqual({ "one-range-dep": "1.0.0", "dep-with-tags": "^1.0.1" });
    expect((await pkg(dir, PKG2)).dependencies).toStrictEqual({ "dep-with-tags": "^1.0.0" });
    expect((await lock(dir)).overrides).toBeUndefined();
    await install(dir, { frozen: true, stderr: /workspaces declare different versions of "dep-with-tags"/ });
  });

  // For one-range-dep's no-deps row the rule wins over the root's npm: alias of that name. The alias is never overridden.
  test("next to an npm: alias with its name, the overridden dependency is resolved again and the alias is kept", async () => {
    const overrides = { "no-deps": "$dep-with-tags" };
    const deps = (tags: string) =>
      root({
        dependencies: { "one-range-dep": "1.0.0", "no-deps": "npm:@types/no-deps@1.0.0", "dep-with-tags": tags },
        overrides,
      });
    const dir = await setup({ "package.json": deps("1.0.0") });
    expect(await resolutions(dir, "@types/no-deps")).toStrictEqual(["@types/no-deps@1.0.0"]);

    await reinstall(dir, deps("^1.0.0"));
    await run(dir, "update", "dep-with-tags");
    const { packages } = await lock(dir);
    expect(packages["no-deps"][0]).toBe("@types/no-deps@1.0.0");
    expect(packages["one-range-dep/no-deps"][0]).toBe("no-deps@1.1.0");
    await expectInSync(dir, [""], { reinstall: true });
  });

  test("bun update <name> --latest keeps the rows of a $name override in sync", async () => {
    const overrides = { "no-deps": "$@types/no-deps" };
    const dir = await setup({
      "package.json": root({ dependencies: { "one-range-dep": "1.0.0", "@types/no-deps": "1.0.0" }, overrides }),
    });
    expect(await resolutions(dir, "no-deps")).toStrictEqual(["no-deps@1.0.0"]);

    await run(dir, "update", "@types/no-deps", "--latest");
    expect((await pkg(dir)).dependencies).toStrictEqual({ "one-range-dep": "1.0.0", "@types/no-deps": "2.0.0" });
    const lockfile = await lock(dir);
    expect(lockfile.overrides).toStrictEqual({ "no-deps": "2.0.0" });
    expect(await resolutions(dir, "no-deps")).toStrictEqual(["no-deps@2.0.0"]);
    expect(await installed(dir, "no-deps")).toMatchObject({ version: "2.0.0" });
    await expectInSync(dir, [""], { reinstall: true });
  });
});

// one-range-dep@1.0.0 (its only version) depends on no-deps@^1.0.0; the registry's `latest` no-deps is 2.0.0.
describe.concurrent("bun update --latest keeps the version an override selects", () => {
  const transitive = { "one-range-dep": "1.0.0" };
  const catalog = (entry: string) => ({ packages: [], catalog: { "no-deps": entry } });
  const selector = { dependencies: { "no-deps": "^1.0.0" }, overrides: { "no-deps@>=1.0.0": "1.0.0" } };
  const byName = { dependencies: transitive, overrides: { "no-deps": "$one-range-dep" } };

  test.each<[string, Json, string[], string]>([
    [
      "a catalog: override",
      { workspaces: catalog("1.0.0"), dependencies: transitive, overrides: { "no-deps": "catalog:" } },
      [],
      "1.0.0",
    ],
    [
      "a catalog: override whose entry is a range",
      { workspaces: catalog("^1.0.0"), dependencies: transitive, overrides: { "no-deps": "catalog:" } },
      [],
      "1.1.0",
    ],
    [
      "a catalog: resolution",
      { workspaces: catalog("1.0.0"), dependencies: transitive, resolutions: { "no-deps": "catalog:" } },
      [],
      "1.0.0",
    ],
    [
      "a catalog:<name> override",
      {
        workspaces: { packages: [], catalogs: { pins: { "no-deps": "1.0.0" } } },
        dependencies: transitive,
        overrides: { "no-deps": "catalog:pins" },
      },
      [],
      "1.0.0",
    ],
    [
      "a nested catalog: override",
      {
        workspaces: catalog("1.0.0"),
        dependencies: transitive,
        overrides: { "one-range-dep": { "no-deps": "catalog:" } },
      },
      [],
      "1.0.0",
    ],
    ["a $name override", byName, [], "1.0.0"],
    ["a $name override whose referent is named", byName, ["one-range-dep"], "1.0.0"],
    ["a selector override on a direct dependency", selector, [], "1.0.0"],
    ["a selector override on a direct dependency that is named", selector, ["no-deps"], "1.0.0"],
    ["a literal override", { dependencies: transitive, overrides: { "no-deps": "1.0.0" } }, [], "1.0.0"],
  ])("%s", async (_, fields, names, version) => {
    const dir = await setup({ "package.json": root(fields) });
    const [pkgBefore, lockBefore] = await Promise.all([pkgText(dir), lockText(dir)]);
    expect(await resolutions(dir, "no-deps")).toStrictEqual([`no-deps@${version}`]);

    await run(dir, "update", ...names, "--latest");
    expect(await resolutions(dir, "no-deps")).toStrictEqual([`no-deps@${version}`]);
    expect(await installed(dir, "no-deps")).toMatchObject({ version });
    expect(await pkgText(dir)).toBe(pkgBefore);
    expect(await lockText(dir)).toBe(lockBefore);
    await install(dir, { frozen: true });
  });

  test("a catalog entry that a dependency uses moves, and a catalog: override follows it", async () => {
    const dir = await setup({
      "package.json": root({
        workspaces: catalog("1.0.0"),
        dependencies: { ...transitive, "no-deps": "catalog:" },
        overrides: { "no-deps": "catalog:" },
      }),
    });
    await run(dir, "update", "--latest");
    expect((await pkg(dir)).workspaces.catalog).toStrictEqual({ "no-deps": "2.0.0" });
    expect(await resolutions(dir, "no-deps")).toStrictEqual(["no-deps@2.0.0"]);
    await expectInSync(dir);
  });

  test.each([
    [[], PKG1],
    [["-r"], ""],
    [["--filter", "*"], ""],
  ])("a catalog: override holds under %j from '%s' while the member's own dependency moves", async (flags, cwd) => {
    const dir = await setup(
      MONOREPO(
        { dependencies: { "a-dep": "1.0.1" } },
        {
          workspaces: { ...catalog("1.0.0"), packages: ["packages/*"] },
          dependencies: transitive,
          overrides: { "no-deps": "catalog:" },
        },
      ),
    );
    const rootBefore = await pkgText(dir);
    await runIn(dir, cwd, "update", "--latest", ...flags);
    expect(await resolutions(dir, "no-deps")).toStrictEqual(["no-deps@1.0.0"]);
    expect(await pkgText(dir)).toBe(rootBefore);
    expect((await pkg(dir, PKG1)).dependencies).toStrictEqual({ "a-dep": "1.0.10" });
    await expectInSync(dir, ["", PKG1]);
  });
});

describe.concurrent("bumping a direct dependency re-points its dependents", () => {
  const nested = (dir: string) => exists(join(dir, "node_modules", "one-range-dep", "node_modules"));
  const deps = (noDeps?: string) =>
    root({ dependencies: { "one-range-dep": "1.0.0", ...(noDeps === undefined ? {} : { "no-deps": noDeps }) } });

  test.each([
    ["text", true],
    ["binary", false],
  ])("bun install after editing package.json (%s lockfile)", async (_, text) => {
    const dir = await setup({ "package.json": deps("1.0.0") }, { text });
    expect(await installed(dir, "no-deps")).toMatchObject({ version: "1.0.0" });
    expect(await nested(dir)).toBe(false);

    await writePkg(dir, deps("1.0.1"));
    await install(dir);
    expect(await installed(dir, "no-deps")).toMatchObject({ version: "1.0.1" });
    expect(await nested(dir)).toBe(false);
    if (text) {
      const { packages } = await lock(dir);
      expect(Object.keys(packages).sort()).toStrictEqual(["no-deps", "one-range-dep"]);
      expect(packages["no-deps"][0]).toBe("no-deps@1.0.1");
    }

    await writePkg(dir, deps("2.0.0"));
    await install(dir);
    expect(await installed(dir, "no-deps")).toMatchObject({ version: "2.0.0" });
    expect(await installed(dir, "one-range-dep/node_modules/no-deps")).toMatchObject({ version: "1.0.1" });
    if (!text) return;
    expect(await resolutions(dir)).toStrictEqual(["no-deps@1.0.1", "no-deps@2.0.0", "one-range-dep@1.0.0"]);

    await writePkg(dir, deps());
    await install(dir);
    expect(await resolutions(dir)).toStrictEqual(["no-deps@1.0.1", "one-range-dep@1.0.0"]);

    await writePkg(dir, deps("1.0.0"));
    await install(dir);
    const { packages } = await lock(dir);
    expect(packages["no-deps"][0]).toBe("no-deps@1.0.0");
    expect(packages["one-range-dep/no-deps"][0]).toBe("no-deps@1.0.1");
    await expectInSync(dir);
  });

  test("declared by a workspace member", async () => {
    const dir = await setup(MONOREPO({ dependencies: { "one-range-dep": "1.0.0", "no-deps": "1.0.0" } }));
    expect((await lock(dir)).packages["no-deps"][0]).toBe("no-deps@1.0.0");

    await reinstall(dir, member("pkg1", { dependencies: { "one-range-dep": "1.0.0", "no-deps": "1.0.1" } }), PKG1);
    const { packages } = await lock(dir);
    expect(packages["no-deps"][0]).toBe("no-deps@1.0.1");
    expect(packages["one-range-dep/no-deps"]).toBeUndefined();
    expect(await nested(dir)).toBe(false);
  });

  test("bun update", async () => {
    const dir = await setup({ "package.json": deps("1.0.0") });
    await writePkg(dir, deps("^1.0.0"));
    expect((await run(dir, "update")).stderr).toBe(SAVED);
    const { packages } = await lock(dir);
    expect(packages["no-deps"][0]).toBe("no-deps@1.1.0");
    expect(packages["one-range-dep/no-deps"]).toBeUndefined();
    expect(await nested(dir)).toBe(false);
    await expectInSync(dir);
  });
});

// The locked version (no-deps@1.1.0) satisfies the new range in every row, so only the package name tells the edit apart.
describe.concurrent("pointing a dependency at a different package re-resolves it", () => {
  test.each([
    { key: "aliased", before: "npm:no-deps@^1.0.0", after: "npm:a-dep@^1.0.0" },
    { key: "a-dep", before: "npm:no-deps@^1.0.0", after: "^1.0.1" },
    { key: "no-deps", before: "^1.0.0", after: "npm:a-dep@^1.0.2" },
  ])('"$key": "$before" -> "$after"', async ({ key, before, after }) => {
    const dir = await setup({ "package.json": root({ dependencies: { [key]: before } }) });
    expect(await installed(dir, key)).toMatchObject({ name: "no-deps", version: "1.1.0" });

    await writePkg(dir, root({ dependencies: { [key]: after } }));
    const frozen = await tryRun(dir, "", "install", "--frozen-lockfile");
    expect(frozen.stderr).toContain("error: lockfile had changes, but lockfile is frozen");
    expect(frozen.exitCode).toBe(1);
    expect(await installed(dir, key)).toMatchObject({ name: "no-deps", version: "1.1.0" });

    await install(dir);
    expect(await installed(dir, key)).toMatchObject({ name: "a-dep", version: "1.0.10" });
    const { workspaces, packages } = await lock(dir);
    expect(workspaces[""].dependencies).toStrictEqual({ [key]: after });
    expect(
      Object.fromEntries(Object.entries(packages).map(([path, entry]) => [path, (entry as string[])[0]])),
    ).toStrictEqual({ [key]: "a-dep@1.0.10" });
    await expectInSync(dir, [""], { reinstall: true });
  });
});
