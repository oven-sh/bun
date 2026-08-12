import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// A `&self` / `&mut self` method must not hand its own receiver to a teardown
// function: `Self::deinit(ptr::from_mut(self))`, `Self::destroy(self as *mut _)`
// and the other spellings of "`self`, as a raw pointer" as the argument of a
// `deinit(..)` / `destroy(..)` call are banned.
//
// The tree's `deinit(this: *mut Self)` / `destroy(this: *mut Self)` functions
// end in `heap::take(this)`: they free the allocation. A reference argument is
// protected for the duration of the call it was passed to, and deallocating
// protected memory is UB under both aliasing models (Stacked Borrows:
// "deallocating while item is strongly protected"; Tree Borrows, which
// `bun run rust:miri` uses: "the strongly protected tag disallows
// deallocations"). Spelling the receiver as a raw pointer at the call does not
// help: the `&mut self` that the pointer was derived from is still a live,
// protected argument of the enclosing method while the callee frees it. This
// holds whether the callee frees synchronously or publishes the allocation to
// another thread that frees it before the method returns (the bundler's
// `Worker::deinit_soon` did both, depending on the branch).
//
// The fix is to take the pointer the owner actually holds all the way down:
// make the method `unsafe fn f(this: *mut Self)` (or return a disposition the
// raw-pointer caller acts on), read fields through statement-scoped
// `(*this).field` place expressions, and pass `this` itself to the teardown
// function. Templates: `Worker::deinit_soon` / `schedule_with_options` in
// src/bundler/ThreadPool.rs, `deinit` in
// src/sql_jsc/postgres/PostgresSQLConnection.rs,
// `run_from_js_thread` in src/runtime/node/node_zlib_binding.rs.
//
// Scope: the single-expression spellings below with `self` as the receiver and
// `deinit` / `destroy` as the callee (the tree's names for an unconditional
// free). Refcount releases (`deref(ptr::from_mut(self))`, which free only on
// the last count), `finalize` hops whose receiver shape a trait dictates, a
// self-derived pointer stashed in a local first, and reference *parameters*
// (`fn f(this: &mut T)` freeing `this`) are outside this lint.
//
// Sibling guards: fn-long-mut-reborrow.test.ts, frozen-nonnull-reborrow.test.ts,
// unsound-erased-box.test.ts.

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

// `deinit(` / `destroy(`, optionally path-qualified (`Self::deinit`,
// `Worker::deinit`, `RefCount::<Self>::destroy`, `bun_core::heap::destroy`) and
// turbofished. `\s*` after the paren so a rustfmt-wrapped argument list still
// matches.
const TEARDOWN = String.raw`\b(?:[\w:]+::)?(?:deinit|destroy)(?:::<[^>]*>)?\s*\(\s*`;

// The ways of spelling "`self`, as a raw pointer" as the first argument. A
// trailing `.cast_mut()` / `.cast()` on any of them still matches because the
// pattern only anchors the front of the argument. `(?!\s*\.)` after the bare
// `self` in the `&raw` form keeps `&raw mut *self.field` (a field's pointee,
// which the receiver owns) out of it.
const SELF_AS_POINTER = [
  String.raw`(?:[\w:]+::)?from_(?:mut|ref)(?:::<[^>]*>)?\(\s*self\s*\)`,
  String.raw`(?:[\w:]+::)?NonNull::from\(\s*self\s*\)`,
  String.raw`self\s+as\s+\*(?:mut|const)\b`,
  String.raw`&raw\s+(?:mut|const)\s+\*\s*self\b(?!\s*\.)`,
  String.raw`(?:[\w:]+::)?addr_of(?:_mut)?!\s*\(\s*\*\s*self\s*\)`,
].join("|");

const BANNED = new RegExp(`${TEARDOWN}(?:${SELF_AS_POINTER})`, "g");

// Documented, ratcheted exceptions: files allowed to keep exactly N of the
// shape while their conversion is in flight. Delete an entry when its file is
// converted; never raise one.
const ALLOW: Record<string, number> = {
  // `CopyFile::throw` / `resolve_promise` (`&mut self`) destroy the
  // heap-allocated task before resolving the promise.
  "src/runtime/webcore/blob/copy_file.rs": 2,
  // `LifecycleScriptSubprocess::handle_exit` (`&mut self`) destroys the
  // subprocess on five of its exit paths.
  "src/install/lifecycle_script_runner.rs": 5,
  // `AsyncCpTask::run_from_js_thread` (`&mut self`) destroys the task on both
  // of its completion paths.
  "src/runtime/node/node_fs.rs": 2,
};

