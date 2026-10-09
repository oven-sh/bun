// Tests for installing git dependencies that live in ONE repository as
// multiple branches (issue #35420), `git+file://` dependencies, and
// tarball-URL / `github:` dependencies that appear both directly and
// transitively (issues #10915, #8501, #11348, #28284). Everything is local:
// a bare repo on disk (served over git's dumb HTTP protocol by Bun.serve
// when an http URL is needed) or tarballs built in memory.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isLinux, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "path";
import { pathToFileURL } from "url";

const gitEnv: NodeJS.Dict<string> = {
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

async function runBun(cwd: string, cacheDir: string, extraEnv: Record<string, string>, ...args: string[]) {
  const env: NodeJS.Dict<string> = { ...gitEnv, ...extraEnv, BUN_INSTALL_CACHE_DIR: cacheDir };
  // Set on ASAN CI lanes; it arms a subreaper around internal git spawns that
  // SIGKILLs concurrent clone tasks (see #33982). This test exercises install
  // task bookkeeping, not orphan reaping.
  delete env.BUN_FEATURE_FLAG_NO_ORPHANS;
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function runInstall(cwd: string, cacheDir: string, extraEnv: Record<string, string>, ...args: string[]) {
  return runBun(cwd, cacheDir, extraEnv, "install", ...args);
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
    const env: typeof gitEnv = { ...gitEnv, BUN_INSTALL_CACHE_DIR: join(root, "cache"), PATH: `${bin}:${gitEnv.PATH}` };
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

// bun.lock holds the commit a branch resolved to. When the dependency's line
// in package.json moves to another group, bun resolves the line again. That
// must keep the locked commit; only `bun update` follows the branch. The
// isolated linker, on a cold cache, gets its checkout from the clone that the
// install phase starts.
for (const linker of ["hoisted", "isolated"] as const) {
  test.concurrent(
    `${linker} linker keeps the locked commit of a branch when the dependency line moves`,
    async () => {
      using dir = tempDir(`git-dep-${linker}-line-moved`, {});
      const root = String(dir);

      await using server = serveStatic(root);
      const repoUrl = `git+http://localhost:${server.port}/shared-repo.git`;
      const bare = await makeSharedRepo(root, [{ name: nameOf("m"), branch: "pkg-m" }]);
      // `bun update` fetches the repository again, and a fetch needs a HEAD that exists
      await git(bare, "symbolic-ref", "HEAD", "refs/heads/pkg-m");
      const { locked } = expectedGitPackages(repoUrl, branchCommits(bare), ["m"]);
      const spec = `${repoUrl}#pkg-m`;
      const project = writeProject(root, { [nameOf("m")]: spec });

      const first = await runInstall(project, join(root, "cache-warm"), {}, `--linker=${linker}`);
      expect(await lockedPackages(project)).toEqual(locked);
      expect(first.exitCode).toBe(0);

      await moveBranch(bare, "pkg-m", "pkg-m-v2");
      const moved = expectedGitPackages(repoUrl, branchCommits(bare), ["m"]).locked;
      expect(moved).not.toEqual(locked);

      // the line moves to devDependencies; a cold cache, as on another machine
      writeFileSync(
        join(project, "package.json"),
        JSON.stringify({ name: "project", version: "1.0.0", devDependencies: { [nameOf("m")]: spec } }),
      );
      rmSync(join(project, "node_modules"), { recursive: true });
      const install = await runInstall(project, join(root, "cache-cold"), {}, `--linker=${linker}`);
      expect(install.stderr).not.toContain("error:");
      expect(await installedVersions(project, [nameOf("m")])).toEqual(markers(["m"]));
      expect(await lockedPackages(project)).toEqual(locked);
      expect(install.exitCode).toBe(0);

      const update = await runBun(project, join(root, "cache-cold"), {}, "update", `--linker=${linker}`);
      expect(update.stderr).not.toContain("error:");
      expect(await installedVersions(project, [nameOf("m")])).toEqual({ [nameOf("m")]: "pkg-m-v2" });
      expect(await lockedPackages(project)).toEqual(moved);
      expect(update.exitCode).toBe(0);
    },
    30_000,
  );
}

// One bun.lock can hold one branch on two commits: the root and a workspace
// member declare `#pkg-m`, the branch moves, and `bun update` runs for the
// root only. When the member's line then moves to another group, it keeps the
// member's commit. It does not take the commit the root's line holds for the
// same ref, which is also what the branch resolves to by then.
test.concurrent(
  "a moved dependency line keeps its own commit when bun.lock holds its branch on two commits",
  async () => {
    using dir = tempDir("git-dep-two-commits", {});
    const root = String(dir);

    await using server = serveStatic(root);
    const repoUrl = `git+http://localhost:${server.port}/shared-repo.git`;
    const bare = await makeSharedRepo(root, [{ name: nameOf("m"), branch: "pkg-m" }]);
    // `bun update` fetches the repository again, and a fetch needs a HEAD that exists
    await git(bare, "symbolic-ref", "HEAD", "refs/heads/pkg-m");
    const spec = `${repoUrl}#pkg-m`;
    const name = nameOf("m");

    const project = join(root, "project");
    const member = join(project, "packages", "member");
    mkdirSync(member, { recursive: true });
    writeFileSync(
      join(project, "package.json"),
      JSON.stringify({ name: "project", version: "1.0.0", workspaces: ["packages/*"], dependencies: { [name]: spec } }),
    );
    const writeMember = (group: string) =>
      writeFileSync(
        join(member, "package.json"),
        JSON.stringify({ name: "member", version: "1.0.0", [group]: { [name]: spec } }),
      );
    writeMember("dependencies");

    const first = await runInstall(project, join(root, "cache-first"), {});
    expect(first.exitCode).toBe(0);
    const memberCommit = branchCommits(bare)["pkg-m"];

    // a clone made after the branch moved, so `bun update` sees the new commit
    await moveBranch(bare, "pkg-m", "pkg-m-v2");
    const rootCommit = branchCommits(bare)["pkg-m"];
    const cache = join(root, "cache-moved");
    const update = await runBun(project, cache, {}, "update", name);
    expect(update.stderr).not.toContain("error:");
    expect(update.exitCode).toBe(0);
    const split = {
      [name]: [`${name}@${repoUrl}#${rootCommit}`, {}, rootCommit],
      member: ["member@workspace:packages/member"],
      [`member/${name}`]: [`${name}@${repoUrl}#${memberCommit}`, {}, memberCommit],
    };
    expect(await lockedPackages(project)).toEqual(split);

    writeMember("devDependencies");
    rmSync(join(project, "node_modules"), { recursive: true, force: true });
    rmSync(join(member, "node_modules"), { recursive: true, force: true });

    const install = await runInstall(project, cache, {});
    expect(install.stderr).not.toContain("error:");
    expect({
      root: await installedVersionOf(project, name),
      member: await installedVersionOf(member, name),
      locked: await lockedPackages(project),
    }).toEqual({ root: "pkg-m-v2", member: "pkg-m", locked: split });
    expect(install.exitCode).toBe(0);
  },
  30_000,
);

// bun.lock pins a `github:` dependency by the commit in its tarball's root
// directory and by the sha512 of the tarball. The tests below make bun resolve
// the dependency again (its line in package.json moves or is renamed, another
// workspace declares it, `bun update` runs) after the GitHub API started to
// serve something else for the ref. The API is a local server: bun asks
// `GITHUB_API_URL` for `/repos/<owner>/<repo>/tarball/<ref>`.
const gh = {
  owner: "pinned-owner",
  repo: "pinned-repo",
  name: "pinned-gh-pkg",
  locked: "aaa1111",
  moved: "bbb2222",
};
const ghFullSha = gh.locked + Buffer.alloc(33, "0").toString();

// The archive GitHub serves for a commit: one root directory named after it.
function ghArchive(
  commit: string,
  marker: string,
  repo = gh.repo,
  name = gh.name,
  dependencies?: Record<string, string>,
) {
  return tarballOf(`${gh.owner}-${repo}-${commit}`, packageFiles(name, marker, dependencies));
}

// How package.json can write the dependency. `ref` is what bun asks the API for.
const ghSpellings = [
  { title: "a short commit hash", spec: `github:${gh.owner}/${gh.repo}#${gh.locked}`, ref: gh.locked },
  { title: "a full commit hash", spec: `github:${gh.owner}/${gh.repo}#${ghFullSha}`, ref: ghFullSha },
  { title: "a branch", spec: `github:${gh.owner}/${gh.repo}#main`, ref: "main" },
  { title: "a tag", spec: `github:${gh.owner}/${gh.repo}#v1.0.0`, ref: "v1.0.0" },
  { title: "no ref", spec: `github:${gh.owner}/${gh.repo}`, ref: "" },
];

function ghFixture() {
  const dir = tempDir("github-pin", {});
  const root = String(dir);
  const project = join(root, "project");
  mkdirSync(project);
  // `<repo>/<ref>` -> the archive the API serves for it
  const refs = new Map<string, Uint8Array>();
  // every ref bun asked the API for
  const asked: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const request = new URL(req.url).pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/tarball\/?(.*)$/);
      if (request) asked.push(request[3]);
      const archive = request?.[1] === gh.owner ? refs.get(`${request[2]}/${request[3]}`) : undefined;
      return archive ? new Response(archive) : new Response("not found", { status: 404 });
    },
  });

  return {
    project,
    asked,
    serve: (ref: string, archive: Uint8Array, repo = gh.repo) => refs.set(`${repo}/${ref}`, archive),
    manifest(manifest: Record<string, unknown>, at = ".") {
      mkdirSync(join(project, at), { recursive: true });
      writeFileSync(join(project, at, "package.json"), JSON.stringify({ name: "root", version: "1.0.0", ...manifest }));
    },
    /** "cold" is a cache that has never held the tarball, "warm" is the cache of the first install. */
    bun: (cache: "cold" | "warm", ...args: string[]) =>
      runBun(
        project,
        join(root, `cache-${cache}`),
        // a registry request would also come here, and get a 404
        { GITHUB_API_URL: `http://localhost:${server.port}`, BUN_CONFIG_REGISTRY: `http://localhost:${server.port}/` },
        ...args,
      ),
    removeNodeModules() {
      for (const at of [".", join("packages", "member")]) {
        rmSync(join(project, at, "node_modules"), { recursive: true, force: true });
      }
    },
    async [Symbol.asyncDispose]() {
      await server.stop(true);
      dir[Symbol.dispose]();
    },
  };
}

