// Tests for installing git dependencies that live in ONE repository as
// multiple branches (issue #35420), `git+file://` dependencies,
// tarball-URL / `github:` dependencies that appear both directly and
// transitively (issues #10915, #8501, #11348, #28284), and git / tarball
// packages whose own package.json declares `file:` folder dependencies.
// Everything is local: a bare repo on disk (served over git's dumb HTTP
// protocol by Bun.serve when an http URL is needed) or tarballs built in memory.
import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { lstat, readdir, readlink } from "fs/promises";
import { bunEnv, bunExe, hostedGitRepository, isLinux, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { dirname, join, resolve } from "path";
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

const nullDevice = isWindows ? "NUL" : "/dev/null";

// `path` as one word of a `sh` script.
const quote = (path: string) => `'${path.replaceAll("'", "'\\''")}'`;

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
  /** Symbolic links committed to the branch: path -> target. */
  links?: Record<string, string>;
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
  links?: Record<string, string>;
}

function fastImportData(text: string) {
  return `data ${Buffer.byteLength(text)}\n${text}\n`;
}

// Writes the commits to the bare repo with a single `git fast-import`, so a
// fixture costs the same two processes however many refs it has, then
// regenerates the static files that dumb HTTP clients read.
async function commitTo(bare: string, commits: Commit[]) {
  let stream = "";
  for (const { ref, from, message, files, links } of commits) {
    stream += `commit ${ref}\n`;
    stream += `committer ${gitEnv.GIT_COMMITTER_NAME} <${gitEnv.GIT_COMMITTER_EMAIL}> 0 +0000\n`;
    stream += fastImportData(message);
    // `^0` makes fast-import look the name up in the repo instead of in this
    // stream, so a commit can extend the very ref it updates.
    if (from) stream += `from ${from}^0\n`;
    for (const [path, contents] of Object.entries(files)) {
      stream += `M 100644 inline ${path}\n${fastImportData(contents)}`;
    }
    for (const [path, target] of Object.entries(links ?? {})) {
      stream += `M 120000 inline ${path}\n${fastImportData(target)}`;
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
      links: pkg.links,
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

type OtherGroup = "optionalDependencies" | "peerDependencies";

function writeProject(
  root: string,
  dependencies: Record<string, string>,
  otherGroups: Partial<Record<OtherGroup, Record<string, string>>> = {},
): string {
  const project = join(root, "project");
  mkdirSync(project, { recursive: true });
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify({ name: "project", version: "1.0.0", dependencies, ...otherGroups }),
  );
  return project;
}

// Runs `bun <command...>`, for example `bun update <name>`. An `undefined` value
// in `extraEnv` removes that variable from its environment.
async function runBun(cwd: string, cacheDir: string, extraEnv: NodeJS.Dict<string>, ...command: string[]) {
  const env: NodeJS.Dict<string> = { ...gitEnv, ...extraEnv, BUN_INSTALL_CACHE_DIR: cacheDir };
  // Set on ASAN CI lanes; it arms a subreaper around internal git spawns that
  // SIGKILLs concurrent clone tasks (see #33982). This test exercises install
  // task bookkeeping, not orphan reaping.
  delete env.BUN_FEATURE_FLAG_NO_ORPHANS;
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...command],
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function runInstall(cwd: string, cacheDir: string, extraEnv: NodeJS.Dict<string>, ...args: string[]) {
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

// The marker that the index.js of the package in `folder` exports (null if absent).
async function markerIn(folder: string): Promise<string | null> {
  const file = Bun.file(join(folder, "index.js"));
  if (!(await file.exists())) return null;
  const text = await file.text();
  return JSON.parse(text.slice(text.indexOf("=") + 1, text.lastIndexOf(";")));
}

function installedVersionOf(dir: string, name: string): Promise<string | null> {
  return markerIn(join(dir, "node_modules", name));
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
    locked[name] = [
      `${name}@${repoUrl}#${sha}`,
      name in dependencies ? { version: "1.0.0", dependencies: dependencies[name] } : { version: "1.0.0" },
      sha,
    ];
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
    const dependencies = Object.fromEntries(letters.map(l => [nameOf(l), `${sharedRepoUrl}#pkg-${l}`]));
    const { resolutions, locked } = expectedGitPackages(sharedRepoUrl, sharedCommits, letters, {
      [nameOf("a")]: sharedTransitive,
    });

    // The race depends on thread pool scheduling, so two attempts with a fresh cache make the failure reliable without
    // the fix. Each attempt has its own project and cache so that both can run at once. A cold install of 16 git
    // packages spawns about 60 git processes, which is slow on Windows.
    const attempts = await Promise.all(
      [0, 1].map(async attempt => {
        const attemptRoot = join(root, `attempt-${attempt}`);
        const project = writeProject(attemptRoot, dependencies);
        return { project, ...(await runInstall(project, join(attemptRoot, "cache"), {})) };
      }),
    );
    for (const { project, stdout, stderr, exitCode } of attempts) {
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
        [
          `${nameOf(l)}@${urlOf(l)}`,
          l === "a" ? { version: "1.0.0", dependencies: transitive } : { version: "1.0.0" },
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
          l === "a" ? { version: "1.0.0", dependencies: transitive } : { version: "1.0.0" },
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

// The URL parser returns the committish of a GitHub dependency percent-decoded. A committish that was written with an
// escape was then dropped from the request: `#feat%2Fx` requested `/tarball/` (the default branch). Now it's sent as
// written, and GitHub decodes it.
test.concurrent("requests a github: dependency as written when its committish has a percent-escape", async () => {
  using dir = tempDir("github-dep-escapes", {});
  const root = String(dir);

  // letter -> [what package.json has for `@scope/pkg-<letter>`, the path bun must request]
  const cases: Record<string, [spec: string, path: string]> = {
    a: ["github:scope/pkg-a#feat%2Fx", "/repos/scope/pkg-a/tarball/feat%2Fx"],
    b: ["scope/pkg-b#feat%2Fx", "/repos/scope/pkg-b/tarball/feat%2Fx"],
    c: ["https://github.com/scope/pkg-c#feat%2Fx", "/repos/scope/pkg-c/tarball/feat%2Fx"],
    d: ["git+https://github.com/scope/pkg-d.git#feat%2Fx", "/repos/scope/pkg-d/tarball/feat%2Fx"],
    // the decoded `100%` is also a prefix of `100%25`, and `/tarball/100%` is not a valid path
    e: ["github:scope/pkg-e#100%25", "/repos/scope/pkg-e/tarball/100%25"],
    // the decoded committish is also the text in front of the `#`, written with no escape
    f: ["github:scope/pkg-f#scope%2Fpkg-f", "/repos/scope/pkg-f/tarball/scope%2Fpkg-f"],
  };
  const letters = Object.keys(cases);
  const tarballs = await packageTarballs(letters, {}, l => `scope-pkg-${l}-0000000`);

  const requests: string[] = [];
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      requests.push(pathname);
      const match = /^\/repos\/scope\/pkg-([a-z])\/tarball\//.exec(pathname);
      const tarball = match && tarballs.get(match[1]);
      return tarball ? new Response(tarball) : new Response("not found", { status: 404 });
    },
  });

  const project = writeProject(root, Object.fromEntries(letters.map(l => [nameOf(l), cases[l][0]])));
  const { stderr, exitCode } = await runInstall(project, join(root, "cache"), {
    GITHUB_API_URL: `http://localhost:${server.port}`,
  });
  expect(requests.sort()).toEqual(letters.map(l => cases[l][1]).sort());
  expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
    "Resolving dependencies
    Resolved, downloaded and extracted [12]
    Saved lockfile"
  `);
  expect(await installedVersions(project, letters.map(nameOf))).toEqual(markers(letters));
  expect(exitCode).toBe(0);
});

// If a part of a GitHub dependency couldn't be found in the form that the URL parser returns, it was left empty. An
// empty committish installed the default branch, and an empty owner requested `/repos//<repo>/`. Now such a dependency
// fails to resolve.
test.concurrent("does not request a github: dependency if a part of it can't be found", async () => {
  using dir = tempDir("github-dep-not-found", {});
  const root = String(dir);
  const tarball = await tarballOf("scope-pkg-a-0000000", packageFiles(nameOf("a"), "default-branch"));

  const requests: string[] = [];
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      requests.push(new URL(req.url).pathname);
      return new Response(tarball);
    },
  });

  const specs = {
    // the URL parser removes a tab and a line break
    a: "github:scope/pkg-a#fe\tat",
    // `feat` in front of the `#` is not the committish
    b: "github:scope/feat-b#fe\tat",
    c: "github:scope/pkg-c#main HTTP/1.1\r\nx: y",
    // no owner or repository on GitHub needs an escape
    d: "github:sc%6Fpe/pkg-d#main",
    e: "github:scope/pkg%2De#main",
  };
  const names = Object.keys(specs).map(nameOf);
  const project = writeProject(root, Object.fromEntries(Object.entries(specs).map(([l, spec]) => [nameOf(l), spec])));
  const { stderr, exitCode } = await runInstall(project, join(root, "cache"), {
    GITHUB_API_URL: `http://localhost:${server.port}`,
  });
  expect({ requests, installed: await installedVersions(project, names) }).toEqual({
    requests: [],
    installed: Object.fromEntries(names.map(name => [name, null])),
  });
  expect(diagnostics(stderr)).toEqual(names.map(name => `error: ${name}@ failed to resolve`));
  expect(exitCode).toBe(1);
});

// Each ref of a GitHub repository is a separate tarball download, and each extracted tarball became a new package. Refs
// that point to the same commit produced packages with the same name and resolution, which bun.lock stores as one
// package. The isolated linker linked all of them into the same store directory at once and failed at random with
// `EEXIST: File exists: failed to link package`.
//
// The fixture serves `testowner/testrepo` (gh-dep) and `testowner/leaf` (gh-leaf, a dependency of gh-dep). Every branch
// and tag of a repository returns the tarball of the commit in `heads`, so they all resolve to that commit. Bun reads
// the commit from the name of the tarball's root directory.
async function serveGithub() {
  const tarballs = {
    testrepo: {
      aaaaaaa: await tarballOf("testowner-testrepo-aaaaaaa", {
        ...packageFiles("gh-dep", "gh-dep", { "gh-leaf": "github:testowner/leaf#main" }),
        // more files to link widen the window in which the store entries collide
        ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`file-${i}.js`, indexJs(`file-${i}`)])),
      }),
    },
    leaf: {
      bbbbbbb: await tarballOf("testowner-leaf-bbbbbbb", packageFiles("gh-leaf", "gh-leaf")),
      ccccccc: await tarballOf("testowner-leaf-ccccccc", packageFiles("gh-leaf", "gh-leaf-moved")),
    },
  } as Record<string, Record<string, Uint8Array>>;
  const heads: Record<string, string> = { testrepo: "aaaaaaa", leaf: "bbbbbbb" };
  // `<repo>#<ref>` of every tarball request
  const downloads: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const match = /^\/repos\/testowner\/(testrepo|leaf)\/tarball\/(\w+)$/.exec(new URL(req.url).pathname);
      if (!match) return new Response("not found", { status: 404 });
      const [, repo, ref] = match;
      downloads.push(`${repo}#${ref}`);
      return new Response(tarballs[repo][ref] ?? tarballs[repo][heads[repo]]);
    },
  });
  const leafRow = (commit: string) => [
    `gh-leaf@github:testowner/leaf#${commit}`,
    { version: "1.0.0" },
    `testowner-leaf-${commit}`,
    integrityOf(tarballs.leaf[commit]),
  ];
  return {
    heads,
    downloads,
    env: { GITHUB_API_URL: `http://localhost:${server.port}` },
    // the bun.lock rows of the packages
    ghDep: [
      "gh-dep@github:testowner/testrepo#aaaaaaa",
      { version: "1.0.0", dependencies: { "gh-leaf": "github:testowner/leaf#main" } },
      "testowner-testrepo-aaaaaaa",
      integrityOf(tarballs.testrepo.aaaaaaa),
    ],
    ghLeaf: leafRow("bbbbbbb"),
    ghLeafMoved: leafRow("ccccccc"),
    [Symbol.asyncDispose]: () => server.stop(true),
  };
}

const ghDepStoreEntry = "gh-dep@github+testowner+testrepo+aaaaaaa";
const ghLeafStoreEntry = "gh-leaf@github+testowner+leaf+bbbbbbb";
// where the isolated linker puts gh-leaf for gh-dep, relative to node_modules
const ghLeafOfGhDep = join(".bun", ghDepStoreEntry, "node_modules", "gh-leaf");

// Checks what the isolated linker should leave in node_modules: one store entry for gh-dep, with gh-leaf linked next to
// it, and every alias linked to that entry.
function expectOneStoreEntry(project: string, aliases: string[]) {
  const modules = join(project, "node_modules");
  expect({
    store: readdirSync(join(modules, ".bun")).sort(),
    links: Object.fromEntries([...aliases, ghLeafOfGhDep].map(link => [link, readlinkSync(join(modules, link))])),
  }).toEqual({
    store: [ghDepStoreEntry, ghLeafStoreEntry, "node_modules"],
    links: {
      ...Object.fromEntries(aliases.map(alias => [alias, join(".bun", ghDepStoreEntry, "node_modules", "gh-dep")])),
      [ghLeafOfGhDep]: join("..", "..", ghLeafStoreEntry, "node_modules", "gh-leaf"),
    },
  });
}

// Skipped on Windows. The three extractions all end up in one cache folder, and on Windows an extraction that finds the
// folder taken moves it away (`move_to_cache_directory` in extract_tarball.rs) while another one is still reading its
// package.json. Occasionally that one creates a package with no name and no dependencies.
for (const linker of ["isolated", "hoisted"] as const) {
  test.concurrent.skipIf(isWindows)(
    `${linker} linker installs github: refs that point to one commit as one package`,
    async () => {
      using dir = tempDir(`github-one-commit-${linker}`, {});
      const root = String(dir);
      await using github = await serveGithub();
      const project = writeProject(root, {
        a: "github:testowner/testrepo#main",
        b: "github:testowner/testrepo#v1",
        c: "github:testowner/testrepo#other",
      });
      // the hoisted linker puts gh-leaf in the root node_modules
      const leaf = linker === "isolated" ? ghLeafOfGhDep : "gh-leaf";

      // The collision depends on thread pool scheduling, so two attempts with a fresh cache make the failure reliable
      // without the fix.
      for (let attempt = 0; attempt < 2; attempt++) {
        rmSync(join(project, "node_modules"), { recursive: true, force: true });
        rmSync(join(project, "bun.lock"), { force: true });
        github.downloads.length = 0;
        const { stdout, stderr, exitCode } = await runInstall(
          project,
          join(root, `cache-${attempt}`),
          github.env,
          `--linker=${linker}`,
        );
        expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
          "Resolving dependencies
          Resolved, downloaded and extracted [8]
          Saved lockfile"
        `);
        // the two packages are gh-dep and gh-leaf
        expect(installOutput(stdout)).toEqual([
          expect.stringContaining("bun install v"),
          "",
          "+ a@github:testowner/testrepo#aaaaaaa",
          "+ b@github:testowner/testrepo#aaaaaaa",
          "+ c@github:testowner/testrepo#aaaaaaa",
          "",
          "2 packages installed",
        ]);
        expect(github.downloads.sort()).toEqual(["leaf#main", "testrepo#main", "testrepo#other", "testrepo#v1"]);
        if (linker === "isolated") expectOneStoreEntry(project, ["a", "b", "c"]);
        expect(await installedVersions(project, ["a", "b", "c", leaf])).toEqual({
          a: "gh-dep",
          b: "gh-dep",
          c: "gh-dep",
          [leaf]: "gh-leaf",
        });
        expect(await lockedPackages(project)).toEqual({
          a: github.ghDep,
          b: github.ghDep,
          c: github.ghDep,
          "gh-leaf": github.ghLeaf,
        });
        expect(exitCode).toBe(0);
      }
    },
    30_000,
  );
}

// The same for a repository whose package.json has no name, or that has no package.json. The package is named after the
// repository, for every ref. The last column is the version that bun.lock records.
test.concurrent.skipIf(isWindows).each([
  ["a package.json without a name", { "package.json": JSON.stringify({ version: "1.0.0" }) }, "1.0.0"],
  ["no package.json", {}, ""],
])(
  "isolated linker installs github: refs that point to one commit of a repository with %s as one package",
  async (_, manifest, version) => {
    using dir = tempDir("github-one-commit-nameless", {});
    const root = String(dir);
    const tarball = await tarballOf("testowner-nameless-ddddddd", { ...manifest, "index.js": indexJs("nameless") });
    await using server = Bun.serve({ port: 0, fetch: () => new Response(tarball) });
    const project = writeProject(root, { a: "github:testowner/nameless#main", b: "github:testowner/nameless#v1" });
    const row = [
      "nameless@github:testowner/nameless#ddddddd",
      { version },
      "testowner-nameless-ddddddd",
      integrityOf(tarball),
    ];

    const { stdout, stderr, exitCode } = await runInstall(
      project,
      join(root, "cache"),
      { GITHUB_API_URL: `http://localhost:${server.port}` },
      "--linker=isolated",
    );
    expect(diagnostics(stderr)).toEqual([]);
    expect(installOutput(stdout)).toEqual([
      expect.stringContaining("bun install v"),
      "",
      "+ a@github:testowner/nameless#ddddddd",
      "+ b@github:testowner/nameless#ddddddd",
      "",
      "1 package installed",
    ]);
    expect(await installedVersions(project, ["a", "b"])).toEqual({ a: "nameless", b: "nameless" });
    expect(await lockedPackages(project)).toEqual({ a: row, b: row });
    expect(exitCode).toBe(0);
  },
);

// The same collision with a lockfile: the locked package and the package for a new ref to the same commit were two
// packages.
test.concurrent(
  "isolated linker reuses a locked github: package for a new ref to the same commit",
  async () => {
    using dir = tempDir("github-one-commit-locked", {});
    const root = String(dir);
    await using github = await serveGithub();

    const project = writeProject(root, { a: "github:testowner/testrepo#main" });
    {
      const { stderr, exitCode } = await runInstall(project, join(root, "cache-warm"), github.env, "--linker=isolated");
      expect(stderr).toContain("Saved lockfile");
      expect(await lockedPackages(project)).toEqual({ a: github.ghDep, "gh-leaf": github.ghLeaf });
      expect(exitCode).toBe(0);
    }

    // Simulate a fresh machine that adds a second ref: keep bun.lock, delete node_modules and the cache. gh-leaf's
    // branch has moved in the meantime, and bun.lock pins its old commit.
    writeProject(root, { a: "github:testowner/testrepo#main", b: "github:testowner/testrepo#v1" });
    rmSync(join(project, "node_modules"), { recursive: true });
    github.heads.leaf = "ccccccc";
    github.downloads.length = 0;
    const { stdout, stderr, exitCode } = await runInstall(
      project,
      join(root, "cache-cold"),
      github.env,
      "--linker=isolated",
    );
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
      "Resolving dependencies
      Resolved, downloaded and extracted [2]
      Saved lockfile"
    `);
    expect(installOutput(stdout)).toEqual([
      expect.stringContaining("bun install v"),
      "",
      "+ a@github:testowner/testrepo#aaaaaaa",
      "+ b@github:testowner/testrepo#aaaaaaa",
      "",
      "2 packages installed",
    ]);
    // the tarball of the new ref fills the cache entry of the locked commit,
    // and gh-leaf installs from the commit that bun.lock pins
    expect(github.downloads.sort()).toEqual(["leaf#bbbbbbb", "testrepo#v1"]);
    expectOneStoreEntry(project, ["a", "b"]);
    expect(await installedVersions(project, [ghLeafOfGhDep])).toEqual({ [ghLeafOfGhDep]: "gh-leaf" });
    expect(await lockedPackages(project)).toEqual({ a: github.ghDep, b: github.ghDep, "gh-leaf": github.ghLeaf });
    expect(exitCode).toBe(0);
  },
  30_000,
);

// `bun update` fetches the git and `github:` dependencies of the project again.
// The dependencies of such a package resolve again too, also when its own
// commit did not move, so a nested branch ref follows its branch.
for (const parent of ["github:", "git+"] as const) {
  test.concurrent(
    `bun update moves a nested github: ref when the commit of its ${parent} parent hasn't moved`,
    async () => {
      using dir = tempDir("git-update-nested", {});
      const root = String(dir);
      await using github = await serveGithub();
      let spec = "github:testowner/testrepo#main";
      let parentRow = github.ghDep;
      if (parent === "git+") {
        const dependencies = { "gh-leaf": "github:testowner/leaf#main" };
        const bare = await makeSharedRepo(root, [{ name: "git-dep", branch: "main", dependencies }], "parent.git");
        // `bun update` fetches HEAD into the cached clone
        await git(bare, "symbolic-ref", "HEAD", "refs/heads/main");
        const repoUrl = `git+${pathToFileURL(bare)}`;
        const sha = branchCommits(bare).main;
        spec = `${repoUrl}#main`;
        parentRow = [`git-dep@${repoUrl}#${sha}`, { version: "1.0.0", dependencies }, sha];
      }
      const project = writeProject(root, { a: spec });
      {
        const { stderr, exitCode } = await runInstall(project, join(root, "cache"), github.env);
        expect(stderr).toContain("Saved lockfile");
        expect(await lockedPackages(project)).toEqual({ a: parentRow, "gh-leaf": github.ghLeaf });
        expect(exitCode).toBe(0);
      }

      github.heads.leaf = "ccccccc";
      const { stderr, exitCode } = await runBun(project, join(root, "cache"), github.env, "update");
      expect(stderr).toContain("Saved lockfile");
      expect(await installedVersionOf(project, "gh-leaf")).toBe("gh-leaf-moved");
      expect(await lockedPackages(project)).toEqual({ a: parentRow, "gh-leaf": github.ghLeafMoved });
      expect(exitCode).toBe(0);
    },
    30_000,
  );
}

// The same with `git+`. The checkout task is keyed by the resolved commit, so two refs to one commit share one task and
// one package.
test.concurrent(
  "isolated linker reuses a locked git package for a new ref on its commit",
  async () => {
    using dir = tempDir("git-one-commit-locked", {});
    const root = String(dir);
    const bare = await makeSharedRepo(root, [{ name: "git-dep", branch: "main" }], "one-commit.git");
    await git(bare, "branch", "v1", "main");
    const repoUrl = `git+${pathToFileURL(bare)}`;
    const sha = branchCommits(bare).main;
    const gitDep = [`git-dep@${repoUrl}#${sha}`, { version: "1.0.0" }, sha];

    const project = writeProject(root, { a: `${repoUrl}#main` });
    {
      const { stderr, exitCode } = await runInstall(project, join(root, "cache-warm"), {}, "--linker=isolated");
      expect(stderr).toContain("Saved lockfile");
      expect(await lockedPackages(project)).toEqual({ a: gitDep });
      expect(exitCode).toBe(0);
    }

    writeProject(root, { a: `${repoUrl}#main`, b: `${repoUrl}#v1` });
    rmSync(join(project, "node_modules"), { recursive: true });
    const { stdout, stderr, exitCode } = await runInstall(project, join(root, "cache-cold"), {}, "--linker=isolated");
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
      "Resolving dependencies
      Resolved, downloaded and extracted [2]
      Saved lockfile"
    `);
    expect(installOutput(stdout)).toEqual([
      expect.stringContaining("bun install v"),
      "",
      `+ a@${repoUrl}#${sha}`,
      `+ b@${repoUrl}#${sha}`,
      "",
      "1 package installed",
    ]);
    expect(await installedVersions(project, ["a", "b"])).toEqual({ a: "main", b: "main" });
    expect(await lockedPackages(project)).toEqual({ a: gitDep, b: gitDep });
    expect(exitCode).toBe(0);
  },
  30_000,
);

