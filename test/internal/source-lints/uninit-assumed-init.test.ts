import { expect, test } from "bun:test";
import { metaItemPaths, parseRust, type Attribute, type RustFile } from "../../../scripts/rust-parser/index.ts";
import { rustSources } from "./rust-sources.ts";

// `MaybeUninit::uninit().assume_init()` on an integer array produces a value
// whose bytes are uninitialized. The Rust reference lists that as undefined
// behavior no matter what the code does with the bytes afterwards, and Miri
// stops at the constructor:
//
//   constructing invalid value of type [u8; 2048]: at [0], encountered
//   uninitialized memory, but expected an integer
//
// rustc's `invalid_value` lint (an error under the workspace `warnings = deny`)
// and clippy's `uninit_assumed_init` both catch the pattern, so such code only
// compiles under an `#[allow(..)]` for them. A scratch buffer is
// `[MaybeUninit<T>; N]` instead, written with `write_copy_of_slice` / `write`
// and read back through `assume_init_ref` on the written prefix. See
// `bun_url::URL::join_normalize` and `bun_paths::resolve_path::join_string_buf_t`.
//
// `PathBuffer::uninit` and `WPathBuffer::uninit` in `src/bun_core/util.rs`
// still use the pattern. Their ~400 call sites need an initialized-prefix API
// (or the path buffer pool) before they can change. This lint keeps that set
// from growing; remove the entry when those two are fixed.
const KNOWN_SITES = ["src/bun_core/util.rs"];

// The lints whose suppression marks the pattern.
const LINTS = ["invalid_value", "clippy::uninit_assumed_init"];

/**
 * `#[allow(..)]` / `#[expect(..)]` attributes, outer or inner, wherever they
 * are written (macro input and `macro_rules!` templates included), whose list
 * names one of `LINTS` directly. rustfmt wrapping and the position in the list
 * do not matter; prose in comments and strings is never matched.
 */
function findUninitEscapes(file: RustFile): Attribute[] {
  return file
    .allAttributes()
    .filter(
      attr =>
        (attr.name === "allow" || attr.name === "expect") &&
        attr.meta.kind === "MetaList" &&
        metaItemPaths(attr.meta).some(lint => LINTS.includes(lint)),
    );
}

const sources = rustSources();
const sites = sources
  .filter(src => findUninitEscapes(src.file).length > 0)
  .map(src => src.path)
  .sort();

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the corpus filters over-firing and leaving nothing to
  // scan, which would make the assertion below pass vacuously.
  expect(sources.length).toBeGreaterThan(0);
});

test("the query recognizes the attribute spellings it claims to", () => {
  const matches = (snippet: string) => findUninitEscapes(parseRust(snippet)).length > 0;
  const banned = [
    "#[allow(invalid_value)]\nfn f() {}",
    "#[allow(clippy::uninit_assumed_init)]\nfn f() {}",
    "#[allow(invalid_value, clippy::uninit_assumed_init)]\nfn f() {}",
    "#[expect(invalid_value)]\nfn f() {}",
    "#![allow(invalid_value)]\nfn f() {}",
    // rustfmt-wrapped, and on a statement rather than an item.
    "fn f() {\n    #[allow(\n        clippy::uninit_assumed_init,\n        invalid_value\n    )]\n    let buf: [u8; 4] = unsafe { MaybeUninit::uninit().assume_init() };\n}",
    // Inside a macro template: the escape lands at every expansion.
    "macro_rules! m { () => { #[allow(invalid_value)] fn f() {} }; }",
  ];
  const allowed = [
    "#[allow(dead_code)]\nfn f() {}",
    "#[allow(clippy::uninit_vec)]\nfn f() {}",
    "#[deny(invalid_value)]\nfn f() {}",
    // Prose about the attribute is not the attribute.
    "// #[allow(invalid_value)]\nfn f() {}",
    'const S: &str = "#[allow(invalid_value)]";',
    "fn f() {\n    let invalid_value = 1;\n}",
  ];
  expect(banned.filter(s => !matches(s))).toEqual([]);
  expect(allowed.filter(matches)).toEqual([]);
});

test("no new #[allow(invalid_value)] or #[allow(clippy::uninit_assumed_init)]", () => {
  expect(sites).toEqual(KNOWN_SITES);
});