/** A project whose bun.lock pins the dependency at commit `gh.locked`, marker "v1". node_modules is removed again. */
async function ghPinned(spelling: (typeof ghSpellings)[number], manifest?: Record<string, unknown>) {
  const fx = ghFixture();
  const archive = await ghArchive(gh.locked, "v1");
  fx.serve(spelling.ref, archive);
  // An install from bun.lock asks for the commit it holds.
  fx.serve(gh.locked, archive);
  fx.manifest(manifest ?? { dependencies: { [gh.name]: spelling.spec } });
  const first = await fx.bun("warm", "install");
  expect(first.stderr).not.toContain("error:");
  expect(first.exitCode).toBe(0);
  const pinnedEntry = (await lockedPackages(fx.project))[gh.name];
  expect(pinnedEntry.slice(2)).toEqual([`${gh.owner}-${gh.repo}-${gh.locked}`, integrityOf(archive)]);
  fx.removeNodeModules();
  return Object.assign(fx, { pinnedEntry, pinnedLock: readFileSync(join(fx.project, "bun.lock"), "utf8") });
}

for (const spelling of ghSpellings) {
  // The same commit, other bytes: a tarball that is not the one bun.lock pins.
  for (const [act, args, manifest, key] of [
    ["its line moves to devDependencies", ["install"], { devDependencies: { [gh.name]: spelling.spec } }, gh.name],
    ["its line moves to devDependencies", ["ci"], { devDependencies: { [gh.name]: spelling.spec } }, gh.name],
    ["its key is renamed", ["install"], { dependencies: { "renamed-key": spelling.spec } }, "renamed-key"],
  ] as const) {
    test.concurrent(
      `a github: dependency written as ${spelling.title} refuses changed bytes at the locked commit when ${act}: bun ${args.join(" ")}`,
      async () => {
        await using pin = await ghPinned(spelling);
        const changed = await ghArchive(gh.locked, "v2");
        pin.serve(spelling.ref, changed);
        pin.serve(gh.locked, changed);
        pin.manifest(manifest);

        const { stdout, stderr, exitCode } = await pin.bun("cold", ...args);

        expect({
          installed: await installedVersionOf(pin.project, key),
          lock: readFileSync(join(pin.project, "bun.lock"), "utf8"),
        }).toEqual({ installed: null, lock: pin.pinnedLock });
        expect(stdout + stderr).toContain("Integrity check failed");
        expect(exitCode).toBe(1);
      },
      30_000,
    );
  }

  test.concurrent(
    `a github: dependency written as ${spelling.title} refuses changed bytes at the locked commit when a new workspace member declares it`,
    async () => {
      await using pin = await ghPinned(spelling, {
        workspaces: ["packages/*"],
        dependencies: { [gh.name]: spelling.spec },
      });
      const changed = await ghArchive(gh.locked, "v2");
      pin.serve(spelling.ref, changed);
      pin.serve(gh.locked, changed);
      pin.manifest({ name: "member", dependencies: { [gh.name]: spelling.spec } }, join("packages", "member"));

      const { stdout, stderr, exitCode } = await pin.bun("cold", "install");

      // The isolated linker saves bun.lock before it installs. The package's entry keeps its pin.
      expect({
        root: await installedVersionOf(pin.project, gh.name),
        member: await installedVersionOf(join(pin.project, "packages", "member"), gh.name),
        locked: (await lockedPackages(pin.project))[gh.name],
      }).toEqual({ root: null, member: null, locked: pin.pinnedEntry });
      expect(stdout + stderr).toContain("Integrity check failed");
      expect(exitCode).toBe(1);
    },
    30_000,
  );
}

