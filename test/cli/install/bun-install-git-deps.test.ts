// Tests for installing git dependencies that live in ONE repository as
// multiple branches (issue #35420), `git+file://` dependencies, and
// tarball-URL / `github:` dependencies that appear both directly and
// transitively (issues #10915, #8501, #11348, #28284). Everything is local:
// a bare repo on disk (served over git's dumb HTTP protocol by Bun.serve
// when an http URL is needed) or tarballs built in memory.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isLinux, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { dirname, join } from "path";
import { pathToFileURL } from "url";

const gitEnv = {
  ...bunEnv,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

async function run(cwd: string, cmd: string[], what: string, stdin?: string) {
  await using proc = Bun.spawn({
    cmd,
    cwd,
    env: gitEnv,
    stdin: stdin === undefined ? "ignore" : Buffer.from(stdin),
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) {
    throw new Error(`${what} failed in ${cwd}:\n${stderr}`);
  }
}

function git(cwd: string, ...args: string[]) {
  return run(cwd, ["git", ...args], `git ${args.join(" ")}`);
}

// The fixture packages are `@scope/pkg-<letter>`. Each one's branch or tarball
// is named `pkg-<letter>`, and so is the marker its index.js exports, which is
// how a test tells what got installed (a later commit exports its own marker).
const letters = "abcdefghijklmnop".split("");
const nameOf = (l: string) => `@scope/pkg-${l}`;
const markers = (installed: string[]) => Object.fromEntries(installed.map(l => [nameOf(l), `pkg-${l}`]));

interface BranchPackage {
  name?: string;
  branch: string;
  dependencies?: Record<string, string>;
  /** Files committed next to package.json; an `index.js` entry replaces the default one. */
  files?: Record<string, string>;
}

function indexJs(marker: string) {
  return `module.exports = ${JSON.stringify(marker)};\n`;
}

function packageFiles(name: string | undefined, marker: string, dependencies?: Record<string, string>) {
  return {
    "package.json": JSON.stringify({ name, version: "1.0.0", dependencies }),
    "index.js": indexJs(marker),
  };
}

interface Commit {
  /** The full name of the ref the commit lands on: `refs/heads/<branch>` or `refs/tags/<tag>`. */
  ref: string;
  /**
   * The ref or commit the new commit extends, as the repo has it before this
   * call; its files carry over unless `files` replaces them. Without it the
   * commit has no parent.
   */
  from?: string;
  message: string;
  files: Record<string, string>;
}

function fastImportData(text: string) {
  return `data ${Buffer.byteLength(text)}\n${text}\n`;
}

// Writes the commits to the bare repo with a single `git fast-import`, so a
// fixture costs the same two processes however many refs it has, then
// regenerates the static files that dumb HTTP clients read.
async function commitTo(bare: string, commits: Commit[]) {
  let stream = "";
  for (const { ref, from, message, files } of commits) {
    stream += `commit ${ref}\n`;
    stream += `committer ${gitEnv.GIT_COMMITTER_NAME} <${gitEnv.GIT_COMMITTER_EMAIL}> 0 +0000\n`;
    stream += fastImportData(message);
    // `^0` makes fast-import look the name up in the repo instead of in this
    // stream, so a commit can extend the very ref it updates.
    if (from) stream += `from ${from}^0\n`;
    for (const [path, contents] of Object.entries(files)) {
      stream += `M 100644 inline ${path}\n${fastImportData(contents)}`;
    }
    stream += "\n";
  }
  await run(bare, ["git", "fast-import", "--quiet"], "git fast-import", stream);
  await git(bare, "update-server-info");
}

// Creates `<root>/<repoName>`, a bare repo with one branch per package (a
// single root commit each), ready to be served over dumb HTTP.
async function makeSharedRepo(
  root: string,
  packages: BranchPackage[],
  repoName: string = "shared-repo.git",
): Promise<string> {
  const bare = join(root, repoName);
  await git(root, "init", "-q", "--bare", repoName);
  await commitTo(
    bare,
    packages.map(pkg => ({
      ref: `refs/heads/${pkg.branch}`,
      message: pkg.branch,
      files: { ...packageFiles(pkg.name, pkg.branch, pkg.dependencies), ...pkg.files },
    })),
  );
  return bare;
}

// Adds a commit to `branch` that changes the marker its index.js exports.
function moveBranch(bare: string, branch: string, marker: string) {
  const ref = `refs/heads/${branch}`;
  return commitTo(bare, [{ ref, from: ref, message: marker, files: { "index.js": indexJs(marker) } }]);
}

// branch -> commit SHA, read from the `info/refs` that `update-server-info`
// writes (one `<sha>\t<ref>` line per ref).
function branchCommits(bare: string): Record<string, string> {
  const commits: Record<string, string> = {};
  for (const line of readFileSync(join(bare, "info", "refs"), "utf8").split("\n")) {
    const [sha, ref] = line.split("\t");
    if (ref?.startsWith("refs/heads/")) commits[ref.slice("refs/heads/".length)] = sha;
  }
  return commits;
}

function serveStatic(root: string) {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const file = Bun.file(join(root, new URL(req.url).pathname));
      return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
    },
  });
}

// A gzipped tarball of `files` under `rootDir`, built in memory. Like the
// `tar -czf <dir>` output it replaces, it starts with the root directory's own
// entry: for a GitHub tarball bun reads the `<owner>-<repo>-<committish>` name
// of that first entry and takes the committish as the resolved one.
function tarballOf(rootDir: string, files: Record<string, string>) {
  const entries: Record<string, string> = { [`${rootDir}/`]: "" };
  for (const [path, contents] of Object.entries(files)) entries[`${rootDir}/${path}`] = contents;
  return new Bun.Archive(entries, { compress: "gzip" }).bytes();
}

