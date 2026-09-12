import { expect, test } from "bun:test";
import { parseRustFragment, type RustFile, type Span } from "../../../scripts/rust-parser/index.ts";
import { rustSources } from "./rust-sources.ts";

// https://github.com/oven-sh/bun/issues/31976
//
// `bun_jsc::rare_data::ErasedBox` paired a `pub ptr: NonNull<c_void>` with a
// `pub dtor: unsafe fn(*mut c_void)` and called `dtor(ptr)` from a safe `Drop`.
// Because both fields were public, fully-safe code could forge an arbitrary
// pointer/destructor pair via a struct literal and get UB on drop. The type
// (and the never-populated `RareData.websocket_deflate` slot holding it) was
// dead code and was deleted. An erased owner whose destructor runs in a safe
// `Drop` must keep its fields private and gate construction behind an
// `unsafe fn`, so the pairing invariant is acknowledged at every call site.

/**
 * Every place that declares or refers to the identifier `name`: a path segment
 * (in a type, expression, pattern, `impl` header or attribute), an item, field
 * or variant declaration, a binding, a `use` tree leaf including the `as` side
 * of `use a::B as name`, and an identifier token inside macro input or a
 * `macro_rules!` template.
 */
function findNamed(file: RustFile, name: string): Span[] {
  const nodes: Span[] = file.findAll(
    node => ("name" in node && node.name === name) || (node.kind === "UseRename" && node.rename === name),
  );
  const tokens = file.macroTokens().filter(t => t.kind === "ident" && t.text === name);
  return nodes.concat(tokens);
}

/**
 * `pub dtor: unsafe fn(..)` fields. Any visibility counts, `pub(crate)`
 * included: safe code anywhere in the crate can still forge the pair. So does
 * an `unsafe extern "C" fn` pointer. Inside a macro template the field is a
 * run of tokens, `pub [(..)] dtor : unsafe [extern ["C"]] fn`.
 */
function findPubDtorFields(file: RustFile): Span[] {
  const fields: Span[] = file
    .find("StructField")
    .filter(field => field.vis !== null && field.name === "dtor" && field.ty.kind === "TypeBareFn" && field.ty.unsafe);
  const tokens = file.macroTokens();
  const word = (i: number) => (tokens[i]?.kind === "ident" ? tokens[i].text : tokens[i]?.text);
  for (let i = 0; i < tokens.length; i++) {
    if (word(i) !== "pub") continue;
    let j = i + 1;
    if (tokens[j]?.kind === "open" && tokens[j].text === "(") {
      while (j < tokens.length && !(tokens[j].kind === "close" && tokens[j].text === ")")) j++;
      j++;
    }
    if (word(j) !== "dtor" || word(j + 1) !== ":" || word(j + 2) !== "unsafe") continue;
    let k = j + 3;
    if (word(k) === "extern") k += tokens[k + 1]?.kind === "literal" ? 2 : 1;
    if (word(k) !== "fn") continue;
    fields.push({ start: tokens[i].start, end: tokens[k].end });
  }
  return fields;
}

const sources = rustSources();
const erasedBoxMentions: string[] = [];
const pubDtorFields: string[] = [];
for (const src of sources) {
  for (const node of findNamed(src.file, "ErasedBox")) erasedBoxMentions.push(src.file.location(node));
  for (const field of findPubDtorFields(src.file)) {
    pubDtorFields.push(`${src.file.location(field)}: ${src.file.text(field).replace(/\s+/g, " ")}`);
  }
}

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the corpus filters over-firing (e.g. a symlinked checkout
  // root) and leaving nothing to scan, which would make the assertions below
  // pass vacuously.
  expect(sources.length).toBeGreaterThan(0);
});

test("the queries recognize the spellings they claim to", () => {
  const mentions = (snippet: string) => findNamed(parseRustFragment(snippet), "ErasedBox").length > 0;
  const mentioned = [
    "use bun_jsc::rare_data::ErasedBox;",
    "use foo::{Bar, ErasedBox as Erased};",
    "use foo::{Bar as ErasedBox};",
    "pub struct ErasedBox { ptr: NonNull<c_void>, dtor: unsafe fn(*mut c_void) }",
    "impl Drop for ErasedBox { fn drop(&mut self) {} }",
    "struct RareData { websocket_deflate: Option<ErasedBox> }",
    "let b = ErasedBox { ptr, dtor };",
    "drop(ErasedBox::new(ptr, dtor));",
    "debug_assert!(size_of::<ErasedBox>() == 16);",
    // Macro input and templates.
    "quote! { impl Drop for ErasedBox {} }",
    "macro_rules! m { () => { let b: ErasedBox = x; }; }",
  ];
  const notMentioned = [
    // Prose and string literals are not the identifier.
    "// the old ErasedBox type",
    "/// `ErasedBox` was deleted",
    'log("ErasedBox");',
    // Other identifiers.
    "struct ErasedBoxed;",
    "let erased_box = 1;",
  ];
  expect(mentioned.filter(s => !mentions(s))).toEqual([]);
  expect(notMentioned.filter(mentions)).toEqual([]);

  const hasPubDtor = (snippet: string) => findPubDtorFields(parseRustFragment(snippet)).length > 0;
  const banned = [
    "pub struct E { pub ptr: NonNull<c_void>, pub dtor: unsafe fn(*mut c_void) }",
    "struct E { pub(crate) dtor: unsafe fn(*mut c_void) }",
    'struct E { pub dtor: unsafe extern "C" fn(*mut c_void) }',
    // rustfmt-wrapped field.
    "struct E {\n    pub dtor:\n        unsafe fn(*mut c_void, usize, usize, usize, usize, usize, usize),\n}",
    // Inside a macro template.
    "macro_rules! m { ($t:ty) => { struct E { pub dtor: unsafe fn(*mut $t) } }; }",
    'macro_rules! m { () => { struct E { pub(crate) dtor: unsafe extern "C" fn(*mut c_void) } }; }',
  ];
  const allowed = [
    // Private: only this module can pair it with the pointer.
    "struct E { ptr: NonNull<c_void>, dtor: unsafe fn(*mut c_void) }",
    // A safe fn pointer cannot do anything a forged pointer makes unsound.
    "struct E { pub dtor: fn(*mut c_void) }",
    // The lint is about the `dtor` slot by name.
    "struct E { pub on_close: unsafe fn(*mut c_void) }",
    "// pub dtor: unsafe fn(*mut c_void)",
    "macro_rules! m { () => { struct E { dtor: unsafe fn(*mut c_void) } }; }",
  ];
  expect(banned.filter(s => !hasPubDtor(s))).toEqual([]);
  expect(allowed.filter(hasPubDtor)).toEqual([]);
});

test("ErasedBox (safe-forgeable ptr/dtor pair) stays deleted", () => {
  expect(erasedBoxMentions).toEqual([]);
});

test("no pub destructor function-pointer fields", () => {
  // A `pub dtor: unsafe fn(..)` field lets safe code in any crate swap in an
  // arbitrary destructor; whatever later calls it (typically a safe `Drop`)
  // then runs a forged function on a forged pointer.
  expect(pubDtorFields).toEqual([]);
});
