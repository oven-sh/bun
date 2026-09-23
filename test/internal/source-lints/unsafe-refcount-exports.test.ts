import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// Rust-implemented refcount entry points exported to C++ (`#[unsafe(no_mangle)]`
// fns named `*__ref`, `*__deref`, `*__unref`, `*__release`) must be `unsafe fn`.
//
// Adjusting an intrusive count is only sound when the caller holds a count on
// an object that is actually refcounted, and no signature can prove that:
// releasing a count nobody owns frees the object out from under its owner, and
// bumping the count of a by-value instance turns its ordinary teardown into a
// free of a non-heap address. That obligation has to be an `unsafe` contract on
// the export itself, because the same symbol is callable from Rust (the
// `ExternalSharedDescriptor` impl, finalizers) as well as from the C++
// `RefDerefTraits` it exists for.
//
// Motivating instance: `Blob__ref` / `Blob__deref` in src/jsc/webcore_types.rs
// were safe `pub extern "C" fn`s over `&mut Blob`, re-exported from
// `bun_runtime::webcore`, so any safe code holding a `Blob` (stack local,
// `AnyBlob` payload) could release the count owned by the JS wrapper or an
// `ExternalShared<Blob>`. `Bun__VmHandle__release` in src/jsc/VmHandle.rs is the
// shape this lint requires.
//
// Scope: definitions only. `safe fn X__deref(..)` declarations of C++-implemented
// functions inside `unsafe extern "C" { .. }` blocks are a separate population,
// as are `*__destroy` shims over raw pointers. The suffix list is the
// enforcement boundary: a new refcount export under another name goes here too.
//
// Sibling guards: unsound-erased-box.test.ts, frozen-nonnull-reborrow.test.ts.

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

// `#[unsafe(no_mangle)]`, any further attributes, then the fn header. Group 1 is
// the `unsafe` qualifier (absent on an offender), group 2 the exported name.
// Doc comments between the attribute and the header are stripped below.
const REFCOUNT_EXPORT =
  /#\[unsafe\(no_mangle\)\]\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?(unsafe\s+)?extern\s+"C(?:-unwind)?"\s+fn\s+(\w+__(?:ref|deref|unref|release))\s*\(/g;

const found: string[] = [];
const offenders: string[] = [];
let scanned = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once under
  // its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const content = await file(abs).text();
  // Strip full-line comments (including `///` docs) so prose mentions don't
  // count and the attribute -> header match is not interrupted by a doc block.
  // `[ \t]*`, not `\s*`, so blank lines survive and line numbers stay right.
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "");
  for (const m of stripped.matchAll(REFCOUNT_EXPORT)) {
    const line = stripped.slice(0, m.index + m[0].lastIndexOf(m[2])).split("\n").length;
    const entry = `${source}:${line}: ${m[2]}`;
    found.push(entry);
    if (m[1] === undefined) offenders.push(entry);
  }
}

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the tracked/realpath filters above over-firing and leaving
  // nothing to scan, which would make the assertions below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
});

test("the pattern still recognizes the tree's refcount exports", () => {
  // If this goes empty, the exports were renamed or restructured and the
  // suffix list / regex above needs updating, not the assertion below.
  expect(found).not.toBeEmpty();
});

test('exported refcount entry points are declared `unsafe extern "C" fn`', () => {
  expect(offenders).toEqual([]);
});
