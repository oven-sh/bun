// Source-tree lint: the `JSC__JSValue__forEachProperty*` callback passes a
// single `PropertyKeyKind` discriminant across the FFI boundary, not a
// dependent `(is_symbol, is_private_symbol)` bool pair. A private name is
// always a symbol in JSC, so the bool pair admitted an unreachable state.
// This asserts the enum is present on both sides and the bool pair has not
// been reintroduced.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

function src(p: string): string {
  return readFileSync(path.join(repoRoot, p), "utf8");
}

test("forEachProperty callback uses PropertyKeyKind, not an (is_symbol, is_private_symbol) bool pair", () => {
  // The dependent-bool pair must not reappear at the FFI boundary or its consumers.
  const boolPair: Array<[string, RegExp]> = [
    ["src/jsc/JSValue.rs", /\bis_private_symbol: bool\b/],
    ["src/jsc/ConsoleObject.rs", /\bis_private_symbol: bool\b/],
    ["src/runtime/test_runner/pretty_format.rs", /\bis_private_symbol: bool\b/],
    ["src/jsc/bindings/bindings.cpp", /\bbool isPrivateSymbol\b/],
    ["src/jsc/bindings/headers.h", /\bbool arg4, bool arg5\)\);\s*\n.*forEachPropertyOrdered/],
  ];
  const resurrected = boolPair.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);

  // The enum must exist on both sides with matching discriminants so the
  // `#[repr(u8)]` <-> `uint8_t` ABI stays in sync.
  const jsvalue = src("src/jsc/JSValue.rs");
  const bindings = src("src/jsc/bindings/bindings.cpp");
  expect(jsvalue).toMatch(/pub enum PropertyKeyKind \{\s*String = 0,\s*Symbol = 1,\s*PrivateSymbol = 2,\s*\}/);
  expect(bindings).toMatch(
    /enum class PropertyKeyKind : uint8_t \{\s*String = 0,\s*Symbol = 1,\s*PrivateSymbol = 2,\s*\}/,
  );
});
