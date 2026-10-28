import { spawn } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync } from "fs";
import { bunEnv, bunExe, isLinux, isMusl, readdirSorted, runBunInstall, tempDir } from "harness";
import { dirname, join } from "path";
import { TestRegistry } from "registry";

const registry = new TestRegistry();
beforeAll(async () => {
  await registry.start();
});
afterAll(() => {
  registry.stop();
});

// Mounting needs a private user and mount namespace. Skipped where those are turned off, as in most containers.
const canMount =
  isLinux &&
  Bun.which("unshare") !== null &&
  Bun.spawnSync({ cmd: ["unshare", "-Urm", "true"], stdout: "ignore", stderr: "ignore" }).exitCode === 0;

// As Docker mounts an image: no directory of the lower layer is renamed, so bun deletes it where it is.
const overlay = "lowerdir=project,upperdir=upper,workdir=work,userxattr";
const canMountOverlay =
  canMount &&
  (() => {
    using dir = tempDir("overlay-probe", {
      "project/.keep": "",
      "upper/.keep": "",
      "work/.keep": "",
      "merged/.keep": "",
    });
    const mounted = Bun.spawnSync({
      cmd: ["unshare", "-Urm", "mount", "-t", "overlay", "overlay", "-o", overlay, "merged"],
      cwd: String(dir),
      stdout: "ignore",
      stderr: "ignore",
    });
    // The kernel leaves its work directory without a permission bit. Removing it takes some.
    if (existsSync(join(String(dir), "work", "work"))) chmodSync(join(String(dir), "work", "work"), 0o700);
    return mounted.exitCode === 0;
  })();

// docker-compose: a volume mounted on a package folder, or on a directory in one that the package
// does not ship. Each command here deletes that package, where it is or under the name it was
// moved to. No delete goes into the volume. The linkers do put the new copy into a folder that stays.
// `says` has the lines that begin with `error:`, `warn:`, an errno or `Failed`.
type VolumeRow = {
  linker: "hoisted" | "isolated";
  on: "a directory" | "an overlay";
  // Below the package folder. Empty: the package folder is the mount point.
  where?: string;
  what: string;
  name?: string;
  dependencies?: Record<string, string>;
  globalStore?: true;
  args: string[];
  then?: Record<string, string>;
  // bun calls no `openat2`, as on Android and on a kernel that has none.
  openat2?: false;
  // bun is not allowed to remove the mount point from the directory that it is in.
  refused?: true;
  // What the volume holds afterwards. The linkers put the files of a package into one that is a package folder.
  volume?: string[];
  says?: string[];
  // A second `bun install` says nothing.
  again?: true;
  // Of the package afterwards, where the command leaves one.
  version?: string;
  exitCode?: number;
};
// For a bun that the mode of a directory applies to. The `setpriv` of BusyBox has no `--bounding-set`.
const withoutDacOverride = ["setpriv", "--bounding-set", "-dac_override,-dac_read_search"];
const canDropDacOverride =
  canMount &&
  Bun.spawnSync({ cmd: ["unshare", "-Urm", ...withoutDacOverride, "true"], stdout: "ignore", stderr: "ignore" })
    .exitCode === 0;
