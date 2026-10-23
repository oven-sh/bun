import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { TestRegistry } from "registry";

const registry = new TestRegistry();
beforeAll(() => registry.start());
afterAll(() => registry.stop());

// Regression: when runtime auto-install (`enqueueDependencyToRoot`) finds a
// cached manifest on disk but not the extracted tarball, it calls
// `Lockfile.Package.fromNPM` which grows `lockfile.buffers.dependencies`.
// The `dependency` argument was a pointer directly into that buffer, so the
// subsequent `.extract` branch read `dependency.behavior` from freed memory
// (ASAN: use-after-poison).
//
// The package only needs to have at least one dependency of its own so that
// `fromNPM` reallocates the single-entry dependencies buffer.
test("auto-install with cached manifest but missing tarball does not read a dangling dependency pointer", async () => {
  using dir = tempDir("autoinstall-cached-manifest", {});
  const cacheDir = join(String(dir), ".bun-cache");

  const env = {
    ...bunEnv,
    BUN_INSTALL_CACHE_DIR: cacheDir,
    BUN_CONFIG_REGISTRY: registry.registryUrl(),
  };

  // Use `-e` so the `require()` is resolved at runtime through
  // `Bun__resolveSync` → `enqueueDependencyToRoot` (the code path that was
  // passing a pointer directly into the lockfile buffer). Loading from a
  // file instead lets the transpiler resolve the import through a
  // different path that already used a stack copy.
  const script = `try { require("is-even"); } catch {} console.log("ok");`;

  // First run: downloads manifests and tarballs into the cache. The manifest
  // isn't cached yet, so the safe `processDependencyListItem` path (stack
  // copy) is taken.
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--install=force", "-e", script],
      env,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain("ok");
    expect(exitCode).toBe(0);
  }

  // Keep the `.npm` manifest files, drop every extracted tarball so the next
  // run hits the `.extract` path with a warm manifest cache. Assert both
  // kinds actually exist first so this test doesn't silently become a no-op
  // if the first run's auto-install didn't reach the registry.
  const entries = readdirSync(cacheDir);
  const manifests = entries.filter(e => e.endsWith(".npm"));
  const extracted = entries.filter(e => !e.endsWith(".npm"));
  expect(manifests.length).toBeGreaterThan(0);
  expect(extracted.length).toBeGreaterThan(0);
  for (const entry of extracted) {
    rmSync(join(cacheDir, entry), { recursive: true, force: true });
  }

  // Second run: manifest is loaded from disk, `fromNPM` appends the package's
  // dependencies (reallocating the buffer), then the tarball download path
  // runs. Previously this read `dependency.behavior` from the freed buffer.
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--install=force", "-e", script],
      env,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain("ok");
    expect(exitCode).toBe(0);
  }
});

// https://github.com/oven-sh/bun/issues/10411
// A manifest from the disk cache resolves the version at once, before anything is downloaded.
describe.concurrent("auto-install with the manifest in the cache", () => {
  /** A registry with these versions of `pkg`, each exporting its version, and a directory to run scripts in. */
  async function sandbox(...versions: string[]) {
    const tarballs = new Map<string, Uint8Array>();
    for (const version of versions) {
      const files = {
        "package/package.json": JSON.stringify({ name: "pkg", version }),
        "package/index.js": `module.exports = ${JSON.stringify(version)};\n`,
      };
      tarballs.set(`/pkg/-/pkg-${version}.tgz`, await new Bun.Archive(files, { compress: "gzip" }).bytes());
    }
    const downloads: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const { pathname } = new URL(req.url);
        const tarball = tarballs.get(pathname);
        if (tarball) {
          downloads.push(pathname);
          return new Response(tarball);
        }
        return Response.json({
          name: "pkg",
          "dist-tags": { latest: versions.at(-1) },
          versions: Object.fromEntries(
            versions.map(version => [
              version,
              { name: "pkg", version, dist: { tarball: `${server.url}pkg/-/pkg-${version}.tgz` } },
            ]),
          ),
        });
      },
    });
    const dir = tempDir("autoinstall-cached-manifest", {
      "bunfig.toml": Bun.TOML.stringify({ install: { registry: server.url.href } }),
      cache: {},
    });
    const cache = join(String(dir), "cache");
    return {
      cache,
      downloads,
      /** What a fresh process gets from `import(specifier)`. */
      async load(specifier: string) {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "--install=auto", "-e", `console.log((await import(${JSON.stringify(specifier)})).default)`],
          cwd: String(dir),
          env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: cache },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { stdout, stderr, exitCode };
      },
      [Symbol.dispose]() {
        server.stop(true);
        dir[Symbol.dispose]();
      },
    };
  }
  const loaded = (version: string) => ({ stdout: version + "\n", stderr: "", exitCode: 0 });

  test("installs another version of a package", async () => {
    using box = await sandbox("1.0.0", "2.0.0");
    expect(await box.load("pkg@1.0.0")).toEqual(loaded("1.0.0"));
    expect(readdirSync(box.cache).filter(name => name.endsWith(".npm"))).toHaveLength(1);

    expect(await box.load("pkg@2.0.0")).toEqual(loaded("2.0.0"));
    expect(box.downloads).toEqual(["/pkg/-/pkg-1.0.0.tgz", "/pkg/-/pkg-2.0.0.tgz"]);
  });

  test("downloads a package again if it's missing from the cache", async () => {
    using box = await sandbox("1.0.0");
    expect(await box.load("pkg")).toEqual(loaded("1.0.0"));
    for (const name of readdirSync(box.cache)) {
      if (!name.endsWith(".npm")) rmSync(join(box.cache, name), { recursive: true });
    }
    expect(readdirSync(box.cache)).toHaveLength(1);

    expect(await box.load("pkg")).toEqual(loaded("1.0.0"));
    expect(box.downloads).toEqual(["/pkg/-/pkg-1.0.0.tgz", "/pkg/-/pkg-1.0.0.tgz"]);
  });

  // The link in `<cache>/pkg/` is made after the package is in place, so another process can see one without the other.
  test("loads a package that the index of versions does not list", async () => {
    using box = await sandbox("1.0.0");
    expect(await box.load("pkg")).toEqual(loaded("1.0.0"));
    rmSync(join(box.cache, "pkg"), { recursive: true });

    expect(await box.load("pkg")).toEqual(loaded("1.0.0"));
    expect(box.downloads).toEqual(["/pkg/-/pkg-1.0.0.tgz"]);
  });
});
