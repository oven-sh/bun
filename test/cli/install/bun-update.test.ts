import { file, spawn } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { access, appendFile, exists, mkdir, readFile, rm, writeFile } from "fs/promises";
import {
  VerdaccioRegistry,
  bunExe,
  bunEnv as env,
  normalizeBunSnapshot,
  readdirSorted,
  toBeValidBin,
  toHaveBins,
} from "harness";
import { basename, join } from "path";
import {
  createTestContext,
  destroyTestContext,
  dummyAfterAll,
  dummyBeforeAll,
  dummyRegistryForContext,
  setContextHandler,
  type TestContext,
} from "./dummy.registry.js";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);

expect.extend({
  toBeValidBin,
  toHaveBins,
});

type Json = Record<string, any>;
// The version list `dummyRegistry` serves under every package name, plus its `latest` tag.
type Versions = Record<string, object | string>;

const BAZ_0_0_3_ONLY: Versions = { "0.0.3": {}, latest: "0.0.3" };
const BAZ_0_0_3_AND_0_0_5: Versions = { "0.0.3": {}, "0.0.5": {}, latest: "0.0.5" };

// Every case in the first half of this file runs against the dummy registry through a context of its own: a registry
// URL prefix with its own handler and request counter, and its own package dir. Nothing is shared between cases, so
// they all run as `it.concurrent` (the verdaccio half below does the same with `createTestDir`).
async function testContext(): Promise<TestContext & Disposable> {
  const ctx = await createTestContext({ linker: "hoisted" });
  // The registry server routes requests to this very object, so it gets the dispose method added rather than copied.
  return Object.assign(ctx, { [Symbol.dispose]: () => destroyTestContext(ctx) });
}

function serve(ctx: TestContext, versions: Versions, urls: string[] = []) {
  setContextHandler(ctx, dummyRegistryForContext(ctx, urls, versions));
}

// The context's bunfig asks for bun.lockb; the cases that read the lockfile back ask for bun.lock instead.
function useTextLockfile(ctx: TestContext) {
  return writeFile(
    join(ctx.package_dir, "bunfig.toml"),
    `[install]\ncache = false\nregistry = "${ctx.registry_url}"\nsaveTextLockfile = true\nlinker = "hoisted"\n`,
  );
}

const PROGRESS_LINES = /^(?:Resolving dependencies|Resolved, downloaded and extracted \[\d+\])\n/gm;

// stdout comes back normalized for inline snapshots. stderr comes back without the two progress lines every
// resolving run prints, so callers assert the rest of it exactly.
async function run(ctx: TestContext, args: string[], cwd = "") {
  await using proc = spawn({
    cmd: [bunExe(), ...args],
    cwd: join(ctx.package_dir, cwd),
    env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out: normalizeBunSnapshot(out), err: err.replace(PROGRESS_LINES, ""), exitCode };
}

// Every install in this file either writes a changed lockfile or (with --frozen-lockfile) proves nothing changed.
async function runInstall(ctx: TestContext, ...args: string[]) {
  const { out, err, exitCode } = await run(ctx, ["install", ...args]);
  expect(err).toBe(args.includes("--frozen-lockfile") ? "" : "Saved lockfile\n");
  expect(exitCode).toBe(0);
  return out;
}

// An update that moved something saves the lockfile and one that found nothing to move says nothing; callers pin
// which of the two happened where it is the point of the case.
async function runUpdate(ctx: TestContext, args: string[], cwd = "") {
  const result = await run(ctx, ["update", ...args], cwd);
  expect(result.err).toMatch(/^(?:Saved lockfile\n)?$/);
  expect(result.exitCode).toBe(0);
  return result;
}

const packageJsonOf = (ctx: TestContext, rel = ""): Promise<Json> =>
  file(join(ctx.package_dir, rel, "package.json")).json();
const packageJsonTextOf = (ctx: TestContext, rel = "") => file(join(ctx.package_dir, rel, "package.json")).text();
const lockText = (ctx: TestContext) => file(join(ctx.package_dir, "bun.lock")).text();
const installedBazVersion = async (ctx: TestContext, rel = ""): Promise<string> =>
  (await file(join(ctx.package_dir, rel, "node_modules", "baz", "package.json")).json()).version;

// The package.json fields bun.lock repeats in its `workspaces` section.
const LOCKED_FIELDS = [
  "name",
  "version",
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

// `expected` is keyed by workspace path like bun.lock's `workspaces` section ("" is the root). It is checked against
// the package.json files, and then against that section (plus the root catalog, which bun.lock keeps at its top
// level), so the same object proves the update kept the lockfile in sync with what it wrote.
async function expectWorkspaces(ctx: TestContext, expected: Record<string, Json>) {
  const manifests: Record<string, Json> = {};
  const locked: Record<string, Json> = {};
  for (const [rel, json] of Object.entries(expected)) {
    manifests[rel] = await packageJsonOf(ctx, rel);
    locked[rel] = Object.fromEntries(LOCKED_FIELDS.filter(field => field in json).map(field => [field, json[field]]));
  }
  expect(manifests).toEqual(expected);
  const lock = Bun.JSONC.parse(await lockText(ctx)) as Json;
  expect(lock.workspaces).toEqual(locked);
  if (expected[""]?.catalog) expect(lock.catalog).toEqual(expected[""].catalog);
}

// Writes the root and the members (a key without a slash is a directory under `packages/`), installs against
// `versions`, and returns the files as written, keyed for `expectWorkspaces`.
async function setupWorkspaces(
  ctx: TestContext,
  root: Json,
  members: Record<string, Json>,
  versions: Versions = BAZ_0_0_3_AND_0_0_5,
) {
  serve(ctx, versions);
  await useTextLockfile(ctx);
  const written: Record<string, Json> = { "": { name: "root", private: true, workspaces: ["packages/*"], ...root } };
  for (const [dir, body] of Object.entries(members)) {
    const rel = dir.includes("/") ? dir : `packages/${dir}`;
    written[rel] = { name: basename(rel), ...body };
  }
  for (const [rel, json] of Object.entries(written)) {
    await mkdir(join(ctx.package_dir, rel), { recursive: true });
    await writeFile(join(ctx.package_dir, rel, "package.json"), JSON.stringify(json));
  }
  await runInstall(ctx);
  await expectWorkspaces(ctx, written);
  return written;
}

it.concurrent("should update to latest version of dependency", async () => {
  using ctx = await testContext();
  const { package_dir } = ctx;
  const urls: string[] = [];
  const registry = {
    "0.0.3": {
      bin: {
        "baz-run": "index.js",
      },
    },
    "0.0.5": {
      bin: {
        "baz-exec": "index.js",
      },
    },
    latest: "0.0.3",
  };
  serve(ctx, registry, urls);
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      dependencies: {
        baz: "~0.0.3",
      },
    }),
  );
  expect(await runInstall(ctx)).toMatchInlineSnapshot(`
    "bun install <version> (<revision>)

    + baz@0.0.3

    1 package installed"
  `);
  expect(urls.sort()).toEqual([`${ctx.registry_url}baz`, `${ctx.registry_url}baz-0.0.3.tgz`]);
  expect(ctx.requested).toBe(2);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "baz"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toHaveBins(["baz-run"]);
  expect(join(package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "baz", "index.js"));
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  await access(join(package_dir, "bun.lockb"));

  // Perform `bun update` with updated registry & lockfile from before
  await rm(join(package_dir, "node_modules"), { force: true, recursive: true });
  urls.length = 0;
  registry.latest = "0.0.5";
  serve(ctx, registry, urls);
  const { out, err } = await runUpdate(ctx, ["baz"]);
  expect(err).toBe("Saved lockfile\n");
  expect(out).toMatchInlineSnapshot(`
    "bun update <version> (<revision>)

    ^ baz 0.0.3 -> 0.0.5

    1 package installed"
  `);
  expect(urls.sort()).toEqual([`${ctx.registry_url}baz`, `${ctx.registry_url}baz-0.0.5.tgz`]);
  expect(ctx.requested).toBe(4);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "baz"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toHaveBins(["baz-exec"]);
  expect(join(package_dir, "node_modules", ".bin", "baz-exec")).toBeValidBin(join("..", "baz", "index.js"));
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.5",
    bin: {
      "baz-exec": "index.js",
    },
  });
  expect(await packageJsonOf(ctx)).toEqual({
    name: "foo",
    dependencies: {
      baz: "~0.0.5",
    },
  });
  await access(join(package_dir, "bun.lockb"));
});

it.concurrent("should update to latest versions of dependencies", async () => {
  using ctx = await testContext();
  const { package_dir } = ctx;
  const urls: string[] = [];
  const registry = {
    "0.0.3": {
      bin: {
        "baz-run": "index.js",
      },
    },
    "0.0.5": {
      bin: {
        "baz-exec": "index.js",
      },
    },
    "0.1.0": {},
    latest: "0.0.3",
  };
  serve(ctx, registry, urls);
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      dependencies: {
        "@barn/moo": "~0.1.0",
        baz: "~0.0.3",
      },
    }),
  );
  expect(await runInstall(ctx)).toMatchInlineSnapshot(`
    "bun install <version> (<revision>)

    + @barn/moo@0.1.0
    + baz@0.0.3

    2 packages installed"
  `);
  expect(urls.sort()).toEqual([
    `${ctx.registry_url}@barn%2fmoo`,
    `${ctx.registry_url}@barn/moo-0.1.0.tgz`,
    `${ctx.registry_url}baz`,
    `${ctx.registry_url}baz-0.0.3.tgz`,
  ]);
  expect(ctx.requested).toBe(4);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "@barn", "baz"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toHaveBins(["baz-run"]);
  expect(join(package_dir, "node_modules", ".bin", "baz-run")).toBeValidBin(join("..", "baz", "index.js"));
  expect(await readdirSorted(join(package_dir, "node_modules", "@barn"))).toEqual(["moo"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "@barn", "moo"))).toEqual(["package.json"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.3",
    bin: {
      "baz-run": "index.js",
    },
  });
  await access(join(package_dir, "bun.lockb"));

  // Perform `bun update` with updated registry & lockfile from before
  await rm(join(package_dir, "node_modules"), { force: true, recursive: true });
  urls.length = 0;
  registry.latest = "0.0.5";
  serve(ctx, registry, urls);
  const { out, err } = await runUpdate(ctx, []);
  expect(err).toBe("Saved lockfile\n");
  expect(out).toMatchInlineSnapshot(`
    "bun update <version> (<revision>)

    ^ baz 0.0.3 -> 0.0.5

    + @barn/moo@0.1.0

    2 packages installed"
  `);
  expect(urls.sort()).toEqual([
    `${ctx.registry_url}@barn%2fmoo`,
    `${ctx.registry_url}@barn/moo-0.1.0.tgz`,
    `${ctx.registry_url}baz`,
    `${ctx.registry_url}baz-0.0.5.tgz`,
  ]);
  expect(ctx.requested).toBe(8);
  expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".bin", ".cache", "@barn", "baz"]);
  expect(await readdirSorted(join(package_dir, "node_modules", ".bin"))).toHaveBins(["baz-exec"]);
  expect(join(package_dir, "node_modules", ".bin", "baz-exec")).toBeValidBin(join("..", "baz", "index.js"));
  expect(await readdirSorted(join(package_dir, "node_modules", "@barn"))).toEqual(["moo"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "@barn", "moo"))).toEqual(["package.json"]);
  expect(await readdirSorted(join(package_dir, "node_modules", "baz"))).toEqual(["index.js", "package.json"]);
  expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toEqual({
    name: "baz",
    version: "0.0.5",
    bin: {
      "baz-exec": "index.js",
    },
  });
  expect(await packageJsonOf(ctx)).toEqual({
    name: "foo",
    dependencies: {
      "@barn/moo": "~0.1.0",
      baz: "~0.0.5",
    },
  });
  await access(join(package_dir, "bun.lockb"));
});

it.concurrent("lockfile should not be modified when there are no version changes, issue#5888", async () => {
  using ctx = await testContext();
  const urls: string[] = [];
  serve(ctx, { "0.0.3": { bin: { "baz-run": "index.js" } }, latest: "0.0.3" }, urls);
  const packageJson = { name: "foo", dependencies: { baz: "0.0.3" } };
  await writeFile(join(ctx.package_dir, "package.json"), JSON.stringify(packageJson));
  expect(await runInstall(ctx)).toMatchInlineSnapshot(`
    "bun install <version> (<revision>)

    + baz@0.0.3

    1 package installed"
  `);
  const lockb = await readFile(join(ctx.package_dir, "bun.lockb"));

  urls.length = 0;
  for (let i = 0; i < 2; i++) {
    // Nothing moved, so the update must not even re-save the lockfile.
    expect((await runUpdate(ctx, [])).err).toBe("");
    expect(await readFile(join(ctx.package_dir, "bun.lockb"))).toStrictEqual(lockb);
  }
  // Each update did ask the registry, rather than skipping the resolution.
  expect(urls).toEqual([`${ctx.registry_url}baz`, `${ctx.registry_url}baz`]);
  expect(await packageJsonOf(ctx)).toEqual(packageJson);
});

// https://github.com/oven-sh/bun/issues/33176
// The same dependency name in two workspaces, one as a regular dep and one as a peer dep, so the update must fan
// out to both members and handle each workspace's dependency groups independently.
it.concurrent("--recursive updates dependencies and peerDependencies in workspace members", async () => {
  using ctx = await testContext();
  const written = await setupWorkspaces(
    ctx,
    {},
    {
      "pkg-a": { dependencies: { baz: "~0.0.3" } },
      "pkg-b": { peerDependencies: { baz: "~0.0.3" } },
    },
  );
  expect((await runUpdate(ctx, ["--recursive"])).err).toBe("Saved lockfile\n");
  await expectWorkspaces(ctx, {
    ...written,
    "packages/pkg-a": { name: "pkg-a", dependencies: { baz: "~0.0.5" } },
    "packages/pkg-b": { name: "pkg-b", peerDependencies: { baz: "~0.0.5" } },
  });
});

// https://github.com/oven-sh/bun/issues/33176
// An exact pin below latest only moves with `--latest`, so this also proves the member goes through the `--latest`
// path rather than the range-constrained update.
it.concurrent("--recursive --latest updates workspace members to the latest version", async () => {
  using ctx = await testContext();
  const written = await setupWorkspaces(ctx, {}, { "pkg-a": { dependencies: { baz: "0.0.3" } } });
  expect(await installedBazVersion(ctx)).toBe("0.0.3");
  expect((await runUpdate(ctx, ["--recursive", "--latest"])).err).toBe("Saved lockfile\n");
  await expectWorkspaces(ctx, { ...written, "packages/pkg-a": { name: "pkg-a", dependencies: { baz: "0.0.5" } } });
  expect(await installedBazVersion(ctx)).toBe("0.0.5");
});

