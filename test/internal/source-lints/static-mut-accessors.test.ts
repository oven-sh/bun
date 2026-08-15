// Inventory of the functions that hand out a `&'static mut` (bare, or inside
// `Option`/`Result`/a tuple).
//
// Nearly all of them are accessors for a per-process or per-thread singleton:
// `VirtualMachine::get_mut()`, `http_thread()`, `FileSystem::instance()`,
// `Output::writer()`, the thread-local scratch buffers. Each call mints a new
// exclusive borrow of the same object with nothing tying it to the previous
// one, so two callers on the stack at once (a driver holding the VM across
// `tick()` while a host function re-derives it; `http_thread()` re-minted
// inside code the HTTP thread is already running with its own `&mut`) hold
// overlapping `&mut`s to one allocation: aliasing UB, and the `noalias`
// attribute rustc puts on `&mut` arguments lets LLVM act on it. The type
// system cannot see this (the lifetime is `'static`, the borrow checker has
// nothing to tie it to), and clippy's `mut_from_ref` only fires when the
// function takes a reference, which these mostly do not, so nothing in the
// build inventories them. This lint does: every such function is listed in
// static-mut-accessors.inventory.json, a new one fails here, and removing one
// means regenerating, so the list only shrinks.
//
// If this fails because you ADDED one: prefer returning `&'static T` over a
// type whose mutable state is in `Cell`/`JsCell`/`UnsafeCell` (what
// `VirtualMachine::get()` does), a raw `*mut` the caller reborrows per
// statement (what `VirtualMachine::event_loop()` does), or a scoped
// `with(|x: &mut T| ..)` accessor. If it has to stay, say in its doc comment
// why callers cannot overlap, then regenerate:
//   bun ./test/internal/source-lints/static-mut-accessors.test.ts --update
// If it fails because you REMOVED one: regenerate the same way.
//
// Siblings: fn-long-mut-reborrow.test.ts pins the call-site half of the same
// shape (a `&mut` formed from a raw pointer and held for a whole function).

