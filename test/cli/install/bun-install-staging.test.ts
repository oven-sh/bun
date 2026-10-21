// Packages are linked out of the cache into a staging directory that is renamed
// onto the package's final path once complete. An install killed while linking
// must not leave a partial copy at the final path: both linkers treat an
// installed package.json as "this package is installed", so a truncated
// directory that already received its package.json would be reported as up to
// date by every later `bun install`. The rename must also cope with the final
// path being occupied already, which the hoisted linker does to itself.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, githubTarball, isLinux, isMusl, isWindows, tempDir } from "harness";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  watch,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

// Enough files that a kill lands long before linking finishes, even when the
// test process is slow to notice that linking has started.
const DIR_COUNT = 32;
const FILES_PER_DIR = 64;
const FILE_COUNT = DIR_COUNT * FILES_PER_DIR + 1;

// package.json is the middle member (Bun.Archive keeps insertion order). The
// cache entry is linked in directory order, oldest or newest first depending on
// the filesystem: either way half of the files are still to come once
// package.json is there, which is what an in-place link needs to leave an
// accepted partial copy.
const archiveEntries: Record<string, string> = {};
for (let dir = 0; dir < DIR_COUNT; dir++) {
  if (dir === DIR_COUNT / 2) {
    archiveEntries["package/package.json"] = JSON.stringify({ name: "many-files", version: "1.0.0" });
  }
  for (let file = 0; file < FILES_PER_DIR; file++) {
    archiveEntries[`package/d${dir}/f${file}.js`] = `module.exports = ${dir * FILES_PER_DIR + file};\n`;
  }
}

const expectedTree = new Set<string>();
for (const entry of Object.keys(archiveEntries)) {
  const relative = entry.slice("package/".length);
  const slash = relative.indexOf("/");
  if (slash !== -1) expectedTree.add(relative.slice(0, slash));
  expectedTree.add(relative);
}

// Summarized rather than compared entry by entry so a failure reads as a few
// lines instead of a diff of thousands of paths.
function compareWithExpectedTree(packageDir: string) {
  const actual = new Set((readdirSync(packageDir, { recursive: true }) as string[]).map(p => p.replaceAll("\\", "/")));
  const missing = [...expectedTree].filter(entry => !actual.has(entry));
  const unexpected = [...actual].filter(entry => !expectedTree.has(entry));
  return {
    entries: actual.size,
    missing: missing.length,
    firstMissing: missing.slice(0, 3),
    unexpected,
  };
}
const completeTree = { entries: expectedTree.size, missing: 0, firstMissing: [], unexpected: [] };

type RegistryPackage = {
  tgz: Uint8Array;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  bin?: string;
  // 1.0.0 unless it says otherwise.
  version?: string;
  // The tarball is not sent before this resolves.
  release?: Promise<void>;
};

// Every package is published in one version.
function serveRegistry(packages: Record<string, RegistryPackage>) {
  return Bun.serve({
    port: 0,
    async fetch(request) {
      const { origin, pathname } = new URL(request.url);
      const name = pathname.slice(1).replace(/-\d\.0\.0\.tgz$/, "");
      const pkg = packages[name];
      if (!pkg) return new Response("not found", { status: 404 });
      if (pathname.endsWith(".tgz")) {
        await pkg.release;
        return new Response(pkg.tgz);
      }
      const version = pkg.version ?? "1.0.0";
      return Response.json({
        name,
        "dist-tags": { latest: version },
        versions: {
          [version]: {
            name,
            version,
            scripts: pkg.scripts,
            dependencies: pkg.dependencies,
            bin: pkg.bin,
            dist: { tarball: `${origin}/${name}-${version}.tgz` },
          },
        },
      });
    },
  });
}

// Each test's bunfig names its own cache, which an inherited BUN_INSTALL_CACHE_DIR would override.
const installEnv: Record<string, string | undefined> = { ...bunEnv, BUN_INSTALL_CACHE_DIR: undefined };

