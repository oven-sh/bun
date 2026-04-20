import { $, Glob, spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { lstat, mkdir, readlink, rm } from "fs/promises";
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

async function install(dir: string, env: NodeJS.Dict<string>, extraArgs: string[] = []) {
  const start = Bun.nanoseconds();
  await using proc = spawn({
    cmd: [bunExe(), "install", "--ignore-scripts", ...extraArgs],
    cwd: dir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const wallMicros = (Bun.nanoseconds() - start) / 1000;
  const usage = proc.resourceUsage();
  return { stdout, stderr, exitCode, wallMicros, usage };
}

describe.skipIf(!isPosix)("parallel hoisted install", () => {
  let fixture: { dir: string; deps: Record<string, string>; count: number };
  // CI's runner.node.mjs sets BUN_INSTALL_CACHE_DIR which
  // fetchCacheDirectoryPath() checks BEFORE bunfig's [install] cache,
  // so override it explicitly to keep the cache local to the fixture.
  let env: NodeJS.Dict<string>;

  beforeAll(async () => {
    fixture = await makeTarballFixture();
    env = { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(fixture.dir, ".bun-cache") };
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

    // every package dir, file and bin link must match exactly.
    expect(parallelLayout.length).toBeGreaterThan(fixture.count * 5);
    expect(parallelLayout).toEqual(serialLayout);

    const parallelBins = parallelLayout.filter(p => p.startsWith("node_modules/.bin/"));
    const serialBins = serialLayout.filter(p => p.startsWith("node_modules/.bin/"));
    expect(parallelBins.length).toBeGreaterThan(0);
    expect(parallelBins).toEqual(serialBins);

    // summary counts must match.
    const countFrom = (s: string) => Number(s.match(/(\d+)\s+packages? installed/)?.[1] ?? "0");
    expect(countFrom(parallel.stdout)).toBe(countFrom(serial.stdout));
    expect(countFrom(parallel.stdout)).toBe(fixture.count);
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

  // Observable difference between serial (pre-change) and parallel
  // linking: parallel linking spreads ~1.5k linkat/mkdirat syscalls
  // across the thread pool, so CPU time exceeds wall time on a
  // multi-core host. Serial linking does everything on the main
  // thread so CPU time ≤ wall time. The test asserts that the
  // default-path CPU/wall ratio is meaningfully higher than the
  // BUN_INSTALL_SERIAL_HOISTED=1 ratio.
  //
  // Without the parallel path, BUN_INSTALL_SERIAL_HOISTED doesn't
  // gate anything, so both ratios are ≈1.0 and the assertion fails.
  //
  // Skip on single-core machines where no fan-out is possible.
  test.skipIf((navigator.hardwareConcurrency ?? 1) < 2)("links packages in parallel on the thread pool", async () => {
    await rm(join(fixture.dir, "node_modules"), { recursive: true, force: true });
    const warm = await install(fixture.dir, env);
    expect(warm.exitCode).toBe(0);

    async function measure(e: NodeJS.Dict<string>) {
      await rm(join(fixture.dir, "node_modules"), { recursive: true, force: true });
      const r = await install(fixture.dir, e, ["--frozen-lockfile"]);
      expect(r.stderr).not.toContain("error:");
      expect(r.exitCode).toBe(0);
      const cpu = Number(r.usage?.cpuTime.user ?? 0n) + Number(r.usage?.cpuTime.system ?? 0n);
      return cpu / Math.max(1, r.wallMicros);
    }

    // Best-of-N per mode, interleaved to smooth over scheduler
    // noise / page-cache warmth on a busy CI host.
    const runs = 5;
    let parallelRatio = 0;
    let serialRatio = Infinity;
    for (let i = 0; i < runs; i++) {
      parallelRatio = Math.max(parallelRatio, await measure(env));
      serialRatio = Math.min(serialRatio, await measure({ ...env, BUN_INSTALL_SERIAL_HOISTED: "1" }));
    }

    console.log(`parallel cpu/wall: ${parallelRatio.toFixed(2)}`);
    console.log(`serial   cpu/wall: ${serialRatio.toFixed(2)}`);

    // Parallel should consume more CPU per wall-clock second than
    // serial by a clear margin. 1.15× covers ASAN builds where
    // per-spawn overhead compresses the ratio; on release builds
    // the gap is typically 1.5–2×.
    expect(parallelRatio / serialRatio).toBeGreaterThan(1.15);
  });
});
