// Resolving a directory whose tsconfig.json uses "extends" used to leak every
// intermediate TSConfigJSON struct (and its PathsMap) in the chain. The merge
// loop in dirInfoUncached() popped each parent config, copied its fields into
// the base, and dropped the pointer on the floor — the code literally had a
// `// todo deinit these parent configs somehow?` comment. Combined with
// bustDirCache (which re-runs dirInfoUncached on every HMR / router reload),
// this re-leaked the whole chain on every cycle.
//
// The tsconfig re-parse path has several other ambient allocations into
// bun.default_allocator (file contents, JSON property arrays) that dwarf the
// TSConfigJSON struct itself, so RSS can't isolate this leak. Instead we use
// the debug-build `BUN_DEBUG_alloc=1` instrumentation which logs every
// bun.new()/bun.destroy() call, and count TSConfigJSON lifetimes directly.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import path from "path";

// The allocation log is only emitted in builds with Environment.allow_assert
// (debug/ReleaseSafe). Release CI lanes skip this; the gate runs under bun bd
// which is debug+ASAN, so it's covered.
test.skipIf(!isDebug)("tsconfig 'extends' chain frees every intermediate TSConfigJSON", async () => {
  // leaf -> tsconfig.1 -> tsconfig.2 -> ... -> tsconfig.N
  // Each hop defines paths so both leak sites are exercised: the overwritten
  // merged_config.paths and the dropped *TSConfigJSON struct.
  const chainDepth = 10;
  const files: Record<string, string> = {
    "d/index.ts": "export default 1;\n",
    "d/tsconfig.json": JSON.stringify({
      extends: "../base/tsconfig.1.json",
      compilerOptions: { paths: { "@leaf/*": ["./src/*"] } },
    }),
  };
  for (let i = 1; i <= chainDepth; i++) {
    files[`base/tsconfig.${i}.json`] = JSON.stringify({
      ...(i < chainDepth ? { extends: `./tsconfig.${i + 1}.json` } : {}),
      compilerOptions: { paths: { [`@base${i}/*`]: ["./src/*"] } },
    });
  }

  using dir = tempDir("tsconfig-extends-leak", files);
  const resolveFrom = path.join(String(dir), "d") + path.sep;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `Bun.resolveSync("./index.ts", ${JSON.stringify(resolveFrom)});`],
    env: {
      ...bunEnv,
      // Enable the `.alloc` scoped logger (emits "[alloc] new(T) = ..." /
      // "[alloc] destroy(T) = ..." for every bun.new/bun.destroy). This
      // overrides BUN_DEBUG_QUIET_LOGS for the `.alloc` scope specifically.
      BUN_DEBUG_alloc: "1",
    },
    // Run from the temp dir so the resolver doesn't pick up any stray
    // tsconfig.json from the repo root as an extra allocation.
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Output.scoped writes to whichever stream it chose at init; scan both.
  const output = stdout + stderr;
  const created = [...output.matchAll(/new\(TSConfigJSON\)/g)].length;
  const destroyed = [...output.matchAll(/destroy\(TSConfigJSON\)/g)].length;

  // The whole chain (leaf + chainDepth bases) must be parsed. dirInfoUncached
  // also walks every ancestor of the temp dir up to the filesystem root, so a
  // stray tsconfig.json/jsconfig.json in e.g. the developer's home directory
  // on Windows would add to `created` (and stay live in dir_cache) — don't
  // assert exact equality. The property the fix guarantees is that every
  // intermediate in the extends chain is destroyed; before the fix,
  // `destroyed` was 0 regardless of chain depth.
  expect(created).toBeGreaterThanOrEqual(chainDepth + 1);
  expect(destroyed).toBeGreaterThanOrEqual(chainDepth);
  // Only the merged config for d/ plus any ancestor configs outside the
  // fixture may remain live. On a clean CI runner this is exactly 1.
  expect(created - destroyed).toBeLessThan(chainDepth);
  expect(exitCode).toBe(0);
});

