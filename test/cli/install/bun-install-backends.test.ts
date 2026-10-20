// The hoisted install backends (PackageInstall.rs) walk the package and build
// each destination path, and for the symlink backend each link target, in a
// fixed size path buffer. An entry that does not fit has to fail the package
// install with ENAMETOOLONG instead of writing past the buffer, a directory the
// walker fails to create has to fail the install instead of being skipped while
// the install reports success, and a file that cannot be installed has to fail
// the package (as it does with the hardlink backend) rather than exit bun.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, isRoot, isWindows, readdirSorted, tempDir } from "harness";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

// PathBuffer is PATH_MAX bytes on POSIX (4096 on Linux, 1024 on macOS); the
// Windows backends build wide paths in a 32767 unit WPathBuffer.
const PATH_BUFFER_LEN = isWindows ? 32767 : isMacOS ? 1024 : 4096;
const DIR_NAME_LEN = 100;

const EXPECTED_FAILURE = "ENAMETOOLONG: failed copying files from cache to destination for package pkg";

/**
 * Directory names (ASCII, so bytes == UTF-16 units == chars) whose joined
 * relative path is exactly `joinedLen` long. The last name is sized to make
 * the total exact.
 */
function deepDirs(joinedLen: number): string[] {
  const dirs = [Buffer.alloc(DIR_NAME_LEN, "d").toString()];
  let remaining = joinedLen - DIR_NAME_LEN;
  while (remaining > DIR_NAME_LEN + 1 + 8) {
    dirs.push(Buffer.alloc(DIR_NAME_LEN, "d").toString());
    remaining -= DIR_NAME_LEN + 1;
  }
  dirs.push(Buffer.alloc(remaining - 1, "e").toString());
  return dirs;
}

/**
 * Creates the chain of nested directories `dirs` inside `packageDir` and puts
 * `leaves` (name -> file contents, or null for an empty directory) into the
 * deepest one.
 *
 * The chain is about as long as the path buffer, so it cannot be created with
 * absolute paths. Each chunk of the chain is built under a short staging path
 * and the chunks are nested from the deepest one up with rename(), so nothing
 * handed to the filesystem is longer than about half the buffer.
 */
function createDeepChain(
  stagingDir: string,
  packageDir: string,
  dirs: string[],
  leaves: Record<string, string | null>,
) {
  const chunks: string[][] = [[]];
  for (const dir of dirs) {
    const chunk = chunks[chunks.length - 1];
    if (join(...chunk, dir).length > PATH_BUFFER_LEN / 2) {
      chunks.push([dir]);
    } else {
      chunk.push(dir);
    }
  }

  // Staging location and name of the part assembled so far; it gets moved
  // under the deepest directory of the next (shallower) chunk.
  let assembled: { path: string; name: string } | undefined;
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i];
    const chunkStaging = join(stagingDir, String(i));
    const deepest = join(chunkStaging, ...chunk);
    mkdirSync(deepest, { recursive: true });
    if (i === chunks.length - 1) {
      for (const [name, contents] of Object.entries(leaves)) {
        if (contents === null) mkdirSync(join(deepest, name));
        else writeFileSync(join(deepest, name), contents);
      }
    }
    if (assembled !== undefined) {
      renameSync(assembled.path, join(deepest, assembled.name));
    }
    assembled = { path: join(chunkStaging, chunk[0]), name: chunk[0] };
  }
  renameSync(assembled!.path, join(packageDir, assembled!.name));
}

/**
 * Entries whose relative path lengths run from `center - spread` to
 * `center + spread`. Their names share a prefix and grow by one unit each, so
 * directory enumeration (NTFS returns names sorted) yields the shortest first,
 * and the one that lands exactly on `center` is reached before any longer one.
 * Also returns the joined length the directory chain above them needs to have.
 */
