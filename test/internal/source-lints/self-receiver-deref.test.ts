import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// An intrusive-refcount release handed the method's own receiver,
//
//   unsafe { PipeReader::deref(self) };            // `&mut self` coerces to `*mut Self`
//   unsafe { Self::deref_with_context(self, ctx) };
//   let _ref = unsafe { ScopedRef::adopt(&mut *self) };
//
// is banned. A release may be the object's last one, and then the destructor
// frees the allocation the receiver still points at. The receiver is a
// function argument, so it is protected for the whole call, and both aliasing
// models reject freeing protected memory even when `self` is never touched
// again: Tree Borrows (what `bun run rust:miri` uses) reports "deallocation
// through <tag> is forbidden ... the strongly protected tag disallows
// deallocations", pointing at the `&mut self`, and Stacked Borrows reports
// "deallocating while item [Unique] is strongly protected". The subprocess
// `PipeReader::on_reader_done`/`on_reader_error` were the canonical instance:
// every `Bun.spawn` stdout/stderr pipe ended by releasing the reader's last
// ref from inside its own `&mut self` (the Subprocess had dropped the other
// ref a line earlier, in `on_close_io`).
//
// The object was allocated as a raw pointer and every caller of such a
// function has that pointer (the `*mut Self` a vtable registered, a task's
// ctx, an `IntrusiveRc`'s `as_ptr()`), so the fix is to take `this: *mut Self`,
// do the `&mut` work through call-scoped reborrows, and release through `this`
// once they have ended, ideally by adopting the ref into a `bun_ptr::ScopedRef`
// first (src/runtime/api/bun/subprocess/SubprocessPipeReader.rs `finish`,
// src/runtime/shell/subproc.rs `PipeReader::on_reader_done`).
//
// Scope: the receiver itself as the argument, either coerced (`self`) or
// reborrowed in place (`&mut *self`), to the `deref` family of release
// functions or to `ScopedRef::adopt`. A pointer spelled out from the receiver
// (`deref(ptr::from_mut(self))`, `deref_nn(NonNull::from(self))`) is the same
// bug in a different spelling and has its own lint (#37703); the `&self`
// release methods some types expose (`self.deref()`) are a separate
// population. `Deref::deref(self)` is a borrow, not a release, and is ignored.
//
// Sibling guards: self-receiver-reclaim.test.ts (heap::take / Box::from_raw of
// the receiver), fn-long-mut-reborrow.test.ts.

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

// `deref(`, `deref_nn(`, `deref_from_thread(`, `deref_with_context(`, and the
// `rc_` variants, however path-qualified, plus `ScopedRef::adopt(` /
// `ScopedRef::<T>::adopt(`. The lookbehinds drop `fn deref(self)` items (a
// by-value receiver is a definition, not a call) and `Deref::deref(self)`.
const RELEASE = String.raw`(?:(?<!\bfn\s+)(?<!Deref::)\b(?:rc_)?deref(?:_nn|_from_thread|_with_context)?|\bScopedRef(?:::<[^>]*>)?::adopt)\s*\(\s*`;

// The receiver as the first argument: bare `self` or `&mut *self`, followed by
// the end of the argument. The terminator keeps `self.field`, `self.as_ptr()`
// and `&mut *self.inner` (things the receiver owns) out.
const RECEIVER = String.raw`(?:&\s*mut\s+\*\s*)?self\s*[,)]`;

const BANNED = new RegExp(RELEASE + RECEIVER, "g");

// Documented, ratcheted exceptions: files allowed to keep exactly N of the
// shape. Each is a release through the receiver that is being converted
// separately; lower the count when one is converted, do not add entries.
const ALLOW: Record<string, number> = {
  // `on_close` and `maybe_release` release the socket-ext ref through their
  // `&mut self`; with the registry ref already gone that is the session's last
  // ref (or the `ref_scope` guard built from the same receiver drops it a
  // line later).
  "src/http/h2_client/ClientSession.rs": 2,
  // `detach` releases the per-stream ref through its receiver.
  "src/http/h3_client/ClientSession.rs": 1,
  // `detach_and_deref` releases the ref its caller transferred in; its own
  // comment describes the call as the dealloc path.
  "src/http/ProxyTunnel.rs": 1,
};

function findReleases(stripped: string): number[] {
  return Array.from(stripped.matchAll(BANNED), m => m.index);
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

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
  // Strip full-line comments so prose mentions (including doc comments
  // describing this shape) don't count. `[ \t]*`, not `\s*`, so blank lines
  // survive and reported line numbers stay right.
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "");
  for (const offset of findReleases(stripped)) {
    counts[source] = (counts[source] ?? 0) + 1;
    if (counts[source] > (ALLOW[source] ?? 0)) {
      offenders.push(`${source}:${lineOf(stripped, offset)}`);
    }
  }
}

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the tracked/realpath filters above over-firing and leaving
  // nothing to scan, which would make the ban below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
});

test("the pattern matches the banned spellings and nothing else", () => {
  const banned = [
    // `PipeReader::on_reader_done(&mut self)` before it took the pointer.
    "unsafe { PipeReader::deref(self) };",
    "unsafe { ClientSession::deref(self) };",
    "unsafe { RefCount::<Self>::deref(self) }",
    "unsafe { Self::deref_with_context(self, ctx) };",
    "unsafe { T::rc_deref(self) };",
    "unsafe { <T as AnyRefCounted>::rc_deref_with_context(self, ()) };",
    "Self::deref_nn(self);",
    "Self::deref_from_thread(self);",
    "unsafe { Tunnel::deref(&mut *self) };",
    "let _ref = unsafe { ScopedRef::adopt(self) };",
    "let _ref = unsafe { bun_ptr::ScopedRef::<Self>::adopt(&mut *self) };",
    // rustfmt-wrapped call.
    "unsafe {\n    PipeReader::deref(\n        self,\n    )\n};",
  ];
  const allowed = [
    // Releasing through a raw pointer or a handle is the intended shape.
    "unsafe { PipeReader::deref(this) };",
    "unsafe { PipeReader::deref(pipe.as_ptr()) };",
    "unsafe { RefCount::deref(writer) };",
    "let _ref = unsafe { ScopedRef::adopt(this) };",
    "let _ref = unsafe { ScopedRef::adopt(self.as_ctx_ptr()) };",
    "unsafe { Self::deref(self.inner) };",
    "unsafe { Self::deref(&mut *self.inner) };",
    // Method-call spellings and `ScopedRef::new` (takes its own ref; balanced).
    "pipe.deref();",
    "self.deref();",
    "let _keepalive = unsafe { ScopedRef::new(this) };",
    // Definitions, `Deref` impls, unrelated names.
    "pub fn deref(self) {",
    "pub unsafe fn deref(this: *mut Self) {",
    "fn deref(&self) -> &T {",
    "core::ops::Deref::deref(self)",
    "Deref::deref(self)",
    "ThreadSafe::adopt(self)",
    "some_other_deref(self)",
    "self.deref_mut()",
  ];
  expect(banned.map(s => findReleases(s).length)).toEqual(banned.map(() => 1));
  expect(allowed.map(s => findReleases(s).length)).toEqual(allowed.map(() => 0));
});

test("no method releases its own receiver's refcount", () => {
  expect(offenders).toEqual([]);
});

test("allowlisted files still carry exactly their documented count", () => {
  // Ratchet: when an allowlisted release is converted, lower its entry so the
  // shape cannot come back into that file.
  for (const [source, n] of Object.entries(ALLOW)) {
    expect({ source, count: counts[source] ?? 0 }).toEqual({ source, count: n });
  }
});
