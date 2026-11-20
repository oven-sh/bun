import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// src/simd/README.md lists what has to be trusted, and all of it is in `trusted/`. The other crates forbid
// `unsafe_code`, and `conformance/` denies it. This is the same rule for their text, as it is before a macro has expanded it.
const simd = path.resolve(import.meta.dir, "..", "..", "..", "src", "simd");
const all = [...new Glob("**/*.rs").scanSync({ cwd: simd })]
  .map(file => file.replaceAll("\\", "/"))
  .sort()
  .map(file => [file, readFileSync(path.join(simd, file), "utf8")]);
// These two try out instructions and map pages, for `bun test --run-simd-tests`.
const sources = all.filter(([file]) => !/^(?:trusted\/|conformance\/(?:probe|room)\.rs$)/.test(file));

const find = (pattern: RegExp, texts = sources) =>
  texts.flatMap(([file, text]) => [...text.matchAll(pattern)].map(match => `${file}: ${match[0]}`));

test("only trusted/ has the words for what rustc does not check", () => {
  expect(sources.length).toBeGreaterThan(40);
  const unchecked = /unsafe|(?<!w)asm|naked|no_mangle|export_name|link_section|allow_internal_\w+|rustc_(?!unroll)\w+/;
  const otherFiles = /include|(?<=[[,(]\s*)path(?=\s*=)|mod\s+(?:r#)?(?:trusted|conformance)/;
  // A comment can have them after a backtick, which code cannot.
  const words = new RegExp(`(?<!\`)(?:${unchecked.source}|${otherFiles.source})\\b`, "g");
  const samples = ["\\nunsafe {", "global_asm!", '#[path = r"a"]', "use core::include as a;", "mod conformance {"];
  expect(samples.filter(it => !it.match(words))).toEqual([]);
  expect(find(words)).toEqual([
    "dispatch.rs: rustc_align",
    "dispatch.rs: rustc_align",
    "macros/lib.rs: allow_internal_unstable",
    "macros/lib.rs: allow_internal_unstable",
    "macros/lib.rs: rustc_attrs",
    "macros/lib.rs: rustc_force_inline",
  ]);
  expect(find(/^#!\[forbid\(unsafe_code\)\]$/gm)).toEqual(
    expect.arrayContaining(["lib.rs", "kernels/lib.rs", "macros/lib.rs"].map(it => `${it}: #![forbid(unsafe_code)]`)),
  );
  expect(find(/.*(?<!forbid\()unsafe_code.*(?:\s+mod \w+)?/g).map(it => it.replace(/\s+/g, " "))).toEqual([
    "conformance/lib.rs: #![deny(unsafe_code)]",
    "conformance/lib.rs: #[allow(unsafe_code)] mod probe",
    "conformance/lib.rs: #[allow(unsafe_code)] mod room",
    "lib.rs: #![doc(test(attr(deny(unsafe_code, unfulfilled_lint_expectations), allow(unused))))]",
  ]);
});

test("the unstable features outside of trusted/ are known", () => {
  expect(find(/\bfeature\s*[(/][^)]*\)/g)).toEqual([
    "conformance/lib.rs: feature(loop_hints, stmt_expr_attributes)",
    "conformance/lib.rs: feature(aarch64_unstable_target_feature)",
    "kernels/lib.rs: feature(hint_prefetch, loop_hints, trait_alias)",
    "kernels/lib.rs: feature(const_array, const_closures, const_trait_impl)",
    "lib.rs: feature(portable_simd, likely_unlikely, loop_hints, trait_alias, try_blocks)",
    "lib.rs: feature(const_array, const_closures, const_trait_impl, fn_align)",
    "macros/lib.rs: feature(allow_internal_unstable)",
    "tests/dispatch.rs: feature(closure_track_caller)",
  ]);
});

// A macro of the caller would get tokens for which `unsafe_code` is not reported.
test("what the macros add calls known macros only", () => {
  const rules = all.flatMap(([file, text]) => [...text.matchAll(/macro_export([^]*)/g)].map(it => [file, it[1]]));
  expect(find(/\S*\s*!|macro_export/g, rules)).toEqual([
    "dispatch.rs: macro_rules!",
    "dispatch.rs: $crate::if_supported!",
    "dispatch.rs: $crate::export!",
    "trusted/gate.rs: macro_rules!",
  ]);
  const strings = find(/'"'|"(?:[^"\\]|\\[^])*"/g).filter(it => it.startsWith("macros/"));
  expect(strings.filter(it => /(?<!#)!/.test(it))).toEqual(['macros/lib.rs: "::bun_simd::export!"']);
});
