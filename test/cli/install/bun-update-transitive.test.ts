import { file, write } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { VerdaccioRegistry, bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "path";

// Registry: no-deps 1.0.0 / 1.0.1 / 1.1.0 / 2.0.0; one-range-dep@1.0.0 depends on `no-deps: ^1.0.0`;
// one-fixed-dep@1.0.0 depends on `no-deps: 1.0.0`; dep-with-tags has 3.0.1 published above its `latest` (3.0.0);
// prereleases-1 has 1.0.0-future.7 published above its `latest` (1.0.0-future.4).

const registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

type Json = Record<string, any>;
type Linker = "hoisted" | "isolated";
type Layout = { text?: boolean; linker?: Linker };

const pkgJson = (dependencies: Json, extra: Json = {}) => ({ name: "foo", dependencies, ...extra });
const stringify = (json: Json) => JSON.stringify(json, null, 2) + "\n";

const linkerArgs = (layout: Layout) => ["--linker", layout.linker ?? "hoisted"];

async function run(dir: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: dir,
    env: bunEnv,
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

async function setup(files: Record<string, Json>, layout: Layout = {}) {
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { saveTextLockfile: layout.text ?? true, linker: layout.linker ?? "hoisted" },
    files: Object.fromEntries(Object.entries(files).map(([path, json]) => [path, stringify(json)])),
  });
  await install(packageDir, ...linkerArgs(layout));
  return packageDir;
}

async function reinstall(dir: string, packageJson: Json, layout: Layout = {}, rel = "") {
  await write(join(dir, rel, "package.json"), stringify(packageJson));
  expect(await install(dir, ...linkerArgs(layout))).toContain("Saved lockfile");
}

const packageJsonOf = (dir: string, rel = ""): Promise<Json> => file(join(dir, rel, "package.json")).json();
const packageJsonText = (dir: string, rel = "") => file(join(dir, rel, "package.json")).text();
const lockText = (dir: string) => file(join(dir, "bun.lock")).text();
const lock = async (dir: string): Promise<Json> => Bun.JSONC.parse(await lockText(dir)) as Json;

// Every version of `name` resolved anywhere in bun.lock.
async function lockedVersions(dir: string, name: string) {
  const { packages } = await lock(dir);
  const versions = Object.entries(packages as Record<string, [string]>)
    .filter(([key]) => key === name || key.endsWith(`/${name}`))
    .map(([, [resolution]]) => resolution.slice(name.length + 1));
  return [...new Set(versions)].sort();
}

async function installedVersion(dir: string, ...segments: string[]) {
  return (await file(join(dir, "node_modules", ...segments, "package.json")).json()).version;
}

const noDepsPath = (linker: Linker = "hoisted") =>
  linker === "isolated" ? [".bun", "one-range-dep@1.0.0", "node_modules", "no-deps"] : ["no-deps"];

// no-deps@1.0.0 survives being dropped from package.json because one-range-dep's `^1.0.0` edge is still satisfied,
// leaving a transitive dependency that a plain `bun install` never moves.
async function stale(layout: Layout = {}) {
  const dir = await setup({ "package.json": pkgJson({ "one-range-dep": "1.0.0", "no-deps": "1.0.0" }) }, layout);
  const packageJson = pkgJson({ "one-range-dep": "1.0.0" });
  await reinstall(dir, packageJson, layout);
  const noDeps = noDepsPath(layout.linker);
  if (layout.text ?? true) {
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  }
  expect(await installedVersion(dir, ...noDeps)).toBe("1.0.0");
  return { dir, packageJson, noDeps };
}

async function expectTransitiveBump(
  { dir, packageJson, noDeps }: Awaited<ReturnType<typeof stale>>,
  layout: Layout,
  ...args: string[]
) {
  const { stdout, stderr, exitCode } = await run(dir, "update", ...args, ...linkerArgs(layout));
  expect(stderr).not.toContain("error:");
  expect(stderr).toContain("Saved lockfile");
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await installedVersion(dir, ...noDeps)).toBe("1.1.0");
  if (layout.text ?? true) {
    expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
    expect(await lockedVersions(dir, "one-range-dep")).toStrictEqual(["1.0.0"]);
  }
  await install(dir, "--frozen-lockfile", ...linkerArgs(layout));
  expect(exitCode).toBe(0);
  return stdout;
}