// `bun update` asks for the bytes the ref has now. bun.lock then pins what was installed.
for (const spelling of ghSpellings) {
  test.concurrent(
    `bun update takes changed bytes at the locked commit of a github: dependency written as ${spelling.title}, and bun.lock pins them`,
    async () => {
      await using pin = await ghPinned(spelling);
      const changed = await ghArchive(gh.locked, "v2");
      pin.serve(spelling.ref, changed);
      pin.serve(gh.locked, changed);

      const { stderr, exitCode } = await pin.bun("cold", "update");

      expect(stderr).not.toContain("error:");
      expect({
        installed: await installedVersionOf(pin.project, gh.name),
        locked: (await lockedPackages(pin.project))[gh.name].slice(2),
      }).toEqual({ installed: "v2", locked: [`${gh.owner}-${gh.repo}-${gh.locked}`, integrityOf(changed)] });
      expect(exitCode).toBe(0);
    },
    30_000,
  );
}

// The full hash of a commit names the same commit as the short hash bun.lock holds.
test.concurrent(
  "a github: dependency refuses changed bytes at the locked commit when a new workspace member writes that commit as a full hash",
  async () => {
    const [short, full] = ghSpellings;
    await using pin = await ghPinned(short, { workspaces: ["packages/*"], dependencies: { [gh.name]: short.spec } });
    const changed = await ghArchive(gh.locked, "v2");
    pin.serve(short.ref, changed);
    pin.serve(full.ref, changed);
    pin.manifest({ name: "member", dependencies: { [gh.name]: full.spec } }, join("packages", "member"));

    const { stdout, stderr, exitCode } = await pin.bun("cold", "install");

    expect({
      root: await installedVersionOf(pin.project, gh.name),
      member: await installedVersionOf(join(pin.project, "packages", "member"), gh.name),
      locked: (await lockedPackages(pin.project))[gh.name],
    }).toEqual({ root: null, member: null, locked: pin.pinnedEntry });
    expect(stdout + stderr).toContain("Integrity check failed");
    expect(exitCode).toBe(1);
  },
  30_000,
);

