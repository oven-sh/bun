import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// An intrusive-refcount release applied to a pointer spelled from a reference
//
//   FetchTasklet::deref(std::ptr::from_mut(self));
//   T::deref(std::ptr::from_ref(this).cast_mut());
//   Self::deref_nn(NonNull::from(self));
//   drop(ScopedRef::adopt(std::ptr::from_mut(self)));
//   let p = std::ptr::from_mut(self); ... Self::deref(p);
//
// is banned. A release may be the object's last one, and then the destructor
// frees the allocation the reference still points at. While the reference is
// a function (or closure) parameter, which `self` always is, both aliasing
// models reject that deallocation: Tree Borrows (what `bun run rust:miri` uses)
// reports "deallocation through <tag> is forbidden ... the strongly protected
// tag disallows deallocations", pointing at the `&mut self` receiver, and
// Stacked Borrows reports "deallocating while item [Unique] is strongly
// protected". `FetchTasklet::on_progress_update(&mut self)` was the canonical
// instance: every fetch's final progress hop released the tasklet's last ref
// from inside its own `&mut self`.
//
// The object was allocated as a raw pointer and every caller of these
// functions has it (a task arm's `task.ptr`, a callback's ctx, a `BackRef`'s
// `as_ptr()`), so the fix is structural: the function that owns the ref takes
// `this: *mut Self`, adopts the ref into a `bun_ptr::ScopedRef` before any
// reference to `*this` exists, and does its `&mut` work through a call-scoped
// reborrow (`Self::from_raw_mut(this).body()`); the guard releases when it
// drops, after that borrow is gone. Once every release of a type is a guard,
// the type needs no raw release function at all, and a `&mut self` method has
// nothing left to misuse (src/runtime/webcore/fetch/FetchTasklet.rs). When the
// reference is a local reborrow rather than a parameter the release is not UB,
// but the raw pointer it was made from is in scope; adopt that instead.
//
// This lint knows the `deref` family of release names and `ScopedRef::adopt`
// (`ScopedRef::new` takes its own ref and is balanced, so it is not a release);
// a release spelled `unref`/`release` is out of its reach. Siblings:
// fn-long-mut-reborrow.test.ts, frozen-nonnull-reborrow.test.ts.

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

// `deref(`, `deref_from_thread(`, `deref_nn(`, `deref_with_context(`,
// `rc_deref(`, however qualified (`\b` keeps `some_other_deref(` out), and
// `ScopedRef::adopt(` / `ScopedRef::<T>::adopt(`.
const RELEASE = String.raw`(?:\b(?:rc_)?deref(?:_from_thread|_nn|_with_context)?|\bScopedRef(?:::<[^>]*>)?::adopt)\(`;

// A pointer spelled from a reference. `ptr::from_mut` / `ptr::from_ref` only
// accept references, so any argument counts; the remaining spellings are
// pinned to `self`, where a raw-pointer operand is impossible.
const POINTER_FROM_REFERENCE = [
  String.raw`(?:std::|core::)?ptr::from_mut(?:::<[^>]*>)?\(`,
  String.raw`(?:std::|core::)?ptr::from_ref(?:::<[^>]*>)?\([^()]*\)\s*\.cast_mut\(\)`,
  String.raw`(?:(?:std|core)::ptr::|ptr::)?NonNull::from\(\s*self\s*\)`,
  String.raw`self\s+as\s+\*mut\b`,
  String.raw`&raw\s+mut\s+\*\s*self\b`,
].join("|");

// Release applied directly to such a pointer. `\s*` between the two so a
// rustfmt line break cannot hide it.
const DIRECT = new RegExp(RELEASE + String.raw`\s*(?:` + POINTER_FROM_REFERENCE + ")", "g");

// `let p = std::ptr::from_mut(self);` / `let p = self as *mut Self;`, whose
// binding is then released (`deref(p)`) further down the same function. The
// function ends at the next `fn` item; a closure inside it is still the same
// function for this purpose.
const SELF_POINTER_BINDING =
  /let\s+(?:mut\s+)?(\w+)\s*(?::[^=;]*)?=\s*(?:(?:std::|core::)?ptr::from_mut(?:::<[^>]*>)?\(\s*self\s*\)|self\s+as\s+\*mut\b[^;]*)\s*;/g;
