import { expect, test } from "bun:test";
import { parseRustFragment, unwrapParens, type MethodCall, type RustFile } from "../../../scripts/rust-parser/index.ts";
import { rustSources } from "./rust-sources.ts";

// The printer and the linker's chunk generation read ASTs that other threads
// are reading at the same time: the bundler prints a module into every chunk
// that includes it, in parallel, from one AST. An in-place rope flatten there
// (`E::String::resolve_rope_if_needed`, or anything built on it) writes `data`
// and `next = None` into the shared node while the other printers read it.
// The observed results were the tail printed twice, the tail dropped, and a
// crash on a torn `next` pointer (`Bus error at address 0x56700000000`).
//
// `StoreRef<T>` is `Copy` and implements `DerefMut`, so `let mut e = *e;
// e.resolve_rope_if_needed(bump)` compiles and silently mutates the arena node.
// The read-only form is `e.flattened(bump)`, which returns a local copy with the
// rope flattened into `bump`. The `&mut self` rope methods are for the parser,
// which owns its nodes.
//
//   x.resolve_rope_if_needed(bump)   → let x = x.flattened(bump);
//   x.slice(bump)                    → x.flattened(bump).string(bump)
//   x.is_identifier(bump)            → is_identifier(x.flattened(bump).slice8())
//   x.to_utf8(bump)                  → x.flattened(bump).string(bump)
//   e_string_mut()                   → e_string() (a `StoreRef`, read it only)
//
// The query looks at every method call in scope by method name and argument
// shape. `slice`, `is_identifier`, and `to_utf8` are also names of unrelated
// methods, so those are told apart by their arguments: the `E::String` forms
// take the arena, the others take nothing or a literal.

// Code that runs on the shared, post-parse AST with other threads.
const SCOPE = ["src/js_printer/", "src/bundler/linker_context/", "src/bundler/LinkerContext.rs"];

const BANNED: { name: string; matches: (call: MethodCall) => boolean; hint: string }[] = [
  {
    name: "E::String::resolve_rope_if_needed",
    matches: call => call.method === "resolve_rope_if_needed",
    hint: "flattened(bump)",
  },
  {
    // The `E::String` method takes the arena, a path or a field (`bump`,
    // `self.bump`, `p.allocator`); `StoreSlice::slice()` and the other
    // no-argument `slice()` accessors, and `slice(1..2)`, do not match.
    name: "E::String::slice(bump)",
    matches: call => {
      if (call.method !== "slice" || call.args.length !== 1) return false;
      const arg = unwrapParens(call.args[0]);
      return arg.kind === "PathExpr" || arg.kind === "Field";
    },
    hint: "flattened(bump).string(bump)",
  },
  {
    // Method form with a non-literal argument; the free fn
    // `js_lexer::is_identifier(x)` is a `Call`, not a method call.
    name: "E::String::is_identifier(bump)",
    matches: call =>
      call.method === "is_identifier" && call.args.length >= 1 && unwrapParens(call.args[0]).kind !== "Lit",
    hint: "is_identifier(flattened(bump).slice8())",
  },
  {
    // `bun_core::String::to_utf8()` takes no argument and is fine.
    name: "E::String::to_utf8(bump)",
    matches: call => call.method === "to_utf8" && call.args.length >= 1 && unwrapParens(call.args[0]).kind !== "Lit",
    hint: "flattened(bump).string(bump)",
  },
  {
    name: "ExprData::e_string_mut",
    matches: call => call.method === "e_string_mut",
    hint: "e_string() and read through the StoreRef",
  },
];

/** Every method call in the file that flattens a rope in place, or hands out a `&mut` to one. */
function findInPlaceFlattens(file: RustFile): { name: string; hint: string; call: MethodCall }[] {
  const out: { name: string; hint: string; call: MethodCall }[] = [];
  for (const call of file.find("MethodCall")) {
    const banned = BANNED.find(b => b.matches(call));
    if (banned) out.push({ name: banned.name, hint: banned.hint, call });
  }
  return out;
}

const sources = rustSources({ scope: SCOPE });
const offenders: string[] = [];
for (const src of sources) {
  for (const { name, hint, call } of findInPlaceFlattens(src.file)) {
    offenders.push(`${src.file.location(call)}: ${name} (use ${hint}): ${src.file.text(call).replace(/\s+/g, " ")}`);
  }
}

test("scans a non-empty set of tracked Rust sources", () => {
  expect(sources.length).toBeGreaterThan(0);
});

test("the query recognizes the spellings it claims to", () => {
  const matches = (snippet: string) => findInPlaceFlattens(parseRustFragment(snippet)).length > 0;
  const banned = [
    "e.resolve_rope_if_needed(bump);",
    "let mut e = *e;\ne.resolve_rope_if_needed(self.allocator);",
    "let s = e.slice(bump);",
    "let s = e.slice(self.bump);",
    "let s = e.slice(p.allocator);",
    "if e.is_identifier(bump) {}",
    "let s = e.to_utf8(bump);",
    "let s = e.to_utf8(self.allocator());",
    "let e = expr.data.e_string_mut();",
    // rustfmt-wrapped.
    "let s = expr\n    .data\n    .e_string()\n    .slice(\n        bump,\n    );",
  ];
  const allowed = [
    // The read-only forms.
    "let s = e.flattened(bump).string(bump);",
    "let e = expr.data.e_string();",
    // Unrelated methods of the same name.
    "let s = store.slice();",
    "let s = bytes.slice(1..2);",
    "let s = s.slice(&bump);",
    "let s = s.to_utf8();",
    "if js_lexer::is_identifier(name) {}",
    "if js_lexer::is_identifier(e.slice8()) {}",
    'if s.is_identifier("foo") {}',
    // Prose about the shape is not the shape.
    "// e.resolve_rope_if_needed(bump)",
    'log("e.slice(bump)");',
  ];
  expect(banned.filter(s => !matches(s))).toEqual([]);
  expect(allowed.filter(matches)).toEqual([]);
});

test("the printer and linker never flatten a string rope in place", () => {
  expect(offenders).toEqual([]);
});