// A bun.lockb keeps the ref a `github:` dependency was declared with, beside
// the commit it resolved to. The pin is for that commit. An install fetches
// the commit, and only `bun update` asks for the ref again.
{
  const branch = ghSpellings.find(spelling => spelling.ref === "main")!;

  /** A project whose bun.lockb pins the branch at commit `gh.locked`, marker "v1". The branch then moves to `gh.moved`, marker "v2". */
  async function ghPinnedBinary() {
    const fx = ghFixture();
    writeFileSync(join(fx.project, "bunfig.toml"), "[install]\nsaveTextLockfile = false\n");
    const archive = await ghArchive(gh.locked, "v1");
    fx.serve(branch.ref, archive);
    fx.serve(gh.locked, archive);
    fx.manifest({ dependencies: { [gh.name]: branch.spec } });
    const first = await fx.bun("warm", "install");
    expect(first.stderr).not.toContain("error:");
    expect(existsSync(join(fx.project, "bun.lockb"))).toBe(true);
    expect(first.exitCode).toBe(0);
    fx.removeNodeModules();

    const moved = await ghArchive(gh.moved, "v2");
    fx.serve(branch.ref, moved);
    fx.serve(gh.moved, moved);
    fx.asked.length = 0;
    return fx;
  }

  for (const [act, manifest] of [
    ["with no edit", undefined],
    ["when its line moves", { devDependencies: { [gh.name]: branch.spec } }],
  ] as const) {
    test.concurrent(
      `an install from bun.lockb fetches the locked commit of a github: branch ${act}`,
      async () => {
        await using fx = await ghPinnedBinary();
        if (manifest) fx.manifest(manifest);

        const { stderr, exitCode } = await fx.bun("cold", "install");

        expect(stderr).not.toContain("error:");
        expect({ installed: await installedVersionOf(fx.project, gh.name), asked: fx.asked }).toEqual({
          installed: "v1",
          asked: [gh.locked],
        });
        expect(exitCode).toBe(0);
      },
      30_000,
    );
  }

  test.concurrent(
    "bun update moves a github: branch that bun.lockb holds",
    async () => {
      await using fx = await ghPinnedBinary();

      const { stderr, exitCode } = await fx.bun("cold", "update");

      expect(stderr).not.toContain("error:");
      expect({ installed: await installedVersionOf(fx.project, gh.name), asked: fx.asked }).toEqual({
        installed: "v2",
        asked: [branch.ref],
      });
      expect(exitCode).toBe(0);
    },
    30_000,
  );
}

