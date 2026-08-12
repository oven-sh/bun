import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// A `&self` / `&mut self` method must not hand its own receiver to the type's
// teardown routine: `Self::destroy(ptr::from_mut(self))`, `Self::deinit(self as
// *mut _)`, `Self::finalize(ptr::from_mut(self))`, or the deferred form
// `scopeguard::guard(ptr::from_mut(self), |p| Self::destroy(p))` (which frees
// in the epilogue, while the receiver argument is still live) are banned.
//
// `destroy(this: *mut Self)` / `deinit(this: *mut Self)` / `finalize(this: *mut
// Self)` are this tree's names for "reclaim the Box" (`heap::take` /
// `heap::destroy` inside). Under Stacked and Tree Borrows a reference argument
// is protected for the whole call, and deallocating protected memory is UB
// regardless of whether the reference is used again afterwards ("deallocating
// while item is strongly protected" / "the strongly protected tag disallows
// deallocations" under Miri, the model `bun run rust:miri` checks; the
// protector is the model's counterpart of the `dereferenceable` attribute
// rustc puts on reference arguments, so this is not only a Miri concern). The
// function that frees has to take the allocation pointer (`this: *mut Self`)
// and reborrow per statement, with its caller (a dispatch arm, a C callback, a
// scope guard over the raw pointer) passing the pointer through; see the
// comment on `deinit(this: *mut Self)` in
// src/sql_jsc/postgres/PostgresSQLConnection.rs, and `finish(this: *mut Self)`
// in src/runtime/webcore/blob/{copy_file,read_file}.rs for a state machine
// whose `&mut self` steps report the outcome instead of freeing.
//
// Scope: the two single-expression shapes above, with the callee literally
// named `destroy`, `deinit` or `finalize` (the name list is the enforcement
// boundary; a new teardown routine under another name goes here too;
// `heap::destroy` counts as a `destroy` spelling). An in-place `finalize(&mut
// self)` called as `self.finalize()` never takes the receiver's address and so
// is not matched. Deliberately outside it:
//   - the other reclaim primitives (`heap::take(from_mut(self))`,
//     `Box::from_raw(self as *mut _)`), a separate population one layer down;
//   - refcount releases (`Self::deref(from_mut(self))`), which only free on the
//     last count, so each site needs its own argument about who else holds one;
//   - a self-derived pointer stashed in a local and freed later, and reference
//     parameters (`fn f(this: &mut T)` freeing `this`).
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

// The ways of spelling "`self`, as a raw pointer", optionally followed by
// pointer-to-pointer conversions that keep it the same address (`.cast()`,
// `.cast_mut()`, `.as_ptr()`). `(?!\s*\.)` after `&raw mut *self` keeps a
// field's address (`&raw mut *self.inner`) out of it.
const SELF_AS_POINTER =
  String.raw`(?:` +
  [
    String.raw`(?:[\w:]+::)?from_(?:mut|ref)(?:::<[^>]*>)?\(\s*self\s*\)`,
    String.raw`(?:[\w:]+::)?NonNull::from\(\s*self\s*\)`,
    String.raw`&raw\s+(?:mut|const)\s+\*\s*self\b(?!\s*\.)`,
    String.raw`(?:[\w:]+::)?addr_of(?:_mut)?!\s*\(\s*\*\s*self\s*\)`,
    String.raw`self\s+as\s+\*(?:mut|const)\b[^,()]*`,
  ].join("|") +
  String.raw`)(?:\s*\.\s*(?:cast(?:_mut|_const)?(?:::<[^>]*>)?|as_ptr)\(\))*`;

// `destroy(` / `deinit(` / `finalize(`, optionally path-qualified (`Self::`,
// `Worker::`, `bun_core::heap::`) and turbofished. `\s*` after the paren so a
// rustfmt-wrapped argument list still matches.
const TEARDOWN = String.raw`\b(?:[\w:]+::)?(?:destroy|deinit|finalize)(?:::<[^>]*>)?\s*\(\s*`;

