import { expect, test } from "bun:test";
import {
  isSelf,
  parseRustFragment,
  pathEndsWith,
  unwrapParens,
  type Call,
  type Expr,
  type RustFile,
} from "../../../scripts/rust-parser/index.ts";
import { ratchet, rustSources } from "./rust-sources.ts";

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
// Scope: the single-expression spellings below, with `self` as the receiver.
// A self-derived pointer stashed in a local and freed later, a helper that
// takes the pointer and frees it (`Self::destroy(ptr::from_mut(self))`), and
// reference *parameters* (`fn f(this: &mut T)` freeing `this`) are outside this
// lint; they are the same bug, convert them on sight.
//
// Sibling guards: fn-long-mut-reborrow.test.ts, frozen-nonnull-reborrow.test.ts,
// unsound-erased-box.test.ts.

// Everything that turns a raw pointer back into an owning `Box` (and so frees
// it on drop). Matched by path suffix, so `bun_core::heap::take::<T>` counts.
const RECLAIM = ["heap::take", "heap::destroy", "Box::from_raw", "Box::from_non_null"];

// Calls that produce a raw pointer from a reference.
const TO_POINTER = ["from_mut", "from_ref", "NonNull::from"];

/** `self`, spelled as a raw pointer. */
function isSelfAsPointer(expr: Expr): boolean {
  expr = unwrapParens(expr);
  switch (expr.kind) {
    // `heap::take(self)`: `&mut T` coerces to `*mut T` at the call.
    case "PathExpr":
      return isSelf(expr);
    // `ptr::from_mut::<T>(self)`, `NonNull::from(self)`.
    case "Call":
      return expr.args.length === 1 && isSelf(expr.args[0]) && TO_POINTER.some(name => pathEndsWith(expr.callee, name));
    // `self as *mut Self`, `self as *const _ as *mut _`.
    case "Cast":
      return expr.ty.kind === "TypePtr" && isSelfAsPointer(expr.expr);
    // `&mut *self`, `&raw mut *self`, `&raw const *self`. A field's pointee
    // (`&raw mut *self.inner`) is the receiver's own allocation to free.
    case "Ref":
      return (expr.mutable || expr.raw) && expr.expr.kind === "Unary" && expr.expr.op === "*" && isSelf(expr.expr.expr);
    // `addr_of_mut!(*self)`.
    case "Macro": {
      if (!pathEndsWith(expr.path, "addr_of") && !pathEndsWith(expr.path, "addr_of_mut")) return false;
      const arg = expr.args[0];
      return expr.args.length === 1 && arg !== null && arg.kind === "Unary" && arg.op === "*" && isSelf(arg.expr);
    }
    // `ptr::from_ref(self).cast_mut()`, `NonNull::from(self).as_ptr()`: any
    // method on one of the pointer spellings above. Methods on bare `self`
    // (`self.as_ptr()`) return something the receiver owns, not the receiver.
    case "MethodCall":
      return unwrapParens(expr.receiver).kind !== "PathExpr" && isSelfAsPointer(expr.receiver);
    default:
      return false;
  }
}

/** Reclaim calls whose first argument is `self` as a pointer. */
function findReclaimsOfSelf(file: RustFile): Call[] {
  return file.find("Call").filter(call => {
    if (call.args.length === 0 || !RECLAIM.some(name => pathEndsWith(call.callee, name))) return false;
    return isSelfAsPointer(call.args[0]);
  });
}

// Documented, ratcheted exceptions: files allowed to keep exactly N of the
// shape. Prefer converting over adding an entry here.
const ALLOW: Record<string, number> = {
  // `Blob::deinit(&mut self)` frees heap-allocated blobs through its receiver.
  // It is being converted separately (#37672); delete this entry when that
  // lands.
  "src/jsc/webcore_types.rs": 1,
};

const sources = rustSources();
const findings: { path: string; message: string }[] = [];
for (const src of sources) {
  for (const call of findReclaimsOfSelf(src.file)) {
    findings.push({
      path: src.path,
      message: `${src.file.location(call)}: ${src.file.text(call).replace(/\s+/g, " ")}`,
    });
  }
}
const { offenders, stale } = ratchet(findings, ALLOW);

test("scans a non-empty set of tracked Rust sources", () => {
  expect(sources.length).toBeGreaterThan(0);
});

test("the pattern recognizes the spellings it claims to", () => {
  const matches = (snippet: string) => findReclaimsOfSelf(parseRustFragment(snippet)).length > 0;
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
    // Spellings the old text match missed.
    "unsafe { heap::destroy((self as *mut Self)) }",
    "debug_assert!(unsafe { Box::from_raw(self) }.is_empty());",
  ];
  const allowed = [
    // Freeing something the receiver owns is fine.
    "unsafe { drop(bun_core::heap::take(self.worker_pool)) };",
    "drop(unsafe { bun_core::heap::take(self.0.as_ptr()) });",
    "unsafe { crate::heap::destroy(self.ptr.as_ptr()) };",
    "drop(unsafe { Box::from_raw(self.walker) });",
    "drop(unsafe { Box::from_raw(&raw mut *self.inner) });",
    "unsafe { heap::take(std::ptr::from_mut(self.inner)) }",
    "unsafe { heap::take(self.as_ptr()) }",
    // Raw-pointer receivers and other parameters are the intended shape /
    // out of scope.
    "unsafe { drop(bun_core::heap::take(this)) };",
    "unsafe { heap::take(self_ptr) }",
    "unsafe { bun_core::heap::destroy(std::ptr::from_mut::<Blob>(self_)) };",
    "unsafe { heap::take(ptr::from_mut(other)) }",
    // Producing a pointer from `self` without reclaiming it is fine.
    "let this = std::ptr::from_ref::<Blob>(self).cast_mut();",
    "Self::finalize(core::ptr::from_mut(self));",
    // Prose about the shape is not the shape.
    "// unsafe { heap::destroy(self) }",
    'log("heap::destroy(self)");',
  ];
  expect(banned.filter(s => !matches(s))).toEqual([]);
  expect(allowed.filter(matches)).toEqual([]);
});

test("no method reclaims its own receiver's allocation", () => {
  expect(offenders).toEqual([]);
});

test("allowlisted files still carry exactly their documented count", () => {
  // Ratchet: once an allowlisted instance is converted, delete its entry so
  // a new one cannot take its place.
  expect(stale).toEqual([]);
});
