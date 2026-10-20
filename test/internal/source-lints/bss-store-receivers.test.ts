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

/** Every `fn` in every `impl` block whose self type is a BSS store. */
function storeMethods(): Method[] {
  const methods: Method[] = [];
  for (const impl of code.matchAll(/^(?:unsafe )?impl\b([^{;]*)\{/gm)) {
    const store = selfType(impl[1]);
    if (!STORES.includes(store)) continue;
    const start = impl.index + impl[0].length;
    let depth = 1;
    let end = start;
    for (; end < code.length && depth > 0; end++) {
      if (code[end] === "{") depth++;
      else if (code[end] === "}") depth--;
    }
    const body = code.slice(start, end);
    for (const fn of body.matchAll(/\bfn\s+(\w+)\s*(?:<[^(]*>)?\s*\(\s*([^,)]*)/g)) {
      methods.push({
        store,
        name: fn[1],
        receiver: fn[2].replace(/\s+/g, " ").trim(),
        line: code.slice(0, start + fn.index).split("\n").length,
      });
    }
  }
  return methods;
}

const methods = storeMethods();

test("finds the methods of every BSS store", () => {
  // Guards against a rename or a reshaped `impl` header that leaves the ban
  // below with nothing to look at. `BSSListOverflowBlock` has no method today.
  const found = (store: string) => methods.filter(m => m.store === store).length;
  expect(["BSSList", "BSSMapInner", "BSSStringList", "OverflowList"].filter(store => found(store) < 2)).toEqual([]);
});

test("a BSS store method takes `&self`", () => {
  const offenders = methods
    .filter(m => {
      // `Drop::drop` owns the store: no slot pointer is in use any more.
      if (m.name === "drop") return false;
      if (/^&\s*mut self\b/.test(m.receiver)) return true;
      // `init_at(slot: *mut Self)` writes a store that does not exist yet.
      return m.name !== "init_at" && /:\s*\*(?:mut|const) Self\b/.test(m.receiver);
    })
    .map(m => `${file}:${m.line}: ${m.store}::${m.name}(${m.receiver}, ..)`);
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