const DIRECT = new RegExp(`${TEARDOWN}${SELF_AS_POINTER}\\s*[,)]`, "g");

// `scopeguard::guard(<self as pointer>, |p| { unsafe { Self::destroy(p) } })`:
// the guard's closure must apply the teardown routine to the guarded pointer
// (the back-reference), so a guard over `self`'s address that does something
// else with it (src/runtime/ffi/ffi_body.rs frees a field) does not count.
const DEFERRED = new RegExp(
  String.raw`scopeguard::guard\(\s*${SELF_AS_POINTER}\s*,\s*(?:move\s+)?\|\s*(\w+)\s*\|\s*(?:\{\s*)?(?:unsafe\s*\{\s*)?${TEARDOWN}\1\s*\)`,
  "g",
);

// Documented, ratcheted exceptions: files allowed to keep exactly N of the
// shape while their conversion is in flight. Delete an entry when its file is
// converted; never raise one.
const ALLOW: Record<string, number> = {
  // `LifecycleScriptSubprocess::handle_exit` / `deinit_and_delete_package`
  // (`&mut self`) free the subprocess at five sites; #37551 turns them into a
  // disposition that the raw-pointer thunks act on.
  "src/install/lifecycle_script_runner.rs": 5,
  // `Worker::deinit_soon` (`&mut self`) frees itself inline when the worker
  // was created off the pool; #37685 converts it.
  "src/bundler/ThreadPool.rs": 1,
  // `UVFSRequest::run_from_js_thread` (the deferred form) and the two
  // completion paths of `NewAsyncCpTask::run_from_js_thread` (`&mut self`)
  // free the task they run on; #37693 converts them.
  "src/runtime/node/node_fs.rs": 3,
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
  // Strip full-line comments so prose mentions (and SAFETY comments inside a
  // guard's closure) don't count or break a match. `[ \t]*`, not `\s*`: `\s`
  // crosses newlines and would swallow blank lines, shifting the reported line
  // numbers.
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "");
  const hits = [DIRECT, DEFERRED]
    .flatMap(re => [...stripped.matchAll(re)])
    .map(m => ({ line: stripped.slice(0, m.index).split("\n").length, text: m[0].replace(/\s+/g, " ") }))
    .sort((a, b) => a.line - b.line);
  if (hits.length === 0) continue;
  counts[source] = hits.length;
  for (const { line, text } of hits.slice(ALLOW[source] ?? 0)) {
    offenders.push(`${source}:${line}: ${text}`);
  }
}

function matches(snippet: string): boolean {
  DIRECT.lastIndex = 0;
  DEFERRED.lastIndex = 0;
  return DIRECT.test(snippet) || DEFERRED.test(snippet);
}

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the tracked/realpath filters above over-firing and leaving
  // nothing to scan, which would make the ban below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
});

