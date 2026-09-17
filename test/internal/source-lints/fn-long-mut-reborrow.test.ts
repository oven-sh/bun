import { expect, test } from "bun:test";
import {
  isPathExpr,
  parseRustFragment,
  unwrapParens,
  type Local,
  type RustFile,
} from "../../../scripts/rust-parser/index.ts";
import { ratchet, rustSources } from "./rust-sources.ts";

// `let this = unsafe { &mut *this };` — the fn-long exclusive reborrow of a
// callback's raw pointer — is banned, under any binding name.
//
// The shape asserts exclusive access to the object for the rest of the
// function, but the functions that receive these pointers are callbacks
// (uSockets/libuv handlers, task-queue arms, vtable dispatch) whose bodies run
// JS or dispatch events that can re-enter the same object through its own
// accessors. Under Stacked/Tree Borrows the re-entrant access pops the
// fn-long tag, making every later use of the binding UB; before that it's an
// LLVM `noalias` miscompile hazard.
//
// Replacements, in preference order (see the sweep that removed the last ~370
// of these for worked examples):
//   - `let x = unsafe { &*ptr };` when everything reached is `&self` /
//     `Cell`/`JsCell` (TRAMPOLINE).
//   - Statement-scoped raw place access `unsafe { (*ptr).field = v };`, a
//     call-scoped `unsafe { &mut *ptr }` argument, `heap::take(ptr)` Box
//     reclaim, or a `&mut self` prep method invoked as
//     `unsafe { (*ptr).prep() }` (DEAD).
//   - Convert the type's touched state to `Cell`/`JsCell` and its methods to
//     `&self` (REENTRANT) — exemplars: `src/runtime/ipc.rs` (SendQueue),
//     `src/runtime/socket/UpgradedDuplex.rs`, `src/io/PipeReader.rs`'s raw
//     `read`/`on_poll` entry chain.
//
// Sibling guards: frozen-nonnull-reborrow.test.ts, unsound-erased-box.test.ts.

// The raw-pointer callback-parameter names used across the tree. The list is
// the enforcement boundary: reborrows of locals or fields (`&mut *self.log()`,
// `&mut *existing_ptr`) are a separate, pre-existing population outside this
// lint's scope. If you add a new raw callback-param name, add it here.
const PARAMS = [
  "this",
  "ctx",
  "p",
  "ptr",
  "self_ptr",
  "this_ptr",
  "raw",
  "task",
  "handle",
  "data",
  "context",
  "user_data",
  "parent",
  "client",
  "ws",
  "req",
  "resp",
  "socket",
];

/**
 * A `let` statement whose entire initializer is `unsafe { &mut *<param> }`.
 * The unsafe block must be the initializer itself and the reborrow must be the
 * block's value, so a call-scoped `unsafe { &mut *p }.method()` (a
 * `MethodCall` initializer) and `unsafe { &mut *p; }` (no value) do not count.
 * Parentheses around any part are seen through. Any pattern and any type
 * ascription count: `let (a, b) = unsafe { &mut *p };` holds the same fn-long
 * borrow through its two bindings.
 */
function isFnLongReborrow(local: Local): boolean {
  if (local.init === null) return false;
  const init = unwrapParens(local.init);
  if (init.kind !== "Unsafe" || init.block.stmts.length !== 1) return false;
  const stmt = init.block.stmts[0];
  if (stmt.kind !== "ExprStmt" || stmt.semi) return false;
  const ref = unwrapParens(stmt.expr);
  if (ref.kind !== "Ref" || !ref.mutable || ref.raw) return false;
  const deref = unwrapParens(ref.expr);
  if (deref.kind !== "Unary" || deref.op !== "*") return false;
  const place = unwrapParens(deref.expr);
  return PARAMS.some(name => isPathExpr(place, name));
}

function findFnLongReborrows(file: RustFile): Local[] {
  return file.find("Local").filter(isFnLongReborrow);
}

// Documented, ratcheted exceptions: files allowed to keep exactly N of the
// shape, with a stated reason. Empty by design — the whole tree is at zero.
// Prefer converting over adding an entry here.
const ALLOW: Record<string, number> = {};

const sources = rustSources();
const findings: { path: string; message: string }[] = [];
for (const src of sources) {
  for (const local of findFnLongReborrows(src.file)) {
    findings.push({
      path: src.path,
      message: `${src.file.location(local)}: ${src.file.text(local).replace(/\s+/g, " ")}`,
    });
  }
}
const { offenders, stale } = ratchet(findings, ALLOW);

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the corpus filters over-firing and leaving nothing to
  // scan, which would make the ban below pass vacuously.
  expect(sources.length).toBeGreaterThan(0);
});

test("the pattern recognizes the spellings it claims to", () => {
  const matches = (snippet: string) => findFnLongReborrows(parseRustFragment(snippet)).length > 0;
  const banned = [
    "let this = unsafe { &mut *this };",
    "let this: &mut Foo = unsafe { &mut *ptr };",
    "let mut this = unsafe { &mut *p };",
    "let handle = unsafe { &mut *user_data };",
    // rustfmt-wrapped binding.
    "let this: &mut WebSocketClient<Ssl> =\n    unsafe { &mut *this };",
    "let this = unsafe {\n    &mut *this\n};",
    // Spellings the old text match missed.
    "let this = unsafe { &mut (*this) };",
    "let this = (unsafe { &mut *this });",
  ];
  const allowed = [
    // Call-scoped: the reborrow ends with the call.
    "unsafe { &mut *p }.method();",
    "let x = unsafe { &mut *p }.method();",
    "foo(unsafe { &mut *p });",
    // Shared reborrow (TRAMPOLINE) and raw place access (DEAD).
    "let x = unsafe { &*p };",
    "let x = unsafe { (*p).field };",
    "unsafe { (*p).field = v };",
    // Raw pointer, not a reference.
    "let x = unsafe { &raw mut *p };",
    // A name outside the enforcement boundary.
    "let x = unsafe { &mut *other };",
    "let x = unsafe { &mut *self.inner };",
    // No value: the block is a statement, not a reborrow.
    "let x = unsafe { &mut *p; };",
    // Prose about the shape is not the shape.
    "// let this = unsafe { &mut *this };",
    'log("let this = unsafe { &mut *this };");',
  ];
  expect(banned.filter(s => !matches(s))).toEqual([]);
  expect(allowed.filter(matches)).toEqual([]);
});

test("fn-long `&mut *<callback param>` reborrow is banned", () => {
  expect(offenders).toEqual([]);
});

test("allowlisted files still carry exactly their documented count", () => {
  // Ratchet: if an allowlisted file drops below its budget (the shape was
  // finally converted), lower the ALLOW entry so no new one can slip back in.
  expect(stale).toEqual([]);
});
