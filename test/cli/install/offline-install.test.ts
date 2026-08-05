import { file, write } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { cp, mkdir, readdir, rm } from "fs/promises";
import { bunEnv, bunExe, tempDir, VerdaccioRegistry } from "harness";
import { join } from "path";

// `--offline` / `install.offline`: install without any network access, failing
// when something is not available locally. `--tarball-dir` supplies npm
// tarballs from a directory of `<name>@<version>.tgz` files.
//
// Every fixture is seeded online in beforeAll, then verdaccio is killed. The
// lockfiles and bunfigs keep pointing at the dead port, so any accidental
// network request fails the test with a connection error instead of the
// offline behavior under test.

const registry = new VerdaccioRegistry();

interface Fixture {
  packageDir: string;
  packageJson: string;
}

let warmCache: Fixture;
let warmCacheBunfig: Fixture;
let coldCacheNoSource: Fixture;
let tarballDirHoisted: Fixture;
let tarballDirIsolated: Fixture;
let tarballDirMissingFile: Fixture;
let tarballDirBadIntegrity: Fixture;
let tarballDirOnline: Fixture;
let tarballDirPrefetch: Fixture;
let manifestResolve: Fixture;

const deps = {
  "one-dep": "1.0.0",
  "@types/no-deps": "1.0.0",
};

async function runInstall(dir: string, args: string[] = [], env: Record<string, string | undefined> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", ...args],
    cwd: dir,
    env: {
      ...bunEnv,
      // The CI runner exports a shared BUN_INSTALL_CACHE_DIR, which takes
      // precedence over the bunfig cache path; pin the cache into the fixture
      // so cold-cache setups are actually cold.
      BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache"),
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out, err, exitCode };
}

async function seed(fixture: Fixture, packageJson: object) {
  await write(fixture.packageJson, JSON.stringify(packageJson));
  const { out, err, exitCode } = await runInstall(fixture.packageDir);
  if (exitCode !== 0 || err.includes("error:")) {
    throw new Error(`seed install failed (exit ${exitCode})\nstderr: ${err}\nstdout: ${out}`);
  }
}

/** Copy a published tarball from verdaccio's storage into `<dir>/tarballs`
 * under the `<name>@<version>.tgz` layout `--tarball-dir` reads. */
async function addTarball(fixture: Fixture, name: string, version: string, as: string = `${name}@${version}.tgz`) {
  const basename = `${name.includes("/") ? name.split("/")[1] : name}-${version}.tgz`;
  const src = join(registry.packagesPath, name, basename);
  const dest = join(fixture.packageDir, "tarballs", as);
  await mkdir(join(dest, ".."), { recursive: true });
  await cp(src, dest);
}

async function clearCacheAndNodeModules(fixture: Fixture) {
  await rm(join(fixture.packageDir, ".bun-cache"), { recursive: true, force: true });
  await rm(join(fixture.packageDir, "node_modules"), { recursive: true, force: true });
}

async function installedVersion(fixture: Fixture, name: string): Promise<string> {
  return (await file(join(fixture.packageDir, "node_modules", name, "package.json")).json()).version;
}