test("the patterns recognize the spellings they claim to", () => {
  const banned = [
    // The copy_file.rs / read_file.rs lines this lint was written for.
    "unsafe { Self::destroy(core::ptr::from_mut(self)) };",
    "Self::finalize(core::ptr::from_mut(self));",
    // The same shape elsewhere in the tree.
    "unsafe { Self::destroy(std::ptr::from_mut::<Self>(self)) };",
    "let _deinit =\n    scopeguard::guard(core::ptr::from_mut(self), |p| unsafe { Self::destroy(p) });",
    "Self::finalize(std::ptr::from_mut::<Self>(self));",
    // Other spellings of the receiver's address.
    "unsafe { Self::deinit(std::ptr::from_mut::<Self>(self)) };",
    "unsafe { Worker::deinit(self as *mut Self) };",
    "unsafe { destroy(self as *const Self as *mut Self) }",
    "unsafe { Self::destroy(&raw mut *self) }",
    "unsafe { Self::destroy(core::ptr::addr_of_mut!(*self)) }",
    "unsafe { Self::destroy(ptr::from_ref(self).cast_mut()) }",
    "unsafe { Self::destroy(NonNull::from(self).as_ptr()) }",
    "unsafe { Self::destroy::<true>(std::ptr::from_mut(self)) }",
    "unsafe { crate::node::fs::AsyncCpTask::destroy(std::ptr::from_mut(self)) }",
    "unsafe { bun_core::heap::destroy(std::ptr::from_mut::<Self>(self)) };",
    // Extra arguments after the pointer, and a rustfmt-wrapped call.
    "unsafe { Self::deinit(std::ptr::from_mut(self), allocator) }",
    "unsafe {\n    Self::destroy(\n        std::ptr::from_mut::<Self>(self),\n    )\n}",
    // Deferred: block body, `move`, a SAFETY comment already stripped to a blank line.
    "let _g = scopeguard::guard(std::ptr::from_mut::<Self>(self), |this| {\n\n    unsafe { Self::destroy(this) }\n});",
    "let _g = scopeguard::guard(self as *mut Self, move |p| unsafe { Self::deinit(p) });",
  ];
  const allowed = [
    // The converted shapes: the pointer comes in as a parameter.
    "unsafe { Self::destroy(this) }",
    "unsafe { Self::finalize(this) };",
    "let _deinit = scopeguard::guard(this, |p| unsafe { Self::destroy(p) });",
    "unsafe { Self::destroy(cast_ptr!(crate::node::fs::AsyncCpTask)) }",
    "unsafe { FSWatchTask::deinit(t) };",
    // Freeing something the receiver owns is fine.
    "unsafe { Self::destroy(self.child) }",
    "unsafe { Worker::deinit(self.worker.as_ptr()) }",
    "unsafe { Self::destroy(&raw mut *self.inner) }",
    "unsafe { TCC::State::destroy(s.as_ptr()) };",
    // By-value / in-place teardown and UFCS forwarding of the reference itself
    // are not this shape.
    "self.deinit();",
    "self.finalize();",
    "self.io_request.deinit();",
    "Self::deinit(self)",
    "Self::deinit(self, id)",
    "Self::finalize(self)",
    // Producing the receiver's address for something other than teardown.
    "self.req.data = core::ptr::from_mut(self).cast::<c_void>();",
    "unsafe { Self::deref_(std::ptr::from_mut::<Self>(self)) };",
    "unsafe { Self::teardown(core::ptr::from_mut(self), Teardown::MainThreadExit) };",
    // The other primitives are a separate population (see the scope note).
    "unsafe { drop(bun_core::heap::take(std::ptr::from_mut::<Self>(self))) };",
    // A guard over the receiver's address whose closure frees a field, or
    // releases a refcount, is out of scope.
    "let _guard = scopeguard::guard(std::ptr::from_mut::<Function>(self), |this_ptr| {\n    if let Some(s) = unsafe { (*this_ptr).state.take() } {\n        unsafe { TCC::State::destroy(s.as_ptr()) };\n    }\n});",
    "let _g = scopeguard::guard(std::ptr::from_mut::<Self>(self), |s| {\n    unsafe { Self::deref_(s) }\n});",
    // A guard that frees a different pointer than the one it guards.
    "let _g = scopeguard::guard(std::ptr::from_mut::<Self>(self), |_p| unsafe { Self::destroy(other) });",
    // Not the receiver.
    "unsafe { Self::destroy(std::ptr::from_mut::<Self>(self_)) };",
    "unsafe { Self::destroy(ptr::from_mut(task)) }",
  ];
  expect(banned.filter(s => !matches(s))).toEqual([]);
  expect(allowed.filter(matches)).toEqual([]);
});

test("no method hands its own receiver to destroy/deinit/finalize", () => {
  expect(offenders).toEqual([]);
});

test("allowlisted files still carry exactly their documented count", () => {
  // Ratchet: once an allowlisted file is converted, delete its entry so a new
  // instance cannot take the old one's place.
  for (const [f, n] of Object.entries(ALLOW)) {
    expect(counts[f] ?? 0).toBe(n);
  }
});