test.concurrent.each<[string, Layout]>([
  ["text lockfile", { text: true }],
  ["binary lockfile", { text: false }],
  ["text lockfile + isolated linker", { text: true, linker: "isolated" }],
])("`bun update` moves a transitive dependency within its dependent's range (%s)", async (_, layout) => {
  const fixture = await stale(layout);
  const stdout = await expectTransitiveBump(fixture, layout);
  expect(normalizeBunSnapshot(stdout.split("\n").slice(0, 3).join("\n"))).toMatchInlineSnapshot(`
    "bun update <version> (<revision>)
    updating:
      no-deps@1.0.0 → 1.1.0"
  `);
});

test.concurrent("`bun update --latest` still moves transitive dependencies only within their ranges", async () => {
  const fixture = await stale();
  const stdout = await expectTransitiveBump(fixture, {}, "--latest");
  expect(stdout).toContain("  no-deps@1.0.0 → 1.1.0\n");
});

test.concurrent("`bun update <name>` reaches a package that is only a transitive dependency", async () => {
  const fixture = await stale();
  const stdout = await expectTransitiveBump(fixture, {}, "no-deps");
  expect(stdout).not.toContain("updating:");
});

test.concurrent("`bun update <name>` naming a package with nothing newer changes nothing", async () => {
  const { dir, packageJson } = await stale();
  const before = await lock(dir);
  const { stderr, exitCode } = await run(dir, "update", "one-range-dep");
  expect(stderr).not.toContain("error:");
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await lock(dir)).toStrictEqual(before);
  expect(exitCode).toBe(0);
});

test.concurrent("`bun update <name>` rejects a name that is not in the lockfile", async () => {
  const { dir, packageJson } = await stale();
  const before = await lockText(dir);
  const { stderr, exitCode } = await run(dir, "update", "does-not-exist");
  expect(stderr).toContain('error: "does-not-exist" is not in the lockfile, so there is nothing to update');
  expect(stderr).toContain("bun add");
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await lockText(dir)).toBe(before);
  expect(exitCode).toBe(1);
});

test.concurrent("`bun update --dry-run` prints the transitive plan and writes nothing", async () => {
  const { dir, packageJson, noDeps } = await stale();
  const before = await lockText(dir);
  const { stdout, stderr, exitCode } = await run(dir, "update", "--dry-run");
  expect(stdout).toContain("  no-deps@1.0.0 → 1.1.0\n");
  expect(stdout).toContain("Would update 1 package");
  expect(stderr).not.toContain("error:");
  expect(stderr).not.toContain("Saved lockfile");
  expect(await lockText(dir)).toBe(before);
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await installedVersion(dir, ...noDeps)).toBe("1.0.0");
  expect(exitCode).toBe(0);
});

test.concurrent("a direct dependency's declared range is left alone when only its dependency moves", async () => {
  const { dir } = await stale();
  await run(dir, "update");
  expect(await packageJsonOf(dir)).toStrictEqual(pkgJson({ "one-range-dep": "1.0.0" }));
  expect((await lock(dir)).workspaces[""].dependencies).toStrictEqual({ "one-range-dep": "1.0.0" });
});

test.concurrent("a transitive dependency pinned exactly by its dependent stays put", async () => {
  const dir = await setup({ "package.json": pkgJson({ "one-fixed-dep": "1.0.0" }) });
  const before = await lock(dir);
  const { stdout, stderr, exitCode } = await run(dir, "update");
  expect(stdout).not.toContain("updating:");
  expect(stderr).not.toContain("error:");
  expect(await lock(dir)).toStrictEqual(before);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  expect(exitCode).toBe(0);
});

// A root `no-deps@1.0.0` dedupes both dependents' edges onto 1.0.0 before it is dropped (a fresh install would already
// fork); `bun update` then moves only the `^1.0.0` edge, forking away from the sibling's exact pin.
test.concurrent("dependents with different ranges are resolved independently", async () => {
  const dependents = { "one-fixed-dep": "1.0.0", "one-range-dep": "1.0.0" };
  const dir = await setup({ "package.json": pkgJson({ "no-deps": "1.0.0", ...dependents }) });
  const packageJson = pkgJson(dependents);
  await reinstall(dir, packageJson);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  const { stdout, stderr, exitCode } = await run(dir, "update");
  expect(stdout).toContain("  no-deps@1.0.0 → 1.1.0\n");
  expect(stderr).not.toContain("error:");
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0", "1.1.0"]);
  const { packages } = await lock(dir);
  expect([packages["no-deps"][0], packages["one-range-dep/no-deps"][0]]).toStrictEqual([
    "no-deps@1.0.0",
    "no-deps@1.1.0",
  ]);
  await install(dir, "--frozen-lockfile");
  expect(exitCode).toBe(0);
});

