import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// A method must not reclaim its own receiver's allocation: `heap::take` /
// `heap::destroy` / `Box::from_raw` applied to `self` or to a pointer spelled
// from `self` (`ptr::from_mut(self)`, `self as *mut _`, `&raw mut *self`, ...)
// inside a `&self` / `&mut self` method is banned.
//
// Two things are wrong with that shape, independently of whether the receiver
// really is a heap allocation:
//
//   - A reference proves nothing about ownership: any `&mut T` into the
//     object, however it was obtained, lets the method free an allocation
//     somebody else holds the pointer to (or a stack local that was never
//     heap-allocated at all).
//   - Even on the intended path it is UB under the aliasing models: a
//     reference argument is protected for the duration of the call, and
//     deallocating protected memory is rejected by both Stacked Borrows
//     ("deallocating while item is strongly protected") and Tree Borrows (the
//     model `bun run rust:miri` uses), even if `self` is never touched again.
//     The free has to go through the raw pointer the owner actually holds,
//     which is why the tree's functions that end in a free take
//     `this: *mut Self` (see `ReadBytesHandler::on_read_bytes` in
//     src/runtime/webcore/Blob.rs, `ReadFileCompletion::run` in
//     src/runtime/webcore/blob/read_file.rs, and the comments on `deinit` in
//     src/sql_jsc/postgres/PostgresSQLConnection.rs).
//
// The same calls are banned when their argument is spelled from a shared
// reference, whatever it refers to: `ptr::from_ref(x)`, `NonNull::from(&x)`,
// `&x`. Such a pointer may only read, so a free through it is UB under both
// models. `HTTPResponseMetadata` freed its header list through the
// `&'static [Header]` it stored, and `TranspilerJob` its path through
// `Path::text`. The owner holds the `Box` (or the raw pointer that
// `heap::into_raw` returned) and frees through that. It builds a view of the
// allocation when one is needed and does not store it: a reference stored
// beside the owner is protected, like `self` above, in every call the owner
// moves into by value.
//
// `&raw const x` and `addr_of!(x)` are banned with them. They take the
// permissions of the place `x`, which a regex cannot see: a place behind a raw
// `*mut` may be freed, a place behind a reference may not. On a raw place,
// write `&raw mut x` or `addr_of_mut!(x)`.
//
// Scope: these calls, with the argument spelled in the same expression. A
// pointer stashed in a local and freed later, a helper that takes the pointer
// and frees it (`Self::destroy(ptr::from_mut(self))`), reference *parameters*
// (`fn f(this: &mut T)` freeing `this`), and a free through any other call
// (`StdAllocator::free(&[u8])`, `default_alloc::free`) are outside this lint;
// they are the same bug, convert them on sight.
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

// Everything that turns a raw pointer back into an owning `Box` (and so frees
// it on drop), optionally path-qualified and turbofished.
const RECLAIM = String.raw`(?:heap::(?:take|destroy)|Box(?:::<[^>]*>)?::from_(?:raw|non_null))(?:::<[^>]*>)?\s*\(\s*`;

// The ways of spelling "`self`, as a raw pointer" as the first argument.
// `(?!\s*\.)` after a bare `self` keeps `&raw mut *self.field` (a field's
// pointee) and similar out of it; the bare `self` form needs the closing paren
// (optionally after rustfmt's trailing comma) for the same reason.
const SELF_AS_POINTER = [
  // `heap::take(self)`: `&mut T` coerces to `*mut T` at the call.
  String.raw`self\s*,?\s*\)`,
  String.raw`(?:[\w:]+::)?from_(?:mut|ref)(?:::<[^>]*>)?\(\s*self\s*\)`,
  String.raw`(?:[\w:]+::)?NonNull::from\(\s*self\s*\)`,
  String.raw`self\s+as\s+\*(?:mut|const)\b`,
  String.raw`&\s*(?:raw\s+(?:mut|const)|mut)\s+\*\s*self\b(?!\s*\.)`,
  String.raw`(?:[\w:]+::)?addr_of(?:_mut)?!\s*\(\s*\*\s*self\s*\)`,
].join("|");

// The ways of spelling "a pointer that is not known to be the owner's" as the
// first argument, whatever it points at: one from a shared reference, or a
// `*const` one from a place. `&mut x`, `&raw mut x` and `addr_of_mut!(x)` are
// not among them.
const SHARED_AS_POINTER = [
  // `ptr::from_ref(x)`, `NonNull::from_ref(x)`.
  String.raw`(?:[\w:]+::)?from_ref(?:::<[^>]*>)?\(`,
  String.raw`(?:[\w:]+::)?NonNull::from\(\s*&(?!\s*(?:mut|raw\s+mut)\b)`,
  // `&x as *const _ as *mut _`, `&raw const x`.
  String.raw`&(?!\s*(?:mut|raw\s+mut)\b)`,
  String.raw`(?:[\w:]+::)?addr_of!\s*\(`,
].join("|");

// `(?:\(\s*)*`: the pointer expression may be parenthesized before its cast.
const BANNED = new RegExp(String.raw`${RECLAIM}(?:\(\s*)*(?:${SELF_AS_POINTER}|${SHARED_AS_POINTER})`, "g");