// The tarball-URL twin. A dependency has no package name before its first
// extract, so the lookup before the download misses the package that bun.lock
// holds for the URL, and the extract made a second one. A dependency on the URL
// that was enqueued after that download had finished bound to the second one.
test.concurrent(
  "isolated linker reuses a locked tarball-URL package for a dependency that is enqueued after its download",
  async () => {
    using dir = tempDir("tarball-one-url-locked", {});
    const root = String(dir);

    // the tarballs embed the server's URL, so they are built once it listens
    let tarballs: Record<string, Uint8Array>;
    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        const tarball = tarballs[new URL(req.url).pathname];
        return tarball ? new Response(tarball) : new Response("not found", { status: 404 });
      },
    });
    const urlOf = (name: string) => `http://localhost:${server.port}/${name}.tgz`;
    tarballs = {
      "/tb-dep.tgz": await tarballOf("package", packageFiles("tb-dep", "tb-dep")),
      // q-dep -> r-dep -> tb-dep. Bun reads r-dep's package.json two downloads after it started downloading tb-dep for
      // `b`.
      "/q-dep.tgz": await tarballOf("package", packageFiles("q-dep", "q-dep", { "r-dep": urlOf("r-dep") })),
      "/r-dep.tgz": await tarballOf("package", packageFiles("r-dep", "r-dep", { c: urlOf("tb-dep") })),
    };
    const row = (name: string, dependencies?: Record<string, string>) => [
      `${name}@${urlOf(name)}`,
      dependencies ? { version: "1.0.0", dependencies } : { version: "1.0.0" },
      integrityOf(tarballs[`/${name}.tgz`]),
    ];

    const project = writeProject(root, { a: urlOf("tb-dep") });
    {
      const { stderr, exitCode } = await runInstall(project, join(root, "cache-warm"), {}, "--linker=isolated");
      expect(stderr).toContain("Saved lockfile");
      expect(await lockedPackages(project)).toEqual({ a: row("tb-dep") });
      expect(exitCode).toBe(0);
    }

    writeProject(root, { a: urlOf("tb-dep"), b: urlOf("tb-dep"), q: urlOf("q-dep") });
    rmSync(join(project, "node_modules"), { recursive: true });
    const { stdout, stderr, exitCode } = await runInstall(project, join(root, "cache-cold"), {}, "--linker=isolated");
    // Only q-dep and r-dep. `b` and `c` find the locked tb-dep by its URL, and the linker downloads it.
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
      "Resolving dependencies
      Resolved, downloaded and extracted [4]
      Saved lockfile"
    `);
    // tb-dep, q-dep and r-dep
    expect(installOutput(stdout)).toEqual([
      expect.stringContaining("bun install v"),
      "",
      `+ a@${urlOf("tb-dep")}`,
      `+ b@${urlOf("tb-dep")}`,
      `+ q@${urlOf("q-dep")}`,
      "",
      "3 packages installed",
    ]);
    expect(await installedVersions(project, ["a", "b", "q"])).toEqual({ a: "tb-dep", b: "tb-dep", q: "q-dep" });
    expect(await lockedPackages(project)).toEqual({
      a: row("tb-dep"),
      b: row("tb-dep"),
      c: row("tb-dep"),
      q: row("q-dep", { "r-dep": urlOf("r-dep") }),
      "r-dep": row("r-dep", { c: urlOf("tb-dep") }),
    });
    expect(exitCode).toBe(0);
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

// With the isolated linker, a cold-cache frozen install re-enqueued each
// dependency after the shared clone completed; the checkout id was derived
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

// Serves a registry that has version 1.0.0 of each package. `packages` maps a name to the rest of its package.json. The
// marker that its index.js exports is `<name>-from-registry`.
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

// Returns where the isolated linker installed the `name` that `dir` resolves. That's the store entry, whose
// node_modules has the package and its dependencies.
function storeEntryOf(dir: string, name: string) {
  return dirname(dirname(realpathSync(join(dir, "node_modules", name))));
}

// Writes `<root>/project`, a workspace root with no dependencies of its own, and its only workspace, `packages/m`. A
// new project with workspaces gets the isolated linker.
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
// first. It is not a git dependency. Once the repository was cloned, the install took
// the checkout to start from that dependency: it started none and never exited.
for (const peer of ["required", "optional"] as const) {
  test.concurrent(
    `installs a workspace's git dependency that is the ${peer} peer of an earlier package from a cold cache`,
    async () => {
      using dir = tempDir(`git-dep-${peer}-peer`, {});
      const root = String(dir);
      const bare = await makeSharedRepo(root, [{ name: "b", branch: "main" }], "b.git");
      const repoUrl = `git+${pathToFileURL(bare)}`;
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
      };
      // What `m` resolves, and the `b` that `a` resolves, which should be the git one.
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

      // Simulate a fresh machine: keep bun.lock, delete node_modules and the cache.
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
  );
}

// One clone serves every package of a repository. Three packages wait for it here, and the one that's installed through
// a's peer dependency is neither the first nor the last.
test.concurrent(
  "checks out every package of a repository when one of them is installed through a peer dependency",
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

    // Simulate a fresh machine: keep bun.lock, delete node_modules and the cache.
    rmSync(join(project, "node_modules"), { recursive: true });
    rmSync(join(member, "node_modules"), { recursive: true });
    const { stdout, stderr, exitCode } = await runInstall(project, join(root, "cache-cold"), env, "--frozen-lockfile");
    expect(stderr).toBe("");
    expect(installOutput(stdout)).toEqual(output);
    expect(await installed()).toEqual(expected);
    expect(exitCode).toBe(0);
  },
);

// The repository is gone by the time the cold install clones it. The failed clone fails every package that's waiting
// for it. The one that's installed through a's peer dependency used to be left waiting, and the install never exited.
test.concurrent(
  "fails every package of a repository that can't be cloned when one of them is installed through a peer dependency",
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
);

// `overrides` puts a git commit in place of a's registry dependency `b`. When
// the clone ended, the install sent that dependency through the resolver, which
// found the package of the pinned commit already loaded and started no checkout.
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

    // Simulate a fresh machine: keep bun.lock, delete node_modules and the cache.
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
);

// bun.lock can spell a repository's URL differently than the dependency does. For example, an scp-style URL is read
// back from it with `ssh://` in front. Here the locked URL has a `.` segment. The install clones and checks out what's
// in bun.lock. It used to switch to the dependency's URL once the clone finished, so it cloned a second time and left
// the package waiting.
test.concurrent(
  "isolated linker checks out a git package whose URL bun.lock spells differently from the dependency",
  async () => {
    using dir = tempDir("git-dep-url-spelling", {});
    const root = String(dir);
    const name = nameOf("b");
    const repoUrl = `git+${pathToFileURL(sharedBare)}`;
    const lockedUrl = repoUrl.replace(/\/shared-repo\.git$/, "/./shared-repo.git");
    expect(lockedUrl).not.toBe(repoUrl);
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
);

// A patch is applied to a git package right after its checkout if the repository was cloned earlier in the same
// process, which happens here to resolve the new dependency `c`. The package to patch was looked up by the dependency's
// name, which is different for an alias: `panic: Package not found`.
for (const [added, editsPackageJson] of [
  ["`bun install <url>`", false],
  ["an edit of package.json", true],
] as const) {
  test.concurrent(
    `patches a git package under an alias when ${added} adds another package of its repository`,
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
      const writePackageJson = (dependencies: Record<string, string>) =>
        writeFileSync(
          join(project, "package.json"),
          JSON.stringify({
            name: "project",
            version: "1.0.0",
            dependencies,
            patchedDependencies: { [`b@${repoUrl}#${branchCommits(bare).b}`]: "patches/b.patch" },
          }),
        );
      writePackageJson({ "b-alias": `${repoUrl}#b` });

      // fresh install to produce a complete lockfile
      {
        const { stderr, exitCode } = await runInstall(project, join(root, "cache-warm"), {});
        expect(stderr).toContain("Saved lockfile");
        expect(await installedVersions(project, ["b-alias"])).toEqual({ "b-alias": "b-patched" });
        expect(exitCode).toBe(0);
      }

      // Simulate a fresh machine: keep bun.lock, delete node_modules and the cache, and add `c`.
      rmSync(join(project, "node_modules"), { recursive: true });
      const args: string[] = [];
      if (editsPackageJson) writePackageJson({ "b-alias": `${repoUrl}#b`, c: `${repoUrl}#c` });
      else args.push(`${repoUrl}#c`);
      const { stderr, exitCode } = await runInstall(project, join(root, "cache-cold"), {}, ...args);
      expect(stderr).toContain("Saved lockfile");
      expect(await installedVersions(project, ["b-alias", "c"])).toEqual({ "b-alias": "b-patched", c: "c" });
      expect(exitCode).toBe(0);
    },
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

test.concurrent(
  "a failed prepare script of a git dependency explains that its devDependencies aren't installed",
  async () => {
    using dir = tempDir("git-dep-prepare", {});
    const root = String(dir);
    const manifest = {
      name: "lib",
      version: "1.0.0",
      scripts: { prepare: "exit 3" },
      devDependencies: { tool: "1.0.0" },
    };
    const bare = await makeSharedRepo(root, [{ branch: "lib", files: { "package.json": JSON.stringify(manifest) } }]);
    const project = writeProject(root, { lib: `git+${pathToFileURL(bare)}#lib` });
    const packageJson = JSON.parse(readFileSync(join(project, "package.json"), "utf8"));
    writeFileSync(join(project, "package.json"), JSON.stringify({ ...packageJson, trustedDependencies: ["lib"] }));

    const { stderr, exitCode } = await runInstall(project, join(root, "cache"), {});
    expect(stderr.split(/\r?\n/).filter(line => /^(error|note):/.test(line))).toEqual([
      'error: prepare script from "lib" exited with 3',
      "note: devDependencies of a git dependency are not installed before its prepare scripts",
    ]);
    expect(exitCode).toBe(3);
  },
);

// `lib` on the branch of that name, with the given dependencies and files next to its package.json.
function libWithFolders(dependencies: Record<string, string>, more: Partial<BranchPackage> = {}): BranchPackage {
  const manifest = JSON.stringify({ name: "lib", version: "1.0.0", dependencies });
  return { branch: "lib", ...more, files: { "package.json": manifest, ...more.files } };
}

for (const linker of ["hoisted", "isolated"]) {
  test.concurrent(`the dependencies of a file: folder inside a git dependency are installed (${linker})`, async () => {
    using dir = tempDir("git-dep-contained-folder", {});
    const root = String(dir);
    const repoUrl = `git+${pathToFileURL(join(root, "shared-repo.git"))}`;
    await makeSharedRepo(root, [
      { name: "leaf", branch: "leaf" },
      libWithFolders(
        { sub: "file:./packages/sub" },
        {
          files: {
            "index.js": "module.exports = require('sub');",
            "packages/sub/package.json": JSON.stringify({
              name: "sub",
              version: "1.0.0",
              dependencies: { leaf: `${repoUrl}#leaf`, next: "file:../next" },
            }),
            "packages/sub/index.js": "module.exports = ['sub', require('leaf'), require('next')].join('+');",
            "packages/next/package.json": JSON.stringify({ name: "next", version: "1.0.0" }),
            "packages/next/index.js": "module.exports = 'next';",
          },
        },
      ),
    ]);
    const project = writeProject(root, { lib: `${repoUrl}#lib` });
    const lockfile = () => readFileSync(join(project, "bun.lock"), "utf8");
    const load = (cache: string) => runBun(project, cache, {}, "-e", "console.log(require('lib'))");

    const first = await runInstall(project, join(root, "cache"), {}, `--linker=${linker}`);
    expect(first.stderr).not.toContain("error:");
    expect((await load(join(root, "cache"))).stdout).toBe("sub+leaf+next\n");
    const locked = await lockedPackages(project);
    expect(Object.keys(locked).sort()).toEqual(["leaf", "lib", "lib/next", "lib/sub"]);
    expect(locked.lib[1]).toEqual({
      version: "1.0.0",
      dependencies: { leaf: `${repoUrl}#leaf`, next: "file:packages/next", sub: "file:./packages/sub" },
    });
    expect(first.exitCode).toBe(0);

    // bun.lock alone produces the same tree on a machine with an empty cache.
    const saved = lockfile();
    rmSync(join(project, "node_modules"), { recursive: true, force: true });
    const frozen = await runInstall(project, join(root, "cache-2"), {}, `--linker=${linker}`, "--frozen-lockfile");
    expect(frozen.stderr).not.toContain("error:");
    expect((await load(join(root, "cache-2"))).stdout).toBe("sub+leaf+next\n");
    expect(frozen.exitCode).toBe(0);

    rmSync(join(project, "bun.lock"));
    const again = await runInstall(project, join(root, "cache-3"), {}, `--linker=${linker}`, "--lockfile-only");
    expect(lockfile()).toBe(saved);
    expect(again.exitCode).toBe(0);
  });
}

// The author of `lib` wrote these for their own monorepo. In the user's project `mine` is another package.
test.concurrent("a file: folder inside a git dependency can't reach into the project that installs it", async () => {
  using dir = tempDir("git-dep-contained-folder-project", {});
  const root = String(dir);
  const repoUrl = `git+${pathToFileURL(join(root, "shared-repo.git"))}`;
  await makeSharedRepo(root, [
    libWithFolders(
      { sub: "file:./packages/sub" },
      {
        files: {
          "packages/sub/package.json": JSON.stringify({
            name: "sub",
            version: "1.0.0",
            dependencies: { mine: "workspace:*", theirs: "workspace:*", linked: "link:linked", listed: "catalog:" },
          }),
        },
      },
    ),
  ]);
  const project = writeProject(root, { lib: `${repoUrl}#lib` });
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify({ name: "project", workspaces: ["packages/*"], dependencies: { lib: `${repoUrl}#lib` } }),
  );
  mkdirSync(join(project, "packages", "mine"), { recursive: true });
  writeFileSync(join(project, "packages", "mine", "package.json"), JSON.stringify({ name: "mine", version: "1.0.0" }));

  const { stderr, exitCode } = await runInstall(project, join(root, "cache"), {});
  expect(stderr).not.toContain("error:");
  expect((await lockedPackages(project)).lib[1]).toEqual({
    version: "1.0.0",
    dependencies: { sub: "file:./packages/sub" },
  });
  expect(exitCode).toBe(0);
});

test.concurrent("a file: folder that's missing from a git dependency is an error", async () => {
  using dir = tempDir("git-dep-missing-folder", {});
  const root = String(dir);
  const bare = await makeSharedRepo(root, [libWithFolders({ sub: "file:./packages/typo" })]);
  const repoUrl = `git+${pathToFileURL(bare)}`;
  const project = writeProject(root, { lib: `${repoUrl}#lib` });

  const { stderr, exitCode } = await runInstall(project, join(root, "cache"), {});
  expect(stderr).toContain(
    `error: failed to read package.json of "sub@file:./packages/typo" declared by lib@${repoUrl}#${branchCommits(bare).lib}: ENOENT`,
  );
  expect(existsSync(join(project, "bun.lock"))).toBe(false);
  expect(exitCode).toBe(1);
});

test.concurrent(
  "a file: folder of a git dependency isn't read through a symlink that leaves the checkout",
  async () => {
    using dir = tempDir("git-dep-linked-folder", {
      "outside/package.json": JSON.stringify({ name: "sub", version: "1.0.0" }),
    });
    const root = String(dir);
    const bare = await makeSharedRepo(root, [
      libWithFolders({ sub: "file:./packages/sub" }, { links: { "packages/sub": join(root, "outside") } }),
    ]);
    const project = writeProject(root, { lib: `git+${pathToFileURL(bare)}#lib` });

    const { stderr, exitCode } = await runInstall(project, join(root, "cache"), {});
    expect(stderr).toMatch(/error: failed to read package\.json of "sub@file:\.\/packages\/sub" declared by lib@.*: E/);
    expect(exitCode).toBe(1);
  },
);

// Two installs of different projects that share a cold cache both clone the repository of a git dependency. The one
// that finishes second finds the other's clone already in the cache. It used to swap in its own clone and delete the
// other one, which the first install still had open. The first install's checkout then failed with "fatal: repository
// '<cache>/.<id>.tmp (deleted)' does not exist". The same applies to the checkout folder.
test.concurrent.skipIf(isWindows)(
  "an install keeps the git cache folders that another install published first",
  async () => {
    using dir = tempDir("git-dep-publish-race", {});
    const root = String(dir);
    const bin = join(root, "bin");
    const steps = join(root, "steps");
    mkdirSync(bin);
    mkdirSync(steps);
    // A git that puts the two installs in the order of the race. A folder is
    // published when the git command that fills it has exited, and the next
    // git command of that install starts after that.
    writeFileSync(
      join(bin, "git"),
      `#!/bin/sh
steps=${quote(steps)}
reach() { : > "$steps/$1"; }
wait_for() { i=0; while [ ! -e "$steps/$1" ] && [ $i -lt 200 ]; do sleep 0.05; i=$((i+1)); done; }
case "$INSTALL $*" in
  # Both look for the bare clone in the cache before "first" publishes its own.
  "first "*" clone "*" --bare "*) wait_for second-clones-bare ;;
  # "second" publishes its bare clone after "first" did, and before "first" uses its own.
  "second "*" clone "*" --bare "*) reach second-clones-bare; wait_for first-runs-log ;;
  "first "*" --git-dir="*" log "*) reach first-runs-log; wait_for second-runs-log ;;
  "second "*" --git-dir="*" log "*) reach second-runs-log ;;
  # Both look for the checkout in the cache before either publishes its own.
  "first "*" --git-dir="*" ls-tree "*) reach first-clones-checkout; wait_for second-clones-checkout ;;
  "second "*" --git-dir="*" ls-tree "*) reach second-clones-checkout; wait_for first-clones-checkout ;;
esac
exec ${quote(Bun.which("git", { PATH: gitEnv.PATH })!)} "$@"
`,
      { mode: 0o755 },
    );

    const repoUrl = `git+${pathToFileURL(sharedBare)}`;
    const { resolutions, locked } = expectedGitPackages(repoUrl, sharedCommits, ["c"]);
    const cache = join(root, "cache");
    const installs = ["first", "second"].map(async which => {
      const project = writeProject(join(root, which), { [nameOf("c")]: `${repoUrl}#pkg-c` });
      const result = await runInstall(project, cache, { INSTALL: which, PATH: `${bin}:${gitEnv.PATH}` });
      return { project, ...result };
    });

    for (const { project, stdout, stderr, exitCode } of await Promise.all(installs)) {
      expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
        "Resolving dependencies
        Resolved, downloaded and extracted [2]
        Saved lockfile"
      `);
      expectInstalled(stdout, resolutions);
      expect(await installedVersions(project, [nameOf("c")])).toEqual(markers(["c"]));
      expect(await lockedPackages(project)).toEqual(locked);
      expect(exitCode).toBe(0);
    }
    // The installs met at every step, and the cache has one bare clone and one checkout, because the install that lost
    // the race removed the folder that it had built.
    expect(readdirSync(steps).sort()).toEqual([
      "first-clones-checkout",
      "first-runs-log",
      "second-clones-bare",
      "second-clones-checkout",
      "second-runs-log",
    ]);
    expect(
      readdirSync(cache)
        .map(name => name.replace(/^[0-9a-f]{16}(?=\.git$)/, "<clone id>"))
        .sort(),
    ).toEqual(["<clone id>.git", `@G@${sharedCommits["pkg-c"]}`]);
  },
  30_000,
);

// The same race on Windows, where a script can't replace git, so nothing orders the installs. There, the install that
// lost the race deleted the published folder by name, and three of four installs failed with "fatal:
// 'C:\$Extend\$Deleted\<id>' does not appear to be a git repository" or "moving <name> to cache dir failed: ENOTEMPTY".
test.concurrent.skipIf(!isWindows)(
  "installs that share a cold cache and a git dependency all succeed",
  async () => {
    using dir = tempDir("git-dep-shared-cache", {});
    const root = String(dir);
    // An install that starts late finds the bare clone and runs `git fetch`
    // in it, which needs a HEAD that names a branch.
    const bare = await makeSharedRepo(root, [{ name: nameOf("e"), branch: "pkg-e" }], "race-repo.git");
    await git(bare, "symbolic-ref", "HEAD", "refs/heads/pkg-e");
    const repoUrl = `git+${pathToFileURL(bare)}`;
    const { resolutions } = expectedGitPackages(repoUrl, branchCommits(bare), ["e"]);

    for (let round = 0; round < 2; round++) {
      const cache = join(root, `cache-${round}`);
      const installs = [0, 1, 2, 3].map(async i => {
        const project = writeProject(join(root, `round-${round}`, `${i}`), { [nameOf("e")]: `${repoUrl}#pkg-e` });
        return { project, ...(await runInstall(project, cache, {})) };
      });
      for (const { project, stdout, stderr, exitCode } of await Promise.all(installs)) {
        expect(stderr.split(/\r?\n/).filter(line => /error|fatal/.test(line))).toEqual([]);
        expectInstalled(stdout, resolutions);
        expect(await installedVersions(project, [nameOf("e")])).toEqual(markers(["e"]));
        expect(exitCode).toBe(0);
      }
      expect(readdirSync(cache).filter(name => name.endsWith(".tmp"))).toEqual([]);
    }
  },
  30_000,
);

