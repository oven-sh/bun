import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// A `&self` / `&mut self` method must not hand its own receiver to the type's
// teardown routine: `Self::destroy(ptr::from_mut(self))`, `Self::deinit(self as
// *mut _)`, `Self::finalize(ptr::from_mut(self))`, or the deferred forms
// `scopeguard::guard(ptr::from_mut(self), |p| Self::destroy(p))` and
// `scopeguard::guard(ptr::from_mut(self), Self::destroy)` (which free in the
// epilogue, while the receiver argument is still live) are banned.
//
// `destroy(this: *mut Self)` / `deinit(this: *mut Self)` / `finalize(this: *mut
// Self)` are the names this tree's "reclaim the Box" routines (`heap::take` /
// `heap::destroy` inside) go by. Under Stacked and Tree Borrows a reference
// argument is protected for the whole call, and deallocating protected memory
// is UB regardless of whether the reference is used again afterwards (Miri:
// "deallocating while item is strongly protected" under Stacked Borrows, "the
// strongly protected tag disallows deallocations" under Tree Borrows, the model
// `bun run rust:miri` checks; the protector is the model's counterpart of the
// `dereferenceable` attribute rustc puts on reference arguments, so this is not
// only a Miri concern). The method has to own the allocation instead: the
// caller that holds the raw pointer (a dispatch arm, a C callback) reclaims
// the box (`heap::take`) and calls a `self: Box<Self>` method, with the
// teardown in `Drop`, so every return path frees it; see
// `UVFSRequest::run_from_js_thread` / `NewAsyncCpTask::run_from_js_thread` in
// src/runtime/node/node_fs.rs and the arms that call them in
// src/runtime/dispatch.rs. Where the pointer cannot be turned back into a box
// at the entry point, the fallback is a `this: *mut Self` function that
// reborrows per statement and frees through `this` (see the comment on
// `deinit(this: *mut Self)` in src/sql_jsc/postgres/PostgresSQLConnection.rs).
//
// Scope: the single-expression shapes above, with the callee literally named
// `destroy`, `deinit` or `finalize` (`heap::destroy` counts as a `destroy`
// spelling). The name list is the enforcement boundary: a reclaim routine under
// another name is not caught until its name is added here. Deliberately
// outside it:
//   - the other reclaim primitives (`heap::take(from_mut(self))`,
//     `Box::from_raw(self as *mut _)`), a separate population one layer down
//     (#37672 adds the lint for them);
//   - refcount releases (`Self::deref(from_mut(self))`), which only free on the
//     last count, so each site needs its own argument about who else holds one;
//   - in-place finalizers and UFCS forwarding (`Self::finalize(self)`), which
//     take no address; a self-derived pointer stashed in a local and freed
//     later; reference parameters (`fn f(this: &mut T)` freeing `this`); and a
//     guard closure that does more than the one call.
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

// An optional `::<..>`, allowing one level of nesting (`::<Request<'a>>`).
const TURBOFISH = String.raw`(?:::<(?:[^<>]|<[^<>]*>)*>)?`;

// `self` (or a reborrow of it) as the sole argument of a pointer constructor.
const SELF_ARG = String.raw`\(\s*(?:&(?:mut\s+)?\*\s*)?self\s*\)`;

// The ways of spelling "`self`, as a raw pointer", optionally parenthesized and
// optionally followed by pointer-to-pointer conversions that keep it the same
// address (`.cast()`, `.cast_mut()`, `.as_ptr()`). `(?!\s*\.)` after
// `&raw mut *self` keeps a field's address (`&raw mut *self.inner`) out of it.
const SELF_AS_POINTER =
  String.raw`\(?\s*(?:` +
  [
    String.raw`(?:[\w:]+::)?from_(?:mut|ref)${TURBOFISH}${SELF_ARG}`,
    String.raw`(?:[\w:]+::)?NonNull::from${SELF_ARG}`,
    String.raw`&raw\s+(?:mut|const)\s+\*\s*self\b(?!\s*\.)`,
    String.raw`(?:[\w:]+::)?addr_of(?:_mut)?!\s*\(\s*\*\s*self\s*\)`,
    String.raw`self\s+as\s+\*(?:mut|const)\b[^,()]*`,
  ].join("|") +
  String.raw`)\s*\)?(?:\s*\.\s*(?:cast(?:_mut|_const)?${TURBOFISH}|as_ptr)\(\))*`;