test.concurrent("an override holds a transitive dependency back", async () => {
  const { dir } = await stale();
  const packageJson = pkgJson({ "one-range-dep": "1.0.0" }, { overrides: { "no-deps": "1.0.0" } });
  await reinstall(dir, packageJson);
  const before = await lock(dir);
  const { stdout, stderr, exitCode } = await run(dir, "update");
  expect(stdout).not.toContain("updating:");
  expect(stderr).not.toContain("error:");
  expect(await lock(dir)).toStrictEqual(before);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  expect(exitCode).toBe(0);
});

test.concurrent("a lockfile that already resolves the newest allowed versions is left alone", async () => {
  const dir = await setup({ "package.json": pkgJson({ "one-range-dep": "1.0.0" }) });
  const before = await lock(dir);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
  const { stdout, stderr, exitCode } = await run(dir, "update");
  expect(stdout).not.toContain("updating:");
  expect(stderr).not.toContain("error:");
  expect(await lock(dir)).toStrictEqual(before);
  expect(exitCode).toBe(0);
});

test.concurrent("without a lockfile `bun update` resolves everything fresh", async () => {
  const { packageDir } = await registry.createTestDir({
    bunfigOpts: { saveTextLockfile: true, linker: "hoisted" },
    files: { "package.json": stringify(pkgJson({ "one-range-dep": "1.0.0" })) },
  });
  const { stdout, stderr, exitCode } = await run(packageDir, "update");
  expect(stdout).not.toContain("updating:");
  expect(stderr).not.toContain("error:");
  expect(stderr).toContain("Saved lockfile");
  expect(await lockedVersions(packageDir, "no-deps")).toStrictEqual(["1.1.0"]);
  expect(exitCode).toBe(0);
});

test.concurrent("in a workspace, `bun update` from the root moves a member's transitive dependency", async () => {
  const root = { name: "root", workspaces: ["packages/*"] };
  const member = (dependencies: Json) => ({ name: "pkg1", version: "1.0.0", dependencies });
  const dir = await setup({
    "package.json": root,
    "packages/pkg1/package.json": member({ "one-range-dep": "1.0.0", "no-deps": "1.0.0" }),
  });
  const pkg1 = member({ "one-range-dep": "1.0.0" });
  await reinstall(dir, pkg1, {}, "packages/pkg1");
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);

  const { stdout, stderr, exitCode } = await run(dir, "update");
  expect(stdout).toContain("  no-deps@1.0.0 → 1.1.0\n");
  expect(stderr).not.toContain("error:");
  expect(await packageJsonOf(dir)).toStrictEqual(root);
  expect(await packageJsonOf(dir, "packages/pkg1")).toStrictEqual(pkg1);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
  expect(await installedVersion(dir, "no-deps")).toBe("1.1.0");
  await install(dir, "--frozen-lockfile");
  expect(exitCode).toBe(0);
});

test.concurrent.each([
  ["dep-with-tags", "3.0.1"],
  ["prereleases-1", "1.0.0-future.7"],
])("`bun update --latest` does not downgrade %s from %s, which is ahead of `latest`", async (name, version) => {
  const packageJson = pkgJson({ [name]: version });
  const dir = await setup({ "package.json": packageJson });
  expect(await installedVersion(dir, name)).toBe(version);

  const { stderr, exitCode } = await run(dir, "update", "--latest");
  expect(stderr).not.toContain("error:");
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await lockedVersions(dir, name)).toStrictEqual([version]);
  expect(await lockText(dir)).not.toContain('"latest"');
  expect(await installedVersion(dir, name)).toBe(version);
  await install(dir, "--frozen-lockfile");
  expect(exitCode).toBe(0);
});