// A catalog or an override can supply the `github:` version. The line in
// package.json then holds `catalog:` or a range, and the edge that bun.lock
// held for that line tells which commit the branch is locked to.
{
  const branch = ghSpellings.find(spelling => spelling.ref === "main")!;
  const member = join("packages", "member");

  for (const { title, root, line } of [
    {
      title: "a catalog",
      root: { workspaces: { packages: ["packages/*"], catalog: { [gh.name]: branch.spec } } },
      line: "catalog:",
    },
    {
      title: "an override",
      root: { workspaces: ["packages/*"], overrides: { [gh.name]: branch.spec } },
      line: "1.0.0",
    },
  ]) {
    /** bun.lock pins the branch at commit `gh.locked`, marker "v1". The member's line then moves to devDependencies. */
    async function ghPinnedThrough() {
      const fx = ghFixture();
      const archive = await ghArchive(gh.locked, "v1");
      fx.serve(branch.ref, archive);
      fx.serve(gh.locked, archive);
      fx.manifest(root);
      fx.manifest({ name: "member", dependencies: { [gh.name]: line } }, member);
      const first = await fx.bun("warm", "install");
      expect(first.stderr).not.toContain("error:");
      expect(first.exitCode).toBe(0);
      const pinnedEntry = (await lockedPackages(fx.project))[gh.name];
      expect(pinnedEntry.slice(2)).toEqual([`${gh.owner}-${gh.repo}-${gh.locked}`, integrityOf(archive)]);
      fx.removeNodeModules();
      fx.manifest({ name: "member", devDependencies: { [gh.name]: line } }, member);
      const installed = async () =>
        (await installedVersionOf(join(fx.project, member), gh.name)) ??
        (await installedVersionOf(fx.project, gh.name));
      return Object.assign(fx, { pinnedEntry, installed });
    }

    for (const args of [["install"], ["install", "--frozen-lockfile"]]) {
      test.concurrent(
        `a github: branch that ${title} supplies refuses changed bytes at the locked commit when its line moves: bun ${args.join(" ")}`,
        async () => {
          await using pin = await ghPinnedThrough();
          const changed = await ghArchive(gh.locked, "v2");
          pin.serve(branch.ref, changed);
          pin.serve(gh.locked, changed);

          const { stdout, stderr, exitCode } = await pin.bun("cold", ...args);

          expect({
            installed: await pin.installed(),
            locked: (await lockedPackages(pin.project))[gh.name],
          }).toEqual({ installed: null, locked: pin.pinnedEntry });
          expect(stdout + stderr).toContain("Integrity check failed");
          expect(exitCode).toBe(1);
        },
        30_000,
      );
    }

    test.concurrent(
      `a github: branch that ${title} supplies stays on the locked commit when its line moves and the branch moved`,
      async () => {
        await using pin = await ghPinnedThrough();
        pin.serve(branch.ref, await ghArchive(gh.moved, "v2"));

        const { stderr, exitCode } = await pin.bun("cold", "install");

        expect(stderr).not.toContain("error:");
        expect({
          installed: await pin.installed(),
          locked: (await lockedPackages(pin.project))[gh.name],
        }).toEqual({ installed: "v1", locked: pin.pinnedEntry });
        expect(exitCode).toBe(0);
      },
      30_000,
    );
  }
}