// A teardown routine by path (`destroy`, `Self::deinit`, `bun_core::heap::destroy`,
// `Worker::deinit::<T>`), and the same followed by its opening paren (`\s*`
// after it so a rustfmt-wrapped argument list still matches).
const TEARDOWN_FN = String.raw`\b(?:[\w:]+::)?(?:destroy|deinit|finalize)${TURBOFISH}`;
const TEARDOWN = String.raw`${TEARDOWN_FN}\s*\(\s*`;

const DIRECT = new RegExp(`${TEARDOWN}${SELF_AS_POINTER}\\s*[,)]`, "g");

// `scopeguard::guard(<self as pointer>, |p| { unsafe { Self::destroy(p) } })` or
// `scopeguard::guard(<self as pointer>, Self::destroy)`: the guard's callback
// must be the teardown routine, applied (in the closure form, via the
// back-reference) to the guarded pointer itself. A guard over `self`'s address
// that does something else with it (src/runtime/ffi/ffi_body.rs frees a field)
// does not count.
const DEFERRED = new RegExp(
  String.raw`scopeguard::guard\(\s*${SELF_AS_POINTER}\s*,\s*(?:` +
    String.raw`(?:move\s+)?\|\s*(\w+)\s*\|\s*(?:\{\s*)?(?:unsafe\s*\{\s*)?${TEARDOWN}\1\s*\)` +
    String.raw`|${TEARDOWN_FN}\s*\))`,
  "g",
);

/** Every banned occurrence in one file's text, in line order. */
function scanText(content: string): { line: number; text: string }[] {
  // Strip full-line comments so prose mentions don't count and a SAFETY comment
  // inside a guard's closure doesn't break the match. `[ \t]*`, not `\s*`: `\s`
  // crosses newlines and would swallow blank lines, shifting the reported line
  // numbers.
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "");
  return [DIRECT, DEFERRED]
    .flatMap(re => [...stripped.matchAll(re)])
    .map(m => ({ line: stripped.slice(0, m.index).split("\n").length, text: m[0].replace(/\s+/g, " ") }))
    .sort((a, b) => a.line - b.line);
}

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
  // `CopyFileWindows::throw` / `resolve_promise` and `ReadFileUV::on_finish`
  // (`&mut self`) free the task they run on, reached through further
  // `&mut self` frames; #37705 converts them.
  "src/runtime/webcore/blob/copy_file.rs": 2,
  "src/runtime/webcore/blob/read_file.rs": 1,
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
  const hits = scanText(await file(abs).text());
  if (hits.length === 0) continue;
  counts[source] = hits.length;
  for (const { line, text } of hits.slice(ALLOW[source] ?? 0)) {
    offenders.push(`${source}:${line}: ${text}`);
  }
}

const matches = (snippet: string): boolean => scanText(snippet).length > 0;

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the tracked/realpath filters above over-firing and leaving
  // nothing to scan, which would make the ban below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
});