// Only a folder with `.bun-tag` is a complete checkout. A folder without it (left by a killed install of an older
// version) is replaced, and so is a symlink to one. The symlink's target is left alone.
test.concurrent.each(["folder", "link"] as const)(
  "replaces a %s that has the cache name of a git checkout and no .bun-tag",
  async kind => {
    using dir = tempDir(`git-dep-untagged-${kind}`, {});
    const root = String(dir);
    const repoUrl = `git+${pathToFileURL(sharedBare)}`;
    const project = writeProject(root, { [nameOf("d")]: `${repoUrl}#pkg-d` });
    const { resolutions, locked } = expectedGitPackages(repoUrl, sharedCommits, ["d"]);
    const cache = join(root, "cache");
    const checkout = join(cache, `@G@${sharedCommits["pkg-d"]}`);
    const untagged = kind === "link" ? join(root, "elsewhere") : checkout;
    mkdirSync(join(untagged, "lib"), { recursive: true });
    writeFileSync(join(untagged, "package.json"), JSON.stringify({ name: nameOf("d"), version: "0.0.0-untagged" }));
    writeFileSync(join(untagged, "lib", "untagged.js"), "");
    if (kind === "link") {
      mkdirSync(cache);
      symlinkSync(untagged, checkout, "junction");
    }

    const { stdout, stderr, exitCode } = await runInstall(project, cache, {});
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
      "Resolving dependencies
      Resolved, downloaded and extracted [2]
      Saved lockfile"
    `);
    expectInstalled(stdout, resolutions);
    expect(await installedVersions(project, [nameOf("d")])).toEqual(markers(["d"]));
    expect(await lockedPackages(project)).toEqual(locked);
    expect(lstatSync(checkout).isDirectory()).toBe(true);
    expect(readdirSync(checkout).sort()).toEqual([".bun-tag", "index.js", "package.json"]);
    if (kind === "link")
      expect(readdirSync(untagged, { recursive: true }).sort()).toEqual([
        "lib",
        join("lib", "untagged.js"),
        "package.json",
      ]);
    expect(readdirSync(cache).filter(name => name.endsWith(".tmp"))).toEqual([]);
    expect(exitCode).toBe(0);
  },
);

// A registry with `y@1.0.0` and `y@2.0.0`. Each version exports `y@<version>`.
async function serveY() {
  const versions = ["1.0.0", "2.0.0"];
  const tarballs = new Map<string, Uint8Array>();
  for (const version of versions) {
    const files = { "package.json": JSON.stringify({ name: "y", version }), "index.js": indexJs(`y@${version}`) };
    tarballs.set(`/y/-/y-${version}.tgz`, await tarballOf("package", files));
  }
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/y") {
        return Response.json({
          name: "y",
          "dist-tags": { latest: "2.0.0" },
          versions: Object.fromEntries(
            versions.map(version => [
              version,
              { name: "y", version, dist: { tarball: `${server.url}y/-/y-${version}.tgz` } },
            ]),
          ),
        });
      }
      const tarball = tarballs.get(pathname);
      return tarball ? new Response(tarball) : new Response("not found", { status: 404 });
    },
  });
  return server;
}

type Linker = "hoisted" | "isolated";

// Writes a project that has its own docs/ folder. The hoisted linker puts a package's own dependencies in
// node_modules/<package>/node_modules, and the isolated linker puts them next to the package.
function writeProjectWithDocs(
  root: string,
  dependencies: Record<string, string>,
  registry: { url: URL },
  linker: Linker = "hoisted",
) {
  const project = writeProject(root, dependencies);
  writeFileSync(join(project, "bunfig.toml"), `[install]\nlinker = "${linker}"\nregistry = "${registry.url}"\n`);
  mkdirSync(join(project, "docs"));
  writeFileSync(join(project, "docs", "guide.md"), "# guide\n");
  return project;
}

// Returns the folder of the `name` that the installed package `dependent` loads: its own copy if it has one, or else
// the one in the node_modules folder that `dependent` is in.
function dependencyOf(project: string, dependent: string, name: string) {
  const linked = join(project, "node_modules", dependent);
  const installed = existsSync(linked) ? realpathSync(linked) : linked;
  const own = join(installed, "node_modules", name);
  return existsSync(own) ? own : join(dirname(installed), name);
}

// The repository `a` needs its own copy of @x/docs, because the project has another version. `commit` is what the
// repository itself commits in node_modules.
async function makeRepoWithNestedDependency(root: string, commit: Pick<BranchPackage, "files" | "links">) {
  const bare = await makeSharedRepo(
    root,
    [{ name: "a", branch: "main", dependencies: { "@x/docs": "npm:y@2.0.0" }, ...commit }],
    "a.git",
  );
  // `git init --bare` leaves HEAD at the default branch name, which may not be `main`.
  await git(bare, "symbolic-ref", "HEAD", "refs/heads/main");
  return {
    bare,
    dependencies: { a: `git+${pathToFileURL(bare)}#main`, "@x/docs": "npm:y@1.0.0" },
    sha: branchCommits(bare).main,
  };
}

// Returns what the project looks like when `a` and both copies of @x/docs are installed and nothing else has changed.
async function nestedDependencyState(project: string) {
  const nested = dependencyOf(project, "a", "@x/docs");
  const committedScope = join(project, "node_modules", "a", "node_modules", "@x");
  return {
    "docs/": existsSync(join(project, "docs")) ? readdirSync(join(project, "docs")).sort() : null,
    "@x/docs": await installedVersionOf(project, "@x/docs"),
    "a's @x/docs": await markerIn(nested),
    "files of a's @x/docs": existsSync(nested) ? readdirSync(nested).sort() : null,
    "a/node_modules/@x is a link": lstatSync(committedScope, { throwIfNoEntry: false })?.isSymbolicLink() ?? false,
  };
}
const nestedDependencyInstalled = {
  "docs/": ["guide.md"],
  "@x/docs": "y@1.0.0",
  "a's @x/docs": "y@2.0.0",
  "files of a's @x/docs": ["index.js", "package.json"],
  "a/node_modules/@x is a link": false,
};
const cleanCheckout = [".bun-tag", "index.js", "package.json"];

const committedPackage = {
  files: {
    "node_modules/@x/docs/package.json": JSON.stringify({ name: "y", version: "2.0.0" }),
    "node_modules/@x/docs/index.js": indexJs("committed"),
    "node_modules/@x/docs/extra.js": indexJs("committed"),
  },
};

// Bun installs the packages that a dependency needs, so whatever a repository commits in its node_modules isn't
// installed. Each repository here commits something at node_modules/@x, which is where the hoisted linker puts its copy
// of @x/docs.
const committedNodeModules: { name: string; commit: Pick<BranchPackage, "files" | "links">; linker: Linker }[] = [
  {
    // three directories up from node_modules/a/node_modules is the project
    name: "a link committed in a git dependency's node_modules does not move its nested packages into the project",
    commit: { links: { "node_modules/@x": "../../.." } },
    linker: "hoisted",
  },
  {
    name: "a file committed in a git dependency's node_modules does not block its nested packages",
    commit: { files: { "node_modules/@x": "not a directory\n" } },
    linker: "hoisted",
  },
  {
    name: "a package committed in a git dependency's node_modules is not merged into the one bun installs",
    commit: committedPackage,
    linker: "hoisted",
  },
  {
    // The isolated linker puts @x/docs next to `a`, but `a` would load its own copy first.
    name: "a package committed in a git dependency's node_modules is not loaded in place of the one bun installs",
    commit: committedPackage,
    linker: "isolated",
  },
];
for (const { name, commit, linker } of committedNodeModules) {
  test.concurrent(
    name,
    async () => {
      using dir = tempDir("git-dep-committed-node-modules", {});
      const root = String(dir);
      await using registry = await serveY();
      const { dependencies, sha } = await makeRepoWithNestedDependency(root, commit);
      const project = writeProjectWithDocs(root, dependencies, registry, linker);

      const cache = join(root, "cache");
      const install = await runInstall(project, cache, {});
      expect(install.stderr).toContain("Saved lockfile");
      const afterInstall = await nestedDependencyState(project);
      const cached = readdirSync(join(cache, `@G@${sha}`)).sort();

      // A reinstall removes whatever is at the package's path before it writes there.
      const reinstall = await runInstall(project, cache, {}, "--force");
      const afterReinstall = await nestedDependencyState(project);

      expect({ afterInstall, cached, afterReinstall }).toEqual({
        afterInstall: nestedDependencyInstalled,
        cached: cleanCheckout,
        afterReinstall: nestedDependencyInstalled,
      });
      expect({ install: install.exitCode, reinstall: reinstall.exitCode }).toEqual({ install: 0, reinstall: 0 });
    },
    30_000,
  );
}

// Every path below `dir`. A link is listed with its target and is not followed.
function treeOf(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap(entry => {
      const path = prefix + entry.name;
      if (entry.isSymbolicLink()) return [`${path} -> ${readlinkSync(join(dir, entry.name))}`];
      return entry.isDirectory() ? [path, ...treeOf(join(dir, entry.name), `${path}/`)] : [path];
    })
    .sort();
}

// A bundled dependency ships inside its dependent, so Bun doesn't install it. The repository `b` bundles `y`.
// `committed` is what it commits in node_modules.
async function makeRepoWithBundledDependency(root: string, committed: Pick<BranchPackage, "files" | "links">) {
  const bare = await makeSharedRepo(
    root,
    [
      {
        branch: "main",
        links: committed.links,
        files: {
          "package.json": JSON.stringify({
            name: "b",
            version: "1.0.0",
            dependencies: { y: "2.0.0" },
            bundleDependencies: ["y"],
          }),
          ...committed.files,
        },
      },
    ],
    "b.git",
  );
  return { url: `git+${pathToFileURL(bare)}`, sha: branchCommits(bare).main };
}

// The committed copy of `y` needs `@s/w`, which is committed next to it. A package that bundles dependencies keeps the
// node_modules that it commits, except for symlinks. There are two here, and they point out of the package.
for (const linker of ["hoisted", "isolated"] as const) {
  test.concurrent(
    `a git dependency that bundles dependencies keeps its node_modules without the links in it (${linker} linker)`,
    async () => {
      using dir = tempDir("git-dep-bundled", {});
      const root = String(dir);
      await using registry = await serveY();
      const { url, sha } = await makeRepoWithBundledDependency(root, {
        files: {
          "node_modules/y/package.json": JSON.stringify({
            name: "y",
            version: "2.0.0",
            dependencies: { "@s/w": "1.0.0" },
          }),
          "node_modules/y/index.js": indexJs("committed"),
          "node_modules/@s/w/package.json": JSON.stringify({ name: "@s/w", version: "1.0.0" }),
          "node_modules/@s/other/package.json": JSON.stringify({ name: "@s/other", version: "1.0.0" }),
          "node_modules/unlisted/package.json": JSON.stringify({ name: "unlisted", version: "1.0.0" }),
          "node_modules/.bin/tool": "#!/bin/sh\n",
        },
        links: { "node_modules/y/up": "../../..", "node_modules/@x": "../../.." },
      });
      const project = writeProjectWithDocs(root, { b: `${url}#main` }, registry, linker);

      const cache = join(root, "cache");
      const checkout = join(cache, `@G@${sha}`);
      const kept = [
        ".bin",
        ".bin/tool",
        "@s",
        "@s/other",
        "@s/other/package.json",
        "@s/w",
        "@s/w/package.json",
        "unlisted",
        "unlisted/package.json",
        "y",
        "y/index.js",
        "y/package.json",
      ];
      const state = async () => ({
        cached: treeOf(join(checkout, "node_modules")),
        "b's y": await markerIn(dependencyOf(project, "b", "y")),
        y: await installedVersionOf(project, "y"),
      });
      const bundled = { cached: kept.sort(), "b's y": "committed", y: null };

      const install = await runInstall(project, cache, {});
      expect(install.stderr).toContain("Saved lockfile");
      expect({ ...(await state()), locked: await lockedPackages(project) }).toEqual({
        ...bundled,
        locked: {
          b: [`b@${url}#${sha}`, { version: "1.0.0", dependencies: { y: "2.0.0" } }, sha],
          "b/y": ["y@2.0.0", `${registry.url}y/-/y-2.0.0.tgz`, { bundled: true }, ""],
        },
      });

      // The checkout is cleaned when it is fetched. A cache hit writes nothing to it.
      mkdirSync(join(checkout, "node_modules", "added-later"));
      rmSync(join(project, "node_modules"), { recursive: true });
      const reinstall = await runInstall(project, cache, {});
      expect(await state()).toEqual({ ...bundled, cached: [...kept, "added-later"].sort() });
      expect({ install: install.exitCode, reinstall: reinstall.exitCode }).toEqual({ install: 0, reinstall: 0 });
    },
    30_000,
  );
}

test.concurrent("a bundled dependency that a git dependency does not commit is not installed", async () => {
  using dir = tempDir("git-dep-bundled-missing", {});
  const root = String(dir);
  await using registry = await serveY();
  const { url } = await makeRepoWithBundledDependency(root, {});
  const project = writeProjectWithDocs(root, { b: `${url}#main` }, registry);

  const { stderr, exitCode } = await runInstall(project, join(root, "cache"), {});
  expect(stderr).toContain("Saved lockfile");
  expect(await markerIn(dependencyOf(project, "b", "y"))).toBeNull();
  expect(exitCode).toBe(0);
});

// The `error:` and `warn:` lines of an install's stderr. What git itself prints
// between them depends on its version.
function diagnostics(stderr: string): string[] {
  return stderr.split(/\r?\n/).filter(line => /^(error|warn):/.test(line));
}

const gitFailed = (kind: "error" | "warn") =>
  expect.stringMatching(new RegExp(`^${kind}: git failed with exit code \\d+$`));

// An optional git dependency that could not be resolved failed the whole
// install (exit code 1, no lockfile), while an optional registry or tarball
// dependency that cannot be fetched is skipped with a warning.
test.concurrent.each([
  {
    // the static server answers 404 "not found", which git reports as a missing repository
    what: "an http repository that does not exist",
    spec: () => `git+http://localhost:${sharedServer.port}/no-such-repo.git`,
    warnings: [
      gitFailed("warn"),
      'warn: "git clone" for "nope" failed',
      "warn: RepositoryNotFound cloning repository for nope",
    ],
  },
  {
    what: "a file repository that does not exist",
    spec: (root: string) => `git+${pathToFileURL(join(root, "no-such-repo.git"))}`,
    warnings: [
      gitFailed("warn"),
      'warn: "git clone" for "nope" failed',
      "warn: InstallFailed cloning repository for nope",
    ],
  },
  {
    what: "a committish that does not exist",
    spec: () => `${sharedRepoUrl}#no-such-branch`,
    warnings: [gitFailed("warn"), 'warn: no commit matching "no-such-branch" found for "nope" (but repository exists)'],
  },
])("skips an optional git dependency on $what", async ({ spec, warnings }) => {
  using dir = tempDir("git-dep-optional", {});
  const root = String(dir);
  const project = writeProject(
    root,
    { [nameOf("b")]: `${sharedRepoUrl}#pkg-b` },
    { optionalDependencies: { nope: spec(root) } },
  );
  const { resolutions, locked } = expectedGitPackages(sharedRepoUrl, sharedCommits, ["b"]);

  const { stdout, stderr, exitCode } = await runInstall(project, join(root, "cache"), {});
  expect(diagnostics(stderr)).toEqual(warnings);
  expectInstalled(stdout, resolutions);
  expect(await installedVersions(project, [nameOf("b"), "nope"])).toEqual({ ...markers(["b"]), nope: null });
  expect(await lockedPackages(project)).toEqual(locked);
  expect(exitCode).toBe(0);
});

test.concurrent("skips an optional git dependency when git is not installed", async () => {
  using dir = tempDir("git-dep-optional-no-git", {});
  const root = String(dir);
  const project = writeProject(root, {}, { optionalDependencies: { nope: `${sharedRepoUrl}#pkg-b` } });
  const emptyPath = join(root, "empty-path");
  mkdirSync(emptyPath);

  const { stderr, exitCode } = await runInstall(project, join(root, "cache"), { PATH: emptyPath });
  expect(diagnostics(stderr)).toEqual([
    'warn: "git" is not installed (needed for "nope")',
    "warn: ENOENT cloning repository for nope",
  ]);
  expect(await lockedPackages(project)).toEqual({});
  expect(exitCode).toBe(0);
});

test.concurrent("--silent prints nothing about optional git dependencies that cannot be resolved", async () => {
  using dir = tempDir("git-dep-optional-silent", {});
  const root = String(dir);
  const project = writeProject(
    root,
    {},
    {
      optionalDependencies: {
        "no-such-repo": `git+${pathToFileURL(join(root, "no-such-repo.git"))}`,
        "no-such-branch": `${sharedRepoUrl}#no-such-branch`,
      },
    },
  );

  const { stdout, stderr, exitCode } = await runInstall(project, join(root, "cache"), {}, "--silent");
  expect({ stdout, stderr }).toEqual({ stdout: "", stderr: "" });
  expect(await lockedPackages(project)).toEqual({});
  expect(exitCode).toBe(0);
});

// One clone serves every dependency on a repository. A failure is still an error if any of them isn't optional, even if
// an optional one started the clone. Optional dependencies are enqueued first, so the clone is named after `nope`.
test.concurrent("fails when a required dependency shares the repository an optional one cannot clone", async () => {
  using dir = tempDir("git-dep-optional-shared", {});
  const root = String(dir);
  const repoUrl = `git+${pathToFileURL(join(root, "no-such-repo.git"))}`;
  const project = writeProject(
    root,
    { needed: `${repoUrl}#needed` },
    { optionalDependencies: { nope: `${repoUrl}#nope` } },
  );

  const { stderr, exitCode } = await runInstall(project, join(root, "cache"), {});
  expect(diagnostics(stderr)).toEqual([
    gitFailed("error"),
    'error: "git clone" for "nope" failed',
    "error: InstallFailed cloning repository for nope",
    `error: needed@${repoUrl}#needed failed to resolve`,
  ]);
  expect(existsSync(join(project, "bun.lock"))).toBe(false);
  expect(exitCode).toBe(1);
});

// `bun update <name>` and `bun add` name a package. When it cannot be fetched
// they exit 1 and save nothing, as they do for a registry package, also when
// the dependency is optional.
test.concurrent.each([
  { what: "the clone is named after", otherNewDependency: false },
  // `@scope/pkg-m` is new and sorts first, so the clone is named after it and `@scope/pkg-n` only waits for it
  { what: "only waits for the clone of another dependency", otherNewDependency: true },
])(
  "bun update <name> fails and saves nothing when the optional git dependency that $what cannot be cloned",
  async ({ otherNewDependency }) => {
    using dir = tempDir("git-dep-optional-update", {});
    const root = String(dir);
    const bare = await makeSharedRepo(root, [
      { name: nameOf("m"), branch: "pkg-m" },
      { name: nameOf("n"), branch: "pkg-n" },
    ]);
    const repoUrl = `git+${pathToFileURL(bare)}`;
    const optionalDependencies = { [nameOf("n")]: `${repoUrl}#pkg-n` };
    const project = writeProject(root, {}, { optionalDependencies });

    const warm = await runInstall(project, join(root, "cache-warm"), {});
    expect(diagnostics(warm.stderr)).toEqual([]);
    expect(warm.exitCode).toBe(0);

    rmSync(bare, { recursive: true });
    if (otherNewDependency) {
      writeProject(root, {}, { optionalDependencies: { [nameOf("m")]: `${repoUrl}#pkg-m`, ...optionalDependencies } });
    }
    const saved = () => ({
      packageJson: readFileSync(join(project, "package.json"), "utf8"),
      lockfile: readFileSync(join(project, "bun.lock"), "utf8"),
    });
    const before = saved();
    const cloneName = nameOf(otherNewDependency ? "m" : "n");

    const { stderr, exitCode } = await runBun(project, join(root, "cache-cold"), {}, "update", nameOf("n"));
    expect(diagnostics(stderr)).toEqual([
      gitFailed("warn"),
      `warn: "git clone" for "${cloneName}" failed`,
      `warn: InstallFailed cloning repository for ${cloneName}`,
    ]);
    expect(saved()).toEqual(before);
    expect(exitCode).toBe(1);
  },
  30_000,
);

