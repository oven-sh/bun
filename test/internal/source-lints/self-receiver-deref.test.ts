import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// An intrusive refcount release, or a keep-alive guard, applied to the bare
// receiver of a `&self` / `&mut self` method:
//
//   unsafe { ClientSession::deref(self) };          // `&mut Self` coerces to `*mut Self`
//   unsafe { SessionRefGuard::new(self) }            // ScopedRef built from the receiver
//
// is banned. A release may be the object's last one, and then the destructor
// frees the allocation while the receiver, a reference argument of the
// function still running, is live. Both aliasing models reject that
// deallocation even when the reference is never touched again: Tree Borrows
// (what `bun run rust:miri` uses) reports "deallocation through <tag> is
// forbidden ... the strongly protected tag disallows deallocations" pointing
// at the `&mut self`, and Stacked Borrows reports "deallocating while item
// [Unique] is strongly protected". A guard built from the receiver has the
// same problem one step later: its drop, still inside the method, is the last
// release whenever the guarded body released the other holders' refs (an h2
// session failing its streams releases the registry's and the socket's; a
// proxy tunnel delivering the response's last bytes releases the client's).
//
// Every object released this way was handed to the method by something that
// holds a pointer to it (a socket ext slot, a registry or pool entry, a
// `RefPtr` field, a stream's backref), so the fix is to let the function that
// performs the release take that pointer (`this: ThisPtr<Self>` /
// `NonNull<Self>`), do its `&mut` work through a borrow that ends first, and
// release through the pointer afterwards; or, when the ref being released
// provably is not the last one, to release it through the holder's own
// pointer (src/http/h2_client/ClientSession.rs, src/http/ProxyTunnel.rs and
// src/http/h3_client/ClientSession.rs show each of these).
//
// Scope: the bare `self` spellings above. A pointer spelled out from the
// receiver first (`ptr::from_mut(self)`, `NonNull::from(&mut *self)`) and
// then released or wrapped in a guard is the same bug; convert it on sight.
// Sibling guards: self-receiver-reclaim.test.ts (unconditional frees of the
// receiver), fn-long-mut-reborrow.test.ts, frozen-nonnull-reborrow.test.ts.

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

// `Type::deref(self)` and the other raw-pointer release entry points of the
// refcount traits, with the receiver as their (first) argument. The `::`
// keeps `fn deref(self)` definitions of by-value handles out of it.
const RELEASE_OF_RECEIVER = String.raw`::(?:rc_)?deref(?:_from_thread|_with_context)?\(\s*self\s*[,)]`;

// `ScopedRef::new(self)` / `ScopedRef::adopt(self)`, including through the
// `type FooRefGuard = ScopedRef<Foo>;` aliases the refcounted types declare.
const GUARD_FROM_RECEIVER = String.raw`\b\w*(?:ScopedRef|RefGuard)(?:::<[^>]*>)?::(?:new|adopt)\(\s*self\s*\)`;

const BANNED = new RegExp(`(?:${RELEASE_OF_RECEIVER})|(?:${GUARD_FROM_RECEIVER})`, "g");

// Documented, ratcheted exceptions: files allowed to keep exactly N of the
// shape. Lower the count when you convert one; do not add entries.
const ALLOW: Record<string, number> = {
  // `on_reader_done` / `on_reader_error` release the reader's own ref through
  // their receiver; being converted separately, together with the pipe reader
  // dispatch that hands them the `&mut`. Delete this entry when that lands.
  "src/runtime/api/bun/subprocess/SubprocessPipeReader.rs": 2,
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
  // Strip full-line comments so prose describing this shape doesn't count.
  // `[ \t]*`, not `\s*`, so blank lines survive and line numbers stay right.
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "");
  for (const m of stripped.matchAll(BANNED)) {
    counts[source] = (counts[source] ?? 0) + 1;
    if (counts[source] > (ALLOW[source] ?? 0)) {
      const line = stripped.slice(0, m.index).split("\n").length;
      offenders.push(`${source}:${line}: ${m[0]}`);
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
    "unsafe { ClientSession::deref(self) };",
    "unsafe { ProxyTunnel::deref( self ) };",
    "unsafe { Self::deref(self) }",
    "unsafe { <Self as CellRefCounted>::deref(self) };",
    "unsafe { T::rc_deref(self) };",
    "FetchTasklet::deref_from_thread(self);",
    "unsafe { Self::deref_with_context(self, ctx) };",
    "unsafe {\n    ClientSession::deref(\n        self,\n    )\n}",
    "unsafe { SessionRefGuard::new(self) }",
    "let _guard = unsafe { bun_ptr::ScopedRef::new(self) };",
    "let _guard = unsafe { ScopedRef::<Self>::adopt(self) };",
    "unsafe { TunnelRefGuard::adopt(self) }",
  ];
  const allowed = [
    // Releasing or guarding through a pointer someone holds is the fix.
    "unsafe { ClientSession::deref(this.as_ptr()) };",
    "unsafe { ClientSession::deref(entry) };",
    "unsafe { ClientSession::deref(session) };",
    "unsafe { ProxyTunnel::deref(http) };",
    "unsafe { h2::ClientSession::deref(s.as_ptr()) };",
    "let _guard = unsafe { bun_ptr::ScopedRef::new(this.as_ptr()) };",
    "let _keep_alive = this.ref_guard();",
    // Releasing something the receiver owns is fine.
    "unsafe { ClientSession::deref(self.session) };",
    "unsafe { Foo::deref(self.ptr.as_ptr()) };",
    // The handle types' own methods: `t.deref()` releases the handle's ref,
    // and a by-value `deref(self)` is a definition, not a release of `self`.
    "t.deref();",
    "self.deref();",
    "pub fn deref(self) {",
    "fn rc_deref(this: *mut Self);",
    // Other by-value constructors named `new` take `self` all the time.
    "Wrapper::new(self)",
    "Guard::new(self)",
    "RefPtr::new(self)",
  ];
  expect(banned.filter(s => !matches(s))).toEqual([]);
  expect(allowed.filter(matches)).toEqual([]);
});

test("no method releases or guards its own receiver's refcount", () => {
  expect(offenders).toEqual([]);
});

test("allowlisted files still carry exactly their documented count", () => {
  // Ratchet: once an allowlisted instance is converted, lower or delete its
  // entry so a new one cannot take its place.
  for (const [source, n] of Object.entries(ALLOW)) {
    expect({ source, count: counts[source] ?? 0 }).toEqual({ source, count: n });
  }
});
