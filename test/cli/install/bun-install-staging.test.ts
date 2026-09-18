// Packages are linked out of the cache into a staging directory that is renamed
// onto the package's final path once complete. An install killed while linking
// must not leave a partial copy at the final path: both linkers treat an
// installed package.json as "this package is installed", so a truncated
// directory that already received its package.json would be reported as up to
// date by every later `bun install`. The rename must also cope with the final
// path being occupied already, which the hoisted linker does to itself.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMusl, isWindows, tempDir } from "harness";
import { existsSync, readdirSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";

// Enough files that the kill below lands long before linking finishes, even
// when the test process is slow to notice that linking has started.
const DIR_COUNT = 32;
const FILES_PER_DIR = 64;

// package.json is the last member (Bun.Archive keeps insertion order), the
// opposite of `npm pack`: the cache entry is linked in directory order, and a
// filesystem that lists newest first (tmpfs) then links package.json first,
// which is the order an in-place link needs to leave an accepted partial copy.
const archiveEntries: Record<string, string> = {};
for (let dir = 0; dir < DIR_COUNT; dir++) {
  for (let file = 0; file < FILES_PER_DIR; file++) {
    archiveEntries[`package/d${dir}/f${file}.js`] = `module.exports = ${dir * FILES_PER_DIR + file};\n`;
  }
}
archiveEntries["package/package.json"] = JSON.stringify({ name: "many-files", version: "1.0.0" });

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
  // The tarball is not sent before this resolves.
  release?: Promise<void>;
};

// Every package is published as version 1.0.0.
function serveRegistry(packages: Record<string, RegistryPackage>) {
  return Bun.serve({
    port: 0,
    async fetch(request) {
      const { origin, pathname } = new URL(request.url);
      const name = pathname.slice(1).replace(/-1\.0\.0\.tgz$/, "");
      const pkg = packages[name];
      if (!pkg) return new Response("not found", { status: 404 });
      if (pathname.endsWith(".tgz")) {
        await pkg.release;
        return new Response(pkg.tgz);
      }
      return Response.json({
        name,
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": { name, version: "1.0.0", scripts: pkg.scripts, dist: { tarball: `${origin}/${name}-1.0.0.tgz` } },
        },
      });
    },
  });
}

async function install(cwd: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const isStagingDir = (name: string) => name.startsWith(".bun-tmp-");
const hasStagingDir = (dir: string) => existsSync(dir) && readdirSync(dir).some(isStagingDir);
// The staging directory of an install that was killed stays behind: its name is
// unique to that process, so that two installs at once never share one.
const withoutStagingDirs = (dir: string) => readdirSync(dir).filter(name => !isStagingDir(name));

// Kills `bun install` once `underWay()` holds. Returns false if it finished first.
async function installAndKill(cwd: string, args: string[], underWay: () => boolean) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", ...args],
    cwd,
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });
  let exited = false;
  proc.exited.then(() => (exited = true));
  let killed = false;
  while (!exited && !killed) {
    if (underWay()) {
      proc.kill("SIGKILL");
      killed = true;
    } else {
      await Bun.sleep(0);
    }
  }
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
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

// Not concurrent: the kill has to land while the package is still being
// linked, which a poll loop sharing the event loop with another test's
// assertions cannot guarantee.
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

    // The package, or the staging directory it is linked into, shows up: its files are
    // being linked. A starved poll loop can miss the whole install, which proves nothing,
    // so that attempt is repeated.
    const linking = () => existsSync(installed) || hasStagingDir(installedParent);
    let killed = false;
    for (let attempt = 0; attempt < 5 && !killed; attempt++) {
      rmSync(join(root, "node_modules"), { recursive: true });
      killed = await installAndKill(root, [], linking);
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
    expect(withoutStagingDirs(installedParent).sort()).toEqual(finishedParentListing);
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

  // One file per directory: whichever directory goes first, the replacement is noticed.
  const sentinels = Array.from({ length: DIR_COUNT }, (_, dir) => join(installed, `d${dir}`, "f0.js"));
  const replacing = () => hasStagingDir(installedParent) || !sentinels.every(file => existsSync(file));

  let killed = false;
  for (let attempt = 0; attempt < 5 && !killed; attempt++) {
    const complete = await install(root);
    expect(complete.stderr).not.toContain("error");
    expect(complete.exitCode).toBe(0);
    expect(compareWithExpectedTree(installed)).toEqual(completeTree);
    killed = await installAndKill(root, ["--force"], replacing);
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
  expect(withoutStagingDirs(installedParent)).toEqual(["many-files"]);
});