test.concurrent(
  "bun add --optional <git url> fails and saves nothing when the repository cannot be cloned",
  async () => {
    using dir = tempDir("git-dep-optional-add", {});
    const root = String(dir);
    const repoUrl = `git+${pathToFileURL(join(root, "no-such-repo.git"))}`;
    const project = writeProject(root, {});
    const packageJson = readFileSync(join(project, "package.json"), "utf8");

    const { stderr, exitCode } = await runBun(project, join(root, "cache"), {}, "add", "--optional", repoUrl);
    expect(diagnostics(stderr)).toEqual([
      gitFailed("warn"),
      `warn: "git clone" for "${repoUrl}" failed`,
      `warn: InstallFailed cloning repository for ${repoUrl}`,
    ]);
    expect(readFileSync(join(project, "package.json"), "utf8")).toBe(packageJson);
    expect(existsSync(join(project, "bun.lock"))).toBe(false);
    expect(exitCode).toBe(1);
  },
);

// A clone or checkout that failed during resolution stayed registered, and a locked dependency that needed the same one
// joined it at install time. The isolated linker then waited forever, and the hoisted linker skipped the package. The
// new dependency is optional or a peer, so its missing resolution doesn't end the install earlier.
for (const linker of ["hoisted", "isolated"] as const) {
  const failedToInstall = (name: string, resolution: string, hoistedError: string) =>
    linker === "hoisted" ? hoistedError : expect.stringContaining(`error: failed to download ${name}@${resolution}`);

  for (const group of ["optionalDependencies", "peerDependencies"] as const) {
    test.concurrent(
      `${linker} linker clones again for a locked dependency after the clone failed for one of the ${group}`,
      async () => {
        using dir = tempDir(`git-dep-${linker}-failed-clone`, {});
        const root = String(dir);
        const bare = await makeSharedRepo(root, [
          { name: nameOf("m"), branch: "pkg-m" },
          { name: nameOf("n"), branch: "pkg-n" },
        ]);
        const repoUrl = `git+${pathToFileURL(bare)}`;
        const project = writeProject(root, { [nameOf("m")]: `${repoUrl}#pkg-m` });

        const warm = await runInstall(project, join(root, "cache-warm"), {}, `--linker=${linker}`);
        expect(diagnostics(warm.stderr)).toEqual([]);
        expect(warm.exitCode).toBe(0);

        // a fresh machine that cannot reach the repository, and a new dependency on it
        rmSync(bare, { recursive: true });
        rmSync(join(project, "node_modules"), { recursive: true });
        writeProject(root, { [nameOf("m")]: `${repoUrl}#pkg-m` }, { [group]: { [nameOf("n")]: `${repoUrl}#pkg-n` } });
        const { stderr, exitCode } = await runInstall(project, join(root, "cache-cold"), {}, `--linker=${linker}`);
        // only optional dependencies waited for the first clone
        const kind = group === "optionalDependencies" ? "warn" : "error";
        expect(diagnostics(stderr)).toEqual([
          gitFailed(kind),
          `${kind}: "git clone" for "${nameOf("n")}" failed`,
          `${kind}: InstallFailed cloning repository for ${nameOf("n")}`,
          gitFailed("error"),
          `error: "git clone" for "${nameOf("m")}" failed`,
          failedToInstall(nameOf("m"), `${repoUrl}#`, `error: InstallFailed cloning repository for ${nameOf("m")}`),
        ]);
        expect(exitCode).toBe(1);
      },
      30_000,
    );
  }

  // `git checkout` fails for a repository that holds a path the platform
  // cannot create. Here a wrapper around git fails it once `fail-checkout` exists.
  test.concurrent.skipIf(isWindows)(
    `${linker} linker checks out again for a locked dependency after the checkout failed for another one`,
    async () => {
      using dir = tempDir(`git-dep-${linker}-failed-checkout`, {});
      const root = String(dir);
      const failCheckout = join(root, "fail-checkout");
      const bin = join(root, "bin");
      mkdirSync(bin);
      writeFileSync(
        join(bin, "git"),
        `#!/bin/sh
for arg in "$@"; do
  if [ "$arg" = restore ] && [ -e '${failCheckout}' ]; then echo 'fatal: cannot check out' >&2; exit 128; fi
done
exec '${Bun.which("git")}' "$@"
`,
        { mode: 0o755 },
      );
      const env = { PATH: `${bin}:${gitEnv.PATH}` };
      const repoUrl = `git+${pathToFileURL(sharedBare)}`;
      const project = writeProject(root, { [nameOf("b")]: `${repoUrl}#pkg-b` });

      const warm = await runInstall(project, join(root, "cache-warm"), env, `--linker=${linker}`);
      expect(diagnostics(warm.stderr)).toEqual([]);
      expect(warm.exitCode).toBe(0);

      // a fresh machine, and the same commit once more under another name
      rmSync(join(project, "node_modules"), { recursive: true });
      writeFileSync(failCheckout, "");
      writeProject(
        root,
        { [nameOf("b")]: `${repoUrl}#pkg-b` },
        { optionalDependencies: { alias: `${repoUrl}#pkg-b` } },
      );
      const { stderr, exitCode } = await runInstall(project, join(root, "cache-cold"), env, `--linker=${linker}`);
      expect(diagnostics(stderr)).toEqual([
        gitFailed("error"),
        'error: "git restore" for "alias" failed',
        "error: InstallFailed checking out repository for alias",
        gitFailed("error"),
        `error: "git restore" for "${nameOf("b")}" failed`,
        failedToInstall(
          nameOf("b"),
          `${repoUrl}#${sharedCommits["pkg-b"]}`,
          `error: InstallFailed checking out repository for ${nameOf("b")}`,
        ),
      ]);
      expect(exitCode).toBe(1);
    },
    30_000,
  );
}

// A failed commit lookup stayed registered too. A peer dependency is resolved in a later pass, so it joined the
// finished lookup and ran no `git log`, and the install ended with an error about the first package only.
test.concurrent("looks the commit up again for a peer dependency after the lookup failed for another one", async () => {
  using dir = tempDir("git-dep-failed-commit", {});
  const root = String(dir);
  const spec = `${sharedRepoUrl}#no-such-branch`;
  const project = writeProject(root, {}, { optionalDependencies: { first: spec }, peerDependencies: { second: spec } });

  const { stderr, exitCode } = await runInstall(project, join(root, "cache"), {});
  // git's own errors are printed immediately, and the lines about the packages come after the resolve phase.
  expect(diagnostics(stderr)).toEqual([
    gitFailed("warn"),
    gitFailed("error"),
    'warn: no commit matching "no-such-branch" found for "first" (but repository exists)',
    'error: no commit matching "no-such-branch" found for "second" (but repository exists)',
  ]);
  expect(exitCode).toBe(1);
});

