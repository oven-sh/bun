// Something else can remove a directory after bun opened it and before bun read
// it to the end: a second command on the same tree, a temp cleaner. Linux then
// answers getdents64(2) with ENOENT. libc's readdir(3) reports that as the end
// of the directory, and so do bun's directory iterators. `removedDirReaddir`
// (harness) preloads a shim that plays the remover from inside getdents64, so
// no test here has a race. Its trace has every listing in order, which says
// which reader met the removal.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, removedDirReaddir, tempDir } from "harness";
import { existsSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";

async function run(cmd: string[], cwd: string, env: NodeJS.Dict<string>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

/** The shim, and an install cache inside `dir`. */
const installEnv = (dir: string, log: string): NodeJS.Dict<string> => ({
  ...removedDirReaddir.env(log),
  BUN_INSTALL_CACHE_DIR: join(dir, "cache"),
});

/**
 * The shim, and every directory that `bun pm cache rm` can reach inside `side`:
 * the install cache is `side/bun-install/install/cache`, and the temp directory
 * that the command sweeps for bunx trees is `side/tmp`.
 */
function cacheRmEnv(side: string, log: string): NodeJS.Dict<string> {
  const env: NodeJS.Dict<string> = {
    ...removedDirReaddir.env(log),
    HOME: join(side, "home"),
    USERPROFILE: join(side, "home"),
    XDG_CACHE_HOME: join(side, "xdg-cache"),
    BUN_INSTALL: join(side, "bun-install"),
    TMPDIR: join(side, "tmp"),
    TMP: join(side, "tmp"),
    TEMP: join(side, "tmp"),
  };
  delete env.BUN_INSTALL_CACHE_DIR;
  return env;
}
const cacheRmFiles = {
  "home/.keep": "",
  "xdg-cache/.keep": "",
  "bun-install/install/cache/bar@0.0.2@@@1/package.json": "{}",
  "proj/package.json": JSON.stringify({ name: "demo" }),
};
const folderDependency = {
  "proj/package.json": JSON.stringify({ name: "proj", version: "1.0.0", dependencies: { dep: "file:./dep" } }),
  "proj/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
  "proj/dep/index.js": "module.exports = 1;",
};

describe.skipIf(!removedDirReaddir.available)("a directory that is removed while it is read", () => {
  // These readers list, or delete what they list. A directory that was removed
  // is an empty one for them: the command goes on where it failed before.
  describe.concurrent("ends its listing", () => {
    test("bun pm cache rm removes the rest of a bunx tree", async () => {
      const bunx = `bunx-${process.getuid!()}-cowsay@latest`;
      using side = tempDir("cache-rm-vanishing-dir", { ...cacheRmFiles, [`tmp/${bunx}/keep/file.txt`]: "x" });
      mkdirSync(join(String(side), "tmp", bunx, "vanish-before-read"));
      const log = join(String(side), "shim.log");

      expect(await run(["pm", "cache", "rm"], join(String(side), "proj"), cacheRmEnv(String(side), log))).toEqual({
        stdout: "Cleared 'bun install' cache\nCleared 1 cached 'bunx' packages\n",
        stderr: "",
        exitCode: 0,
      });
      // What the shim did: if it did not interpose, the output above is the same.
      expect(removedDirReaddir.actions(log, String(side))).toEqual([
        `vanish-before-read tmp/${bunx}/vanish-before-read`,
      ]);
      expect(existsSync(join(String(side), "tmp", bunx))).toBeFalse();
    });

    test("bun pm cache prune has nothing to prune in it", async () => {
      using dir = tempDir("cache-prune-vanishing-dir", { "package.json": JSON.stringify({ name: "demo" }) });
      const cache = join(String(dir), "vanish-before-read");
      mkdirSync(cache);
      const log = join(String(dir), "shim.log");

      expect(
        await run(["pm", "cache", "prune"], String(dir), {
          ...removedDirReaddir.env(log),
          BUN_INSTALL_CACHE_DIR: cache,
        }),
      ).toEqual({
        stdout: "Done! Checked 0 packages, none older than 30 days (nothing to prune)\n",
        stderr: "",
        exitCode: 0,
      });
      expect(removedDirReaddir.actions(log, String(dir))).toEqual(["vanish-before-read vanish-before-read"]);
    });

    test("bun install finds no workspace in it", async () => {
      using dir = tempDir("install-vanishing-workspaces", {
        "package.json": JSON.stringify({ name: "root", version: "1.0.0", workspaces: ["vanish-before-read/*"] }),
      });
      mkdirSync(join(String(dir), "vanish-before-read"));
      const log = join(String(dir), "shim.log");

      const { stderr, exitCode } = await run(["install"], String(dir), installEnv(String(dir), log));
      expect(removedDirReaddir.actions(log, String(dir))).toEqual(["vanish-before-read vanish-before-read"]);
      expect(stderr).not.toContain("Failed to run workspace pattern");
      expect(exitCode).toBe(0);
    });
  });

  // These readers copy, link or compare what they list, or cache it. A directory
  // that was removed is not an empty one for them: they fail as they did before.
  describe.concurrent("is not an empty directory", () => {
    // The walker that copies or links a package: the copy would lack what the directory held.
    test.each([
      [[], "failed copying files from cache to destination for package dep"],
      [["--backend=copyfile"], "failed copying files from cache to destination for package dep"],
      [["--linker=isolated"], "failed to link package: dep@dep"],
    ] as const)("bun install %j fails", async (flags, message) => {
      using dir = tempDir("install-vanishing-dir", {
        ...folderDependency,
        "proj/dep/lib/vanish-before-read/inner.txt": "x",
      });
      const log = join(String(dir), "shim.log");

      const { stderr, exitCode } = await run(
        ["install", ...flags],
        join(String(dir), "proj"),
        installEnv(String(dir), log),
      );
      // The hardlink backend also reads its staged copy of the directory when it cleans up.
      expect(removedDirReaddir.actions(log, String(dir))).toContain(
        "vanish-before-read proj/dep/lib/vanish-before-read",
      );
      expect(stderr).toContain(message);
      expect(exitCode).toBe(1);
    });

    // The check for a folder that is already linked compares the listing of
    // the folder with the listing of its copy. A folder that is removed while
    // it is listed does not match an empty copy.
    test("bun install does not take a folder that is removed for one that is linked", async () => {
      using dir = tempDir("install-vanishing-folder", {
        "proj/package.json": JSON.stringify({
          name: "proj",
          version: "1.0.0",
          dependencies: { dep: "file:./vanish-before-read" },
        }),
        "proj/vanish-before-read/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
        "proj/vanish-before-read/index.js": "module.exports = 1;",
      });
      const proj = join(String(dir), "proj");
      mkdirSync(join(proj, "node_modules", "dep"), { recursive: true });
      const log = join(String(dir), "shim.log");

      const { stderr, exitCode } = await run(["install"], proj, installEnv(String(dir), log));
      // The check lists the folder, then its copy.
      const trace = removedDirReaddir.trace(log, String(dir));
      const removal = trace.indexOf("vanish-before-read proj/vanish-before-read");
      expect(trace.slice(removal - 1, removal + 2)).toEqual([
        "list proj/vanish-before-read",
        "vanish-before-read proj/vanish-before-read",
        "list proj/node_modules/dep",
      ]);
      expect(stderr).toContain('Could not find folder "file:vanish-before-read" for dependency "dep"');
      expect(exitCode).toBe(1);
    });

    // Before it links a folder into the store again, the isolated linker removes
    // from the old copy what the folder no longer has. It lists the folder and
    // the copy for that. What a directory held that is removed during that
    // listing is not known, so its copy stays as it is.
    test("bun install --linker=isolated keeps the copy of a directory that is removed while it is pruned", async () => {
      using dir = tempDir("install-vanishing-mirror", {
        ...folderDependency,
        "proj/dep/lib/vanish-after-listing/inner.txt": "x",
      });
      const proj = join(String(dir), "proj");
      const log = join(String(dir), "shim.log");
      const install = (env: NodeJS.Dict<string>) => run(["install", "--linker=isolated"], proj, env);

      // The first install makes the copy. A change in the folder makes the second one link it again.
      const first = await install({ ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), "cache") });
      expect(first.exitCode).toBe(0);
      writeFileSync(join(proj, "dep", "changed.js"), "module.exports = 2;");
      const second = await install({
        ...installEnv(String(dir), log),
        // Only the prune pass lists a directory of the copy and then a directory of the folder.
        REMOVED_DIR_READDIR_AFTER: "/node_modules/dep/lib",
      });

      const trace = removedDirReaddir
        .trace(log, String(dir))
        .map(line => line.replace(/\/node_modules\/\.bun\/[^/]+\//, "/node_modules/.bun/<entry>/"));
      const removal = trace.indexOf("vanish-after-listing proj/dep/lib/vanish-after-listing");
      expect(trace.slice(removal - 3, removal + 1)).toEqual([
        "list proj/dep/lib",
        "list proj/node_modules/.bun/<entry>/node_modules/dep/lib",
        "list proj/dep/lib/vanish-after-listing",
        "vanish-after-listing proj/dep/lib/vanish-after-listing",
      ]);
      expect(second.stderr).not.toContain("error:");
      expect(readdirSync(join(proj, "node_modules", "dep", "lib", "vanish-after-listing"))).toEqual(["inner.txt"]);
      expect(second.exitCode).toBe(0);
    });

    // What the directory held would show as deleted, so this is the same loud
    // failure as a file that cannot be read.
    test("bun pm diff fails, it does not print a diff with a hole in it", async () => {
      using dir = tempDir("pm-diff-vanishing-dir", {
        "a/index.js": "module.exports = 1;\n",
        "a/vanish-before-read/inner.txt": "x\n",
        "b/index.js": "module.exports = 1;\n",
      });
      const log = join(String(dir), "shim.log");

      const result = await run(["pm", "diff", "./a", "./b", "--name-only"], String(dir), {
        ...removedDirReaddir.env(log),
        NO_COLOR: "1",
      });
      expect(removedDirReaddir.actions(log, String(dir))).toEqual(["vanish-before-read a/vanish-before-read"]);
      expect(result).toEqual({
        stdout: "",
        stderr: `ENOENT: No such file or directory: failed to read ${realpathSync(String(dir))}/a/vanish-before-read (getdents64)\n`,
        exitCode: 1,
      });
    });

    // The resolver caches what it lists. A directory that was removed is cached
    // as not found, as when it cannot be opened: not as a directory with no files.
    test("bun test reports a directory that is removed as not found", async () => {
      using dir = tempDir("test-vanishing-dir", {
        "vanish-before-read/a.test.js": `import { test } from "bun:test"; test("a", () => {});`,
      });
      const log = join(String(dir), "shim.log");

      const { stderr, exitCode } = await run(["test", "./vanish-before-read"], String(dir), removedDirReaddir.env(log));
      expect(removedDirReaddir.actions(log, String(dir))).toEqual(["vanish-before-read vanish-before-read"]);
      expect({ stderr, exitCode }).toEqual({
        stderr: 'Test filter "./vanish-before-read" had no matches\n',
        exitCode: 1,
      });
    });
  });

  // A filesystem can answer the read of a directory that is still there with
  // ENOENT; the shim plays one for "read-fails-enoent". rmdir then finds the
  // directory full. The walk reports that. It does not read the directory
  // again: it would read the same way every time.
  test("bun pm cache rm reports a directory that reads as removed and is still there", async () => {
    const bunx = `bunx-${process.getuid!()}-cowsay@latest`;
    const stillThere = `tmp/${bunx}/read-fails-enoent`;
    using side = tempDir("cache-rm-still-there", { ...cacheRmFiles, [`${stillThere}/inner.txt`]: "x" });
    const log = join(String(side), "shim.log");

    expect(await run(["pm", "cache", "rm"], join(String(side), "proj"), cacheRmEnv(String(side), log))).toEqual({
      stdout: "Cleared 'bun install' cache\nCleared 0 cached 'bunx' packages\n",
      stderr: `ENOTEMPTY: Directory not empty: Could not delete ${bunx} (unlink)\n`,
      exitCode: 1,
    });
    expect(removedDirReaddir.actions(log, String(side))).toEqual([`read-fails-enoent ${stillThere}`]);
    expect(existsSync(join(String(side), stillThere, "inner.txt"))).toBeTrue();
  });
});
