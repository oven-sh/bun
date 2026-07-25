import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// https://github.com/oven-sh/bun/issues/31976
//
// `bun_jsc::rare_data::ErasedBox` paired a `pub ptr: NonNull<c_void>` with a
// `pub dtor: unsafe fn(*mut c_void)` and called `dtor(ptr)` from a safe `Drop`.
// Because both fields were public, fully-safe code could forge an arbitrary
// pointer/destructor pair via a struct literal and get UB on drop. The type
// (and the never-populated `RareData.websocket_deflate` slot holding it) was
// dead code and was deleted. An erased owner whose destructor runs in a safe
// `Drop` must keep its fields private and gate construction behind an
// `unsafe fn`, so the pairing invariant is acknowledged at every call site.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const rustSources = globAllSources().rust.filter(p => p.endsWith(".rs"));

// Only scan files tracked in HEAD (a `git stash` round-trip can leave stray
// `.rs` files in the working tree; CI runs on a clean checkout). Same guard as
// dead-code-escapes.test.ts.
const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

// Read and preprocess each file once; both tests scan the cache.
const sources = new Map<string, string>();
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once under
  // its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  const content = await file(abs).text();
  // Strip full-line comments so prose mentions don't count.
  const stripped = content.replace(/^\s*\/\/.*$/gm, "");
  sources.set(source, stripped);
}

function scan(pattern: RegExp): string[] {
  const offenders: string[] = [];
  for (const [source, stripped] of sources) {
    if (pattern.test(stripped)) {
      offenders.push(source);
    }
  }
  return offenders;
}

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the tracked/realpath filters above over-firing (e.g. a
  // symlinked checkout root) and leaving nothing to scan, which would make the
  // assertions below pass vacuously.
  expect(sources.size).toBeGreaterThan(0);
});

test("ErasedBox (safe-forgeable ptr/dtor pair) stays deleted", () => {
  expect(scan(/\bErasedBox\b/)).toEqual([]);
});

test("no pub destructor function-pointer fields", () => {
  // A `pub dtor: unsafe fn(..)` field lets safe code in any crate swap in an
  // arbitrary destructor; whatever later calls it (typically a safe `Drop`)
  // then runs a forged function on a forged pointer.
  expect(scan(/\bpub\s+dtor\s*:\s*unsafe\s+fn\b/)).toEqual([]);
});