const bun = (cwd: string, args: string[], env = installEnv) => spawned([bunExe(), ...args], cwd, env);
async function spawned(cmd: string[], cwd: string, env = installEnv) {
  await using proc = Bun.spawn({
    cmd,
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}
const install = (cwd: string, args: string[] = [], env = installEnv) => bun(cwd, ["install", ...args], env);

const isStagingDir = (name: string) => name.startsWith(".bun-tmp-");
const stagingDirs = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter(isStagingDir)
        .map(name => join(dir, name))
    : [];
// An install that links a package again removes what a killed install left in its staging directory. This doesn't work
// on Windows: a directory can't be locked there, so the names are unique to each process (two concurrent installs must
// never share one), and nothing finds them again.
const entriesOf = (dir: string) => readdirSync(dir).filter(name => !(isWindows && isStagingDir(name)));

// Where possible, bun is stopped at an exact system call. An LD_PRELOAD shim lets the first `after` calls of one system
// call through, and the next one kills the process or fails with ENOSPC. That needs Linux, a dynamically linked bun
// (not musl) and a C compiler.
type Interrupt = { syscall: "linkat" | "unlinkat"; after: number };

const shimSource = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int interrupted(const char *name) {
  static int calls;
  const char *syscall_name = getenv("STAGING_TEST_SYSCALL");
  if (!syscall_name || strcmp(syscall_name, name) != 0) return 0;
  if (__sync_add_and_fetch(&calls, 1) <= atoi(getenv("STAGING_TEST_AFTER"))) return 0;
  if (getenv("STAGING_TEST_KILL")) kill(getpid(), SIGKILL);
  errno = ENOSPC;
  return 1;
}

// No thread links its first file before STAGING_TEST_THREADS threads have come to link one.
static void meet(void) {
  static __thread int is_here;
  static int here;
  const char *threads = getenv("STAGING_TEST_THREADS");
  if (!threads || is_here) return;
  is_here = 1;
  __sync_add_and_fetch(&here, 1);
  while (__sync_add_and_fetch(&here, 0) < atoi(threads)) usleep(100);
}

// A file called held.js isn't linked until a file named "released" exists in STAGING_TEST_HOLD. A file named "holding"
// there means that one is waiting.
static void hold(const char *path) {
  const char *dir = getenv("STAGING_TEST_HOLD");
  size_t length = strlen(path);
  char marker[4096];
  if (!dir || length < 7 || strcmp(path + length - 7, "held.js") != 0) return;
  snprintf(marker, sizeof marker, "%s/holding", dir);
  close(open(marker, O_CREAT | O_WRONLY, 0644));
  snprintf(marker, sizeof marker, "%s/released", dir);
  while (access(marker, F_OK) != 0) usleep(100);
}

int linkat(int olddirfd, const char *oldpath, int newdirfd, const char *newpath, int flags) {
  static int (*real_linkat)(int, const char *, int, const char *, int);
  if (!real_linkat) real_linkat = dlsym(RTLD_NEXT, "linkat");
  if (interrupted("linkat")) return -1;
  meet();
  hold(newpath);
  return real_linkat(olddirfd, oldpath, newdirfd, newpath, flags);
}

// Like overlayfs, which can't move a directory from a lower layer.
int renameat(int olddirfd, const char *oldpath, int newdirfd, const char *newpath) {
  static int (*real_renameat)(int, const char *, int, const char *);
  if (!real_renameat) real_renameat = dlsym(RTLD_NEXT, "renameat");
  const char *slash = strrchr(newpath, '/');
  const char *name = slash ? slash + 1 : newpath;
  if (getenv("STAGING_TEST_NOTHING_MOVES_ASIDE") &&
      (strncmp(name, ".old-", 5) == 0 || strncmp(name, ".bun-tmp-", 9) == 0)) {
    errno = EXDEV;
    return -1;
  }
  return real_renameat(olddirfd, oldpath, newdirfd, newpath);
}

// Only the files of the package count: bun unlinks other things on its way.
int unlinkat(int dirfd, const char *path, int flags) {
  static int (*real_unlinkat)(int, const char *, int);
  if (!real_unlinkat) real_unlinkat = dlsym(RTLD_NEXT, "unlinkat");
  size_t length = strlen(path);
  if (length > 3 && strcmp(path + length - 3, ".js") == 0 && interrupted("unlinkat")) return -1;
  return real_unlinkat(dirfd, path, flags);
}
`;

// Simulates an install that's linking. It holds the lock that an install takes on the project's node_modules until its
// stdin is closed.
const lockHolderSource = /* c */ `
#include <fcntl.h>
#include <sys/file.h>
#include <unistd.h>

int main(int argc, char **argv) {
  char byte;
  int fd = open(argv[1], O_RDONLY | O_DIRECTORY);
  if (fd < 0 || flock(fd, LOCK_EX | LOCK_NB) != 0) return 1;
  if (write(1, "locked", 6) != 6) return 1;
  while (read(0, &byte, 1) > 0) {}
  return 0;
}
`;

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
const shimDir =
  isLinux && !isMusl && cc
    ? tempDir("staging-shim", { "shim.c": shimSource, "lock-holder.c": lockHolderSource })
    : undefined;

beforeAll(async () => {
  if (!shimDir) return;
  for (const args of [
    ["-shared", "-fPIC", "-o", "shim.so", "shim.c", "-ldl"],
    ["-o", "lock-holder", "lock-holder.c"],
  ]) {
    await using compile = Bun.spawn({
      cmd: [cc!, ...args],
      cwd: String(shimDir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([compile.stdout.text(), compile.stderr.text(), compile.exited]);
    if (exitCode !== 0) throw new Error(`compile failed: ${out}${err}`);
  }
});
afterAll(() => shimDir?.[Symbol.dispose]());

const preloadEnv = () => ({
  ...installEnv,
  LD_PRELOAD: [join(String(shimDir), "shim.so"), bunEnv.LD_PRELOAD].filter(Boolean).join(":"),
});
const shimEnv = ({ syscall, after }: Interrupt, kill: boolean) => ({
  ...preloadEnv(),
  STAGING_TEST_SYSCALL: syscall,
  STAGING_TEST_AFTER: String(after),
  STAGING_TEST_KILL: kill ? "1" : undefined,
});

// Kills `bun install` at `interrupt` with the shim, or without the shim, once `underWay()` is true. Returns false if
// the install finished first.
async function installAndKill(cwd: string, args: string[], interrupt: Interrupt, underWay: () => boolean) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", ...args],
    cwd,
    env: shimDir ? shimEnv(interrupt, true) : installEnv,
    stdout: "ignore",
    stderr: "pipe",
  });
  let killed = false;
  if (!shimDir) {
    let exited = false;
    proc.exited.then(() => (exited = true));
    while (!exited && !killed) {
      if (underWay()) {
        proc.kill("SIGKILL");
        killed = true;
      } else {
        await new Promise(resolve => setImmediate(resolve));
      }
    }
  }
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  killed ||= proc.signalCode === "SIGKILL";
  if (!killed) {
    expect(stderr).not.toContain("error");
    expect(exitCode).toBe(0);
  }
  return killed;
}

const packageDirs = {
  hoisted: (root: string) => join(root, "node_modules", "many-files"),
  isolated: (root: string) => join(root, "node_modules", ".bun", "many-files@1.0.0", "node_modules", "many-files"),
};

// Not concurrent. Without the shim, the kill has to happen while the package is still being linked, and a poll loop
// that shares the event loop with another test's assertions can't guarantee that.
for (const [linker, packageDir] of Object.entries(packageDirs)) {
  test(`${linker} linker: a package whose install was interrupted is installed again`, async () => {
    const tgz = await new Bun.Archive(archiveEntries, { compress: "gzip" }).bytes();
    using registry = serveRegistry({ "many-files": { tgz } });
    using dir = tempDir(`interrupted-install-${linker}`, {
      "package.json": JSON.stringify({ name: "app", dependencies: { "many-files": "1.0.0" } }),
      "bunfig.toml": ({ root }) =>
        Bun.TOML.stringify({ install: { registry: registry.url.href, cache: join(root, ".bun-cache"), linker } }),
    });
    const root = String(dir);
    const installed = packageDir(root);
    const installedParent = join(installed, "..");

    // Warm the cache and record what a finished install looks like.
    const warm = await install(root);
    expect(warm.stderr).not.toContain("error");
    expect(warm.exitCode).toBe(0);
    expect(compareWithExpectedTree(installed)).toEqual(completeTree);
    const finishedParentListing = readdirSync(installedParent).sort();
    expect(finishedParentListing.filter(isStagingDir)).toEqual([]);

    // The package.json shows up, in the package or in the staging directory it is linked
    // into: the rest of the files is being linked. A starved poll loop can miss the whole
    // install, which proves nothing, so that attempt is repeated.
    const linking = () =>
      [installed, ...stagingDirs(installedParent)].some(dir => existsSync(join(dir, "package.json")));
    let killed = false;
    for (let attempt = 0; attempt < 5 && !killed; attempt++) {
      rmSync(join(root, "node_modules"), { recursive: true });
      killed = await installAndKill(root, [], { syscall: "linkat", after: FILE_COUNT - 10 }, linking);
    }
    expect(killed).toBe(true);
    // Either the package is not at its final path yet, or all of it is.
    if (existsSync(installed)) {
      expect(compareWithExpectedTree(installed)).toEqual(completeTree);
    }

    const repaired = await install(root);
    expect(repaired.stderr).not.toContain("error");
    expect(repaired.exitCode).toBe(0);
    expect(compareWithExpectedTree(installed)).toEqual(completeTree);
    expect(entriesOf(installedParent).sort()).toEqual(finishedParentListing);
  });
}

// `--force` links a package that is already installed again. The hoisted linker has
// always renamed the old directory aside first; the isolated linker deleted it where
// it was, and a kill during that delete left part of it at the final path.
test("isolated linker: a package whose replacement was interrupted is installed again", async () => {
  const tgz = await new Bun.Archive(archiveEntries, { compress: "gzip" }).bytes();
  using registry = serveRegistry({ "many-files": { tgz } });
  using dir = tempDir("interrupted-reinstall", {
    "package.json": JSON.stringify({ name: "app", dependencies: { "many-files": "1.0.0" } }),
    "bunfig.toml": ({ root }) =>
      Bun.TOML.stringify({
        install: { registry: registry.url.href, cache: join(root, ".bun-cache"), linker: "isolated" },
      }),
  });
  const root = String(dir);
  const installed = packageDirs.isolated(root);
  const installedParent = join(installed, "..");

  // One file per directory, so the replacement is noticed no matter which directory comes first.
  const sentinels = Array.from({ length: DIR_COUNT }, (_, dir) => join(installed, `d${dir}`, "f0.js"));
  const replacing = () => stagingDirs(installedParent).length > 0 || !sentinels.every(file => existsSync(file));

  let killed = false;
  for (let attempt = 0; attempt < 5 && !killed; attempt++) {
    const complete = await install(root);
    expect(complete.stderr).not.toContain("error");
    expect(complete.exitCode).toBe(0);
    expect(compareWithExpectedTree(installed)).toEqual(completeTree);
    killed = await installAndKill(root, ["--force"], { syscall: "unlinkat", after: 5 }, replacing);
  }
  expect(killed).toBe(true);
  // Either the package is not at its final path any more, or all of it is.
  if (existsSync(installed)) {
    expect(compareWithExpectedTree(installed)).toEqual(completeTree);
  }

  const repaired = await install(root);
  expect(repaired.stderr).not.toContain("error");
  expect(repaired.exitCode).toBe(0);
  expect(compareWithExpectedTree(installed)).toEqual(completeTree);
  expect(entriesOf(installedParent)).toEqual(["many-files"]);
});

// Only the install that holds the lock on the project's node_modules uses names that the next install can find again.
// Any other install uses unique names and doesn't touch the rest.
describe.skipIf(!shimDir)("leftovers of a killed install in a staging directory", () => {
  for (const [linker, packageDir] of Object.entries(packageDirs)) {
    test.concurrent(`${linker} linker: are kept while another install is linking, and removed afterwards`, async () => {
      const tgz = await new Bun.Archive(archiveEntries, { compress: "gzip" }).bytes();
      using registry = serveRegistry({ "many-files": { tgz } });
      using dir = tempDir(`staging-lock-${linker}`, {
        "package.json": JSON.stringify({ name: "app", dependencies: { "many-files": "1.0.0" } }),
        "bunfig.toml": ({ root }) =>
          Bun.TOML.stringify({ install: { registry: registry.url.href, cache: join(root, ".bun-cache"), linker } }),
      });
      const root = String(dir);
      const installed = packageDir(root);
      const installedParent = join(installed, "..");

      const warm = await install(root);
      expect(warm.stderr).not.toContain("error");
      expect(warm.exitCode).toBe(0);
      const finishedParentListing = readdirSync(installedParent).sort();

      rmSync(join(root, "node_modules"), { recursive: true });
      expect(await installAndKill(root, [], { syscall: "linkat", after: FILE_COUNT - 10 }, () => false)).toBe(true);
      const left = stagingDirs(installedParent);
      expect(left).toHaveLength(1);
      const leftEntries = readdirSync(left[0], { recursive: true }).length;

      {
        await using holder = Bun.spawn({
          cmd: [join(String(shimDir), "lock-holder"), join(root, "node_modules")],
          stdin: "pipe",
          stdout: "pipe",
          stderr: "inherit",
        });
        const reader = holder.stdout.getReader();
        expect(new TextDecoder().decode((await reader.read()).value)).toBe("locked");
        reader.releaseLock();

        const beside = await install(root);
        expect(beside.stderr).not.toContain("error");
        expect(beside.exitCode).toBe(0);
        expect(compareWithExpectedTree(installed)).toEqual(completeTree);
        const prune = await bun(root, ["prune"]);
        expect(prune.stderr).not.toContain("error");
        expect(prune.exitCode).toBe(0);
        expect({
          left: stagingDirs(installedParent),
          leftEntries: readdirSync(left[0], { recursive: true }).length,
        }).toEqual({ left, leftEntries });

        holder.stdin.end();
        expect(await holder.exited).toBe(0);
      }

      rmSync(installed, { recursive: true });
      const alone = await install(root);
      expect(alone.stderr).not.toContain("error");
      expect(alone.exitCode).toBe(0);
      expect(compareWithExpectedTree(installed)).toEqual(completeTree);
      expect(readdirSync(installedParent).sort()).toEqual(finishedParentListing);
    });

    test.concurrent(`${linker} linker: a symlink in its place is removed, not followed`, async () => {
      const tgz = await new Bun.Archive(archiveEntries, { compress: "gzip" }).bytes();
      using registry = serveRegistry({ "many-files": { tgz } });
      using dir = tempDir(`staging-symlink-${linker}`, {
        "package.json": JSON.stringify({ name: "app", dependencies: { "many-files": "1.0.0" } }),
        "outside/keep.js": "",
        "bunfig.toml": ({ root }) =>
          Bun.TOML.stringify({ install: { registry: registry.url.href, cache: join(root, ".bun-cache"), linker } }),
      });
      const root = String(dir);
      const installed = packageDir(root);
      const installedParent = join(installed, "..");

      // The kill is only there to learn the name.
      expect(await installAndKill(root, [], { syscall: "linkat", after: FILE_COUNT - 10 }, () => false)).toBe(true);
      const left = stagingDirs(installedParent);
      expect(left).toHaveLength(1);
      rmSync(left[0], { recursive: true });
      symlinkSync(join(root, "outside"), left[0]);

      const { stderr, exitCode } = await install(root);
      expect(stderr).not.toContain("error");
      expect(exitCode).toBe(0);
      expect(compareWithExpectedTree(installed)).toEqual(completeTree);
      expect({ outside: readdirSync(join(root, "outside")), left: stagingDirs(installedParent) }).toEqual({
        outside: ["keep.js"],
        left: [],
      });
    });
  }
});

// The lock is never waited for, or a lifecycle script that runs `bun install` in the
// project being installed would wait for the install that waits for it. The script
// removes a package that is installed already, so that its install has one to link.
const installsInTheSameProject = [
  `until [ -e "$STAGING_TEST_OTHER/package.json" ]; do :; done`,
  `rm -rf "$STAGING_TEST_OTHER"`,
  `cd "$STAGING_TEST_ROOT"`,
  `"$STAGING_TEST_BUN" install --ignore-scripts`,
  `: > script-is-done`,
].join(" && ");

const otherPackageDirs = {
  hoisted: "node_modules/other",
  isolated: "node_modules/.bun/other@1.0.0/node_modules/other",
};

// The script is POSIX sh; on Windows lifecycle scripts run in bun's own shell.
for (const [linker, otherPackageDir] of Object.entries(otherPackageDirs)) {
  test.concurrent.skipIf(isWindows)(
    `${linker} linker: a lifecycle script can run bun install in the project being installed`,
    async () => {
      const scripts = { install: installsInTheSameProject };
      const pack = (packageJson: object) =>
        new Bun.Archive({ "package/package.json": JSON.stringify(packageJson) }, { compress: "gzip" }).bytes();
      using registry = serveRegistry({
        other: { tgz: await pack({ name: "other", version: "1.0.0" }) },
        nested: { tgz: await pack({ name: "nested", version: "1.0.0", scripts }), scripts },
      });
      using dir = tempDir(`staging-nested-install-${linker}`, {
        "package.json": JSON.stringify({
          name: "app",
          dependencies: { other: "1.0.0", nested: "1.0.0" },
          trustedDependencies: ["nested"],
        }),
        "bunfig.toml": ({ root }) =>
          Bun.TOML.stringify({ install: { registry: registry.url.href, cache: join(root, ".bun-cache"), linker } }),
      });
      const root = String(dir);
      const other = join(root, otherPackageDir);

      const { stderr, exitCode } = await install(root, [], {
        ...installEnv,
        STAGING_TEST_BUN: bunExe(),
        STAGING_TEST_ROOT: root,
        STAGING_TEST_OTHER: other,
      });
      expect(stderr).not.toContain("error");
      expect(exitCode).toBe(0);
      expect({
        scriptIsDone: existsSync(join(root, "script-is-done")),
        other: readdirSync(other),
        besideIt: readdirSync(join(other, "..")).filter(isStagingDir),
      }).toEqual({ scriptIsDone: true, other: ["package.json"], besideIt: [] });
    },
  );
}

// https://github.com/oven-sh/bun/issues/43256: bun exits as soon as a lifecycle
// script fails, while the isolated linker's tasks for other packages are still
// linking on other threads. (What it has just downloaded the hoisted linker links on the
// thread that would exit, so it cannot be caught midway like this.) With a lockfile and a cold
// cache, tarballs are downloaded while packages are being linked, so the
// registry can hold the large package back until the script runs, and the
// script fails once something shows up where that package is linked: the exit
// lands mid-link.
const failOnceLinkingStarts = [
  `: > "$STAGING_TEST_SCRIPT_STARTED"`,
  `until set -- "$STAGING_TEST_LINK_DIR"/* "$STAGING_TEST_LINK_DIR"/.[!.]*; [ -e "$1" ] || [ -e "$2" ]; do :; done`,
  `exit 1`,
].join("; ");

// The script is POSIX sh; on Windows lifecycle scripts run in bun's own shell.
test.skipIf(isWindows)(
  "isolated linker: a lifecycle script that fails mid-link leaves no partial package",
  async () => {
    const scripts = { install: failOnceLinkingStarts };
    const manyFiles: RegistryPackage = { tgz: await new Bun.Archive(archiveEntries, { compress: "gzip" }).bytes() };
    const failingScript: RegistryPackage = {
      tgz: await new Bun.Archive(
        { "package/package.json": JSON.stringify({ name: "failing-script", version: "1.0.0", scripts }) },
        { compress: "gzip" },
      ).bytes(),
      scripts,
    };
    using registry = serveRegistry({ "many-files": manyFiles, "failing-script": failingScript });

    const dependencies = { "many-files": "1.0.0" };
    const rootPackageJson = { name: "app", private: true, workspaces: ["packages/*"] };
    using dir = tempDir("staging-script-failure", {
      "package.json": JSON.stringify({ ...rootPackageJson, trustedDependencies: ["failing-script"] }),
      "packages/a/package.json": JSON.stringify({
        name: "pkg-a",
        version: "1.0.0",
        dependencies: { ...dependencies, "failing-script": "1.0.0" },
      }),
      "packages/b/package.json": JSON.stringify({ name: "pkg-b", version: "1.0.0", dependencies }),
      "bunfig.toml": ({ root }) =>
        Bun.TOML.stringify({
          install: { registry: registry.url.href, cache: join(root, ".bun-cache"), linker: "isolated" },
        }),
    });
    const root = String(dir);
    const installed = packageDirs.isolated(root);
    const installedParent = join(installed, "..");

    const lockfileOnly = await install(root, ["--lockfile-only"]);
    expect(lockfileOnly.stderr).not.toContain("error");
    expect(lockfileOnly.exitCode).toBe(0);

    const scriptStarted = Promise.withResolvers<void>();
    manyFiles.release = scriptStarted.promise;
    const watcher = watch(root, (_, filename) => {
      if (filename === "script-started") scriptStarted.resolve();
    });
    try {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: root,
        env: {
          ...installEnv,
          STAGING_TEST_SCRIPT_STARTED: join(root, "script-started"),
          STAGING_TEST_LINK_DIR: installedParent,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      // An install that ends without running the script must not leave the registry waiting.
      proc.exited.then(() => scriptStarted.resolve());
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain('install script from "failing-script" exited with 1');
      expect(exitCode).toBe(1);
    } finally {
      watcher.close();
    }
    // Either the package is not at its final path yet, or all of it is.
    if (existsSync(installed)) {
      expect(compareWithExpectedTree(installed)).toEqual(completeTree);
    }

    // This is what the reporter did next: remove the trust and install again.
    writeFileSync(join(root, "package.json"), JSON.stringify(rootPackageJson));
    const second = await install(root);
    expect(second.stderr).not.toContain("error");
    expect(second.exitCode).toBe(0);
    expect(compareWithExpectedTree(installed)).toEqual(completeTree);
    expect(entriesOf(installedParent)).toEqual(["many-files"]);
  },
);

// A workspace that other packages depend on under a second name is linked into
// node_modules under both names, and the hoisted linker walks the packages
// nested inside it once per name. The second walk finds the first one's result
// already sitting at the final path.
const aliasLinkDirs = {
  hoisted: "node_modules/inner-alias",
  isolated: "packages/second/node_modules/inner-alias",
};

for (const [linker, aliasLinkDir] of Object.entries(aliasLinkDirs)) {
  test.concurrent(
    `${linker} linker: a package reached through two workspace aliases is installed under both`,
    async () => {
      const depTarball = await new Bun.Archive(
        {
          "package/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
          "package/index.js": "module.exports = 1;\n",
        },
        { compress: "gzip" },
      ).bytes();
      using dir = tempDir(`staging-alias-${linker}`, {
        // The root's own `dep` keeps inner's `dep` from being hoisted out of inner.
        "package.json": JSON.stringify({
          name: "app",
          workspaces: ["packages/*"],
          dependencies: { dep: "file:./dep-root" },
        }),
        "dep-root/package.json": JSON.stringify({ name: "dep", version: "2.0.0" }),
        "dep-1.0.0.tgz": Buffer.from(depTarball),
        "packages/inner/package.json": JSON.stringify({
          name: "inner",
          version: "1.0.0",
          dependencies: { dep: "file:../../dep-1.0.0.tgz" },
        }),
        "packages/second/package.json": JSON.stringify({
          name: "second",
          version: "1.0.0",
          dependencies: { "inner-alias": "workspace:inner@*" },
        }),
        "bunfig.toml": ({ root }) => Bun.TOML.stringify({ install: { cache: join(root, ".bun-cache"), linker } }),
      });
      const root = String(dir);

      const { stderr, exitCode } = await install(root);
      expect(stderr).not.toContain("error");
      expect(exitCode).toBe(0);

      const version = (packageDir: string) =>
        JSON.parse(readFileSync(join(root, packageDir, "package.json"), "utf8")).version;
      expect({
        rootDep: version("node_modules/dep"),
        innerDep: version("packages/inner/node_modules/dep"),
        aliasedInnerDep: version(join(aliasLinkDir, "node_modules/dep")),
        innerNodeModules: readdirSync(join(root, "packages/inner/node_modules")),
      }).toEqual({ rootDep: "2.0.0", innerDep: "1.0.0", aliasedInnerDep: "1.0.0", innerNodeModules: ["dep"] });
    },
  );
}

// In that layout a lifecycle script of the nested package starts as soon as the
// first walk is done, so it is running when the second walk installs the package
// again. The script runs once per walk; the first run waits for the second to
// start (the deadline only keeps it from hanging should there be no second run),
// then checks that it still is where the package lives.
const keepsItsDirectory = [
  `if mkdir "$STAGING_TEST_MARKERS/first" 2>/dev/null`,
  `then deadline=$(($(date +%s) + 3))`,
  `until [ -d "$STAGING_TEST_MARKERS/second" ] || [ "$(date +%s)" -ge "$deadline" ]; do :; done`,
  `[ "$(pwd -P)" = "$STAGING_TEST_DEP_DIR" ]`,
  `else mkdir "$STAGING_TEST_MARKERS/second"`,
  `fi`,
].join("; ");

// The script is POSIX sh; on Windows lifecycle scripts run in bun's own shell.
test.concurrent.skipIf(isWindows)(
  "hoisted linker: the second install of a doubly aliased package leaves a running lifecycle script its directory",
  async () => {
    const depTarball = await new Bun.Archive(
      {
        "package/package.json": JSON.stringify({
          name: "dep",
          version: "1.0.0",
          scripts: { postinstall: keepsItsDirectory },
        }),
      },
      { compress: "gzip" },
    ).bytes();
    using dir = tempDir("staging-alias-script", {
      "package.json": JSON.stringify({
        name: "app",
        workspaces: ["packages/*"],
        dependencies: { dep: "file:./dep-root" },
        trustedDependencies: ["dep"],
      }),
      "dep-root/package.json": JSON.stringify({ name: "dep", version: "2.0.0" }),
      "dep-1.0.0.tgz": Buffer.from(depTarball),
      "packages/inner/package.json": JSON.stringify({
        name: "inner",
        version: "1.0.0",
        dependencies: { dep: "file:../../dep-1.0.0.tgz" },
      }),
      "packages/second/package.json": JSON.stringify({
        name: "second",
        version: "1.0.0",
        dependencies: { "inner-alias": "workspace:inner@*" },
      }),
      "markers/.keep": "",
      "bunfig.toml": ({ root }) =>
        Bun.TOML.stringify({ install: { cache: join(root, ".bun-cache"), linker: "hoisted" } }),
    });
    const root = String(dir);

    const { stderr, exitCode } = await install(root, [], {
      ...installEnv,
      STAGING_TEST_MARKERS: join(root, "markers"),
      STAGING_TEST_DEP_DIR: join(root, "packages", "inner", "node_modules", "dep"),
    });
    expect(stderr).not.toContain("error");
    expect(exitCode).toBe(0);
    expect(readdirSync(join(root, "markers")).sort()).toEqual([".keep", "first", "second"]);
  },
);

// An alias may already be as long as a file name can be, so the staging
// directory's name cannot be derived from it by adding to it.
for (const linker of ["hoisted", "isolated"]) {
  test.concurrent(`${linker} linker: a package whose alias is 255 characters long is installed`, async () => {
    const alias = Buffer.alloc(255, "a").toString();
    using dir = tempDir(`staging-long-alias-${linker}`, {
      "package.json": JSON.stringify({ name: "app", dependencies: { [alias]: "file:./a-package" } }),
      "a-package/package.json": JSON.stringify({ name: "a-package", version: "1.0.0" }),
      "bunfig.toml": ({ root }) => Bun.TOML.stringify({ install: { cache: join(root, ".bun-cache"), linker } }),
    });
    const root = String(dir);

    const { stderr, exitCode } = await install(root);
    expect(stderr).not.toContain("error");
    expect(exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(root, "node_modules", alias, "package.json"), "utf8")).name).toBe("a-package");
    expect(readdirSync(join(root, "node_modules")).filter(name => name !== ".bun")).toEqual([alias]);
  });
}

// The staging directory of a scoped package is created inside node_modules/@scope.
// mkdir of anything below a dangling symlink is ENOENT and mkdir of the symlink
// itself is EEXIST, between which the hoisted linker went back and forth forever.
// It replaces a link at node_modules/@scope by a directory now, and the isolated
// linker moves a node_modules it did not make aside first.
for (const linker of ["hoisted", "isolated"]) {
  test.concurrent.skipIf(isWindows)(
    `${linker} linker: a dangling node_modules/@scope symlink does not hang the install`,
    async () => {
      const depTarball = await new Bun.Archive(
        { "package/package.json": JSON.stringify({ name: "@scope/dep", version: "1.0.0" }) },
        { compress: "gzip" },
      ).bytes();
      using dir = tempDir(`staging-dangling-scope-${linker}`, {
        "package.json": JSON.stringify({ name: "app", dependencies: { "@scope/dep": "file:./dep-1.0.0.tgz" } }),
        "dep-1.0.0.tgz": Buffer.from(depTarball),
        "node_modules": {},
        "bunfig.toml": ({ root }) => Bun.TOML.stringify({ install: { cache: join(root, ".bun-cache"), linker } }),
      });
      const root = String(dir);
      symlinkSync(join(root, "does-not-exist"), join(root, "node_modules", "@scope"));

      const { stderr, exitCode } = await install(root);
      expect(stderr).not.toContain("error");
      expect(readdirSync(join(root, "node_modules", "@scope"))).toEqual(["dep"]);
      expect(lstatSync(join(root, "node_modules", "@scope")).isDirectory()).toBe(true);
      expect(exitCode).toBe(0);
    },
  );
}

// When linking fails midway, bun sees the error itself instead of being killed,
// and the failure path must not leave a partial copy at the final path or a
// staging directory behind either.
describe.skipIf(!shimDir)("a link that runs out of space midway", () => {
  for (const [linker, packageDir] of Object.entries(packageDirs)) {
    test.concurrent(
      `${linker} linker: leaves nothing at the package's path and the next install succeeds`,
      async () => {
        const tgz = await new Bun.Archive(archiveEntries, { compress: "gzip" }).bytes();
        using registry = serveRegistry({ "many-files": { tgz } });
        using dir = tempDir(`staging-enospc-${linker}`, {
          "package.json": JSON.stringify({ name: "app", dependencies: { "many-files": "1.0.0" } }),
          "bunfig.toml": ({ root }) =>
            Bun.TOML.stringify({ install: { registry: registry.url.href, cache: join(root, ".bun-cache"), linker } }),
        });
        const root = String(dir);
        const installed = packageDir(root);
        const installedParent = join(installed, "..");

        // Warm the cache so the next install only links.
        const warm = await install(root);
        expect(warm.stderr).not.toContain("error");
        expect(warm.exitCode).toBe(0);
        rmSync(join(root, "node_modules"), { recursive: true });

        // No PATH: a debug build that finds llvm-symbolizer there spends seconds on a stack
        // trace when the hoisted linker fails. Nothing in this install looks anything up.
        const failing = await install(root, [], { ...shimEnv({ syscall: "linkat", after: 300 }, false), PATH: "" });
        expect(failing.stderr).toContain("ENOSPC");
        expect(failing.exitCode).toBe(1);
        expect({
          installed: existsSync(installed),
          leftInParent: existsSync(installedParent) ? readdirSync(installedParent) : [],
        }).toEqual({ installed: false, leftInParent: [] });

        const repaired = await install(root);
        expect(repaired.stderr).not.toContain("error");
        expect(repaired.exitCode).toBe(0);
        expect(compareWithExpectedTree(installed)).toEqual(completeTree);
      },
    );
  }
});

// Nests directories inside `parent`, with a file in the deepest one, until their
// joined path is longer than any path the filesystem takes. Short chains are made
// side by side in `scratch` and renamed into each other, deepest first, so that no
// single call names a long path.
function createTreeDeeperThanPathMax(parent: string, scratch: string) {
  const segment = Buffer.alloc(100, "d").toString();
  const chain = [segment, segment, segment, segment];
  const chainCount = Math.ceil(((isLinux ? 4096 : 1024) + 256) / (chain.length * (segment.length + 1)));
  for (let i = 0; i < chainCount; i++) {
    mkdirSync(join(scratch, String(i), ...chain), { recursive: true });
  }
  writeFileSync(join(scratch, String(chainCount - 1), ...chain, "leaf.js"), "");
  for (let i = chainCount - 1; i > 0; i--) {
    renameSync(join(scratch, String(i), segment), join(scratch, String(i - 1), ...chain, segment));
  }
  renameSync(join(scratch, "0", segment), join(parent, segment));
}

// On Windows no tree that exists is longer than the buffers its paths are built in.
test.concurrent.skipIf(isWindows)(
  "hoisted linker: a link that fails with ENAMETOOLONG leaves nothing at the package's path",
  async () => {
    const tgz = await new Bun.Archive(
      { "package/package.json": JSON.stringify({ name: "deep", version: "1.0.0" }) },
      { compress: "gzip" },
    ).bytes();
    using registry = serveRegistry({ deep: { tgz } });
    using dir = tempDir("staging-enametoolong", {
      "package.json": JSON.stringify({ name: "app", dependencies: { deep: "1.0.0" } }),
      "bunfig.toml": ({ root }) =>
        Bun.TOML.stringify({
          install: { registry: registry.url.href, cache: join(root, ".bun-cache"), linker: "hoisted" },
        }),
    });
    const root = String(dir);

    // Warm the cache, then grow the cached copy: no tarball can carry such a tree.
    const warm = await install(root);
    expect(warm.stderr).not.toContain("error");
    expect(warm.exitCode).toBe(0);
    const cached = readdirSync(join(root, ".bun-cache")).filter(name => name.startsWith("deep@"));
    expect(cached).toHaveLength(1);
    createTreeDeeperThanPathMax(join(root, ".bun-cache", cached[0]), join(root, "scratch"));
    rmSync(join(root, "node_modules"), { recursive: true });

    // clonefile, the default on macOS, copies the tree without naming its paths.
    const failing = await install(root, ["--backend", "hardlink"]);
    expect(failing.stderr).toContain("ENAMETOOLONG");
    expect(failing.exitCode).toBe(1);
    expect(readdirSync(join(root, "node_modules"))).toEqual([]);
  },
);

// The staging name is longer than most package names. PATH_MAX is 4096 on Linux.
test.concurrent.skipIf(!isLinux)(
  "isolated linker: a project so deep that only the staging directory's absolute path exceeds PATH_MAX",
  async () => {
    const tgz = await new Bun.Archive(
      { "package/package.json": JSON.stringify({ name: "pkg", version: "1.0.0" }) },
      { compress: "gzip" },
    ).bytes();
    using registry = serveRegistry({ pkg: { tgz } });
    using dir = tempDir("staging-deep-project", {});
    const staging = "/node_modules/.bun/pkg@1.0.0/node_modules/.bun-tmp-0123456789abcdef";
    const rootBytes = 4096 + 1 - staging.length;
    let root = String(dir);
    // The last name has to stay under NAME_MAX (255).
    while (rootBytes - root.length > 256) root = join(root, Buffer.alloc(200, "d").toString());
    root = join(root, Buffer.alloc(rootBytes - root.length - 1, "d").toString());
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "app", dependencies: { pkg: "1.0.0" } }));
    writeFileSync(
      join(root, "bunfig.toml"),
      Bun.TOML.stringify({
        install: { registry: registry.url.href, cache: join(String(dir), ".bun-cache"), linker: "isolated" },
      }),
    );

    const { stderr, exitCode } = await install(root);
    expect(stderr).toContain("Saved lockfile");
    expect(stderr).not.toContain("error");
    expect(JSON.parse(readFileSync(join(root, "node_modules", "pkg", "package.json"), "utf8")).name).toBe("pkg");
    expect(exitCode).toBe(0);
  },
);

test.concurrent.skipIf(!isLinux).each(["hoisted", "isolated"])(
  "%s linker: a project so deep that a package's absolute path exceeds PATH_MAX fails with ENAMETOOLONG",
  async linker => {
    const scripts = { postinstall: "echo ran > ran.txt" };
    const tgz = await new Bun.Archive(
      { "package/package.json": JSON.stringify({ name: "pkg", version: "1.0.0", scripts }) },
      { compress: "gzip" },
    ).bytes();
    using registry = serveRegistry({ pkg: { tgz, scripts } });
    using dir = tempDir("deep-project", {});
    const rootBytes = 4096 + 1 - "/node_modules/pkg".length;
    let root = String(dir);
    // The last name has to stay under NAME_MAX (255).
    while (rootBytes - root.length > 256) root = join(root, Buffer.alloc(200, "d").toString());
    root = join(root, Buffer.alloc(rootBytes - root.length - 1, "d").toString());
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "app", dependencies: { pkg: "1.0.0" }, trustedDependencies: ["pkg"] }),
    );
    writeFileSync(
      join(root, "bunfig.toml"),
      Bun.TOML.stringify({ install: { registry: registry.url.href, cache: join(String(dir), ".bun-cache"), linker } }),
    );

    const { stderr, exitCode } = await install(root);
    expect(stderr).toContain("ENAMETOOLONG");
    expect(exitCode).toBe(1);
  },
);

// The hoisted linker links the packages of the cache on the thread pool, several at a time. All
// else about them happens on the main thread, in the order in which it links them itself where
// few files can be open.
describe("hoisted linker: packages linked by the thread pool", () => {
  const FILES = 40;
  const pack = (name: string, more: { files?: string[]; [key: string]: unknown } = {}) => {
    const { files = Array.from({ length: FILES }, (_, i) => `lib/d${i % 4}/f${i}.js`), ...manifest } = more;
    return new Bun.Archive(
      {
        "package/package.json": JSON.stringify({ name, version: "1.0.0", ...manifest }),
        ...Object.fromEntries(files.map(file => [`package/${file}`, `module.exports = "${name}/${file}";\n`])),
      },
      { compress: "gzip" },
    ).bytes();
  };
  const packAll = async (names: string[]) =>
    Object.fromEntries(await Promise.all(names.map(async name => [name, { tgz: await pack(name) }])));
  const project = (name: string, registry: { url: URL }, packageJson: object) =>
    tempDir(name, {
      "package.json": JSON.stringify({ name: "app", ...packageJson }),
      "bunfig.toml": ({ root }) =>
        Bun.TOML.stringify({
          install: { registry: registry.url.href, cache: join(root, ".bun-cache"), linker: "hoisted" },
        }),
    });
  // Leaves bun.lock and a warm cache.
  async function warmUp(root: string, args: string[] = []) {
    const warm = await install(root, args);
    expect(warm.stderr).not.toContain("error");
    expect(warm.exitCode).toBe(0);
  }

  // On Windows no tree that exists is longer than the buffers its paths are built in.
  test.concurrent.skipIf(isWindows)("packages that can't be linked only fail themselves, in order", async () => {
    const names = ["a-first", "b-deep", "c-deep", "d-last"];
    using registry = serveRegistry(await packAll(names));
    using dir = project("pool-enametoolong", registry, {
      dependencies: Object.fromEntries(names.map(name => [name, "1.0.0"])),
    });
    const root = String(dir);

    await warmUp(root);
    for (const name of ["b-deep", "c-deep"]) {
      const cached = readdirSync(join(root, ".bun-cache")).filter(entry => entry.startsWith(`${name}@`));
      expect(cached).toHaveLength(1);
      createTreeDeeperThanPathMax(join(root, ".bun-cache", cached[0]), join(root, `scratch-${name}`));
    }

    const timeless = (text: string) => text.replace(/\[\d+(\.\d+)?m?s\]/g, "[time]");
    const result = async (prefix: string[] = []) => {
      // clonefile, the default on macOS, copies the tree without naming its paths.
      const { stdout, stderr, exitCode } = await spawned(
        [...prefix, bunExe(), "install", "--backend", "hardlink"],
        root,
      );
      return {
        stdout: timeless(stdout),
        stderr: timeless(stderr),
        exitCode,
        installed: readdirSync(join(root, "node_modules")).sort(),
      };
    };
    rmSync(join(root, "node_modules"), { recursive: true });
    const inTurn = await result(["sh", "-c", 'ulimit -n 200 && exec "$0" "$@"']);
    rmSync(join(root, "node_modules"), { recursive: true });
    const byThePool = await result();

    expect(byThePool).toEqual(inTurn);
    expect(byThePool.stderr.split("\n").filter(line => line.includes("ENAMETOOLONG"))).toEqual([
      "ENAMETOOLONG: failed copying files from cache to destination for package b-deep",
      "ENAMETOOLONG: failed copying files from cache to destination for package c-deep",
    ]);
    expect(byThePool.installed).toEqual(["a-first", "d-last"]);
    expect(byThePool.exitCode).toBe(1);
  });

  test.concurrent.skipIf(!shimDir)(
    "an install killed while it links several leaves whole packages, and the next one links the rest",
    async () => {
      const names = Array.from({ length: 8 }, (_, i) => `package-${i}`);
      using registry = serveRegistry(await packAll(names));
      using dir = project("pool-killed", registry, {
        dependencies: Object.fromEntries(names.map(name => [name, "1.0.0"])),
      });
      const root = String(dir);
      const nodeModules = join(root, "node_modules");
      const filesOf = (name: string) =>
        (readdirSync(join(nodeModules, name), { recursive: true }) as string[]).filter(file => file.endsWith(".js"))
          .length;

      await warmUp(root);
      rmSync(nodeModules, { recursive: true });

      const half = (names.length * (FILES + 1)) / 2;
      expect(await installAndKill(root, [], { syscall: "linkat", after: half }, () => false)).toBe(true);
      const left = readdirSync(nodeModules);
      const whole = left.filter(name => !isStagingDir(name));
      expect(left.filter(isStagingDir)).not.toEqual([]);
      expect(whole.map(filesOf)).toEqual(whole.map(() => FILES));

      const repaired = await install(root);
      expect(repaired.stderr).not.toContain("error");
      expect(repaired.exitCode).toBe(0);
      expect(readdirSync(nodeModules).sort()).toEqual(names);
      expect(names.map(filesOf)).toEqual(names.map(() => FILES));
    },
  );

  // `nested` sits below every host, so its dependencies have the same ids in each of those trees.
  // The one below `host-00` is left to the main thread: that host's tree waits for the patch.
  test.concurrent("a package nested in several places gets its dependencies in each", async () => {
    const hosts = Array.from({ length: 16 }, (_, i) => `host-${String(i).padStart(2, "0")}`);
    const leaves = ["leaf-1", "leaf-2", "leaf-3"];
    const files = ["index.js"];
    const all = (range: string) => Object.fromEntries(leaves.map(name => [name, range]));
    const publish = async (name: string, more: Omit<RegistryPackage, "tgz"> = {}) => [
      name,
      { ...more, tgz: await pack(name, { files, ...more }) },
    ];
    using registry = serveRegistry(
      Object.fromEntries(
        await Promise.all([
          ...hosts.map((name, i) =>
            publish(name, {
              dependencies: { nested: "1.0.0", ...all("npm:filler@3.0.0"), ...(i === 0 ? { patched: "1.0.0" } : {}) },
            }),
          ),
          publish("nested", { dependencies: all("1.0.0") }),
          publish("patched"),
          ...leaves.map(name => publish(name)),
          publish("root-filler", { version: "2.0.0" }),
          publish("filler", { version: "3.0.0" }),
        ]),
      ),
    );
    using dir = project("pool-nested-twice", registry, {
      dependencies: {
        ...Object.fromEntries(hosts.map(name => [name, "1.0.0"])),
        ...Object.fromEntries(["nested", "patched", ...leaves].map(name => [name, "npm:root-filler@2.0.0"])),
      },
      patchedDependencies: { "patched@1.0.0": "patched.patch" },
    });
    const root = String(dir);
    writeFileSync(
      join(root, "patched.patch"),
      `diff --git a/index.js b/index.js
--- a/index.js
+++ b/index.js
@@ -1 +1 @@
-module.exports = "patched/index.js";
+module.exports = "patched";
`,
    );

    await warmUp(root);
    rmSync(join(root, "node_modules"), { recursive: true });
    for (const entry of readdirSync(join(root, ".bun-cache"))) {
      if (entry.includes("_patch_hash=")) rmSync(join(root, ".bun-cache", entry), { recursive: true });
    }

    const { stderr, exitCode } = await install(root);
    expect(stderr).not.toContain("error");
    expect(
      Object.fromEntries(
        hosts.map(name => [
          name,
          readdirSync(join(root, "node_modules", name, "node_modules", "nested", "node_modules")).sort(),
        ]),
      ),
    ).toEqual(Object.fromEntries(hosts.map(name => [name, leaves])));
    expect(exitCode).toBe(0);
  });

  // The pool keeps the node_modules of a batch open. Each `host-N` has one, for its `inner`.
  test.concurrent.skipIf(isWindows)("a low limit on open files does not fail the install", async () => {
    const hosts = Array.from({ length: 60 }, (_, i) => `host-${i}`);
    const files = ["index.js"];
    using registry = serveRegistry({
      ...Object.fromEntries(
        await Promise.all(
          hosts.map(async name => {
            const dependencies = { inner: "1.0.0" };
            return [name, { dependencies, tgz: await pack(name, { files, dependencies }) }];
          }),
        ),
      ),
      inner: { tgz: await pack("inner", { files }) },
      "root-filler": { version: "2.0.0", tgz: await pack("root-filler", { files, version: "2.0.0" }) },
    });
    using dir = project("pool-open-files", registry, {
      dependencies: { ...Object.fromEntries(hosts.map(name => [name, "1.0.0"])), inner: "npm:root-filler@2.0.0" },
    });
    const root = String(dir);

    await warmUp(root);
    rmSync(join(root, "node_modules"), { recursive: true });

    await using proc = Bun.spawn({
      cmd: ["sh", "-c", 'ulimit -n 64 && exec "$0" install', bunExe()],
      cwd: root,
      env: installEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, , exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
    expect(stderr).not.toContain("EMFILE");
    expect(
      hosts.filter(name => !existsSync(join(root, "node_modules", name, "node_modules", "inner", "index.js"))),
    ).toEqual([]);
    expect(exitCode).toBe(0);
  });

  // Without a second thread the first one waits for it until the test times out.
  test.concurrent.skipIf(!shimDir).each([
    ["there is no node_modules", [], (nodeModules: string) => rmSync(nodeModules, { recursive: true })],
    [
      "node_modules is empty",
      [],
      (nodeModules: string) => (rmSync(nodeModules, { recursive: true }), mkdirSync(nodeModules)),
    ],
    [
      "node_modules lacks them",
      [],
      (nodeModules: string) => ["one", "two"].forEach(name => rmSync(join(nodeModules, name), { recursive: true })),
    ],
    [
      "node_modules has other versions",
      [],
      (nodeModules: string) =>
        ["one", "two"].forEach(name => {
          // Don't write through the hard link, because it's also the cache's file.
          rmSync(join(nodeModules, name, "package.json"));
          writeFileSync(join(nodeModules, name, "package.json"), JSON.stringify({ name, version: "0.0.1" }));
          writeFileSync(join(nodeModules, name, "only-in-the-other-version.js"), "");
        }),
    ],
    [
      "--force",
      ["--force"],
      (nodeModules: string) =>
        ["one", "two"].forEach(name => writeFileSync(join(nodeModules, name, "not-in-the-package.js"), "")),
    ],
  ] as const)("two threads link at the same time: %s", async (_state, args, change) => {
    const names = ["kept", "one", "two"];
    using registry = serveRegistry(await packAll(names));
    using dir = project("pool-two-threads", registry, {
      dependencies: Object.fromEntries(names.map(name => [name, "1.0.0"])),
    });
    const root = String(dir);
    const filesOf = (name: string) =>
      (readdirSync(join(root, "node_modules", name), { recursive: true }) as string[]).filter(f => f.endsWith(".js"))
        .length;

    await warmUp(root);
    change(join(root, "node_modules"));

    const { stderr, exitCode } = await install(root, [...args], { ...preloadEnv(), STAGING_TEST_THREADS: "2" });
    expect(stderr).not.toContain("error");
    expect(entriesOf(join(root, "node_modules")).sort()).toEqual(names);
    expect(names.map(filesOf)).toEqual(names.map(() => FILES));
    expect(JSON.parse(readFileSync(join(root, "node_modules", "one", "package.json"), "utf8")).version).toBe("1.0.0");
    expect(exitCode).toBe(0);
  });

  // The main thread links a folder. This one is in `a-host`, which comes before it and waits for the pool.
  test.concurrent.each(["file:", "link:"])("a %s folder inside a package that the pool links", async protocol => {
    const host = await new Bun.Archive(
      {
        "package/package.json": JSON.stringify({ name: "a-host", version: "1.0.0" }),
        "package/inner/package.json": JSON.stringify({ name: "z-inner", version: "1.0.0" }),
        "package/inner/index.js": "module.exports = 'inner';\n",
      },
      { compress: "gzip" },
    ).bytes();
    using registry = serveRegistry({ "a-host": { tgz: host }, "b-plain": { tgz: await pack("b-plain") } });
    const dependencies = { "a-host": "1.0.0", "b-plain": "1.0.0" };
    using dir = project("pool-folder-in-a-package", registry, { dependencies });
    const root = String(dir);

    await warmUp(root);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        name: "app",
        dependencies: { ...dependencies, "z-inner": `${protocol}./node_modules/a-host/inner` },
      }),
    );
    await warmUp(root);
    rmSync(join(root, "node_modules"), { recursive: true });

    const { stderr, exitCode } = await install(root);
    expect(stderr).not.toContain("error");
    expect(readFileSync(join(root, "node_modules", "z-inner", "index.js"), "utf8")).toBe("module.exports = 'inner';\n");
    expect(exitCode).toBe(0);
  });

  // `b-patched` is trusted, so the main thread links it, after `a-plain`, which waits for the pool.
  // It is the last thing that happens, and only then is its patch found to be applied to nothing yet.
  test.concurrent("a patch that is applied after the last package was linked is waited for", async () => {
    const files = ["index.js"];
    using registry = serveRegistry({
      "a-plain": { tgz: await pack("a-plain", { files }) },
      "b-patched": { tgz: await pack("b-patched", { files }) },
    });
    using dir = project("pool-late-patch", registry, {
      dependencies: { "a-plain": "1.0.0", "b-patched": "1.0.0" },
      trustedDependencies: ["b-patched"],
      patchedDependencies: { "b-patched@1.0.0": "b-patched.patch" },
    });
    const root = String(dir);
    writeFileSync(
      join(root, "b-patched.patch"),
      `diff --git a/index.js b/index.js
--- a/index.js
+++ b/index.js
@@ -1 +1 @@
-module.exports = "b-patched/index.js";
+module.exports = "patched";
`,
    );

    await warmUp(root);
    rmSync(join(root, "node_modules"), { recursive: true });
    for (const entry of readdirSync(join(root, ".bun-cache"))) {
      if (entry.includes("_patch_hash=")) rmSync(join(root, ".bun-cache", entry), { recursive: true });
    }

    const { stdout, stderr, exitCode } = await install(root);
    expect(stderr).not.toContain("error");
    expect(stdout).toContain("2 packages installed");
    expect(readFileSync(join(root, "node_modules", "b-patched", "index.js"), "utf8")).toBe(
      'module.exports = "patched";\n',
    );
    expect(exitCode).toBe(0);
  });

  test.concurrent.skipIf(!shimDir).each([
    ["the pool", []],
    ["the main thread", ["sh", "-c", 'ulimit -n 200 && exec "$0" "$@"']],
  ])("a package that cannot be moved aside does not keep its files: %s", async (_who, prefix) => {
    const names = ["one", "two", "three"];
    using registry = serveRegistry(await packAll(names));
    using dir = project("pool-nothing-moves-aside", registry, {
      dependencies: Object.fromEntries(names.map(name => [name, "1.0.0"])),
    });
    const root = String(dir);

    await warmUp(root);
    for (const name of names) {
      // Don't write through the hard link, because it's also the cache's file.
      rmSync(join(root, "node_modules", name, "package.json"));
      writeFileSync(join(root, "node_modules", name, "package.json"), JSON.stringify({ name, version: "0.0.1" }));
      writeFileSync(join(root, "node_modules", name, "only-in-the-other-version.js"), "");
    }

    const { stderr, exitCode } = await spawned([...prefix, bunExe(), "install"], root, {
      ...preloadEnv(),
      STAGING_TEST_NOTHING_MOVES_ASIDE: "1",
    });
    expect(stderr).not.toContain("error");
    expect(names.filter(name => existsSync(join(root, "node_modules", name, "only-in-the-other-version.js")))).toEqual(
      [],
    );
    expect(entriesOf(join(root, "node_modules")).sort()).toEqual(names.toSorted());
    expect(exitCode).toBe(0);
  });

  // Each host has a tree with three packages that have a script. One script runs at a time, and each
  // waits for the bin of the last tree: it is linked when that tree is done, after which no script
  // joins the ones that wait, and bun sees no script end before it has gone through them.
  test.concurrent.skipIf(isWindows)("scripts start in the order in which the main thread starts them", async () => {
    const hosts = Array.from({ length: 7 }, (_, i) => `host-${i}`);
    const scripted = ["scripted-1", "scripted-2", "scripted-3"];
    const nested = [...scripted, "plain-1", "plain-2", "tool"];
    const files = ["index.js"];
    const publish = async (name: string, more: Omit<RegistryPackage, "tgz"> = {}) => [
      name,
      { ...more, tgz: await pack(name, { files, ...more }) },
    ];
    const postinstall = `until [ -e "$LAST_BIN" ]; do :; done; echo "\${PWD#$PROJECT/node_modules/}" >> "$PROJECT/order"`;
    using registry = serveRegistry(
      Object.fromEntries(
        await Promise.all([
          ...hosts.map(name => publish(name, { dependencies: Object.fromEntries(nested.map(dep => [dep, "1.0.0"])) })),
          ...scripted.map(name => publish(name, { scripts: { postinstall } })),
          publish("plain-1"),
          publish("plain-2"),
          publish("tool", { bin: "index.js" }),
          publish("root-filler", { version: "2.0.0" }),
        ]),
      ),
    );
    using dir = project("pool-script-order", registry, {
      dependencies: {
        ...Object.fromEntries(hosts.map(name => [name, "1.0.0"])),
        ...Object.fromEntries(nested.map(name => [name, "npm:root-filler@2.0.0"])),
      },
      trustedDependencies: scripted,
    });
    const root = String(dir);
    const env = {
      ...installEnv,
      PROJECT: root,
      LAST_BIN: join(root, "node_modules", hosts.at(-1)!, "node_modules", ".bin", "tool"),
    };

    await warmUp(root, ["--ignore-scripts"]);
    const order = async (prefix: string[]) => {
      rmSync(join(root, "node_modules"), { recursive: true });
      rmSync(join(root, "order"), { force: true });
      const { stderr, exitCode } = await spawned([...prefix, bunExe(), "install", "--concurrent-scripts=1"], root, env);
      expect(stderr).not.toContain("error");
      expect(exitCode).toBe(0);
      return readFileSync(join(root, "order"), "utf8").trim().split("\n");
    };
    const inTurn = await order(["sh", "-c", 'ulimit -n 200 && exec "$0" "$@"']);
    expect(inTurn.toSorted()).toEqual(hosts.flatMap(host => scripted.map(name => `${host}/node_modules/${name}`)));
    expect(await order([])).toEqual(inTurn);
  });

  // `scripted` sits below `a-host`, and its scripts start when that tree is done. `held-1` and
  // `lifecycle scripts keep running while the thread pool links` sit two levels below `b-host`, and are linked after that. Their links wait for the
  // second script, which bun starts when it has seen the first one end, which waits for the links.
  test.concurrent.skipIf(!shimDir)("lifecycle scripts keep running while the thread pool links", async () => {
    const scripts = {
      install: `until [ -e "$STAGING_TEST_HOLD/holding" ]; do :; done`,
      postinstall: `: > "$STAGING_TEST_HOLD/released"`,
    };
    const publish = async (name: string, more: Omit<RegistryPackage, "tgz"> & { files?: string[] } = {}) => [
      name,
      { ...more, tgz: await pack(name, more) },
    ];
    using registry = serveRegistry(
      Object.fromEntries(
        await Promise.all([
          publish("a-host", { dependencies: { scripted: "1.0.0" } }),
          publish("b-host", {
            dependencies: { inner: "1.0.0", "held-1": "npm:filler@3.0.0", "held-2": "npm:filler@3.0.0" },
          }),
          publish("inner", { dependencies: { "held-1": "1.0.0", "held-2": "1.0.0" } }),
          publish("scripted", { scripts }),
          publish("held-1", { files: ["held.js"] }),
          publish("held-2", { files: ["held.js"] }),
          publish("root-filler", { version: "2.0.0" }),
          publish("filler", { version: "3.0.0" }),
        ]),
      ),
    );
    using dir = project("pool-scripts", registry, {
      dependencies: {
        "a-host": "1.0.0",
        "b-host": "1.0.0",
        ...Object.fromEntries(["scripted", "inner", "held-1", "held-2"].map(name => [name, "npm:root-filler@2.0.0"])),
      },
      trustedDependencies: ["scripted"],
    });
    const root = String(dir);
    const deepest = join(root, "node_modules", "b-host", "node_modules", "inner", "node_modules");

    await warmUp(root, ["--ignore-scripts"]);
    expect(readdirSync(deepest).sort()).toEqual(["held-1", "held-2"]);
    expect(readdirSync(join(root, "node_modules", "a-host", "node_modules"))).toEqual(["scripted"]);
    rmSync(join(root, "node_modules"), { recursive: true });
    mkdirSync(join(root, "markers"));

    const { stderr, exitCode } = await install(root, [], {
      ...preloadEnv(),
      STAGING_TEST_HOLD: join(root, "markers"),
    });
    expect(stderr).not.toContain("error");
    expect(readdirSync(join(root, "markers")).sort()).toEqual(["holding", "released"]);
    expect(readdirSync(deepest).sort()).toEqual(["held-1", "held-2"]);
    expect(exitCode).toBe(0);
  });
});

// A failed lifecycle script ends the install. bun deletes the package so that the next install
// links it and runs its scripts again. Here the delete fails at the first .js file it reaches.
describe.skipIf(!shimDir)("after a failed script, a package that cannot be fully deleted", () => {
  const commit = "1234567890abcdef1234567890abcdef12345678";
  const scripts = { postinstall: `echo ran >> "$RUNS" && test -z "$FAIL"` };
  const packed: Record<string, string> = {
    "package.json": JSON.stringify({ name: "scripted", version: "1.0.0", scripts }),
    ...Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`f${i}.js`, `module.exports = ${i};\n`])),
  };
  const patch = `diff --git a/f0.js b/f0.js
--- a/f0.js
+++ b/f0.js
@@ -1 +1 @@
-module.exports = 0;
+module.exports = "patched";
`;
  const sources = {
    tarball: (registry: string) => ({ dependencies: { scripted: `${registry}scripted-1.0.0.tgz` } }),
    github: () => ({ dependencies: { scripted: `owner/scripted#${commit}` } }),
    patched: () => ({
      dependencies: { scripted: "1.0.0" },
      patchedDependencies: { "scripted@1.0.0": "scripted.patch" },
    }),
  };
  const cases = (["hoisted", "isolated"] as const).flatMap(linker =>
    (["tarball", "github", "patched"] as const).flatMap(source =>
      [true, false].map(movesAside => ({
        linker,
        source,
        movesAside,
        how: movesAside ? "renamed first" : "the rename fails",
      })),
    ),
  );

  test.concurrent.each(cases)(
    "$linker, $source, $how: the next install links it and runs the script again",
    async ({ linker, source, movesAside }) => {
      const tgz = await new Bun.Archive(
        Object.fromEntries(Object.entries(packed).map(([path, contents]) => [`package/${path}`, contents])),
        { compress: "gzip" },
      ).bytes();
      const repository = await githubTarball(`owner-scripted-${commit.slice(0, 7)}`, packed);
      using registry = serveRegistry({ scripted: { tgz, scripts } });
      using github = Bun.serve({ port: 0, fetch: () => new Response(repository) });
      using dir = tempDir(`failed-script-${linker}-${source}`, {
        "package.json": JSON.stringify({
          name: "app",
          trustedDependencies: ["scripted"],
          ...sources[source](registry.url.href),
        }),
        "scripted.patch": patch,
        "bunfig.toml": ({ root }) =>
          Bun.TOML.stringify({ install: { registry: registry.url.href, cache: join(root, ".bun-cache"), linker } }),
      });
      const root = String(dir);
      const nodeModules = join(root, "node_modules");
      const env = { GITHUB_API_URL: github.url.origin, RUNS: join(root, "runs") };
      const movedAside = () => readdirSync(nodeModules).filter(name => name.startsWith(".old-"));

      // Leaves bun.lock and a warm cache.
      const warm = await install(root, ["--ignore-scripts"], { ...installEnv, ...env });
      expect(warm.stderr).not.toContain("error");
      expect(warm.exitCode).toBe(0);
      rmSync(nodeModules, { recursive: true });

      const failing = await install(root, [], {
        ...shimEnv({ syscall: "unlinkat", after: 0 }, false),
        ...env,
        FAIL: "1",
        STAGING_TEST_NOTHING_MOVES_ASIDE: movesAside ? undefined : "1",
      });
      expect(failing.stderr).toContain('postinstall script from "scripted" exited with 1');
      expect(failing.exitCode).toBe(1);
      rmSync(env.RUNS);

      const repaired = await install(root, [], { ...installEnv, ...env });
      expect(repaired.stderr).not.toContain("error");
      const installed = realpathSync(join(nodeModules, "scripted"));
      expect({
        runs: existsSync(env.RUNS) ? readFileSync(env.RUNS, "utf8") : "",
        missing: Object.keys(packed).filter(name => !existsSync(join(installed, name))),
        f0: readFileSync(join(installed, "f0.js"), "utf8"),
      }).toEqual({
        runs: "ran\n",
        missing: [],
        f0: source === "patched" ? 'module.exports = "patched";\n' : packed["f0.js"],
      });
      expect(repaired.exitCode).toBe(0);

      // With the isolated linker, the next install deletes the leftovers. With the hoisted linker, they stay until `bun
      // prune`.
      if (linker === "isolated") expect(readdirSync(join(installed, ".."))).toEqual(["scripted"]);
      expect(movedAside()).toHaveLength(linker === "hoisted" && movesAside ? 1 : 0);
      const prune = await bun(root, ["prune"], { ...installEnv, ...env });
      expect(prune.stderr).not.toContain("error");
      expect(movedAside()).toEqual([]);
      expect(prune.exitCode).toBe(0);
    },
  );
});