// https://github.com/oven-sh/bun/issues/33176
it.concurrent("--filter updates only matching workspaces, leaving siblings and root untouched", async () => {
  using ctx = await testContext();
  const written = await setupWorkspaces(
    ctx,
    { dependencies: { baz: "~0.0.3" } },
    {
      "pkg-a": { dependencies: { baz: "~0.0.3" } },
      "pkg-b": { dependencies: { baz: "~0.0.3" } },
    },
  );
  await runUpdate(ctx, ["--filter", "pkg-a"]);
  await expectWorkspaces(ctx, { ...written, "packages/pkg-a": { name: "pkg-a", dependencies: { baz: "~0.0.5" } } });
});

// Root and pkg-a pin baz to different versions, so pkg-a gets a nested copy. The pin named in `widen` is then
// replaced by a range its locked resolution still satisfies, so a plain install keeps both copies where they are.
async function nestedBazRepo(
  ctx: TestContext,
  rootPin: string,
  pkgAPin: string,
  widen: { root?: string; pkgA?: string },
) {
  const written = await setupWorkspaces(
    ctx,
    { dependencies: { baz: rootPin } },
    { "pkg-a": { dependencies: { baz: pkgAPin } } },
  );
  if (widen.root) written[""] = { ...written[""], dependencies: { baz: widen.root } };
  if (widen.pkgA) written["packages/pkg-a"] = { name: "pkg-a", dependencies: { baz: widen.pkgA } };
  await writeFile(join(ctx.package_dir, "package.json"), JSON.stringify(written[""]));
  await writeFile(
    join(ctx.package_dir, "packages", "pkg-a", "package.json"),
    JSON.stringify(written["packages/pkg-a"]),
  );
  await runInstall(ctx);
  await expectWorkspaces(ctx, written);
  expect(await installedBazVersion(ctx)).toBe(rootPin);
  expect(await installedBazVersion(ctx, "packages/pkg-a")).toBe(pkgAPin);
  return written;
}

const pkgABazDir = (ctx: TestContext) => join(ctx.package_dir, "packages", "pkg-a", "node_modules", "baz");

it.concurrent("--filter pkg-a removes the nested copy whose row it collapsed", async () => {
  using ctx = await testContext();
  const written = await nestedBazRepo(ctx, "0.0.5", "0.0.3", { pkgA: "~0.0.3" });
  expect((await runUpdate(ctx, ["--filter", "pkg-a"])).err).toBe("Saved lockfile\n");
  await expectWorkspaces(ctx, { ...written, "packages/pkg-a": { name: "pkg-a", dependencies: { baz: "~0.0.5" } } });
  expect(await exists(pkgABazDir(ctx))).toBeFalse();
  expect(await installedBazVersion(ctx)).toBe("0.0.5");
});

it.concurrent("--filter excluding a workspace leaves that workspace's node_modules alone", async () => {
  using ctx = await testContext();
  const written = await nestedBazRepo(ctx, "0.0.3", "0.0.5", { root: "~0.0.3" });
  expect((await runUpdate(ctx, ["--filter", "root"])).err).toBe("Saved lockfile\n");
  await expectWorkspaces(ctx, { ...written, "": { ...written[""], dependencies: { baz: "~0.0.5" } } });
  expect(await installedBazVersion(ctx)).toBe("0.0.5");
  expect(await installedBazVersion(ctx, "packages/pkg-a")).toBe("0.0.5");

  const { err, exitCode } = await run(ctx, ["prune"]);
  expect(err).toBe("");
  expect(exitCode).toBe(0);
  expect(await exists(pkgABazDir(ctx))).toBeFalse();
  expect(await installedBazVersion(ctx)).toBe("0.0.5");
});

// Multiple `--filter` patterns select the union of matches (any positive), minus negations.
it.concurrent("--filter with multiple patterns selects the union of matching workspaces", async () => {
  using ctx = await testContext();
  const member = { dependencies: { baz: "~0.0.3" } };
  const written = await setupWorkspaces(ctx, member, { "pkg-a": member, "pkg-b": member, "pkg-c": member });
  await runUpdate(ctx, ["--filter", "pkg-a", "--filter", "pkg-b"]);
  await expectWorkspaces(ctx, {
    ...written,
    "packages/pkg-a": { name: "pkg-a", dependencies: { baz: "~0.0.5" } },
    "packages/pkg-b": { name: "pkg-b", dependencies: { baz: "~0.0.5" } },
  });
});

// https://github.com/oven-sh/bun/issues/33176
// Root pins baz exactly, pkg-a uses `~`, pkg-b uses `^` in devDependencies and pkg-c does not depend on it. The
// files are written indented with a trailing newline, so a rewrite that keeps the style differs from the original
// text in the version alone.
const FAN_OUT: Record<string, Json> = {
  "": { name: "root", private: true, workspaces: ["packages/*"], dependencies: { baz: "0.0.3" } },
  "packages/pkg-a": { name: "pkg-a", dependencies: { baz: "~0.0.3" } },
  "packages/pkg-b": { name: "pkg-b", devDependencies: { baz: "^0.0.3" } },
  "packages/pkg-c": { name: "pkg-c" },
};

async function fanOutTexts(ctx: TestContext) {
  const texts: Record<string, string> = {};
  for (const rel of Object.keys(FAN_OUT)) texts[rel] = await packageJsonTextOf(ctx, rel);
  return texts;
}

async function fanOutRepo(ctx: TestContext, versions: Versions = BAZ_0_0_3_AND_0_0_5) {
  serve(ctx, versions);
  await useTextLockfile(ctx);
  for (const [rel, json] of Object.entries(FAN_OUT)) {
    await mkdir(join(ctx.package_dir, rel), { recursive: true });
    await writeFile(join(ctx.package_dir, rel, "package.json"), JSON.stringify(json, null, 2) + "\n");
  }
  await runInstall(ctx);
  await expectWorkspaces(ctx, FAN_OUT);
  const texts = await fanOutTexts(ctx);
  return { texts, lock: await lockText(ctx) };
}

// What an update that reaches pkg-a alone leaves behind: its file changes, and only in its version.
const PKG_A_MOVED = { ...FAN_OUT, "packages/pkg-a": { name: "pkg-a", dependencies: { baz: "~0.0.5" } } };
const pkgAMovedTexts = (texts: Record<string, string>) => ({
  ...texts,
  "packages/pkg-a": texts["packages/pkg-a"].replace("~0.0.3", "~0.0.5"),
});

it.concurrent(
  "named update -r --latest rewrites every workspace that declares the name, keeping each file's style",
  async () => {
    using ctx = await testContext();
    const { texts } = await fanOutRepo(ctx);
    const { out, err } = await runUpdate(ctx, ["baz", "-r", "--latest"]);
    expect(err).toBe("Saved lockfile\n");
    expect(out).toMatchInlineSnapshot(`
      "bun update <version> (<revision>)

      ^ baz 0.0.3 -> 0.0.5

      1 package installed"
    `);
    await expectWorkspaces(ctx, {
      ...PKG_A_MOVED,
      "": { ...FAN_OUT[""], dependencies: { baz: "0.0.5" } },
      "packages/pkg-b": { name: "pkg-b", devDependencies: { baz: "^0.0.5" } },
    });
    expect(await fanOutTexts(ctx)).toEqual({
      "": texts[""].replace('"0.0.3"', '"0.0.5"'),
      "packages/pkg-a": texts["packages/pkg-a"].replace("~0.0.3", "~0.0.5"),
      "packages/pkg-b": texts["packages/pkg-b"].replace("^0.0.3", "^0.0.5"),
      "packages/pkg-c": texts["packages/pkg-c"],
    });
  },
);

it.concurrent("named update --filter rewrites only the selected workspace", async () => {
  using ctx = await testContext();
  const { texts } = await fanOutRepo(ctx);
  expect((await runUpdate(ctx, ["baz", "--filter", "pkg-a", "--latest"])).err).toBe("Saved lockfile\n");
  await expectWorkspaces(ctx, PKG_A_MOVED);
  expect(await fanOutTexts(ctx)).toEqual(pkgAMovedTexts(texts));
});

it.concurrent("named update accepts -F as the short form of --filter", async () => {
  using ctx = await testContext();
  const { texts } = await fanOutRepo(ctx);
  expect((await runUpdate(ctx, ["baz", "-F", "pkg-a", "--latest"])).err).toBe("Saved lockfile\n");
  await expectWorkspaces(ctx, PKG_A_MOVED);
  expect(await fanOutTexts(ctx)).toEqual(pkgAMovedTexts(texts));
});

it.concurrent("named update --filter of a workspace that does not depend on the name is an error", async () => {
  using ctx = await testContext();
  const before = await fanOutRepo(ctx);
  const { out, err, exitCode } = await run(ctx, ["update", "baz", "--filter", "pkg-c"]);
  expect(err).toBe(
    'error: "baz" is not a dependency of the selected workspaces\n    bun update -r baz\n    bun update --filter root baz\n    bun update --filter pkg-a baz\n    bun update --filter pkg-b baz\n',
  );
  expect(out).toMatchInlineSnapshot(`"bun update <version> (<revision>)"`);
  expect(exitCode).toBe(1);
  expect(await fanOutTexts(ctx)).toEqual(before.texts);
  expect(await lockText(ctx)).toBe(before.lock);
});

it.concurrent("named update -r with a name missing from the lockfile is an error", async () => {
  using ctx = await testContext();
  const before = await fanOutRepo(ctx);
  const { out, err, exitCode } = await run(ctx, ["update", "nope", "-r"]);
  expect(err).toBe('error: "nope" is not in bun.lock\n    bun add nope\n');
  expect(out).toMatchInlineSnapshot(`"bun update <version> (<revision>)"`);
  expect(exitCode).toBe(1);
  expect(await fanOutTexts(ctx)).toEqual(before.texts);
  expect(await lockText(ctx)).toBe(before.lock);
});

// Root's exact pin and pkg-b's `^0.0.3` (which excludes 0.0.5) only move with --latest.
it.concurrent("named update -r moves the ranges and keeps bun.lock in sync", async () => {
  using ctx = await testContext();
  const { texts } = await fanOutRepo(ctx, BAZ_0_0_3_ONLY);
  serve(ctx, BAZ_0_0_3_AND_0_0_5);
  const { out, err } = await runUpdate(ctx, ["baz", "-r"]);
  expect(err).toBe("Saved lockfile\n");
  expect(out).toMatchInlineSnapshot(`
    "bun update <version> (<revision>)

    ^ baz 0.0.3 -> 0.0.5

    1 package installed"
  `);
  await expectWorkspaces(ctx, PKG_A_MOVED);
  expect(await fanOutTexts(ctx)).toEqual(pkgAMovedTexts(texts));
  await runInstall(ctx, "--frozen-lockfile");
});

it.concurrent("named update -r --dry-run writes nothing", async () => {
  using ctx = await testContext();
  const before = await fanOutRepo(ctx);
  const { out, err } = await runUpdate(ctx, ["baz", "-r", "--latest", "--dry-run"]);
  expect(err).toBe("");
  expect(out).toMatchInlineSnapshot(`
    "bun update <version> (<revision>)

    ^ baz 0.0.3 -> 0.0.5

    1 package would be updated"
  `);
  expect(await fanOutTexts(ctx)).toEqual(before.texts);
  expect(await lockText(ctx)).toBe(before.lock);
});

// https://github.com/oven-sh/bun/issues/33176
// A workspace member's `catalog:` reference must survive `bun update`: the version lives in the root catalog, not
// inline in the member, and 0.0.5 is outside the catalog's range.
it.concurrent("--recursive preserves a workspace member's catalog: reference", async () => {
  using ctx = await testContext();
  const written = await setupWorkspaces(
    ctx,
    { catalog: { baz: "^0.0.3" } },
    { "pkg-a": { dependencies: { baz: "catalog:" } } },
  );
  expect(await installedBazVersion(ctx)).toBe("0.0.3");
  await runUpdate(ctx, ["--recursive"]);
  await expectWorkspaces(ctx, written);
  expect(await installedBazVersion(ctx)).toBe("0.0.3");
});

// `--filter` excluding root must not touch the root package.json (catalogs included), so the lockfile stays
// consistent with the on-disk root.
it.concurrent("--filter excluding root leaves root (and its catalog) untouched", async () => {
  using ctx = await testContext();
  const written = await setupWorkspaces(
    ctx,
    { catalog: { baz: "^0.0.3" }, dependencies: { baz: "^0.0.3" } },
    { "pkg-a": { dependencies: { baz: "catalog:" } } },
  );
  const rootText = await packageJsonTextOf(ctx);
  await runUpdate(ctx, ["--filter", "pkg-a", "--latest"]);
  await expectWorkspaces(ctx, written);
  expect(await packageJsonTextOf(ctx)).toBe(rootText);
  // pkg-a's `catalog:` dep stays within the catalog range; `--latest` must not bypass it.
  expect(await installedBazVersion(ctx)).toBe("0.0.3");
  // A subsequent frozen-lockfile install must pass (no catalog drift vs. lockfile).
  await runInstall(ctx, "--frozen-lockfile");
});

// `-r` from inside a member must write root's catalog and direct deps in one pass (the member-commit path carries
// both).
it.concurrent("--recursive --latest from a member updates root's catalog and direct deps together", async () => {
  using ctx = await testContext();
  const written = await setupWorkspaces(
    ctx,
    { catalog: { baz: "^0.0.3" }, dependencies: { baz: "^0.0.3" } },
    { "pkg-a": { dependencies: { baz: "catalog:" } } },
  );
  expect(await installedBazVersion(ctx)).toBe("0.0.3");
  expect((await runUpdate(ctx, ["--recursive", "--latest"], "packages/pkg-a")).err).toBe("Saved lockfile\n");
  await expectWorkspaces(ctx, {
    ...written,
    "": { ...written[""], catalog: { baz: "^0.0.5" }, dependencies: { baz: "^0.0.5" } },
  });
  expect(await installedBazVersion(ctx)).toBe("0.0.5");
});

// https://github.com/oven-sh/bun/issues/33176
it.concurrent("--filter with a path targets only the matching workspace", async () => {
  using ctx = await testContext();
  const member = { dependencies: { baz: "~0.0.3" } };
  const written = await setupWorkspaces(ctx, member, { "pkg-a": member, "pkg-b": member });
  await runUpdate(ctx, ["--filter", "./packages/pkg-a"]);
  await expectWorkspaces(ctx, { ...written, "packages/pkg-a": { name: "pkg-a", dependencies: { baz: "~0.0.5" } } });
});

// https://github.com/oven-sh/bun/issues/33176
// `!pkg-a` excludes pkg-a but keeps the root and sibling members.
it.concurrent("--filter with a negated pattern updates everything except the excluded workspace", async () => {
  using ctx = await testContext();
  const member = { dependencies: { baz: "~0.0.3" } };
  const written = await setupWorkspaces(ctx, member, { "pkg-a": member, "pkg-b": member });
  await runUpdate(ctx, ["--filter", "!pkg-a"]);
  await expectWorkspaces(ctx, {
    ...written,
    "": { ...written[""], dependencies: { baz: "~0.0.5" } },
    "packages/pkg-b": { name: "pkg-b", dependencies: { baz: "~0.0.5" } },
  });
});

