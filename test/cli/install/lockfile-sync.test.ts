// https://github.com/oven-sh/bun/issues/13388
// After `bun add`, `bun remove`, or any flavor of `bun update`, package.json
// and bun.lock's root workspace entry must agree on every dependency literal
// and the very next `bun install` must have nothing left to save.
import { Archive } from "bun";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { rm } from "fs/promises";
import { bunEnv, bunExe, tempDir, tempDirWithFiles } from "harness";
import { join } from "path";

setDefaultTimeout(1000 * 60 * 5);

// ---------------------------------------------------------------------------
// In-process npm registry. Each project claims an id; its version map is
// mutable so a test can publish a new version between steps.
// ---------------------------------------------------------------------------

type Registry = Record<string, { versions: string[]; latest: string }>;

let server: ReturnType<typeof Bun.serve>;
let tgzDir: string;
let linkDir: string;
// `link:<name>` always resolves against the global link dir, so point
// `BUN_INSTALL` at a directory owned by this file and register a single
// `link-dep` package there once. `env` is what every spawned bun uses.
let env: NodeJS.Dict<string>;
let nextProjectId = 0;
const registries = new Map<string, Registry>();
// Memoize the write promise, not the file, so two concurrent requests for the
// same tarball never race a partial write.
const tarballs = new Map<string, Promise<string>>();

function tarball(name: string, version: string): Promise<string> {
  const key = `${name}-${version}.tgz`;
  let promise = tarballs.get(key);
  if (!promise) {
    const path = join(tgzDir, key);
    promise = Archive.write(
      path,
      { "package/package.json": JSON.stringify({ name, version }) },
      { compress: "gzip" },
    ).then(() => path);
    tarballs.set(key, promise);
  }
  return promise;
}

beforeAll(async () => {
  tgzDir = tempDirWithFiles("lockfile-sync-tgz", {});
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      // /<project-id>/<package-name> or /<project-id>/<name>-<version>.tgz
      const { pathname, origin } = new URL(req.url);
      const [, id, ...rest] = pathname.split("/");
      const registry = registries.get(id);
      if (!registry) return new Response(`unknown project ${id}`, { status: 404 });
      const tail = decodeURIComponent(rest.join("/"));

      const tgz = tail.match(/^(.*)-(\d+\.\d+\.\d+)\.tgz$/);
      if (tgz) return new Response(Bun.file(await tarball(tgz[1], tgz[2])));

      const entry = registry[tail];
      if (!entry) return new Response(`no package ${tail}`, { status: 404 });
      const versions: Record<string, object> = {};
      for (const version of entry.versions) {
        versions[version] = {
          name: tail,
          version,
          dist: { tarball: `${origin}/${id}/${tail}-${version}.tgz` },
        };
      }
      return Response.json({ name: tail, versions, "dist-tags": { latest: entry.latest } });
    },
  });

  linkDir = tempDirWithFiles("lockfile-sync-link", {
    install: {},
    "link-dep": {
      "package.json": JSON.stringify({ name: "link-dep", version: "1.0.0" }),
      // Never reach a real registry, even though `bun link` should not need one.
      "bunfig.toml": `[install]\nregistry = "${server.url}none/"\n`,
    },
  });
  env = { ...bunEnv, BUN_INSTALL: linkDir };
  await runOk(join(linkDir, "link-dep"), "link");
});

