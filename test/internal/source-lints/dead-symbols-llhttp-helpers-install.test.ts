// Guards against reintroduction of symbols and files removed as dead code from
// the C++ bindings (llhttp/api.h, helpers.h, headers-handwritten.h,
// HTTPHeaderValues, JSDOMConvertJSON/WebGL, TaskSource, JSVMClientDataClient,
// ares_build.h, headers-cpp.h), the install crate's write-only
// LifecycleScriptTimeLog chain, and a handful of uncalled Rust helpers in
// bun_core::String / bun_jsc. Each entry was verified to have zero callers
// across src/ and build/debug/codegen/ before deletion.
//
// This is a source-tree lint: it reads files from src/ and does not touch the
// built binary.

import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

function src(p: string): string {
  return readFileSync(path.join(repoRoot, p), "utf8");
}

test("deleted dead C++ headers and sources do not reappear", () => {
  const deleted = [
    "src/jsc/bindings/node/http/llhttp/api.h",
    "src/jsc/bindings/headers-cpp.h",
    "src/jsc/bindings/ares_build.h",
    "src/jsc/bindings/JSVMClientDataClient.h",
    "src/jsc/bindings/webcore/TaskSource.h",
    "src/jsc/bindings/webcore/HTTPHeaderValues.h",
    "src/jsc/bindings/webcore/HTTPHeaderValues.cpp",
    "src/jsc/bindings/webcore/JSDOMConvertJSON.h",
    "src/jsc/bindings/webcore/JSDOMConvertWebGL.h",
    "src/jsc/bindings/webcore/JSDOMConvertWebGL.cpp",
  ];
  const resurrected = deleted.filter(p => existsSync(path.join(repoRoot, p)));
  expect(resurrected).toEqual([]);
});

test("dead C++ symbols in helpers.h / headers-handwritten.h / JSDOMWrapper.h / BunClientData do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/jsc/bindings/helpers.h", /static WTF::AtomString toAtomString\(ZigString/],
    ["src/jsc/bindings/helpers.h", /\btoStringNotConst\b/],
    ["src/jsc/bindings/helpers.h", /\b__dot_char\b/],
    ["src/jsc/bindings/helpers.h", /\bZigStringCwd\b/],
    ["src/jsc/bindings/helpers.h", /\bBunStringCwd\b/],
    ["src/jsc/bindings/helpers.h", /toZigString\(WTF::String\*/],
    ["src/jsc/bindings/helpers.h", /toZigString\(JSC::Identifier&/],
    ["src/jsc/bindings/helpers.h", /toZigString\(JSC::Identifier\*/],
    ["src/jsc/bindings/helpers.h", /static WTF::StringView toStringView\(ZigString/],
    ["src/jsc/bindings/headers-handwritten.h", /\bWritableEvent__Close\b/],
    ["src/jsc/bindings/headers-handwritten.h", /\bReadableEvent__Close\b/],
    ["src/jsc/bindings/JSDOMWrapper.h", /\bJSTextNodeType\b/],
    ["src/jsc/bindings/JSDOMWrapper.h", /\bJSDocumentWrapperType\b/],
    ["src/jsc/bindings/BunClientData.h", /\baddClient\b/],
    ["src/jsc/bindings/BunClientData.h", /\bm_clients\b/],
    ["src/jsc/bindings/BunClientData.cpp", /\bm_clients\b/],
    ["src/jsc/bindings/webcore/JSDOMConvert.h", /JSDOMConvertJSON\.h/],
    ["src/jsc/bindings/webcore/JSDOMConvert.h", /JSDOMConvertWebGL\.h/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("dead Rust symbols in install / bun_core / jsc do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/install/PackageManager/PackageManagerLifecycle.rs", /\bLifecycleScriptTimeLog\b/],
    ["src/install/PackageManager.rs", /\blifecycle_script_time_log\b/],
    ["src/install/lifecycle_script_runner.rs", /\bMIN_MILLISECONDS_TO_LOG\b/],
    ["src/install/lifecycle_script_runner.rs", /pub\(crate\) timer: Option<Timer>/],
    ["src/install/lifecycle_script_runner.rs", /unsafe fn manager_mut\b/],
    ["src/bun_core/string/mod.rs", /\bStringGithubActionFormatter\b/],
    ["src/jsc/JSUint8Array.rs", /pub fn ptr\(&self\) -> \*mut u8/],
    ["src/jsc/sizes.rs", /\bBUN_FFI_POINTER_OFFSET_TO_TYPED_ARRAY_VECTOR\b/],
    ["src/jsc/RefString.rs", /pub fn to_js\(&self,/],
    ["src/jsc/Errorable.rs", /pub fn value\(val: T\)/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});
