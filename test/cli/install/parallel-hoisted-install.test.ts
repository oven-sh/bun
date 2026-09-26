import { $, Glob, file, serve, spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { lstat, mkdir, readlink, rm, stat } from "fs/promises";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";
import { join } from "path";

// Parallel hoisted install is POSIX-only (Windows already fans out
// per-file via HardLinkWindowsInstallTask).

setDefaultTimeout(1000 * 60 * 5);

/**
 * Build a set of local tarball packages to exercise the hoisted
 * installer. Each package has several files and a nested directory so
 * the hardlink walker has real work to do. local_tarball resolutions go
 * through the parallel path (see canUseParallelHoistedInstall).
 */
async function makeTarballFixture(): Promise<{ dir: string; deps: Record<string, string>; count: number }> {
  const count = 60;
  const deps: Record<string, string> = {};
  const root = tempDir("parallel-hoisted", {});
  const dir = String(root);
  await mkdir(join(dir, "tarballs"), { recursive: true });

  for (let i = 0; i < count; i++) {
    const name = i % 3 === 0 ? `@scope/pkg-${i}` : `pkg-${i}`;
    // Lay files out under src/<i>/package/... so `tar -C src/<i> package`
    // works with both GNU and BSD tar (no --transform needed).
    const pkgRoot = join(dir, "src", String(i));
    const pkgSrc = join(pkgRoot, "package");
    await mkdir(join(pkgSrc, "lib", "nested"), { recursive: true });
    await write(
      join(pkgSrc, "package.json"),
      JSON.stringify({ name, version: "1.0.0", bin: i % 5 === 0 ? { [`bin-${i}`]: "./lib/index.js" } : undefined }),
    );
    await write(join(pkgSrc, "index.js"), `module.exports = ${i};\n`);
    await write(join(pkgSrc, "lib", "index.js"), `#!/usr/bin/env node\nconsole.log(${i});\n`);
    await write(join(pkgSrc, "lib", "nested", "a.js"), `// ${i}\n`);
    await write(join(pkgSrc, "lib", "nested", "b.js"), `// ${i}\n`);
    await write(join(pkgSrc, "README.md"), `# ${name}\n`);
    // Pad with extra files so the per-package hardlink work
    // dominates process-startup overhead in the parallelism test.
    // 60 packages × 26 files ≈ 1.5k linkat calls.
    for (let f = 0; f < 20; f++) {
      await write(join(pkgSrc, "lib", "nested", `f${f}.js`), `// ${i}.${f}\n`);
    }

    const tarball = join(dir, "tarballs", `pkg-${i}.tgz`);
    await $`tar -czf ${tarball} -C ${pkgRoot} package`.quiet();
    deps[name] = `file:./tarballs/pkg-${i}.tgz`;
  }

  return { dir, deps, count };
}

/**
 * Deterministic fingerprint of node_modules: every regular file, dir
 * and symlink (with its target), sorted. Both paths call the same
 * PackageInstall.install() which hardlinks from the same cache
 * inodes, so file contents are identical by construction; symlink
 * targets (.bin entries) are compared explicitly.
 */
async function fingerprintNodeModules(dir: string): Promise<string[]> {
  const entries: string[] = [];
  const glob = new Glob("node_modules/**/*");
  for await (const entry of glob.scan({ cwd: dir, onlyFiles: false, dot: true, followSymlinks: false })) {
    const abs = join(dir, entry);
    const st = await lstat(abs);
    if (st.isSymbolicLink()) {
      entries.push(`${entry} -> ${await readlink(abs)}`);
    } else if (st.isDirectory()) {
      entries.push(`${entry}/`);
    } else {
      entries.push(`${entry} [${st.size}]`);
    }
  }
  entries.sort();
  return entries;
}

function spawnInstall(dir: string, env: NodeJS.Dict<string>, args: string[]) {
  return spawn({
    cmd: [bunExe(), "install", ...args],
    cwd: dir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function finish(proc: ReturnType<typeof spawnInstall>) {
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

async function install(dir: string, env: NodeJS.Dict<string>, extraArgs: string[] = []) {
  await using proc = spawnInstall(dir, env, ["--ignore-scripts", ...extraArgs]);
  return await finish(proc);
}

/** Parse the "N packages installed" summary line from stdout. */
function installedCount(stdout: string): number {
  return Number(stdout.match(/(\d+)\s+packages? installed/)?.[1] ?? "0");
}

/**
 * Parse the test-only "[ParallelHoistedInstall] N tasks" marker that
 * complete_parallel_installs() emits under
 * BUN_INTERNAL_PARALLEL_HOISTED_MARKER. Returns 0 if the marker is
 * absent (i.e. the parallel path was not taken, or doesn't exist).
 */
function parallelTaskCount(stderr: string): number {
  const m = stderr.match(/\[ParallelHoistedInstall\]\s+(\d+)\s+tasks/);
  return m ? Number(m[1]) : 0;
}

describe.skipIf(!isPosix)("parallel hoisted install", () => {
  let fixture: { dir: string; deps: Record<string, string>; count: number };
  // CI's runner.node.mjs sets BUN_INSTALL_CACHE_DIR which
  // fetchCacheDirectoryPath() checks BEFORE bunfig's [install] cache,
  // so override it explicitly to keep the cache local to the fixture.
  let env: NodeJS.Dict<string>;

  beforeAll(async () => {
    fixture = await makeTarballFixture();
    env = {
      ...bunEnv,
      BUN_INSTALL_CACHE_DIR: join(fixture.dir, ".bun-cache"),
      // Enable the "[ParallelHoistedInstall] N tasks" stderr marker
      // emitted by completeParallelInstalls() — see parallelTaskCount().
      BUN_INTERNAL_PARALLEL_HOISTED_MARKER: "1",
    };
    await write(
      join(fixture.dir, "package.json"),
      JSON.stringify({ name: "parallel-hoisted-fixture", version: "1.0.0", dependencies: fixture.deps }),
    );
    await write(
      join(fixture.dir, "bunfig.toml"),
      `[install]\ncache = "${join(fixture.dir, ".bun-cache")}"\nregistry = "http://localhost:1/invalid/"\n`,
    );
  });

  afterAll(async () => {
    if (fixture) await rm(fixture.dir, { recursive: true, force: true });
  });

  test("produces identical node_modules to the serial installer", async () => {
    // Warm the cache + generate the lockfile.
    const warm = await install(fixture.dir, env);
    expect(warm.stderr).not.toContain("error:");
    expect(warm.exitCode).toBe(0);

    // Parallel (default): fresh node_modules, warm cache.
    await rm(join(fixture.dir, "node_modules"), { recursive: true, force: true });
    const parallel = await install(fixture.dir, env, ["--frozen-lockfile"]);
    expect(parallel.stderr).not.toContain("error:");
    expect(parallel.exitCode).toBe(0);
    const parallelLayout = await fingerprintNodeModules(fixture.dir);

    // Serial fallback: fresh node_modules, warm cache.
    await rm(join(fixture.dir, "node_modules"), { recursive: true, force: true });
    const serial = await install(fixture.dir, { ...env, BUN_INSTALL_SERIAL_HOISTED: "1" }, ["--frozen-lockfile"]);
    expect(serial.stderr).not.toContain("error:");
    expect(serial.exitCode).toBe(0);
    const serialLayout = await fingerprintNodeModules(fixture.dir);

    // Deterministic signal that the parallel path was actually
    // exercised: completeParallelInstalls() emits a task count under
    // BUN_INTERNAL_PARALLEL_HOISTED_MARKER (set in env above). Without
    // the parallel installer, this marker is never printed. The
    // serial-env run must NOT take the parallel path.
    expect(parallelTaskCount(parallel.stderr)).toBe(fixture.count);
    expect(parallelTaskCount(serial.stderr)).toBe(0);

    // every package dir, file and bin link must match exactly.
    expect(parallelLayout.length).toBeGreaterThan(fixture.count * 5);
    expect(parallelLayout).toEqual(serialLayout);

    const parallelBins = parallelLayout.filter(p => p.startsWith("node_modules/.bin/"));
    const serialBins = serialLayout.filter(p => p.startsWith("node_modules/.bin/"));
    expect(parallelBins.length).toBeGreaterThan(0);
    expect(parallelBins).toEqual(serialBins);

    // summary counts must match.
    expect(installedCount(parallel.stdout)).toBe(installedCount(serial.stdout));
    expect(installedCount(parallel.stdout)).toBe(fixture.count);
  });

  test("re-routes to the serial download path when a cache entry is missing", async () => {
    // Warm the cache if the previous test didn't already.
    await rm(join(fixture.dir, "node_modules"), { recursive: true, force: true });
    const warm = await install(fixture.dir, env);
    expect(warm.exitCode).toBe(0);

    // Delete node_modules and blow away a few packages from the cache
    // so their parallel workers hit ENOENT opening the cache
    // directory. The result handler must re-enter the serial path,
    // re-read the tarball, and install the package anyway. Local
    // tarballs are cached under "@T@<hash>" (see
    // cachedTarballFolderNamePrint).
    await rm(join(fixture.dir, "node_modules"), { recursive: true, force: true });
    const cacheDir = join(fixture.dir, ".bun-cache");
    const cacheEntries: string[] = [];
    for await (const entry of new Glob("@T@*").scan({ cwd: cacheDir, onlyFiles: false })) {
      cacheEntries.push(entry);
    }
    expect(cacheEntries.length).toBe(fixture.count);
    // Remove three of them so multiple workers exercise the fallback.
    for (const entry of cacheEntries.slice(0, 3)) {
      await rm(join(cacheDir, entry), { recursive: true, force: true });
    }

    const out = await install(fixture.dir, env, ["--frozen-lockfile"]);
    expect(out.stderr).not.toContain("error:");
    expect(out.exitCode).toBe(0);

    // Every package, including the ones whose cache entries were
    // deleted, must still end up fully installed.
    const layout = await fingerprintNodeModules(fixture.dir);
    const paths = new Set(layout.map(e => e.split(" ")[0].replace(/\/$/, "")));
    for (let i = 0; i < fixture.count; i++) {
      const name = i % 3 === 0 ? `@scope/pkg-${i}` : `pkg-${i}`;
      expect(paths.has(join("node_modules", name, "package.json"))).toBe(true);
      expect(paths.has(join("node_modules", name, "lib", "nested", "a.js"))).toBe(true);
    }
    expect(layout.filter(p => p.startsWith("node_modules/.bin/")).length).toBeGreaterThan(0);
  });
});

const EXITED = Symbol("exited");

/** Await `event`, but if bun exits first, fail immediately with its output instead of hanging. */
async function orExit<T>(event: Promise<T>, proc: ReturnType<typeof spawnInstall>, what: string): Promise<T> {
  const r = Promise.withResolvers<T | typeof EXITED>();
  event.then(r.resolve);
  proc.exited.then(() => r.resolve(EXITED));
  const v = await r.promise;
  if (v === EXITED) {
    const { exitCode, stderr } = await finish(proc);
    throw new Error(`bun install exited (${exitCode}) before ${what}:\n${stderr}`);
  }
  return v;
}

/**
 * Bounded poll for `path` appearing. From outside, "bun never spawned the script" and "bun spawned
 * it and it has not written yet" look identical, so the only evidence of a regression is the file
 * itself. The bound is two bun startups, which outlast an `echo` that was spawned before the poll
 * began, so it scales with the machine instead of being a wall-clock sleep.
 */
async function appearsWithinBound(path: string): Promise<boolean> {
  for (let i = 0; i < 2; i++) {
    if (await file(path).exists()) return true;
    await using ref = spawn({ cmd: [bunExe(), "-e", "0"], env: bunEnv, stdout: "ignore", stderr: "ignore" });
    await ref.exited;
  }
  return file(path).exists();
}

/** Resolve once `cond` holds; callers race this against process exit via orExit(). */
async function until(cond: () => Promise<boolean>): Promise<void> {
  while (!(await cond())) await Bun.sleep(5);
}

/**
 * Registry served from the test:
 *   root: lib, app, scripted@2            -> tree 0
 *   app -> scripted@1 (conflicts with @2) -> nested under app (tree 1)
 * scripted@1 is trusted; its postinstall touches `marker`. Individual tarball
 * responses can be gated (held until released) or merely observed. With
 * `patched`, scripted@1 has a patch, which keeps it on the serial path. With
 * `selfContained`, the workspace apps/desktop (-> lib, tree 2) is self-contained.
 */
async function scriptsFixture({ patched = false, selfContained = false } = {}) {
  const root = tempDir("parallel-hoisted-scripts", {});
  const dir = String(root);
  const cacheDir = join(dir, ".bun-cache");
  const marker = join(dir, "scripted-postinstall-ran");
  const tarballs = join(dir, "tarballs");
  await mkdir(tarballs, { recursive: true });

  type Version = { dependencies?: Record<string, string>; scripts?: Record<string, string> };
  const registry: Record<string, Record<string, Version>> = {
    lib: { "1.0.0": {} },
    app: { "1.0.0": { dependencies: { scripted: "1.0.0" } } },
    scripted: {
      "1.0.0": { scripts: { postinstall: `echo ran > ${JSON.stringify(marker)}` } },
      "2.0.0": {},
    },
  };
  for (const [name, versions] of Object.entries(registry)) {
    for (const [version, extra] of Object.entries(versions)) {
      const pkgRoot = join(dir, "src", `${name}-${version}`);
      await mkdir(join(pkgRoot, "package"), { recursive: true });
      await write(join(pkgRoot, "package", "package.json"), JSON.stringify({ name, version, ...extra }));
      await write(join(pkgRoot, "package", "index.js"), `module.exports = ${JSON.stringify(`${name}@${version}`)};\n`);
      await $`tar -czf ${join(tarballs, `${name}-${version}.tgz`)} -C ${pkgRoot} package`.quiet();
    }
  }

  const gates = new Map<string, { requested: PromiseWithResolvers<void>; release: PromiseWithResolvers<void> }>();
  const observers = new Map<string, PromiseWithResolvers<void>>();
  const server = serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const tgz = path.match(/^\/tarballs\/(.+)\.tgz$/);
      if (tgz) {
        const gate = gates.get(tgz[1]);
        if (gate) {
          gate.requested.resolve();
          await gate.release.promise;
        }
        observers.get(tgz[1])?.resolve();
        return new Response(file(join(tarballs, `${tgz[1]}.tgz`)));
      }
      const name = path.slice(1);
      const versions = registry[name];
      if (!versions) return new Response("not found", { status: 404 });
      const body = Object.fromEntries(
        Object.entries(versions).map(([version, extra]) => [
          version,
          { name, version, ...extra, dist: { tarball: `${server.url}tarballs/${name}-${version}.tgz` } },
        ]),
      );
      return Response.json({ name, versions: body, "dist-tags": { latest: Object.keys(versions).at(-1) } });
    },
  });

  if (patched) {
    await write(
      join(dir, "patches", "scripted@1.0.0.patch"),
      [
        "diff --git a/index.js b/index.js",
        "--- a/index.js",
        "+++ b/index.js",
        "@@ -1 +1 @@",
        '-module.exports = "scripted@1.0.0";',
        '+module.exports = "scripted@1.0.0 (patched)";',
        "",
      ].join("\n"),
    );
  }
  if (selfContained) {
    await write(
      join(dir, "apps", "desktop", "package.json"),
      JSON.stringify({ name: "desktop", version: "1.0.0", dependencies: { lib: "1.0.0" } }),
    );
  }
  await write(
    join(dir, "package.json"),
    JSON.stringify({
      name: "scripts-fixture",
      version: "1.0.0",
      dependencies: { lib: "1.0.0", app: "1.0.0", scripted: "2.0.0" },
      trustedDependencies: ["scripted"],
      ...(patched ? { patchedDependencies: { "scripted@1.0.0": "patches/scripted@1.0.0.patch" } } : {}),
      ...(selfContained ? { workspaces: { packages: ["apps/*"], selfContained: ["apps/desktop"] } } : {}),
    }),
  );
  // Workspaces default to the isolated linker; this file is about the hoisted one.
  await write(
    join(dir, "bunfig.toml"),
    `[install]\ncache = "${cacheDir}"\nregistry = "${server.url}"\nlinker = "hoisted"\n`,
  );
  const env = { ...bunEnv, BUN_INSTALL_CACHE_DIR: cacheDir, BUN_INTERNAL_PARALLEL_HOISTED_MARKER: "1" };

  return {
    dir,
    cacheDir,
    marker,
    env,
    nested: join(dir, "node_modules", "app", "node_modules", "scripted", "package.json"),
    workspaceNodeModules: join(dir, "apps", "desktop", "node_modules"),
    async cacheHas(pattern: string): Promise<boolean> {
      for await (const _ of new Glob(pattern).scan({ cwd: cacheDir, onlyFiles: false })) return true;
      return false;
    },
    /** Hold `tarball` once requested; returns when it was requested plus a release() */
    gate(tarball: string) {
      const g = { requested: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() };
      gates.set(tarball, g);
      return { requested: g.requested.promise, release: () => g.release.resolve() };
    },
    /** Resolves once `tarball` has been handed to bun. */
    served(tarball: string) {
      const o = Promise.withResolvers<void>();
      observers.set(tarball, o);
      return o.promise;
    },
    /** Warm install with scripts on, then clear node_modules + marker and evict the given cache globs. */
    async warmThenEvict(...globs: string[]) {
      await using proc = spawnInstall(dir, env, []);
      const warm = await finish(proc);
      expect(warm.stderr).not.toContain("error:");
      expect(warm.exitCode).toBe(0);
      expect(await file(this.nested).exists()).toBe(true);
      expect(await file(marker).exists()).toBe(true);
      await rm(marker);
      await rm(join(dir, "node_modules"), { recursive: true, force: true });
      await rm(this.workspaceNodeModules, { recursive: true, force: true });
      for (const pattern of globs) {
        let hits = 0;
        for await (const entry of new Glob(pattern).scan({ cwd: cacheDir, onlyFiles: false })) {
          hits++;
          await rm(join(cacheDir, entry), { recursive: true, force: true });
        }
        expect(hits, `cache glob ${pattern} matched nothing`).toBeGreaterThan(0);
      }
      return installedCount(warm.stdout);
    },
    [Symbol.dispose]() {
      server.stop(true);
      root[Symbol.dispose]();
    },
  };
}

describe.concurrent.skipIf(!isPosix)("parallel hoisted install: rerouted downloads", () => {
  /**
   * A package's lifecycle scripts may only run once every ancestor tree is
   * installed, because its dependencies can be hoisted into any ancestor.
   * The serial linker gets this from can_install_package_for_tree(); the
   * parallel linker bypasses that gate, so a nested tree must not fire its
   * scripts during result replay while a rerouted root package is still in
   * flight. `lib`'s tarball is held, so the marker can only legitimately
   * appear after the test releases it.
   */
  test("nested tree's postinstall is deferred until a rerouted root package is installed", async () => {
    using fx = await scriptsFixture();
    await fx.warmThenEvict("lib@*");

    const lib = fx.gate("lib-1.0.0");
    await using proc = spawnInstall(fx.dir, fx.env, ["--frozen-lockfile"]);
    await orExit(lib.requested, proc, "requesting lib");
    try {
      // Replay (where a buggy build spawns the postinstall) finished before this request was sent.
      expect(
        await appearsWithinBound(fx.marker),
        "scripted@1's postinstall ran while its ancestor tree (root) was still waiting on lib",
      ).toBe(false);
    } finally {
      lib.release();
    }
    const out = await finish(proc);
    expect(out.stderr).not.toContain("error:");
    expect(out.exitCode).toBe(0);
    expect(parallelTaskCount(out.stderr)).toBe(4);
    expect(await file(join(fx.dir, "node_modules", "lib", "package.json")).exists()).toBe(true);
    expect(await file(fx.marker).exists()).toBe(true);
  });

  /**
   * The serial path treats a cache entry without its completion marker
   * (package.json for npm) as a miss. The worker must too, rather than
   * linking whatever partial contents the entry holds.
   */
  test("an entry missing its completion marker is re-downloaded, not linked", async () => {
    using fx = await scriptsFixture();
    const expected = await fx.warmThenEvict();
    // Keep lib's entry but strip its marker, leaving the rest of its files in place.
    let stripped = 0;
    for await (const entry of new Glob("lib@*").scan({ cwd: fx.cacheDir, onlyFiles: false })) {
      await rm(join(fx.cacheDir, entry, "package.json"));
      stripped++;
    }
    expect(stripped).toBeGreaterThan(0);

    await using proc = spawnInstall(fx.dir, fx.env, ["--frozen-lockfile"]);
    const out = await finish(proc);
    expect(out.stderr).not.toContain("error:");
    expect(out.exitCode).toBe(0);
    expect(parallelTaskCount(out.stderr)).toBe(4);
    // Re-downloaded: the installed copy has the file the cache entry lacked.
    expect(await file(join(fx.dir, "node_modules", "lib", "package.json")).exists()).toBe(true);
    expect(installedCount(out.stdout)).toBe(expected);
  });

  /**
   * Misses in two trees. The nested package downloads first but cannot
   * install until root is complete, so it parks in pending_installs; when
   * `lib` lands and completes root, the drain re-enters it with
   * NEEDS_VERIFY (re-verification since #36298). That re-entry must install
   * serially: a parallel task created after complete_parallel_installs() is
   * never replayed, so the package would be linked but never counted, bin
   * linked, or have its scripts run.
   */
  test("a package drained from pending_installs after replay is fully installed", async () => {
    using fx = await scriptsFixture();
    const expected = await fx.warmThenEvict("lib@*", "scripted@1.0.0*");

    const lib = fx.gate("lib-1.0.0");
    const nestedServed = fx.served("scripted-1.0.0");
    await using proc = spawnInstall(fx.dir, fx.env, ["--frozen-lockfile"]);
    try {
      await orExit(Promise.all([lib.requested, nestedServed]), proc, "downloading the evicted packages");
      // Once scripted@1 is back in the cache its extraction has completed, so its install attempt is
      // queued ahead of lib's (which has yet to download and extract): it will park in
      // pending_installs before root can complete, whenever lib is released after this point.
      await orExit(
        until(() => fx.cacheHas("scripted@1.0.0*")),
        proc,
        "re-extracting scripted@1",
      );
    } finally {
      lib.release();
    }
    const out = await finish(proc);
    expect(out.stderr).not.toContain("error:");
    expect(out.exitCode).toBe(0);
    expect(parallelTaskCount(out.stderr)).toBe(4);
    expect(await file(fx.nested).exists()).toBe(true);
    expect(installedCount(out.stdout)).toBe(expected);
    expect(await file(fx.marker).exists(), "scripted@1 was installed but its result was never handled").toBe(true);
  });

  /**
   * A package can also park in pending_installs during the tree walk itself: the patched
   * scripted@1 takes the serial path while root is still waiting on its parallel tasks. Root then
   * completes during replay, which (as a pending install) does not drain, so the forced drain that
   * follows replay has to install, count and run the scripts of the parked package.
   */
  test("a package parked during the tree walk is installed after replay", async () => {
    using fx = await scriptsFixture({ patched: true });
    const expected = await fx.warmThenEvict();

    await using proc = spawnInstall(fx.dir, fx.env, ["--frozen-lockfile"]);
    const out = await finish(proc);
    expect(out.stderr).not.toContain("error:");
    expect(out.exitCode).toBe(0);
    // lib, app and scripted@2; the patched scripted@1 is linked serially.
    expect(parallelTaskCount(out.stderr)).toBe(3);
    expect(await file(join(fx.dir, "node_modules", "app", "node_modules", "scripted", "index.js")).text()).toContain(
      "(patched)",
    );
    expect(installedCount(out.stdout)).toBe(expected);
    expect(await file(fx.marker).exists(), "scripted@1 was parked in pending_installs and never drained").toBe(true);
  });

  /**
   * A self-contained workspace's trees are in `copy_trees`: the serial linker copies their packages
   * instead of linking them from the cache, so that tools which rewrite that node_modules in place
   * cannot reach the cache. A worker has to make the same choice for the tree it was enqueued for.
   * --backend=hardlink makes the link counts meaningful on macOS too, where clonefile also gives 1.
   */
  test("a self-contained workspace gets copies, not links, from the parallel path", async () => {
    using fx = await scriptsFixture({ selfContained: true });
    const expected = await fx.warmThenEvict();

    await using proc = spawnInstall(fx.dir, fx.env, ["--frozen-lockfile", "--backend=hardlink"]);
    const out = await finish(proc);
    expect(out.stderr).not.toContain("error:");
    expect(out.exitCode).toBe(0);
    // root: lib, app, scripted@2; app: scripted@1; desktop: lib. The workspace link itself is serial.
    expect(parallelTaskCount(out.stderr)).toBe(5);
    expect(installedCount(out.stdout)).toBe(expected);
    // The root's copy is a hardlink from the cache; the workspace's is a real file.
    expect((await stat(join(fx.dir, "node_modules", "lib", "package.json"))).nlink).toBeGreaterThan(1);
    expect((await stat(join(fx.workspaceNodeModules, "lib", "package.json"))).nlink).toBe(1);
  });
});
