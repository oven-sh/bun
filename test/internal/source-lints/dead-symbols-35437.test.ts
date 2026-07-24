// Guards against reintroduction of symbols removed in #35437. Each entry was
// verified to have zero callers across src/, vendor/, packages/, and
// build/debug/codegen/ before deletion; this test fails if any of them
// reappear (e.g. via a merge that resurrects a stale file, or a copy-paste
// from an old branch).
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

test("dead extern C symbols removed in #35437 do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/jsc/bindings/ZigGlobalObject.cpp", /\bfunctionFulfillModuleSync\b/],
    ["src/jsc/bindings/ZigGlobalObject.cpp", /\bZig__GlobalObject__resetModuleRegistryMap\b/],
    ["src/jsc/bindings/bindings.cpp", /\bBun__REPL__formatValue\b/],
    ["src/jsc/bindings/bindings.cpp", /\bJSC__JSValue__DateNowISOString\b/],
    ["src/jsc/bindings/bindings.cpp", /\bDOMFormData__toQueryString\b/],
    ["src/jsc/bindings/c-bindings.cpp", /\bBun__disableSOLinger\b/],
    ["src/jsc/bindings/SQLClient.cpp", /\bJSC__createEmptyObjectWithStructure\b/],
    ["src/jsc/bindings/RegularExpression.cpp", /\bYarr__RegularExpression__searchRev\b/],
    ["src/jsc/bindings/webcore/JSFetchHeaders.cpp", /\bjsFetchHeaders_getRawKeys\b/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("dead JS builtins removed in #35437 do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/js/builtins/CommonJS.ts", /\bloadEsmIntoCjs__dead\b/],
    ["src/js/builtins/JSBufferPrototype.ts", /export function setBigUint64\b/],
    ["src/js/internal/http.ts", /\bemitCloseNTAndComplete\b/],
    ["src/js/internal/http.ts", /\bClientRequestEmitState\b/],
    ["src/js/internal/http.ts", /const kUpgradeOrConnect = Symbol/],
    ["src/js/builtins/BunBuiltinNames.h", /macro\(fulfillModuleSync\)/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("dead CSS option chains removed in #35437 do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/css/printer.rs", /pub analyze_dependencies:/],
    ["src/css/printer.rs", /pub struct PseudoClasses\b/],
    ["src/css/dependencies.rs", /pub struct ImportDependency\b/],
    ["src/css/dependencies.rs", /pub struct UrlDependency\b/],
    ["src/css/css_modules.rs", /pub grid:/],
    ["src/css/error.rs", /ambiguous_url_in_custom_property/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("dead Rust pub items removed in #35437 do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/collections/pool.rs", /pub trait ObjectPoolTrait\b/],
    ["src/collections/pool.rs", /pub fn insert_after\b/],
    ["src/collections/hive_array.rs", /pub fn get_and_see_if_new\b/],
    ["src/bun_core/util.rs", /pub struct FdOptional\b/],
    ["src/bun_core/env_var.rs", /\bBUN_NEEDS_PROC_SELF_WORKAROUND\b/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});
