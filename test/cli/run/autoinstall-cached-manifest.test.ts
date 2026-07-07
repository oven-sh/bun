import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// Regression: when runtime auto-install (`enqueueDependencyToRoot`) finds a
// cached manifest on disk but not the extracted tarball, it calls
// `Lockfile.Package.fromNPM` which grows `lockfile.buffers.dependencies`.
// The `dependency` argument was a pointer directly into that buffer, so the
// subsequent `.extract` branch read `dependency.behavior` from freed memory
// (ASAN: use-after-poison).
//
// This test uses real npm like the neighbouring run-autoinstall.test.ts; the
// package only needs to have at least one dependency of its own so that
// `fromNPM` reallocates the single-entry dependencies buffer.
test("auto-install with cached manifest but missing tarball does not read a dangling dependency pointer", async () => {
  using dir = tempDir("autoinstall-cached-manifest", {});
  const cacheDir = join(String(dir), ".bun-cache");

  const env = {
    ...bunEnv,
    BUN_INSTALL_CACHE_DIR: cacheDir,
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
