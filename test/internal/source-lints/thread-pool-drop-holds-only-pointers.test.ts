import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Every `Drop` impl in src/threading/ThreadPool.rs runs while other threads
// are still working on whatever the dropped value points at: `ThreadPool`'s
// shuts the workers down and waits for them to exit, `ThreadRegistration`'s
// waits in the join chain while the joiner and the other workers signal each
// other, and `node::Consumer`'s releases a queue that producers keep pushing
// to. `Drop::drop` takes `&mut self`, which is protected for the duration of
// the call over every byte of the struct, so a write by another thread into
// any of those bytes is UB under both Stacked Borrows and Tree Borrows (the
// model `bun run rust:miri` uses), atomics included. `ThreadPool` used to have
// that shape: `sync`, `wait_group`, `join_event` and the rest of the state the
// workers write to lived inline in the struct whose `Drop` waited for them
// (and inline in every struct embedding a pool by value, so each of their
// `&mut self` methods had the same problem while the pool was busy). The
// shared state now lives in `ThreadPoolInner`, behind an `Arc` that the handle
// and every worker hold, and the handle holds nothing else.
//
// So: a struct in this file that has a `Drop` impl may only hold shared
// pointers to the state other threads touch, never that state itself. `Box`
// and `&mut` are not on the list on purpose: both are retagged as unique
// whenever the struct holding them is passed or returned by value, which makes
// the same assertion about the pointee that inline state makes about itself.
//
// Sibling guards: self-receiver-reclaim.test.ts (freeing through a protected
// receiver), fn-long-mut-reborrow.test.ts.

const SOURCE = "src/threading/ThreadPool.rs";

// The structs with a `Drop` impl today (`ThreadPool` is the one that had the
// bug). Anything that gains one later is checked as well; these three are
// asserted to still be found so a rename cannot make the ban pass on an empty
// set.
const PINNED_DROP_STRUCTS = ["Consumer", "ThreadPool", "ThreadRegistration"];

// `impl Drop for Name {`, `impl Drop for Name<'_> {`, `impl<T> Drop for Name<T> {`.
const DROP_IMPL = /^[ \t]*impl(?:<[^>]*>)?\s+Drop\s+for\s+(\w+)\b/gm;

// Shared references, raw pointers, and the pointer wrappers used in the tree
// (optionally path-qualified), each optionally inside one `Option<..>`.
const POINTER_TYPE = new RegExp(
  String.raw`^(?:Option<\s*)?(?:&(?!(?:'\w+\s+)?mut\b)|\*(?:const|mut)\b|(?:\w+::)*(?:Arc|Weak|NonNull|BackRef|ParentRef)<)`,
);

function stripComments(source: string): string {
  // Full-line comments (including `///` docs) first, keeping the newline so
  // line numbers hold; then trailing `// ...` on code lines. Nothing in the
  // struct bodies this lint reads contains `//` inside a string.
  return source.replace(/^[ \t]*\/\/.*$/gm, "").replace(/[ \t]*\/\/.*$/gm, "");
}

/** Index just past the `}` matching the `{` at `open`. */
function blockEnd(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
  }
  throw new Error(`unbalanced braces after offset ${open}`);
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/** Splits a struct body on the commas between fields (not the ones inside `<..>`, `(..)` or `[..]`). */
function splitFields(body: string): string[] {
  const fields: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "<" || c === "(" || c === "[") depth++;
    else if ((c === ">" && body[i - 1] !== "-") || c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      fields.push(body.slice(start, i));
      start = i + 1;
    }
  }
  fields.push(body.slice(start));
  return fields.map(f => f.replace(/#\[[^\]]*\]/g, "").trim()).filter(Boolean);
}

type Field = { struct: string; name: string; type: string; line: number };

/** The fields of every struct in `source` that has a `Drop` impl, keyed by struct name. */
function dropStructFields(source: string): Map<string, Field[]> {
  const text = stripComments(source);
  const result = new Map<string, Field[]>();
  for (const impl of text.matchAll(DROP_IMPL)) {
    const name = impl[1];
    if (result.has(name)) continue;
    const def = new RegExp(String.raw`^[ \t]*(?:pub(?:\([^)]*\))?\s+)?struct\s+${name}\b[^{;]*\{`, "m").exec(text);
    if (def === null) throw new Error(`${SOURCE}: impl Drop for ${name}, but no braced struct ${name} in the file`);
    const open = def.index + def[0].length - 1;
    const body = text.slice(open + 1, blockEnd(text, open) - 1);
    const fields: Field[] = [];
    let offset = open + 1;
    for (const field of splitFields(body)) {
      const colon = field.indexOf(":");
      if (colon === -1) throw new Error(`${SOURCE}: cannot parse field of struct ${name}: ${JSON.stringify(field)}`);
      const fieldName = field
        .slice(0, colon)
        .replace(/^pub(?:\([^)]*\))?\s+/, "")
        .trim();
      const type = field
        .slice(colon + 1)
        .trim()
        .replace(/\s+/g, " ");
      const at = text.indexOf(field, offset);
      offset = at + field.length;
      fields.push({ struct: name, name: fieldName, type, line: lineOf(text, at) });
    }
    result.set(name, fields);
  }
  return result;
}