// With GIT_DIR in the environment (git exports it to commit hooks), git ignores
// the repository that `-C` names and operates on $GIT_DIR instead. The install
// then resolved and checked out the branch in the user's repository and
// installed its tree as the dependency. The git children must not inherit it,
// from the environment or from the project's `.env`.
test.concurrent.each(["the environment", "the project's .env"])(
  "installs a git dependency when GIT_DIR in %s points at another repository",
  async where => {
    using dir = tempDir("git-dep-gitdir", {});
    const root = String(dir);
    // an unrelated non-bare repo, on `main`, that also has a `pkg-b` branch
    const other = join(root, "other");
    mkdirSync(other);
    await git(other, "init", "-q", "-b", "main");
    writeFileSync(join(other, "keep.txt"), "keep\n");
    await git(other, "add", "-A");
    await git(other, "-c", "commit.gpgsign=false", "commit", "-qm", "main");
    await git(other, "checkout", "-qb", "pkg-b");
    writeFileSync(join(other, "other-file.txt"), "x\n");
    await git(other, "add", "-A");
    await git(other, "-c", "commit.gpgsign=false", "commit", "-qm", "pkg-b");
    await git(other, "checkout", "-q", "main");
    // the branch line plus one line per changed file
    const otherState = async () => {
      await using proc = Bun.spawn({
        cmd: ["git", "-C", other, "status", "--porcelain=v2", "--branch"],
        env: gitEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      if (exitCode !== 0) throw new Error(`git status failed:\n${stderr}`);
      return stdout.split("\n").filter(line => line.startsWith("# branch.head") || !line.startsWith("#"));
    };
    expect(await otherState()).toEqual(["# branch.head main", ""]);

    const repoUrl = `git+${pathToFileURL(sharedBare)}`;
    const project = writeProject(root, { [nameOf("b")]: `${repoUrl}#pkg-b` });
    const { resolutions, locked } = expectedGitPackages(repoUrl, sharedCommits, ["b"]);
    const variables = { GIT_DIR: join(other, ".git"), GIT_INDEX_FILE: join(other, ".git", "index") };
    if (where !== "the environment") {
      writeFileSync(
        join(project, ".env"),
        `GIT_DIR='${variables.GIT_DIR}'\nGIT_INDEX_FILE='${variables.GIT_INDEX_FILE}'\n`,
      );
    }

    const { stdout, stderr, exitCode } = await runInstall(
      project,
      join(root, "cache"),
      where === "the environment" ? variables : {},
    );
    expect(stderr).toContain("Saved lockfile");
    expectInstalled(stdout, resolutions);
    expect(await installedVersions(project, [nameOf("b")])).toEqual(markers(["b"]));
    expect(await lockedPackages(project)).toEqual(locked);
    expect(exitCode).toBe(0);
    expect(await otherState()).toEqual(["# branch.head main", ""]);
  },
);

// The same for the `git init`, `git add` and `git commit` that `bun create` runs in the new project. They operated on
// the other repository, whose tracked files were deleted by the commit, and the new project got no `.git`.
test.concurrent(
  "bun create initializes the new project's own repository when GIT_DIR points at another one",
  async () => {
    using dir = tempDir("create-gitdir", {
      "bun-create/tmpl/index.js": "// hi\n",
      "bun-create/tmpl/package.json": JSON.stringify({ name: "tmpl", version: "1.0.0" }),
      "other/keep.txt": "keep\n",
      "gitconfig": "",
    });
    const root = String(dir);
    const other = join(root, "other");
    const log = async (repo: string) => {
      await using proc = Bun.spawn({
        cmd: ["git", "-C", repo, "log", "--format=%s", "--name-status"],
        env: gitEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      if (exitCode !== 0) throw new Error(`git log failed:\n${stderr}`);
      return stdout;
    };
    await git(other, "init", "-q", "-b", "main");
    await git(other, "add", "-A");
    await git(other, "-c", "commit.gpgsign=false", "commit", "-qm", "other-initial");
    expect(await log(other)).toBe("other-initial\n\nA\tkeep.txt\n");

    const { stderr, exitCode } = await runBun(
      root,
      join(root, "cache"),
      {
        BUN_CREATE_DIR: join(root, "bun-create"),
        // Don't use the machine's config, because `commit.gpgsign` would make the commit fail.
        GIT_CONFIG_GLOBAL: join(root, "gitconfig"),
        GIT_DIR: join(other, ".git"),
        GIT_INDEX_FILE: join(other, ".git", "index"),
      },
      "create",
      "tmpl",
      join(root, "dest"),
      "--no-install",
    );
    expect(diagnostics(stderr)).toEqual([]);
    expect(await log(other)).toBe("other-initial\n\nA\tkeep.txt\n");
    expect(await log(join(root, "dest"))).toBe("Initial commit (via bun create)\n\nA\tindex.js\nA\tpackage.json\n");
    expect(exitCode).toBe(0);
  },
);

// `bun install` loads the project's `.env*` files so that bunfig.toml can reference `$VARIABLES`. Those files come with
// the repository that's being installed, so they must not configure the git that the install spawns. git runs whatever
// `GIT_SSH_COMMAND`, `GIT_EXEC_PATH` or a `GIT_CONFIG_*` entry points to, even with `--ignore-scripts`. Only the
// environment that `bun install` was started with is passed on.
//
// The variables that a test sets through `.env` are removed from the install's real environment, because a real
// variable wins over `.env` in every build.
const noGitTooling = {
  GIT_SSH: undefined,
  GIT_SSH_COMMAND: undefined,
  GIT_CONFIG_COUNT: undefined,
  GIT_CONFIG_GLOBAL: undefined,
  SSH_AUTH_SOCK: undefined,
  XDG_CONFIG_HOME: undefined,
};

// Returns `<bun> <script> <args>` in the form that git runs it, which is through `sh -c`. Uses forward slashes so that
// the sh in Git for Windows accepts the paths too.
function shCommand(script: string, ...args: string[]) {
  return [bunExe(), script, ...args].map(arg => `"${arg.replaceAll("\\", "/")}"`).join(" ");
}

test.concurrent("a git config entry in the project's .env does not reach the git of the install", async () => {
  using dir = tempDir("git-dep-dotenv-config", {
    // git runs the `core.fsmonitor` command when it checks a commit out.
    "fsmonitor.js": `
      import { writeFileSync } from "node:fs";
      writeFileSync(process.argv[2], "");
    `,
  });
  const root = String(dir);
  const repoUrl = `git+${pathToFileURL(sharedBare)}`;
  const project = writeProject(root, { [nameOf("b")]: `${repoUrl}#pkg-b` });
  const { resolutions } = expectedGitPackages(repoUrl, sharedCommits, ["b"]);
  const ran = join(root, "fsmonitor-ran");
  writeFileSync(
    join(project, ".env"),
    [
      "GIT_CONFIG_COUNT=1",
      "GIT_CONFIG_KEY_0=core.fsmonitor",
      `GIT_CONFIG_VALUE_0='${shCommand(join(root, "fsmonitor.js"), ran)}'`,
      "",
    ].join("\n"),
  );

  const { stdout, stderr, exitCode } = await runInstall(project, join(root, "cache"), noGitTooling, "--ignore-scripts");
  expect(existsSync(ran)).toBe(false);
  expect(stderr).toContain("Saved lockfile");
  expectInstalled(stdout, resolutions);
  expect(await installedVersions(project, [nameOf("b")])).toEqual(markers(["b"]));
  expect(exitCode).toBe(0);
});

test.concurrent("a GIT_SSH_COMMAND in the project's .env does not replace the user's ssh command", async () => {
  using dir = tempDir("git-dep-dotenv-ssh", {
    // Replaces ssh. It records that git ran it and then fails, so that the clone ends there.
    "ssh.js": `
      import { writeFileSync } from "node:fs";
      writeFileSync(process.argv[2], "");
      process.exit(255);
    `,
  });
  const root = String(dir);
  const project = writeProject(root, { "pkg": "git+ssh://git@localhost/scope/pkg.git" });
  const ranFromDotenv = join(root, "ran-from-dotenv");
  const ranFromGitconfig = join(root, "ran-from-gitconfig");
  writeFileSync(join(project, ".env"), `GIT_SSH_COMMAND='${shCommand(join(root, "ssh.js"), ranFromDotenv)}'\n`);
  // The user's own ssh command, from their global git config.
  const home = join(root, "home");
  mkdirSync(home);
  const sshCommand = shCommand(join(root, "ssh.js"), ranFromGitconfig).replaceAll('"', '\\"');
  writeFileSync(join(home, ".gitconfig"), `[core]\n\tsshCommand = "${sshCommand}"\n`);

  const { stderr, exitCode } = await runInstall(
    project,
    join(root, "cache"),
    // The install tries the https form of the URL first. git refuses that
    // protocol here, so nothing connects to port 443.
    { ...noGitTooling, HOME: home, USERPROFILE: home, GIT_ALLOW_PROTOCOL: "ssh" },
    "--ignore-scripts",
  );
  expect({ ranFromDotenv: existsSync(ranFromDotenv), ranFromGitconfig: existsSync(ranFromGitconfig) }).toEqual({
    ranFromDotenv: false,
    ranFromGitconfig: true,
  });
  expect(stderr).toContain('"git clone" for "pkg" failed');
  expect(exitCode).toBe(1);
});

test.concurrent.skipIf(isWindows)("a PATH in the project's .env does not choose the git of the install", async () => {
  using dir = tempDir("git-dep-dotenv-path", {});
  const root = String(dir);
  const ran = join(root, "ran");
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin", "git"), `#!/bin/sh\n: > ${quote(ran)}\nexit 1\n`, { mode: 0o755 });
  const project = writeProject(root, { pkg: `git+${pathToFileURL(sharedBare)}#pkg-b` });
  writeFileSync(join(project, ".env"), `PATH='${join(root, "bin")}'\n`);

  const { stderr, exitCode } = await runInstall(project, join(root, "cache"), { PATH: undefined }, "--ignore-scripts");
  expect(existsSync(ran)).toBe(false);
  expect(diagnostics(stderr)).toContain('error: "git" is not installed (needed for "pkg")');
  expect(exitCode).toBe(1);
});

test.concurrent("git credentials in the project's .env are not sent", async () => {
  const seen: (string | null)[] = [];
  await using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      seen.push(req.headers.get("authorization"));
      // git prints a text/plain error body as "remote: ..." lines.
      return new Response("Repository not found.\n", { status: 404, headers: { "content-type": "text/plain" } });
    },
  });

  using dir = tempDir("git-dep-dotenv-credentials", {});
  const root = String(dir);
  const project = writeProject(root, { "pkg": `git+http://127.0.0.1:${server.port}/scope/private.git` });
  writeFileSync(
    join(project, ".env"),
    [
      "GIT_CONFIG_COUNT=1",
      "GIT_CONFIG_KEY_0=http.extraHeader",
      "GIT_CONFIG_VALUE_0='Authorization: Basic dXNlcjpTRUNSRVQ='",
      "",
    ].join("\n"),
  );
  // Don't use the machine's global git config, because it can have its own `http.extraHeader`.
  const home = join(root, "home");
  mkdirSync(home);

  const { stderr, exitCode } = await runInstall(
    project,
    join(root, "cache"),
    { ...noGitTooling, HOME: home, USERPROFILE: home },
    "--ignore-scripts",
  );
  expect(seen.length).toBeGreaterThan(0);
  expect(seen).toEqual(seen.map(() => null));
  expect(stderr).toContain('"git clone" for "pkg" failed');
  expect(exitCode).toBe(1);
});

// Installs `{ pkg: dependency }` with a `git` that records its arguments and fails, so that the install tries every
// form of the clone URL without a connection. Returns the arguments of each call, without the temporary folder at the
// end of a clone.
async function failingGitCalls(dependency: string) {
  using dir = tempDir("git-dep-clone-url", {
    // `git config` comes first, because the install asks for the user's own ssh command.
    "bin/git": `#!/bin/sh\n[ "$6" = config ] && exit 1\nfor arg in "$@"; do printf '%s\\n' "$arg"; done >> "$GIT_CALLS"\necho >> "$GIT_CALLS"\nexit 128\n`,
  });
  const root = String(dir);
  chmodSync(join(root, "bin", "git"), 0o755);
  // Anything that isn't a git dependency is requested from this registry.
  await using registry = Bun.serve({ port: 0, fetch: () => new Response("not found", { status: 404 }) });
  const project = writeProject(root, { pkg: dependency });
  const calls = join(root, "git-calls");
  writeFileSync(calls, "");
  const { stderr, exitCode } = await runInstall(project, join(root, "cache"), {
    PATH: `${join(root, "bin")}:${gitEnv.PATH}`,
    GIT_CALLS: calls,
    BUN_CONFIG_REGISTRY: registry.url.href,
  });
  return {
    calls: readFileSync(calls, "utf8")
      .split("\n\n")
      .filter(call => call !== "")
      .map(call => call.split("\n").slice(0, -1)),
    stderr,
    exitCode,
  };
}

// The install tries the https form of a clone URL, then the ssh form.
test.concurrent.skipIf(isWindows).each([
  // #36931: a URL that parses is passed on as it is. The port used to become a
  // path segment (`ssh://git@localhost/52626/...`).
  ["git+ssh://git@localhost:52626/user/repo.git#v1.0.0", "git@localhost:52626/user/repo.git"],
  ["git+ssh://deploy@localhost:2222/repo.git", "deploy@localhost:2222/repo.git"],
  ["git+ssh://git@[::1]:2222/user/repo.git", "git@[::1]:2222/user/repo.git"],
  ["git+ssh://git@localhost:2222/üser/repo.git", "git@localhost:2222/üser/repo.git"],
  // A colon in the path is not an scp-style separator either.
  ["git+ssh://git@localhost/user/re:po.git", "git@localhost/user/re:po.git"],
  // Without userinfo, the colon of the scheme itself used to be rewritten (`ssh///localhost/...`).
  ["git+ssh://localhost/user/repo.git", "localhost/user/repo.git"],
  // On the hosts of the shorthands, `git` is only the ssh account.
  ["git+ssh://git@gitlab.com/user/repo", "gitlab.com/user/repo", "git@gitlab.com/user/repo"],
  ["git+ssh://git@github.com/user/repo.git", "github.com/user/repo.git", "git@github.com/user/repo.git"],
  ["git+ssh://deploy@gitlab.com/user/repo", "deploy@gitlab.com/user/repo"],
  // An scp-style path behind `ssh://`, which is how bun.lock spells one, whatever the path starts with.
  // The https form used to keep the colon, which no https client takes for a URL.
  ["git+ssh://git@localhost:user/repo.git", "git@localhost/user/repo.git"],
  ["git+ssh://git@localhost:1user/repo.git", "git@localhost/1user/repo.git"],
  ["git+ssh://git@höst:user/repo.git", "git@höst/user/repo.git"],
  ["git+ssh://git@[::1]:user/repo.git", "git@[::1]/user/repo.git"],
  ["git+ssh://myhost.example:org/repo.git", "myhost.example/org/repo.git", "git@myhost.example/org/repo.git"],
  // An scp-style path gets `git@` only if it names no user (it used to become `ssh://git@deploy@...`).
  ["git+myhost.example:org/repo.git", "myhost.example/org/repo.git", "git@myhost.example/org/repo.git"],
  ["git+github:mishoo/UglifyJS.git", "github.com/mishoo/UglifyJS.git", "git@github.com/mishoo/UglifyJS.git"],
  ["git+myhost.example:org/name@1.git", "myhost.example/org/name@1.git", "git@myhost.example/org/name@1.git"],
  ["git+deploy@myhost.example:org/repo.git", "deploy@myhost.example/org/repo.git"],
  ["git+deploy@myhost.example/org/repo.git", "deploy@myhost.example/org/repo.git"],
  ["bun@github.com:owner/repo.git", "bun@github.com/owner/repo.git"],
  // A shorthand host means a domain, even after `ssh://`. It used to be cloned from the host `gitlab`.
  ["gitlab:group/sub/repo", "gitlab.com/group/sub/repo", "git@gitlab.com/group/sub/repo"],
  ["git+ssh://gitlab:group/sub/repo", "gitlab.com/group/sub/repo", "git@gitlab.com/group/sub/repo"],
  ["bitbucket:user/repo", "bitbucket.org/user/repo", "git@bitbucket.org/user/repo"],
  ["git+ssh://bitbucket:user/repo", "bitbucket.org/user/repo", "git@bitbucket.org/user/repo"],
  ["gist:0123456789abcdef", "gist.github.com/0123456789abcdef", "git@gist.github.com/0123456789abcdef"],
  ["sourcehut:~user/repo", "git.sr.ht/~user/repo", "git@git.sr.ht/~user/repo"],
  // Passed as it is, git would read it as a directory in the project.
  ["git@localhost/user/repo.git", "git@localhost/user/repo.git"],
  // ssh must not read the user or the host as an option.
  [
    "git+-oProxyCommand=x@localhost:org/repo.git",
    "-oProxyCommand=x@localhost/org/repo.git",
    "git@-oProxyCommand=x@localhost/org/repo.git",
  ],
  [
    "git+ssh://-oProxyCommand=x@localhost:org/repo.git",
    "-oProxyCommand=x@localhost/org/repo.git",
    "git@-oProxyCommand=x@localhost/org/repo.git",
  ],
  ["git+ssh://-oProxyCommand=x:org/repo.git", "-oProxyCommand=x/org/repo.git", "git@-oProxyCommand=x/org/repo.git"],
])("clones %s from the right URLs", async (dependency, https, ssh = https) => {
  const { calls, stderr, exitCode } = await failingGitCalls(dependency);
  // After `--`, git doesn't treat anything as an option.
  const clone = [
    "-c",
    `core.hooksPath=${nullDevice}`,
    "-c",
    "submodule.recurse=false",
    "clone",
    "-c",
    "core.longpaths=true",
    "--quiet",
    "--bare",
    "--template=",
    "--",
  ];
  expect(calls).toEqual([
    [...clone, `https://${https}`],
    [...clone, `ssh://${ssh}`],
  ]);
  expect(stderr).toContain('"git clone" for "pkg" failed');
  expect(exitCode).toBe(1);
});

const libPackage = { "package.json": JSON.stringify({ name: "lib", version: "1.0.0" }) };

// The lockfile is all that a clean machine has, so it names the host itself.
// It used to say `git+ssh://gitlab:group/lib`, which was then cloned from the host `gitlab`.
test.concurrent.each([
  ["gitlab:group/lib", "gitlab.com/group/lib", "bun.lock"],
  ["gitlab:group/lib", "gitlab.com/group/lib", "bun.lockb"],
  ["gitlab:group/lib#main", "gitlab.com/group/lib", "bun.lock"],
  ["gitlab:group/sub/lib", "gitlab.com/group/sub/lib", "bun.lock"],
  ["bitbucket:team/lib", "bitbucket.org/team/lib", "bun.lock"],
  ["gist:0123456789abcdef", "gist.github.com/0123456789abcdef", "bun.lock"],
  ["sourcehut:~user/lib", "git.sr.ht/~user/lib", "bun.lock"],
])("%s installs on a clean machine from %s in %s", async (dependency, hostAndPath, lockfile) => {
  using repo = await hostedGitRepository([`https://${hostAndPath}`], libPackage);
  using dir = tempDir("git-dep-shorthand", {});
  const root = String(dir);
  const project = writeProject(root, { lib: dependency });
  writeFileSync(join(project, "bunfig.toml"), `[install]\nsaveTextLockfile = ${lockfile === "bun.lock"}\n`);
  const resolution = `git+ssh://git@${hostAndPath}#${repo.sha}`;

  const first = await runInstall(project, join(root, "cache"), repo.env);
  expectInstalled(first.stdout, { lib: resolution });
  expect(existsSync(join(project, lockfile))).toBe(true);
  if (lockfile === "bun.lock") {
    expect(await lockedPackages(project)).toEqual({ lib: [`lib@${resolution}`, { version: "1.0.0" }, repo.sha] });
  }
  expect(first.exitCode).toBe(0);

  rmSync(join(project, "node_modules"), { recursive: true });
  const clean = await runInstall(project, join(root, "clean-cache"), repo.env, "--frozen-lockfile");
  expectInstalled(clean.stdout, { lib: resolution });
  expect(clean.exitCode).toBe(0);
});

// Lockfiles like that exist. So do lockfiles with a `host:path` that has no user. Their https form kept the colon, and
// their ssh form logged in as whoever ran the install.
test.concurrent.each([
  ["gitlab:group/lib", "gitlab:group/lib", "gitlab.com/group/lib"],
  ["bitbucket:team/lib", "bitbucket:team/lib", "bitbucket.org/team/lib"],
  ["gitlab.com:group/lib", "gitlab.com:group/lib", "gitlab.com/group/lib"],
  // Tried over https first, like without a bun.lock, because a machine without an ssh key can still read a public
  // repository.
  ["git@example.com:group/lib.git", "git@example.com:group/lib.git", "git@example.com/group/lib.git"],
])("a bun.lock that has %s as git+ssh://%s installs on a clean machine", async (dependency, locked, hostAndPath) => {
  using repo = await hostedGitRepository([`https://${hostAndPath}`], libPackage);
  using dir = tempDir("git-dep-shorthand-locked", {});
  const root = String(dir);
  const project = writeProject(root, { lib: dependency });
  const resolution = `git+ssh://${locked}#${repo.sha}`;
  const lockfile = JSON.stringify({
    lockfileVersion: 1,
    configVersion: 1,
    workspaces: { "": { name: "project", dependencies: { lib: dependency } } },
    packages: { lib: [`lib@${resolution}`, {}, repo.sha] },
  });
  writeFileSync(join(project, "bun.lock"), lockfile);

  const frozen = await runInstall(project, join(root, "cache"), repo.env, "--frozen-lockfile");
  expectInstalled(frozen.stdout, { lib: resolution });
  expect(frozen.exitCode).toBe(0);

  // Nothing changed, so nothing is saved.
  const again = await runInstall(project, join(root, "cache"), repo.env);
  expect(again.stderr).not.toContain("Saved lockfile");
  expect(again.stdout).toContain("(no changes)");
  expect(readFileSync(join(project, "bun.lock"), "utf8")).toBe(lockfile);
  expect(again.exitCode).toBe(0);
});

// The name of the store entry comes from the repository as the lockfile has it. That text used to differ between the
// install that wrote the lockfile and the installs that read it.
test.concurrent.each([
  ["gitlab:group/lib", "gitlab.com/group/lib"],
  ["gitlab.com:group/lib", "gitlab.com/group/lib"],
  ["git@example.com:group/lib.git", "git@example.com/group/lib.git"],
])("a second isolated install of %s changes nothing", async (dependency, hostAndPath) => {
  using repo = await hostedGitRepository([`https://${hostAndPath}`], libPackage);
  using dir = tempDir("git-dep-shorthand-isolated", {});
  const root = String(dir);
  const project = writeProject(root, { lib: dependency });
  const store = join(project, "node_modules", ".bun");

  const first = await runInstall(project, join(root, "cache"), repo.env, "--linker", "isolated");
  expect(first.stderr).toContain("Saved lockfile");
  expect(first.exitCode).toBe(0);
  const entries = readdirSync(store).sort();

  const second = await runInstall(project, join(root, "cache"), repo.env, "--linker", "isolated");
  expect(second.stdout).toContain("(no changes)");
  expect(readdirSync(store).sort()).toEqual(entries);
  expect(second.exitCode).toBe(0);
});

// It's neither a URL nor an scp-style path, so git would read it as a directory in the project and clone that.
test.concurrent.skipIf(isWindows)("does not hand a bare word to git clone", async () => {
  const { calls, stderr, exitCode } = await failingGitCalls("git+:latest");
  expect(calls).toEqual([]);
  // It's a git dependency, so the registry wasn't asked for a `git+:latest` tag.
  expect(diagnostics(stderr)).toContain("error: RepositoryNotFound cloning repository for pkg");
  expect(exitCode).toBe(1);
});

// A committish comes from a package.json that anyone can publish.
test.concurrent("does not read a committish as an option of git", async () => {
  using dir = tempDir("git-dep-option-committish", {});
  const root = String(dir);
  const written = join(root, "written-by-git");
  const committish = `--output=${written}`;
  const project = writeProject(root, { pkg: `git+${pathToFileURL(sharedBare)}#${committish}` });

  const { stderr, exitCode } = await runInstall(project, join(root, "cache"), {});
  expect(diagnostics(stderr)).toContain(
    `error: no commit matching "${committish}" found for "pkg" (but repository exists)`,
  );
  expect(existsSync(written)).toBe(false);
  expect(exitCode).toBe(1);
});

// So does a bun.lock. Neither the URL nor the commit of a row is an option of git.
test.concurrent.each([
  ["URL", (url: string, sha: string) => [`pkg@git+--upload-pack=touch written-by-git#${sha}`, {}, sha]],
  ["commit", (url: string) => [`pkg@${url}#--output=written-by-git`, {}, "--output=written-by-git"]],
])("does not read the %s of a bun.lock row as an option of git", async (_, row) => {
  using dir = tempDir("git-dep-option-lockfile", {});
  const root = String(dir);
  const url = `git+${pathToFileURL(sharedBare)}`;
  const project = writeProject(root, { pkg: `${url}#pkg-b` });
  writeFileSync(
    join(project, "bun.lock"),
    JSON.stringify({
      lockfileVersion: 1,
      configVersion: 1,
      workspaces: { "": { name: "project", dependencies: { pkg: `${url}#pkg-b` } } },
      packages: { pkg: row(url, sharedCommits["pkg-b"]) },
    }),
  );

  const cache = join(root, "cache");
  const { exitCode } = await runInstall(project, cache, {}, "--frozen-lockfile");
  const files = [project, cache].flatMap(folder =>
    existsSync(folder) ? readdirSync(folder, { recursive: true }) : [],
  );
  expect(files.filter(file => String(file).includes("written-by-git"))).toEqual([]);
  expect(exitCode).toBe(1);
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
    const lineCount = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").length - 1 : 0);
    // A fake git. Each process appends a line to `running` when it starts, to
    // `exited` when it ends, and blocks until the test deletes `running`. A
    // SIGINT that bun forwards to one of them is recorded in `gotSigint`, which
    // makes every other fake git (the concurrent clone, the retry over ssh)
    // exit at once. The `git config` that comes before the first clone is not one of them.
    writeFileSync(
      join(bin, "git"),
      `#!/bin/sh
[ "$6" = config ] && exit 1
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
        // The kernel kills them together with bun (PR_SET_PDEATHSIG). `running` still exists.
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

// bun.lock resolves an optional git dependency, the cache is cold, and the
// repository is gone. The install phase failed for it with either linker. An
// optional registry package that cannot be downloaded is left out with a warning.
for (const linker of ["hoisted", "isolated"] as const) {
  // how each linker reports a package that fails the install
  const failed = (step: string, name: string, resolution: string) =>
    linker === "hoisted"
      ? `error: InstallFailed ${step} repository for ${name}`
      : `error: failed to download ${name}@${resolution}: InstallFailed`;

  test.concurrent(
    `${linker} linker skips a locked optional git dependency that cannot be cloned`,
    async () => {
      using dir = tempDir(`git-dep-${linker}-optional-clone`, {});
      const root = String(dir);
      const bare = await makeSharedRepo(root, [{ name: nameOf("o"), branch: "pkg-o" }]);
      const optionalUrl = `git+${pathToFileURL(bare)}`;
      const project = writeProject(
        root,
        { [nameOf("b")]: `git+${pathToFileURL(sharedBare)}#pkg-b` },
        { optionalDependencies: { [nameOf("o")]: `${optionalUrl}#pkg-o` } },
      );

      const warm = await runInstall(project, join(root, "cache-warm"), {}, `--linker=${linker}`);
      expect(diagnostics(warm.stderr)).toEqual([]);
      expect(warm.exitCode).toBe(0);

      // a fresh machine that cannot reach the repository of the optional package
      rmSync(bare, { recursive: true });
      rmSync(join(project, "node_modules"), { recursive: true });
      const { stderr, exitCode } = await runInstall(project, join(root, "cache-cold"), {}, `--linker=${linker}`);
      expect(diagnostics(stderr)).toEqual([
        expect.stringMatching(/^warn: git failed with exit code \d+$/),
        `warn: "git clone" for "${nameOf("o")}" failed`,
        `warn: InstallFailed cloning repository for ${nameOf("o")}`,
      ]);
      expect(await installedVersions(project, [nameOf("b"), nameOf("o")])).toEqual({
        [nameOf("b")]: "pkg-b",
        [nameOf("o")]: null,
      });
      expect(exitCode).toBe(0);

      // `--silent` drops the warnings, and what git printed
      rmSync(join(project, "node_modules"), { recursive: true });
      const silent = await runInstall(project, join(root, "cache-silent"), {}, `--linker=${linker}`, "--silent");
      expect(silent).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    },
    30_000,
  );

  // The commit in bun.lock is gone from the repository, so the clone works and `git checkout` fails. That's still an
  // error for every package, like a tarball that can't be extracted.
  test.concurrent(
    `${linker} linker fails for a locked optional git dependency that cannot be checked out`,
    async () => {
      using dir = tempDir(`git-dep-${linker}-optional-checkout`, {});
      const root = String(dir);
      const bare = await makeSharedRepo(root, [{ name: nameOf("o"), branch: "pkg-o" }]);
      const optionalUrl = `git+${pathToFileURL(bare)}`;
      const lockedCommit = branchCommits(bare)["pkg-o"];
      const project = writeProject(root, {}, { optionalDependencies: { [nameOf("o")]: `${optionalUrl}#pkg-o` } });

      const warm = await runInstall(project, join(root, "cache-warm"), {}, `--linker=${linker}`);
      expect(diagnostics(warm.stderr)).toEqual([]);
      expect(warm.exitCode).toBe(0);

      // the repository starts over with another history
      rmSync(bare, { recursive: true });
      await makeSharedRepo(root, [{ name: nameOf("o"), branch: "pkg-o", files: { "README.md": "rewritten" } }]);
      expect(branchCommits(bare)["pkg-o"]).not.toBe(lockedCommit);
      rmSync(join(project, "node_modules"), { recursive: true });
      const { stderr, exitCode } = await runInstall(project, join(root, "cache-cold"), {}, `--linker=${linker}`);
      expect(diagnostics(stderr)).toEqual([
        expect.stringMatching(/^error: git failed with exit code \d+$/),
        `error: "git ls-tree" for "${nameOf("o")}" failed`,
        failed("checking out", nameOf("o"), `${optionalUrl}#${lockedCommit}`),
      ]);
      expect(exitCode).toBe(1);
    },
    30_000,
  );

  // The package that depends on it is optional, the dependency itself is not.
  // That fails the install, as it does for a registry package.
  test.concurrent(
    `${linker} linker fails for a git dependency of an optional package that cannot be cloned`,
    async () => {
      using dir = tempDir(`git-dep-${linker}-optional-parent`, {});
      const root = String(dir);
      const childBare = await makeSharedRepo(root, [{ name: nameOf("q"), branch: "pkg-q" }], "child-repo.git");
      const childUrl = `git+${pathToFileURL(childBare)}`;
      const childCommit = branchCommits(childBare)["pkg-q"];
      const parentBare = await makeSharedRepo(
        root,
        [{ name: nameOf("p"), branch: "pkg-p", dependencies: { [nameOf("q")]: `${childUrl}#pkg-q` } }],
        "parent-repo.git",
      );
      const project = writeProject(
        root,
        {},
        { optionalDependencies: { [nameOf("p")]: `git+${pathToFileURL(parentBare)}#pkg-p` } },
      );

      const warm = await runInstall(project, join(root, "cache-warm"), {}, `--linker=${linker}`);
      expect(diagnostics(warm.stderr)).toEqual([]);
      expect(warm.exitCode).toBe(0);

      rmSync(childBare, { recursive: true });
      rmSync(join(project, "node_modules"), { recursive: true });
      const { stderr, exitCode } = await runInstall(project, join(root, "cache-cold"), {}, `--linker=${linker}`);
      expect(diagnostics(stderr)).toEqual([
        expect.stringMatching(/^error: git failed with exit code \d+$/),
        `error: "git clone" for "${nameOf("q")}" failed`,
        failed("cloning", nameOf("q"), `${childUrl}#${childCommit}`),
      ]);
      expect(exitCode).toBe(1);
    },
    30_000,
  );

  // The root's optional dependency comes first and requests the package. `req` also depends on the package, which still
  // makes it required.
  test.concurrent(
    `${linker} linker fails for an optional git dependency that a required package depends on too`,
    async () => {
      using dir = tempDir(`git-dep-${linker}-optional-and-required`, {});
      const root = String(dir);
      const bare = await makeSharedRepo(root, [{ name: nameOf("o"), branch: "pkg-o" }]);
      const repoUrl = `git+${pathToFileURL(bare)}`;
      const commit = branchCommits(bare)["pkg-o"];
      const project = writeProject(
        root,
        { req: "file:./req" },
        { optionalDependencies: { [nameOf("o")]: `${repoUrl}#pkg-o` } },
      );
      mkdirSync(join(project, "req"));
      writeFileSync(
        join(project, "req", "package.json"),
        JSON.stringify({ name: "req", version: "1.0.0", dependencies: { [nameOf("o")]: `${repoUrl}#pkg-o` } }),
      );

      const warm = await runInstall(project, join(root, "cache-warm"), {}, `--linker=${linker}`);
      expect(diagnostics(warm.stderr)).toEqual([]);
      expect(warm.exitCode).toBe(0);

      rmSync(bare, { recursive: true });
      rmSync(join(project, "node_modules"), { recursive: true });
      const { stderr, exitCode } = await runInstall(project, join(root, "cache-cold"), {}, `--linker=${linker}`);
      expect(diagnostics(stderr)).toEqual([
        expect.stringMatching(/^error: git failed with exit code \d+$/),
        `error: "git clone" for "${nameOf("o")}" failed`,
        failed("cloning", nameOf("o"), `${repoUrl}#${commit}`),
      ]);
      expect(exitCode).toBe(1);
    },
    30_000,
  );

  // One clone serves both packages. The optional one does not make its failure a warning.
  test.concurrent(
    `${linker} linker fails when a required git dependency shares the repository of an optional one`,
    async () => {
      using dir = tempDir(`git-dep-${linker}-optional-shared`, {});
      const root = String(dir);
      const bare = await makeSharedRepo(root, [
        { name: nameOf("m"), branch: "pkg-m" },
        { name: nameOf("n"), branch: "pkg-n" },
      ]);
      const repoUrl = `git+${pathToFileURL(bare)}`;
      const commits = branchCommits(bare);
      const project = writeProject(
        root,
        { [nameOf("m")]: `${repoUrl}#pkg-m` },
        { optionalDependencies: { [nameOf("n")]: `${repoUrl}#pkg-n` } },
      );

      const warm = await runInstall(project, join(root, "cache-warm"), {}, `--linker=${linker}`);
      expect(diagnostics(warm.stderr)).toEqual([]);
      expect(warm.exitCode).toBe(0);

      rmSync(bare, { recursive: true });
      rmSync(join(project, "node_modules"), { recursive: true });
      const { stderr, exitCode } = await runInstall(project, join(root, "cache-cold"), {}, `--linker=${linker}`);
      // The optional package comes first and starts the clone.
      expect(diagnostics(stderr)).toEqual([
        expect.stringMatching(/^error: git failed with exit code \d+$/),
        `error: "git clone" for "${nameOf("n")}" failed`,
        ...(linker === "hoisted"
          ? [failed("cloning", nameOf("n"), "")]
          : [
              failed("cloning", nameOf("n"), `${repoUrl}#${commits["pkg-n"]}`),
              failed("cloning", nameOf("m"), `${repoUrl}#${commits["pkg-m"]}`),
            ]),
      ]);
      expect(exitCode).toBe(1);
    },
    30_000,
  );
}

