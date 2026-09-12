import { expect, test } from "bun:test";
import {
  parseRustFragment,
  pathEndsWith,
  unwrapParens,
  type Call,
  type RustFile,
} from "../../../scripts/rust-parser/index.ts";
import { ratchet, rustSources } from "./rust-sources.ts";

// `NonNull::from(&*expr)` is always a bug waiting to happen.
//
// The `&*` takes something that derefs to `&mut T` (a `Box`, a `&mut T`, an
// arena's `alloc()` return) and downgrades it to `&T`, so `NonNull::from` picks
// the `From<&T>` impl. Under Tree Borrows the resulting tag is *frozen*: it may
// be read through, never written through. Code that stores such a pointer and
// later writes through it — or keeps it while something writes through the
// original `&mut` — is UB.
//
// Three of these existed, all storing the pointer past the borrow that produced
// it:
//
//   - `Parser::new`'s arena arm froze the `JsonTape` root, so every later
//     `tape_mut()` write through it was UB (bundler JSON imports).
//   - `RouteLoader::append_route` froze the `/index.js` route pointer *and*
//     derived it before moving the `Box` into `all_routes`.
//   - `start_queued_task` froze the in-flight HTTP pointer, then immediately
//     wrote through the `&mut` it came from.
//
// If you need a raw pointer that outlives the borrow, take it from the
// allocation itself: `NonNull::from(&mut *x)`, `heap::into_raw(boxed)`, or a
// `fn root_ptr(&mut self) -> NonNull<Self>` helper. Derive it *after* any move
// of the owning `Box` — moving a `Box` retags it, and a pointer taken before
// the move is a stale sibling of the one the new owner holds.
//
// Sibling guard: test/internal/source-lints/unsound-erased-box.test.ts.

/**
 * Calls to `NonNull::from`, however qualified (`core::ptr::NonNull`,
 * `ptr::NonNull`), whose first argument is a shared reborrow `&*x`. The
 * correct spelling `NonNull::from(&mut *x)` is a `&mut` and does not match.
 */
function findFrozenReborrows(file: RustFile): Call[] {
  return file.find("Call").filter(call => {
    if (call.args.length === 0 || !pathEndsWith(call.callee, "NonNull::from")) return false;
    const arg = unwrapParens(call.args[0]);
    if (arg.kind !== "Ref" || arg.mutable || arg.raw) return false;
    const pointee = unwrapParens(arg.expr);
    return pointee.kind === "Unary" && pointee.op === "*";
  });
}

// Documented, ratcheted exceptions: files allowed to keep exactly N of the
// shape. Prefer converting over adding an entry here.
const ALLOW: Record<string, number> = {
  // `Listener::finalize(self: Box<Self>)` spells the `swap_remove` key for its
  // active-handle entry as `NonNull::from(&*self)`. rustfmt wrapped the
  // argument onto its own line, which hid it from the per-line regex this
  // lint replaced. The pointer is compared, never dereferenced, so the frozen
  // tag does no harm there; still, spell it `NonNull::from(&mut *self)` (with
  // `mut self`) or from a `&Self` like `do_stop` does, and delete this entry.
  "src/runtime/socket/Listener.rs": 1,
};

const sources = rustSources();
const findings: { path: string; message: string }[] = [];
for (const src of sources) {
  for (const call of findFrozenReborrows(src.file)) {
    findings.push({
      path: src.path,
      message: `${src.file.location(call)}: ${src.file.text(call).replace(/\s+/g, " ")}`,
    });
  }
}
const { offenders, stale } = ratchet(findings, ALLOW);

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the corpus filters over-firing (e.g. a symlinked checkout
  // root) and leaving nothing to scan, which would make the ban below pass
  // vacuously. Same guard as unsound-erased-box.test.ts.
  expect(sources.length).toBeGreaterThan(0);
});

test("the query recognizes the spellings it claims to", () => {
  const matches = (snippet: string) => findFrozenReborrows(parseRustFragment(snippet)).length > 0;
  const banned = [
    "let ptr = NonNull::from(&*self.ptr);",
    "let ptr = core::ptr::NonNull::from(&*x);",
    "let ptr = ptr::NonNull::from(&*boxed);",
    // rustfmt-ish spacing and wrapping.
    "let ptr = NonNull::from(& *x);",
    "let ptr = NonNull::from(\n    &*self.routes.last_mut().unwrap(),\n);",
  ];
  const allowed = [
    "let ptr = NonNull::from(&mut *x);",
    "let ptr = NonNull::from(x);",
    "let ptr = NonNull::from(&x);",
    "let ptr = NonNull::new(&raw mut *x);",
    "let ptr = heap::into_raw(boxed);",
    // Prose about the shape is not the shape.
    "// NonNull::from(&*x) freezes the pointee",
    'log("NonNull::from(&*x)");',
  ];
  expect(banned.filter(s => !matches(s))).toEqual([]);
  expect(allowed.filter(matches)).toEqual([]);
});

test("NonNull::from(&*x) — frozen reborrow stored past its borrow", () => {
  expect(offenders).toEqual([]);
});

test("allowlisted files still carry exactly their documented count", () => {
  // Ratchet: once an allowlisted instance is converted, delete its entry so
  // a new one cannot take its place.
  expect(stale).toEqual([]);
});
