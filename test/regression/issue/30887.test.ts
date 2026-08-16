import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// https://github.com/oven-sh/bun/issues/30887
//
// Under `--parallel` / `--isolate`, `bun test` reads transpiled preloads from
// the isolation source provider cache. That path dropped the `has_tla` flag
// on the cached module record, so JSC treated TLA preloads as having none
// and let their evaluation promise resolve before the top-level-await
// actually completed. The preload's side effects (like `Bun.env.X = ...`)
// then happened *after* the test file started running.
//
// These tests assert that the preload's top-level await is awaited to
// completion before the test file runs, across all three modes, and that
// the on-disk runtime transpiler cache survives a round-trip with TLA
// intact.

async function runTest(cwd: string, extraArgs: string[], extraEnv?: Record<string, string>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...extraArgs],
    env: { ...bunEnv, ...extraEnv },
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  return { stdout, stderr, exitCode };
}

test.concurrent.each([
  ["sequential (default)", []],
  ["--isolate", ["--isolate"]],
  ["--parallel", ["--parallel"]],
])("async preload is awaited before tests run (%s)", async (_name, flags) => {
  using dir = tempDir("bun-test-30887-", {
    "preload.ts": `
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      Bun.env.MY_ENV = "MUST_NOT_BE_UNDEFINED";
    `,
    "my.test.ts": `
      import { test, expect } from "bun:test";
      test("MY_ENV must not be undefined", () => {
        expect(Bun.env.MY_ENV).toBe("MUST_NOT_BE_UNDEFINED");
      });
    `,
    "bunfig.toml": `
[test]
preload = ["./preload.ts"]
    `,
  });

  const { stderr, exitCode } = await runTest(String(dir), flags);

  expect(stderr).toContain("1 pass");
  expect(stderr).toContain("0 fail");
  expect(exitCode).toBe(0);
});

// Runtime transpiler cache round-trip: a ≥4 KiB preload with top-level-await
// is cached on the first run, then read back from the on-disk cache on the
// second run. The cache-HIT path deserializes `module_info` straight from the
// stored `esm_record` without touching the AST, so if the serializer or the
// cache version doesn't preserve the `has_tla` flag, the second run will
// fail exactly like the original #30887 repro.
test("async preload survives runtime transpiler cache round-trip (--isolate)", async () => {
  // Pad the preload past MINIMUM_CACHE_SIZE (4 KiB). Declared variables are
  // enough — we just need byte-length, not any particular JS behavior.
  const padding = "\n" + Array.from({ length: 400 }, (_, i) => `const pad_${i} = ${i};`).join("\n");

  using dir = tempDir("bun-test-30887-cache-", {
    "preload.ts": `
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      Bun.env.MY_ENV = "MUST_NOT_BE_UNDEFINED";
      ${padding}
    `,
    "my.test.ts": `
      import { test, expect } from "bun:test";
      test("MY_ENV must not be undefined", () => {
        expect(Bun.env.MY_ENV).toBe("MUST_NOT_BE_UNDEFINED");
      });
    `,
    "bunfig.toml": `
[test]
preload = ["./preload.ts"]
    `,
  });

  const cachePath = join(String(dir), ".bun-cache");
  // `BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE=1` is required on debug
  // builds so `RuntimeTranspilerCache::get()` actually returns the loaded
  // entry instead of discarding it; without it the cache-HIT branch in
  // `RuntimeTranspilerStore` is never taken (precedent:
  // `test/cli/run/transpiler-cache.test.ts`).
  const extraEnv = {
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: cachePath,
    BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1",
  };

  // First run populates the cache.
  const first = await runTest(String(dir), ["--isolate"], extraEnv);
  expect(first.stderr).toContain("1 pass");
  expect(first.stderr).toContain("0 fail");
  expect(first.exitCode).toBe(0);

  // Second run reads from the cache. The cache-HIT branch builds
  // `module_info` via `create_from_cached_record`, never touching the AST —
  // so `has_tla` here comes entirely from the serialized bytes.
  const second = await runTest(String(dir), ["--isolate"], extraEnv);
  expect(second.stderr).toContain("1 pass");
  expect(second.stderr).toContain("0 fail");
  expect(second.exitCode).toBe(0);
});

// On-disk cache entries written before #30888 have `has_tla=false` baked
// into their serialized ESM record; without bumping `EXPECTED_VERSION`, the
// post-fix binary would happily read them back and reinstate the original
// bug. Simulate the stale-entry scenario by populating the cache, rewriting
// the 4-byte LE version header to the prior version (20), and asserting the
// next run overwrites it with the current version rather than silently
// accepting the stale entry.
test("stale transpiler cache entries are rejected (version bump)", async () => {
  const padding = "\n" + Array.from({ length: 400 }, (_, i) => `const pad_${i} = ${i};`).join("\n");

  using dir = tempDir("bun-test-30887-stale-", {
    "preload.ts": `
      await Promise.resolve();
      Bun.env.MY_ENV = "MUST_NOT_BE_UNDEFINED";
      ${padding}
    `,
    "my.test.ts": `
      import { test, expect } from "bun:test";
      test("MY_ENV must not be undefined", () => {
        expect(Bun.env.MY_ENV).toBe("MUST_NOT_BE_UNDEFINED");
      });
    `,
    "bunfig.toml": `
[test]
preload = ["./preload.ts"]
    `,
  });

  const cachePath = join(String(dir), ".bun-cache");
  const extraEnv = {
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: cachePath,
    BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1",
  };

  // First run populates the cache (so the filename and path layout exist).
  const first = await runTest(String(dir), ["--isolate"], extraEnv);
  expect(first.stderr).toContain("1 pass");
  expect(first.exitCode).toBe(0);

  // Locate the written `.pile` file(s) (covers `.debug.pile` on debug builds
  // and `.pile` on release builds). Read the current cache version from the
  // first file, then downgrade every entry's 4-byte LE version header to
  // `current - 1`. A binary that reverted the #30888 bump (back to 20)
  // would accept a `has_tla=false` entry verbatim; the fix requires the
  // decode to fail and the file to be re-transpiled and rewritten at the
  // current version. Reading the current version from the file (rather
  // than hardcoding 21) means this test doesn't need editing on every
  // future `EXPECTED_VERSION` bump — it still fails iff the version is
  // ever reverted to ≤ 20.
  const entries = readdirSync(cachePath).filter(n => n.endsWith(".pile"));
  expect(entries.length).toBeGreaterThan(0);
  const firstBytes = readFileSync(join(cachePath, entries[0]));
  expect(firstBytes.length).toBeGreaterThan(4);
  const currentVersion = firstBytes.readUInt32LE(0);
  // Guard against an accidental revert of the #30888 bump (20 → 21).
  expect(currentVersion).toBeGreaterThan(20);
  for (const name of entries) {
    const p = join(cachePath, name);
    const bytes = readFileSync(p);
    expect(bytes.readUInt32LE(0)).toBe(currentVersion);
    bytes.writeUInt32LE(currentVersion - 1, 0);
    writeFileSync(p, bytes);
  }

  // Second run must reject the stale entry, re-transpile, and overwrite.
  const second = await runTest(String(dir), ["--isolate"], extraEnv);
  expect(second.stderr).toContain("1 pass");
  expect(second.stderr).toContain("0 fail");
  expect(second.exitCode).toBe(0);

  // The cache file must now carry the current version byte, proving the
  // decode path rejected the stale header and forced a rewrite.
  for (const name of entries) {
    const bytes = readFileSync(join(cachePath, name));
    expect(bytes.readUInt32LE(0)).toBe(currentVersion);
  }
});