// The hoisted linker handles finished tasks after every 16 dependencies. The optional package comes first, and without
// git its clone fails immediately. The required package, 40 dependencies later, must not join that finished clone,
// because nothing would report that it's missing.
test.concurrent(
  "hoisted linker fails for a required git dependency after an optional one failed to clone the same repository",
  async () => {
    using dir = tempDir("git-dep-hoisted-optional-first", {});
    const root = String(dir);
    const bare = await makeSharedRepo(root, [
      { name: "aa-optional", branch: "optional" },
      { name: "zz-required", branch: "required" },
    ]);
    const repoUrl = `git+${pathToFileURL(bare)}`;
    const fillers = Array.from({ length: 40 }, (_, i) => `filler-${String(i).padStart(2, "0")}`);
    const project = writeProject(
      root,
      { ...Object.fromEntries(fillers.map(name => [name, `file:./${name}`])), "zz-required": `${repoUrl}#required` },
      { optionalDependencies: { "aa-optional": `${repoUrl}#optional` } },
    );
    for (const name of fillers) {
      mkdirSync(join(project, name));
      writeFileSync(join(project, name, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
    }

    const warm = await runInstall(project, join(root, "cache-warm"), {}, "--linker=hoisted");
    expect(diagnostics(warm.stderr)).toEqual([]);
    expect(warm.exitCode).toBe(0);

    // a fresh machine without git
    rmSync(join(project, "node_modules"), { recursive: true });
    const emptyPath = join(root, "empty-path");
    mkdirSync(emptyPath);
    const { stderr, exitCode } = await runInstall(
      project,
      join(root, "cache-cold"),
      { PATH: emptyPath },
      "--linker=hoisted",
    );
    // The error mentions the optional package if the required one was reached before the failed clone was handled,
    // because then both were waiting for that clone.
    expect(diagnostics(stderr)).toContainEqual(
      expect.stringMatching(/^error: ENOENT cloning repository for (aa-optional|zz-required)$/),
    );
    expect(exitCode).toBe(1);
  },
  30_000,
);

// `file:` folder dependencies declared by a git or tarball package are relative
// to that package, like a registry package's (registry/packages/file-dep). They
// used to be resolved against the project dir, which pointed them into the cache
// and failed the install with `sub@file:./sub failed to resolve`.
const FILE_DEPS_NAME = "has-file-deps";

// `file:` folder dependencies on a subfolder and on the package itself.
const fileDepsManifest = {
  name: FILE_DEPS_NAME,
  version: "1.0.0",
  dependencies: {
    "sub": "file:./sub",
    [`${FILE_DEPS_NAME}-self`]: "file:.",
  },
};

const fileDepsFiles = {
  "index.js": `module.exports = require("sub");\n`,
  "sub/package.json": JSON.stringify({ name: "sub", version: "1.0.0" }),
  "sub/index.js": `module.exports = "sub-ok";\n`,
};

// Packs `manifest` and `files` into `tarball`, a `.tgz` path.
async function packTarball(tarball: string, manifest: object, files: Record<string, string>) {
  mkdirSync(dirname(tarball), { recursive: true });
  writeFileSync(tarball, await tarballOf("package", { "package.json": JSON.stringify(manifest), ...files }));
}

async function linkedJson(link: string) {
  expect((await lstat(link)).isSymbolicLink()).toBe(true);
  return Bun.file(resolve(dirname(link), await readlink(link))).json();
}

async function expectFileDepsInstalled(project: string) {
  const name = FILE_DEPS_NAME;
  const nested = join(project, "node_modules", name, "node_modules");
  const lockfile = await Bun.file(join(project, "bun.lock")).text();
  expect(lockfile).toContain(`"${name}/sub": ["sub@file:./sub", {}]`);
  expect(lockfile).toContain(`"${name}/${name}-self": ["${name}-self@file:.", {}]`);

  // Transitive folder dependencies are not hoisted: each one is linked into
  // the declaring package's own node_modules, relative to that package, as one
  // link to the folder (`file:.` as one symlink per file).
  expect((await readdir(nested)).sort()).toEqual([`${name}-self`, "sub"]);
  expect((await lstat(join(nested, "sub"))).isSymbolicLink()).toBe(true);
  expect((await lstat(join(nested, "sub", "package.json"))).isFile()).toBe(true);
  expect(await Bun.file(join(nested, "sub", "package.json")).json()).toEqual({ name: "sub", version: "1.0.0" });
  expect(await linkedJson(join(nested, `${name}-self`, "package.json"))).toEqual(fileDepsManifest);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `console.log(require(${JSON.stringify(name)}))`],
    cwd: project,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "sub-ok\n", stderr: "", exitCode: 0 });
}

for (const spec of ["file: path", "http url"] as const) {
  test.concurrent(`installs the file: folder dependencies declared by a tarball package (${spec})`, async () => {
    using dir = tempDir("tarball-file-deps", {});
    const root = String(dir);
    const tarballs = join(root, "tarballs");
    await packTarball(join(tarballs, `${FILE_DEPS_NAME}.tgz`), fileDepsManifest, fileDepsFiles);
    await using server = serveStatic(tarballs);
    const project = writeProject(root, {
      [FILE_DEPS_NAME]:
        spec === "file: path"
          ? `file:../tarballs/${FILE_DEPS_NAME}.tgz`
          : `http://localhost:${server.port}/${FILE_DEPS_NAME}.tgz`,
    });

    const { stderr, exitCode } = await runInstall(project, join(root, "cache"), {});
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    await expectFileDepsInstalled(project);

    // The stub rows written to bun.lock install again without re-resolving.
    rmSync(join(project, "node_modules"), { recursive: true });
    const frozen = await runInstall(project, join(root, "cache"), {}, "--frozen-lockfile");
    expect(frozen.stderr).not.toContain("error:");
    expect(frozen.exitCode).toBe(0);
    await expectFileDepsInstalled(project);
  });
}

test.concurrent(
  "installs the file: folder dependencies declared by a git dependency",
  async () => {
    using dir = tempDir("git-dep-file-deps", {});
    const root = String(dir);
    const bare = await makeSharedRepo(root, [
      { name: FILE_DEPS_NAME, branch: "main", dependencies: fileDepsManifest.dependencies, files: fileDepsFiles },
    ]);
    const project = writeProject(root, { [FILE_DEPS_NAME]: `git+${pathToFileURL(bare)}#main` });

    const { stderr, exitCode } = await runInstall(project, join(root, "cache"), {});
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    await expectFileDepsInstalled(project);
  },
  30_000,
);

test.concurrent("a file: folder that's missing from a tarball package is an error", async () => {
  using dir = tempDir("tarball-missing-folder", {});
  const root = String(dir);
  const manifest = { name: "lib", version: "1.0.0", dependencies: { sub: "file:./packages/typo" } };
  await packTarball(join(root, "tarballs", "lib.tgz"), manifest, {});
  const project = writeProject(root, { lib: "file:../tarballs/lib.tgz" });

  const { stderr, exitCode } = await runInstall(project, join(root, "cache"), {});
  expect(stderr).toMatch(
    /error: failed to read package\.json of "sub@file:\.\/packages\/typo" declared by lib@.*lib\.tgz: ENOENT/,
  );
  expect(existsSync(join(project, "bun.lock"))).toBe(false);
  expect(exitCode).toBe(1);
});

test.concurrent("rejects a file: folder dependency of a tarball package that points outside of it", async () => {
  using dir = tempDir("tarball-escaping-file-dep", {
    "outside/package.json": JSON.stringify({ name: "outside", version: "1.0.0" }),
  });
  const root = String(dir);
  const tarball = join(root, "tarballs", "escaping.tgz");
  await packTarball(tarball, { name: "escaping", version: "1.0.0", dependencies: { outside: "file:../outside" } }, {});
  const project = writeProject(root, { escaping: `file:../tarballs/escaping.tgz` });

  const { stderr, exitCode } = await runInstall(project, join(root, "cache"), {});
  expect(stderr).toContain('error: package.json not found for "file:../outside" dependency "outside"');
  expect(stderr).toContain("error: outside@file:../outside failed to resolve");
  expect(await Bun.file(join(project, "node_modules", "outside", "package.json")).exists()).toBe(false);
  expect(
    await Bun.file(join(project, "node_modules", "escaping", "node_modules", "outside", "package.json")).exists(),
  ).toBe(false);
  expect(exitCode).toBe(1);
});

// A git package whose package.json has no name is named after its repository. bun.lock stores a
// package as "<name>@<resolution>", so when that repository name itself contains an "@" (or is
// otherwise unusable as a package name) the generic name is used instead; the repository name
// used to be taken as-is, producing an entry the next install could not parse ("Ignoring
// lockfile"). Folders and tarballs without a name are covered in bun-lock.test.ts.
test.concurrent("names a git dependency without a package.json name after its repository", async () => {
  using dir = tempDir("git-dep-no-name", {});
  using oddDir = tempDir("git-dep-no-name-odd-repo", {});
  const root = String(dir);
  const repo = `git+${pathToFileURL(await makeSharedRepo(root, [{ branch: "no-name" }]))}`;
  const oddRepo = `git+${pathToFileURL(await makeSharedRepo(String(oddDir), [{ branch: "odd-repo" }], "odd@repo.git"))}`;

  const project = join(root, "project");
  mkdirSync(project);
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify({
      name: "project",
      version: "1.0.0",
      dependencies: {
        "no-name-dep": `${repo}#no-name`,
        "odd-repo-dep": `${oddRepo}#odd-repo`,
      },
    }),
  );

  let { stderr, exitCode } = await runInstall(project, join(root, "cache"), {});
  expect(stderr).not.toContain("error:");
  expect(await installedVersionOf(project, "no-name-dep")).toBe("no-name");
  expect(await installedVersionOf(project, "odd-repo-dep")).toBe("odd-repo");
  expect(exitCode).toBe(0);

  const lockfile = await Bun.file(join(project, "bun.lock")).text();
  expect(lockfile).toContain(`"no-name-dep": ["shared-repo.git@${repo}#`);
  expect(lockfile).toContain(`"odd-repo-dep": ["unnamed-package@${oddRepo}#`);

  ({ stderr, exitCode } = await runInstall(project, join(root, "cache"), {}, "--frozen-lockfile"));
  expect(stderr).not.toContain("Ignoring lockfile");
  expect(stderr).not.toContain("error:");
  expect(await Bun.file(join(project, "bun.lock")).text()).toBe(lockfile);
  expect(exitCode).toBe(0);
});

// The tests below refresh a bare clone that the cache already has. `git clone --bare`
// configures no fetch refspec, so the refresh, a plain `git fetch`, only wrote
// FETCH_HEAD: every later lookup of a branch, a tag or HEAD read the refs as they were
// when the repository was first cached, until `bun pm cache rm`.

// Creates `shared-repo.git` under `root` (served on `port`) with the one branch
// `branch`, which HEAD names, and installs a project that depends on it as `dep`.
// `tag` is created on the branch's commit. `committish` "" depends on the remote HEAD.
async function installedFromBranch(
  root: string,
  port: number,
  branch: string,
  { tag = "", committish = tag || branch, env = {} as NodeJS.Dict<string> } = {},
) {
  const bare = await makeSharedRepo(root, [{ name: "dep", branch }]);
  await git(bare, "symbolic-ref", "HEAD", `refs/heads/${branch}`);
  if (tag) await git(bare, "tag", tag, branch);
  await git(bare, "update-server-info");

  const repoUrl = `git+http://localhost:${port}/shared-repo.git`;
  const project = writeProject(root, { dep: committish === "" ? repoUrl : `${repoUrl}#${committish}` });
  const cache = join(root, "cache");
  const { stderr, exitCode } = await runInstall(project, cache, env);
  expect(stderr).not.toContain("error:");
  expect(await installedVersionOf(project, "dep")).toBe(branch);
  expect(exitCode).toBe(0);
  return { bare, project, cache, repoUrl };
}

// Removes node_modules and the checkouts in the cache but not the bare clone, so that
// the next install has to refresh the clone and check out from it.
function dropCheckouts(project: string, cache: string) {
  rmSync(join(project, "node_modules"), { recursive: true, force: true });
  for (const entry of readdirSync(cache)) {
    if (entry.startsWith("@G@")) rmSync(join(cache, entry), { recursive: true, force: true });
  }
}

// issue #13769. The refresh fetches `origin` by name, which must not depend on the
// user's `clone.defaultRemoteName`.
test.concurrent("bun update moves a git dependency without a committish to the new upstream HEAD", async () => {
  using dir = tempDir("git-dep-update-head", { gitconfig: "[clone]\n\tdefaultRemoteName = upstream\n" });
  const root = String(dir);
  await using server = serveStatic(root);
  const env = { GIT_CONFIG_GLOBAL: join(root, "gitconfig") };
  const { bare, project, cache } = await installedFromBranch(root, server.port!, "main", { committish: "", env });

  await moveBranch(bare, "main", "main-v2");

  const { stderr, exitCode } = await runBun(project, cache, env, "update");
  expect(stderr).not.toContain("error:");
  expect(await installedVersionOf(project, "dep")).toBe("main-v2");
  expect(await Bun.file(join(project, "bun.lock")).text()).toContain(branchCommits(bare).main);
  expect(exitCode).toBe(0);
});

// Ubuntu 22.04 has git 2.34, Debian 11 has 2.30.
test.concurrent.skipIf(isWindows)("clones with a git older than 2.39, which refuses --bare with --origin", async () => {
  using dir = tempDir("git-dep-old-git", {
    "bin/git": `#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    --bare) bare=1 ;;
    -o | --origin | --origin=*) origin=1 ;;
  esac
done
if [ -n "$bare" ] && [ -n "$origin" ]; then
  echo "fatal: --bare and --origin origin options are incompatible." >&2
  exit 128
fi
exec "${Bun.which("git")}" "$@"
`,
  });
  const root = String(dir);
  chmodSync(join(root, "bin", "git"), 0o755);
  const project = writeProject(root, { pkg: `git+${pathToFileURL(sharedBare)}#pkg-b` });

  const { stderr, exitCode } = await runInstall(project, join(root, "cache"), {
    PATH: `${join(root, "bin")}:${process.env.PATH}`,
  });
  expect(stderr).not.toContain("error:");
  expect(existsSync(join(project, "node_modules", "pkg", "package.json"))).toBe(true);
  expect(exitCode).toBe(0);
});

// issue #13769
test.concurrent("bun update <name> moves a git dependency on a branch to the new tip", async () => {
  using dir = tempDir("git-dep-update-branch", {});
  const root = String(dir);
  await using server = serveStatic(root);
  const { bare, project, cache } = await installedFromBranch(root, server.port!, "release");

  await moveBranch(bare, "release", "release-v2");

  const { stderr, exitCode } = await runBun(project, cache, {}, "update", "dep");
  expect(stderr).not.toContain("error:");
  expect(await installedVersionOf(project, "dep")).toBe("release-v2");
  expect(exitCode).toBe(0);
});

test.concurrent("bun update leaves the lockfile alone when the upstream repository has not moved", async () => {
  using dir = tempDir("git-dep-update-noop", {});
  const root = String(dir);
  await using server = serveStatic(root);
  const { project, cache } = await installedFromBranch(root, server.port!, "main");

  const lockfile = await Bun.file(join(project, "bun.lock")).text();
  const { stderr, exitCode } = await runBun(project, cache, {}, "update");
  expect(stderr).not.toContain("error:");
  expect(await installedVersionOf(project, "dep")).toBe("main");
  expect(await Bun.file(join(project, "bun.lock")).text()).toBe(lockfile);
  expect(exitCode).toBe(0);
});

// A plain `bun install` also refreshes the clone if the cache doesn't have a checkout of the locked commit. That moves
// refs in the clone, but never what bun.lock pins.
for (const linker of ["hoisted", "isolated"] as const) {
  test.concurrent(`bun install keeps the locked commit after the upstream branch moves (${linker})`, async () => {
    using dir = tempDir(`git-dep-install-pinned-${linker}`, {});
    const root = String(dir);
    await using server = serveStatic(root);
    const { bare, project, cache } = await installedFromBranch(root, server.port!, "main");

    await moveBranch(bare, "main", "main-v2");
    dropCheckouts(project, cache);

    const lockfile = await Bun.file(join(project, "bun.lock")).text();
    const { stderr, exitCode } = await runInstall(project, cache, {}, `--linker=${linker}`);
    expect(stderr).not.toContain("error:");
    expect(await installedVersionOf(project, "dep")).toBe("main");
    expect(await Bun.file(join(project, "bun.lock")).text()).toBe(lockfile);
    expect(exitCode).toBe(0);
  });
}

// `refs/heads/release/1.0` cannot exist beside the clone's stale `refs/heads/release`:
// without `--prune` every later fetch of the repository fails.
test.concurrent("bun install survives an upstream branch renamed into a nested name", async () => {
  using dir = tempDir("git-dep-renamed-branch", {});
  const root = String(dir);
  await using server = serveStatic(root);
  const { bare, project, cache } = await installedFromBranch(root, server.port!, "release");

  await git(bare, "branch", "-m", "release", "release/1.0");
  await git(bare, "update-server-info");
  dropCheckouts(project, cache);

  const { stderr, exitCode } = await runInstall(project, cache, {});
  expect(stderr).not.toContain("error:");
  expect(await installedVersionOf(project, "dep")).toBe("release");
  expect(exitCode).toBe(0);
});

// issues #11548, #18947. The tagged commit is on no branch, so following the tags
// of fetched branches cannot be what makes it visible.
test.concurrent("bun install resolves a tag pushed after the repository was cached", async () => {
  using dir = tempDir("git-dep-new-tag", {});
  const root = String(dir);
  await using server = serveStatic(root);
  const { bare, project, cache, repoUrl } = await installedFromBranch(root, server.port!, "main");

  await commitTo(bare, [
    { ref: "refs/tags/v2", from: "refs/heads/main", message: "v2", files: { "index.js": indexJs("main-v2") } },
  ]);
  writeProject(root, { dep: `${repoUrl}#v2` });

  const { stderr, exitCode } = await runInstall(project, cache, {});
  expect(stderr).not.toContain("error:");
  expect(await installedVersionOf(project, "dep")).toBe("main-v2");
  expect(exitCode).toBe(0);
});

// issue #15336
test.concurrent("bun install resolves a branch created after the repository was cached", async () => {
  using dir = tempDir("git-dep-new-branch", {});
  const root = String(dir);
  await using server = serveStatic(root);
  const { bare, project, cache, repoUrl } = await installedFromBranch(root, server.port!, "main");

  await commitTo(bare, [
    {
      ref: "refs/heads/release/2.0",
      from: "refs/heads/main",
      message: "release-2.0",
      files: { "index.js": indexJs("release-2.0") },
    },
  ]);
  writeProject(root, { dep: `${repoUrl}#release/2.0` });

  const { stderr, exitCode } = await runInstall(project, cache, {});
  expect(stderr).not.toContain("error:");
  expect(await installedVersionOf(project, "dep")).toBe("release-2.0");
  expect(exitCode).toBe(0);
});

// Only a forcing refspec lets a tag that was moved upstream land in the clone.
test.concurrent("bun update follows a tag that was moved upstream", async () => {
  using dir = tempDir("git-dep-moved-tag", {});
  const root = String(dir);
  await using server = serveStatic(root);
  const { bare, project, cache } = await installedFromBranch(root, server.port!, "main", { tag: "v1" });

  // It has no parent, so it isn't a fast-forward of the old tag.
  await commitTo(bare, [{ ref: "refs/tags/v1-moved", message: "v1", files: packageFiles("dep", "main-v2") }]);
  await git(bare, "tag", "-f", "v1", "v1-moved");
  await git(bare, "update-server-info");

  const { stderr, exitCode } = await runBun(project, cache, {}, "update");
  expect(stderr).not.toContain("error:");
  expect(await installedVersionOf(project, "dep")).toBe("main-v2");
  expect(exitCode).toBe(0);
});

// HEAD of the clone names the branch that was the default when it was made, and no
// fetch moves it. A dependency without a committish, or with `#HEAD`, means the remote's
// HEAD of today.
test.concurrent.each([
  { what: "renames its default branch", branch: ["-m", "master", "main"], ref: "" },
  { what: "renames its default branch", branch: ["-m", "master", "main"], ref: "#HEAD" },
  { what: "makes a new branch the default and keeps the old one", branch: ["main", "master"], ref: "" },
  { what: "makes a new branch the default and keeps the old one", branch: ["main", "master"], ref: "#HEAD" },
])("a cached repository follows an upstream that $what (ref: '$ref')", async ({ branch, ref }) => {
  using dir = tempDir("git-dep-default-branch", {});
  const root = String(dir);
  await using server = serveStatic(root);
  const { bare, cache, repoUrl } = await installedFromBranch(root, server.port!, "master", {
    committish: ref.slice(1),
  });

  await git(bare, "branch", ...branch);
  await git(bare, "symbolic-ref", "HEAD", "refs/heads/main");
  await moveBranch(bare, "main", "main-v2");

  const project = writeProject(join(root, "second"), { dep: repoUrl + ref });
  const { stderr, exitCode } = await runInstall(project, cache, {});
  expect(stderr).not.toContain("error:");
  expect(await installedVersionOf(project, "dep")).toBe("main-v2");
  expect(exitCode).toBe(0);
});

// Every branch and tag of `repo`, with its commit.
async function refsOf(repo: string) {
  await using proc = Bun.spawn({ cmd: ["git", "for-each-ref"], cwd: repo, env: gitEnv, stdout: "pipe" });
  return (await proc.stdout.text()).split("\n").filter(Boolean);
}

// The one bare clone that `cache` holds.
function bareCloneIn(cache: string) {
  const [clone] = readdirSync(cache).filter(entry => entry.endsWith(".git"));
  return join(cache, clone);
}

// Leaves `folder` the way a tool that doesn't copy empty folders would: aws s3 sync, rclone, zip -D, many CI cache
// plugins.
function dropEmptyFolders(folder: string) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(folder, entry.name);
    dropEmptyFolders(path);
    if (readdirSync(path).length === 0) rmSync(path, { recursive: true });
  }
}