function fanOfLeaves(center: number, spread: number, contents: string | null) {
  const shortestName = 16;
  const leaves: Record<string, string | null> = {};
  for (let i = 0; i <= 2 * spread; i++) {
    leaves[Buffer.alloc(shortestName + i, "f").toString()] = contents;
  }
  // The middle leaf (name length shortestName + spread) lands on `center`.
  return { leaves, dirsLen: center - 1 - shortestName - spread };
}

// Root ignores directory permissions. When the tests run as root on Linux the
// install that depends on them runs as `nobody` instead (like
// test/cli/run/env.test.ts does); the test is skipped as root elsewhere.
const canRunAsNobody = (() => {
  if (!isLinux || !Bun.which("runuser")) return false;
  try {
    return /^nobody:/m.test(readFileSync("/etc/passwd", "utf8"));
  } catch {
    return false;
  }
})();
const canInstallWithoutPrivileges = !isRoot || canRunAsNobody;

async function install(
  projectDir: string,
  backend?: string | null,
  { unprivileged = false, cacheDir = join(projectDir, ".cache"), args = [] as string[] } = {},
) {
  const bun = [bunExe(), "install", "--linker=hoisted", ...(backend ? [`--backend=${backend}`] : []), ...args];
  await using proc = Bun.spawn({
    cmd: unprivileged && isRoot ? ["runuser", "-u", "nobody", "--", ...bun] : bun,
    cwd: projectDir,
    env: {
      ...bunEnv,
      BUN_INSTALL_CACHE_DIR: cacheDir,
      ...(unprivileged ? { HOME: projectDir } : {}),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const packageFiles = {
  "package.json": JSON.stringify({ name: "pkg", version: "1.0.0" }),
  "index.js": "module.exports = 1;",
};

/** A project depending on `pkg` inside it (`file:./pkg`). */
function projectWithLocalPackage(name: string) {
  const dir = tempDir(name, {
    "package.json": JSON.stringify({ name: "app", dependencies: { pkg: "file:./pkg" } }),
    "pkg/package.json": packageFiles["package.json"],
    "pkg/index.js": packageFiles["index.js"],
  });
  return { dir, projectDir: String(dir), packageDir: join(String(dir), "pkg") };
}

describe.skipIf(isWindows)("install backends on POSIX", () => {
  // The copyfile backend only materializes files (parents are created on
  // demand), the others also create the package's directories.
  const directoryBackends = ["hardlink", "symlink", ...(isMacOS ? ["clonefile_each_dir"] : [])];
  const backends = [...directoryBackends, "copyfile"];

  for (const backend of backends) {
    test.concurrent(`${backend} backend reports a file whose relative path exceeds PATH_MAX`, async () => {
      const { dir, projectDir, packageDir } = projectWithLocalPackage(`deep-file-${backend}`);
      using _ = dir;
      using staging = tempDir(`deep-file-${backend}-staging`, {});
      // The directories all fit, so the file is the entry that fails.
      createDeepChain(String(staging), packageDir, deepDirs(PATH_BUFFER_LEN - DIR_NAME_LEN), {
        [Buffer.alloc(2 * DIR_NAME_LEN, "f").toString()]: "module.exports = 2;",
      });

      const { stdout, stderr, exitCode } = await install(projectDir, backend);
      expect(stderr).toContain(EXPECTED_FAILURE);
      expect(stdout).toContain("Failed to install 1 package");
      expect(exitCode).toBe(1);
    });

    test.concurrent(`${backend} backend still installs nested directories that fit`, async () => {
      const { dir, projectDir, packageDir } = projectWithLocalPackage(`nested-${backend}`);
      using _ = dir;
      mkdirSync(join(packageDir, "a", "b", "c"), { recursive: true });
      writeFileSync(join(packageDir, "a", "b", "c", "leaf.js"), "module.exports = 3;");
      mkdirSync(join(packageDir, "empty"));

      const { stdout, stderr, exitCode } = await install(projectDir, backend);
      expect(stderr).not.toContain("error");
      expect(stdout).toContain("1 package installed");
      expect(exitCode).toBe(0);
      const installed = join(projectDir, "node_modules", "pkg");
      expect(existsSync(join(installed, "a", "b", "c", "leaf.js"))).toBe(true);
      expect(existsSync(join(installed, "empty"))).toBe(directoryBackends.includes(backend));
    });
  }

  test.concurrent("symlink backend reports a link target longer than PATH_MAX", async () => {
    const { dir, projectDir, packageDir } = projectWithLocalPackage("long-target");
    using _ = dir;
    using staging = tempDir("long-target-staging", {});
    // The path relative to the package fits in PATH_MAX on its own; joined to
    // the absolute package directory (the link target) it does not.
    const leaf = "leaf.js";
    createDeepChain(String(staging), packageDir, deepDirs(PATH_BUFFER_LEN - 1 - 1 - leaf.length), {
      [leaf]: "module.exports = 2;",
    });

    const { stdout, stderr, exitCode } = await install(projectDir, "symlink");
    expect(stderr).toContain(EXPECTED_FAILURE);
    expect(stdout).toContain("Failed to install 1 package");
    expect(exitCode).toBe(1);
  });

  for (const backend of directoryBackends) {
    test.concurrent(`${backend} backend reports a directory it could not create`, async () => {
      const { dir, projectDir, packageDir } = projectWithLocalPackage(`deep-dir-${backend}`);
      using _ = dir;
      using staging = tempDir(`deep-dir-${backend}-staging`, {});
      // Only directories, so failing to create one is the only thing that
      // can fail the install.
      createDeepChain(String(staging), packageDir, deepDirs(PATH_BUFFER_LEN + DIR_NAME_LEN), {});

      const { stdout, stderr, exitCode } = await install(projectDir, backend);
      expect(stderr).toContain(EXPECTED_FAILURE);
      expect(stdout).toContain("Failed to install 1 package");
      expect(exitCode).toBe(1);
    });
  }

  // When the previous install cannot be renamed away (node_modules itself is
  // read-only here), the symlink backend replaces each existing file. The
  // replacement used to point at the file's own basename, i.e. at itself.
  test.concurrent.skipIf(!canInstallWithoutPrivileges)(
    "symlink backend replaces an existing file with a link to the source",
    async () => {
      const { dir, projectDir, packageDir } = projectWithLocalPackage("replace-symlink");
      using _ = dir;
      const installed = join(projectDir, "node_modules", "pkg");
      mkdirSync(installed, { recursive: true });
      writeFileSync(join(installed, "index.js"), "stale");
      writeFileSync(join(installed, "not-in-the-package"), "");
      // `nobody` can read it too, and can write where Bun writes.
      chmodSync(projectDir, 0o777);
      chmodSync(packageDir, 0o755);
      for (const file of Object.keys(packageFiles)) chmodSync(join(packageDir, file), 0o644);
      chmodSync(installed, 0o777);
      chmodSync(join(projectDir, "node_modules"), 0o555);
      try {
        const { stdout, stderr, exitCode } = await install(projectDir, "symlink", { unprivileged: true });
        expect(stderr).not.toContain("error");
        expect(stdout).toContain("1 package installed");
        expect(exitCode).toBe(0);
      } finally {
        chmodSync(join(projectDir, "node_modules"), 0o755);
      }
      // The old directory was indeed installed into rather than replaced.
      expect(existsSync(join(installed, "not-in-the-package"))).toBe(true);
      expect(readlinkSync(join(installed, "index.js"))).toBe(join(realpathSync.native(packageDir), "index.js"));
      expect(readFileSync(join(installed, "index.js"), "utf8")).toBe(packageFiles["index.js"]);
    },
  );
});

describe.skipIf(!isWindows)("install backends on Windows", () => {
  /**
   * Relative length of an entry whose destination path exactly fills the
   * buffer, which used to put the NUL terminator one unit past it. The walkers
   * prefix every entry with the final path of node_modules (which
   * GetFinalPathNameByHandle reports in \\?\ form), the package name and
   * separators.
   */
  function overflowingEntryLength(projectDir: string) {
    return PATH_BUFFER_LEN - ("\\\\?\\" + realpathSync.native(projectDir) + "\\node_modules\\pkg\\").length;
  }

  // The fan also covers the prefix length being off by a unit or two; every
  // source path still stays within what the OS (and the cleanup) can address,
  // because the source prefix is shorter than the destination prefix.
  const SPREAD = 3;

  // The hardlink walker skips directories and collects link failures from its
  // worker threads, so the length check is the only thing that can stop the
  // walk before it reaches the overflowing entry.
  test.concurrent("hardlink backend reports a file whose destination exactly fills the path buffer", async () => {
    const { dir, projectDir, packageDir } = projectWithLocalPackage("exact-hardlink");
    using _ = dir;
    using staging = tempDir("exact-hardlink-staging", {});
    const { leaves, dirsLen } = fanOfLeaves(overflowingEntryLength(projectDir), SPREAD, "module.exports = 2;");
    createDeepChain(String(staging), packageDir, deepDirs(dirsLen), leaves);

    const { stdout, stderr, exitCode } = await install(projectDir, "hardlink");
    expect(stderr).toContain(EXPECTED_FAILURE);
    expect(stdout).toContain("Failed to install 1 package");
    expect(exitCode).toBe(1);
  });

  /**
   * Runs the install while a file inside `node_modules/pkg/<leftoverDir>` is
   * held open. A previous install of the package then cannot be moved out of
   * the way, so the walker runs into the existing directory.
   */
  async function installOverLeftover(projectDir: string, leftoverDir: string) {
    const leftover = join(projectDir, "node_modules", "pkg", leftoverDir);
    mkdirSync(leftover, { recursive: true });
    writeFileSync(join(leftover, "held-open.txt"), "");
    const held = openSync(join(leftover, "held-open.txt"), "r");
    try {
      return await install(projectDir, "copyfile");
    } finally {
      closeSync(held);
    }
  }

  // The copyfile and the symlink backend share one walk. It creates directories
  // as it goes, and the OS rejects destinations this long a little before they
  // stop fitting the buffer, so the directory that could not be created is what
  // fails the install. That failure used to be ignored, a fallback created the
  // chain under the cwd, and the walk went on to overflow.
  test.concurrent("copyfile walker reports a directory it could not create", async () => {
    const { dir, projectDir, packageDir } = projectWithLocalPackage("exact-copyfile");
    using _ = dir;
    using staging = tempDir("exact-copyfile-staging", {});
    const { leaves, dirsLen } = fanOfLeaves(overflowingEntryLength(projectDir), SPREAD, null);
    const dirs = deepDirs(dirsLen);
    createDeepChain(String(staging), packageDir, dirs, leaves);

    const { stdout, stderr, exitCode } = await install(projectDir, "copyfile");
    expect(stderr).toContain(EXPECTED_FAILURE);
    expect(stdout).toContain("Failed to install 1 package");
    expect(exitCode).toBe(1);
    expect(existsSync(join(projectDir, dirs[0]))).toBe(false);
  });

  test.concurrent("copyfile walker installs into a leftover directory without creating it under the cwd", async () => {
    const { dir, projectDir, packageDir } = projectWithLocalPackage("leftover-copyfile");
    using _ = dir;
    mkdirSync(join(packageDir, "sub"));
    writeFileSync(join(packageDir, "sub", "inner.js"), "module.exports = 2;");

    const { stdout, exitCode } = await installOverLeftover(projectDir, "sub");
    expect(stdout).toContain("1 package installed");
    expect(exitCode).toBe(0);
    expect(existsSync(join(projectDir, "node_modules", "pkg", "sub", "inner.js"))).toBe(true);
    expect(existsSync(join(projectDir, "sub"))).toBe(false);
  });

  // The package's `sub/entry` is a file, but the leftover has a directory
  // there. The copyfile walker used to exit the process at this point.
  test.concurrent("copyfile walker reports a file it could not install into a leftover directory", async () => {
    const { dir, projectDir, packageDir } = projectWithLocalPackage("conflict-copyfile");
    using _ = dir;
    mkdirSync(join(packageDir, "sub"));
    writeFileSync(join(packageDir, "sub", "entry"), "module.exports = 2;");

    const { stdout, exitCode } = await installOverLeftover(projectDir, join("sub", "entry"));
    expect(stdout).toContain("Failed to install 1 package");
    expect(exitCode).toBe(1);
    expect(existsSync(join(projectDir, "sub"))).toBe(false);
  });
});

// One rule for both linkers: a `file:` folder, wherever it is, is installed as real files (hard
// links, or copies where the folder cannot be linked), without its `node_modules`.
describe("file: folder dependencies with the hoisted linker", () => {
  // `--no-install`: a module that fails to resolve must not be fetched from the registry.
  async function run(projectDir: string, code: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--no-install", "-e", code],
      cwd: projectDir,
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    const [err, out, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
    expect(err).toBe("");
    expect(exitCode).toBe(0);
    return out.trim();
  }

  async function freshInstall(projectDir: string, cacheDir: string, args: string[]) {
    rmSync(join(projectDir, "node_modules"), { recursive: true, force: true });
    const { stdout, stderr, exitCode } = await install(projectDir, null, { cacheDir, args });
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    return stdout;
  }

  // A module resolves `require()` from the realpath of its file. Behind one symlink per file
  // that is a path outside the project, from where the project's node_modules is not found.
  test.concurrent(
    "a folder outside the project resolves its dependencies from the project's node_modules",
    async () => {
      using dir = tempDir("folder-dep-outside", {
        "plugin/package.json": JSON.stringify({
          name: "plugin",
          version: "1.0.0",
          main: "index.js",
          // `tool` is hoisted to the project's node_modules. `helper` is a folder
          // dependency, so it is nested under node_modules/plugin/node_modules.
          dependencies: { tool: "file:./tool.tgz", helper: "file:../project/vendor/helper" },
        }),
        "plugin/index.js": `
        const tool = require("tool/package.json");
        module.exports = tool.name + "@" + tool.version + " " + require("helper");
      `,
        "plugin/tool.tgz": readFileSync(join(import.meta.dir, "bar-0.0.2.tgz")),
        "project/package.json": JSON.stringify({
          name: "my-app",
          version: "1.0.0",
          dependencies: { plugin: "file:../plugin" },
        }),
        "project/vendor/helper/package.json": JSON.stringify({ name: "helper", version: "1.0.0", main: "index.js" }),
        "project/vendor/helper/index.js": `module.exports = "helper";`,
      });
      const projectDir = join(String(dir), "project");

      for (const args of [[], ["--frozen-lockfile"]]) {
        const out = await freshInstall(projectDir, join(String(dir), ".bun-cache"), args);
        expect(out).toContain("3 packages installed");

        expect(await run(projectDir, `console.log(require("plugin"))`)).toBe("bar@0.0.2 helper");

        const pluginDir = join(projectDir, "node_modules", "plugin");
        expect(lstatSync(join(pluginDir, "index.js")).isSymbolicLink()).toBe(false);
        expect(await readdirSorted(pluginDir)).toEqual(["index.js", "node_modules", "package.json", "tool.tgz"]);
        expect(await readdirSorted(join(pluginDir, "node_modules"))).toEqual(["helper"]);
        expect(existsSync(join(projectDir, "node_modules", "tool", "package.json"))).toBe(true);
        // Nothing is written into the folder that the dependency was installed from.
        expect(await readdirSorted(join(String(dir), "plugin"))).toEqual(["index.js", "package.json", "tool.tgz"]);
      }
    },
  );

  test.concurrent("a transitive folder resolves the other transitive folders next to it", async () => {
    // `b` and `c` are installed nested under node_modules/a/node_modules.
    using dir = tempDir("transitive-file-dep-siblings", {
      "package.json": JSON.stringify({
        name: "my-app",
        version: "1.0.0",
        dependencies: { a: "file:./packages/a" },
      }),
      "packages/a/package.json": JSON.stringify({
        name: "a",
        version: "1.0.0",
        dependencies: { b: "file:../b", c: "file:../c" },
      }),
      "packages/a/index.js": `module.exports = "a->" + require("b");`,
      "packages/b/package.json": JSON.stringify({ name: "b", version: "1.0.0" }),
      "packages/b/index.js": `module.exports = "b->" + require("c");`,
      "packages/c/package.json": JSON.stringify({ name: "c", version: "1.0.0" }),
      "packages/c/index.js": `module.exports = "c";`,
    });
    const projectDir = String(dir);

    for (const args of [[], ["--frozen-lockfile"]]) {
      const out = await freshInstall(projectDir, join(projectDir, ".bun-cache"), args);
      expect(out).toContain("3 packages installed");
      expect(await readdirSorted(join(projectDir, "node_modules", "a", "node_modules"))).toEqual(["b", "c"]);
      expect(await run(projectDir, `console.log(require("a"))`)).toBe("a->b->c");
    }
  });

  test.concurrent("a transitive folder outside the project, supplied by a root override", async () => {
    // `shared` is nested under node_modules/pkg-a/node_modules. It requires
    // `dep`, which only the project's node_modules has.
    using dir = tempDir("folder-dep-outside-nested", {
      "shared/package.json": JSON.stringify({ name: "shared", version: "1.0.0", main: "index.js" }),
      "shared/index.js": `module.exports = "shared->" + require("dep");`,
      "project/package.json": JSON.stringify({
        name: "my-app",
        version: "1.0.0",
        dependencies: { "pkg-a": "file:./pkg-a", dep: "file:./vendor/dep" },
        overrides: { shared: "file:../shared" },
      }),
      "project/pkg-a/package.json": JSON.stringify({
        name: "pkg-a",
        version: "1.0.0",
        main: "index.js",
        dependencies: { shared: "1.0.0" },
      }),
      "project/pkg-a/index.js": `module.exports = "pkg-a->" + require("shared");`,
      "project/vendor/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0", main: "index.js" }),
      "project/vendor/dep/index.js": `module.exports = "dep";`,
    });
    const projectDir = join(String(dir), "project");

    for (const args of [[], ["--frozen-lockfile"]]) {
      const out = await freshInstall(projectDir, join(String(dir), ".bun-cache"), args);
      expect(out).toContain("3 packages installed");

      expect(await run(projectDir, `console.log(require("pkg-a"))`)).toBe("pkg-a->shared->dep");

      const sharedDir = join(projectDir, "node_modules", "pkg-a", "node_modules", "shared");
      expect(await readdirSorted(sharedDir)).toEqual(["index.js", "package.json"]);
      expect(lstatSync(join(sharedDir, "index.js")).isSymbolicLink()).toBe(false);
      expect(await readdirSorted(join(String(dir), "shared"))).toEqual(["index.js", "package.json"]);
    }
  });

  for (const spec of ["file:../sibling", "file:./vendor/sibling"]) {
    test.concurrent(`the folder's own node_modules is not installed (${spec})`, async () => {
      const sibling = spec === "file:../sibling" ? "sibling" : "project/vendor/sibling";
      using dir = tempDir("folder-dep-own-node-modules", {
        [`${sibling}/package.json`]: JSON.stringify({ name: "sibling", version: "1.0.0" }),
        [`${sibling}/index.js`]: "module.exports = 1;",
        [`${sibling}/node_modules/left-behind/package.json`]: JSON.stringify({ name: "left-behind", version: "1.0.0" }),
        "project/package.json": JSON.stringify({ name: "my-app", version: "1.0.0", dependencies: { sibling: spec } }),
      });
      const projectDir = join(String(dir), "project");

      const out = await freshInstall(projectDir, join(String(dir), ".bun-cache"), []);
      expect(out).toContain("1 package installed");
      expect(await readdirSorted(join(projectDir, "node_modules", "sibling"))).toEqual(["index.js", "package.json"]);
    });
  }

  // The source contains the destination. Walking into its node_modules copied every installed
  // package into node_modules/poto itself, and the next install raced the deletion of that copy (ENOENT).
  for (const absolute of [false, true]) {
    test.concurrent(`a folder that contains the project (${absolute ? "absolute path" : "file:../"})`, async () => {
      using dir = tempDir("file-dep-ancestor", {
        "poto/package.json": JSON.stringify({ name: "poto", version: "1.0.0" }),
        "poto/index.js": "module.exports = 'poto';",
        "poto/sample/package.json": "{}",
      });
      const root = join(String(dir), "poto");
      const projectDir = join(root, "sample");
      writeFileSync(
        join(projectDir, "package.json"),
        JSON.stringify({
          name: "sample",
          version: "1.0.0",
          dependencies: { poto: absolute ? "file:" + root.replaceAll("\\", "/") : "file:../" },
        }),
      );

      let last = "";
      for (let i = 0; i < 3; i++) {
        const { stdout, stderr, exitCode } = await install(projectDir, null, { cacheDir: join(String(dir), "cache") });
        expect(stderr).not.toContain("ENOENT");
        expect(stdout).not.toContain("Failed to install");
        expect(exitCode).toBe(0);
        last = stdout;

        const installed = join(projectDir, "node_modules", "poto");
        expect(await readdirSorted(installed)).toEqual(["index.js", "package.json", "sample"]);
        expect(existsSync(join(installed, "sample", "node_modules"))).toBe(false);
      }
      // The second install picked up sample/bun.lock, which the first one wrote.
      expect(last).toContain("(no changes)");

      expect(await run(projectDir, "console.log(require('poto'))")).toBe("poto");
    });
  }

  for (const backend of [null, "hardlink", "copyfile"]) {
    test.concurrent(
      `a folder that contains the workspace member depending on it${backend ? ` (--backend ${backend})` : ""}`,
      async () => {
        // packages/ is itself a package ("x") and member packages/a depends on it
        // via `file:../`, while the root depends on a different "x", so the
        // member's copy cannot hoist and installs at node_modules/a/node_modules/x.
        // node_modules/a is a symlink to packages/a, so the destination physically
        // lives inside the source.
        using dir = tempDir("file-dep-ws-ancestor", {
          "package.json": JSON.stringify({
            name: "root",
            version: "1.0.0",
            workspaces: ["packages/*"],
            dependencies: { x: "file:./other-x" },
          }),
          "other-x/package.json": JSON.stringify({ name: "x", version: "2.0.0" }),
          "other-x/index.js": "module.exports = 'other-x';",
          "packages/package.json": JSON.stringify({ name: "x", version: "1.0.0" }),
          "packages/index.js": "module.exports = 'packages-x';",
          "packages/a/package.json": JSON.stringify({
            name: "a",
            version: "1.0.0",
            dependencies: { x: "file:../" },
          }),
        });

        for (let i = 0; i < 2; i++) {
          const { stdout, stderr, exitCode } = await install(String(dir), backend);
          expect(stderr).not.toContain("ENOENT");
          expect(stdout).not.toContain("Failed to install");
          expect(exitCode).toBe(0);

          const nested = join(String(dir), "node_modules", "a", "node_modules", "x");
          expect(JSON.parse(readFileSync(join(nested, "package.json"), "utf8"))).toEqual({
            name: "x",
            version: "1.0.0",
          });
          // Never a copy of the member's own node_modules.
          expect(existsSync(join(nested, "a", "node_modules"))).toBe(false);
        }
      },
    );
  }

  // The folder itself shows that it's installed: every file in node_modules is still a hard link to the file with the
  // same name, and neither side has a file that the other doesn't.
  describe("a folder that has not changed is not installed again", () => {
    function project(name: string, spec: string) {
      const source = spec === "file:../lib" ? "lib" : "project/vendor/lib";
      const dir = tempDir(name, {
        "project/package.json": JSON.stringify({ name: "my-app", version: "1.0.0", dependencies: { lib: spec } }),
        [`${source}/package.json`]: JSON.stringify({ name: "lib", version: "1.0.0" }),
        [`${source}/index.js`]: "module.exports = 'first';",
        [`${source}/dist/a.js`]: "module.exports = 'a';",
        [`${source}/dist/b.js`]: "module.exports = 'b';",
      });
      const projectDir = join(String(dir), "project");
      return {
        dir,
        projectDir,
        source: join(String(dir), source),
        installed: join(projectDir, "node_modules", "lib"),
        bunInstall: () => install(projectDir, null, { cacheDir: join(String(dir), "cache") }),
      };
    }

    for (const spec of ["file:../lib", "file:./vendor/lib"]) {
      test.concurrent(spec, async () => {
        const { dir, projectDir, source, installed, bunInstall } = project("folder-dep-warm", spec);
        using _ = dir;

        const first = await bunInstall();
        expect(first.stdout).toContain("1 package installed");
        expect(first.exitCode).toBe(0);
        expect(statSync(join(installed, "dist", "a.js")).ino).toBe(statSync(join(source, "dist", "a.js")).ino);

        const before = { dir: statSync(installed).ino, ctime: statSync(join(source, "index.js")).ctimeMs };
        const second = await bunInstall();
        expect(second.stderr).not.toContain("error:");
        expect(second.stdout).toContain("(no changes)");
        expect(second.exitCode).toBe(0);
        expect({ dir: statSync(installed).ino, ctime: statSync(join(source, "index.js")).ctimeMs }).toEqual(before);

        // Written in place: the hard link shows it without an install.
        writeFileSync(join(source, "index.js"), "module.exports = 'second';");
        expect(await run(projectDir, "console.log(require('lib'))")).toBe("second");
        expect((await bunInstall()).stdout).toContain("(no changes)");
      });

      for (const [change, apply, expected] of [
        [
          "a new file",
          (source: string) => writeFileSync(join(source, "dist", "c.js"), "module.exports = 'c';"),
          { names: ["a.js", "b.js", "c.js"], a: "module.exports = 'a';" },
        ],
        [
          "a deleted file",
          (source: string) => rmSync(join(source, "dist", "b.js")),
          { names: ["a.js"], a: "module.exports = 'a';" },
        ],
        [
          "a file replaced by rename",
          (source: string) => {
            writeFileSync(join(source, "dist", "a.js.tmp"), "module.exports = 'replaced';");
            renameSync(join(source, "dist", "a.js.tmp"), join(source, "dist", "a.js"));
          },
          { names: ["a.js", "b.js"], a: "module.exports = 'replaced';" },
        ],
      ] as const) {
        test.concurrent(`${spec}: ${change} is picked up by the next install`, async () => {
          const { dir, source, installed, bunInstall } = project("folder-dep-changed", spec);
          using _ = dir;

          expect((await bunInstall()).exitCode).toBe(0);
          apply(source);

          const { stdout, stderr, exitCode } = await bunInstall();
          expect(stderr).not.toContain("error:");
          expect(stdout).toContain("1 package installed");
          expect(exitCode).toBe(0);
          expect({
            names: await readdirSorted(join(installed, "dist")),
            a: readFileSync(join(installed, "dist", "a.js"), "utf8"),
          }).toEqual(expected);

          expect((await bunInstall()).stdout).toContain("(no changes)");
        });
      }
    }
  });
});