// https://github.com/oven-sh/bun/issues/43256: bun exits as soon as a lifecycle
// script fails, while the isolated linker's tasks for other packages are still
// linking on other threads. (The hoisted linker links on the thread that would
// exit, so it cannot be caught midway like this.) With a lockfile and a cold
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

    {
      await using lockfileOnly = Bun.spawn({
        cmd: [bunExe(), "install", "--lockfile-only"],
        cwd: root,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([
        lockfileOnly.stdout.text(),
        lockfileOnly.stderr.text(),
        lockfileOnly.exited,
      ]);
      expect(stderr).not.toContain("error");
      expect(exitCode).toBe(0);
    }

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
          ...bunEnv,
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

    // What the reporter did next: take the trust away and install again.
    writeFileSync(join(root, "package.json"), JSON.stringify(rootPackageJson));
    const second = await install(root);
    expect(second.stderr).not.toContain("error");
    expect(second.exitCode).toBe(0);
    expect(compareWithExpectedTree(installed)).toEqual(completeTree);
    expect(withoutStagingDirs(installedParent)).toEqual(["many-files"]);
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
  test(`${linker} linker: a package reached through two workspace aliases is installed under both`, async () => {
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
  });
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
test.skipIf(isWindows)(
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

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: root,
      env: {
        ...bunEnv,
        STAGING_TEST_MARKERS: join(root, "markers"),
        STAGING_TEST_DEP_DIR: join(root, "packages", "inner", "node_modules", "dep"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("error");
    expect(exitCode).toBe(0);
    expect(readdirSync(join(root, "markers")).sort()).toEqual([".keep", "first", "second"]);
  },
);

// An alias may already be as long as a file name can be, so the staging
// directory's name cannot be derived from it by adding to it.
for (const linker of ["hoisted", "isolated"]) {
  test(`${linker} linker: a package whose alias is 255 characters long is installed`, async () => {
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

// When linking fails midway (a full disk), bun sees the error itself instead of
// being killed, and the failure path must not leave a partial copy at the final
// path or a staging directory behind either. linkat() is failed with ENOSPC by
// an LD_PRELOAD shim after some files went through, so this needs Linux, a
// dynamically linked bun (not musl) and a C compiler.
const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

const failingLinkatShim = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdlib.h>

static int calls;

int linkat(int olddirfd, const char *oldpath, int newdirfd, const char *newpath, int flags) {
  static int (*real_linkat)(int, const char *, int, const char *, int);
  if (!real_linkat) real_linkat = dlsym(RTLD_NEXT, "linkat");
  const char *limit = getenv("FAIL_LINKAT_AFTER");
  if (limit && ++calls > atoi(limit)) {
    errno = ENOSPC;
    return -1;
  }
  return real_linkat(olddirfd, oldpath, newdirfd, newpath, flags);
}
`;

describe.skipIf(!isLinux || isMusl || !cc)("a link that runs out of space midway", () => {
  for (const [linker, packageDir] of Object.entries(packageDirs)) {
    test(`${linker} linker: leaves nothing at the package's path and the next install succeeds`, async () => {
      const tgz = await new Bun.Archive(archiveEntries, { compress: "gzip" }).bytes();
      using registry = serveRegistry({ "many-files": { tgz } });
      using dir = tempDir(`staging-enospc-${linker}`, {
        "shim.c": failingLinkatShim,
        "package.json": JSON.stringify({ name: "app", dependencies: { "many-files": "1.0.0" } }),
        "bunfig.toml": ({ root }) =>
          Bun.TOML.stringify({ install: { registry: registry.url.href, cache: join(root, ".bun-cache"), linker } }),
      });
      const root = String(dir);
      const installed = packageDir(root);
      const installedParent = join(installed, "..");

      {
        await using compile = Bun.spawn({
          cmd: [cc!, "-shared", "-fPIC", "-o", "shim.so", "shim.c", "-ldl"],
          cwd: root,
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [out, err, exitCode] = await Promise.all([compile.stdout.text(), compile.stderr.text(), compile.exited]);
        if (exitCode !== 0) throw new Error(`shim compile failed: ${out}${err}`);
      }

      // Warm the cache so the next install only links.
      const warm = await install(root);
      expect(warm.stderr).not.toContain("error");
      expect(warm.exitCode).toBe(0);
      rmSync(join(root, "node_modules"), { recursive: true });

      await using failing = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: root,
        // No PATH: a debug build that finds llvm-symbolizer there spends seconds on a stack
        // trace when the hoisted linker fails. Nothing in this install looks anything up.
        env: { ...bunEnv, PATH: "", LD_PRELOAD: join(root, "shim.so"), FAIL_LINKAT_AFTER: "300" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, failingStderr, failingExitCode] = await Promise.all([
        failing.stdout.text(),
        failing.stderr.text(),
        failing.exited,
      ]);
      expect(failingStderr).toContain("ENOSPC");
      expect(failingExitCode).toBe(1);
      expect({
        installed: existsSync(installed),
        leftInParent: existsSync(installedParent) ? readdirSync(installedParent) : [],
      }).toEqual({ installed: false, leftInParent: [] });

      const repaired = await install(root);
      expect(repaired.stderr).not.toContain("error");
      expect(repaired.exitCode).toBe(0);
      expect(compareWithExpectedTree(installed)).toEqual(completeTree);
    });
  }
});
