import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";

// The BSS stores of bun_alloc (`BSSList`, `BSSMapInner`, `OverflowList`,
// `BSSStringList`) hand out pointers into their slot storage, and the resolver
// keeps those pointers for the life of the process.
//
// A store method that takes `&mut self`, a method that takes `this: *mut Self`
// and forms `&mut *this`, or an accessor that returns `&'static mut`, puts a
// `&mut` over every slot. Under Tree Borrows that is a read of all of them: a
// slot that was written through its pointer cannot be written through that
// pointer again, and across threads the read is a data race.
//
// So every store method takes `&self`, and the `bss_*!` accessors return
// `&'static`, which makes a `&mut self` store method a compile error at its
// call site. The Miri tests in src/bun_alloc/bss_tests.rs check what the
// stores do. This lint keeps the receivers and the accessor from going back.
//
// Sibling guards: fn-long-mut-reborrow.test.ts, bss-singleton-unique.test.ts.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const file = "src/bun_alloc/lib.rs";
const source = readFileSync(path.join(root, file), "utf8");
// Strip full-line comments so prose does not count. `[ \t]*`, not `\s*`, so
// that the line numbers stay the same.
const code = source.replace(/^[ \t]*\/\/.*$/gm, "");

const STORES = ["BSSList", "BSSMapInner", "BSSStringList", "OverflowList", "BSSListOverflowBlock"];

type Method = { store: string; name: string; receiver: string; line: number };

/** The self type of an `impl` header: `impl<..> Trait for Type<..>` or `impl<..> Type<..>`. */
function selfType(header: string): string {
  let rest = header.trim();
  if (rest.startsWith("<")) {
    let depth = 0;
    let i = 0;
    for (; i < rest.length; i++) {
      if (rest[i] === "<") depth++;
      else if (rest[i] === ">" && --depth === 0) break;
    }
    rest = rest.slice(i + 1);
  }
  const forAt = rest.lastIndexOf(" for ");
  if (forAt !== -1) rest = rest.slice(forAt + " for ".length);
  return /^\s*(\w+)/.exec(rest)?.[1] ?? "";
}