test.concurrent("`bun update --help` no longer offers a transitive flag", async () => {
  const { packageDir } = await registry.createTestDir();
  const { stdout, exitCode } = await run(packageDir, "update", "--help");
  expect(stdout).not.toContain("--transitive");
  expect(exitCode).toBe(0);
});

test.concurrent("`bun update --silent` prints no plan but still moves the transitive dependency", async () => {
  const { dir, packageJson, noDeps } = await stale();
  const { stdout, stderr, exitCode } = await run(dir, "update", "--silent");
  expect(stdout).toBe("");
  expect(stderr).not.toContain("error:");
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.1.0"]);
  expect(await installedVersion(dir, ...noDeps)).toBe("1.1.0");
  await install(dir, "--frozen-lockfile");
  expect(exitCode).toBe(0);
});

test.concurrent("`bun update --no-save` moves the transitive dependency in node_modules only", async () => {
  const { dir, noDeps } = await stale();
  const packageJsonBefore = await packageJsonText(dir);
  const lockBefore = await lockText(dir);
  const { stdout, stderr, exitCode } = await run(dir, "update", "--no-save");
  expect(stdout).toContain("  no-deps@1.0.0 → 1.1.0\n");
  expect(stderr).not.toContain("error:");
  expect(stderr).not.toContain("Saved lockfile");
  expect(await packageJsonText(dir)).toBe(packageJsonBefore);
  expect(await lockText(dir)).toBe(lockBefore);
  expect(await installedVersion(dir, ...noDeps)).toBe("1.1.0");
  expect(exitCode).toBe(0);
});

async function expectNoop(dir: string, ...args: string[]) {
  const packageJson = await packageJsonOf(dir);
  const before = await lockText(dir);
  const { stdout, stderr, exitCode } = await run(dir, "update", ...args);
  expect(stdout).not.toContain("updating:");
  expect(stderr).not.toContain("error:");
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect(await lockText(dir)).toBe(before);
  await install(dir, "--frozen-lockfile");
  expect(exitCode).toBe(0);
}

// hoist-lockfile-{1,2,3} depend on hoist-lockfile-shared (1.0.1 / 1.0.2 / 2.0.1 / 2.0.2) as `*` / `^1.0.1` / `>=1.0.1`.
const HOIST_DEPENDENTS = { "hoist-lockfile-1": "1.0.0", "hoist-lockfile-2": "1.0.0", "hoist-lockfile-3": "1.0.0" };

async function staleShared() {
  const dir = await setup({ "package.json": pkgJson({ ...HOIST_DEPENDENTS, "hoist-lockfile-shared": "1.0.1" }) });
  const packageJson = pkgJson(HOIST_DEPENDENTS);
  await reinstall(dir, packageJson);
  expect(await lockedVersions(dir, "hoist-lockfile-shared")).toStrictEqual(["1.0.1"]);
  return { dir, packageJson };
}

test.concurrent.each([
  ["bare", []],
  ["named", ["hoist-lockfile-shared"]],
  ["named with an ignored @version", ["hoist-lockfile-shared@1.0.1"]],
])("every dependent's range on a shared package is re-resolved on its own (%s)", async (_, args) => {
  const { dir, packageJson } = await staleShared();
  const { stderr, exitCode } = await run(dir, "update", ...args);
  expect(stderr).not.toContain("error:");
  expect(await packageJsonOf(dir)).toStrictEqual(packageJson);
  expect((await lock(dir)).workspaces[""].dependencies).toStrictEqual(HOIST_DEPENDENTS);
  expect(await lockedVersions(dir, "hoist-lockfile-shared")).toStrictEqual(["1.0.2", "2.0.2"]);
  await install(dir, "--frozen-lockfile");
  expect(exitCode).toBe(0);
});

test.concurrent("the plan counts packages, not the edges that move onto them", async () => {
  const { dir } = await staleShared();
  const before = await lockText(dir);
  const { stdout, stderr, exitCode } = await run(dir, "update", "--dry-run");
  expect(stdout).toContain("  hoist-lockfile-shared@1.0.1 → 1.0.2\n");
  expect(stdout).toContain("  hoist-lockfile-shared@1.0.1 → 2.0.2\n");
  expect(stdout.match(/^  hoist-lockfile-shared@/gm)).toHaveLength(2);
  expect(stdout).toContain("Would update 2 packages");
  expect(stderr).not.toContain("error:");
  expect(await lockText(dir)).toBe(before);
  expect(exitCode).toBe(0);
});