beforeAll(async () => {
  await registry.start();

  warmCache = await registry.createTestDir();
  warmCacheBunfig = await registry.createTestDir();
  coldCacheNoSource = await registry.createTestDir();
  tarballDirHoisted = await registry.createTestDir();
  tarballDirIsolated = await registry.createTestDir({ bunfigOpts: { linker: "isolated" } });
  tarballDirMissingFile = await registry.createTestDir();
  tarballDirBadIntegrity = await registry.createTestDir();
  tarballDirOnline = await registry.createTestDir();
  tarballDirPrefetch = await registry.createTestDir();
  manifestResolve = await registry.createTestDir();

  await Promise.all([
    seed(warmCache, { name: "warm-cache", dependencies: deps }),
    seed(warmCacheBunfig, { name: "warm-cache-bunfig", dependencies: deps }),
    seed(coldCacheNoSource, { name: "cold-cache", dependencies: deps }),
    seed(tarballDirHoisted, { name: "tarball-dir-hoisted", dependencies: deps }),
    seed(tarballDirIsolated, { name: "tarball-dir-isolated", dependencies: deps }),
    seed(tarballDirMissingFile, { name: "tarball-dir-missing", dependencies: deps }),
    seed(tarballDirBadIntegrity, { name: "tarball-dir-integrity", dependencies: deps }),
    seed(tarballDirOnline, { name: "tarball-dir-online", dependencies: deps }),
    seed(tarballDirPrefetch, { name: "tarball-dir-prefetch", dependencies: { "no-deps": "^1.0.0" } }),
    seed(manifestResolve, { name: "manifest-resolve", dependencies: { "no-deps": "^1.0.0" } }),
  ]);

  // Kill verdaccio so every request to it is refused. `registry.stop()` sends
  // signal 0 (an existence probe), so kill the child process directly.
  const proc = registry.process!;
  const exited = new Promise(resolve => proc.once("exit", resolve));
  proc.kill("SIGKILL");
  await exited;
});

afterAll(() => {
  registry.stop();
});

test.concurrent("--offline installs from a warm cache with the registry unreachable", async () => {
  await rm(join(warmCache.packageDir, "node_modules"), { recursive: true, force: true });

  const { err, exitCode } = await runInstall(warmCache.packageDir, ["--offline"]);
  expect(err).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await installedVersion(warmCache, "one-dep")).toBe("1.0.0");
  expect(await installedVersion(warmCache, "no-deps")).toBe("1.0.1");
  expect(await installedVersion(warmCache, "@types/no-deps")).toBe("1.0.0");
});

test.concurrent("install.offline in bunfig and BUN_CONFIG_OFFLINE are equivalent to --offline", async () => {
  const { packageDir } = warmCacheBunfig;
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

  // env var, no flag
  let result = await runInstall(packageDir, [], { BUN_CONFIG_OFFLINE: "1" });
  expect(result.err).not.toContain("error:");
  expect(result.exitCode).toBe(0);

  // bunfig, no flag
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  const bunfigPath = join(packageDir, "bunfig.toml");
  await write(bunfigPath, (await file(bunfigPath).text()) + `offline = true\n`);
  result = await runInstall(packageDir);
  expect(result.err).not.toContain("error:");
  expect(result.exitCode).toBe(0);

  expect(await installedVersion(warmCacheBunfig, "one-dep")).toBe("1.0.0");
});

test.concurrent("--offline with a cold cache and no tarball dir fails naming the package", async () => {
  await clearCacheAndNodeModules(coldCacheNoSource);

  const { err, exitCode } = await runInstall(coldCacheNoSource.packageDir, ["--offline"]);
  expect(err).toMatch(/error: .*is missing from the cache and network requests are disabled \(--offline\)/);
  expect(err).toContain("one-dep@1.0.0");
  // a connection error would mean the network was touched
  expect(err).not.toContain("ConnectionRefused");
  expect(exitCode).toBe(1);
});

test.concurrent("--offline --tarball-dir installs with a cold cache (hoisted)", async () => {
  await clearCacheAndNodeModules(tarballDirHoisted);
  await addTarball(tarballDirHoisted, "one-dep", "1.0.0");
  await addTarball(tarballDirHoisted, "no-deps", "1.0.1");
  await addTarball(tarballDirHoisted, "@types/no-deps", "1.0.0", "@types/no-deps@1.0.0.tgz");

  const { err, exitCode } = await runInstall(tarballDirHoisted.packageDir, ["--offline", "--tarball-dir=tarballs"]);
  expect(err).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await installedVersion(tarballDirHoisted, "one-dep")).toBe("1.0.0");
  expect(await installedVersion(tarballDirHoisted, "no-deps")).toBe("1.0.1");
  expect(await installedVersion(tarballDirHoisted, "@types/no-deps")).toBe("1.0.0");

  // same install driven purely by bunfig (install.offline + install.tarballDir)
  await clearCacheAndNodeModules(tarballDirHoisted);
  const bunfigPath = join(tarballDirHoisted.packageDir, "bunfig.toml");
  await write(bunfigPath, (await file(bunfigPath).text()) + `offline = true\ntarballDir = "tarballs"\n`);
  const bunfigRun = await runInstall(tarballDirHoisted.packageDir);
  expect(bunfigRun.err).not.toContain("error:");
  expect(bunfigRun.exitCode).toBe(0);
  expect(await installedVersion(tarballDirHoisted, "one-dep")).toBe("1.0.0");
  expect(await installedVersion(tarballDirHoisted, "@types/no-deps")).toBe("1.0.0");
});