const FN_ITEM = /^[ \t]*(?:pub(?:\([^)]*\))?\s+)?(?:(?:const|async|unsafe|extern\s+"[^"]*")\s+)*fn\s/m;

function releaseOfBinding(name: string): RegExp {
  return new RegExp(RELEASE + String.raw`\s*` + name + String.raw`\s*[,)]`);
}

/** Byte offsets (into `stripped`) of every banned release in one file. */
function findReleases(stripped: string): number[] {
  const hits: number[] = [];
  for (const m of stripped.matchAll(DIRECT)) hits.push(m.index);
  for (const binding of stripped.matchAll(SELF_POINTER_BINDING)) {
    const start = binding.index + binding[0].length;
    const rest = stripped.slice(start);
    const fnEnd = rest.search(FN_ITEM);
    const body = fnEnd === -1 ? rest : rest.slice(0, fnEnd);
    const release = body.search(releaseOfBinding(binding[1]));
    if (release !== -1) hits.push(start + release);
  }
  return hits.sort((a, b) => a - b);
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

// Documented, ratcheted exceptions: files allowed to keep exactly N of the
// shape. Every entry is a release that has been read and is either known to be
// harmless (another ref provably outlives the call) or tracked for its own
// fix. Lower the count when you convert one; do not add entries.
const ALLOW: Record<string, number> = {
  // Harmless: guarded by `ref_count > 1`; the final release goes through
  // `DeferredDerefTask` precisely because the caller still uses the object.
  "src/runtime/api/html_rewriter.rs": 1,
  // Harmless: `write_sync` balances the `ref_()` it took a few lines up while
  // the JS wrapper (the `this` of the call) holds its own ref.
  "src/runtime/node/node_zlib_binding.rs": 1,
  // Harmless: every `disarm` caller (`arm`, `finalize`, `deinit`) holds or
  // has already consumed its own ref across the call.
  "src/runtime/valkey_jsc/js_valkey.rs": 1,
  // `finalize(&mut self)`, reached through the generated `JSSink` finalize
  // thunk, releases the wrapper's ref, which is the last one for an idle
  // sink; the second site releases the keep-alive ref while the wrapper's ref
  // is still held. Needs the thunk to hand over the raw pointer; tracked
  // separately.
  "src/runtime/webcore/FileSink.rs": 2,
  // Harmless: every `close()` caller releases its own creation ref only after
  // `close()` returns.
  "src/spawn/process.rs": 1,
  // `on_write` releases the `start()` ref after `writer.close()` has let the
  // owner drop the creation ref, so on POSIX it frees the writer from inside
  // `on_write(&mut self)`; tracked separately. The other three sites run
  // while the owner's or the in-flight write's ref is held.
  "src/spawn/static_pipe_writer.rs": 4,
  // Harmless: `stmt` is a local reborrow and the queued request holds its own
  // ref on the statement until `release_statement`.
  "src/sql_jsc/postgres/PostgresSQLConnection.rs": 1,
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

test("the patterns match the banned spellings and nothing else", () => {
  const banned = [
    "FetchTasklet::deref(std::ptr::from_mut(self));",
    "FetchTasklet::deref(std::ptr::from_mut(this));",
    "unsafe { FileSink::deref(std::ptr::from_mut::<Self>(self)) };",
    "unsafe { RefCount::<Self>::deref(\n    std::ptr::from_mut::<Self>(self),\n) };",
    "unsafe { T::deref(std::ptr::from_ref::<T>(this).cast_mut()) };",
    "Self::deref_nn(NonNull::from(self));",
    "Self::deref_from_thread(self as *mut Self);",
    "unsafe { T::rc_deref(&raw mut *self) };",
    "drop(unsafe { ScopedRef::adopt(std::ptr::from_mut(self)) });",
    "let _ref = unsafe { ScopedRef::<Self>::adopt(\n    std::ptr::from_mut::<Self>(self),\n) };",
    "let this_ptr = std::ptr::from_mut(self);\nif done {\n    FetchTasklet::deref(this_ptr);\n    return;\n}",
    "let this: *mut Self = self as *mut Self;\nSelf::deref(this);",
    "let this = std::ptr::from_mut(self);\nlet _guard = unsafe { ScopedRef::adopt(this) };",
  ];
  const allowed = [
    "FetchTasklet::deref_from_thread(task);",
    "let _js_ref = is_done.then(|| unsafe { ScopedRef::adopt(this) });",
    "drop(unsafe { ScopedRef::<FetchTasklet>::adopt(task.as_ptr()) });",
    // `new` takes a ref of its own and releases that one: balanced.
    "let _guard = unsafe { ScopedRef::new(std::ptr::from_mut::<FileSink>(self)) };",
    "unsafe { ThreadSafeRefCount::<Self>::deref(this) };",
    "let self_ptr = std::ptr::from_mut::<FetchTasklet>(self);\nSelf::write_end_request(self_ptr, None);",
    // The binding is released, but in the next function, where it is a
    // raw-pointer parameter of the same name.
    "let this = std::ptr::from_mut(self);\nregister(this);\n}\n\nfn resume(this: *mut Self) {\n    Self::deref(this);\n}",
    "signal.clean_native_bindings(std::ptr::from_mut(self).cast::<c_void>());",
    "let value = strong.deref();",
    "some_other_deref(std::ptr::from_mut(self));",
  ];
  expect(banned.map(s => findReleases(s).length)).toEqual(banned.map(() => 1));
  expect(allowed.map(s => findReleases(s).length)).toEqual(allowed.map(() => 0));
});

test("refcount release through a pointer spelled from the receiver is banned", () => {
  expect(offenders).toEqual([]);
});

test("allowlisted files still carry exactly their documented count", () => {
  // Ratchet: when an allowlisted release is converted, lower its entry so the
  // shape cannot come back into that file.
  for (const [source, n] of Object.entries(ALLOW)) {
    expect({ source, count: counts[source] ?? 0 }).toEqual({ source, count: n });
  }
});
