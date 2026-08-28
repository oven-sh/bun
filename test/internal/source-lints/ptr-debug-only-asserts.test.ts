import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// `bun_ptr` (src/ptr/) is the intrusive refcount and smart-pointer layer under
// `RefPtr` and every refcounted host (`FetchTasklet`, `JSValkeyClient`, ...).
// Its sanity checks compile out of release builds by design: `DebugData` and
// `ThreadLock` are `#[cfg(debug_assertions)]` state, and the count checks are
// `debug_assert!`. A bare `assert!` in this crate is a release-build abort
// ("Bun has crashed"), usually inside a destructor, for a refcount accounting
// slip that a debug or ASAN build already reports.
//
// Motivating instance: `RefCount::assert_no_refs` and
// `ThreadSafeRefCount::assert_no_refs` (src/ptr/ref_count.rs) were plain
// `assert!(count == 0)`, called from `FetchTasklet::drop` and
// `JSValkeyClient::drop`. They are `debug_assert_eq!` now.
//
// Spelling: `debug_assert!` / `debug_assert_eq!` / `debug_assert_ne!`. A bare
// `assert!` inside a `#[cfg(debug_assertions)]` block is flagged too; write it
// as `debug_assert!`. Compile-time `const { assert!(..) }` blocks and the
// `#[cfg(test)]` module at the tail of each file are out of scope.

const root = path.resolve(import.meta.dir, "..", "..", "..");

const rustSources = globAllSources().rust.filter(abs => {
  if (!abs.endsWith(".rs")) return false;
  return path.relative(root, abs).replaceAll(path.sep, "/").startsWith("src/ptr/");
});

// Only scan files tracked in HEAD (a `git stash` round-trip can leave stray
// `.rs` files in the working tree; CI runs on a clean checkout).
const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

// `assert!`, `assert_eq!`, `assert_ne!`. The lookbehind rejects the `debug_`
// prefix; the `!` rejects `assert_no_refs(` and friends.
const RUNTIME_ASSERT = /(?<!\w)assert(?:_eq|_ne)?!\s*\(/;

// Every file in the crate keeps its test module at the tail.
const TEST_CFG = /^#\[cfg\((?:all\()?test\b/;

// A compile-time const item: inline `const { .. }` or `const _: () = { .. };`.
// `const fn` bodies run at runtime and do not match.
const CONST_ITEM = /^\s*(?:pub(?:\([^)]*\))?\s+)?const\s+(?!(?:unsafe\s+)?fn\b)/;

function braceDelta(line: string): number {
  let depth = 0;
  for (const ch of line) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  return depth;
}

const scanned: string[] = [];
const offenders: string[] = [];
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned.push(source);
  const content = await file(abs).text();
  // Strip full-line comments so prose mentions do not count. `[ \t]*`, not
  // `\s*`, so blank lines survive and line numbers hold.
  const lines = content.replace(/^[ \t]*\/\/.*$/gm, "").split("\n");
  let constDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (TEST_CFG.test(line)) break;
    if (constDepth > 0) {
      constDepth += braceDelta(line);
      continue;
    }
    if (CONST_ITEM.test(line)) {
      constDepth = Math.max(0, braceDelta(line));
      continue;
    }
    if (RUNTIME_ASSERT.test(line)) offenders.push(`${source}:${i + 1}: ${line.trim()}`);
  }
}

test("scans the tracked bun_ptr sources", () => {
  expect(scanned).toContain("src/ptr/ref_count.rs");
});

test("the pattern matches a bare assert and not a debug one", () => {
  expect(RUNTIME_ASSERT.test("        assert!(self.raw_count.get() == 0);")).toBe(true);
  expect(RUNTIME_ASSERT.test("        assert_eq!(self.raw_count.get(), 0);")).toBe(true);
  expect(RUNTIME_ASSERT.test("        debug_assert_eq!(self.raw_count.get(), 0);")).toBe(false);
  expect(RUNTIME_ASSERT.test("        self.ref_count.assert_no_refs();")).toBe(false);
});

test("bun_ptr has no runtime assert outside its test modules", () => {
  expect(offenders).toEqual([]);
});