test.concurrent("--offline --tarball-dir installs with a cold cache (isolated linker)", async () => {
  await clearCacheAndNodeModules(tarballDirIsolated);
  await addTarball(tarballDirIsolated, "one-dep", "1.0.0");
  await addTarball(tarballDirIsolated, "no-deps", "1.0.1");
  await addTarball(tarballDirIsolated, "@types/no-deps", "1.0.0", "@types/no-deps@1.0.0.tgz");

  const { err, exitCode } = await runInstall(tarballDirIsolated.packageDir, ["--offline", "--tarball-dir=tarballs"]);
  expect(err).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(await installedVersion(tarballDirIsolated, "one-dep")).toBe("1.0.0");
  expect(await installedVersion(tarballDirIsolated, "@types/no-deps")).toBe("1.0.0");

  // packages resolve through the isolated store
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log(require('one-dep/package.json').version)"],
    cwd: tarballDirIsolated.packageDir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, exitCode2] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(out.trim()).toBe("1.0.0");
  expect(exitCode2).toBe(0);
});

test.concurrent("--offline --tarball-dir fails when a tarball file is missing", async () => {
  await clearCacheAndNodeModules(tarballDirMissingFile);
  await addTarball(tarballDirMissingFile, "one-dep", "1.0.0");
  await addTarball(tarballDirMissingFile, "@types/no-deps", "1.0.0", "@types/no-deps@1.0.0.tgz");
  // no-deps@1.0.1.tgz is intentionally absent

  const { err, exitCode } = await runInstall(tarballDirMissingFile.packageDir, ["--offline", "--tarball-dir=tarballs"]);
  expect(err).toContain("error:");
  expect(err).toContain("no-deps");
  expect(err).not.toContain("ConnectionRefused");
  expect(exitCode).toBe(1);
});

test.concurrent("--offline --tarball-dir rejects a tarball that fails the lockfile integrity check", async () => {
  await clearCacheAndNodeModules(tarballDirBadIntegrity);
  await addTarball(tarballDirBadIntegrity, "one-dep", "1.0.0");
  await addTarball(tarballDirBadIntegrity, "@types/no-deps", "1.0.0", "@types/no-deps@1.0.0.tgz");
  // wrong bytes: no-deps 2.0.0 masquerading as 1.0.1
  await addTarball(tarballDirBadIntegrity, "no-deps", "2.0.0", "no-deps@1.0.1.tgz");

  const { err, exitCode } = await runInstall(tarballDirBadIntegrity.packageDir, [
    "--offline",
    "--tarball-dir=tarballs",
  ]);
  expect(err).toContain("Integrity check failed for tarball: no-deps");
  expect(exitCode).toBe(1);
});

test.concurrent("--tarball-dir without --offline uses the file when present, the network otherwise", async () => {
  await clearCacheAndNodeModules(tarballDirOnline);
  await addTarball(tarballDirOnline, "one-dep", "1.0.0");
  await addTarball(tarballDirOnline, "no-deps", "1.0.1");
  await addTarball(tarballDirOnline, "@types/no-deps", "1.0.0", "@types/no-deps@1.0.0.tgz");

  // all files present: no network needed even though --offline is not passed
  // (the registry is unreachable, so any fallback would fail the install)
  let result = await runInstall(tarballDirOnline.packageDir, ["--tarball-dir=tarballs"]);
  expect(result.err).not.toContain("error:");
  expect(result.exitCode).toBe(0);
  expect(await installedVersion(tarballDirOnline, "one-dep")).toBe("1.0.0");

  // with a file missing, the install falls back to the network for it
  await clearCacheAndNodeModules(tarballDirOnline);
  await rm(join(tarballDirOnline.packageDir, "tarballs", "no-deps@1.0.1.tgz"));
  result = await runInstall(tarballDirOnline.packageDir, ["--tarball-dir=tarballs"]);
  expect(result.err).toContain("ConnectionRefused");
  expect(result.err).toContain("no-deps");
  expect(result.exitCode).toBe(1);
});

