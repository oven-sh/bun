import { file } from "bun";
import { expect, test } from "bun:test";
import path from "path";

// `DynamicBitSetList::at` and `DynamicBitSetUnmanaged::zip_masks_raw`
// (src/collections/bit_set.rs) are safe fns whose `unsafe` pointer arithmetic
// is only in bounds when an argument satisfies a precondition: the entry index
// is below the list's length, and the two operands of a set operation have the
// same bit_length. `at` used to check its index with a `debug_assert!` and
// `zip_masks_raw` relied on `debug_assert!`s in its callers. `debug_assert!`
// compiles out of the release profile (`[profile.release]` leaves
// debug-assertions off; scripts/build/rust.ts only turns them on for the
// debug, asan and assertions profiles), so a shipped `bun install` handed an
// out-of-range tree or package id wrote through a pointer past the end of the
// list's heap buffer, and a set operation on a shorter operand read past the
// end of the operand's allocation.
//
// `bun bd` builds with debug assertions on, so no test that runs a binary can
// tell the two kinds of assertion apart; this lint reads the source instead.
// The runtime behaviour (panics, and `copy_into` with operands of different
// lengths) is covered by the crate's unit tests, which CI runs under Miri.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const BIT_SET_RS = "src/collections/bit_set.rs";

interface Guarded {
  name: string;
  /** Header (through its `{`) of the impl block the fn is defined in, so a same-named fn on another type is not matched. */
  impl: string;
  /** Start of the fn signature as written in the source. */
  signature: string;
}

const GUARDED: Guarded[] = [
  {
    name: "DynamicBitSetList::at",
    impl: "impl DynamicBitSetList {",
    signature: "fn at(&self, i: usize)",
  },
  {
    name: "DynamicBitSetUnmanaged::zip_masks_raw",
    impl: "impl DynamicBitSetUnmanaged {",
    signature: "fn zip_masks_raw(&mut self, other: &Self,",
  },
];

const DEBUG_ASSERT = /\bdebug_assert(?:_eq|_ne)?!/;
const HARD_CHECK = /(?<![\w.])(?:assert(?:_eq|_ne)?|panic)!\s*\(/;

function stripComments(content: string): string {
  // Whole-line comments (including `///` docs), then trailing `// ...` on code
  // lines, so prose about `debug_assert` does not count either way.
  return content.replace(/^[ \t]*\/\/.*$/gm, "").replace(/[ \t]+\/\/.*$/gm, "");
}

/** Index one past the `}` matching the `{` at `open`. */
function closeOf(content: string, open: number): number {
  let depth = 0;
  let i = open;
  do {
    const c = content[i++];
    if (c === "{") depth++;
    else if (c === "}") depth--;
  } while (depth > 0 && i < content.length);
  if (depth !== 0) throw new Error(`unbalanced braces after offset ${open}`);
  return i;
}

/** The bodies of every definition of `g` (text between the fn's outermost braces) inside the impl blocks the table names. */
function fnBodies(content: string, g: Guarded): string[] {
  const bodies: string[] = [];
  for (let implStart = content.indexOf(g.impl); implStart !== -1; implStart = content.indexOf(g.impl, implStart + 1)) {
    const implOpen = implStart + g.impl.length - 1;
    const block = content.slice(implOpen, closeOf(content, implOpen));
    for (let sig = block.indexOf(g.signature); sig !== -1; sig = block.indexOf(g.signature, sig + 1)) {
      const open = block.indexOf("{", sig);
      bodies.push(block.slice(open + 1, closeOf(block, open) - 1));
    }
  }
  return bodies;
}

function violations(body: string): string[] {
  const out: string[] = [];
  if (DEBUG_ASSERT.test(body)) out.push("precondition is only debug_assert!ed");
  if (!HARD_CHECK.test(body)) out.push("no assert!/panic! in the body");
  return out;
}

const bitSet = stripComments(await file(path.join(root, BIT_SET_RS)).text());

test("the extractor and the check classify the shapes this lint is about", () => {
  const g: Guarded = { name: "t", impl: "impl List {", signature: "fn at(&self, i: usize)" };
  const classify = (src: string) => {
    const bodies = fnBodies(stripComments(src), g);
    expect(bodies).toHaveLength(1);
    return violations(bodies[0]);
  };
  // The shape this lint was written against.
  expect(
    classify(`
      impl List {
          pub fn at(&self, i: usize) -> View {
              debug_assert!(i < self.n, "index out of bounds");
              View { masks: unsafe { self.buf.add(i) } }
          }
      }`),
  ).toEqual(["precondition is only debug_assert!ed", "no assert!/panic! in the body"]);
  // No check at all (zip_masks_raw's old shape).
  expect(
    classify(`
      impl List {
          fn at(&self, i: usize) -> View {
              View { masks: unsafe { self.buf.add(i) } }
          }
      }`),
  ).toEqual(["no assert!/panic! in the body"]);
  // Fixed; nested braces and a doc comment mentioning debug_assert! do not confuse it.
  expect(
    classify(`
      impl List {
          /// Not a debug_assert!, on purpose.
          pub fn at(&self, i: usize) -> View {
              assert!(i < self.n, "index out of bounds"); // debug_assert! would compile out
              if i == 0 { View { masks: self.buf } } else { View { masks: unsafe { self.buf.add(i) } } }
          }
      }`),
  ).toEqual([]);
  // A leftover debug_assert! next to a real one is still a violation.
  expect(
    classify(`
      impl List {
          pub fn at(&self, i: usize) -> View {
              assert!(i < self.n);
              debug_assert_eq!(self.buf_len % self.n, 0);
              View { masks: unsafe { self.buf.add(i) } }
          }
      }`),
  ).toEqual(["precondition is only debug_assert!ed"]);
  // A same-named fn on another type, or in a later block, is not the one being checked.
  expect(
    fnBodies(
      `
      impl Other {
          fn at(&self, i: usize) -> usize { i }
      }`,
      g,
    ),
  ).toEqual([]);
  expect(
    fnBodies(
      `
      impl List {
          fn len(&self) -> usize { self.n }
      }
      impl Other {
          fn at(&self, i: usize) -> usize { i }
      }`,
      g,
    ),
  ).toEqual([]);
  // A second `impl List` block is searched too, and the body is exactly the fn's.
  expect(
    fnBodies(
      `
      impl List {
          fn len(&self) -> usize { self.n }
      }
      impl List {
          fn at(&self, i: usize) -> usize { i }
      }`,
      g,
    ),
  ).toEqual([" i "]);
});

test.each(GUARDED)("$name checks its precondition in release builds", g => {
  const bodies = fnBodies(bitSet, g);
  // Exactly one definition: a rename or move must update the table rather
  // than silently dropping the function out of the lint.
  expect(bodies).toHaveLength(1);
  expect(violations(bodies[0])).toEqual([]);
});