function nonPointerFields(source: string): string[] {
  return [...dropStructFields(source).values()]
    .flat()
    .filter(f => !POINTER_TYPE.test(f.type))
    .map(f => `${SOURCE}:${f.line}: struct ${f.struct}: ${f.name}: ${f.type}`);
}

const source = readFileSync(path.resolve(import.meta.dir, "..", "..", "..", SOURCE), "utf8");

test("the parser and the pointer-type list classify fields the way they claim to", () => {
  const withDrop = (def: string, drop = "impl Drop for Pool {\n    fn drop(&mut self) {}\n}\n") => def + drop;

  // The previous shape of `ThreadPool`: state the workers write to, inline.
  expect(
    nonPointerFields(
      withDrop(
        [
          "pub struct Pool {",
          "    /// Doc comments mentioning sync: AtomicSync, are stripped.",
          "    pub(crate) needs_stack_bounds: bool, // trailing comment",
          "    sync: AtomicSync,",
          "    threads: AtomicPtr<Thread>,",
          "    inner: Box<Inner>,",
          "    exclusive: &'static mut Inner,",
          "    also_exclusive: Option<&mut Inner>,",
          "    callback: unsafe fn(*mut Task) -> Option<NonNull<Task>>,",
          "    wait_group: WaitGroup,",
          "}",
          "",
        ].join("\n"),
      ),
    ),
  ).toEqual([
    `${SOURCE}:3: struct Pool: needs_stack_bounds: bool`,
    `${SOURCE}:4: struct Pool: sync: AtomicSync`,
    `${SOURCE}:5: struct Pool: threads: AtomicPtr<Thread>`,
    `${SOURCE}:6: struct Pool: inner: Box<Inner>`,
    `${SOURCE}:7: struct Pool: exclusive: &'static mut Inner`,
    `${SOURCE}:8: struct Pool: also_exclusive: Option<&mut Inner>`,
    `${SOURCE}:9: struct Pool: callback: unsafe fn(*mut Task) -> Option<NonNull<Task>>`,
    `${SOURCE}:10: struct Pool: wait_group: WaitGroup`,
  ]);

  // Every accepted spelling, including a rustfmt-wrapped type, a field
  // attribute, a generic struct and a trailing comma after the last field.
  expect(
    nonPointerFields(
      withDrop(
        [
          "pub(super) struct Pool<'a, T> {",
          "    a: Arc<Inner>,",
          "    b: std::sync::Weak<Inner>,",
          "    c: &'a Inner,",
          "    d: &Inner,",
          "    e: *mut Thread,",
          "    f: *const Thread,",
          "    g: NonNull<Thread>,",
          "    h: bun_ptr::BackRef<Inner>,",
          "    i: bun_ptr::ParentRef<Inner, bun_ptr::Mut>,",
          "    j: Option<NonNull<Thread>>,",
          "    #[cfg(debug_assertions)]",
          "    k: Option<&'a T>,",
          "    l: bun_ptr::BackRef<",
          "        Inner,",
          "        bun_ptr::Mut,",
          "    >,",
          "}",
          "",
        ].join("\n"),
        "impl<'a, T> Drop for Pool<'a, T> {\n    fn drop(&mut self) {}\n}\n",
      ),
    ),
  ).toEqual([]);

  // Only structs with a `Drop` impl are checked; the `<'_>` on the impl is
  // not part of the name, and a struct may be defined after its impl.
  expect(
    nonPointerFields(
      [
        "struct Plain {",
        "    state: AtomicU32,",
        "}",
        "impl Drop for Guard<'_> {",
        "    fn drop(&mut self) {}",
        "}",
        "pub(super) struct Guard<'a> {",
        "    queue: &'a Queue,",
        "    count: usize,",
        "}",
        "",
      ].join("\n"),
    ),
  ).toEqual([`${SOURCE}:9: struct Guard: count: usize`]);

  // An empty struct body has no fields to flag.
  expect(nonPointerFields(withDrop("struct Pool {}\n"))).toEqual([]);

  // A `Drop` impl whose struct is missing is a parse failure, not a pass.
  expect(() => nonPointerFields("impl Drop for Gone {\n    fn drop(&mut self) {}\n}\n")).toThrow(
    "no braced struct Gone",
  );
});

test(`${SOURCE} still has the Drop impls this lint pins`, () => {
  const structs = dropStructFields(source);
  expect([...structs.keys()]).toEqual(expect.arrayContaining(PINNED_DROP_STRUCTS));
  for (const name of PINNED_DROP_STRUCTS) {
    expect(structs.get(name)!.length).toBeGreaterThan(0);
  }
});

test("structs with a Drop impl hold only pointers to the state other threads touch", () => {
  expect(nonPointerFields(source)).toEqual([]);
});