test.concurrent("--tarball-dir covers tarballs fetched during resolution (no lockfile)", async () => {
  // A fresh resolve (no lockfile) prefetches tarballs for newly-resolved
  // packages; those reads must also come from the tarball dir.
  const { packageDir } = tarballDirPrefetch;
  await rm(join(packageDir, "bun.lock"), { force: true });
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
  // drop the extracted package from the cache (its folder name carries a
  // registry-host suffix, so match by prefix) but keep the fresh manifest
  const cacheDir = join(packageDir, ".bun-cache");
  for (const entry of await readdir(cacheDir)) {
    if (entry.startsWith("no-deps")) {
      await rm(join(cacheDir, entry), { recursive: true, force: true });
    }
  }
  await addTarball(tarballDirPrefetch, "no-deps", "1.1.0");

  const { err, exitCode } = await runInstall(packageDir, ["--tarball-dir=tarballs"]);
  expect(err).not.toContain("error:");
  expect(exitCode).toBe(0);
  expect(await installedVersion(tarballDirPrefetch, "no-deps")).toBe("1.1.0");
});

test.concurrent("--offline resolves from the cached manifest without a lockfile", async () => {
  const { packageDir } = manifestResolve;
  await rm(join(packageDir, "bun.lock"), { force: true });
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

  const { err, exitCode } = await runInstall(packageDir, ["--offline"]);
  expect(err).not.toContain("error:");
  expect(exitCode).toBe(0);
  // highest version of no-deps matching ^1.0.0 in the cached manifest
  expect(await installedVersion(manifestResolve, "no-deps")).toBe("1.1.0");
});

test.concurrent("--offline fails to resolve a package with no cached manifest", async () => {
  using dir = tempDir("offline-no-manifest-", {
    "package.json": JSON.stringify({ name: "no-manifest", dependencies: { "basic-1": "1.0.0" } }),
  });
  await registry.writeBunfig(String(dir));

  const { err, exitCode } = await runInstall(String(dir), ["--offline"]);
  expect(err).toMatch(
    /error: no cached manifest for package .*basic-1.* and network requests are disabled \(--offline\)/,
  );
  expect(err).not.toContain("ConnectionRefused");
  expect(exitCode).toBe(1);
});

test.concurrent("--offline fails a git dependency that is not cached", async () => {
  using dir = tempDir("offline-git-", {
    "package.json": JSON.stringify({
      name: "offline-git",
      dependencies: { "install-test": "git+https://127.0.0.1:1/nope/install-test.git" },
    }),
  });
  await registry.writeBunfig(String(dir));

  const { err, exitCode } = await runInstall(String(dir), ["--offline"]);
  expect(err).toMatch(/git dependency .* is missing from the cache and network requests are disabled \(--offline\)/);
  expect(exitCode).toBe(1);
});

test.concurrent("--offline fails a github dependency that is not cached", async () => {
  using dir = tempDir("offline-github-", {
    "package.json": JSON.stringify({
      name: "offline-github",
      dependencies: { "install-test": "github:oven-sh/does-not-exist#0000000000000000000000000000000000000000" },
    }),
  });
  await registry.writeBunfig(String(dir));

  // GITHUB_API_URL keeps the unfixed code path off the real GitHub API; the
  // offline path never connects at all.
  const { err, exitCode } = await runInstall(String(dir), ["--offline"], {
    GITHUB_API_URL: "http://127.0.0.1:1",
  });
  expect(err).toMatch(/is missing from the cache and network requests are disabled \(--offline\)/);
  expect(exitCode).toBe(1);
});