// https://github.com/oven-sh/bun/issues/23507
it.concurrent("--filter with a glob plus a negation scopes to the matched set minus the exclusion", async () => {
  using ctx = await testContext();
  const member = { dependencies: { baz: "~0.0.3" } };
  const written = await setupWorkspaces(ctx, member, { "pkg-a": member, "pkg-b": member, "pkg-c": member });
  await runUpdate(ctx, ["--filter", "pkg-*", "--filter", "!pkg-c"]);
  await expectWorkspaces(ctx, {
    ...written,
    "packages/pkg-a": { name: "pkg-a", dependencies: { baz: "~0.0.5" } },
    "packages/pkg-b": { name: "pkg-b", dependencies: { baz: "~0.0.5" } },
  });
});

// https://github.com/oven-sh/bun/issues/23507
for (const group of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
  it.concurrent(`--recursive --latest updates a member's ${group}`, async () => {
    using ctx = await testContext();
    const written = await setupWorkspaces(ctx, {}, { "pkg-a": { [group]: { baz: "0.0.3" } } });
    await runUpdate(ctx, ["--recursive", "--latest"]);
    await expectWorkspaces(ctx, { ...written, "packages/pkg-a": { name: "pkg-a", [group]: { baz: "0.0.5" } } });
  });
}

// https://github.com/oven-sh/bun/issues/23507
it.concurrent("--recursive --latest updates an npm: aliased dep in a member, preserving the alias", async () => {
  using ctx = await testContext();
  const written = await setupWorkspaces(ctx, {}, { "pkg-a": { dependencies: { aliased: "npm:baz@0.0.3" } } });
  await runUpdate(ctx, ["--recursive", "--latest"]);
  await expectWorkspaces(ctx, {
    ...written,
    "packages/pkg-a": { name: "pkg-a", dependencies: { aliased: "npm:baz@0.0.5" } },
  });
});

// https://github.com/oven-sh/bun/issues/23507
it.concurrent("--recursive does not rewrite workspace: protocol references between members", async () => {
  using ctx = await testContext();
  const written = await setupWorkspaces(
    ctx,
    {},
    {
      "pkg-a": { version: "1.0.0", dependencies: { baz: "~0.0.3" } },
      "pkg-b": { dependencies: { "pkg-a": "workspace:*", baz: "~0.0.3" } },
    },
  );
  await runUpdate(ctx, ["--recursive"]);
  await expectWorkspaces(ctx, {
    ...written,
    "packages/pkg-a": { name: "pkg-a", version: "1.0.0", dependencies: { baz: "~0.0.5" } },
    "packages/pkg-b": { name: "pkg-b", dependencies: { "pkg-a": "workspace:*", baz: "~0.0.5" } },
  });
});

// https://github.com/oven-sh/bun/issues/23507
it.concurrent("--recursive from inside a member updates siblings and root", async () => {
  using ctx = await testContext();
  const member = { dependencies: { baz: "~0.0.3" } };
  const written = await setupWorkspaces(ctx, member, { "pkg-a": member, "pkg-b": member });
  await runUpdate(ctx, ["--recursive"], "packages/pkg-a");
  await expectWorkspaces(ctx, {
    "": { ...written[""], dependencies: { baz: "~0.0.5" } },
    "packages/pkg-a": { name: "pkg-a", dependencies: { baz: "~0.0.5" } },
    "packages/pkg-b": { name: "pkg-b", dependencies: { baz: "~0.0.5" } },
  });
});

// https://github.com/oven-sh/bun/issues/23507
it.concurrent("--recursive --dry-run writes no workspace package.json", async () => {
  using ctx = await testContext();
  const member = { dependencies: { baz: "~0.0.3" } };
  const written = await setupWorkspaces(ctx, member, { "pkg-a": member });
  const lockBefore = await lockText(ctx);
  expect((await runUpdate(ctx, ["--recursive", "--latest", "--dry-run"])).err).toBe("");
  await expectWorkspaces(ctx, written);
  expect(await lockText(ctx)).toBe(lockBefore);
});

// https://github.com/oven-sh/bun/issues/23507
it.concurrent("--recursive preserves each member's pin style independently", async () => {
  using ctx = await testContext();
  const written = await setupWorkspaces(
    ctx,
    {},
    {
      "pkg-a": { dependencies: { baz: "^0.0.3" } },
      "pkg-b": { dependencies: { baz: "~0.0.3" } },
      "pkg-c": { dependencies: { baz: "0.0.3" } },
    },
  );
  await runUpdate(ctx, ["--recursive", "--latest"]);
  await expectWorkspaces(ctx, {
    ...written,
    "packages/pkg-a": { name: "pkg-a", dependencies: { baz: "^0.0.5" } },
    "packages/pkg-b": { name: "pkg-b", dependencies: { baz: "~0.0.5" } },
    "packages/pkg-c": { name: "pkg-c", dependencies: { baz: "0.0.5" } },
  });
});

// https://github.com/oven-sh/bun/issues/23507
it.concurrent("--filter with a scoped glob (@scope/*) targets only those members", async () => {
  using ctx = await testContext();
  const member = { dependencies: { baz: "~0.0.3" } };
  const written = await setupWorkspaces(ctx, member, {
    "scope-a": { name: "@scope/a", ...member },
    "scope-b": { name: "@scope/b", ...member },
    other: member,
  });
  await runUpdate(ctx, ["--filter", "@scope/*"]);
  await expectWorkspaces(ctx, {
    ...written,
    "packages/scope-a": { name: "@scope/a", dependencies: { baz: "~0.0.5" } },
    "packages/scope-b": { name: "@scope/b", dependencies: { baz: "~0.0.5" } },
  });
});

// https://github.com/oven-sh/bun/issues/23507
// The override pins baz to 0.0.3; --latest must not resolve past it.
for (const depLiteral of ["^0.0.3", "0.0.3"]) {
  it.concurrent(
    `--recursive --latest does not bypass a root overrides entry (member dep literal ${depLiteral})`,
    async () => {
      using ctx = await testContext();
      const written = await setupWorkspaces(
        ctx,
        { overrides: { baz: "0.0.3" } },
        { "pkg-a": { dependencies: { baz: depLiteral } } },
      );
      await runUpdate(ctx, ["--recursive", "--latest"]);
      await expectWorkspaces(ctx, written);
      expect(await installedBazVersion(ctx)).toBe("0.0.3");
    },
  );
}

// https://github.com/oven-sh/bun/issues/23507
it.concurrent("--recursive --no-save updates node_modules but not any package.json", async () => {
  using ctx = await testContext();
  const written = await setupWorkspaces(ctx, {}, { "pkg-a": { dependencies: { baz: "~0.0.3" } } }, BAZ_0_0_3_ONLY);
  expect(await installedBazVersion(ctx)).toBe("0.0.3");
  const lockBefore = await lockText(ctx);
  serve(ctx, BAZ_0_0_3_AND_0_0_5);
  expect((await runUpdate(ctx, ["--recursive", "--no-save"])).err).toBe("");
  await expectWorkspaces(ctx, written);
  expect(await lockText(ctx)).toBe(lockBefore);
  expect(await installedBazVersion(ctx)).toBe("0.0.5");
});

it.concurrent("--recursive keeps a member's dist-tag literal and only moves bun.lock", async () => {
  using ctx = await testContext();
  const written = await setupWorkspaces(ctx, {}, { "pkg-a": { dependencies: { baz: "latest" } } }, BAZ_0_0_3_ONLY);
  expect(await installedBazVersion(ctx)).toBe("0.0.3");
  serve(ctx, BAZ_0_0_3_AND_0_0_5);
  const { out, err } = await runUpdate(ctx, ["--recursive"]);
  expect(err).toBe("Saved lockfile\n");
  expect(out).toMatchInlineSnapshot(`
    "bun update <version> (<revision>)

    1 package installed"
  `);
  await expectWorkspaces(ctx, written);
  expect(await installedBazVersion(ctx)).toBe("0.0.5");
});

it.concurrent("--recursive --latest replaces a member's dist-tag literal with the resolved version", async () => {
  using ctx = await testContext();
  const written = await setupWorkspaces(ctx, {}, { "pkg-a": { dependencies: { baz: "latest" } } }, BAZ_0_0_3_ONLY);
  expect(await installedBazVersion(ctx)).toBe("0.0.3");
  serve(ctx, BAZ_0_0_3_AND_0_0_5);
  const { out, err } = await runUpdate(ctx, ["--recursive", "--latest"]);
  expect(err).toBe("Saved lockfile\n");
  expect(out).toMatchInlineSnapshot(`
    "bun update <version> (<revision>)

    ^ baz 0.0.3 -> 0.0.5

    1 package installed"
  `);
  await expectWorkspaces(ctx, { ...written, "packages/pkg-a": { name: "pkg-a", dependencies: { baz: "^0.0.5" } } });
  expect(await installedBazVersion(ctx)).toBe("0.0.5");
});

// https://github.com/oven-sh/bun/issues/23507
it.concurrent("--recursive is idempotent: a second run changes nothing", async () => {
  using ctx = await testContext();
  const member = { dependencies: { baz: "~0.0.3" } };
  const written = await setupWorkspaces(ctx, member, { "pkg-a": member });
  expect((await runUpdate(ctx, ["--recursive"])).err).toBe("Saved lockfile\n");
  const moved = {
    "": { ...written[""], dependencies: { baz: "~0.0.5" } },
    "packages/pkg-a": { name: "pkg-a", dependencies: { baz: "~0.0.5" } },
  };
  await expectWorkspaces(ctx, moved);
  const lockAfter = await lockText(ctx);
  expect((await runUpdate(ctx, ["--recursive"])).err).toBe("");
  await expectWorkspaces(ctx, moved);
  expect(await lockText(ctx)).toBe(lockAfter);
});

it.concurrent("--filter matching nothing is an error that writes no package.json", async () => {
  using ctx = await testContext();
  const member = { dependencies: { baz: "~0.0.3" } };
  const written = await setupWorkspaces(ctx, member, { "pkg-a": member });
  const lockBefore = await lockText(ctx);
  const { err, exitCode } = await run(ctx, ["update", "--filter", "does-not-exist"]);
  expect(err).toBe('error: No workspace packages matched the filter "does-not-exist"\n');
  expect(exitCode).toBe(1);
  await expectWorkspaces(ctx, written);
  expect(await lockText(ctx)).toBe(lockBefore);
});

it.concurrent("--recursive tolerates a member with no dependency groups", async () => {
  using ctx = await testContext();
  const member = { dependencies: { baz: "~0.0.3" } };
  const written = await setupWorkspaces(ctx, member, { empty: { version: "1.0.0" }, "pkg-a": member });
  await runUpdate(ctx, ["--recursive"]);
  await expectWorkspaces(ctx, {
    ...written,
    "": { ...written[""], dependencies: { baz: "~0.0.5" } },
    "packages/pkg-a": { name: "pkg-a", dependencies: { baz: "~0.0.5" } },
  });
});

// https://github.com/oven-sh/bun/issues/23507
// Matches the existing single-workspace behavior: only one group's entry is rewritten.
it.concurrent("--recursive updates only one group when a member lists the same dep in two groups", async () => {
  using ctx = await testContext();
  const written = await setupWorkspaces(
    ctx,
    {},
    { "pkg-a": { dependencies: { baz: "~0.0.3" }, devDependencies: { baz: "~0.0.3" } } },
  );
  await runUpdate(ctx, ["--recursive"]);
  const a = await packageJsonOf(ctx, "packages/pkg-a");
  expect([a.dependencies.baz, a.devDependencies.baz].sort()).toEqual(["~0.0.3", "~0.0.5"]);
  await expectWorkspaces(ctx, { ...written, "packages/pkg-a": a });
});

// https://github.com/oven-sh/bun/issues/23507
it.concurrent("--recursive with multiple workspace globs fans out to every matched directory", async () => {
  using ctx = await testContext();
  const member = { dependencies: { baz: "~0.0.3" } };
  const written = await setupWorkspaces(
    ctx,
    { workspaces: ["apps/*", "packages/*"] },
    { "apps/app-a": member, "packages/pkg-a": member },
  );
  await runUpdate(ctx, ["--recursive"]);
  await expectWorkspaces(ctx, {
    ...written,
    "apps/app-a": { name: "app-a", dependencies: { baz: "~0.0.5" } },
    "packages/pkg-a": { name: "pkg-a", dependencies: { baz: "~0.0.5" } },
  });
});

// https://github.com/oven-sh/bun/issues/23507
it.concurrent("bun outdated -r is empty after bun update -r --latest", async () => {
  using ctx = await testContext();
  const written = await setupWorkspaces(
    ctx,
    { dependencies: { baz: "~0.0.3" } },
    {
      "pkg-a": { dependencies: { baz: "~0.0.3" } },
      "pkg-b": { devDependencies: { baz: "0.0.3" } },
    },
  );
  await runUpdate(ctx, ["--recursive", "--latest"]);
  await expectWorkspaces(ctx, {
    "": { ...written[""], dependencies: { baz: "~0.0.5" } },
    "packages/pkg-a": { name: "pkg-a", dependencies: { baz: "~0.0.5" } },
    "packages/pkg-b": { name: "pkg-b", devDependencies: { baz: "0.0.5" } },
  });
  const { out, err, exitCode } = await run(ctx, ["outdated", "--recursive"]);
  expect(err).toBe("");
  expect(out).toMatchInlineSnapshot(`"bun outdated <version> (<revision>)"`);
  expect(exitCode).toBe(0);
});

