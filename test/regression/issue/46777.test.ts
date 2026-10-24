import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmod, lstat, readlink, stat } from "node:fs/promises";
import { join } from "node:path";

// `bun install --backend symlink` fills `node_modules/<pkg>` with symlinks into the cache. The bin
// linker does not set the mode through a link, so the file in the cache has to get the executable
// bit itself. The same applies to a `file:` folder, whose files are symlinked from the folder.

const BIN = "#!/bin/sh\necho hello\n";

async function install(cwd: string, args: string[], env: Record<string, string | undefined> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--linker=hoisted", ...args],
    cwd,
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(cwd, "cache"), ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr, exitCode }).toEqual({ stderr: expect.not.stringContaining("error"), exitCode: 0 });
  return stdout;
}

async function runBin(cwd: string, name: string) {
  await using proc = Bun.spawn({
    cmd: [join(cwd, "node_modules", ".bin", name)],
    cwd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "hello\n", stderr: "", exitCode: 0 });
}

async function isExecutable(path: string) {
  return ((await stat(path)).mode & 0o111) !== 0;
}

/** A project that depends on a local tarball whose bin file is not executable. */
async function projectWithTarball(name: string) {
  const dir = tempDir(name, {
    "package.json": JSON.stringify({ name: "app", dependencies: { pkg: "file:./pkg-1.0.0.tgz" } }),
  });
  // `Bun.Archive` writes files with mode 0644, like `npm pack` does for a 0644 source file.
  await Bun.Archive.write(
    join(String(dir), "pkg-1.0.0.tgz"),
    {
      "package/package.json": JSON.stringify({ name: "pkg", version: "1.0.0", bin: { pkg: "bin/cli.js" } }),
      "package/bin/cli.js": BIN,
    },
    { compress: "gzip" },
  );
  return dir;
}

test.concurrent.skipIf(isWindows)("--backend symlink makes the bin file in the cache executable", async () => {
  using dir = await projectWithTarball("bin-symlink-backend");
  const cwd = String(dir);
  await install(cwd, ["--backend=symlink"]);

  const binTarget = join(cwd, "node_modules", "pkg", "bin", "cli.js");
  expect((await lstat(binTarget)).isSymbolicLink()).toBe(true);
  const cacheFile = await readlink(binTarget);
  expect(cacheFile.startsWith(join(cwd, "cache"))).toBe(true);
  expect(await isExecutable(cacheFile)).toBe(true);
  await runBin(cwd, "pkg");
});

test.concurrent.skipIf(isWindows)("--backend symlink uses the cache directory from --cache-dir", async () => {
  using dir = await projectWithTarball("bin-symlink-backend-cache-dir");
  const cwd = String(dir);
  const cacheDir = join(cwd, "other-cache");
  await install(cwd, ["--backend=symlink", "--cache-dir", cacheDir], { BUN_INSTALL_CACHE_DIR: undefined });

  const cacheFile = await readlink(join(cwd, "node_modules", "pkg", "bin", "cli.js"));
  expect(cacheFile.startsWith(cacheDir)).toBe(true);
  expect(await isExecutable(cacheFile)).toBe(true);
  await runBin(cwd, "pkg");
});

test.concurrent.skipIf(isWindows)("a second install makes a bin file in the cache executable again", async () => {
  using dir = await projectWithTarball("bin-symlink-backend-reinstall");
  const cwd = String(dir);
  await install(cwd, ["--backend=symlink"]);
  const cacheFile = await readlink(join(cwd, "node_modules", "pkg", "bin", "cli.js"));
  await chmod(cacheFile, 0o644);

  // The package is already installed, so only the bins are linked again.
  await install(cwd, ["--backend=symlink"]);
  expect(await isExecutable(cacheFile)).toBe(true);
  await runBin(cwd, "pkg");
});

test.concurrent.skipIf(isWindows)("--backend symlink makes the bin file of a file: folder executable", async () => {
  using dir = tempDir("bin-symlink-backend-folder", {
    "package.json": JSON.stringify({ name: "app", dependencies: { pkg: "file:./pkg" } }),
    "pkg/package.json": JSON.stringify({ name: "pkg", version: "1.0.0", bin: { pkg: "bin/cli.js" } }),
    "pkg/bin/cli.js": BIN,
  });
  const cwd = String(dir);
  await chmod(join(cwd, "pkg", "bin", "cli.js"), 0o644);
  await install(cwd, ["--backend=symlink"]);

  expect((await lstat(join(cwd, "node_modules", "pkg", "bin", "cli.js"))).isSymbolicLink()).toBe(true);
  expect(await isExecutable(join(cwd, "pkg", "bin", "cli.js"))).toBe(true);
  await runBin(cwd, "pkg");
});
