// Guards against reintroduction of symbols and manifest entries removed as
// dead code from bun_ast, bun_runtime, and bun_spawn. Each entry was verified
// to have zero references across src/, scripts/, packages/, and freshly
// regenerated build/debug/codegen/ output before deletion, and the removal was
// validated by a full `bun bd` build plus `cargo check` across targets.
//
// This is a source-tree lint: it reads files from src/ and does not touch the
// built binary, so it belongs in test/internal/source-lints/ per the README.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

function src(p: string): string {
  return readFileSync(path.join(repoRoot, p), "utf8");
}

test("dead Rust symbols (ast, runtime) do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // ToJSError::MacroError: leftover of the removed Zig macro system; nothing
    // ever constructed it (its only mention was a defensive match arm in
    // YAMLObject.rs). The MacroError enum in js_parser_jsc/Macro.rs is a
    // different, live type.
    ["src/ast/nodes.rs", /\bMacroError\b/],
    ["src/runtime/api/YAMLObject.rs", /Up::MacroError/],
    // Module alias nothing referenced; chrome_process stays reachable via
    // crate::webview::chrome_process and its host_fn exports.
    ["src/runtime/api.rs", /chrome_process as ChromeProcess/],
    // Algorithm's strum::IntoStaticStr derive generated a From impl with zero
    // call sites (name parsing goes through algorithm_from_zig_string, and
    // hash-string formatting goes through pwhash); PartialEq/Eq were likewise
    // never used.
    ["src/runtime/crypto/PasswordObject.rs", /\bstrum\b/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("dead built-in JS code does not reappear", () => {
  // bake/debug.ts: commented-out globalThis.ASSERT draft superseded verbatim
  // by the live globalThis.DEBUG.ASSERT directly below it.
  expect(src("src/runtime/bake/debug.ts")).not.toMatch(/globalThis\.ASSERT/);
});

test("unused Cargo dependency edges do not reappear", () => {
  // bun_runtime references bun_css only through bun_css_jsc, and never
  // references bun_transpiler; bun_spawn never references bstr. Verified via
  // zero textual references (including cfg-gated code) in each crate.
  expect(src("src/runtime/Cargo.toml")).not.toMatch(/^bun_css\.workspace/m);
  expect(src("src/runtime/Cargo.toml")).not.toMatch(/^bun_transpiler\.workspace/m);
  expect(src("src/spawn/Cargo.toml")).not.toMatch(/^bstr\.workspace/m);
});