// peer-deps-fixed@1.0.0 declares peer `no-deps: ^1.0.0`; the root's exact no-deps@1.0.0 is its only provider.
test.concurrent.each([
  ["bare", []],
  ["--latest peer-deps-fixed", ["--latest", "peer-deps-fixed"]],
  ["no-deps", ["no-deps"]],
])("a peer edge keeps following the root's pinned provider instead of forking (%s)", async (_, args) => {
  const dir = await setup({ "package.json": pkgJson({ "peer-deps-fixed": "1.0.0", "no-deps": "1.0.0" }) });
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  await expectNoop(dir, ...args);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  expect(await installedVersion(dir, "no-deps")).toBe("1.0.0");
});

// peer-deps@1.0.0 has nothing but a `no-deps: *` peer, which the install auto-installs at latest.
test.concurrent("a package with only peer dependencies is a clean no-op", async () => {
  const dir = await setup({ "package.json": pkgJson({ "peer-deps": "1.0.0" }) });
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["2.0.0"]);
  await expectNoop(dir);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["2.0.0"]);
});

// dep-loop-entry@1.0.0 and dep-loop-exit@1.0.0 pin each other; bundled-1@1.0.0 ships its own no-deps@1.0.0.
test.concurrent.each([
  ["bare", []],
  ["no-deps", ["no-deps"]],
  ["dep-loop-exit", ["dep-loop-exit"]],
])("a dependency cycle and a bundled dependency are left alone (%s)", async (_, args) => {
  const dir = await setup({ "package.json": pkgJson({ "dep-loop-entry": "1.0.0", "bundled-1": "1.0.0" }) });
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  await expectNoop(dir, ...args);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  expect(await lockedVersions(dir, "dep-loop-entry")).toStrictEqual(["1.0.0"]);
  expect(await lockedVersions(dir, "dep-loop-exit")).toStrictEqual(["1.0.0"]);
});

test.concurrent.each([
  ["bare", []],
  ["no-deps", ["no-deps"]],
])("a bundled edge is not re-resolved even when its range would allow it (%s)", async (_, args) => {
  const dir = await setup({ "package.json": pkgJson({ "bundled-1": "1.0.0" }) });
  const pinned = await lockText(dir);
  expect(pinned).toContain('"bundled-1/no-deps": ["no-deps@1.0.0"');
  expect(pinned.split('{ "dependencies": { "no-deps": "1.0.0" } }')).toHaveLength(2);
  const widened = pinned.replace(
    '{ "dependencies": { "no-deps": "1.0.0" } }',
    '{ "dependencies": { "no-deps": "^1.0.0" } }',
  );
  await write(join(dir, "bun.lock"), widened);
  const { stdout, stderr, exitCode } = await run(dir, "update", ...args);
  expect(stdout).not.toContain("updating:");
  expect(stderr).not.toContain("error:");
  expect(await lockText(dir)).toBe(widened);
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);
  expect(exitCode).toBe(0);
});

// pkg1 and pkg2 declare the same range; only the workspace `bun update` runs in gets its package.json rewritten.
test.concurrent("in a workspace, `bun update` from one member also re-points a sibling's identical range", async () => {
  const root = { name: "root", workspaces: ["packages/*"] };
  const member = (name: string, range: string) => ({ name, version: "1.0.0", dependencies: { "no-deps": range } });
  const dir = await setup({
    "package.json": root,
    "packages/pkg1/package.json": member("pkg1", "1.0.0"),
    "packages/pkg2/package.json": member("pkg2", "1.0.0"),
  });
  await write(join(dir, "packages/pkg2/package.json"), stringify(member("pkg2", "~1.0.0")));
  await reinstall(dir, member("pkg1", "~1.0.0"), {}, "packages/pkg1");
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.0"]);

  const { stderr, exitCode } = await run(join(dir, "packages/pkg1"), "update");
  expect(stderr).not.toContain("error:");
  expect(await packageJsonOf(dir)).toStrictEqual(root);
  expect(await packageJsonOf(dir, "packages/pkg1")).toStrictEqual(member("pkg1", "~1.0.1"));
  expect(await packageJsonOf(dir, "packages/pkg2")).toStrictEqual(member("pkg2", "~1.0.0"));
  const { workspaces } = await lock(dir);
  expect(workspaces["packages/pkg1"].dependencies).toStrictEqual({ "no-deps": "~1.0.1" });
  expect(workspaces["packages/pkg2"].dependencies).toStrictEqual({ "no-deps": "~1.0.0" });
  expect(await lockedVersions(dir, "no-deps")).toStrictEqual(["1.0.1"]);
  expect(await installedVersion(dir, "no-deps")).toBe("1.0.1");
  await install(dir, "--frozen-lockfile");
  expect(exitCode).toBe(0);
});