afterAll(async () => {
  server.stop(true);
  await Promise.all([tgzDir, linkDir].map(directory => rm(directory, { recursive: true, force: true })));
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GROUPS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;
type Group = (typeof GROUPS)[number];
type Deps = Record<string, string>;
type Groups = Partial<Record<Group, Deps>>;

// The flag that routes `bun add` into each group. Prod is the default.
const ADD_FLAG: Record<Group, string[]> = {
  dependencies: [],
  devDependencies: ["--dev"],
  optionalDependencies: ["--optional"],
  peerDependencies: ["--peer"],
};

async function packageJson(projectDir: string): Promise<any> {
  return await Bun.file(join(projectDir, "package.json")).json();
}

/** The root package's entry in bun.lock (name + the four dependency groups). */
async function lockfileRoot(projectDir: string): Promise<any> {
  // bun.lock is JSONC (valid JSON plus trailing commas).
  return Bun.JSONC.parse(await Bun.file(join(projectDir, "bun.lock")).text()).workspaces[""];
}

async function run(projectDir: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: projectDir,
    // Per-project cache. The local tarball hashes to one cache slot, and
    // concurrent projects extracting it into a shared cache race on Windows
    // (ENOTEMPTY moving the temp dir into place, ENOENT for the reader).
    env: { ...env, BUN_INSTALL_CACHE_DIR: join(projectDir, ".bun-cache") },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

async function runOk(projectDir: string, ...args: string[]) {
  const result = await run(projectDir, ...args);
  if (result.exitCode !== 0 || result.stderr.includes("error:")) {
    throw new Error(
      `bun ${args.join(" ")} exited with ${result.exitCode}\n--- stderr ---\n${result.stderr}\n--- stdout ---\n${result.stdout}`,
    );
  }
  return result;
}

/**
 * The invariant every cell must satisfy: after the operation, `bun install`
 * has nothing left to do. A disagreement between package.json and bun.lock
 * (issue #13388) always surfaces here as a re-saved lockfile.
 */
async function expectNextInstallIsNoop(projectDir: string) {
  const before = await Bun.file(join(projectDir, "bun.lock")).text();
  const { stderr } = await runOk(projectDir, "install");
  expect(stderr).not.toContain("Saved lockfile");
  expect(await Bun.file(join(projectDir, "bun.lock")).text()).toBe(before);
}

/**
 * For single-group projects: package.json holds exactly `groups`, bun.lock's
 * root entry holds the same literals, and the next install is a no-op.
 * (bun.lock dedups a multi-group name, so those assert each file alone.)
 */
async function expectSettled(projectDir: string, groups: Groups, extraPackageJson: object = {}) {
  expect(await packageJson(projectDir)).toEqual({ name: "root", ...extraPackageJson, ...groups });
  expect(await lockfileRoot(projectDir)).toEqual({ name: "root", ...groups });
  await expectNextInstallIsNoop(projectDir);
}

// ---------------------------------------------------------------------------
// Project factory. Every project is a hermetic tempDir laying out one target
// per non-npm protocol (folder-target, packages/ws-dep, a local .tgz, the one
// globally linked link-dep) plus its own namespace on the registry server.
// ---------------------------------------------------------------------------

interface Project extends AsyncDisposable {
  dir: string;
  /** Mutable per-project registry; reassigning an entry is the "publish" step. */
  registry: Registry;
  /** Absolute registry URL for a path, e.g. url("tgz-remote-dep-1.0.0.tgz"). */
  url: (path: string) => string;
  writePackageJson: (json: object) => Promise<number>;
}

const DEFAULT_REGISTRY: Registry = {
  "pkg-one": { versions: ["1.0.0"], latest: "1.0.0" },
  "pkg-two": { versions: ["2.0.0"], latest: "2.0.0" },
};

async function makeProject(
  pkg: object,
  registry: Registry = DEFAULT_REGISTRY,
  options: { exact?: boolean } = {},
): Promise<Project> {
  const id = `p${++nextProjectId}`;
  const reg = structuredClone(registry);
  registries.set(id, reg);
  const url = (path: string) => `${server.url}${id}/${path}`;

  // The manifest cache is off so a registry mutation between steps is always
  // re-observed; the extracted-package cache is per project (see `run`).
  const base = tempDir(`lockfile-sync-${id}`, {
    "bunfig.toml": [
      "[install]",
      `registry = "${server.url}${id}/"`,
      "saveTextLockfile = true",
      'linker = "hoisted"',
      ...(options.exact ? ["exact = true"] : []),
      "",
      "[install.cache]",
      "disableManifest = true",
      "",
    ].join("\n"),
    "package.json": JSON.stringify(pkg),
    "folder-target": { "package.json": JSON.stringify({ name: "folder-dep", version: "1.0.0" }) },
    packages: { "ws-dep": { "package.json": JSON.stringify({ name: "ws-dep", version: "1.0.0" }) } },
  });
  const dir = String(base);
  await Bun.write(join(dir, "tgz-local-dep-1.0.0.tgz"), Bun.file(await tarball("tgz-local-dep", "1.0.0")));

  return {
    dir,
    registry: reg,
    url,
    writePackageJson: (json: object) => Bun.write(join(dir, "package.json"), JSON.stringify(json)),
    async [Symbol.asyncDispose]() {
      registries.delete(id);
      await base[Symbol.asyncDispose]();
    },
  };
}

/**
 * All six protocols in one group: two plain npm dependencies, an npm alias,
 * and the five non-npm literals that `bun update` must never rewrite.
 */
const SINK_NAMES = [
  "pkg-one",
  "pkg-two",
  "pkg-one-alias",
  "folder-dep",
  "link-dep",
  "tgz-local-dep",
  "tgz-remote-dep",
  "ws-dep",
] as const;

function sinkDeps(project: Project): Deps {
  return {
    "pkg-one": "^1.0.0",
    "pkg-two": "~2.0.0",
    "pkg-one-alias": "npm:pkg-one@~1.0.0",
    "folder-dep": "file:./folder-target",
    "link-dep": "link:link-dep",
    "tgz-local-dep": "file:./tgz-local-dep-1.0.0.tgz",
    "tgz-remote-dep": project.url("tgz-remote-dep-1.0.0.tgz"),
    "ws-dep": "workspace:*",
  };
}

const SINK_PACKAGE_JSON_EXTRA = { workspaces: ["packages/*"] };

async function makeSink(group: Group): Promise<Project> {
  const project = await makeProject({});
  await project.writePackageJson({ name: "root", ...SINK_PACKAGE_JSON_EXTRA, [group]: sinkDeps(project) });
  await runOk(project.dir, "install");
  return project;
}

/** The three update spellings. `names` is what the positional form passes. */
function updateModes(names: string[]) {
  return [
    { mode: "bun update", args: ["update"], latest: false, positional: false },
    { mode: "bun update --latest", args: ["update", "--latest"], latest: true, positional: false },
    { mode: `bun update ${names.join(" ")}`, args: ["update", ...names], latest: false, positional: true },
  ];
}

// ===========================================================================
// bun update x group x npm resolution delta, with every non-npm protocol
// riding along in the same group as the negative contract.
// ===========================================================================

// Where `pkg-one` (`^1.0.0`) and its alias (`npm:pkg-one@~1.0.0`) land after
// the registry moves. `latest` applies only to `--latest`; a root peer
// dependency only moves under `--latest` (its deferred resolution is kept).
const UPDATE_DELTAS: { delta: string; publish: (registry: Registry) => void; plain: Deps; latest: Deps }[] = [
  {
    delta: "same: registry unchanged",
    publish: () => {},
    plain: { "pkg-one": "^1.0.0", "pkg-one-alias": "npm:pkg-one@~1.0.0" },
    latest: { "pkg-one": "^1.0.0", "pkg-one-alias": "npm:pkg-one@~1.0.0" },
  },
  {
    delta: "greater, in range: 1.0.5 published",
    publish: registry => {
      registry["pkg-one"] = { versions: ["1.0.0", "1.0.5"], latest: "1.0.5" };
    },
    plain: { "pkg-one": "^1.0.5", "pkg-one-alias": "npm:pkg-one@~1.0.5" },
    latest: { "pkg-one": "^1.0.5", "pkg-one-alias": "npm:pkg-one@~1.0.5" },
  },
  {
    delta: "greater, new major: 1.2.0 and 2.5.0 published",
    publish: registry => {
      registry["pkg-one"] = { versions: ["1.0.0", "1.2.0", "2.5.0"], latest: "2.5.0" };
    },
    // Plain update stays inside each literal's own range (so the `~1.0.0`
    // alias does not move at all); --latest follows the dist-tag everywhere.
    plain: { "pkg-one": "^1.2.0", "pkg-one-alias": "npm:pkg-one@~1.0.0" },
    latest: { "pkg-one": "^2.5.0", "pkg-one-alias": "npm:pkg-one@~2.5.0" },
  },
  {
    delta: "lower: latest dist-tag moved down to 0.5.0",
    publish: registry => {
      registry["pkg-one"] = { versions: ["0.5.0", "1.0.0"], latest: "0.5.0" };
    },
    // 1.0.0 still satisfies every range, so only --latest downgrades.
    plain: { "pkg-one": "^1.0.0", "pkg-one-alias": "npm:pkg-one@~1.0.0" },
    latest: { "pkg-one": "^0.5.0", "pkg-one-alias": "npm:pkg-one@~0.5.0" },
  },
];

const UNCHANGED_NPM: Deps = { "pkg-one": "^1.0.0", "pkg-one-alias": "npm:pkg-one@~1.0.0" };

describe("bun update keeps package.json and bun.lock in sync", () => {
  for (const group of GROUPS) {
    for (const { mode, args, latest } of updateModes(["pkg-one", "pkg-two", "pkg-one-alias"])) {
      for (const { delta, publish, ...expected } of UPDATE_DELTAS) {
        test.concurrent(`${group} / ${mode} / ${delta}`, async () => {
          await using project = await makeSink(group);
          publish(project.registry);
          await runOk(project.dir, ...args);

          const moved = latest ? expected.latest : group === "peerDependencies" ? UNCHANGED_NPM : expected.plain;
          await expectSettled(project.dir, { [group]: { ...sinkDeps(project), ...moved } }, SINK_PACKAGE_JSON_EXTRA);
        });
      }
    }
  }
});

// ===========================================================================
// bun update on a dependency that is in package.json but not in bun.lock yet
// ("new" resolution). Hand-edit package.json after the first install.
// ===========================================================================

describe("bun update resolves a dependency that is not in the lockfile yet", () => {
  for (const group of GROUPS) {
    for (const { mode, args, latest } of updateModes(["pkg-two"])) {
      test.concurrent(`${group} / ${mode}`, async () => {
        await using project = await makeProject(
          { name: "root", [group]: { "pkg-one": "^1.0.0" } },
          {
            "pkg-one": { versions: ["1.0.0"], latest: "1.0.0" },
            "pkg-two": { versions: ["2.0.0", "2.3.0"], latest: "2.3.0" },
          },
        );
        await runOk(project.dir, "install");
        await project.writePackageJson({ name: "root", [group]: { "pkg-one": "^1.0.0", "pkg-two": "~2.0.0" } });

        await runOk(project.dir, ...args);
        // pkg-two resolves fresh; only --latest jumps it out of ~2.0.0.
        const pkgTwo = latest ? "~2.3.0" : "~2.0.0";
        await expectSettled(project.dir, { [group]: { "pkg-one": "^1.0.0", "pkg-two": pkgTwo } });
      });
    }
  }
});

// ===========================================================================
// `bun update <name>` on a non-npm dependency: the literal must come through
// untouched in both files. (`--latest <non-npm-name>` fails to resolve the
// name from the npm registry before touching either file; not covered here.)
// ===========================================================================

describe("bun update <name> leaves a non-npm dependency alone", () => {
  for (const name of ["folder-dep", "link-dep", "tgz-local-dep", "tgz-remote-dep", "ws-dep"]) {
    test.concurrent(name, async () => {
      await using project = await makeSink("dependencies");
      await runOk(project.dir, "update", name);
      await expectSettled(project.dir, { dependencies: sinkDeps(project) }, SINK_PACKAGE_JSON_EXTRA);
    });
  }
});

// ===========================================================================
// The rewritten literal keeps the user's pin level: an exact pin stays exact,
// `~` stays `~`, everything looser becomes `^`. Installed at latest=1.0.0,
// then 1.5.0 and 3.0.0 are published and `latest` moves to 3.0.0.
// ===========================================================================

const PIN_STYLES: { pin: string; plain: string; latest: string; positional: string }[] = [
  { pin: "^1.0.0", plain: "^1.5.0", latest: "^3.0.0", positional: "^1.5.0" },
  { pin: "~1.0.0", plain: "~1.0.5", latest: "~3.0.0", positional: "~1.0.5" },
  // An exact pin is never moved by a plain `bun update`; `--latest` keeps it exact.
  { pin: "1.0.0", plain: "1.0.0", latest: "3.0.0", positional: "1.0.0" },
  { pin: "=1.0.0", plain: "=1.0.0", latest: "3.0.0", positional: "1.0.0" },
  { pin: "v1.0.0", plain: "v1.0.0", latest: "3.0.0", positional: "1.0.0" },
  { pin: ">=1.0.0", plain: "^3.0.0", latest: "^3.0.0", positional: "^3.0.0" },
  { pin: "1.x", plain: "^1.5.0", latest: "^3.0.0", positional: "^1.5.0" },
  { pin: "1.0.x", plain: "^1.0.5", latest: "^3.0.0", positional: "^1.0.5" },
  { pin: "1", plain: "^1.5.0", latest: "^3.0.0", positional: "^1.5.0" },
  { pin: "1.0", plain: "~1.0.5", latest: "~3.0.0", positional: "~1.0.5" },
  { pin: "*", plain: "^3.0.0", latest: "^3.0.0", positional: "^3.0.0" },
  // A dist-tag literal is only re-resolved when named or under --latest.
  { pin: "latest", plain: "latest", latest: "^3.0.0", positional: "^3.0.0" },
  { pin: "", plain: "", latest: "^3.0.0", positional: "^3.0.0" },
];

describe("bun update preserves the pin level of the original literal", () => {
  for (const { pin, ...outcomes } of PIN_STYLES) {
    for (const { mode, args, latest, positional } of updateModes(["pkg-one"])) {
      const expected = latest ? outcomes.latest : positional ? outcomes.positional : outcomes.plain;
      test.concurrent(`"${pin}" / ${mode} -> "${expected}"`, async () => {
        await using project = await makeProject(
          { name: "root", dependencies: { "pkg-one": pin } },
          { "pkg-one": { versions: ["1.0.0", "1.0.5", "1.2.0"], latest: "1.0.0" } },
        );
        await runOk(project.dir, "install");
        project.registry["pkg-one"] = {
          versions: ["1.0.0", "1.0.5", "1.2.0", "1.5.0", "3.0.0"],
          latest: "3.0.0",
        };

        await runOk(project.dir, ...args);
        await expectSettled(project.dir, { dependencies: { "pkg-one": expected } });
      });
    }
  }
});

// ===========================================================================
// install.exact = true forces every rewritten literal to the bare resolved
// version, including the version part of an npm alias.
// ===========================================================================

describe("bun update with install.exact", () => {
  const cases: { name: string; args: string[]; exact: Deps; loose: Deps }[] = [
    {
      name: "bun update",
      args: ["update"],
      exact: { "pkg-one": "1.0.5", "pkg-one-alias": "npm:pkg-one@1.0.5" },
      loose: { "pkg-one": "~1.0.5", "pkg-one-alias": "npm:pkg-one@~1.0.5" },
    },
    {
      name: "bun update --latest",
      args: ["update", "--latest"],
      exact: { "pkg-one": "1.0.5", "pkg-one-alias": "npm:pkg-one@1.0.5" },
      loose: { "pkg-one": "~1.0.5", "pkg-one-alias": "npm:pkg-one@~1.0.5" },
    },
    {
      // Positional: only the named dependency moves, the alias is untouched.
      name: "bun update pkg-one",
      args: ["update", "pkg-one"],
      exact: { "pkg-one": "1.0.5", "pkg-one-alias": "npm:pkg-one@~1.0.0" },
      loose: { "pkg-one": "~1.0.5", "pkg-one-alias": "npm:pkg-one@~1.0.0" },
    },
  ];
  for (const exact of [false, true]) {
    for (const { name, args, ...literals } of cases) {
      test.concurrent(`exact=${exact} / ${name}`, async () => {
        await using project = await makeProject(
          { name: "root", dependencies: { "pkg-one": "~1.0.0", "pkg-one-alias": "npm:pkg-one@~1.0.0" } },
          { "pkg-one": { versions: ["1.0.0"], latest: "1.0.0" } },
          { exact },
        );
        await runOk(project.dir, "install");
        project.registry["pkg-one"] = { versions: ["1.0.0", "1.0.5"], latest: "1.0.5" };

        await runOk(project.dir, ...args);
        await expectSettled(project.dir, { dependencies: literals[exact ? "exact" : "loose"] });
      });
    }
  }
});

// ===========================================================================
// Same name in two dependency groups: `bun update` moves exactly one group in
// package.json and bun.lock must leave the other group's literal alone. An
// optional+prod/dev name serializes once, so each file is asserted separately.
// ===========================================================================

describe("bun update moves only one group when a name is in two", () => {
  const pairs: { groups: [Group, Group]; noArgsMoves: Group; positionalMoves: Group }[] = [
    { groups: ["dependencies", "devDependencies"], noArgsMoves: "devDependencies", positionalMoves: "dependencies" },
    {
      groups: ["dependencies", "optionalDependencies"],
      noArgsMoves: "optionalDependencies",
      positionalMoves: "dependencies",
    },
    { groups: ["dependencies", "peerDependencies"], noArgsMoves: "dependencies", positionalMoves: "dependencies" },
    {
      groups: ["devDependencies", "optionalDependencies"],
      noArgsMoves: "optionalDependencies",
      positionalMoves: "devDependencies",
    },
    {
      groups: ["devDependencies", "peerDependencies"],
      noArgsMoves: "devDependencies",
      positionalMoves: "devDependencies",
    },
    {
      groups: ["optionalDependencies", "peerDependencies"],
      noArgsMoves: "optionalDependencies",
      positionalMoves: "optionalDependencies",
    },
  ];
  for (const { groups, noArgsMoves, positionalMoves } of pairs) {
    for (const { mode, args, positional } of updateModes(["pkg-one"])) {
      test.concurrent(`${groups.join(" + ")} / ${mode}`, async () => {
        await using project = await makeProject(
          { name: "root", [groups[0]]: { "pkg-one": "~1.0.0" }, [groups[1]]: { "pkg-one": "~1.0.0" } },
          { "pkg-one": { versions: ["1.0.0"], latest: "1.0.0" } },
        );
        await runOk(project.dir, "install");
        project.registry["pkg-one"] = { versions: ["1.0.0", "1.0.5"], latest: "1.0.5" };

        await runOk(project.dir, ...args);
        const moved = positional ? positionalMoves : noArgsMoves;
        const expected = Object.fromEntries(
          groups.map(group => [group, { "pkg-one": group === moved ? "~1.0.5" : "~1.0.0" }]),
        );
        expect(await packageJson(project.dir)).toEqual({ name: "root", ...expected });
        const root = await lockfileRoot(project.dir);
        for (const group of groups) {
          if (root[group] !== undefined) expect({ [group]: root[group] }).toEqual({ [group]: expected[group] });
        }
        await expectNextInstallIsNoop(project.dir);
      });
    }
  }
});

// ===========================================================================
// bun add: every group flag x every protocol, brand new to the project.
// ===========================================================================

type AddCase = { spec: string; key: string; literal: string | ((project: Project) => string) };

const ADD_NPM_CASES: AddCase[] = [
  // `bun add name` / `@latest` resolve the dist-tag and write `^resolved`.
  { spec: "pkg-one", key: "pkg-one", literal: "^1.1.0" },
  { spec: "pkg-one@latest", key: "pkg-one", literal: "^1.1.0" },
  // An explicit range or version is written verbatim.
  { spec: "pkg-one@^1.0.0", key: "pkg-one", literal: "^1.0.0" },
  { spec: "pkg-one@~1.0.0", key: "pkg-one", literal: "~1.0.0" },
  { spec: "pkg-one@1.0.0", key: "pkg-one", literal: "1.0.0" },
  { spec: "pkg-one@1", key: "pkg-one", literal: "1" },
  { spec: "pkg-one@*", key: "pkg-one", literal: "*" },
  { spec: "pkg-one-alias@npm:pkg-one@~1.0.0", key: "pkg-one-alias", literal: "npm:pkg-one@~1.0.0" },
];
const ADD_NON_NPM_CASES: AddCase[] = [
  // The key comes from the target's package.json name; the literal is kept
  // as written (a bare relative path does not gain a `file:` prefix).
  { spec: "./folder-target", key: "folder-dep", literal: "./folder-target" },
  { spec: "file:./folder-target", key: "folder-dep", literal: "file:./folder-target" },
  { spec: "link-dep@link:link-dep", key: "link-dep", literal: "link:link-dep" },
  { spec: "./tgz-local-dep-1.0.0.tgz", key: "tgz-local-dep", literal: "./tgz-local-dep-1.0.0.tgz" },
  { spec: "__REMOTE_TGZ__", key: "tgz-remote-dep", literal: project => project.url("tgz-remote-dep-1.0.0.tgz") },
  { spec: "ws-dep@workspace:*", key: "ws-dep", literal: "workspace:*" },
];

describe("bun add writes the same literal into package.json and bun.lock", () => {
  for (const group of GROUPS) {
    for (const { spec, key, literal } of [...ADD_NPM_CASES, ...ADD_NON_NPM_CASES]) {
      test.concurrent(`${group} / bun add ${spec}`, async () => {
        await using project = await makeProject(
          { name: "root", workspaces: ["packages/*"], dependencies: { "pkg-two": "^2.0.0" } },
          {
            "pkg-one": { versions: ["1.0.0", "1.1.0"], latest: "1.1.0" },
            "pkg-two": { versions: ["2.0.0"], latest: "2.0.0" },
          },
        );
        await runOk(project.dir, "install");

        const resolvedSpec = spec === "__REMOTE_TGZ__" ? project.url("tgz-remote-dep-1.0.0.tgz") : spec;
        await runOk(project.dir, "add", resolvedSpec, ...ADD_FLAG[group]);

        const added = { [key]: typeof literal === "function" ? literal(project) : literal };
        const groups: Groups =
          group === "dependencies"
            ? { dependencies: { "pkg-two": "^2.0.0", ...added } }
            : { dependencies: { "pkg-two": "^2.0.0" }, [group]: added };
        await expectSettled(project.dir, groups, SINK_PACKAGE_JSON_EXTRA);
      });
    }
  }
});

// ===========================================================================
// bun add when the package is already installed: the new spec may resolve to
// the same, a greater, or a lower version than the lockfile has.
// ===========================================================================

const READD_CASES: { delta: string; spec: string; literal: string }[] = [
  { delta: "same version, exact", spec: "pkg-one@1.0.0", literal: "1.0.0" },
  { delta: "same range", spec: "pkg-one@^1.0.0", literal: "^1.0.0" },
  { delta: "greater range", spec: "pkg-one@^2.0.0", literal: "^2.0.0" },
  { delta: "greater exact", spec: "pkg-one@2.0.0", literal: "2.0.0" },
  { delta: "lower exact", spec: "pkg-one@0.5.0", literal: "0.5.0" },
  { delta: "lower range", spec: "pkg-one@~0.5.0", literal: "~0.5.0" },
  { delta: "re-add with no version jumps to latest", spec: "pkg-one", literal: "^2.0.0" },
];

describe("bun add over an existing install", () => {
  for (const group of GROUPS) {
    for (const { delta, spec, literal } of READD_CASES) {
      test.concurrent(`${group} / bun add ${spec} / ${delta}`, async () => {
        await using project = await makeProject(
          { name: "root", [group]: { "pkg-one": "^1.0.0" } },
          { "pkg-one": { versions: ["0.5.0", "1.0.0", "2.0.0"], latest: "2.0.0" } },
        );
        await runOk(project.dir, "install");
        await runOk(project.dir, "add", spec, ...ADD_FLAG[group]);
        await expectSettled(project.dir, { [group]: { "pkg-one": literal } });
      });
    }
  }
});

// ===========================================================================
// bun remove: the removed name is gone from both files and every other
// protocol's literal survives unchanged.
// ===========================================================================

describe("bun remove leaves the remaining dependencies untouched", () => {
  for (const group of GROUPS) {
    for (const name of SINK_NAMES) {
      test.concurrent(`${group} / bun remove ${name}`, async () => {
        await using project = await makeSink(group);
        await runOk(project.dir, "remove", name);

        const remaining = { ...sinkDeps(project) };
        delete remaining[name];
        await expectSettled(project.dir, { [group]: remaining }, SINK_PACKAGE_JSON_EXTRA);
      });
    }
  }
});

// ===========================================================================
// Bumping the version inside a folder or workspace target must never rewrite
// the root literal, and the lockfile must still be stable. (A `link:` target's
// version is never recorded in bun.lock, so there is nothing to vary for it.)
// ===========================================================================

describe("bun update after a non-npm target's version changes", () => {
  const targets: Record<string, (project: Project, version: string) => Promise<unknown>> = {
    "folder-dep": (project, version) =>
      Bun.write(join(project.dir, "folder-target", "package.json"), JSON.stringify({ name: "folder-dep", version })),
    "ws-dep": (project, version) =>
      Bun.write(join(project.dir, "packages", "ws-dep", "package.json"), JSON.stringify({ name: "ws-dep", version })),
  };
  for (const [name, bump] of Object.entries(targets)) {
    // 9.9.9 is greater than the installed 1.0.0, 0.0.1 is lower.
    for (const version of ["9.9.9", "0.0.1"]) {
      for (const args of [["install"], ["update"], ["update", "--latest"], ["update", name]]) {
        test.concurrent(`${name} -> ${version} / bun ${args.join(" ")}`, async () => {
          await using project = await makeSink("dependencies");
          await bump(project, version);
          await runOk(project.dir, ...args);
          await expectSettled(project.dir, { dependencies: sinkDeps(project) }, SINK_PACKAGE_JSON_EXTRA);
        });
      }
    }
  }
});