/** Every `fn` in every `impl` block whose self type is a BSS store, and the blocks whose end the scan did not find. */
function storeMethods(text: string): { methods: Method[]; unclosed: string[] } {
  const methods: Method[] = [];
  const unclosed: string[] = [];
  const lineAt = (offset: number) => text.slice(0, offset).split("\n").length;
  for (const impl of text.matchAll(/^(?:unsafe )?impl\b([^{;]*)\{/gm)) {
    const store = selfType(impl[1]);
    if (!STORES.includes(store)) continue;
    const start = impl.index + impl[0].length;
    // rustfmt puts the `}` of a top-level block at column 0, or right after
    // the `{` of an empty block. The scan looks for that and does not count
    // braces, so a brace in a string, a char or a comment cannot end the block.
    const close = /^[ \t]*\}|\n\}/.exec(text.slice(start));
    if (!close) {
      unclosed.push(`impl ${store}, line ${lineAt(impl.index)}`);
      continue;
    }
    const body = text.slice(start, start + close.index);
    for (const fn of body.matchAll(/\bfn\s+(\w+)\s*(?:<[^(]*>)?\s*\(\s*([^,)]*)/g)) {
      methods.push({
        store,
        name: fn[1],
        receiver: fn[2].replace(/\s+/g, " ").trim(),
        line: lineAt(start + fn.index),
      });
    }
  }
  return { methods, unclosed };
}

/** Every spelling of a `self` parameter: `self`, `mut self`, `&self`, `&'a mut self`, `self: T`. */
const SELF_RECEIVER = /^(?:&\s*(?:'\w+\s+)?)?(?:mut\s+)?self\b/;
/** `&self` and `&'a self`. */
const SHARED_RECEIVER = /^&\s*(?:'\w+\s+)?self$/;
/** A first parameter that is the store by pointer: `*mut Self`, `*const Self`, `&mut Self`, `NonNull<Self>`. */
const SELF_POINTER = /:\s*(?:\*(?:mut|const)\s+|&\s*(?:'\w+\s+)?mut\s+|(?:\w+::)*NonNull\s*<\s*)Self\b/;

/** Why the first parameter of a store method is banned, or `null` when it is allowed. */
function offense(name: string, receiver: string): string | null {
  // `Drop::drop` owns the store: no slot pointer is in use any more.
  if (name === "drop") return null;
  if (SELF_RECEIVER.test(receiver)) return SHARED_RECEIVER.test(receiver) ? null : "the receiver is not `&self`";
  // `init_at(slot: *mut Self)` writes a store that does not exist yet.
  if (name === "init_at") return null;
  return SELF_POINTER.test(receiver) ? "takes the store by pointer" : null;
}

const { methods, unclosed } = storeMethods(code);

test("finds the methods of every BSS store", () => {
  // Guards against a rename or a reshaped `impl` header that leaves the ban
  // below with nothing to look at. `BSSListOverflowBlock` has no method today.
  const found = (store: string) => methods.filter(m => m.store === store).length;
  expect({
    unclosed,
    tooFew: ["BSSList", "BSSMapInner", "BSSStringList", "OverflowList"].filter(store => found(store) < 2),
  }).toEqual({ unclosed: [], tooFew: [] });
});

test("the scan takes the whole `impl` block, also with a brace in a literal", () => {
  const sample = [
    "impl<ValueType, const COUNT: usize> BSSList<ValueType, COUNT> {",
    "    pub fn first(&self) -> char {",
    "        '}'",
    "    }",
    "    fn second<'a>(&'a mut self, open: &str) -> bool {",
    '        open == "{" // }',
    "    }",
    "}",
    "unsafe impl<ValueType: Send, const COUNT: usize> Sync for BSSList<ValueType, COUNT> {}",
    "impl<ValueType, const COUNT: usize> Drop",
    "    for OverflowList<ValueType, COUNT>",
    "{",
    "    fn drop(&mut self) {}",
    "}",
    "impl NotAStore {",
    "    fn method(&mut self) {}",
    "}",
  ].join("\n");
  expect(storeMethods(sample)).toEqual({
    methods: [
      { store: "BSSList", name: "first", receiver: "&self", line: 2 },
      { store: "BSSList", name: "second", receiver: "&'a mut self", line: 5 },
      { store: "OverflowList", name: "drop", receiver: "&mut self", line: 13 },
    ],
    unclosed: [],
  });
});

test("the receiver check recognizes the spellings it claims to", () => {
  const banned = [
    "&mut self",
    "& mut self",
    "&'a mut self",
    "self",
    "mut self",
    "self: &mut Self",
    "self: Pin<&mut Self>",
    "mut self: Box<Self>",
    "this: *mut Self",
    "this: *const Self",
    "this: &mut Self",
    "this: &'a mut Self",
    "this: NonNull<Self>",
    "this: core::ptr::NonNull<Self>",
  ];
  const allowed = [
    "&self",
    "&'a self",
    "&'static self",
    // An associated function that does not take the store.
    "",
    "denormalized_key: &[u8]",
    "state: &mut BSSListState<ValueType>",
  ];
  expect(banned.filter(receiver => offense("method", receiver) === null)).toEqual([]);
  expect(allowed.filter(receiver => offense("method", receiver) !== null)).toEqual([]);
  // The two exceptions are by name, and `init_at` is not an exception for a receiver.
  expect({
    drop: offense("drop", "&mut self"),
    initAt: offense("init_at", "slot: *mut Self"),
    initAtReceiver: offense("init_at", "&mut self"),
  }).toEqual({ drop: null, initAt: null, initAtReceiver: "the receiver is not `&self`" });
});

test("a BSS store method takes `&self`", () => {
  const offenders = methods.flatMap(m => {
    const why = offense(m.name, m.receiver);
    return why ? [`${file}:${m.line}: ${m.store}::${m.name}(${m.receiver}, ..): ${why}`] : [];
  });
  expect(offenders).toEqual([]);
});

test("the `bss_*!` accessors return `&'static` to a `Sync` store", () => {
  expect({
    returnsShared: code.includes("$vis fn $name() -> &'static $ty {"),
    returnsUnique: /\$vis fn \$name\(\) -> &'static mut\b/.test(code),
    returnsRaw: /\$vis fn \$name\(\) -> \*(?:mut|const)\b/.test(code),
    assertsSync: code.includes("assert_sync::<$ty>();"),
  }).toEqual({ returnsShared: true, returnsUnique: false, returnsRaw: false, assertsSync: true });
});