type Manifests = Record<string, Record<string, { dependencies?: Record<string, string> }>>;

// Serves one manifest per name from memory; verdaccio has no parent whose newer version keeps a range on the same child.
async function serveRegistry(manifests: Manifests) {
  const tarballs = new Map<string, Uint8Array>();
  for (const [name, versions] of Object.entries(manifests)) {
    for (const [version, extra] of Object.entries(versions)) {
      const archive = new Bun.Archive(
        { "package/package.json": JSON.stringify({ name, version, ...extra }) },
        { compress: "gzip" },
      );
      tarballs.set(`/${name}-${version}.tgz`, await archive.bytes());
    }
  }
  return Bun.serve({
    port: 0,
    fetch(request) {
      const { origin, pathname } = new URL(request.url);
      const tarball = tarballs.get(pathname);
      if (tarball) return new Response(tarball);
      const name = pathname.slice(1);
      const entry = manifests[name];
      if (!entry) return new Response("not found", { status: 404 });
      const versions: Json = {};
      for (const [version, extra] of Object.entries(entry)) {
        versions[version] = { name, version, dist: { tarball: `${origin}/${name}-${version}.tgz` }, ...extra };
      }
      const latest = Object.keys(entry).sort(Bun.semver.order).at(-1);
      return Response.json({ name, versions, "dist-tags": { latest } });
    },
  });
}

test.concurrent("`bun update <name>` leaves the named package's own dependencies where they are", async () => {
  using server = await serveRegistry({
    parent: { "1.0.0": { dependencies: { leaf: "^1.0.0" } }, "1.1.0": { dependencies: { leaf: "^1.0.0" } } },
    leaf: { "1.0.0": {}, "1.1.0": {} },
  });
  using tmp = tempDir("update-named-children-", {
    "package.json": stringify(pkgJson({ parent: "1.0.0", leaf: "1.0.0" })),
  });
  const dir = String(tmp);
  await write(
    join(dir, "bunfig.toml"),
    Bun.TOML.stringify({
      install: { cache: join(dir, ".bun-cache"), registry: server.url.href, saveTextLockfile: true, linker: "hoisted" },
    }),
  );
  await install(dir);
  await reinstall(dir, pkgJson({ parent: "^1.0.0" }));
  expect(await lockedVersions(dir, "parent")).toStrictEqual(["1.0.0"]);
  expect(await lockedVersions(dir, "leaf")).toStrictEqual(["1.0.0"]);

  const named = await run(dir, "update", "parent");
  expect(named.stderr).not.toContain("error:");
  expect(await packageJsonOf(dir)).toStrictEqual(pkgJson({ parent: "^1.1.0" }));
  expect(await lockedVersions(dir, "parent")).toStrictEqual(["1.1.0"]);
  expect(await lockedVersions(dir, "leaf")).toStrictEqual(["1.0.0"]);
  expect(await installedVersion(dir, "parent")).toBe("1.1.0");
  expect(await installedVersion(dir, "leaf")).toBe("1.0.0");
  await install(dir, "--frozen-lockfile");
  expect(named.exitCode).toBe(0);

  const bare = await run(dir, "update");
  expect(bare.stdout).toContain("  leaf@1.0.0 → 1.1.0\n");
  expect(bare.stderr).not.toContain("error:");
  expect(await packageJsonOf(dir)).toStrictEqual(pkgJson({ parent: "^1.1.0" }));
  expect(await lockedVersions(dir, "leaf")).toStrictEqual(["1.1.0"]);
  expect(await installedVersion(dir, "leaf")).toBe("1.1.0");
  await install(dir, "--frozen-lockfile");
  expect(bare.exitCode).toBe(0);
});