test("the patterns recognize the spellings they claim to", () => {
  const banned = [
    // The node_fs.rs lines this lint was written for.
    "unsafe { Self::destroy(std::ptr::from_mut::<Self>(self)) };",
    "let _deinit =\n    scopeguard::guard(core::ptr::from_mut(self), |p| unsafe { Self::destroy(p) });",
    // Other callees and other spellings of the receiver's address.
    "unsafe { Self::destroy(core::ptr::from_mut(self)) };",
    "unsafe { Self::deinit(std::ptr::from_mut::<Self>(self)) };",
    "Self::finalize(core::ptr::from_mut(self));",
    "unsafe { Worker::deinit(self as *mut Self) };",
    "unsafe { destroy(self as *const Self as *mut Self) }",
    "unsafe { Self::destroy(&raw mut *self) }",
    "unsafe { Self::destroy(core::ptr::addr_of_mut!(*self)) }",
    "unsafe { Self::destroy(ptr::from_ref(self).cast_mut()) }",
    "unsafe { Self::destroy(NonNull::from(self).as_ptr()) }",
    "unsafe { Self::destroy(ptr::from_mut(&mut *self)) }",
    "unsafe { Self::destroy((self as *mut Self).cast::<Base>()) }",
    "unsafe { Self::destroy::<true>(std::ptr::from_mut(self)) }",
    "unsafe { Self::destroy(std::ptr::from_mut::<Request<'a>>(self)) }",
    "unsafe { crate::node::fs::AsyncCpTask::destroy(std::ptr::from_mut(self)) }",
    "unsafe { bun_core::heap::destroy(std::ptr::from_mut::<Self>(self)) };",
    // Extra arguments after the pointer, and a rustfmt-wrapped call.
    "unsafe { Self::deinit(std::ptr::from_mut(self), allocator) }",
    "unsafe {\n    Self::destroy(\n        std::ptr::from_mut::<Self>(self),\n    )\n}",
    // Deferred: block body with a SAFETY comment, `move`, and the fn-value form.
    "let _g = scopeguard::guard(std::ptr::from_mut::<Self>(self), |this| {\n    // SAFETY: leaked in new(); freed exactly once here.\n    unsafe { Self::destroy(this) }\n});",
    "let _g = scopeguard::guard(self as *mut Self, move |p| unsafe { Self::deinit(p) });",
    "let _g = scopeguard::guard(core::ptr::from_mut(self), Self::destroy);",
    "let _g = scopeguard::guard(self as *mut Self, Worker::deinit);",
  ];
  const allowed = [
    // The converted shapes: the caller reclaims the box, or the pointer comes
    // in as a parameter.
    "unsafe { bun_core::heap::take(cast_ptr!(crate::node::fs::AsyncCpTask)) }.run_from_js_thread()?;",
    "unsafe { Self::destroy(this) }",
    "let _deinit = scopeguard::guard(this, |p| unsafe { Self::destroy(p) });",
    "let _guard = scopeguard::guard(this_ptr, Self::deinit);",
    "unsafe { FSWatchTask::deinit(t) };",
    // Freeing something the receiver owns is fine.
    "unsafe { Self::destroy(self.child) }",
    "unsafe { Worker::deinit(self.worker.as_ptr()) }",
    "unsafe { Self::destroy(&raw mut *self.inner) }",
    "unsafe { TCC::State::destroy(s.as_ptr()) };",
    // By-value teardown and UFCS forwarding of the reference itself take no
    // address.
    "self.deinit();",
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
    // A guard over the receiver's address whose callback frees a field,
    // releases a refcount, or frees some other pointer is out of scope.
    "let _guard = scopeguard::guard(std::ptr::from_mut::<Function>(self), |this_ptr| {\n    // SAFETY: this_ptr is self for the duration of compile().\n    if let Some(s) = unsafe { (*this_ptr).state.take() } {\n        unsafe { TCC::State::destroy(s.as_ptr()) };\n    }\n});",
    "let _g = scopeguard::guard(std::ptr::from_mut::<Self>(self), |s| {\n    unsafe { Self::deref_(s) }\n});",
    "let _g = scopeguard::guard(std::ptr::from_mut::<Self>(self), Self::deref_);",
    "let _g = scopeguard::guard(std::ptr::from_mut::<Self>(self), |_p| unsafe { Self::destroy(other) });",
    // Not the receiver.
    "unsafe { Self::destroy(std::ptr::from_mut::<Self>(self_)) };",
    "unsafe { Self::destroy(ptr::from_mut(task)) }",
    // Prose.
    "// Unlike `Self::destroy(std::ptr::from_mut::<Self>(self))`, this takes the box.",
  ];
  expect(banned.filter(s => !matches(s))).toEqual([]);
  expect(allowed.filter(matches)).toEqual([]);
});

test("a file is scanned with comments stripped and hits attributed to their lines", () => {
  // The three shapes `main` had in node_fs.rs, behind a comment that mentions
  // one of them and with a SAFETY comment inside the guard's closure. Unlike the
  // ratchet below, this keeps exercising the whole per-file pipeline once the
  // allowlist is empty.
  const fixture = [
    "// `Self::destroy(std::ptr::from_mut::<Self>(self))` is what this replaces.",
    "impl Task {",
    "    fn uv(&mut self) {",
    "        let _deinit =",
    "            scopeguard::guard(core::ptr::from_mut(self), |p| unsafe { Self::destroy(p) });",
    "    }",
    "    fn cp(&mut self) {",
    "        unsafe { Self::destroy(std::ptr::from_mut::<Self>(self)) };",
    "        unsafe { Self::destroy(self.child) };",
    "    }",
    "    fn guarded(&mut self) {",
    "        let _g = scopeguard::guard(std::ptr::from_mut::<Self>(self), |this| {",
    "            // SAFETY: leaked in new(); freed exactly once here.",
    "            unsafe { Self::deinit(this) }",
    "        });",
    "    }",
    "}",
  ].join("\n");
  expect(scanText(fixture)).toEqual([
    { line: 5, text: "scopeguard::guard(core::ptr::from_mut(self), |p| unsafe { Self::destroy(p)" },
    { line: 8, text: "Self::destroy(std::ptr::from_mut::<Self>(self))" },
    { line: 12, text: "scopeguard::guard(std::ptr::from_mut::<Self>(self), |this| { unsafe { Self::deinit(this)" },
  ]);
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