// A fresh bare clone has its refs in `packed-refs`, so `refs` holds only empty folders,
// and without `refs` git does not take the folder for a repository. Started in it with
// `-C`, git went on to look above it. With the cache inside the project's work tree (a CI
// cache folder, `node_modules/.bun-cache`, a $HOME under git) it found the project's own
// repository, where the forced, pruning fetch deleted every branch and tag that was not
// pushed and reset the others.
test.concurrent.each([
  { command: "update", hook: false, broken: true },
  { command: "install --frozen-lockfile", hook: false, broken: true },
  { command: "install --frozen-lockfile", hook: true, broken: true },
  { command: "update", hook: true, broken: false },
])(
  "bun $command leaves the project's own repository alone (in a git hook: $hook, cached repository without refs: $broken)",
  async ({ command, hook, broken }) => {
    using dir = tempDir("git-dep-cache-in-work-tree", {});
    const root = String(dir);
    const bare = await makeSharedRepo(root, [{ name: "dep", branch: "main" }]);
    await git(bare, "symbolic-ref", "HEAD", "refs/heads/main");
    const project = writeProject(root, { dep: `git+${pathToFileURL(bare)}` });
    const cache = join(project, ".bun-cache");

    // A clone of origin.git. `feature`, which is checked out, and the tag were never
    // pushed, and `main` is ahead of origin's.
    await git(project, "init", "-q", "-b", "main");
    await git(project, "commit", "-q", "--allow-empty", "-m", "pushed");
    await git(root, "clone", "-q", "--bare", project, "origin.git");
    await git(project, "remote", "add", "origin", join(root, "origin.git"));
    await git(project, "checkout", "-q", "-b", "feature");
    await git(project, "commit", "-q", "--allow-empty", "-m", "not pushed");
    await git(project, "tag", "local-tag");
    await git(project, "branch", "-f", "main", "feature");
    const refs = await refsOf(project);
    expect(refs.map(ref => ref.split("\t")[1])).toEqual([
      "refs/heads/feature",
      "refs/heads/main",
      "refs/tags/local-tag",
    ]);

    expect((await runInstall(project, cache, {})).exitCode).toBe(0);
    dropCheckouts(project, cache);
    const clone = bareCloneIn(cache);
    if (broken) dropEmptyFolders(clone);
    expect(existsSync(join(clone, "refs"))).toBe(!broken);

    // git exports these to the hooks it runs
    const env = hook ? { GIT_DIR: join(project, ".git"), GIT_INDEX_FILE: join(project, ".git", "index") } : {};
    const { stderr, exitCode } = await runBun(project, cache, env, ...command.split(" "));
    expect(await refsOf(project)).toEqual(refs);
    expect(diagnostics(stderr)).toEqual([]);
    expect(await installedVersionOf(project, "dep")).toBe("main");
    // A broken one was cloned again.
    expect(await refsOf(clone)).toContain(`${branchCommits(bare).main} commit\trefs/heads/main`);
    expect(exitCode).toBe(0);
  },
);

// The refresh writes the refs of a repository that every install on the machine shares. If two run at once, the second
// one to write a ref finds that it has moved, and its `git fetch` exits with 1, even though everything it needed is
// there by then.
test.concurrent("installs that refresh one cached repository at the same time all succeed", async () => {
  using dir = tempDir("git-dep-refresh-race", {});
  const root = String(dir);
  const bare = await makeSharedRepo(root, [{ name: "dep", branch: "main" }]);
  await git(bare, "symbolic-ref", "HEAD", "refs/heads/main");
  const dependencies = { dep: `git+${pathToFileURL(bare)}` };
  const cache = join(root, "cache");
  expect((await runInstall(writeProject(join(root, "first"), dependencies), cache, {})).exitCode).toBe(0);

  await moveBranch(bare, "main", "main-v2");

  const installs = [0, 1, 2, 3].map(async i => {
    const project = writeProject(join(root, `${i}`), dependencies);
    return { project, ...(await runInstall(project, cache, {})) };
  });
  for (const { project, stderr, exitCode } of await Promise.all(installs)) {
    expect(diagnostics(stderr)).toEqual([]);
    expect(await installedVersionOf(project, "dep")).toBe("main-v2");
    expect(exitCode).toBe(0);
  }
});

// The same without relying on timing: while the first `git fetch` runs, another git holds the lock on the branch.
test.concurrent.skipIf(isWindows)("runs git fetch once more when it could not write a ref", async () => {
  using dir = tempDir("git-dep-refresh-locked", {});
  const root = String(dir);
  const bare = await makeSharedRepo(root, [{ name: "dep", branch: "main" }]);
  await git(bare, "symbolic-ref", "HEAD", "refs/heads/main");
  const project = writeProject(root, { dep: `git+${pathToFileURL(bare)}` });
  const cache = join(root, "cache");
  expect((await runInstall(project, cache, {})).exitCode).toBe(0);

  await moveBranch(bare, "main", "main-v2");

  const lock = join(bareCloneIn(cache), "refs", "heads", "main.lock");
  const fetches = join(root, "fetches");
  const realGit = quote(Bun.which("git", { PATH: gitEnv.PATH })!);
  mkdirSync(join(root, "bin"));
  writeFileSync(
    join(root, "bin", "git"),
    `#!/bin/sh
case " $* " in
  *" fetch "*)
    if [ ! -e ${quote(fetches)} ]; then
      : > ${quote(lock)}
      ${realGit} "$@"
      code=$?
      rm ${quote(lock)}
      echo $code >> ${quote(fetches)}
      exit $code
    fi
    echo again >> ${quote(fetches)} ;;
esac
exec ${realGit} "$@"
`,
    { mode: 0o755 },
  );

  const { stderr, exitCode } = await runBun(project, cache, { PATH: `${join(root, "bin")}:${gitEnv.PATH}` }, "update");
  expect(stderr).not.toContain("main.lock");
  expect(diagnostics(stderr)).toEqual([]);
  expect(readFileSync(fetches, "utf8")).toBe("1\nagain\n");
  expect(await installedVersionOf(project, "dep")).toBe("main-v2");
  expect(exitCode).toBe(0);
});

// A git that does not know the format yet ignores the setting.
test.concurrent.each([
  { where: "a variable", env: { GIT_DEFAULT_REF_FORMAT: "reftable" } },
  {
    where: "a setting",
    env: { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "init.defaultRefFormat", GIT_CONFIG_VALUE_0: "reftable" },
  },
])("the user's own format for refs, from $where", async ({ env }) => {
  using dir = tempDir("git-dep-ref-format", {});
  const root = String(dir);
  const bare = await makeSharedRepo(root, [{ name: "dep", branch: "main" }]);
  await git(bare, "symbolic-ref", "HEAD", "refs/heads/main");
  const project = writeProject(root, { dep: `git+${pathToFileURL(bare)}` });

  for (const [command, version] of [
    ["install", "main"],
    ["update", "main-v2"],
  ]) {
    const { stderr, exitCode } = await runBun(project, join(root, "cache"), env, command);
    expect(diagnostics(stderr)).toEqual([]);
    expect(await installedVersionOf(project, "dep")).toBe(version);
    expect(exitCode).toBe(0);
    await moveBranch(bare, "main", "main-v2");
  }
});

test.concurrent.each(["files", "reftable"])(
  "a clone that an older version left in the cache is not cloned again (%s)",
  async format => {
    using dir = tempDir("git-dep-older-clone", {});
    const root = String(dir);
    const bare = await makeSharedRepo(root, [{ name: "dep", branch: "main" }]);
    await git(bare, "symbolic-ref", "HEAD", "refs/heads/main");
    const project = writeProject(root, { dep: `git+${pathToFileURL(bare)}` });
    const cache = join(root, "cache");
    expect((await runInstall(project, cache, {})).exitCode).toBe(0);

    const clone = bareCloneIn(cache);
    rmSync(clone, { recursive: true });
    const options = ["-q", "--bare", "-c", "core.longpaths=true"];
    await git(cache, "-c", `init.defaultRefFormat=${format}`, "clone", ...options, pathToFileURL(bare).href, clone);
    writeFileSync(join(clone, "still-the-same-folder"), "");

    for (const [command, version] of [
      ["install --offline", "main"],
      ["update", "main-v2"],
    ]) {
      dropCheckouts(project, cache);
      rmSync(join(project, "bun.lock"));
      const { stderr, exitCode } = await runBun(project, cache, {}, ...command.split(" "));
      expect(diagnostics(stderr)).toEqual([]);
      expect(await installedVersionOf(project, "dep")).toBe(version);
      expect(existsSync(join(clone, "still-the-same-folder"))).toBe(true);
      expect(exitCode).toBe(0);
      await moveBranch(bare, "main", "main-v2");
    }
  },
);

test.concurrent("a commit is installed under the hash that identifies it", async () => {
  using dir = tempDir("git-dep-named-by-hash", {});
  const root = String(dir);
  const bare = await makeSharedRepo(root, [{ name: "dep", branch: "main" }]);
  const project = writeProject(root, { dep: `git+${pathToFileURL(bare)}#main` });
  const cache = join(root, "cache");
  expect((await runInstall(project, cache, {})).exitCode).toBe(0);

  const clone = bareCloneIn(cache);
  const other = await gitOutput(clone, ["hash-object", "-w", "--stdin"], indexJs("other"));
  await git(clone, "update-ref", `refs/replace/${await gitOutput(clone, ["rev-parse", "main:index.js"])}`, other);
  dropCheckouts(project, cache);

  const { stderr, exitCode } = await runInstall(project, cache, {});
  expect(diagnostics(stderr)).toEqual([]);
  expect(await installedVersionOf(project, "dep")).toBe("main");
  expect(exitCode).toBe(0);
});

test.concurrent("a git dependency with a submodule, under the user's own settings for submodules", async () => {
  using dir = tempDir("git-dep-submodule-settings", { gitconfig: "[submodule]\n\trecurse = true\n\tactive = .\n" });
  const root = String(dir);
  const bare = await makeSharedRepo(root, [{ name: "dep", branch: "main" }]);
  const commit = branchCommits(bare).main;
  await run(
    bare,
    ["git", "fast-import", "--quiet"],
    "git fast-import",
    `commit refs/heads/main\ncommitter Test <test@example.com> 0 +0000\n${fastImportData("submodule")}from ${commit}\n` +
      `M 100644 inline .gitmodules\n${fastImportData('[submodule "vendored"]\n\tpath = vendored\n\turl = ./vendored.git\n')}` +
      `M 160000 ${commit} vendored\n\n`,
  );
  await git(bare, "update-server-info");
  const project = writeProject(root, { dep: `git+${pathToFileURL(bare)}#main` });

  const env = { GIT_CONFIG_GLOBAL: join(root, "gitconfig") };
  const { stderr, exitCode } = await runInstall(project, join(root, "cache"), env);
  expect(diagnostics(stderr)).toEqual([]);
  // Checked in the cache, because not every install backend creates empty folders.
  expect(treeOf(join(root, "cache", `@G@${branchCommits(bare).main}`))).toEqual(
    [".bun-tag", ".gitmodules", "index.js", "package.json", "vendored"].sort(),
  );
  expect(await installedVersionOf(project, "dep")).toBe("main");
  expect(exitCode).toBe(0);
});

// How git fails when it can't use the clone depends on its version.
test.concurrent.skipIf(isWindows)("clones again after a git fetch that did not fail at the remote", async () => {
  using dir = tempDir("git-dep-fetch-exit-code", {});
  const root = String(dir);
  const bare = await makeSharedRepo(root, [{ name: "dep", branch: "main" }]);
  await git(bare, "symbolic-ref", "HEAD", "refs/heads/main");
  const project = writeProject(root, { dep: `git+${pathToFileURL(bare)}` });
  const cache = join(root, "cache");
  expect((await runInstall(project, cache, {})).exitCode).toBe(0);
  await moveBranch(bare, "main", "main-v2");

  mkdirSync(join(root, "bin"));
  writeFileSync(
    join(root, "bin", "git"),
    `#!/bin/sh
case " $* " in *" fetch "*) echo 'error: the refs cannot be written' >&2; exit 254 ;; esac
exec ${quote(Bun.which("git", { PATH: gitEnv.PATH })!)} "$@"
`,
    { mode: 0o755 },
  );
  const { stderr, exitCode } = await runBun(project, cache, { PATH: `${join(root, "bin")}:${gitEnv.PATH}` }, "update");
  expect(diagnostics(stderr)).toEqual([]);
  expect(await installedVersionOf(project, "dep")).toBe("main-v2");
  expect(exitCode).toBe(0);
});

// Creates `levels` nested folders below `folder`. It works in parts, and each part moves what exists so far into
// itself, so that no call needs a long path.
function nestFolders(folder: string, levels: number) {
  const part = new Array(299).fill("d");
  for (let made = 0; made < levels; made += part.length + 1) {
    mkdirSync(join(folder, "next", ...part), { recursive: true });
    if (made > 0) renameSync(join(folder, "d"), join(folder, "next", ...part, "d"));
    renameSync(join(folder, "next"), join(folder, "d"));
  }
}

// git only reads the refs and objects of a cached clone from its folder. A folder that git can't use, or that points
// somewhere else, is replaced by a new clone.
type Places = { clone: string; other: string; kept: string; command: string };
// since git 2.45
const usageOfInit = Bun.spawnSync({ cmd: ["git", "init", "-h"], env: gitEnv });
const gitKnowsReftable = `${usageOfInit.stdout}${usageOfInit.stderr}`.includes("--ref-format");
test.concurrent.skipIf(isWindows).each<{ what: string; change(at: Places): void }>([
  {
    what: "is a link",
    change({ clone, other }) {
      rmSync(clone, { recursive: true });
      symlinkSync(join(other, ".git"), clone);
    },
  },
  {
    what: "has more settings",
    change: ({ clone, command }) =>
      writeFileSync(join(clone, "config"), `[remote "origin"]\n\tuploadpack = "${command}; git-upload-pack"\n`, {
        flag: "a",
      }),
  },
  {
    what: "has a hook",
    change({ clone, command }) {
      mkdirSync(join(clone, "hooks"), { recursive: true });
      writeFileSync(join(clone, "hooks", "reference-transaction"), `#!/bin/sh\n${command}\n`, { mode: 0o755 });
    },
  },
  {
    what: "names another folder",
    change: ({ clone, other }) => writeFileSync(join(clone, "commondir"), join(other, ".git")),
  },
  {
    what: "holds a link to a folder",
    change({ clone, other }) {
      rmSync(join(clone, "refs", "heads"), { recursive: true });
      symlinkSync(join(other, ".git", "refs", "heads"), join(clone, "refs", "heads"));
    },
  },
  {
    what: "holds a link to a file",
    change({ clone, kept }) {
      rmSync(join(clone, "FETCH_HEAD"), { force: true });
      symlinkSync(kept, join(clone, "FETCH_HEAD"));
    },
  },
  {
    what: "has another hook",
    change({ clone, command }) {
      mkdirSync(join(clone, "hooks"), { recursive: true });
      writeFileSync(join(clone, "hooks", "post-checkout"), `#!/bin/sh\n${command}\n`, { mode: 0o755 });
    },
  },
  {
    what: "has settings for the files",
    change({ clone, command }) {
      writeFileSync(join(clone, "config"), `[filter "all"]\n\tsmudge = "${command}; cat"\n`, { flag: "a" });
      mkdirSync(join(clone, "info"), { recursive: true });
      writeFileSync(join(clone, "info", "attributes"), "* filter=all\n");
    },
  },
  // This is what a full disk, a power cut or a killed git can leave behind.
  { what: "has an empty HEAD", change: ({ clone }) => writeFileSync(join(clone, "HEAD"), "") },
  { what: "has refs that git cannot read", change: ({ clone }) => writeFileSync(join(clone, "packed-refs"), "?\n") },
  {
    what: "has a lock that nobody holds",
    change: ({ clone }) => writeFileSync(join(clone, "refs", "heads", "main.lock"), ""),
  },
  // An older git doesn't get as far as the refs, because it doesn't know the setting.
  ...(gitKnowsReftable
    ? [
        {
          what: "says that its refs are stored in another way",
          change: ({ clone }: Places) =>
            writeFileSync(
              join(clone, "config"),
              "[core]\n\trepositoryformatversion = 1\n\tbare = true\n[extensions]\n\trefstorage = reftable\n",
            ),
        },
      ]
    : []),
  // A path has room for about 500 levels on macOS, and 2,000 on Linux.
  { what: "holds folders nested deep", change: ({ clone }) => nestFolders(clone, 1500) },
  // On macOS the row above is already this case.
  ...(isLinux
    ? [
        {
          what: "holds folders nested deeper than a path can name",
          change: ({ clone }: Places) => nestFolders(clone, 3000),
        },
      ]
    : []),
])(
  "a cached clone that $what",
  async ({ change }) => {
    using dir = tempDir("git-dep-clone-as-left", { kept: "kept\n", other: {} });
    const root = String(dir);
    const bare = await makeSharedRepo(root, [{ name: "dep", branch: "main" }]);
    await git(bare, "symbolic-ref", "HEAD", "refs/heads/main");
    const project = writeProject(root, { dep: `git+${pathToFileURL(bare)}` });
    const cache = join(root, "cache");
    expect((await runInstall(project, cache, {})).exitCode).toBe(0);

    // another checkout, with work that was never pushed
    const other = join(root, "other");
    await git(other, "init", "-q", "-b", "main");
    await git(other, "commit", "-q", "--allow-empty", "-m", "pushed");
    await git(root, "clone", "-q", "--bare", other, "other-origin.git");
    await git(other, "remote", "add", "origin", join(root, "other-origin.git"));
    await git(other, "checkout", "-q", "-b", "feature");
    await git(other, "commit", "-q", "--allow-empty", "-m", "not pushed");
    await git(other, "tag", "local-tag");
    const refs = await refsOf(other);

    const [clone, ran, kept] = [bareCloneIn(cache), join(root, "ran"), join(root, "kept")];
    change({ clone, other, kept, command: `: > ${quote(ran)}` });
    await moveBranch(bare, "main", "main-v2");

    const { stderr, exitCode } = await runBun(project, cache, {}, "update", "--ignore-scripts");
    expect({ ran: existsSync(ran), refs: await refsOf(other), kept: readFileSync(kept, "utf8") }).toEqual({
      ran: false,
      refs,
      kept: "kept\n",
    });
    expect(diagnostics(stderr)).toEqual([]);
    expect(lstatSync(clone).isDirectory()).toBe(true);
    expect(await installedVersionOf(project, "dep")).toBe("main-v2");
    expect(exitCode).toBe(0);
  },
  30_000,
);

// Only a file of the repository itself is read as its package.json.
test.concurrent.each([
  { what: "a text file", target: "notes.txt" },
  { what: "another package.json", target: "other/package.json" },
])("a git dependency whose package.json is a link to $what has no package.json", async ({ target }) => {
  using dir = tempDir("git-dep-package-json-kind", {
    "notes.txt": "the first line of the notes\n",
    "other/package.json": JSON.stringify({
      name: "other",
      version: "1.0.0",
      dependencies: { "only-for-other": "1.0.0" },
    }),
  });
  const root = String(dir);
  const requests: string[] = [];
  await using registry = Bun.serve({
    port: 0,
    fetch(req) {
      requests.push(new URL(req.url).pathname);
      return new Response("not found", { status: 404 });
    },
  });
  const bare = join(root, "repo.git");
  await git(root, "init", "-q", "--bare", "repo.git");
  await commitTo(bare, [
    {
      ref: "refs/heads/main",
      message: "main",
      files: { "index.js": indexJs("main") },
      links: { "package.json": join(root, target) },
    },
  ]);
  const project = writeProject(root, { dep: `git+${pathToFileURL(bare)}#main` });
  const cache = join(root, "cache");
  const install = async () => {
    const { stdout, stderr, exitCode } = await runInstall(project, cache, { BUN_CONFIG_REGISTRY: registry.url.href });
    expect(diagnostics(stderr)).toEqual([]);
    expect(stdout + stderr).not.toContain("the first line of the notes");
    expect(stdout + stderr).not.toContain(join(root, target));
    expect(requests).toEqual([]);
    expect(treeOf(realpathSync(join(project, "node_modules", "dep")))).toEqual([".bun-tag", "index.js"]);
    expect(exitCode).toBe(0);
  };
  await install();

  // A checkout that an older version left in the cache is created again.
  if (isWindows) return;
  const checkout = join(cache, `@G@${branchCommits(bare).main}`);
  symlinkSync(join(root, target), join(checkout, "package.json"));
  rmSync(join(project, "node_modules"), { recursive: true });
  rmSync(join(project, "bun.lock"));
  await install();
  expect(treeOf(checkout)).toEqual([".bun-tag", "index.js"]);
});

test.concurrent("a package.json that is a link to a file of the repository is a copy of that file", async () => {
  using dir = tempDir("git-dep-package-json-inside", {});
  const root = String(dir);
  const bare = await makeSharedRepo(root, [{ name: "leaf", branch: "leaf" }]);
  const url = `git+${pathToFileURL(bare)}`;
  const manifest = JSON.stringify({ name: "dep", version: "1.2.3", dependencies: { leaf: `${url}#leaf` } });
  await commitTo(bare, [
    {
      ref: "refs/heads/main",
      message: "main",
      files: { "index.js": indexJs("main"), "real/manifest.json": manifest },
      links: { "package.json": "real/manifest.json" },
    },
  ]);
  const project = writeProject(root, { dep: `${url}#main` });
  const cached = join(root, "cache", `@G@${branchCommits(bare).main}`, "package.json");
  const install = async () => {
    const { stderr, exitCode } = await runInstall(project, join(root, "cache"), {});
    expect(diagnostics(stderr)).toEqual([]);
    expect(lstatSync(cached).isFile()).toBe(true);
    expect(readFileSync(join(project, "node_modules", "dep", "package.json"), "utf8")).toBe(manifest);
    expect(await installedVersions(project, ["dep", "leaf"])).toEqual({ dep: "main", leaf: "leaf" });
    expect((await lockedPackages(project)).dep[1]).toEqual({ version: "1.2.3", dependencies: { leaf: `${url}#leaf` } });
    expect(exitCode).toBe(0);
  };
  await install();

  // A checkout that an older version left in the cache is created again.
  if (isWindows) return;
  rmSync(cached);
  symlinkSync("real/manifest.json", cached);
  rmSync(join(project, "node_modules"), { recursive: true });
  rmSync(join(project, "bun.lock"));
  await install();
});