const counts: Record<string, number> = {};
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
  // Strip full-line comments so prose mentions (doc comments describing this
  // hazard included) don't count. `[ \t]*`, not `\s*`: `\s` crosses newlines
  // and would swallow blank lines, shifting the reported line numbers.
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "");
  for (const m of stripped.matchAll(BANNED)) {
    const line = stripped.slice(0, m.index).split("\n").length;
    counts[source] = (counts[source] ?? 0) + 1;
    if ((counts[source] ?? 0) > (ALLOW[source] ?? 0)) {
      offenders.push(`${source}:${line}: ${m[0].replace(/\s+/g, " ")}`);
    }
  }
}

function matches(snippet: string): boolean {
  BANNED.lastIndex = 0;
  return BANNED.test(snippet);
}

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the tracked/realpath filters above over-firing and leaving
  // nothing to scan, which would make the ban below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
});

test("the pattern recognizes the spellings it claims to", () => {
  const banned = [
    // The `Worker::deinit_soon` line this lint was written for.
    "unsafe { Self::deinit(std::ptr::from_mut::<Self>(self)) };",
    // The allowlisted shapes.
    "unsafe { Self::destroy(std::ptr::from_mut::<Self>(self)) };",
    "unsafe { Self::destroy(core::ptr::from_mut(self)) };",
    // Other paths, callee spellings and pointer spellings.
    "unsafe { Worker::deinit(ptr::from_mut(self)) }",
    "unsafe { RefCount::<Self>::destroy(std::ptr::from_mut::<Self>(self)) };",
    "unsafe { Self::destroy::<true>(std::ptr::from_mut(self)) };",
    "unsafe { deinit(std::ptr::from_ref(self).cast_mut()) };",
    "unsafe { bun_core::heap::destroy(std::ptr::from_mut::<Self>(self)) };",
    "unsafe { Self::deinit(self as *mut Self) };",
    "unsafe { Self::deinit(self as *const Self as *mut Self) };",
    "unsafe { Self::destroy(&raw mut *self) };",
    "unsafe { Self::destroy(core::ptr::addr_of_mut!(*self)) };",
    "Self::deinit(NonNull::from(self));",
    // rustfmt-wrapped call.
    "unsafe {\n    Self::destroy(\n        std::ptr::from_mut::<Self>(self),\n    )\n};",
  ];
  const allowed = [
    // Passing the pointer the caller handed us is the intended shape.
    "unsafe { Self::deinit(this) };",
    "unsafe { crate::thread_pool::Worker::deinit_soon(worker) };",
    "unsafe { Self::destroy(std::ptr::from_mut::<Self>(this_)) };",
    "unsafe { Self::destroy(ptr::from_mut(other)) };",
    // Tearing down something the receiver owns is fine.
    "unsafe { Self::destroy(self.task) };",
    "unsafe { Worker::deinit(self.worker.as_ptr()) };",
    "unsafe { Self::deinit(&raw mut *self.inner) };",
    "unsafe { drop(bun_core::heap::take(self.worker_pool)) };",
    // UFCS forwarding of a reference receiver to a same-shaped inherent
    // method, and by-value teardown, are not this shape.
    "Self::deinit(self)",
    "self.deinit();",
    "Self::deinit(self, id)",
    // Producing the pointer without tearing anything down is fine.
    "let this = std::ptr::from_mut::<Self>(self);",
    // Other callee names are out of scope (see the header).
    "unsafe { Self::deref(std::ptr::from_mut::<Self>(self)) };",
    "Self::finalize(std::ptr::from_mut::<Self>(self));",
  ];
  expect(banned.filter(s => !matches(s))).toEqual([]);
  expect(allowed.filter(matches)).toEqual([]);
});

test("no method hands its own receiver to deinit/destroy", () => {
  expect(offenders).toEqual([]);
});

test("allowlisted files still carry exactly their documented count", () => {
  // Ratchet: once an allowlisted file is converted, delete its entry so a new
  // instance cannot take the converted one's place.
  for (const [f, n] of Object.entries(ALLOW)) {
    expect(counts[f] ?? 0).toBe(n);
  }
});