import { file } from "bun";
import { describe, expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

const root = path.resolve(import.meta.dir, "..", "..", "..");
const INVENTORY = import.meta.dir + "/static-mut-accessors.inventory.json";

const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

const STATIC_MUT = /&\s*'static\s+mut\b/;

/**
 * Skip a balanced `open`..`close` group starting at `source[i] === open`;
 * returns the index after `close`, or -1. The `>` of a `->` token inside a
 * generic list (`<F: FnOnce() -> T>`) is not a closer.
 */
function skipBalanced(source: string, i: number, open: string, close: string): number {
  let depth = 0;
  for (; i < source.length; i++) {
    const c = source[i];
    if (c === open) depth++;
    else if (c === close && !(close === ">" && source[i - 1] === "-") && --depth === 0) return i + 1;
  }
  return -1;
}

const WHERE = /\bwhere\b/y;

/**
 * Names of the `fn` items in `source` whose return type mentions
 * `&'static mut`, sorted. Parameters and `where` bounds do not count: a
 * function that takes or constrains such a reference is not what hands it out.
 * One entry per function, so a file with two same-named accessors in different
 * impls lists the name twice.
 */
function staticMutFns(source: string): string[] {
  const names: string[] = [];
  // `fn name` (any qualifiers before it are irrelevant); `fn(` alone is a fn
  // pointer type and has no name, so it is not matched.
  for (const m of source.matchAll(/\bfn\s+([A-Za-z_]\w*)/g)) {
    let i = m.index + m[0].length;
    while (i < source.length && /\s/.test(source[i])) i++;
    if (source[i] === "<") {
      i = skipBalanced(source, i, "<", ">");
      if (i < 0) continue;
      while (i < source.length && /\s/.test(source[i])) i++;
    }
    if (source[i] !== "(") continue;
    i = skipBalanced(source, i, "(", ")");
    if (i < 0) continue;
    while (i < source.length && /\s/.test(source[i])) i++;
    if (!source.startsWith("->", i)) continue;
    // The return type runs up to the body's `{`, the `;` ending a declaration,
    // or a `where` clause. `(`/`[` nesting is tracked so the `;` of an array
    // type (`[u8; N]`) inside it does not end it; `->` inside an `impl Fn`
    // return type is just text here.
    const start = i + 2;
    for (let depth = 0; i < source.length; i++) {
      const c = source[i];
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      else if (c === "{") break;
      else if (depth === 0) {
        if (c === ";") break;
        if (c === "w") {
          WHERE.lastIndex = i;
          if (WHERE.test(source)) break;
        }
      }
    }
    if (STATIC_MUT.test(source.slice(start, i))) names.push(m[1]);
  }
  return names.sort();
}

const found: Record<string, string[]> = {};
let scanned = 0;
for (const abs of globAllSources().rust.filter(p => p.endsWith(".rs"))) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once under
  // its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  // Comments (`//` lines, including doc comments, and `/* */` blocks) talk
  // about these signatures; only code counts.
  const stripped = (await file(abs).text()).replace(/^[ \t]*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const names = staticMutFns(stripped);
  if (names.length > 0) found[source] = names;
}

const normalized: Record<string, string[]> = Object.fromEntries(
  Object.entries(found).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
);

if (process.argv.includes("--update")) {
  await Bun.write(INVENTORY, JSON.stringify(normalized, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(normalized).length} files to ${path.basename(INVENTORY)}`);
  process.exit(0);
}

const inventory: Record<string, string[]> = await Bun.file(INVENTORY).json();

describe("staticMutFns", () => {
  test("matches bare, wrapped, multi-line and declared returns, not parameters, where bounds or prose", () => {
    expect(
      staticMutFns(`
        pub fn http_thread() -> &'static mut HTTPThread { todo!() }
        fn vm_mut(&self) -> &'static mut VirtualMachine { todo!() }
        pub(crate) fn runner() -> Option<&'static mut TestRunner<'static>> { None }
        fn buf<const N: usize>(b: &UnsafeCell<[u8; N]>) -> &'static mut [u8; N] { todo!() }
        fn pair(len: usize) -> (Self, &'static mut [u8]) { todo!() }
        fn after_array_semi() -> Result<[u8; 4], &'static mut Thing> { todo!() }
        fn lazy_init<F: FnOnce() -> Box<Thing>>(init: F) -> &'static mut Thing { todo!() }
        pub(crate) fn take_worker<T: Send>(
            slot: &Slot<T>,
        ) -> &'static mut T
        where
            T: Default,
        { todo!() }
        unsafe extern "C" { fn ffi_thing() -> &'static mut Thing; }
        fn consumes(slice: &'static mut [u8]) -> StoreRef { todo!() }
        fn bounded<F>(f: F) -> usize where F: FnOnce(&'static mut Thing) { 0 }
        fn bounded_no_return<F>(f: F) where F: FnOnce() -> &'static mut Thing { f(); }
        fn plain(&self) -> &'static Loader { todo!() }
        fn shared_mut(&self) -> &mut EventLoop { todo!() }
        fn callback(project: fn(&mut Source) -> &mut Writer) -> &'static str { "" }
        let not_a_fn: fn() -> &'static mut u8 = f;
      `),
    ).toEqual([
      "after_array_semi",
      "buf",
      "ffi_thing",
      "http_thread",
      "lazy_init",
      "pair",
      "runner",
      "take_worker",
      "vm_mut",
    ]);
  });
});

describe("`-> &'static mut` accessor inventory", () => {
  test("scans a non-empty set of tracked Rust sources", () => {
    expect(scanned).toBeGreaterThan(0);
    // The singleton accessors the header names are the reason this lint
    // exists; if the scanner ever stops seeing them, it is the scanner that
    // broke, not the tree that got fixed.
    expect(normalized["src/bun_core/output.rs"]).toContain("writer");
  });

  const files = [...new Set([...Object.keys(inventory), ...Object.keys(normalized)])].sort();
  test.each(files)("%s", source => {
    const expected = inventory[source] ?? [];
    const actual = normalized[source] ?? [];
    if (!Bun.deepEquals(actual, expected)) {
      throw new Error(
        `${source}: functions returning \`&'static mut\` changed.\n` +
          `  inventoried: ${JSON.stringify(expected)}\n` +
          `  in tree:     ${JSON.stringify(actual)}\n` +
          `A new one hands out overlapping exclusive borrows of a singleton; return \`&'static T\` with ` +
          `interior mutability, a raw pointer, or a scoped accessor instead (see the header of this file). ` +
          `If it must stay, or after removing one, regenerate: ` +
          `bun ./test/internal/source-lints/static-mut-accessors.test.ts --update`,
      );
    }
  });
});