// Correctness: after freeing the intermediate structs, the merged config must
// still resolve paths defined in the leaf and keep the merge semantics intact.
// Guards against accidentally freeing data the merged config still references
// (the merged struct borrows string slices from the intermediates' source
// buffers, which outlive the struct).
test("tsconfig 'extends' merge still works after freeing intermediates", async () => {
  using dir = tempDir("tsconfig-extends-merge", {
    "tsconfig.base2.json": JSON.stringify({
      compilerOptions: {
        paths: { "@base/*": ["./lib/base/*"] },
      },
    }),
    "tsconfig.base1.json": JSON.stringify({
      extends: "./tsconfig.base2.json",
      compilerOptions: { jsx: "react-jsx" },
    }),
    "tsconfig.json": JSON.stringify({
      extends: "./tsconfig.base1.json",
      compilerOptions: {
        paths: { "@leaf/*": ["./lib/leaf/*"] },
      },
    }),
    "lib/leaf/thing.ts": `export const who = "leaf";`,
    "index.ts": `
      import { who } from "@leaf/thing";
      console.log(who);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("leaf");
  expect(exitCode).toBe(0);
});

// ── bustDirCache manifest re-parse leaks ───────────────────────────────────
// Every failed require()/import() busts the importer's directory (the
// retry-on-not-found loop in jsc_hooks.rs) and the rebuild in
// dirInfoUncached() re-parses that directory's package.json / tsconfig.json.
// The parses are interned into process-lifetime arenas (the DirInfo cache
// hands out 'static references), so before the keyed-reuse fix every distinct
// resolution miss grew RSS by roughly 7-12x the manifest size, forever and
// GC-immune. These tests pin the reuse behavior: an unchanged manifest must
// not grow the arena, and a changed manifest must still be picked up.
describe.concurrent("bustDirCache manifest re-parse", () => {
  test(
    "failed requires don't re-intern an unchanged package.json",
    async () => {
      // ~200KB manifest so the interned-parse cost dwarfs the other per-miss
      // allocations (dir entries, interned path strings) at a miss count low
      // enough for debug+ASAN builds.
      const imports: Record<string, string> = {};
      for (let i = 0; i < 6000; i++) imports[`#alias${i}`] = "./leak-fixture.js";

      using dir = tempDir("manifest-reparse-leak", {
        "package.json": JSON.stringify({ name: "reparse-leak-fixture", imports }, null, 2),
        "leak-fixture.js": `
        const rss = () => {
          Bun.gc(true);
          Bun.gc(true);
          return process.memoryUsage.rss();
        };
        // Warm up one parse generation plus lazy allocator state.
        for (let i = 0; i < 8; i++) {
          try { require("./warmup" + i); } catch {}
        }
        const before = rss();
        for (let i = 0; i < 64; i++) {
          try { require("./nosuch" + i); } catch {}
        }
        console.log(JSON.stringify({ growthMB: (rss() - before) / 1024 / 1024 }));
      `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "leak-fixture.js"],
        env: {
          ...bunEnv,
          // The fixed build frees each re-parse immediately; without a small
          // quarantine that freed memory sits in the ASAN quarantine (default
          // 256MB), counts toward RSS, and drowns the signal.
          ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=8:thread_local_quarantine_size_kb=64"]
            .filter(Boolean)
            .join(":"),
        },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      // 64 distinct misses against the ~200KB manifest re-interned ~90MB
      // before the fix (linear in miss count); with reuse the loop settles at
      // a few MB of allocator churn plus the ASAN quarantine.
      const { growthMB } = JSON.parse(stdout.trim().split("\n").at(-1)!);
      expect(growthMB).toBeLessThan(isASAN || isDebug ? 32 : 24);
      expect(exitCode).toBe(0);
    },
    // Each miss fully re-reads the directory and re-parses the manifest;
    // debug+ASAN needs more than the 5s default.
    30_000,
  );

  // Same counting approach as the extends-chain test above: the re-parse is
  // only observable in debug builds via the `.alloc` scoped logger.
  test.skipIf(!isDebug)("failed requires destroy the re-parse of an unchanged tsconfig.json", async () => {
    using dir = tempDir("tsconfig-reparse-leak", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@app/*": ["./src/*"] } } }),
      "fixture.js": `
        for (let i = 0; i < 12; i++) {
          try { require("./nosuch" + i); } catch {}
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: { ...bunEnv, BUN_DEBUG_alloc: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const output = stdout + stderr;
    const created = [...output.matchAll(/new\(TSConfigJSON\)/g)].length;
    const destroyed = [...output.matchAll(/destroy\(TSConfigJSON\)/g)].length;
    // Each of the 12 misses busts the fixture dir and re-parses its
    // tsconfig.json; the unchanged re-parse must be destroyed by the reuse
    // check. Before the fix `destroyed` stayed 0 while `created` grew per
    // miss. Slack of 3 covers the one live interned config plus any ancestor
    // configs outside the fixture (see the extends-chain test above).
    expect(created).toBeGreaterThanOrEqual(12);
    expect(created - destroyed).toBeLessThanOrEqual(3);
    expect(exitCode).toBe(0);
  });

  test("a failed require picks up a package.json edit on retry", async () => {
    using dir = tempDir("manifest-reparse-refresh", {
      "package.json": JSON.stringify({ name: "fixture", imports: { "#other": "./target.js" } }),
      "target.js": "module.exports = { ok: 1 };",
      "fixture.js": `
        const fs = require("node:fs");
        let failed = false;
        try { require("#x"); } catch { failed = true; }
        if (!failed) throw new Error("expected #x to fail before the manifest update");
        fs.writeFileSync(
          "package.json",
          JSON.stringify({ name: "fixture", imports: { "#other": "./target.js", "#x": "./target.js" } }),
        );
        if (require("#x").ok !== 1) throw new Error("expected #x to resolve after the manifest update");
        console.log("pass");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("pass");
    expect(exitCode).toBe(0);
  });

  test("a failed require picks up a tsconfig.json edit on retry", async () => {
    using dir = tempDir("tsconfig-reparse-refresh", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "unused-alias": ["./lib/thing.js"] } } }),
      "lib/thing.js": "module.exports = { ok: 1 };",
      // The alias must not contain a slash: the retry's cache bust targets
      // join(importer, specifier, ".."), which only lands on the importer's
      // directory (where the tsconfig lives) for slash-free specifiers.
      "fixture.js": `
        const fs = require("node:fs");
        let failed = false;
        try { require("leak-alias"); } catch { failed = true; }
        if (!failed) throw new Error("expected leak-alias to fail before the tsconfig update");
        fs.writeFileSync(
          "tsconfig.json",
          JSON.stringify({ compilerOptions: { paths: { "leak-alias": ["./lib/thing.js"] } } }),
        );
        if (require("leak-alias").ok !== 1) throw new Error("expected leak-alias to resolve after the tsconfig update");
        console.log("pass");
      `,
    });

    await using proc = Bun.spawn({
      // --no-install: the bare "leak-alias" miss must fail fast, not hit the
      // npm registry through auto-install.
      cmd: [bunExe(), "--no-install", "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("pass");
    expect(exitCode).toBe(0);
  });
});
