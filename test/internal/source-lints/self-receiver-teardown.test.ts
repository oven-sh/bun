import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// A `&self` / `&mut self` method must not hand its own receiver to a teardown
// function: `Self::destroy(ptr::from_mut(self))`, `Self::deinit(self as *mut _)`,
// `Self::finalize(&raw mut *self)` and the like are banned.
//
// `destroy` / `deinit` / `finalize` taking `*mut Self` are the tree's
// convention for "consumes the heap allocation" (see `WriteFileWindows::deinit`
// in src/runtime/webcore/blob/write_file.rs), so a method that passes its
// receiver to one of them frees the allocation while that receiver is still a
// live argument of the method (and of every `&mut self` caller up the chain).
// A reference argument has to stay dereferenceable until the call it was passed
// to returns: Stacked Borrows rejects the free as "deallocating while item is
// strongly protected", Tree Borrows (what `bun run rust:miri` runs) as a
// deallocation forbidden by a protected tag, and LLVM is allowed to rely on the
// same thing (`dereferenceable` on the argument), so a load from `self` may be
// hoisted past the free. The fix is the shape the blob tasks use: the `&mut
// self` steps report what should happen (`Step`, in copy_file.rs / read_file.rs),
// and the raw-pointer entry point that owns the allocation performs the free.
//
// Scope: a single-expression receiver-as-pointer argument, spelled the ways
// listed in SELF_AS_POINTER, passed straight to an associated function with one
// of the three names. A self-derived pointer parked in a local or a scope guard
// first (node_fs.rs's `scopeguard::guard(from_mut(self), .. destroy ..)`) and
// refcount releases (`Self::deref(from_mut(self))`) and reclaiming the receiver
// directly (`heap::take(from_mut(self))`) are the same hazard in other shapes,
// and are not matched here.
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

// `Self::destroy(`, `Worker::deinit(`, `blob::ReadFileUV::finalize::<T>(` ...:
// the last path segment before the function has to be a type (capitalised), so
// free functions such as `heap::destroy(..)` (a direct reclaim, see above) are
// not matched.
const TEARDOWN_CALL = String.raw`\b[A-Z]\w*(?:::<[^>]*>)?::(?:destroy|deinit|finalize)(?:::<[^>]*>)?\s*\(\s*`;

// The ways of spelling "`self`, as a raw pointer" as the first argument.
// `(?!\s*\.)` after a bare `self` keeps `&raw mut *self.field` (a field's
// pointee) out of it.
const SELF_AS_POINTER = [
  String.raw`(?:[\w:]+::)?from_(?:mut|ref)(?:::<[^>]*>)?\(\s*self\s*\)`,
  String.raw`(?:[\w:]+::)?NonNull::from\(\s*self\s*\)`,
  String.raw`self\s+as\s+\*(?:mut|const)\b`,
  String.raw`&raw\s+(?:mut|const)\s+\*\s*self\b(?!\s*\.)`,
  String.raw`(?:[\w:]+::)?addr_of(?:_mut)?!\s*\(\s*\*\s*self\s*\)`,
].join("|");

const BANNED = new RegExp(`${TEARDOWN_CALL}(?:${SELF_AS_POINTER})`, "g");

// Documented, ratcheted exceptions: files allowed to keep exactly N of the
// shape. Each entry is the same bug in another subsystem, pending its own
// change; delete the entry when that lands. Prefer converting over adding one.
const ALLOW: Record<string, number> = {
  // `<ArrayBufferSink as JsSinkType>::finalize(&mut self)` forwards to
  // `Self::finalize(*mut Self)`, which frees the m_ctx payload; the receiver
  // shape comes from the `JsSinkType` trait / generated `__finalize` thunk.
  "src/runtime/webcore/ArrayBufferSink.rs": 1,
  // `Worker::deinit_soon(&mut self)` frees the worker itself on the
  // non-pool-thread path.
  "src/bundler/ThreadPool.rs": 1,
  // `LifecycleScriptSubprocess::handle_exit(&mut self)` frees the subprocess
  // at five exits, underneath the `&mut self` of the vtable thunks.
  "src/install/lifecycle_script_runner.rs": 5,
  // `NewAsyncCpTask::run_from_js_thread(&mut self)` frees the task it is
  // running on (shell and node:fs arms), dispatched as `(*ptr).run_from_js_thread()`.
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
  // Strip full-line comments so prose mentions (including the in-tree comments
  // describing this hazard) don't count. `[ \t]*`, not `\s*`: `\s` crosses
  // newlines and would swallow blank lines, shifting the reported line numbers.
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
    // The CopyFileWindows / ReadFileUV lines this lint was written for.
    "unsafe { Self::destroy(core::ptr::from_mut(self)) };",
    "Self::finalize(core::ptr::from_mut(self));",
    "unsafe { Self::destroy(std::ptr::from_mut::<Self>(self)) };",
    "unsafe { Self::deinit(std::ptr::from_mut::<Self>(self)) };",
    "Self::finalize(std::ptr::from_mut::<Self>(self));",
    "unsafe { Worker::deinit(ptr::from_ref(self).cast_mut()) }",
    "unsafe { blob::ReadFileUV::finalize(self as *mut Self) }",
    "unsafe { Self::destroy(&raw mut *self) }",
    "unsafe { Self::destroy(core::ptr::addr_of_mut!(*self)) }",
    "unsafe { Self::deinit(NonNull::from(self)) }",
    "unsafe { Task::<R>::destroy(core::ptr::from_mut(self)) }",
    "unsafe { Self::destroy::<true>(core::ptr::from_mut(self)) }",
    // rustfmt-wrapped call.
    "unsafe {\n    Self::destroy(\n        std::ptr::from_mut::<Self>(self),\n    )\n}",
  ];
  const allowed = [
    // Raw-pointer receivers and other parameters are the intended shape.
    "unsafe { Self::destroy(this) };",
    "unsafe { Self::finalize(this_ptr) }",
    "unsafe { Self::deinit(std::ptr::from_mut::<Self>(other)) };",
    // Tearing down something the receiver owns is fine.
    "unsafe { Worker::deinit(self.worker) };",
    "unsafe { Self::destroy(self.inner.as_ptr()) };",
    "unsafe { Child::destroy(&raw mut *self.child) }",
    "unsafe { Self::destroy(core::ptr::from_mut(self.task)) }",
    // Free functions (a direct reclaim) are a different shape.
    "unsafe { bun_core::heap::destroy(core::ptr::from_mut(self)) }",
    "unsafe { heap::destroy(std::ptr::from_mut::<Self>(self)) }",
    // Other associated functions may legitimately want the receiver's address.
    "Self::on_cares_complete(std::ptr::from_mut::<Self>(self), status);",
    "unsafe { Self::ref_(core::ptr::from_mut(self)) };",
    // Plain method calls and by-value teardown.
    "self.deinit();",
    "Self::deinit(self);",
    "Self::destroy(&mut self);",
  ];
  expect(banned.filter(s => !matches(s))).toEqual([]);
  expect(allowed.filter(matches)).toEqual([]);
});

test("no method passes its own receiver to destroy / deinit / finalize", () => {
  expect(offenders).toEqual([]);
});

test("allowlisted files still carry exactly their documented count", () => {
  // Ratchet: once an allowlisted instance is converted, delete (or lower) its
  // entry so a new one cannot take its place.
  for (const [f, n] of Object.entries(ALLOW)) {
    expect(counts[f] ?? 0).toBe(n);
  }
});
