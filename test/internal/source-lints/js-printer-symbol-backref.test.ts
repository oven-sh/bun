import { file } from "bun";
import { expect, test } from "bun:test";
import path from "path";

// The printer reaches the symbol table through `self.renamer`, so a plain
// `self.renamer.symbols().get_const(..)` ties the returned `&Symbol` to
// `&self` and conflicts with the `&mut self` print calls that follow. Three
// sites used to work around that locally by wrapping the result in
// `BackRef::<Symbol>::new(..)` to launder the lifetime.
//
// `Printer::get_symbol` / `get_symbol_with_link` / `follow_ref` now do the
// detach once, returning a heap-backed `&'a Symbol` (the `Vec<Symbol>` buffer
// is a separate allocation from the renamer struct and is read-only for the
// print pass), so new code that needs a symbol across `&mut self` uses those
// instead of reintroducing a per-call-site raw-pointer wrap.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const target = path.join(root, "src", "js_printer", "lib.rs");

const lines = (await file(target).text()).split("\n");

// The `Symbol` import is gone from `__gated_printer`, so a reintroduction
// would most naturally be spelled `BackRef::<js_ast::Symbol>` (or the crate
// name `bun_ast::Symbol`). Accept an optional path qualifier and tolerate
// whitespace / the turbofish.
const BACKREF_SYMBOL = /BackRef\s*(?:::)?\s*<\s*(?:(?:js_ast|bun_ast)\s*::\s*)?Symbol\s*>/;

test("js_printer: symbol lookups go through get_symbol(), not per-site BackRef<Symbol>", () => {
  const offenders: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip full-line comments so prose mentions don't count.
    if (/^\s*\/\//.test(line)) continue;
    if (BACKREF_SYMBOL.test(line)) {
      offenders.push(`src/js_printer/lib.rs:${i + 1}: ${line.trim()}`);
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      `Found ${offenders.length} per-call-site BackRef<Symbol> wrap(s) in the printer.\n` +
        `Use Printer::get_symbol() / get_symbol_with_link() / follow_ref() instead; ` +
        `they return a heap-backed &'a Symbol that survives &mut self print calls.\n` +
        offenders.join("\n"),
    );
  }
  expect(offenders).toEqual([]);
});