// A branch, a tag and a repository's default branch can move to another commit.
for (const spelling of ghSpellings.filter(spelling => !spelling.ref.startsWith(gh.locked))) {
  for (const args of [["install"], ["install", "--frozen-lockfile"]]) {
    test.concurrent(
      `a github: dependency written as ${spelling.title} stays on the locked commit when its line moves and the ref moved: bun ${args.join(" ")}`,
      async () => {
        await using pin = await ghPinned(spelling);
        pin.serve(spelling.ref, await ghArchive(gh.moved, "v2"));
        pin.manifest({ devDependencies: { [gh.name]: spelling.spec } });

        const { stderr, exitCode } = await pin.bun("cold", ...args);

        expect(stderr).not.toContain("error:");
        expect({
          installed: await installedVersionOf(pin.project, gh.name),
          locked: (await lockedPackages(pin.project))[gh.name],
        }).toEqual({ installed: "v1", locked: pin.pinnedEntry });
        expect(exitCode).toBe(0);
      },
      30_000,
    );
  }

  test.concurrent(
    `a github: dependency written as ${spelling.title} moves to the new commit with bun update`,
    async () => {
      await using pin = await ghPinned(spelling);
      const moved = await ghArchive(gh.moved, "v2");
      pin.serve(spelling.ref, moved);
      pin.serve(gh.moved, moved);

      const { stderr, exitCode } = await pin.bun("cold", "update");

      expect(stderr).not.toContain("error:");
      expect({
        installed: await installedVersionOf(pin.project, gh.name),
        locked: (await lockedPackages(pin.project))[gh.name].slice(2),
      }).toEqual({ installed: "v2", locked: [`${gh.owner}-${gh.repo}-${gh.moved}`, integrityOf(moved)] });
      expect(exitCode).toBe(0);
    },
    30_000,
  );
}

// A `github:` dependency can declare another one. When the parent's line
// moves, a plain install resolves the parent again and keeps both on their
// locked commits. `bun update` still follows both branches.
{
  const child = { repo: "child-repo", name: "child-gh-pkg", locked: "ccc1111", moved: "ddd2222" };
  const spec = `github:${gh.owner}/${gh.repo}#main`;

  async function ghNested() {
    const fx = ghFixture();
    const serve = async (parentCommit: string, childCommit: string) => {
      const parentArchive = await ghArchive(parentCommit, `parent-${parentCommit}`, gh.repo, gh.name, {
        [child.name]: `github:${gh.owner}/${child.repo}#main`,
      });
      const childArchive = await ghArchive(childCommit, `child-${childCommit}`, child.repo, child.name);
      for (const ref of ["main", parentCommit]) fx.serve(ref, parentArchive);
      for (const ref of ["main", childCommit]) fx.serve(ref, childArchive, child.repo);
    };
    await serve(gh.locked, child.locked);
    fx.manifest({ dependencies: { [gh.name]: spec } });
    const first = await fx.bun("warm", "install");
    expect(first.stderr).not.toContain("error:");
    expect(first.exitCode).toBe(0);
    fx.removeNodeModules();
    // both branches move
    await serve(gh.moved, child.moved);
    const tags = async () => {
      const packages = await lockedPackages(fx.project);
      return { parent: packages[gh.name][2], child: packages[child.name][2] };
    };
    return Object.assign(fx, { tags });
  }

  test.concurrent(
    "a plain install keeps a github: dependency and the one it declares on their commits when the line moves",
    async () => {
      await using fx = await ghNested();
      fx.manifest({ devDependencies: { [gh.name]: spec } });

      const { stderr, exitCode } = await fx.bun("cold", "install");

      expect(stderr).not.toContain("error:");
      expect(await fx.tags()).toEqual({
        parent: `${gh.owner}-${gh.repo}-${gh.locked}`,
        child: `${gh.owner}-${child.repo}-${child.locked}`,
      });
      expect(exitCode).toBe(0);
    },
    30_000,
  );

  for (const args of [["update"], ["update", gh.name]]) {
    test.concurrent(
      `bun ${args.join(" ")} moves a github: dependency and the one it declares to their new commits`,
      async () => {
        await using fx = await ghNested();

        const { stderr, exitCode } = await fx.bun("cold", ...args);

        expect(stderr).not.toContain("error:");
        expect(await fx.tags()).toEqual({
          parent: `${gh.owner}-${gh.repo}-${gh.moved}`,
          child: `${gh.owner}-${child.repo}-${child.moved}`,
        });
        expect(exitCode).toBe(0);
      },
      30_000,
    );
  }
}