// letter -> the tarball of `@scope/pkg-<letter>`; `dependencies` become pkg-a's.
async function packageTarballs(
  letters: string[],
  dependencies: Record<string, string>,
  rootDirOf: (l: string) => string,
) {
  const tarballs = new Map<string, Uint8Array>();
  for (const l of letters) {
    const files = packageFiles(nameOf(l), `pkg-${l}`, l === "a" ? dependencies : undefined);
    tarballs.set(l, await tarballOf(rootDirOf(l), files));
  }
  return tarballs;
}

// The integrity bun.lock records for a tarball.
function integrityOf(tarball: Uint8Array) {
  return `sha512-${new Bun.CryptoHasher("sha512").update(tarball).digest("base64")}`;
}

function writeProject(root: string, dependencies: Record<string, string>): string {
  const project = join(root, "project");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "project", version: "1.0.0", dependencies }));
  return project;
}

async function runInstall(cwd: string, cacheDir: string, extraEnv: Record<string, string>, ...args: string[]) {
  const env = { ...gitEnv, ...extraEnv, BUN_INSTALL_CACHE_DIR: cacheDir };
  // Set on ASAN CI lanes; it arms a subreaper around internal git spawns that
  // SIGKILLs concurrent clone tasks (see #33982). This test exercises install
  // task bookkeeping, not orphan reaping.
  delete env.BUN_FEATURE_FLAG_NO_ORPHANS;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", ...args],
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// What `bun install` printed, as lines: its version header, `+ <name>@<resolution>`
// for each package it installed (sorted by name) and the summary, minus the timing.
function installOutput(stdout: string): string[] {
  return stdout.replace(/\s*\[[\d.]+m?s\]\s*$/, "").split(/\r?\n/);
}

function expectInstalled(stdout: string, resolutions: Record<string, string>) {
  const names = Object.keys(resolutions).sort();
  expect(installOutput(stdout)).toEqual([
    expect.stringContaining("bun install v"),
    "",
    ...names.map(name => `+ ${name}@${resolutions[name]}`),
    "",
    `${names.length} package${names.length === 1 ? "" : "s"} installed`,
  ]);
}

// bun.lock's `packages` section: name -> [`<name>@<resolution>`, metadata, ...resolution details].
async function lockedPackages(project: string): Promise<Record<string, unknown[]>> {
  const lockfile = Bun.JSONC.parse(await Bun.file(join(project, "bun.lock")).text()) as {
    packages: Record<string, unknown[]>;
  };
  return lockfile.packages;
}

async function installedVersionOf(dir: string, name: string): Promise<string | null> {
  const file = Bun.file(join(dir, "node_modules", name, "index.js"));
  if (!(await file.exists())) return null;
  const text = await file.text();
  return JSON.parse(text.slice(text.indexOf("=") + 1, text.lastIndexOf(";")));
}

// name -> marker exported by the installed package's index.js (null if absent).
async function installedVersions(dir: string, names: string[]): Promise<Record<string, string | null>> {
  return Object.fromEntries(await Promise.all(names.map(async name => [name, await installedVersionOf(dir, name)])));
}

// The read-only fixture the git tests install from: one bare repo with the
// branches pkg-a..pkg-p, served over dumb HTTP for the whole file. pkg-a
// re-declares 11 of its siblings as its own dependencies through the served
// URL, so those specs appear both directly (from a project) and transitively.
// Every test installs into a directory and cache of its own; the tests that
// have to change a repo build their own.
let sharedRoot: ReturnType<typeof tempDir>;
let sharedServer: ReturnType<typeof Bun.serve>;
let sharedBare: string;
let sharedRepoUrl: string;
let sharedCommits: Record<string, string>;
let sharedTransitive: Record<string, string>;

beforeAll(async () => {
  sharedRoot = tempDir("git-deps-shared", {});
  sharedServer = serveStatic(String(sharedRoot));
  sharedRepoUrl = `git+http://localhost:${sharedServer.port}/shared-repo.git`;
  sharedTransitive = Object.fromEntries(letters.slice(1, 12).map(l => [nameOf(l), `${sharedRepoUrl}#pkg-${l}`]));
  sharedBare = await makeSharedRepo(
    String(sharedRoot),
    letters.map(l => ({ name: nameOf(l), branch: `pkg-${l}`, dependencies: l === "a" ? sharedTransitive : undefined })),
  );
  sharedCommits = branchCommits(sharedBare);
});

afterAll(() => {
  sharedServer?.stop(true);
  sharedRoot?.[Symbol.dispose]();
});

// What installing the `pkg-<letter>` branches of one repo must print and lock:
// each branch resolves to the commit at its tip. `dependencies` holds the
// package.json dependencies of the packages that declare any.
function expectedGitPackages(
  repoUrl: string,
  commits: Record<string, string>,
  installed: string[],
  dependencies: Record<string, Record<string, string>> = {},
) {
  const resolutions: Record<string, string> = {};
  const locked: Record<string, unknown[]> = {};
  for (const l of installed) {
    const name = nameOf(l);
    const sha = commits[`pkg-${l}`];
    resolutions[name] = `${repoUrl}#${sha}`;
    locked[name] = [`${name}@${repoUrl}#${sha}`, name in dependencies ? { dependencies: dependencies[name] } : {}, sha];
  }
  return { resolutions, locked };
}

// issue #35420 bug 1: with no lockfile and a cold cache, dependencies that
// appear both directly and transitively (same repo URL + committish) raced
// against the shared clone/checkout tasks and failed with "failed to resolve".
test.concurrent(
  "installs every git dependency when many branches of one repo appear directly and transitively",
  async () => {
    using dir = tempDir("git-dep-dup", {});
    const root = String(dir);
    const project = writeProject(root, Object.fromEntries(letters.map(l => [nameOf(l), `${sharedRepoUrl}#pkg-${l}`])));
    const { resolutions, locked } = expectedGitPackages(sharedRepoUrl, sharedCommits, letters, {
      [nameOf("a")]: sharedTransitive,
    });

    // the race depends on threadpool scheduling; two fresh-cache attempts to
    // make the failure reliable on the unfixed code
    for (let attempt = 0; attempt < 2; attempt++) {
      rmSync(join(project, "node_modules"), { recursive: true, force: true });
      rmSync(join(project, "bun.lock"), { force: true });
      const { stdout, stderr, exitCode } = await runInstall(project, join(root, `cache-${attempt}`), {});
      expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
        "Resolving dependencies
        Resolved, downloaded and extracted [17]
        Saved lockfile"
      `);
      expectInstalled(stdout, resolutions);
      expect(await installedVersions(project, letters.map(nameOf))).toEqual(markers(letters));
      expect(await lockedPackages(project)).toEqual(locked);
      expect(exitCode).toBe(0);
    }
  },
  30_000,
);

// same mechanism as above but for tarball-URL dependencies (issues #10915,
// #8501): a dependency enqueued after its tarball's extract task already
// completed and drained its callback queue was parked forever and failed
// with "failed to resolve".
test.concurrent(
  "installs every tarball-URL dependency that appears directly and transitively",
  async () => {
    using dir = tempDir("tarball-dep-dup", {});
    const root = String(dir);

    // the tarballs embed the server's URL, so they are built once it listens
    let tarballs: Map<string, Uint8Array>;
    const downloads: string[] = [];
    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        const match = /^\/pkg-([a-z])\.tgz$/.exec(new URL(req.url).pathname);
        const tarball = match && tarballs.get(match[1]);
        if (!tarball) return new Response("not found", { status: 404 });
        downloads.push(match[1]);
        return new Response(tarball);
      },
    });
    const urlOf = (l: string) => `http://localhost:${server.port}/pkg-${l}.tgz`;

    // pkg-a re-declares 11 of its siblings as its own dependencies, so those
    // tarball specs appear both directly (from the project) and transitively.
    const transitive = Object.fromEntries(letters.slice(1, 12).map(l => [nameOf(l), urlOf(l)]));
    tarballs = await packageTarballs(letters, transitive, () => "package");

    const project = writeProject(root, Object.fromEntries(letters.map(l => [nameOf(l), urlOf(l)])));
    const resolutions = Object.fromEntries(letters.map(l => [nameOf(l), urlOf(l)]));
    const locked = Object.fromEntries(
      letters.map(l => [
        nameOf(l),
        [`${nameOf(l)}@${urlOf(l)}`, l === "a" ? { dependencies: transitive } : {}, integrityOf(tarballs.get(l)!)],
      ]),
    );

    // the race depends on threadpool scheduling; two fresh-cache attempts to
    // make the failure reliable on the unfixed code
    for (let attempt = 0; attempt < 2; attempt++) {
      rmSync(join(project, "node_modules"), { recursive: true, force: true });
      rmSync(join(project, "bun.lock"), { force: true });
      downloads.length = 0;
      const { stdout, stderr, exitCode } = await runInstall(project, join(root, `cache-${attempt}`), {});
      expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
        "Resolving dependencies
        Resolved, downloaded and extracted [32]
        Saved lockfile"
      `);
      expectInstalled(stdout, resolutions);
      // the second occurrence of a spec joins the first one's download
      expect(downloads.sort()).toEqual(letters);
      expect(await installedVersions(project, letters.map(nameOf))).toEqual(markers(letters));
      expect(await lockedPackages(project)).toEqual(locked);
      expect(exitCode).toBe(0);
    }
  },
  30_000,
);

// issue #11348: same mechanism for `github:` dependencies. The root and a
// transitive `github:` dependency both request the same `github:owner/repo`
// spec; the late enqueue lands after the shared extract task already drained
// its callback queue and was parked forever with "failed to resolve".
test.concurrent(
  "installs every github: dependency that appears directly and transitively",
  async () => {
    const letters = "abcdefgh".split("");
    using dir = tempDir("github-dep-dup", {});
    const root = String(dir);

    // pkg-a re-declares its siblings as its own dependencies, so those
    // `github:` specs appear both directly (from the project) and transitively.
    const transitive = Object.fromEntries(letters.slice(1).map(l => [nameOf(l), `github:scope/pkg-${l}`]));
    // GitHub tarballs have a top-level `<owner>-<repo>-<sha>` directory; the
    // extractor reads it as the resolved tag and it becomes the cache key.
    const tarballs = await packageTarballs(letters, transitive, l => `scope-pkg-${l}-0000000`);

    const downloads: string[] = [];
    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        const match = /^\/repos\/scope\/pkg-([a-z])\/tarball\/?$/.exec(new URL(req.url).pathname);
        const tarball = match && tarballs.get(match[1]);
        if (!tarball) return new Response("not found", { status: 404 });
        downloads.push(match[1]);
        return new Response(tarball);
      },
    });

    const project = writeProject(root, Object.fromEntries(letters.map(l => [nameOf(l), `github:scope/pkg-${l}`])));
    const resolutions = Object.fromEntries(letters.map(l => [nameOf(l), `github:scope/pkg-${l}#0000000`]));
    const locked = Object.fromEntries(
      letters.map(l => [
        nameOf(l),
        [
          `${nameOf(l)}@github:scope/pkg-${l}#0000000`,
          l === "a" ? { dependencies: transitive } : {},
          `scope-pkg-${l}-0000000`,
          integrityOf(tarballs.get(l)!),
        ],
      ]),
    );

    // the race depends on threadpool scheduling; two fresh-cache attempts to
    // make the failure reliable on the unfixed code
    for (let attempt = 0; attempt < 2; attempt++) {
      rmSync(join(project, "node_modules"), { recursive: true, force: true });
      rmSync(join(project, "bun.lock"), { force: true });
      downloads.length = 0;
      const { stdout, stderr, exitCode } = await runInstall(project, join(root, `cache-${attempt}`), {
        GITHUB_API_URL: `http://localhost:${server.port}`,
      });
      expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
        "Resolving dependencies
        Resolved, downloaded and extracted [16]
        Saved lockfile"
      `);
      expectInstalled(stdout, resolutions);
      // the second occurrence of a spec joins the first one's download
      expect(downloads.sort()).toEqual(letters);
      expect(await installedVersions(project, letters.map(nameOf))).toEqual(markers(letters));
      expect(await lockedPackages(project)).toEqual(locked);
      expect(exitCode).toBe(0);
    }
  },
  30_000,
);

// issue #35420 bug 2: installing from a complete lockfile with a cold cache
// only checked out the single dependency stored on the shared clone task; the
// other branches of the same repo were silently skipped with exit code 0.
test.concurrent(
  "installs every git dependency from a lockfile on a cold cache when deps share one repo",
  async () => {
    using dir = tempDir("git-dep-lockfile", {});
    const root = String(dir);
    const project = writeProject(root, {
      [nameOf("m")]: `${sharedRepoUrl}#pkg-m`,
      [nameOf("n")]: `${sharedRepoUrl}#pkg-n`,
    });
    const { resolutions, locked } = expectedGitPackages(sharedRepoUrl, sharedCommits, ["m", "n"]);

    // fresh install to produce a complete lockfile
    {
      const { stdout, stderr, exitCode } = await runInstall(project, join(root, "cache-warm"), {});
      expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
        "Resolving dependencies
        Resolved, downloaded and extracted [3]
        Saved lockfile"
      `);
      expectInstalled(stdout, resolutions);
      expect(await installedVersions(project, [nameOf("m"), nameOf("n")])).toEqual(markers(["m", "n"]));
      expect(await lockedPackages(project)).toEqual(locked);
      expect(exitCode).toBe(0);
    }

    // simulate a fresh machine: keep bun.lock, drop node_modules + cache
    rmSync(join(project, "node_modules"), { recursive: true });
    const { stdout, stderr, exitCode } = await runInstall(project, join(root, "cache-cold"), {}, "--frozen-lockfile");
    expect(stderr).toBe("");
    expectInstalled(stdout, resolutions);
    expect(await installedVersions(project, [nameOf("m"), nameOf("n")])).toEqual(markers(["m", "n"]));
    expect(await lockedPackages(project)).toEqual(locked);
    expect(exitCode).toBe(0);
  },
  30_000,
);

// With the isolated linker, a cold-cache frozen install re-enqueues each
// dependency after the shared clone completes; the checkout id was derived
// from the branch committish's current tip instead of the lockfile's pinned
// SHA, so a branch that moved after the lockfile was written installed the
// wrong commit and stranded the install context. The hoisted linker had the
// same mismatch in its clone-completion waiter loop.
for (const linker of ["hoisted", "isolated"] as const) {
  test.concurrent(
    `${linker} linker installs the locked commit from a cold cache after the branch moves`,
    async () => {
      using dir = tempDir(`git-dep-${linker}-moved`, {});
      const root = String(dir);

      // this test moves a branch, so it gets a repo of its own
      await using server = serveStatic(root);
      const repoUrl = `git+http://localhost:${server.port}/shared-repo.git`;
      const bare = await makeSharedRepo(root, [
        { name: nameOf("m"), branch: "pkg-m" },
        { name: nameOf("n"), branch: "pkg-n" },
      ]);
      const lockedCommits = branchCommits(bare);
      const { resolutions, locked } = expectedGitPackages(repoUrl, lockedCommits, ["m", "n"]);

      const project = writeProject(root, {
        [nameOf("m")]: `${repoUrl}#pkg-m`,
        [nameOf("n")]: `${repoUrl}#pkg-n`,
      });

      // fresh install to produce a complete lockfile
      {
        const { stdout, stderr, exitCode } = await runInstall(
          project,
          join(root, "cache-warm"),
          {},
          `--linker=${linker}`,
        );
        expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
          "Resolving dependencies
          Resolved, downloaded and extracted [3]
          Saved lockfile"
        `);
        expectInstalled(stdout, resolutions);
        expect(await installedVersions(project, [nameOf("m"), nameOf("n")])).toEqual(markers(["m", "n"]));
        expect(await lockedPackages(project)).toEqual(locked);
        expect(exitCode).toBe(0);
      }

      // move pkg-m past the locked commit
      await moveBranch(bare, "pkg-m", "pkg-m-v2");
      const movedCommits = branchCommits(bare);
      expect(movedCommits["pkg-m"]).not.toBe(lockedCommits["pkg-m"]);
      expect(movedCommits["pkg-n"]).toBe(lockedCommits["pkg-n"]);

      // cold cache from the lockfile: must install the locked commit, not the tip
      rmSync(join(project, "node_modules"), { recursive: true });
      const { stdout, stderr, exitCode } = await runInstall(
        project,
        join(root, "cache-cold"),
        {},
        "--frozen-lockfile",
        `--linker=${linker}`,
      );
      expect(stderr).toBe("");
      expectInstalled(stdout, resolutions);
      expect(await installedVersions(project, [nameOf("m"), nameOf("n")])).toEqual(markers(["m", "n"]));
      expect(await lockedPackages(project)).toEqual(locked);
      expect(exitCode).toBe(0);
    },
    30_000,
  );
}

// A registry that has version 1.0.0 of each package: name -> the rest of its
// package.json. The marker its index.js exports is `<name>-from-registry`.
async function serveRegistry(packages: Record<string, object>) {
  const tarballs = new Map<string, Uint8Array>();
  for (const [name, fields] of Object.entries(packages)) {
    const files = {
      "package.json": JSON.stringify({ name, version: "1.0.0", ...fields }),
      "index.js": indexJs(`${name}-from-registry`),
    };
    tarballs.set(name, await tarballOf("package", files));
  }
  return Bun.serve({
    port: 0,
    fetch(req) {
      const { origin, pathname } = new URL(req.url);
      const name = pathname.slice(1).replace(/\.tgz$/, "");
      const tarball = tarballs.get(name);
      if (!tarball) return new Response("not found", { status: 404 });
      if (pathname.endsWith(".tgz")) return new Response(tarball);
      const dist = { tarball: `${origin}/${name}.tgz`, integrity: integrityOf(tarball) };
      return Response.json({
        name,
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { name, version: "1.0.0", ...packages[name], dist } },
      });
    },
  });
}

// bun.lock's `packages` section as key -> `<name>@<resolution>`.
async function lockedResolutions(project: string): Promise<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(await lockedPackages(project)).map(([key, [resolution]]) => [key, resolution]),
  );
}

// Where the isolated linker installed the `name` that `dir` resolves: the
// store entry, whose node_modules has the package and what it resolves.
function storeEntryOf(dir: string, name: string) {
  return dirname(dirname(realpathSync(join(dir, "node_modules", name))));
}

// `<root>/project`, a workspace root with no dependencies of its own, and its
// one member `packages/m`. bun links a workspace with the isolated linker.
function writeWorkspace(root: string, dependencies: Record<string, string>) {
  const project = join(root, "project");
  const member = join(project, "packages", "m");
  mkdirSync(member, { recursive: true });
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "project", workspaces: ["packages/*"] }));
  writeFileSync(join(member, "package.json"), JSON.stringify({ name: "m", version: "1.0.0", dependencies }));
  return { project, member };
}

// The isolated linker installs a package once for all the dependencies on it
// and keeps one of them with it: the first that its depth-first, name-ordered
// walk reaches. In the tests below that is, for the git package `b` of the
// workspace member `m`, the peer dependency `b: "*"` of `a`, which is walked
// first. It is not a git dependency, and bun.lock resolves a required one to
// the registry's `b` (`a/b`). Once the repository was cloned, the install took
// the checkout to start from that dependency: it started none and never exited.
for (const peer of ["required", "optional"] as const) {
  test.concurrent(
    `installs a workspace's git dependency that is the ${peer} peer of an earlier package from a cold cache`,
    async () => {
      using dir = tempDir(`git-dep-${peer}-peer`, {});
      const root = String(dir);
      const bare = await makeSharedRepo(root, [{ name: "b", branch: "main" }], "b.git");
      const repoUrl = `git+${pathToFileURL(bare)}`;
      // A required peer is also resolved on its own, from the registry.
      await using registry = await serveRegistry(
        peer === "required"
          ? { a: { peerDependencies: { b: "*" } }, b: {} }
          : { a: { peerDependencies: { b: "*" }, peerDependenciesMeta: { b: { optional: true } } } },
      );
      const env = { BUN_CONFIG_REGISTRY: registry.url.href };
      const { project, member } = writeWorkspace(root, { a: "1.0.0", b: `${repoUrl}#main` });
      const locked = {
        a: "a@1.0.0",
        b: `b@${repoUrl}#${branchCommits(bare).main}`,
        m: "m@workspace:packages/m",
        ...(peer === "required" && { "a/b": "b@1.0.0" }),
      };
      // What `m` resolves, and the `b` that `a` resolves: the git one.
      const installed = async () => ({
        ...(await installedVersions(member, ["a", "b"])),
        "a > b": await installedVersionOf(storeEntryOf(member, "a"), "b"),
      });
      const expected = { a: "a-from-registry", b: "main", "a > b": "main" };
      const output = [expect.stringContaining("bun install v"), "", "2 packages installed"];

      // fresh install to produce a complete lockfile
      {
        const { stdout, stderr, exitCode } = await runInstall(project, join(root, "cache-warm"), env);
        expect(stderr).toContain("Saved lockfile");
        expect(installOutput(stdout)).toEqual(output);
        expect(await installed()).toEqual(expected);
        expect(await lockedResolutions(project)).toEqual(locked);
        expect(exitCode).toBe(0);
      }

      // simulate a fresh machine: keep bun.lock, drop node_modules + cache
      rmSync(join(project, "node_modules"), { recursive: true });
      rmSync(join(member, "node_modules"), { recursive: true });
      const { stdout, stderr, exitCode } = await runInstall(
        project,
        join(root, "cache-cold"),
        env,
        "--frozen-lockfile",
      );
      expect(stderr).toBe("");
      expect(installOutput(stdout)).toEqual(output);
      expect(await installed()).toEqual(expected);
      expect(exitCode).toBe(0);
    },
    30_000,
  );
}

// One clone serves every package of a repository. Three wait for it here, and
// the one that a's peer dependency stands for is neither the first nor the last.
test.concurrent(
  "checks out every package of a repository when a peer dependency stands for one of them",
  async () => {
    using dir = tempDir("git-dep-peer-shared-repo", {});
    const root = String(dir);
    const names = ["aa", "b", "c"];
    const bare = await makeSharedRepo(
      root,
      names.map(name => ({ name, branch: name })),
    );
    const repoUrl = `git+${pathToFileURL(bare)}`;
    const commits = branchCommits(bare);
    await using registry = await serveRegistry({ a: { peerDependencies: { b: "*" } }, b: {} });
    const env = { BUN_CONFIG_REGISTRY: registry.url.href };
    const { project, member } = writeWorkspace(root, {
      a: "1.0.0",
      ...Object.fromEntries(names.map(name => [name, `${repoUrl}#${name}`])),
    });
    const locked = {
      a: "a@1.0.0",
      ...Object.fromEntries(names.map(name => [name, `${name}@${repoUrl}#${commits[name]}`])),
      m: "m@workspace:packages/m",
      "a/b": "b@1.0.0",
    };
    const installed = async () => ({
      ...(await installedVersions(member, ["a", ...names])),
      "a > b": await installedVersionOf(storeEntryOf(member, "a"), "b"),
    });
    const expected = { a: "a-from-registry", aa: "aa", b: "b", c: "c", "a > b": "b" };
    const output = [expect.stringContaining("bun install v"), "", "4 packages installed"];

    // fresh install to produce a complete lockfile
    {
      const { stdout, stderr, exitCode } = await runInstall(project, join(root, "cache-warm"), env);
      expect(stderr).toContain("Saved lockfile");
      expect(installOutput(stdout)).toEqual(output);
      expect(await installed()).toEqual(expected);
      expect(await lockedResolutions(project)).toEqual(locked);
      expect(exitCode).toBe(0);
    }

    // simulate a fresh machine: keep bun.lock, drop node_modules + cache
    rmSync(join(project, "node_modules"), { recursive: true });
    rmSync(join(member, "node_modules"), { recursive: true });
    const { stdout, stderr, exitCode } = await runInstall(project, join(root, "cache-cold"), env, "--frozen-lockfile");
    expect(stderr).toBe("");
    expect(installOutput(stdout)).toEqual(output);
    expect(await installed()).toEqual(expected);
    expect(exitCode).toBe(0);
  },
  30_000,
);

// The repository is gone when the cold install clones it. The failed clone
// fails every package that waits for it. The one that a's peer dependency
// stands for was left waiting, and the install never exited.
test.concurrent(
  "fails every package of a repository that cannot be cloned when a peer dependency stands for one of them",
  async () => {
    using dir = tempDir("git-dep-peer-clone-fails", {});
    const root = String(dir);
    const names = ["b", "c"];
    const bare = await makeSharedRepo(
      root,
      names.map(name => ({ name, branch: name })),
    );
    const repoUrl = `git+${pathToFileURL(bare)}`;
    await using registry = await serveRegistry({ a: { peerDependencies: { b: "*" } }, b: {} });
    const env = { BUN_CONFIG_REGISTRY: registry.url.href };
    const { project, member } = writeWorkspace(root, {
      a: "1.0.0",
      ...Object.fromEntries(names.map(name => [name, `${repoUrl}#${name}`])),
    });

    // fresh install to produce a complete lockfile
    {
      const { stderr, exitCode } = await runInstall(project, join(root, "cache-warm"), env);
      expect(stderr).toContain("Saved lockfile");
      expect(await installedVersions(member, ["a", ...names])).toEqual({ a: "a-from-registry", b: "b", c: "c" });
      expect((await lockedResolutions(project))["a/b"]).toBe("b@1.0.0");
      expect(exitCode).toBe(0);
    }

    // a fresh machine that cannot reach the repository
    rmSync(join(project, "node_modules"), { recursive: true });
    rmSync(join(member, "node_modules"), { recursive: true });
    renameSync(bare, `${bare}.gone`);
    const { stdout, stderr, exitCode } = await runInstall(project, join(root, "cache-cold"), env, "--frozen-lockfile");
    const failed = "error: failed to download ";
    expect(
      stderr
        .split(/\r?\n/)
        .filter(line => line.startsWith(failed))
        .map(line => line.slice(failed.length, line.indexOf("@"))),
    ).toEqual(names);
    expect(stdout).toContain("Failed to install 2 packages");
    expect(exitCode).toBe(1);
  },
  30_000,
);

// `overrides` puts a git commit in place of a's registry dependency `b`. In
// bun.lock that dependency keeps its range `^1.0.0` and resolves to the git
// package, so it is no git dependency either.
test.concurrent(
  "isolated linker installs a git package that an override puts in place of a registry dependency, from a cold cache",
  async () => {
    using dir = tempDir("git-dep-override", {});
    const root = String(dir);
    const bare = await makeSharedRepo(root, [{ name: "b", branch: "main" }], "b.git");
    const repoUrl = `git+${pathToFileURL(bare)}`;
    const sha = branchCommits(bare).main;
    await using registry = await serveRegistry({ a: { dependencies: { b: "^1.0.0" } } });
    const env = { BUN_CONFIG_REGISTRY: registry.url.href };
    const project = join(root, "project");
    mkdirSync(project);
    writeFileSync(
      join(project, "package.json"),
      JSON.stringify({
        name: "project",
        version: "1.0.0",
        dependencies: { a: "1.0.0" },
        overrides: { b: `${repoUrl}#${sha}` },
      }),
    );
    const installed = async () => ({
      a: await installedVersionOf(project, "a"),
      "a > b": await installedVersionOf(storeEntryOf(project, "a"), "b"),
    });
    const expected = { a: "a-from-registry", "a > b": "main" };
    const output = [expect.stringContaining("bun install v"), "", "+ a@1.0.0", "", "2 packages installed"];

    // fresh install to produce a complete lockfile
    {
      const { stdout, stderr, exitCode } = await runInstall(
        project,
        join(root, "cache-warm"),
        env,
        "--linker=isolated",
      );
      expect(stderr).toContain("Saved lockfile");
      expect(installOutput(stdout)).toEqual(output);
      expect(await installed()).toEqual(expected);
      expect(await lockedResolutions(project)).toEqual({ a: "a@1.0.0", b: `b@${repoUrl}#${sha}` });
      expect(exitCode).toBe(0);
    }

    // simulate a fresh machine: keep bun.lock, drop node_modules + cache
    rmSync(join(project, "node_modules"), { recursive: true });
    const { stdout, stderr, exitCode } = await runInstall(
      project,
      join(root, "cache-cold"),
      env,
      "--frozen-lockfile",
      "--linker=isolated",
    );
    expect(stderr).toBe("");
    expect(installOutput(stdout)).toEqual(output);
    expect(await installed()).toEqual(expected);
    expect(exitCode).toBe(0);
  },
  30_000,
);

// bun.lock can spell a repository's URL differently from the dependency: an
// scp-form URL comes back from it with `ssh://` in front. Here the locked URL
// has a `.` segment. The install clones and checks out what bun.lock names. It
// used to go by the dependency once the clone ended: it cloned a second time
// and left the package waiting.
test.concurrent(
  "isolated linker checks out a git package whose URL bun.lock spells differently from the dependency",
  async () => {
    using dir = tempDir("git-dep-url-spelling", {});
    const root = String(dir);
    const name = nameOf("b");
    const repoUrl = `git+${pathToFileURL(sharedBare)}`;
    const lockedUrl = repoUrl.replace(/\/shared-repo\.git$/, "/./shared-repo.git");
    const sha = sharedCommits["pkg-b"];
    const project = writeProject(root, { [name]: `${repoUrl}#pkg-b` });
    writeFileSync(
      join(project, "bun.lock"),
      JSON.stringify({
        lockfileVersion: 1,
        configVersion: 1,
        workspaces: { "": { name: "project", dependencies: { [name]: `${repoUrl}#pkg-b` } } },
        packages: { [name]: [`${name}@${lockedUrl}#${sha}`, {}, sha] },
      }),
    );

    const cache = join(root, "cache");
    const { stdout, stderr, exitCode } = await runInstall(project, cache, {}, "--frozen-lockfile", "--linker=isolated");
    expect(stderr).toBe("");
    expectInstalled(stdout, { [name]: `${lockedUrl}#${sha}` });
    expect(await installedVersions(project, [name])).toEqual(markers(["b"]));
    // one bare clone of the repository
    expect(readdirSync(cache).filter(entry => entry.endsWith(".git"))).toHaveLength(1);
    expect(exitCode).toBe(0);
  },
  30_000,
);

// A patch is applied to a git package right after its checkout when the
// repository was cloned earlier in the same process, here for the `c` that
// `bun install <url>` adds. The package to patch was looked up by the name of
// the dependency, which an alias does not share with it: `panic: Package not found`.
test.concurrent(
  "patches a git package under an alias after another dependency cloned its repository",
  async () => {
    using dir = tempDir("git-dep-alias-patch", {
      "project/patches/b.patch": `diff --git a/index.js b/index.js
index 0000000000000000000000000000000000000000..1111111111111111111111111111111111111111 100644
--- a/index.js
+++ b/index.js
@@ -1 +1 @@
-module.exports = "b";
+module.exports = "b-patched";
`,
    });
    const root = String(dir);
    const project = join(root, "project");
    const bare = await makeSharedRepo(
      root,
      ["b", "c"].map(name => ({ name, branch: name })),
    );
    const repoUrl = `git+${pathToFileURL(bare)}`;
    writeFileSync(
      join(project, "package.json"),
      JSON.stringify({
        name: "project",
        version: "1.0.0",
        dependencies: { "b-alias": `${repoUrl}#b` },
        patchedDependencies: { [`b@${repoUrl}#${branchCommits(bare).b}`]: "patches/b.patch" },
      }),
    );

    // fresh install to produce a complete lockfile
    {
      const { stderr, exitCode } = await runInstall(project, join(root, "cache-warm"), {});
      expect(stderr).toContain("Saved lockfile");
      expect(await installedVersions(project, ["b-alias"])).toEqual({ "b-alias": "b-patched" });
      expect(exitCode).toBe(0);
    }

    // a fresh machine: keep bun.lock, drop node_modules + cache, and add `c`
    rmSync(join(project, "node_modules"), { recursive: true });
    const { stderr, exitCode } = await runInstall(project, join(root, "cache-cold"), {}, `${repoUrl}#c`);
    expect(stderr).toContain("Saved lockfile");
    expect(await installedVersions(project, ["b-alias", "c"])).toEqual({ "b-alias": "b-patched", c: "c" });
    expect(exitCode).toBe(0);
  },
  30_000,
);

// issue #35420 bug 3: `git+file://` dependencies never cloned at all — the
// clone task recognized neither an https nor an ssh URL and finished without
// running git, leaving a poisoned repo handle behind.
test.concurrent("installs a git+file:// dependency", async () => {
  using dir = tempDir("git-dep-file", {});
  const root = String(dir);
  const repoUrl = `git+${pathToFileURL(sharedBare)}`;
  const project = writeProject(root, { [nameOf("b")]: `${repoUrl}#pkg-b` });
  const { resolutions, locked } = expectedGitPackages(repoUrl, sharedCommits, ["b"]);

  const { stdout, stderr, exitCode } = await runInstall(project, join(root, "cache"), {});
  expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
    "Resolving dependencies
    Resolved, downloaded and extracted [2]
    Saved lockfile"
  `);
  expectInstalled(stdout, resolutions);
  expect(await installedVersions(project, [nameOf("b")])).toEqual(markers(["b"]));
  expect(await lockedPackages(project)).toEqual(locked);
  expect(exitCode).toBe(0);
});

// issue #40803: `bun install <git url>` (no alias) sorted the workspace dep
// under its version literal. The real name is only known once the repo is
// fetched; it is rewritten in place after resolution, so the written key
// landed at the literal's position ("git..." here, between nothing and
// "hhh-first") instead of its own.
test.concurrent("bun install <git url> sorts the workspace dependency by its resolved name", async () => {
  using dir = tempDir("git-dep-sort", {
    "project/package.json": JSON.stringify({
      name: "project",
      version: "1.0.0",
      dependencies: { "hhh-first": "file:./hhh-first", "jjj-last": "file:./jjj-last" },
    }),
    "project/hhh-first/package.json": JSON.stringify({ name: "hhh-first", version: "1.0.0" }),
    "project/jjj-last/package.json": JSON.stringify({ name: "jjj-last", version: "1.0.0" }),
  });
  const root = String(dir);
  const project = join(root, "project");
  const bare = await makeSharedRepo(root, [{ name: "iii-middle", branch: "main" }], "sort-repo.git");

  const first = await runInstall(project, join(root, "cache"), {});
  expect(first.stderr).toContain("Saved lockfile");
  expect(first.exitCode).toBe(0);

  const second = await runInstall(project, join(root, "cache"), {}, `git+${pathToFileURL(bare)}#main`);
  expect(second.stderr).toContain("Saved lockfile");
  expect(second.exitCode).toBe(0);

  const lockfile = Bun.JSONC.parse(await Bun.file(join(project, "bun.lock")).text()) as {
    workspaces: Record<string, { dependencies: Record<string, string> }>;
  };
  expect(Object.keys(lockfile.workspaces[""].dependencies)).toEqual(["hhh-first", "iii-middle", "jjj-last"]);
});

// The git commands of an install used to run on thread-pool threads through
// the synchronous spawn helper, which installed the signal forwarder meant for
// the foreground child of `bun run`: a SIGINT while clones ran was sent on to
// one of the git processes instead of stopping the install, and concurrent
// clones raced on the forwarder's process-wide state. On Linux the git
// processes now carry PR_SET_PDEATHSIG, so they die with bun.
test.concurrent.skipIf(isWindows)(
  "SIGINT during git clones stops the install and is not forwarded to git",
  async () => {
    using dir = tempDir("git-dep-sigint", {});
    const root = String(dir);
    const bin = join(root, "bin");
    mkdirSync(bin);
    const running = join(root, "git-running");
    const exited = join(root, "git-exited");
    const gotSigint = join(root, "git-got-sigint");
    const quote = (path: string) => `'${path.replaceAll("'", "'\\''")}'`;
    const lineCount = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").length - 1 : 0);
    // A fake git. Each process appends a line to `running` when it starts, to
    // `exited` when it ends, and blocks until the test deletes `running`. A
    // SIGINT that bun forwards to one of them is recorded in `gotSigint`, which
    // makes every other fake git (the concurrent clone, the retry over ssh)
    // exit at once.
    writeFileSync(
      join(bin, "git"),
      `#!/bin/sh
trap 'echo $$ >> ${quote(exited)}' EXIT
trap ': > ${quote(gotSigint)}; exit 130' INT
echo $$ >> ${quote(running)}
i=0
while [ -e ${quote(running)} ] && [ ! -e ${quote(gotSigint)} ] && [ $i -lt 600 ]; do sleep 0.05; i=$((i+1)); done
exit 1
`,
      { mode: 0o755 },
    );
    // two repositories, so two clones run at the same time
    const project = writeProject(root, {
      [nameOf("a")]: "git+https://localhost/scope/pkg-a.git",
      [nameOf("b")]: "git+https://localhost/scope/pkg-b.git",
    });
    const env = { ...gitEnv, BUN_INSTALL_CACHE_DIR: join(root, "cache"), PATH: `${bin}:${gitEnv.PATH}` };
    delete env.BUN_FEATURE_FLAG_NO_ORPHANS;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: project,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = proc.stdout.text();
    const stderr = proc.stderr.text();
    try {
      const deadline = Date.now() + 20_000;
      while (lineCount(running) < 2) {
        if (proc.exitCode !== null || proc.signalCode !== null) {
          throw new Error(`install exited before it ran git:\n${await stderr}`);
        }
        if (Date.now() > deadline) throw new Error(`install ran ${lineCount(running)} of 2 clones`);
        await Bun.sleep(10);
      }
      proc.kill("SIGINT");
      await Promise.all([stdout, stderr, proc.exited]);
      // Read the marker only once every fake git is gone, so that a trap that
      // fires after bun exited still counts.
      const gone = Date.now() + 10_000;
      const pids = readFileSync(running, "utf8").trim().split("\n").map(Number);
      if (isLinux) {
        // The kernel kills them with bun (PR_SET_PDEATHSIG); `running` still exists.
        const alive = (pid: number) => {
          try {
            return !readFileSync(`/proc/${pid}/status`, "utf8").includes("State:\tZ");
          } catch {
            return false;
          }
        };
        while (pids.some(alive)) {
          if (Date.now() > gone) throw new Error(`fake gits outlived bun: ${pids.filter(alive)}`);
          await Bun.sleep(10);
        }
      } else {
        rmSync(running, { force: true });
        while (lineCount(exited) < pids.length) {
          if (Date.now() > gone) throw new Error(`${lineCount(exited)} of ${pids.length} fake gits exited`);
          await Bun.sleep(10);
        }
      }
      expect({ signalCode: proc.signalCode, gitGotSigint: existsSync(gotSigint) }).toEqual({
        signalCode: "SIGINT",
        gitGotSigint: false,
      });
    } finally {
      rmSync(running, { force: true });
    }
  },
);