// A link to a file of the repository is installed as a copy of that file. No other link is installed.
for (const linker of ["hoisted", "isolated"] as const) {
  test.concurrent(`a git dependency is installed without the links of its repository (${linker} linker)`, async () => {
    using dir = tempDir("git-dep-links", { "outside.txt": "outside\n" });
    const root = String(dir);
    const copies = {
      "to-a-file.js": "index.js",
      "to-a-link.js": "to-a-file.js",
      "lib/from-a-folder.js": "../index.js",
      "through-a-link.js": "to-a-folder/../index.js",
      "lib/through-two-links.js": "to-the-parent/to-a-folder/to-the-parent/index.js",
      // plain characters of a name, where the file system takes them
      ...(isWindows ? {} : { "\\a": "index.js", "C:\\b": "index.js", "c\\..\\d": "index.js", "e:/f": "../index.js" }),
    };
    const bare = await makeSharedRepo(root, [
      {
        name: "dep",
        branch: "main",
        files: { "lib/real.js": indexJs("real"), ".bun-tag": "committed" },
        links: {
          ...copies,
          "to-a-folder": "lib",
          "lib/to-the-parent": "..",
          "to-the-outside.txt": join(root, "outside.txt"),
          "above.txt": "../outside.txt",
          "above-through-a-link.txt": "lib/to-the-parent/../outside.txt",
          "to-nothing": "nowhere",
          "to-the-tag": ".bun-tag",
          "round-a": "round-b",
          "round-b": "round-a",
          "round-c": "round-c/index.js",
        },
      },
    ]);
    const project = writeProject(root, { dep: `git+${pathToFileURL(bare)}#main` });
    const cache = join(root, "cache");

    const { stderr, exitCode } = await runInstall(project, cache, {}, `--linker=${linker}`);
    expect(diagnostics(stderr)).toEqual([]);
    const folders = isWindows ? ["lib"] : ["lib", "e:"];
    const files = [".bun-tag", "index.js", "lib/real.js", "package.json", ...folders, ...Object.keys(copies)].sort();
    const checkout = join(cache, `@G@${branchCommits(bare).main}`);
    for (const folder of [checkout, realpathSync(join(project, "node_modules", "dep"))]) {
      expect(treeOf(folder)).toEqual(files);
      expect(Object.keys(copies).map(copy => readFileSync(join(folder, copy), "utf8"))).toEqual(
        Object.keys(copies).map(() => indexJs("main")),
      );
    }
    // It's a separate file, so editing one doesn't edit the other.
    expect(lstatSync(join(checkout, "to-a-file.js")).ino).not.toBe(lstatSync(join(checkout, "index.js")).ino);
    // nothing that git or the install needed on the way is left beside the bare clone and the checkout
    expect(readdirSync(cache).filter(entry => !entry.endsWith(".git") && !entry.startsWith("@G@"))).toEqual([]);
    expect(exitCode).toBe(0);
  });
}

async function gitOutput(cwd: string, args: string[], stdin = "") {
  await using proc = Bun.spawn({ cmd: ["git", ...args], cwd, env: gitEnv, stdin: Buffer.from(stdin), stdout: "pipe" });
  return (await proc.stdout.text()).trim();
}

test.concurrent("a path that git doesn't write is skipped", async () => {
  using dir = tempDir("git-dep-unwritable-path", { "cache/beside": "kept\n" });
  const root = String(dir);
  const bare = await makeSharedRepo(root, [{ name: "dep", branch: "main" }]);
  const blob = await gitOutput(bare, ["hash-object", "-w", "--stdin"], "index.js");
  const folder = await gitOutput(bare, ["mktree"], `120000 blob ${blob}\tbeside\n`);
  const entries = await gitOutput(bare, ["ls-tree", "main"]);
  const tree = await gitOutput(bare, ["mktree"], `${entries}\n040000 tree ${folder}\t..\n`);
  await git(bare, "update-ref", "refs/heads/main", await gitOutput(bare, ["commit-tree", tree, "-m", "main"]));
  const project = writeProject(root, { dep: `git+${pathToFileURL(bare)}#main` });

  const { stderr, exitCode } = await runInstall(project, join(root, "cache"), {});
  expect(readFileSync(join(root, "cache", "beside"), "utf8")).toBe("kept\n");
  expect(diagnostics(stderr)).toEqual([]);
  expect(treeOf(join(project, "node_modules", "dep"))).toEqual([".bun-tag", "index.js", "package.json"]);
  expect(exitCode).toBe(0);
});

// Every link is followed once, however many lead to it.
test.concurrent(
  "a long chain of links costs no more than as many links to one file",
  async () => {
    using dir = tempDir("git-dep-link-chain", {});
    const root = String(dir);
    const count = 4000;
    const linksTo = (target: (link: number) => string) =>
      Object.fromEntries(Array.from({ length: count }, (_, link) => [`link-${link + 1}`, target(link)]));
    const bare = await makeSharedRepo(root, [
      { name: "dep", branch: "star", files: { "link-0": "end" }, links: linksTo(() => "link-0") },
      { name: "dep", branch: "chain", files: { "link-0": "end" }, links: linksTo(link => `link-${link}`) },
    ]);
    const cpuTime: Record<string, number> = {};
    for (const branch of ["star", "chain"]) {
      const project = writeProject(join(root, branch), { dep: `git+${pathToFileURL(bare)}#${branch}` });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: project,
        env: { ...gitEnv, BUN_INSTALL_CACHE_DIR: join(root, branch, "cache"), BUN_FEATURE_FLAG_NO_ORPHANS: undefined },
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(diagnostics(stderr)).toEqual([]);
      expect(readFileSync(join(project, "node_modules", "dep", `link-${count}`), "utf8")).toBe("end");
      expect(exitCode).toBe(0);
      cpuTime[branch] = Number(proc.resourceUsage()!.cpuTime.total);
    }
    expect(cpuTime.chain).toBeLessThan(3 * cpuTime.star);
  },
  30_000,
);

// For the other kinds of entry, Bun installs whatever git itself writes.
test.concurrent("a git dependency keeps its executable files and the folder of a submodule", async () => {
  using dir = tempDir("git-dep-entry-kinds", {});
  const root = String(dir);
  const bare = await makeSharedRepo(root, [{ name: "dep", branch: "main" }]);
  const commit = branchCommits(bare).main;
  await run(
    bare,
    ["git", "fast-import", "--quiet"],
    "git fast-import",
    `commit refs/heads/main\ncommitter Test <test@example.com> 0 +0000\n${fastImportData("kinds")}from ${commit}\n` +
      `M 100755 inline run.sh\n${fastImportData("#!/bin/sh\n")}M 160000 ${commit} vendored\n` +
      `M 120000 inline run-too.sh\n${fastImportData("run.sh")}M 120000 inline to-vendored\n${fastImportData("vendored")}\n`,
  );
  await git(bare, "update-server-info");
  const project = writeProject(root, { dep: `git+${pathToFileURL(bare)}#main` });

  const { stderr, exitCode } = await runInstall(project, join(root, "cache"), {});
  expect(diagnostics(stderr)).toEqual([]);
  const checkout = join(root, "cache", `@G@${branchCommits(bare).main}`);
  expect(treeOf(checkout)).toEqual([".bun-tag", "index.js", "package.json", "run-too.sh", "run.sh", "vendored"]);
  expect(lstatSync(join(checkout, "vendored")).isDirectory()).toBe(true);
  // The copy that replaces a symlink to it is executable too.
  for (const file of isWindows ? [] : ["run.sh", "run-too.sh"]) {
    expect(lstatSync(join(checkout, file)).mode).toBe(lstatSync(join(checkout, "run.sh")).mode | 0o111);
  }
  expect(exitCode).toBe(0);
});

test.concurrent.skipIf(isWindows)("reports the required git version when git has no `restore` command", async () => {
  const notACommand = "git: 'restore' is not a git command. See 'git --help'.";
  using dir = tempDir("git-dep-old-git", {
    "bin/git": `#!/bin/sh
case " $* " in *" restore "*) echo ${quote(notACommand)} >&2; exit 1 ;; esac
exec ${quote(Bun.which("git", { PATH: gitEnv.PATH })!)} "$@"
`,
  });
  const root = String(dir);
  chmodSync(join(root, "bin", "git"), 0o755);
  const bare = await makeSharedRepo(root, [{ name: "dep", branch: "main" }]);
  const project = writeProject(root, { dep: `git+${pathToFileURL(bare)}#main` });

  const env = { PATH: `${join(root, "bin")}:${gitEnv.PATH}` };
  const { stderr, exitCode } = await runInstall(project, join(root, "cache"), env);
  expect(stderr.split("\n")).toContain("note: git dependencies need git 2.24 or newer");
  expect(diagnostics(stderr)).toContain('error: "git restore" for "dep" failed');
  expect(exitCode).toBe(1);
});

test.concurrent("two commits of one repository in one install", async () => {
  using dir = tempDir("git-dep-two-commits", {});
  const root = String(dir);
  const bare = await makeSharedRepo(root, [{ name: "dep", branch: "main" }]);
  const first = branchCommits(bare).main;
  await moveBranch(bare, "main", "main-v2");
  const url = `git+${pathToFileURL(bare)}`;
  const project = writeProject(root, { first: `${url}#${first}`, second: `${url}#${branchCommits(bare).main}` });

  const { stderr, exitCode } = await runInstall(project, join(root, "cache"), {});
  expect(diagnostics(stderr)).toEqual([]);
  expect(await installedVersions(project, ["first", "second"])).toEqual({ first: "main", second: "main-v2" });
  expect(exitCode).toBe(0);
});

// The https form of an ssh URL is tried first. A host answers "not found" for a private
// repository to a login without access, so that answer does not end the search. What git
// said of a form that failed is of interest only if no form works.
test.concurrent.skipIf(isWindows).each([
  { status: 404, body: "Repository not found.", sshWorks: true },
  { status: 403, body: "Forbidden", sshWorks: true },
  { status: 404, body: "Repository not found.", sshWorks: false },
])(
  "clones an ssh URL over ssh after https answered $status $body (ssh works: $sshWorks)",
  async ({ status, body, sshWorks }) => {
    using dir = tempDir("git-dep-https-then-ssh", {});
    const root = String(dir);
    const bare = await makeSharedRepo(root, [{ name: "dep", branch: "main" }]);
    await git(bare, "symbolic-ref", "HEAD", "refs/heads/main");
    let requests = 0;
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch() {
        requests++;
        return new Response(`${body}\n`, { status, headers: { "content-type": "text/plain" } });
      },
    });
    writeFileSync(
      join(root, "gitconfig"),
      `[url "http://127.0.0.1:${server.port}/"]\n\tinsteadOf = https://git@example.com/\n`,
    );
    const serve = sshWorks
      ? `exec git upload-pack ${quote(bare)}`
      : "echo 'Permission denied (publickey).' >&2; exit 255";
    writeFileSync(join(root, "ssh.sh"), `#!/bin/sh\ncase "$*" in *git-upload-pack*) ${serve} ;; esac\n`, {
      mode: 0o755,
    });
    const project = writeProject(root, { dep: "git+ssh://git@example.com/org/private.git" });

    const env = {
      GIT_CONFIG_GLOBAL: join(root, "gitconfig"),
      GIT_SSH_COMMAND: join(root, "ssh.sh"),
      GIT_TERMINAL_PROMPT: "0",
    };
    const { stderr, exitCode } = await runInstall(project, join(root, "cache"), env);
    if (sshWorks) {
      expect(stderr).not.toContain(body);
      expect(stderr).not.toContain("git clone");
      expect(diagnostics(stderr)).toEqual([]);
      expect(await installedVersionOf(project, "dep")).toBe("main");
      expect(exitCode).toBe(0);

      // the form that worked is the first one that the cached clone is refreshed from
      const requestsOfTheClone = requests;
      await moveBranch(bare, "main", "main-v2");
      const update = await runBun(project, join(root, "cache"), env, "update");
      expect(diagnostics(update.stderr)).toEqual([]);
      expect(await installedVersionOf(project, "dep")).toBe("main-v2");
      expect(requests).toBe(requestsOfTheClone);
      expect(update.exitCode).toBe(0);
      return;
    }
    expect(stderr).toMatch(
      /^git clone https:\S+example\.com\/org\/private\.git\n(.*\n)*?remote: Repository not found\.\n(.*\n)*?git clone ssh:\S+example\.com\/org\/private\.git\nPermission denied \(publickey\)\.\n/m,
    );
    expect(diagnostics(stderr)).toEqual([
      gitFailed("error"),
      'error: "git clone" for "dep" failed',
      "error: InstallFailed cloning repository for dep",
      expect.stringContaining("failed to resolve"),
    ]);
    expect(exitCode).toBe(1);
  },
);

// git itself notes the arguments that it was started with.
test.concurrent("every git starts with the same settings, spelled for the platform", async () => {
  using dir = tempDir("git-dep-first-arguments", {});
  const root = String(dir);
  const bare = await makeSharedRepo(root, [{ name: "dep", branch: "main" }]);
  const project = writeProject(root, { dep: `git+${pathToFileURL(bare)}#main` });
  const trace = join(root, "trace");

  for (const command of ["install", "update"]) {
    const { stderr, exitCode } = await runBun(project, join(root, "cache"), { GIT_TRACE2_EVENT: trace }, command);
    expect(diagnostics(stderr)).toEqual([]);
    expect(exitCode).toBe(0);
  }
  const started: string[][] = readFileSync(trace, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line))
    // the id of a git that another git started holds the id of that one
    .filter(({ event, sid }) => event === "start" && !sid.includes("/"))
    .map(({ argv }) => argv.slice(1));
  const commandOf = (argv: string[]) => argv.find(arg => /^[a-z][a-z-]+$/.test(arg));
  expect([...new Set(started.map(commandOf))].sort()).toEqual([
    "clone",
    "config",
    "fetch",
    "log",
    "ls-tree",
    "restore",
  ]);
  expect([...new Set(started.map(argv => argv.slice(0, 4).join(" ")))]).toEqual([
    `-c core.hooksPath=${nullDevice} -c submodule.recurse=false`,
  ]);
  expect(started[0][4]).toBe(`--git-dir=${nullDevice}`);
});

test.concurrent.skipIf(isWindows)("asks git for the user's own commands once, before the first clone", async () => {
  using dir = tempDir("git-dep-config-once", { "bin/git": `#!/bin/sh\necho "$5 $6 $7" >> "$GIT_CALLS"\nexit 1\n` });
  const root = String(dir);
  chmodSync(join(root, "bin", "git"), 0o755);
  const calls = join(root, "git-calls");
  const env = { PATH: `${join(root, "bin")}:${gitEnv.PATH}`, GIT_CALLS: calls };

  // not at all without a git dependency
  expect((await runInstall(writeProject(join(root, "plain"), {}), join(root, "cache"), env)).exitCode).toBe(0);
  expect(existsSync(calls)).toBe(false);

  const names = ["a", "b", "c"];
  const project = writeProject(root, Object.fromEntries(names.map(name => [name, `git+http://localhost/${name}.git`])));
  const { exitCode } = await runInstall(project, join(root, "cache"), env);
  expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual([
    `--git-dir=${nullDevice} config --name-only`,
    ...names.map(() => "clone -c core.longpaths=true"),
  ]);
  expect(exitCode).toBe(1);
});

// Installs a dependency on `url` with two commands that only record that they ran: `<root>/mine`, and the `ssh` on
// PATH. `files` (relative to `<root>`; $HOME is `<root>/home`) and `env` configure the first one as the user's own ssh
// command. ROOT in them is replaced with `<root>`. Returns the calls with their arguments.
async function commandsThatGitRuns(url: string, files: Record<string, string>, env: Record<string, string> = {}) {
  using dir = tempDir("git-dep-own-command", { home: {} });
  const root = String(dir);
  const ran = join(root, "ran");
  const stub = (name: string) => `#!/bin/sh\necho ${name} "$@" >> ${quote(ran)}\nexit 1\n`;
  for (const [file, text] of Object.entries({ mine: stub("mine"), "bin/ssh": stub("ssh"), ...files })) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text.replaceAll("ROOT", root), { mode: 0o755 });
  }
  const { exitCode } = await runInstall(writeProject(root, { dep: url }), join(root, "cache"), {
    ...noGitTooling,
    GIT_ASKPASS: undefined,
    GIT_TERMINAL_PROMPT: "0",
    HOME: join(root, "home"),
    PATH: `${join(root, "bin")}:${gitEnv.PATH}`,
    ...Object.fromEntries(Object.entries(env).map(([name, value]) => [name, value.replaceAll("ROOT", root)])),
  });
  expect(exitCode).toBe(1);
  return existsSync(ran) ? readFileSync(ran, "utf8").trim().split("\n") : [];
}

const sshUrl = "git+ssh://git@127.0.0.1/org/repo.git";
// git refuses the https form, which is tried first, so nothing connects to port 443.
const onlySsh = { GIT_ALLOW_PROTOCOL: "ssh" };
const mySshCommand = "[core]\n\tsshCommand = ROOT/mine\n";
type Place = { where: string; files?: Record<string, string>; env?: Record<string, string> };

// `GIT_SSH_COMMAND`, which the install sets to accept the key of a new host, outranks every
// other way to name an ssh command. So it is set only if the user has named none.
test.concurrent.skipIf(isWindows).each<Place>([
  { where: "~/.gitconfig", files: { "home/.gitconfig": mySshCommand } },
  { where: "~/.gitconfig, under [Core]", files: { "home/.gitconfig": "[Core]\n\tsshCommand = ROOT/mine\n" } },
  { where: "~/.gitconfig, in one line", files: { "home/.gitconfig": "[core] sshCommand = ROOT/mine\n" } },
  { where: "~/.config/git/config", files: { "home/.config/git/config": mySshCommand } },
  {
    where: "a file that ~/.gitconfig includes",
    files: { "home/.gitconfig": "[include]\n\tpath = work.gitconfig\n", "home/work.gitconfig": mySshCommand },
  },
  { where: "$GIT_CONFIG_GLOBAL", files: { elsewhere: mySshCommand }, env: { GIT_CONFIG_GLOBAL: "ROOT/elsewhere" } },
  {
    where: "$GIT_CONFIG_COUNT",
    env: { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.sshCommand", GIT_CONFIG_VALUE_0: "ROOT/mine" },
  },
  { where: "$GIT_SSH", env: { GIT_SSH: "ROOT/mine" } },
])("git runs the user's own ssh command from $where", async ({ files = {}, env = {} }) => {
  const ran = await commandsThatGitRuns(sshUrl, files, { ...onlySsh, ...env });
  expect(ran).not.toEqual([]);
  expect(ran.filter(line => !line.startsWith("mine "))).toEqual([]);
});

// No clone reads the config of the repository it is started in.
test.concurrent.skipIf(isWindows).each<Place>([
  { where: "nowhere" },
  {
    where: "only in the repository of the project",
    files: {
      "project/.git/HEAD": "ref: refs/heads/main\n",
      "project/.git/config": mySshCommand,
      "project/.git/objects/keep": "",
      "project/.git/refs/keep": "",
    },
  },
])("git accepts the key of a new host when the user names an ssh command $where", async ({ files = {} }) => {
  const ran = await commandsThatGitRuns(sshUrl, files, onlySsh);
  expect(ran).not.toEqual([]);
  expect(ran.filter(line => !line.startsWith("ssh -oStrictHostKeyChecking=accept-new "))).toEqual([]);
});

test.concurrent.skipIf(isWindows)("git runs the user's own core.askPass from ~/.config/git/config", async () => {
  await using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response("", { status: 401, headers: { "www-authenticate": 'Basic realm="git"' } }),
  });
  const ran = await commandsThatGitRuns(`git+http://127.0.0.1:${server.port}/org/repo.git`, {
    "home/.config/git/config": "[core]\n\taskPass = ROOT/mine\n",
  });
  expect(ran[0]).toStartWith("mine Username for ");
});

// bun.lock writes an scp-style repository ("git@host:path") with "ssh://" in front, so the locked package and the
// dependency spell the same repository in two ways. A cold-cache install from the lockfile with the isolated linker
// cloned it under both spellings and never finished. The ssh replacement runs the command on this machine.
for (const user of ["git", "alice"]) {
  test
    .skipIf(isWindows)
    .concurrent(
      `a cold-cache install from bun.lock clones an scp-form dependency (${user}@host:path) once`,
      async () => {
        using dir = tempDir("git-dep-scp", {
          "ssh.sh": `#!/bin/sh
echo "$*" >> "$(dirname "$0")/ssh.log"
while [ $# -gt 1 ]; do
  case "$1" in
    -o|-p) shift 2 ;;
    -*) shift ;;
    *) break ;;
  esac
done
shift
exec sh -c "$1"
`,
        });
        const root = String(dir);
        chmodSync(join(root, "ssh.sh"), 0o755);
        const bare = await makeSharedRepo(root, [{ name: "dep", branch: "main" }]);
        await git(bare, "symbolic-ref", "HEAD", "refs/heads/main");
        const project = writeProject(root, { dep: `${user}@localhost:${bare}` });
        const env = { GIT_SSH_COMMAND: join(root, "ssh.sh"), GIT_TERMINAL_PROMPT: "0" };

        expect((await runInstall(project, join(root, "cache-1"), env, "--linker=isolated")).exitCode).toBe(0);
        const lockfile = readFileSync(join(project, "bun.lock"), "utf8");
        expect(lockfile).toContain(`"dep@git+ssh://${user}@localhost:`);

        rmSync(join(project, "node_modules"), { recursive: true });
        rmSync(join(root, "ssh.log"));
        const { exitCode } = await runInstall(project, join(root, "cache-2"), env, "--linker=isolated");
        expect(await installedVersionOf(project, "dep")).toBe("main");
        expect(
          readFileSync(join(root, "ssh.log"), "utf8")
            .split("\n")
            .filter(line => line.includes("git-upload-pack")),
        ).toHaveLength(1);
        expect(readFileSync(join(project, "bun.lock"), "utf8")).toBe(lockfile);
        expect(exitCode).toBe(0);
      },
    );
}