const failing = "lifecycle-failing-postinstall";
const hoisted = { linker: "hoisted", on: "a directory" } as const;
const isolated = { linker: "isolated", on: "a directory" } as const;
const lowerLayer = { on: "an overlay" } as const;
const bump = { what: "another version", args: ["install"], then: { "no-deps": "2.0.0" }, version: "2.0.0" };
const force = { what: "--force", args: ["install", "--force"], version: "1.0.0" };
const dropped = { what: "the dependency is dropped", args: ["install"], then: {} };
const remove = { what: "bun remove", args: ["remove", "no-deps"] };
const toIsolated = { what: "--linker isolated", args: ["install", "--linker", "isolated"] };
const toHoisted = { what: "--linker hoisted", args: ["install", "--linker", "hoisted"], version: "1.0.0" };
const scriptFails = {
  what: "a script that fails",
  name: failing,
  args: ["install", "--force"],
  says: [`error: postinstall script from "${failing}" exited with 1`],
  exitCode: 1,
};
// The folder stays. bun says so once, and ends with the exit code it has for a folder that is gone.
const busy = {
  says: ["error: failed to remove node_modules/no-deps: EBUSY (Device or resource busy)"],
  exitCode: 0,
  again: true,
} as const;
const withoutOpenat2 = { BUN_FEATURE_FLAG_DISABLE_RESOLVE_BENEATH: "1" };
const atThePackage = { where: "", volume: ["host.js", "package.json"] };
const volumeRows: VolumeRow[] = [
  { ...hoisted, ...bump },
  { ...hoisted, ...dropped, ...busy },
  { ...hoisted, ...remove, ...busy },
  { ...hoisted, ...toIsolated, version: "1.0.0" },
  { ...hoisted, ...scriptFails },
  { ...hoisted, what: "bun patch", args: ["patch", "no-deps"], version: "1.0.0" },
  { ...isolated, ...force },
  { ...isolated, ...force, what: "--force, in the global store", globalStore: true },
  { ...isolated, ...toHoisted },
  {
    ...isolated,
    what: "a file: dependency is installed again",
    name: "dep",
    dependencies: { dep: "file:./dep" },
    args: ["install"],
    version: "1.0.0",
  },
  { ...hoisted, ...lowerLayer, ...bump },
  { ...hoisted, ...lowerLayer, ...scriptFails },
  {
    ...hoisted,
    ...lowerLayer,
    ...toIsolated,
    says: [
      "warn: EBUSY: failed to remove node_modules/no-deps (installed by another linker)",
      "EEXIST: File exists: failed to symlink dependencies for package: root@ (symlink)",
      "Failed to install 1 package",
    ],
    exitCode: 1,
  },
  { ...isolated, ...lowerLayer, ...force },
  {
    ...isolated,
    ...lowerLayer,
    ...toHoisted,
    says: ["warn: EBUSY: failed to remove node_modules/.bun (installed by another linker)"],
  },
  { ...hoisted, ...dropped, ...busy, ...atThePackage },
  { ...hoisted, ...remove, ...busy, ...atThePackage },
  {
    ...hoisted,
    ...atThePackage,
    ...busy,
    what: "bun remove, a scoped package",
    name: "@types/no-deps",
    args: ["remove", "@types/no-deps"],
    says: ["error: failed to remove node_modules/@types/no-deps: EBUSY (Device or resource busy)"],
  },
  // `remove_placed_package` deletes `package.json` through a handle of its own.
  { ...hoisted, ...scriptFails, ...atThePackage, volume: ["host.js"] },
  // The new copy is linked into the folder that stays.
  { ...isolated, ...force, ...atThePackage, volume: ["host.js", "index.js", "package.json"] },
  { ...hoisted, ...bump, openat2: false },
  { ...hoisted, ...remove, ...busy, openat2: false },
  { ...hoisted, ...lowerLayer, ...bump, openat2: false },
  { ...hoisted, ...remove, ...busy, ...atThePackage, openat2: false },
  { ...hoisted, ...bump, where: "data/vol", refused: true },
  { ...hoisted, ...bump, where: "data/vol", refused: true, openat2: false },
  // The error is that of a mount point, not the one that the parent gave for its removal.
  { ...hoisted, ...dropped, ...busy, where: "data/vol", refused: true },
  { ...hoisted, ...dropped, ...busy, where: "data/vol", refused: true, openat2: false },
];
for (const row of volumeRows) {
  const { name = "no-deps", where = "vol", exitCode: expectedExitCode = 0 } = row;
  const manifest = (dependencies: Record<string, string>) =>
    JSON.stringify({ name: "root", dependencies, trustedDependencies: [failing] });
  const title = [
    `${row.linker} on ${row.on}`,
    row.what,
    ...(row.openat2 === false ? ["without openat2"] : []),
    ...(row.refused ? ["its removal is refused"] : []),
  ].join(", ");
  test
    .skipIf(!(row.on === "an overlay" ? canMountOverlay : canMount) || (row.refused === true && !canDropDacOverride))
    .concurrent(
      `no delete goes into a volume that is mounted ${where ? "in" : "on"} a package folder: ${title}`,
      async () => {
        using dir = tempDir("volume-in-a-package", {
          "project/package.json": manifest(row.dependencies ?? { [name]: "1.0.0" }),
          "project/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
          "volume/host.js": "",
          ...(where ? {} : { "volume/package.json": JSON.stringify({ name, version: "1.0.0" }) }),
          "upper/.keep": "",
          "work/.keep": "",
          "merged/.keep": "",
        });
        const root = String(dir);
        await registry.writeBunfig(join(root, "project"), { linker: row.linker, globalStore: row.globalStore });
        const env = {
          ...bunEnv,
          ...(row.openat2 === false ? withoutOpenat2 : {}),
          // Not in the project: a cache of a lower layer is another matter.
          BUN_INSTALL_CACHE_DIR: join(root, "cache"),
          BUN: bunExe(),
          PACKAGE: name,
          WHERE: where,
          OVERLAY: row.on === "an overlay" ? overlay : "",
          THEN: row.then ? manifest(row.then) : "",
          REFUSED: row.refused ? dirname(where) : "",
          AGAIN: row.again ? "1" : "",
        };
        await runBunInstall(env, join(root, "project"), { packages: ["--ignore-scripts"] });

        await using proc = spawn({
          cmd: [
            "unshare",
            "-Urm",
            "/bin/sh",
            "-c",
            // `pwd -P`: with the isolated linker the name in node_modules is a link to the package.
            `if [ -n "$OVERLAY" ]; then mount -t overlay overlay -o "$OVERLAY" merged && cd merged; else cd project; fi || exit 125
package=$(cd "node_modules/$PACKAGE" && pwd -P) || exit 125
mkdir -p "$package/$WHERE" && mount -o bind ../volume "$package/$WHERE" || exit 125
if [ -n "$REFUSED" ]; then chmod 555 "$package/$REFUSED" || exit 125; fi
if [ -n "$THEN" ]; then echo "$THEN" > package.json; fi
"$@" >&2
code=$?
if [ -n "$AGAIN" ]; then echo "a second install:" >&2; "$BUN" install >&2 || code=125; fi
if [ -n "$REFUSED" ]; then find node_modules -name "$REFUSED" -exec chmod 755 {} \\;; fi
cat "node_modules/$PACKAGE/package.json" 2>/dev/null
exit $code`,
            "sh",
            ...(row.refused ? withoutDacOverride : []),
            bunExe(),
            ...row.args,
          ],
          cwd: root,
          env,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        if (existsSync(join(root, "work", "work"))) chmodSync(join(root, "work", "work"), 0o700);
        const [said, saidAgain = []] = stderr
          .split("a second install:\n")
          .map(output => output.split("\n").filter(line => /^(error:|warn:|E[A-Z]+:|Failed )/.test(line)));

        expect({
          volume: await readdirSorted(join(root, "volume")),
          said,
          saidAgain,
          version: row.version && (stdout ? JSON.parse(stdout).version : stdout),
          // Shown when the exit code is another one.
          stderr: exitCode === expectedExitCode ? "" : stderr,
        }).toEqual({
          volume: row.volume ?? ["host.js"],
          said: row.says ?? [],
          saidAgain: [],
          version: row.version,
          stderr: "",
        });
        expect(exitCode).toBe(expectedExitCode);
      },
    );
}

// `bun pm cache rm` opens the cache directory and deletes its entries: what is mounted on it is the cache.
for (const openat2 of [true, false]) {
  test
    .skipIf(!canMount)
    .concurrent(
      `bun pm cache rm empties a volume at the cache directory, and not one on an entry of it${openat2 ? "" : ", without openat2"}`,
      async () => {
        using dir = tempDir("pm-cache-rm-volumes", {
          "project/package.json": JSON.stringify({ name: "root" }),
          "tmp/.keep": "",
          "cache/.keep": "",
          "cache-volume/bar@0.0.2@@@1/package.json": "{}",
          "cache-volume/links/.keep": "",
          "links-volume/baz@1.0.0/package.json": "{}",
        });
        const root = String(dir);

        await using proc = spawn({
          cmd: [
            "unshare",
            "-Urm",
            "/bin/sh",
            "-c",
            'mount -o bind cache-volume cache && mount -o bind links-volume cache/links || exit 125; cd project && "$@"',
            "sh",
            bunExe(),
            "pm",
            "cache",
            "rm",
          ],
          cwd: root,
          env: {
            ...bunEnv,
            ...(openat2 ? {} : withoutOpenat2),
            // The command also deletes what `bunx` left in the temporary directory.
            TMPDIR: join(root, "tmp"),
            BUN_INSTALL_CACHE_DIR: join(root, "cache"),
          },
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

        expect({
          stdout,
          stderr,
          cache: await readdirSorted(join(root, "cache-volume")),
          links: await readdirSorted(join(root, "links-volume")),
        }).toEqual({
          stdout: "Cleared 0 cached 'bunx' packages\n",
          stderr: `EBUSY: Device or resource busy: Could not delete ${join(root, "cache")} (unlink)\n`,
          cache: ["links"],
          links: ["baz@1.0.0"],
        });
        expect(exitCode).toBe(1);
      },
    );
}

// Without `openat2`, bun asks `rmdir` before it opens a directory that it is to delete.
// sshfs answers EPERM there for a directory that has entries, which is no mount point.
const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
const rmdirSaysEperm = `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>

int unlinkat(int dirfd, const char *path, int flags) {
  static int (*real)(int, const char *, int);
  if (!real) real = dlsym(RTLD_NEXT, "unlinkat");
  int rc = real(dirfd, path, flags);
  if (rc != 0 && (flags & AT_REMOVEDIR) && errno == ENOTEMPTY) errno = EPERM;
  return rc;
}
`;
for (const eperm of [false, true]) {
  test
    .skipIf(!isLinux || (eperm && (isMusl || !cc)))
    .concurrent(
      `without openat2, the previous copy of a package is deleted${eperm ? ", rmdir says EPERM for a directory with entries" : ""}`,
      async () => {
        // A hoisted `file:` package with a directory that has entries.
        using dir = tempDir("delete-without-openat2", {
          "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { dep: "file:./dep" } }),
          "bunfig.toml": `[install]\nlinker = "hoisted"\n`,
          "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0", bin: { dep: "bin/dep.js" } }),
          "dep/bin/dep.js": "#!/usr/bin/env node\nconsole.log('ok');\n",
          "shim.c": rmdirSaysEperm,
        });
        const root = String(dir);
        const modules = join(root, "node_modules");
        const env: NodeJS.Dict<string> = { ...bunEnv, ...withoutOpenat2, BUN_INSTALL_CACHE_DIR: join(root, ".cache") };
        const run = async (...cmd: string[]) => {
          await using proc = spawn({ cmd, cwd: root, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
        };
        if (eperm) {
          await run(cc!, "-shared", "-fPIC", "-o", "shim.so", "shim.c", "-ldl");
          env.LD_PRELOAD = [join(root, "shim.so"), bunEnv.LD_PRELOAD].filter(Boolean).join(":");
        }

        await run(bunExe(), "install");
        mkdirSync(join(modules, "dep", "empty"));
        await run(bunExe(), "install", "--force");
        expect({ node_modules: await readdirSorted(modules), dep: await readdirSorted(join(modules, "dep")) }).toEqual({
          node_modules: [".bin", "dep"],
          dep: ["bin", "package.json"],
        });

        await run(bunExe(), "remove", "dep");
        expect(await readdirSorted(modules)).toEqual([".bin"]);
      },
    );
}
