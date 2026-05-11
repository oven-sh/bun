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

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
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