// Documented, ratcheted exceptions: files allowed to keep exactly N of the
// shape. Prefer converting over adding an entry here.
const ALLOW: Record<string, number> = {
  // `Blob::deinit(&mut self)` frees heap-allocated blobs through its receiver.
  // It is being converted separately (#37672); delete this entry when that
  // lands.
  "src/jsc/webcore_types.rs": 1,
  // `free_owned_href(href: &'static [u8])` frees the URL of `fetch.preconnect`
  // through its parameter. #47023 deletes it. Delete this entry with it.
  "src/http/AsyncHTTP.rs": 1,
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
    // `<BlobReadChain as ReadBytesHandler>::on_read_bytes(&mut self)`, as it
    // was before the trait handed the pointer over.
    "let boxed = unsafe { bun_core::heap::take(std::ptr::from_mut::<Self>(self)) };",
    // `Blob::deinit(&mut self)`.
    "unsafe { drop(bun_core::heap::take(std::ptr::from_mut::<Blob>(self))) };",
    "unsafe { bun_core::heap::destroy(self) };",
    "drop(unsafe { Box::from_raw(self) });",
    "unsafe { heap::destroy(ptr::from_ref(self).cast_mut()) }",
    "unsafe { bun_core::heap::take(self as *const _ as *mut _) }",
    "drop(unsafe { Box::from_raw(self as *mut Self) });",
    "drop(unsafe { Box::from_raw(&raw mut *self) });",
    "drop(unsafe { Box::from_raw(&mut *self) });",
    "unsafe { heap::destroy(core::ptr::addr_of_mut!(*self)) }",
    "unsafe { Box::from_non_null(NonNull::from(self)) }",
    // rustfmt-wrapped calls.
    "unsafe {\n    bun_core::heap::take(\n        std::ptr::from_mut::<Blob>(self),\n    )\n}",
    "unsafe {\n    bun_core::heap::destroy(\n        self,\n    )\n}",
    // `HTTPResponseMetadata::drop` and `TranspilerJob::reset_for_pool`, as
    // they were: a free through the shared view the owner stored.
    "unsafe { bun_core::heap::destroy(core::ptr::from_ref(list).cast_mut()) };",
    "drop(unsafe { bun_core::heap::take(ptr::from_ref::<[u8]>(old_path.text).cast_mut()) });",
    "unsafe {\n    bun_core::heap::destroy(\n        core::ptr::from_ref(list).cast_mut(),\n    )\n}",
    // Other spellings of a pointer from a shared reference.
    "unsafe { Box::from_non_null(NonNull::from_ref(self.name)) }",
    "unsafe { Box::from_non_null(NonNull::from(&*self.name)) }",
    "drop(unsafe { Box::from_raw(&self.buf[..] as *const [u8] as *mut [u8]) });",
    // A `*const` pointer from a place. Behind a reference (`list`, `text`) the
    // free is UB. Behind a raw `this` it is not, and the spelling is banned
    // all the same: write `&raw mut`.
    "unsafe { heap::destroy((&raw const *list).cast_mut()) }",
    "unsafe { heap::take(core::ptr::addr_of!(*text).cast_mut()) }",
    "unsafe { heap::destroy(&raw const (*this).header as *mut Header) }",
  ];
  const allowed = [
    // Freeing something the receiver owns is fine.
    "unsafe { drop(bun_core::heap::take(self.worker_pool)) };",
    "drop(unsafe { bun_core::heap::take(self.0.as_ptr()) });",
    "unsafe { crate::heap::destroy(self.ptr.as_ptr()) };",
    "drop(unsafe { Box::from_raw(self.walker) });",
    "drop(unsafe { Box::from_raw(&raw mut *self.inner) });",
    "unsafe { heap::take(std::ptr::from_mut(self.inner)) }",
    // Raw-pointer receivers and other parameters are the intended shape /
    // out of scope.
    "unsafe { drop(bun_core::heap::take(this)) };",
    "unsafe { heap::take(self_ptr) }",
    "unsafe { bun_core::heap::destroy(std::ptr::from_mut::<Blob>(self_)) };",
    "unsafe { heap::take(ptr::from_mut(other)) }",
    // Producing a pointer from `self` without reclaiming it is fine.
    "let this = std::ptr::from_ref::<Blob>(self).cast_mut();",
    "Self::finalize(core::ptr::from_mut(self));",
    // So is producing one from any other shared reference.
    "let list = core::ptr::from_ref(self.response.headers.list);",
    // The owner's own pointer, `*const` or not, and a pointer from a `&mut`.
    "unsafe { bun_core::heap::take(core::ptr::slice_from_raw_parts_mut((*this).ptr.cast_mut(), len)) }",
    "unsafe { heap::destroy(self.data.cast_mut()) }",
    "unsafe { heap::take(ptr::from_mut(other.text)) }",
    "unsafe { Box::from_non_null(NonNull::from(&mut *slot)) }",
    "drop(unsafe { Box::from_raw(&mut *other) });",
    "drop(unsafe { Box::from_raw(&raw mut *other) });",
    "unsafe { heap::destroy(core::ptr::addr_of_mut!((*this).inner)) }",
  ];
  expect(banned.filter(s => !matches(s))).toEqual([]);
  expect(allowed.filter(matches)).toEqual([]);
});

test("no reclaim call names its own receiver, a shared reference or a `*const` place as its argument", () => {
  expect(offenders).toEqual([]);
});

test("allowlisted files still carry exactly their documented count", () => {
  // Ratchet: once an allowlisted instance is converted, delete its entry so
  // a new one cannot take its place.
  for (const [f, n] of Object.entries(ALLOW)) {
    expect(counts[f] ?? 0).toBe(n);
  }
});