it.concurrent("should print UTF-8 arrows correctly with colors enabled", async () => {
  using ctx = await testContext();
  const registry = { "0.0.3": {}, "0.0.5": {}, latest: "0.0.3" };
  serve(ctx, registry);
  await writeFile(
    join(ctx.package_dir, "package.json"),
    JSON.stringify({ name: "foo", dependencies: { baz: "0.0.3" } }),
  );
  await runInstall(ctx);

  registry.latest = "0.0.5";
  serve(ctx, registry);
  await using proc = spawn({
    cmd: [bunExe(), "update", "--latest"],
    cwd: ctx.package_dir,
    env: { ...env, FORCE_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(err).toContain("Saved lockfile");
  // double-encoded UTF-8 (each byte of the arrow re-encoded as Latin-1)
  expect(out).not.toContain("â");
  expect(out.replace(/\x1b\[[\d;]*m/g, "")).toContain("↑ baz 0.0.3 → 0.0.5");
  expect(exitCode).toBe(0);
  expect(await packageJsonOf(ctx)).toEqual({ name: "foo", dependencies: { baz: "0.0.5" } });
});

type PerNameManifests = Record<
  string,
  { versions: Record<string, { dependencies?: Record<string, string> }>; latest: string }
>;

// Unlike `dummyRegistry`, this serves a distinct manifest per package name, from tarballs built in-process for every
// version in `published`. It returns a function that serves another view of those packages (a moved dist-tag, a
// version not published yet) under the same tarballs.
async function perNameRegistry(ctx: TestContext, published: PerNameManifests) {
  const tarballs = new Map<string, Blob>();
  for (const [name, { versions }] of Object.entries(published)) {
    for (const [version, extra] of Object.entries(versions)) {
      const archive = new Bun.Archive(
        { "package/package.json": JSON.stringify({ name, version, ...extra }) },
        { compress: "gzip" },
      );
      tarballs.set(`${name}-${version}.tgz`, await archive.blob());
    }
  }
  const serveManifests = (manifests: PerNameManifests) =>
    setContextHandler(ctx, request => {
      const name = request.url.slice(ctx.registry_url.length);
      const tarball = tarballs.get(name);
      if (tarball) return new Response(tarball);
      const entry = manifests[name];
      if (!entry) return new Response("not found", { status: 404 });
      const versions: Record<string, object> = {};
      for (const [version, extra] of Object.entries(entry.versions)) {
        versions[version] = { name, version, dist: { tarball: `${ctx.registry_url}${name}-${version}.tgz` }, ...extra };
      }
      return Response.json({ name, versions, "dist-tags": { latest: entry.latest } });
    });
  await useTextLockfile(ctx);
  serveManifests(published);
  return serveManifests;
}

// The set of `shared@<version>` resolutions in the text lockfile.
async function lockedSharedResolutions(ctx: TestContext) {
  return [...new Set((await lockText(ctx)).match(/"shared@[\d.]+"/g))].sort();
}

// The package.json of the `shared` installed under `parent` (the root by default).
const installedShared = (ctx: TestContext, parent = ""): Promise<Json> =>
  file(join(ctx.package_dir, parent, "node_modules", "shared", "package.json")).json();

// A named update only re-resolves the rows of the workspace it runs in; another workspace's own entry is left alone.
it.concurrent(
  "bun update <name> from the root leaves a member's own entry alone; running it inside the member moves it",
  async () => {
    using ctx = await testContext();
    await perNameRegistry(ctx, { shared: { versions: { "1.0.0": {}, "1.1.0": {}, "2.0.0": {} }, latest: "2.0.0" } });
    await writeFile(
      join(ctx.package_dir, "package.json"),
      JSON.stringify({ name: "root", workspaces: ["packages/*"], dependencies: { shared: "^2.0.0" } }),
    );
    const pkgOneJson = join(ctx.package_dir, "packages", "pkg-one", "package.json");
    await mkdir(join(ctx.package_dir, "packages", "pkg-one"), { recursive: true });
    await writeFile(
      pkgOneJson,
      JSON.stringify({ name: "pkg-one", version: "1.0.0", dependencies: { shared: "1.0.0" } }),
    );
    await runInstall(ctx);

    // Widening the range keeps the stale 1.0.0 on a plain install, since it still satisfies the new range.
    await writeFile(
      pkgOneJson,
      JSON.stringify({ name: "pkg-one", version: "1.0.0", dependencies: { shared: "^1.0.0" } }),
    );
    await runInstall(ctx);
    expect(await lockedSharedResolutions(ctx)).toEqual(['"shared@1.0.0"', '"shared@2.0.0"']);

    expect((await runUpdate(ctx, ["shared"])).err).toBe("");
    expect(await lockedSharedResolutions(ctx)).toStrictEqual(['"shared@1.0.0"', '"shared@2.0.0"']);
    expect(await installedShared(ctx, "packages/pkg-one")).toMatchObject({ version: "1.0.0" });

    const { out, err } = await runUpdate(ctx, ["shared"], "packages/pkg-one");
    expect(err).toBe("Saved lockfile\n");
    expect(out).toMatchInlineSnapshot(`
      "bun update <version> (<revision>)

      ^ shared 1.0.0 -> 1.1.0 (v2.0.0 available)

      1 package installed"
    `);
    expect(await lockedSharedResolutions(ctx)).toEqual(['"shared@1.1.0"', '"shared@2.0.0"']);
    expect(await installedShared(ctx, "packages/pkg-one")).toMatchObject({ version: "1.1.0" });

    expect((await runUpdate(ctx, ["shared"], "packages/pkg-one")).err).toBe("");
    expect(await lockedSharedResolutions(ctx)).toStrictEqual(['"shared@1.1.0"', '"shared@2.0.0"']);
    expect(await installedShared(ctx, "packages/pkg-one")).toMatchObject({ version: "1.1.0" });
  },
);

// The same invariant one level deeper: a dependency on `<name>` owned by a preserved parent package must also
// re-enter the resolve queue.
it.concurrent("should update transitive resolutions of a named package", async () => {
  using ctx = await testContext();
  await perNameRegistry(ctx, {
    shared: { versions: { "1.0.0": {}, "1.1.0": {} }, latest: "1.1.0" },
    "dep-x": { versions: { "1.0.0": { dependencies: { shared: "^1.0.0" } } }, latest: "1.0.0" },
  });
  // dep-x@1.0.0 depends on shared@^1.0.0, which dedupes onto the root's exact shared@1.0.0 at install time.
  await writeFile(
    join(ctx.package_dir, "package.json"),
    JSON.stringify({ name: "root", dependencies: { shared: "1.0.0", "dep-x": "^1.0.0" } }),
  );
  await runInstall(ctx);
  expect(await lockedSharedResolutions(ctx)).toEqual(['"shared@1.0.0"']);

  // The root's exact `1.0.0` cannot move; dep-x's `^1.0.0` must move to 1.1.0.
  expect((await runUpdate(ctx, ["shared"])).err).toBe("Saved lockfile\n");
  expect(await lockedSharedResolutions(ctx)).toEqual(['"shared@1.0.0"', '"shared@1.1.0"']);
  expect(await installedShared(ctx, "node_modules/dep-x")).toMatchObject({ version: "1.1.0" });
  expect(await installedShared(ctx)).toMatchObject({ version: "1.0.0" });
});

it.concurrent(
  "bun update <name> --latest holds back only the root's entry; a transitive edge declared as a dist-tag keeps following it",
  async () => {
    using ctx = await testContext();
    await perNameRegistry(ctx, {
      shared: { versions: { "1.0.0": {}, "1.1.0": {} }, latest: "1.0.0" },
      "dep-x": { versions: { "1.0.0": { dependencies: { shared: "latest" } } }, latest: "1.0.0" },
    });
    const packageJson = { name: "root", dependencies: { shared: "1.1.0", "dep-x": "1.0.0" } };
    await writeFile(join(ctx.package_dir, "package.json"), JSON.stringify(packageJson));
    await runInstall(ctx);
    expect(await lockedSharedResolutions(ctx)).toStrictEqual(['"shared@1.0.0"', '"shared@1.1.0"']);

    expect((await runUpdate(ctx, ["shared", "--latest"])).err).toBe("");
    expect(await packageJsonOf(ctx)).toStrictEqual(packageJson);
    expect(await lockedSharedResolutions(ctx)).toStrictEqual(['"shared@1.0.0"', '"shared@1.1.0"']);
    expect(await installedShared(ctx, "node_modules/dep-x")).toMatchObject({ version: "1.0.0" });
    expect(await installedShared(ctx)).toMatchObject({ version: "1.1.0" });
  },
);

it.concurrent(
  "bun update <name> on a dist-tag entry follows the tag even when it moved backwards; --latest then writes that version",
  async () => {
    using ctx = await testContext();
    const versions = { "1.0.0": {}, "1.1.0": {} };
    const reserve = await perNameRegistry(ctx, { shared: { versions, latest: "1.1.0" } });
    const packageJson = { name: "root", dependencies: { shared: "latest" } };
    await writeFile(join(ctx.package_dir, "package.json"), JSON.stringify(packageJson));
    await runInstall(ctx);
    expect(await lockedSharedResolutions(ctx)).toStrictEqual(['"shared@1.1.0"']);

    reserve({ shared: { versions, latest: "1.0.0" } });
    const followed = await runUpdate(ctx, ["shared"]);
    expect(followed.err).toBe("Saved lockfile\n");
    expect(followed.out).toMatchInlineSnapshot(`
      "bun update <version> (<revision>)

      ^ shared 1.1.0 -> 1.0.0

      1 package installed"
    `);
    expect(await packageJsonOf(ctx)).toStrictEqual(packageJson);
    expect(await lockedSharedResolutions(ctx)).toStrictEqual(['"shared@1.0.0"']);
    expect(await installedShared(ctx)).toMatchObject({ version: "1.0.0" });

    expect((await runUpdate(ctx, [])).err).toBe("");
    expect(await packageJsonOf(ctx)).toStrictEqual(packageJson);
    expect(await lockedSharedResolutions(ctx)).toStrictEqual(['"shared@1.0.0"']);

    expect((await runUpdate(ctx, ["shared", "--latest"])).err).toBe("Saved lockfile\n");
    expect(await packageJsonOf(ctx)).toStrictEqual({ ...packageJson, dependencies: { shared: "^1.0.0" } });
    expect(await lockedSharedResolutions(ctx)).toStrictEqual(['"shared@1.0.0"']);
    expect(await installedShared(ctx)).toMatchObject({ version: "1.0.0" });
  },
);

// `shared` is only reachable through dep-x; the install below pins 1.0.0 before the registry starts serving 1.1.0.
async function setupTransitiveOnlyShared(ctx: TestContext) {
  const depX = { "dep-x": { versions: { "1.0.0": { dependencies: { shared: "^1.0.0" } } }, latest: "1.0.0" } };
  const published = { ...depX, shared: { versions: { "1.0.0": {}, "1.1.0": {} }, latest: "1.1.0" } };
  const reserve = await perNameRegistry(ctx, published);
  reserve({ ...depX, shared: { versions: { "1.0.0": {} }, latest: "1.0.0" } });
  const packageJson = { name: "root", dependencies: { "dep-x": "^1.0.0" } };
  await writeFile(join(ctx.package_dir, "package.json"), JSON.stringify(packageJson));
  await runInstall(ctx);
  expect(await lockedSharedResolutions(ctx)).toStrictEqual(['"shared@1.0.0"']);
  reserve(published);
  return packageJson;
}

it.concurrent(
  "bun update <name> updates a package that is only a transitive dependency without adding it to package.json",
  async () => {
    using ctx = await testContext();
    const packageJson = await setupTransitiveOnlyShared(ctx);
    const { out, err } = await runUpdate(ctx, ["shared"]);
    expect(err).toBe("Saved lockfile\n");
    expect(out).toMatchInlineSnapshot(`
      "bun update <version> (<revision>)

      ^ shared 1.0.0 -> 1.1.0

      1 package installed"
    `);
    expect(await packageJsonOf(ctx)).toStrictEqual(packageJson);
    expect(await lockedSharedResolutions(ctx)).toStrictEqual(['"shared@1.1.0"']);
    expect(await installedShared(ctx)).toMatchObject({ version: "1.1.0" });
  },
);

it.concurrent("bun update updates transitive dependencies", async () => {
  using ctx = await testContext();
  const packageJson = await setupTransitiveOnlyShared(ctx);
  const { out, err } = await runUpdate(ctx, []);
  expect(err).toBe("Saved lockfile\n");
  expect(out).toMatchInlineSnapshot(`
    "bun update <version> (<revision>)

    ^ shared 1.0.0 -> 1.1.0

    1 package installed"
  `);
  expect(await packageJsonOf(ctx)).toStrictEqual(packageJson);
  expect(await lockedSharedResolutions(ctx)).toStrictEqual(['"shared@1.1.0"']);
  expect(await installedShared(ctx)).toMatchObject({ version: "1.1.0" });
});

it.concurrent("bun update <name> rejects a name that is not in the lockfile", async () => {
  using ctx = await testContext();
  const packageJson = await setupTransitiveOnlyShared(ctx);
  const lockBefore = await lockText(ctx);
  const { out, err, exitCode } = await run(ctx, ["update", "not-a-dep"]);
  expect(err).toBe('error: "not-a-dep" is not in bun.lock\n    bun add not-a-dep\n');
  expect(out).toMatchInlineSnapshot(`"bun update <version> (<revision>)"`);
  expect(exitCode).toBe(1);
  expect(await packageJsonOf(ctx)).toStrictEqual(packageJson);
  expect(await lockText(ctx)).toBe(lockBefore);
});

// Registry: no-deps 1.0.0/1.0.1/1.1.0/2.0.0; a-dep 1.0.1..1.0.10; dep-with-tags latest=3.0.0, pre-2=2.0.1; @types/* 1.0.0/2.0.0.
describe("bun update <name> semantics", () => {
  type Json = Record<string, any>;
  const verdaccio = new VerdaccioRegistry();

  beforeAll(async () => {
    await verdaccio.start();
  });

  afterAll(() => {
    verdaccio.stop();
  });

  const GROUPS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
  // A manifest argument is either a bare dependency map or an object of package.json fields (groups, scripts).
  const isFields = (json: Json) => Object.keys(json).some(key => GROUPS.includes(key) || key === "scripts");
  const manifest = (json: Json): Json =>
    isFields(json) ? { name: "foo", ...json } : { name: "foo", dependencies: json };
  const declared = (json: Json): Record<string, string> =>
    isFields(json) ? Object.assign({}, ...GROUPS.map(group => json[group] ?? {})) : json;
  const stringify = (json: Json) => JSON.stringify(json, null, 2) + "\n";
  const packageJsonOf = (dir: string, rel = ""): Promise<Json> => file(join(dir, rel, "package.json")).json();
  const packageJsonText = (dir: string, rel = "") => file(join(dir, rel, "package.json")).text();
  const lockText = (dir: string) => file(join(dir, "bun.lock")).text();
  const lock = async (dir: string): Promise<Json> => Bun.JSONC.parse(await lockText(dir)) as Json;
  const installedVersion = async (dir: string, name: string): Promise<string> =>
    (await file(join(dir, "node_modules", name, "package.json")).json()).version;

  // CI exports one BUN_INSTALL_CACHE_DIR per test file, which overrides the per-test-dir bunfig cache; concurrent cases racing on one cache fail on Windows.
  const envFor = (dir: string) => ({ ...env, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache") });

  async function run(dir: string, ...args: string[]) {
    return runFrom(dir, dir, ...args);
  }

  async function runFrom(cwd: string, dir: string, ...args: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), ...args],
      cwd,
      env: envFor(dir),
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  async function install(dir: string, ...args: string[]) {
    const { stderr, exitCode } = await run(dir, "install", ...args);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    return stderr;
  }

  async function update(dir: string, ...args: string[]) {
    const result = await run(dir, "update", ...args);
    expect(result.stderr).not.toContain("error:");
    expect(result.exitCode).toBe(0);
    return result;
  }

  async function createDir(files: Record<string, Json | string>) {
    const { packageDir } = await verdaccio.createTestDir({
      bunfigOpts: { saveTextLockfile: true, linker: "hoisted" },
      files: Object.fromEntries(
        Object.entries(files).map(([path, json]) => [path, typeof json === "string" ? json : stringify(json)]),
      ),
    });
    return packageDir;
  }

  async function setup(json: Json) {
    const dir = await createDir({ "package.json": manifest(json) });
    await install(dir);
    return dir;
  }

  // Pin exactly, then widen: the locked versions still satisfy the new ranges, so only `bun update` moves them.
  async function stale(pinned: Json, widened: Json) {
    const dir = await setup(pinned);
    await writeFile(join(dir, "package.json"), stringify(manifest(widened)));
    expect(await install(dir)).toContain("Saved lockfile");
    for (const [name, literal] of Object.entries(declared(pinned))) {
      expect(await installedVersion(dir, name)).toBe(literal.replace(/^npm:[^@]+@/, ""));
    }
    return dir;
  }

  // Every version of `name` resolved anywhere in bun.lock, including behind an alias.
  async function lockedVersions(dir: string, name: string) {
    const { packages } = await lock(dir);
    const versions = Object.values(packages as Record<string, [string]>)
      .map(([resolution]) => resolution)
      .filter(resolution => resolution.startsWith(`${name}@`))
      .map(resolution => resolution.slice(name.length + 1));
    return [...new Set(versions)].sort();
  }

  // `expected` is a dependency map, or an object of groups when several groups are asserted at once.
  async function expectInSync(dir: string, expected: Json) {
    const groups: Json = isFields(expected) ? expected : { dependencies: expected };
    const packageJson = await packageJsonOf(dir);
    const root = (await lock(dir)).workspaces[""];
    for (const group of GROUPS) {
      if (!(group in groups)) continue;
      expect(packageJson[group]).toStrictEqual(groups[group]);
      expect(root[group]).toStrictEqual(groups[group]);
    }
    await install(dir, "--frozen-lockfile");
  }

  async function expectUnchanged(dir: string, before: { packageJson: string; lock: string }) {
    expect(await packageJsonText(dir)).toBe(before.packageJson);
    expect(await lockText(dir)).toBe(before.lock);
  }

  const snapshotFiles = async (dir: string) => ({ packageJson: await packageJsonText(dir), lock: await lockText(dir) });

  const SIBLINGS_PINNED = { "no-deps": "1.0.0", "a-dep": "1.0.1" };
  const SIBLINGS_WIDENED = { "no-deps": "^1.0.0", "a-dep": "^1.0.1" };

  for (const flags of [[], ["--latest"]]) {
    it.concurrent(`bun update ${["a-dep", ...flags].join(" ")} leaves a stale unnamed sibling alone`, async () => {
      const dir = await stale(SIBLINGS_PINNED, SIBLINGS_WIDENED);
      await update(dir, "a-dep", ...flags);
      await expectInSync(dir, { "no-deps": "^1.0.0", "a-dep": "^1.0.10" });
      expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.10"]);
      expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
      expect(await installedVersion(dir, "a-dep")).toBe("1.0.10");
      expect(await installedVersion(dir, "no-deps")).toBe("1.0.0");
    });
  }

  it.concurrent("bun update <name> keeps a dist-tag literal as written", async () => {
    const dir = await setup({ "dep-with-tags": "pre-2" });
    expect(await installedVersion(dir, "dep-with-tags")).toBe("2.0.1");
    await update(dir, "dep-with-tags");
    await expectInSync(dir, { "dep-with-tags": "pre-2" });
    expect(await lockedVersions(dir, "dep-with-tags")).toStrictEqual(["2.0.1"]);
  });

  for (const args of [[], ["dep-with-tags"]]) {
    it.concurrent(
      `bun update ${[...args, "--latest"].join(" ")} replaces a dist-tag literal with the latest version`,
      async () => {
        const dir = await setup({ "dep-with-tags": "pre-2" });
        expect(await installedVersion(dir, "dep-with-tags")).toBe("2.0.1");
        await update(dir, ...args, "--latest");
        await expectInSync(dir, { "dep-with-tags": "^3.0.0" });
        expect(await lockedVersions(dir, "dep-with-tags")).toStrictEqual(["3.0.0"]);
        expect(await installedVersion(dir, "dep-with-tags")).toBe("3.0.0");
      },
    );
  }

  it.concurrent("bun update --latest rewrites a dist-tag literal next to a range", async () => {
    const dir = await setup({ "dep-with-tags": "pre-2", "no-deps": "~1.0.0" });
    const { stdout } = await update(dir, "--latest");
    await expectInSync(dir, { "dep-with-tags": "^3.0.0", "no-deps": "~2.0.0" });
    expect(await lockedVersions(dir, "dep-with-tags")).toStrictEqual(["3.0.0"]);
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["2.0.0"]);
    expect(stdout).toContain("no-deps");
    expect(stdout).toContain("dep-with-tags");
  });

  it.concurrent("bun update --latest replaces an aliased dist-tag behind its alias", async () => {
    const dir = await setup({ tagged: "npm:dep-with-tags@pre-2" });
    expect(await installedVersion(dir, "tagged")).toBe("2.0.1");
    await update(dir, "--latest");
    await expectInSync(dir, { tagged: "npm:dep-with-tags@^3.0.0" });
    expect(await lockedVersions(dir, "dep-with-tags")).toStrictEqual(["3.0.0"]);
    expect(await installedVersion(dir, "tagged")).toBe("3.0.0");
  });

  it.concurrent("bun update --latest replaces `latest` literals even when the tag has not moved", async () => {
    const dir = await setup({ "no-deps": "latest", aliased: "npm:a-dep@latest" });
    const { stdout } = await update(dir, "--latest");
    expect(stdout).not.toContain("->");
    expect(stdout).not.toContain("→");
    await expectInSync(dir, { "no-deps": "^2.0.0", aliased: "npm:a-dep@^1.0.10" });
    expect(await installedVersion(dir, "no-deps")).toBe("2.0.0");
    expect(await installedVersion(dir, "aliased")).toBe("1.0.10");
  });

  it.concurrent("bun update keeps `latest` literals and an aliased dist-tag as written", async () => {
    const dir = await setup({ "no-deps": "latest", tagged: "npm:dep-with-tags@pre-2" });
    const before = await snapshotFiles(dir);
    await update(dir);
    await expectUnchanged(dir, before);
    await expectInSync(dir, { "no-deps": "latest", tagged: "npm:dep-with-tags@pre-2" });
    expect(await installedVersion(dir, "no-deps")).toBe("2.0.0");
    expect(await installedVersion(dir, "tagged")).toBe("2.0.1");
  });

  it.concurrent.each<[string, string, string[]]>([
    ["*", "2.0.0", []],
    ["1", "1.1.0", []],
    ["1.x", "1.1.0", []],
    ["~1", "1.1.0", []],
    [">=1.0.0 <2", "1.1.0", []],
    ["1.0.0 - 1.0.1", "1.0.1", []],
    ["^1.0.0 || ^2.0.0", "2.0.0", []],
    ["npm:no-deps@1.x", "1.1.0", []],
    ["*", "2.0.0", ["no-deps"]],
  ])(
    "a plain update keeps the range %p as written and only moves bun.lock to %p (extra args: %p)",
    async (literal, version, names) => {
      const pin = literal.startsWith("npm:") ? "npm:no-deps@1.0.0" : "1.0.0";
      const dir = await stale({ "no-deps": pin }, { "no-deps": literal });
      await update(dir, ...names);
      await expectInSync(dir, { "no-deps": literal });
      expect(await lockedVersions(dir, "no-deps")).toStrictEqual([version]);
      expect(await installedVersion(dir, "no-deps")).toBe(version);
    },
  );

  it.concurrent("--latest still rewrites a non-caret range", async () => {
    const dir = await setup({ "no-deps": "1.x" });
    await update(dir, "--latest");
    await expectInSync(dir, { "no-deps": "^2.0.0" });
    expect(await installedVersion(dir, "no-deps")).toBe("2.0.0");
  });

  it.concurrent("bun update <name>@<range> on a non-caret entry writes the caret form", async () => {
    const dir = await setup({ "no-deps": "*" });
    await update(dir, "no-deps@1");
    await expectInSync(dir, { "no-deps": "^1.1.0" });
    expect(await installedVersion(dir, "no-deps")).toBe("1.1.0");
  });

  it.concurrent("bun update <real name> reaches a dependency declared behind an npm: alias", async () => {
    const dir = await stale({ aliased: "npm:no-deps@1.0.0" }, { aliased: "npm:no-deps@~1.0.0" });
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
    await update(dir, "no-deps");
    await expectInSync(dir, { aliased: "npm:no-deps@~1.0.1" });
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.1"]);
    expect(await installedVersion(dir, "aliased")).toBe("1.0.1");
  });

  it.concurrent(
    "bun update <real name> moves the plain entry and the aliased entry, each within its own range",
    async () => {
      const dir = await stale(
        { "no-deps": "1.0.0", aliased: "npm:no-deps@1.0.0" },
        { "no-deps": "^1.0.0", aliased: "npm:no-deps@~1.0.0" },
      );
      await update(dir, "no-deps");
      await expectInSync(dir, { "no-deps": "^1.1.0", aliased: "npm:no-deps@~1.0.1" });
      expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.1", "1.1.0"]);
      expect(await installedVersion(dir, "no-deps")).toBe("1.1.0");
      expect(await installedVersion(dir, "aliased")).toBe("1.0.1");
    },
  );

  it.concurrent("bun update <real name> --latest moves an aliased entry to latest in its pin style", async () => {
    const dir = await setup({ aliased: "npm:no-deps@~1.0.0" });
    expect(await installedVersion(dir, "aliased")).toBe("1.0.1");
    await update(dir, "no-deps", "--latest");
    await expectInSync(dir, { aliased: "npm:no-deps@~2.0.0" });
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["2.0.0"]);
    expect(await installedVersion(dir, "aliased")).toBe("2.0.0");
  });

  for (const flag of ["--latest", "-L"]) {
    it.concurrent(`bun update <name>@<version> ${flag} is an error and writes nothing`, async () => {
      const dir = await setup({ "no-deps": "~1.0.0" });
      const before = await snapshotFiles(dir);
      const { stderr, exitCode } = await run(dir, "update", "no-deps@1", flag);
      expect(stderr).toContain("error: --latest cannot be combined with a version");
      expect(stderr).not.toContain("Saved lockfile");
      await expectUnchanged(dir, before);
      expect(await installedVersion(dir, "no-deps")).toBe("1.0.1");
      expect(exitCode).not.toBe(0);
    });
  }

  it.concurrent("bun update <name> --dry-run writes nothing", async () => {
    const dir = await stale({ "no-deps": "1.0.0" }, { "no-deps": "^1.0.0" });
    const before = await snapshotFiles(dir);
    const { stderr } = await update(dir, "no-deps", "--dry-run");
    expect(stderr).not.toContain("Saved lockfile");
    await expectUnchanged(dir, before);
    expect(await installedVersion(dir, "no-deps")).toBe("1.0.0");
  });

  it.concurrent("bun update leaves an =x.y.z pin untouched", async () => {
    const dir = await setup({ "no-deps": "=1.0.0" });
    const before = await snapshotFiles(dir);
    await update(dir);
    await expectUnchanged(dir, before);
    await expectInSync(dir, { "no-deps": "=1.0.0" });
    expect(await installedVersion(dir, "no-deps")).toBe("1.0.0");
  });

  // `~1` stays in the preserved table above: `~1.x.y` would lower its ceiling, while these keep theirs.
  it.concurrent.each([
    ["^1", "^1.1.0", "1.1.0"],
    ["^1.0", "^1.1.0", "1.1.0"],
    ["~1.0", "~1.0.1", "1.0.1"],
  ])("a plain update rewrites the short range %p to %p", async (literal, rewritten, version) => {
    const dir = await stale({ "no-deps": "1.0.0" }, { "no-deps": literal });
    await update(dir);
    await expectInSync(dir, { "no-deps": rewritten });
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual([version]);
    expect(await installedVersion(dir, "no-deps")).toBe(version);
  });

  it.concurrent.each([
    ["1", "1.1.0", "^2.0.0"],
    ["1.0", "1.0.1", "~2.0.0"],
    ["=1.0.0", "1.0.0", "=2.0.0"],
  ])("--latest rewrites %p (locked at %p) to %p, keeping its width", async (literal, locked, rewritten) => {
    const dir = await setup({ "no-deps": literal });
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual([locked]);
    await update(dir, "--latest");
    await expectInSync(dir, { "no-deps": rewritten });
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["2.0.0"]);
    expect(await installedVersion(dir, "no-deps")).toBe("2.0.0");
  });

  // prereleases-2: 0.5.0 (latest) and 1.0.0-next.0..23; prereleases-3: 5.0.0-alpha.150..153.
  it.concurrent("a plain update moves a caret range on a prerelease and leaves an exact prerelease alone", async () => {
    const dir = await stale(
      { "prereleases-2": "1.0.0-next.0", "prereleases-3": "5.0.0-alpha.150" },
      { "prereleases-2": "^1.0.0-next.0", "prereleases-3": "5.0.0-alpha.150" },
    );
    await update(dir);
    await expectInSync(dir, { "prereleases-2": "^1.0.0-next.23", "prereleases-3": "5.0.0-alpha.150" });
    expect(await lockedVersions(dir, "prereleases-2")).toStrictEqual(["1.0.0-next.23"]);
    expect(await lockedVersions(dir, "prereleases-3")).toStrictEqual(["5.0.0-alpha.150"]);
    expect(await installedVersion(dir, "prereleases-2")).toBe("1.0.0-next.23");
    expect(await installedVersion(dir, "prereleases-3")).toBe("5.0.0-alpha.150");
  });

  it.concurrent.each([
    ["dep-with-tags@pre-2", { "dep-with-tags": "pre-2", "no-deps": "^1.0.0" }, ["2.0.1"], ["1.0.0"]],
    ["no-deps@latest", { "dep-with-tags": "^1.0.0", "no-deps": "latest" }, ["1.0.1"], ["2.0.0"]],
  ])(
    "bun update %p writes the dist-tag literal to package.json and bun.lock follows the tag",
    async (request, expected, depWithTags, noDeps) => {
      const dir = await stale(
        { "dep-with-tags": "1.0.1", "no-deps": "1.0.0" },
        { "dep-with-tags": "^1.0.0", "no-deps": "^1.0.0" },
      );
      await update(dir, request);
      await expectInSync(dir, expected);
      expect(await lockedVersions(dir, "dep-with-tags")).toStrictEqual(depWithTags);
      expect(await lockedVersions(dir, "no-deps")).toStrictEqual(noDeps);
      expect(await installedVersion(dir, "dep-with-tags")).toBe(depWithTags[0]);
      expect(await installedVersion(dir, "no-deps")).toBe(noDeps[0]);
    },
  );

  it.concurrent(
    "install.exact + --latest writes exact versions behind an alias and in place of a dist-tag",
    async () => {
      const dir = await setup({ tagged: "npm:dep-with-tags@pre-2", "no-deps": "latest", "a-dep": "^1.0.1" });
      expect(await installedVersion(dir, "tagged")).toBe("2.0.1");
      await appendFile(join(dir, "bunfig.toml"), "exact = true\n");
      await update(dir, "--latest");
      await expectInSync(dir, { tagged: "npm:dep-with-tags@3.0.0", "no-deps": "2.0.0", "a-dep": "1.0.10" });
      expect(await lockedVersions(dir, "dep-with-tags")).toStrictEqual(["3.0.0"]);
      expect(await installedVersion(dir, "tagged")).toBe("3.0.0");
      expect(await installedVersion(dir, "no-deps")).toBe("2.0.0");
    },
  );

  it.concurrent("--exact on the command line writes exact versions like install.exact does", async () => {
    const dir = await setup({ "no-deps": "^1.0.0", tagged: "npm:dep-with-tags@pre-2" });
    await update(dir, "--latest", "--exact");
    await expectInSync(dir, { "no-deps": "2.0.0", tagged: "npm:dep-with-tags@3.0.0" });
    expect(await installedVersion(dir, "no-deps")).toBe("2.0.0");
  });

  it.concurrent("-L is an alias of --latest, bare and named", async () => {
    const bare = await setup({ "no-deps": "~1.0.0", "a-dep": "~1.0.1" });
    await update(bare, "-L");
    await expectInSync(bare, { "no-deps": "~2.0.0", "a-dep": "~1.0.10" });

    const named = await setup({ "no-deps": "~1.0.0", "a-dep": "~1.0.1" });
    await update(named, "no-deps", "-L");
    await expectInSync(named, { "no-deps": "~2.0.0", "a-dep": "~1.0.1" });

    const { stdout, exitCode } = await run(named, "update", "--help");
    expect(stdout).toContain("-L, --latest");
    expect(stdout).toContain("-d, --dev");
    expect(exitCode).toBe(0);
  });

  it.concurrent("bun up is an alias of bun update", async () => {
    const dir = await stale({ "no-deps": "1.0.0" }, { "no-deps": "^1.0.0" });
    const up = await run(dir, "up");
    expect(up.stderr).not.toContain("error:");
    expect(up.exitCode).toBe(0);
    await expectInSync(dir, { "no-deps": "^1.1.0" });

    const upLatest = await run(dir, "up", "no-deps", "-L");
    expect(upLatest.stderr).not.toContain("error:");
    expect(upLatest.exitCode).toBe(0);
    await expectInSync(dir, { "no-deps": "^2.0.0" });

    const help = await run(dir, "up", "--help");
    expect(help.stdout).toContain("bun update");
    expect(help.exitCode).toBe(0);
  });

  it.concurrent("bun up wins over a package.json script named up; bun run up still runs the script", async () => {
    const scripts = { up: "echo SCRIPT_RAN" };
    const dir = await stale(
      { dependencies: { "no-deps": "1.0.0" }, scripts },
      { dependencies: { "no-deps": "^1.0.0" }, scripts },
    );
    const up = await run(dir, "up");
    expect(up.stdout).not.toContain("SCRIPT_RAN");
    expect(up.exitCode).toBe(0);
    await expectInSync(dir, { "no-deps": "^1.1.0" });

    const script = await run(dir, "run", "up");
    expect(script.stdout).toContain("SCRIPT_RAN");
    expect(script.exitCode).toBe(0);
  });

  // The entries are declared out of alphabetical order, so a rewrite of the file would show up as a re-sort.
  it.concurrent.each([[["no-deps"]], [["one-range-dep"]], [["no-deps", "one-range-dep"]]])(
    "bun update %p that changes nothing leaves package.json and bun.lock byte-identical",
    async names => {
      const dir = await setup({ "one-range-dep": "1.0.0", "no-deps": "^1.1.0" });
      expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
      const before = await snapshotFiles(dir);
      expect(Object.keys(JSON.parse(before.packageJson).dependencies)).toStrictEqual(["one-range-dep", "no-deps"]);
      const { stdout } = await update(dir, ...names);
      expect(stdout).not.toContain("->");
      expect(stdout).not.toContain("→");
      await expectUnchanged(dir, before);
      expect(await installedVersion(dir, "no-deps")).toBe("1.1.0");
    },
  );

  // one-range-dep and one-range-dep-too both depend on no-deps ^1.0.0; the root's exact pin parks their edges on 1.0.0, and dropping it leaves them there.
  describe("scope of an update run from a workspace member", () => {
    const ROOT = { name: "root", workspaces: ["packages/*"] };
    const PINNED_ROOT = { ...ROOT, dependencies: { "no-deps": "1.0.0" } };
    const member = (name: string, dependencies: Json = {}) => ({ name, version: "1.0.0", dependencies });
    const DEPENDENTS = ["one-range-dep", "one-range-dep-too"] as const;
    const FILES = ["", "packages/a", "packages/b"] as const;

    // `widenedA` replaces a's dependencies once its pins are locked, so a's own direct dependencies can be stale as well.
    async function staleRepo(a: Json, b: Json, widenedA?: Json) {
      const dir = await createDir({
        "package.json": PINNED_ROOT,
        "packages/a/package.json": member("a", a),
        "packages/b/package.json": member("b", b),
      });
      await install(dir);
      await writeFile(join(dir, "package.json"), stringify(ROOT));
      if (widenedA) await writeFile(join(dir, "packages", "a", "package.json"), stringify(member("a", widenedA)));
      expect(await install(dir)).toContain("Saved lockfile");
      expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
      const texts = () => Promise.all(FILES.map(rel => packageJsonText(dir, rel)));
      return { dir, texts, packageJsons: await texts(), lockBefore: await lockText(dir) };
    }

    // The no-deps version each dependent's edge resolves to: its nested row when it lost the hoisting race, else the hoisted one.
    async function noDepsEdges(dir: string) {
      const { packages } = await lock(dir);
      const versionOf = (key: string) => (packages[key] as [string] | undefined)?.[0].slice("no-deps@".length);
      return Object.fromEntries(
        DEPENDENTS.filter(dependent => dependent in packages).map(dependent => [
          dependent,
          versionOf(`${dependent}/no-deps`) ?? versionOf("no-deps"),
        ]),
      );
    }

    const distinctTransitives = () => staleRepo({ "one-range-dep": "1.0.0" }, { "one-range-dep-too": "1.0.0" });

    // Once a's edge moves, b's edge accepts the new version too and is re-pointed so bun.lock keeps one copy; only a package a cannot reach at all stays put (below).
    it.concurrent.each([
      ["from packages/a", "packages/a", []],
      ["with --filter a", "", ["--filter", "a"]],
      ["from the root", "", []],
      ["with -r", "", ["-r"]],
      ["with --filter '*'", "", ["--filter", "*"]],
    ])("bun update no-deps %s re-points every edge that accepts the new version", async (_, cwd, flags) => {
      const { dir, texts, packageJsons } = await distinctTransitives();
      const { stderr, exitCode } = await runFrom(join(dir, cwd), dir, "update", "no-deps", ...flags);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
      expect(await noDepsEdges(dir)).toStrictEqual({ "one-range-dep": "1.1.0", "one-range-dep-too": "1.1.0" });
      expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
      expect(await texts()).toStrictEqual(packageJsons);
      await install(dir, "--frozen-lockfile");
    });

    // a -> a-dep (stale at 1.0.1, no path to no-deps); b -> one-range-dep -> no-deps (stale at 1.0.0).
    async function unreachableFromA() {
      const repo = await staleRepo({ "a-dep": "1.0.1" }, { "one-range-dep": "1.0.0" }, { "a-dep": "^1.0.1" });
      expect(await lockedVersions(repo.dir, "a-dep")).toStrictEqual(["1.0.1"]);
      return repo;
    }

    it.concurrent.each([
      [
        "from packages/a",
        "packages/a",
        ["no-deps"],
        'error: "no-deps" is not a dependency of this workspace\n    bun update -r no-deps\n    bun update --filter b no-deps\n',
      ],
      [
        "with --filter a",
        "",
        ["no-deps", "--filter", "a"],
        'error: "no-deps" is not a dependency of the selected workspaces\n    bun update -r no-deps\n    bun update --filter b no-deps\n',
      ],
      ["as a pattern from packages/a", "packages/a", ["no-*"], 'error: no packages in bun.lock match "no-*"\n'],
    ])(
      "bun update naming a package the workspace has no path to (%s) is an error that writes nothing",
      async (_, cwd, args, expected) => {
        const { dir, texts, packageJsons, lockBefore } = await unreachableFromA();
        const { stderr, exitCode } = await runFrom(join(dir, cwd), dir, "update", ...args);
        expect(stderr).toBe(expected);
        expect(await lockText(dir)).toBe(lockBefore);
        expect(await texts()).toStrictEqual(packageJsons);
        expect(exitCode).toBe(1);
      },
    );

    it.concurrent.each([
      ["from packages/b", "packages/b", []],
      ["from the root", "", []],
      ["with --filter b", "", ["--filter", "b"]],
    ])(
      "bun update no-deps %s moves the transitive row b reaches and leaves stale a-dep alone",
      async (_, cwd, flags) => {
        const { dir, texts, packageJsons } = await unreachableFromA();
        const { stderr, exitCode } = await runFrom(join(dir, cwd), dir, "update", "no-deps", ...flags);
        expect(stderr).not.toContain("error:");
        expect(exitCode).toBe(0);
        expect(await noDepsEdges(dir)).toStrictEqual({ "one-range-dep": "1.1.0" });
        expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.1"]);
        expect(await texts()).toStrictEqual(packageJsons);
        await install(dir, "--frozen-lockfile");
      },
    );

    // a-dep is a's own entry, so it moves only when a is selected; no-deps is a nested row, so it moves when b (or the root, which reaches every nested row) is selected.
    it.concurrent.each([
      ["from packages/a", "packages/a", [], "1.0.10", "1.0.0"],
      ["with --filter a", "", ["--filter", "a"], "1.0.10", "1.0.0"],
      ["from packages/b", "packages/b", [], "1.0.1", "1.1.0"],
      ["from the root", "", [], "1.0.1", "1.1.0"],
      ["with -r", "", ["-r"], "1.0.10", "1.1.0"],
    ])("a bare update %s moves a-dep to %s and no-deps to %s", async (_, cwd, flags, aDep, noDeps) => {
      const { dir, texts, packageJsons } = await unreachableFromA();
      const [rootBefore, aBefore, bBefore] = packageJsons;
      const { stderr, exitCode } = await runFrom(join(dir, cwd), dir, "update", ...flags);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
      expect(await lockedVersions(dir, "a-dep")).toStrictEqual([aDep]);
      expect(await noDepsEdges(dir)).toStrictEqual({ "one-range-dep": noDeps });
      expect(await lockedVersions(dir, "no-deps")).toStrictEqual([noDeps]);
      const aDeps = { "a-dep": `^${aDep}` };
      expect((await packageJsonOf(dir, "packages/a")).dependencies).toStrictEqual(aDeps);
      expect((await lock(dir)).workspaces["packages/a"].dependencies).toStrictEqual(aDeps);
      const [rootAfter, aAfter, bAfter] = await texts();
      expect([rootAfter, bAfter, aAfter === aBefore]).toStrictEqual([rootBefore, bBefore, aDep === "1.0.1"]);
      await install(dir, "--frozen-lockfile");
    });
  });

  describe("patterns", () => {
    const TRIO_PINNED = { "no-deps": "1.0.0", "a-dep": "1.0.1", "dep-with-tags": "1.0.0" };
    const TRIO_WIDENED = { "no-deps": "^1.0.0", "a-dep": "^1.0.1", "dep-with-tags": "^1.0.0" };

    it.concurrent("bun update '@types/*' --latest updates the matching packages and nothing else", async () => {
      const dir = await stale(
        { "@types/no-deps": "1.0.0", "@types/is-number": "1.0.0", "no-deps": "1.0.0" },
        { "@types/no-deps": "^1.0.0", "@types/is-number": "^1.0.0", "no-deps": "^1.0.0" },
      );
      await update(dir, "@types/*", "--latest");
      await expectInSync(dir, { "@types/no-deps": "^2.0.0", "@types/is-number": "^2.0.0", "no-deps": "^1.0.0" });
      expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
      expect(await installedVersion(dir, "@types/no-deps")).toBe("2.0.0");
      expect(await installedVersion(dir, "@types/is-number")).toBe("2.0.0");
    });

    it.concurrent("a name and a pattern that only matches that name update it once", async () => {
      const dir = await stale({ "@types/no-deps": "1.0.0" }, { "@types/no-deps": "^1.0.0" });
      const { stdout } = await update(dir, "@types/no-deps", "@types/*", "--latest");
      expect(stdout.match(/^.*@types\/no-deps.*$/gm)).toStrictEqual(["^ @types/no-deps 1.0.0 -> 2.0.0"]);
      await expectInSync(dir, { "@types/no-deps": "^2.0.0" });
      expect(await lockedVersions(dir, "@types/no-deps")).toStrictEqual(["2.0.0"]);
      expect(await installedVersion(dir, "@types/no-deps")).toBe("2.0.0");
    });

    it.concurrent("two patterns update the union within their ranges", async () => {
      const dir = await stale(TRIO_PINNED, TRIO_WIDENED);
      await update(dir, "a-*", "dep-*");
      await expectInSync(dir, { "no-deps": "^1.0.0", "a-dep": "^1.0.10", "dep-with-tags": "^1.0.1" });
      expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
      expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.10"]);
      expect(await lockedVersions(dir, "dep-with-tags")).toStrictEqual(["1.0.1"]);
    });

    it.concurrent("--dry-run with a pattern writes nothing", async () => {
      const dir = await stale(TRIO_PINNED, TRIO_WIDENED);
      const before = await snapshotFiles(dir);
      const { stderr } = await update(dir, "a-*", "--dry-run");
      expect(stderr).not.toContain("Saved lockfile");
      await expectUnchanged(dir, before);
      expect(await installedVersion(dir, "a-dep")).toBe("1.0.1");
    });

    it.concurrent.each([
      [[], { "no-deps": "^1.0.0", "a-dep": "^1.0.10", "dep-with-tags": "^1.0.1" }],
      [["--latest"], { "no-deps": "^1.0.0", "a-dep": "^1.0.10", "dep-with-tags": "^3.0.0" }],
    ])("a negation pattern updates everything except the match (flags: %p)", async (flags, expected) => {
      const dir = await stale(TRIO_PINNED, TRIO_WIDENED);
      await update(dir, "!no-deps", ...flags);
      await expectInSync(dir, expected);
      expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
    });

    it.concurrent("a positive pattern minus a negation updates the matched set minus the exclusion", async () => {
      const dir = await stale(TRIO_PINNED, TRIO_WIDENED);
      await update(dir, "*-*", "!a-dep");
      await expectInSync(dir, { "no-deps": "^1.1.0", "a-dep": "^1.0.1", "dep-with-tags": "^1.0.1" });
      expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.1"]);
    });

    it.concurrent.each([
      ["zzz-*", 'error: no packages in bun.lock match "zzz-*"'],
      ["@types/*@2", "error: a version cannot be combined with a pattern: @types/*@2"],
    ])("bun update %p is an error that writes nothing", async (arg, message) => {
      const dir = await setup({ "no-deps": "~1.0.0" });
      const before = await snapshotFiles(dir);
      const { stderr, exitCode } = await run(dir, "update", arg);
      expect(stderr).toContain(message);
      expect(stderr).not.toContain("unrecognised dependency format");
      await expectUnchanged(dir, before);
      expect(await installedVersion(dir, "no-deps")).toBe("1.0.1");
      expect(exitCode).toBe(1);
    });
  });

  describe("group selectors", () => {
    const THREE_GROUPS_PINNED = {
      dependencies: { "no-deps": "1.0.0" },
      devDependencies: { "a-dep": "1.0.1" },
      optionalDependencies: { "dep-with-tags": "1.0.0" },
    };
    const THREE_GROUPS_WIDENED = {
      dependencies: { "no-deps": "^1.0.0" },
      devDependencies: { "a-dep": "^1.0.1" },
      optionalDependencies: { "dep-with-tags": "^1.0.0" },
    };

    it.concurrent.each(["--dev", "-D"])("%s updates only devDependencies", async flag => {
      const dir = await stale(THREE_GROUPS_PINNED, THREE_GROUPS_WIDENED);
      await update(dir, flag);
      await expectInSync(dir, {
        dependencies: { "no-deps": "^1.0.0" },
        devDependencies: { "a-dep": "^1.0.10" },
        optionalDependencies: { "dep-with-tags": "^1.0.0" },
      });
      expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
      expect(await lockedVersions(dir, "dep-with-tags")).toStrictEqual(["1.0.0"]);
      expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.10"]);
      expect(await installedVersion(dir, "no-deps")).toBe("1.0.0");
      expect(await installedVersion(dir, "a-dep")).toBe("1.0.10");
    });

    it.concurrent.each(["--prod", "-P", "--production", "-p"])(
      "%s updates dependencies and optionalDependencies and keeps devDependencies installed",
      async flag => {
        const dir = await stale(THREE_GROUPS_PINNED, THREE_GROUPS_WIDENED);
        await update(dir, flag);
        await expectInSync(dir, {
          dependencies: { "no-deps": "^1.1.0" },
          devDependencies: { "a-dep": "^1.0.1" },
          optionalDependencies: { "dep-with-tags": "^1.0.1" },
        });
        expect(await lockedVersions(dir, "a-dep")).toStrictEqual(["1.0.1"]);
        expect(await installedVersion(dir, "a-dep")).toBe("1.0.1");
        expect(await installedVersion(dir, "no-deps")).toBe("1.1.0");
        expect(await installedVersion(dir, "dep-with-tags")).toBe("1.0.1");
      },
    );

    it.concurrent("--dev composes with --latest", async () => {
      const dir = await setup({
        dependencies: { "dep-with-tags": "~1.0.0" },
        devDependencies: { "no-deps": "~1.0.0" },
      });
      await update(dir, "--dev", "--latest");
      await expectInSync(dir, {
        dependencies: { "dep-with-tags": "~1.0.0" },
        devDependencies: { "no-deps": "~2.0.0" },
      });
      expect(await lockedVersions(dir, "dep-with-tags")).toStrictEqual(["1.0.1"]);
    });

    it.concurrent("--dev with a name declared in another group updates nothing", async () => {
      const dir = await stale(
        { dependencies: { "no-deps": "1.0.0" }, devDependencies: { "a-dep": "1.0.1" } },
        { dependencies: { "no-deps": "^1.0.0" }, devDependencies: { "a-dep": "^1.0.1" } },
      );
      const before = await snapshotFiles(dir);
      const { stderr, exitCode } = await run(dir, "update", "no-deps", "--dev");
      expect(stderr).toContain('error: no dependencies in the selected groups match "no-deps"');
      await expectUnchanged(dir, before);
      expect(await installedVersion(dir, "no-deps")).toBe("1.0.0");
      expect(exitCode).toBe(1);
    });
  });

  // Nothing is stale after `install` (no-deps ^ -> 1.1.0, ~ -> 1.0.1); what varies is which package.json files get rewritten.
  describe("bun update <name> -r / --filter", () => {
    const FILES: Record<string, Json | string> = {
      "package.json": { name: "root", workspaces: ["packages/*"], dependencies: { "no-deps": "^1.0.0" } },
      "packages/api/package.json": {
        name: "api",
        version: "1.0.0",
        dependencies: { "no-deps": "^1.0.0", "a-dep": "^1.0.1", aliased: "npm:no-deps@~1.0.0" },
      },
      "packages/web/package.json": '{"name":"web","peerDependencies":{"no-deps":"~1.0.0"}}',
      "packages/pkg-a/package.json": {
        name: "pkg-a",
        devDependencies: { "no-deps": "^1.0.0" },
        dependencies: { api: "workspace:*" },
      },
      "packages/pkg-b/package.json": '{"name":"pkg-b"}',
    };
    const MEMBERS = ["", "packages/api", "packages/web", "packages/pkg-a", "packages/pkg-b"] as const;
    type Texts = Record<(typeof MEMBERS)[number], string>;

    async function texts(dir: string): Promise<Texts> {
      const out = {} as Texts;
      for (const rel of MEMBERS) out[rel] = await packageJsonText(dir, rel);
      return out;
    }

    async function fanOut() {
      const dir = await createDir(FILES);
      await install(dir);
      expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.1", "1.1.0"]);
      return { dir, before: await texts(dir), lockBefore: await lockText(dir) };
    }

    const API_UPDATED = { "no-deps": "^1.1.0", "a-dep": "^1.0.1", aliased: "npm:no-deps@~1.0.1" };

    it.concurrent("--filter rewrites the selected workspace only, reaching an alias by its real name", async () => {
      const { dir, before } = await fanOut();
      await update(dir, "no-deps", "--filter", "api");
      expect((await packageJsonOf(dir, "packages/api")).dependencies).toStrictEqual(API_UPDATED);
      const after = await texts(dir);
      expect(after).toStrictEqual({ ...before, "packages/api": after["packages/api"] });
      const { workspaces } = await lock(dir);
      expect(workspaces["packages/api"].dependencies).toStrictEqual(API_UPDATED);
      expect(workspaces[""].dependencies).toStrictEqual({ "no-deps": "^1.0.0" });
      await install(dir, "--frozen-lockfile");
    });

    it.concurrent.each([[["-r"]], [["--filter", "*"]]])(
      "%p rewrites every workspace declaring the name, in whichever group, and leaves the rest byte-identical",
      async flags => {
        const { dir, before } = await fanOut();
        await update(dir, "no-deps", ...flags);
        expect((await packageJsonOf(dir)).dependencies).toStrictEqual({ "no-deps": "^1.1.0" });
        expect((await packageJsonOf(dir, "packages/api")).dependencies).toStrictEqual(API_UPDATED);
        expect(await packageJsonOf(dir, "packages/web")).toStrictEqual({
          name: "web",
          peerDependencies: { "no-deps": "~1.0.1" },
        });
        expect(await packageJsonOf(dir, "packages/pkg-a")).toStrictEqual({
          name: "pkg-a",
          devDependencies: { "no-deps": "^1.1.0" },
          dependencies: { api: "workspace:*" },
        });
        expect(await packageJsonText(dir, "packages/pkg-b")).toBe(before["packages/pkg-b"]);
        const { workspaces } = await lock(dir);
        expect(workspaces[""].dependencies).toStrictEqual({ "no-deps": "^1.1.0" });
        expect(workspaces["packages/api"].dependencies).toStrictEqual(API_UPDATED);
        expect(workspaces["packages/web"].peerDependencies).toStrictEqual({ "no-deps": "~1.0.1" });
        expect(workspaces["packages/pkg-a"].devDependencies).toStrictEqual({ "no-deps": "^1.1.0" });
        await install(dir, "--frozen-lockfile");
      },
    );

    it.concurrent(
      "--latest with two filters leaves unselected workspaces' ranges in package.json and bun.lock",
      async () => {
        const { dir, before } = await fanOut();
        await update(dir, "no-deps", "--latest", "--filter", "api", "--filter", "pkg-a");
        expect((await packageJsonOf(dir, "packages/api")).dependencies).toStrictEqual({
          "no-deps": "^2.0.0",
          "a-dep": "^1.0.1",
          aliased: "npm:no-deps@~2.0.0",
        });
        expect((await packageJsonOf(dir, "packages/pkg-a")).devDependencies).toStrictEqual({ "no-deps": "^2.0.0" });
        expect(await packageJsonText(dir)).toBe(before[""]);
        expect(await packageJsonText(dir, "packages/web")).toBe(before["packages/web"]);
        expect(await packageJsonText(dir, "packages/pkg-b")).toBe(before["packages/pkg-b"]);
        const { workspaces } = await lock(dir);
        expect(workspaces[""].dependencies).toStrictEqual({ "no-deps": "^1.0.0" });
        expect(workspaces["packages/web"].peerDependencies).toStrictEqual({ "no-deps": "~1.0.0" });
        // 1.0.1 was only ever placed by api's alias row; web's peer entry is satisfied by whatever is hoisted.
        expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0", "2.0.0"]);
        await install(dir, "--frozen-lockfile");
      },
    );

    it.concurrent("several names never add a name to a workspace that does not declare it", async () => {
      const { dir, before } = await fanOut();
      await update(dir, "no-deps", "a-dep", "--filter", "api", "--filter", "web");
      expect((await packageJsonOf(dir, "packages/api")).dependencies).toStrictEqual({
        ...API_UPDATED,
        "a-dep": "^1.0.10",
      });
      expect(await packageJsonOf(dir, "packages/web")).toStrictEqual({
        name: "web",
        peerDependencies: { "no-deps": "~1.0.1" },
      });
      const after = await texts(dir);
      expect(after).toStrictEqual({
        ...before,
        "packages/api": after["packages/api"],
        "packages/web": after["packages/web"],
      });
      expect(JSON.stringify((await lock(dir)).workspaces["packages/web"])).not.toContain("a-dep");
      await install(dir, "--frozen-lockfile");
    });

    it.concurrent.each([
      [
        ["no-deps", "--filter", "pkg-b"],
        'error: "no-deps" is not a dependency of the selected workspaces\n    bun update -r no-deps\n    bun update --filter root no-deps\n    bun update --filter api no-deps\n    bun update --filter pkg-a no-deps\n    bun update --filter web no-deps\n',
      ],
      [["is-number", "--filter", "api"], 'error: "is-number" is not in bun.lock\n    bun add is-number\n'],
      [["no-deps", "--filter", "nope"], 'error: No workspace packages matched the filter "nope"\n'],
    ])("bun update %p is an error that writes nothing", async (args, expected) => {
      const { dir, before, lockBefore } = await fanOut();
      const { stderr, exitCode } = await run(dir, "update", ...args);
      expect(stderr).toBe(expected);
      expect(await texts(dir)).toStrictEqual(before);
      expect(await lockText(dir)).toBe(lockBefore);
      expect(exitCode).toBe(1);
    });

    it.concurrent("a pattern with one unmatched filter warns exactly once", async () => {
      const { dir } = await fanOut();
      const { stderr, exitCode } = await run(dir, "update", "no-*", "--filter", "api", "--filter", "nope");
      const warnings = stderr.split("\n").filter(line => line.includes("No workspace packages matched"));
      expect(warnings).toStrictEqual(['warn: No workspace packages matched the filter "nope"']);
      expect(exitCode).toBe(0);
    });

    it.concurrent("--dry-run writes nothing", async () => {
      const { dir, before, lockBefore } = await fanOut();
      const { stderr } = await update(dir, "no-deps", "--filter", "api", "--dry-run");
      expect(stderr).not.toContain("Saved lockfile");
      expect(await texts(dir)).toStrictEqual(before);
      expect(await lockText(dir)).toBe(lockBefore);
    });

    it.concurrent("--filter decides the target, not the cwd", async () => {
      const { dir, before } = await fanOut();
      const { stderr, exitCode } = await runFrom(
        join(dir, "packages", "web"),
        dir,
        "update",
        "no-deps",
        "--filter",
        "api",
      );
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
      expect((await packageJsonOf(dir, "packages/api")).dependencies).toStrictEqual(API_UPDATED);
      expect(await packageJsonText(dir, "packages/web")).toBe(before["packages/web"]);
      expect(await packageJsonText(dir)).toBe(before[""]);
    });

    // Like an unfiltered `bun update <name>`, a named update never rewrites a `catalog:` reference or the catalog entry behind it (only a bare update moves the catalog).
    it.concurrent("a catalog reference keeps the member's literal and the root catalog entry", async () => {
      const dir = await createDir({
        "package.json": { name: "root", workspaces: { packages: ["packages/*"], catalog: { "no-deps": "^1.0.0" } } },
        "packages/api/package.json": { name: "api", dependencies: { "no-deps": "catalog:" } },
        "packages/web/package.json": '{"name":"web","dependencies":{"no-deps":"catalog:"}}',
      });
      await install(dir);
      const [rootBefore, apiBefore, webBefore] = await Promise.all([
        packageJsonText(dir),
        packageJsonText(dir, "packages/api"),
        packageJsonText(dir, "packages/web"),
      ]);
      await update(dir, "no-deps", "--latest", "--filter", "api");
      expect(await packageJsonText(dir, "packages/api")).toBe(apiBefore);
      expect(await packageJsonText(dir)).toBe(rootBefore);
      expect(await packageJsonText(dir, "packages/web")).toBe(webBefore);
      expect((await lock(dir)).catalog).toStrictEqual({ "no-deps": "^1.0.0" });
      expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
      await install(dir, "--frozen-lockfile");
    });

    // root -> app -> lib -> util; tool -> lib (devDependency); lone has no workspace edges.
    it.concurrent("an unnamed update accepts relation selectors", async () => {
      const dir = await createDir({
        "package.json": {
          name: "root",
          workspaces: ["packages/*"],
          dependencies: { app: "workspace:*", "dep-with-tags": "1.0.0" },
        },
        "packages/app/package.json": {
          name: "app",
          version: "1.0.0",
          dependencies: { lib: "workspace:*", "is-number": "1.0.0" },
        },
        "packages/lib/package.json": {
          name: "lib",
          version: "1.0.0",
          dependencies: { util: "workspace:*", "no-deps": "1.0.0" },
        },
        "packages/util/package.json": { name: "util", version: "1.0.0", dependencies: { "a-dep": "1.0.1" } },
        "packages/tool/package.json": {
          name: "tool",
          version: "1.0.0",
          devDependencies: { lib: "workspace:*" },
          dependencies: { "@types/is-number": "1.0.0" },
        },
        "packages/lone/package.json": { name: "lone", version: "1.0.0", dependencies: { "@types/no-deps": "1.0.0" } },
      });
      await install(dir);
      const untouched = ["", "packages/app", "packages/tool", "packages/lone"];
      const before = await Promise.all(untouched.map(rel => packageJsonText(dir, rel)));

      await update(dir, "--latest", "--filter", "lib...");
      const libDeps = { util: "workspace:*", "no-deps": "2.0.0" };
      const utilDeps = { "a-dep": "1.0.10" };
      expect((await packageJsonOf(dir, "packages/lib")).dependencies).toStrictEqual(libDeps);
      expect((await packageJsonOf(dir, "packages/util")).dependencies).toStrictEqual(utilDeps);
      expect(await Promise.all(untouched.map(rel => packageJsonText(dir, rel)))).toStrictEqual(before);
      const { workspaces } = await lock(dir);
      expect(workspaces["packages/lib"].dependencies).toStrictEqual(libDeps);
      expect(workspaces["packages/util"].dependencies).toStrictEqual(utilDeps);
      await install(dir, "--frozen-lockfile");
    });

    // Installed once, then every node_modules is removed and a stale entry is planted in web's, so what an update links back is observable.
    async function linkRepo(linker: "hoisted" | "isolated") {
      const dir = await createDir({
        "package.json": { name: "root", workspaces: ["packages/*"], dependencies: { "a-dep": "^1.0.1" } },
        "packages/api/package.json": { name: "api", dependencies: { "no-deps": "^1.0.0" } },
        "packages/web/package.json": { name: "web", dependencies: { "is-number": "1.0.0" } },
      });
      await install(dir, `--linker=${linker}`);
      await rm(join(dir, "node_modules"), { recursive: true, force: true });
      if (linker === "isolated") {
        await rm(join(dir, "packages", "api", "node_modules"), { recursive: true, force: true });
        await rm(join(dir, "packages", "web", "node_modules"), { recursive: true, force: true });
      }
      await mkdir(join(dir, "packages", "web", "node_modules", "stale"), { recursive: true });
      await writeFile(join(dir, "packages", "web", "node_modules", "stale", "package.json"), '{"name":"stale"}');
      return dir;
    }

    const installed = (dir: string, rels: string[]) => Promise.all(rels.map(rel => exists(join(dir, rel))));

    const HOISTED_LINK_PATHS = [
      "node_modules/api",
      "node_modules/no-deps/package.json",
      "node_modules/web",
      "node_modules/is-number",
      "node_modules/a-dep",
      "packages/web/node_modules/stale/package.json",
    ];

    it.concurrent("a named --filter update links only the selected workspace (hoisted)", async () => {
      const dir = await linkRepo("hoisted");
      await update(dir, "no-deps", "--filter", "api", "--linker=hoisted");
      expect(await installed(dir, HOISTED_LINK_PATHS)).toStrictEqual([true, true, false, false, false, true]);
      await install(dir, "--linker=hoisted");
      expect(await installed(dir, ["node_modules/is-number", "node_modules/a-dep"])).toStrictEqual([true, true]);
    });

    it.concurrent("a named --filter update links only the selected workspace (isolated)", async () => {
      const dir = await linkRepo("isolated");
      await update(dir, "no-deps", "--filter", "api", "--linker=isolated");
      expect(
        await installed(dir, [
          "packages/api/node_modules/no-deps/package.json",
          "packages/web/node_modules/is-number",
          "packages/web/node_modules/stale/package.json",
          "node_modules/web",
        ]),
      ).toStrictEqual([true, false, true, false]);
      await install(dir, "--linker=isolated");
      expect(await installed(dir, ["packages/web/node_modules/is-number/package.json"])).toStrictEqual([true]);
    });

    it.concurrent("an unnamed --filter update links only the selected workspace", async () => {
      const dir = await linkRepo("hoisted");
      await update(dir, "--filter", "api", "--linker=hoisted");
      expect(await installed(dir, HOISTED_LINK_PATHS)).toStrictEqual([true, true, false, false, false, true]);
    });

    it.concurrent("an unnamed --filter update links only the selected workspace (isolated)", async () => {
      const dir = await linkRepo("isolated");
      await update(dir, "--filter", "api", "--linker=isolated");
      expect(
        await installed(dir, [
          "packages/api/node_modules/no-deps/package.json",
          "packages/web/node_modules/is-number",
          "packages/web/node_modules/stale/package.json",
          "node_modules/web",
        ]),
      ).toStrictEqual([true, false, true, false]);
      await install(dir, "--linker=isolated");
      expect(await installed(dir, ["packages/web/node_modules/is-number/package.json"])).toStrictEqual([true]);
    });

    const TABBED = '{\n\t"name": "tabbed",\n\t"dependencies": {\n\t\t"no-deps": "~1.0.0"\n\t}\n}\n';
    const SPACED = '{\n    "name": "spaced",\n    "devDependencies": {\n        "no-deps": "^1.0.0"\n    }\n}';

    it.concurrent("a bare -r --latest keeps each member's indentation and trailing newline", async () => {
      const dir = await createDir({
        "package.json": { name: "root", workspaces: ["packages/*"], dependencies: { "a-dep": "~1.0.1" } },
        "packages/tabbed/package.json": TABBED,
        "packages/spaced/package.json": SPACED,
      });
      await install(dir);
      await update(dir, "-r", "--latest");
      expect(await packageJsonText(dir, "packages/tabbed")).toBe(TABBED.replace("~1.0.0", "~2.0.0"));
      expect(await packageJsonText(dir, "packages/spaced")).toBe(SPACED.replace("^1.0.0", "^2.0.0"));
      expect(await packageJsonText(dir)).toBe(
        stringify({ name: "root", workspaces: ["packages/*"], dependencies: { "a-dep": "~1.0.10" } }),
      );
      const { workspaces } = await lock(dir);
      expect(workspaces["packages/tabbed"].dependencies).toStrictEqual({ "no-deps": "~2.0.0" });
      expect(workspaces["packages/spaced"].devDependencies).toStrictEqual({ "no-deps": "^2.0.0" });
      expect(workspaces[""].dependencies).toStrictEqual({ "a-dep": "~1.0.10" });
      await install(dir, "--frozen-lockfile");
    });

    // dep-with-tags 3.0.1 is published above its `latest` tag (3.0.0).
    it.concurrent.each([[""], ["packages/pinned"]])(
      "-r --latest run from %p does not downgrade a member pinned ahead of `latest` while moving the others",
      async cwd => {
        const dir = await createDir({
          "package.json": { name: "root", workspaces: ["packages/*"] },
          "packages/pinned/package.json": { name: "pinned", dependencies: { "dep-with-tags": "3.0.1" } },
          "packages/stale/package.json": { name: "stale", dependencies: { "no-deps": "^1.0.0" } },
        });
        await install(dir);
        expect(await lockedVersions(dir, "dep-with-tags")).toStrictEqual(["3.0.1"]);
        expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
        const rootText = await packageJsonText(dir);
        const pinnedText = await packageJsonText(dir, "packages/pinned");

        const { stdout, stderr, exitCode } = await runFrom(join(dir, cwd), dir, "update", "-r", "--latest");
        expect(stderr).not.toContain("error:");
        expect(stdout).not.toContain("dep-with-tags@3.0.0");
        expect(await packageJsonText(dir)).toBe(rootText);
        expect(await packageJsonText(dir, "packages/pinned")).toBe(pinnedText);
        expect((await packageJsonOf(dir, "packages/stale")).dependencies).toStrictEqual({ "no-deps": "^2.0.0" });
        const { workspaces } = await lock(dir);
        expect(workspaces["packages/pinned"].dependencies).toStrictEqual({ "dep-with-tags": "3.0.1" });
        expect(workspaces["packages/stale"].dependencies).toStrictEqual({ "no-deps": "^2.0.0" });
        expect(await lockedVersions(dir, "dep-with-tags")).toStrictEqual(["3.0.1"]);
        expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["2.0.0"]);
        expect(await installedVersion(dir, "dep-with-tags")).toBe("3.0.1");
        expect(await installedVersion(dir, "no-deps")).toBe("2.0.0");
        await install(dir, "--frozen-lockfile");
        expect(exitCode).toBe(0);
      },
    );

    it.concurrent.each([[["-r"]], [["--filter", "api"]]])(
      "a bare update %p without a bun.lock is an error that writes nothing",
      async flags => {
        const dir = await createDir(FILES);
        const before = await texts(dir);
        const { stdout, stderr, exitCode } = await run(dir, "update", ...flags);
        expect(stderr).toContain("error: missing lockfile, nothing to update");
        expect(stdout).not.toContain("installed");
        expect(await texts(dir)).toStrictEqual(before);
        expect(await installed(dir, ["bun.lock", "node_modules", "packages/api/node_modules"])).toStrictEqual([
          false,
          false,
          false,
        ]);
        expect(exitCode).toBe(1);
      },
    );

    it.concurrent.each([[["-r"]], [["--filter", "*"]]])(
      "a named update with %p still links every workspace and the root",
      async flags => {
        const dir = await linkRepo("hoisted");
        await update(dir, "no-deps", ...flags, "--linker=hoisted");
        expect(
          await installed(dir, [
            "node_modules/api",
            "node_modules/web",
            "node_modules/no-deps",
            "node_modules/is-number",
            "node_modules/a-dep",
          ]),
        ).toStrictEqual([true, true, true, true, true]);
      },
    );
  });

  // The global dir (<dir>/.global/install/global) is a sibling of the cwd project: a first `-g` install into a global dir nested under a project walks up to that project's package.json.
  describe("--global", () => {
    const PROJECT = { name: "project", dependencies: { "no-deps": "^1.0.0" } };
    const GLOBAL_PINNED = { "no-deps": "1.0.0", "a-dep": "1.0.1" };
    const GLOBAL_WIDENED = { "no-deps": "^1.0.0", "a-dep": "^1.0.1" };

    async function globalRepo() {
      const dir = await createDir({ "project/package.json": PROJECT });
      const project = join(dir, "project");
      const globalDir = join(dir, ".global", "install", "global");
      const runGlobal = async (...args: string[]) => {
        await using proc = spawn({
          cmd: [bunExe(), ...args, "-g", `--config=${join(dir, "bunfig.toml")}`],
          cwd: project,
          env: { ...envFor(dir), BUN_INSTALL: join(dir, ".global") },
          stdout: "pipe",
          stderr: "pipe",
          stdin: "ignore",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { stdout, stderr, exitCode };
      };
      const added = await runGlobal("add", "no-deps@1.0.0", "a-dep@1.0.1");
      expect(added.stderr).not.toContain("error:");
      expect(added.exitCode).toBe(0);
      const globalJson = await packageJsonOf(globalDir);
      expect(globalJson.dependencies).toStrictEqual(GLOBAL_PINNED);
      await writeFile(join(globalDir, "package.json"), stringify({ ...globalJson, dependencies: GLOBAL_WIDENED }));
      const projectBefore = await packageJsonText(project);
      return { project, globalDir, runGlobal, projectBefore };
    }

    async function expectGlobalInSync(globalDir: string, dependencies: Json) {
      expect((await packageJsonOf(globalDir)).dependencies).toStrictEqual(dependencies);
      expect((await lock(globalDir)).workspaces[""].dependencies).toStrictEqual(dependencies);
    }

    async function expectProjectUntouched(project: string, projectBefore: string) {
      expect(await packageJsonText(project)).toBe(projectBefore);
      expect(
        await Promise.all([exists(join(project, "bun.lock")), exists(join(project, "node_modules"))]),
      ).toStrictEqual([false, false]);
    }

    it.concurrent.each([
      [[], { "no-deps": "^1.1.0", "a-dep": "^1.0.10" }, "1.1.0", "1.0.10"],
      [["no-deps"], { "no-deps": "^1.1.0", "a-dep": "^1.0.1" }, "1.1.0", "1.0.1"],
      [["--latest"], { "no-deps": "^2.0.0", "a-dep": "^1.0.10" }, "2.0.0", "1.0.10"],
    ])("bun update -g %p rewrites the global package.json and bun.lock only", async (args, expected, noDeps, aDep) => {
      const { project, globalDir, runGlobal, projectBefore } = await globalRepo();
      const { stderr, exitCode } = await runGlobal("update", ...args);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
      await expectGlobalInSync(globalDir, expected);
      expect(await lockedVersions(globalDir, "no-deps")).toStrictEqual([noDeps]);
      expect(await lockedVersions(globalDir, "a-dep")).toStrictEqual([aDep]);
      expect(await installedVersion(globalDir, "no-deps")).toBe(noDeps);
      expect(await installedVersion(globalDir, "a-dep")).toBe(aDep);
      await expectProjectUntouched(project, projectBefore);
    });

    it.concurrent("bun update <name> --filter -g is an error that writes nothing", async () => {
      const { project, globalDir, runGlobal, projectBefore } = await globalRepo();
      const globalBefore = await snapshotFiles(globalDir);
      const { stderr, exitCode } = await runGlobal("update", "no-deps", "--filter", "*");
      expect(stderr).toContain("error: --filter cannot be used with --global");
      await expectUnchanged(globalDir, globalBefore);
      expect(await installedVersion(globalDir, "no-deps")).toBe("1.0.0");
      await expectProjectUntouched(project, projectBefore);
      expect(exitCode).toBe(1);
    });

    // The global dir has no workspaces, so --recursive is a no-op there.
    // Pre-1.4 accepted `bun update -g -r`; it must not error (#39823).
    it.concurrent.each([
      [[], { "no-deps": "^1.1.0", "a-dep": "^1.0.10" }, "1.1.0", "1.0.10"],
      [["no-deps"], { "no-deps": "^1.1.0", "a-dep": "^1.0.1" }, "1.1.0", "1.0.1"],
      [["--latest"], { "no-deps": "^2.0.0", "a-dep": "^1.0.10" }, "2.0.0", "1.0.10"],
    ])("bun update -g --recursive %p behaves like bun update -g", async (args, expected, noDeps, aDep) => {
      const { project, globalDir, runGlobal, projectBefore } = await globalRepo();
      const { stderr, exitCode } = await runGlobal("update", "--recursive", ...args);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
      await expectGlobalInSync(globalDir, expected);
      expect(await lockedVersions(globalDir, "no-deps")).toStrictEqual([noDeps]);
      expect(await lockedVersions(globalDir, "a-dep")).toStrictEqual([aDep]);
      expect(await installedVersion(globalDir, "no-deps")).toBe(noDeps);
      expect(await installedVersion(globalDir, "a-dep")).toBe(aDep);
      await expectProjectUntouched(project, projectBefore);
    });
  });
});
