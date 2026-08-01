// Guards against reintroduction of symbols and files removed as dead code from
// the C++ bindings (llhttp/api.h, helpers.h, headers-handwritten.h,
// HTTPHeaderValues, JSDOMConvertJSON/WebGL, TaskSource, JSVMClientDataClient,
// ares_build.h, headers-cpp.h) and a handful of uncalled Rust helpers in
// bun_core::String / bun_jsc. Each entry was verified to have zero callers
// across src/ and build/debug/codegen/ before deletion.
//
// This is a source-tree lint: it reads files from src/ and does not touch the
// built binary.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

function src(p: string): string {
  return readFileSync(path.join(repoRoot, p), "utf8");
}

// Whole-file deletions (llhttp/api.h, headers-cpp.h, ares_build.h, TaskSource.h,
// HTTPHeaderValues.{h,cpp}, JSDOMConvertJSON.h, JSDOMConvertWebGL.{h,cpp},
// JSVMClientDataClient.h) are asserted indirectly below via the surviving
// files that used to reference them: if any of those deleted headers were
// referenced anywhere, the build would fail. The headers that were never
// `#include`d at all (api.h, ares_build.h, TaskSource.h, HTTPHeaderValues.h)
// have no surviving-file witness to check here.

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
    ["src/jsc/bindings/BunClientData.h", /JSVMClientDataClient\.h/],
    ["src/jsc/bindings/BunClientData.h", /WeakHashSet\.h/],
    ["src/jsc/bindings/BunClientData.cpp", /\bm_clients\b/],
    ["src/jsc/bindings/webcore/JSDOMConvert.h", /JSDOMConvertJSON\.h/],
    ["src/jsc/bindings/webcore/JSDOMConvert.h", /JSDOMConvertWebGL\.h/],
    ["src/jsc/bindings/IDLTypes.h", /\bIDLJSON\b/],
    ["src/jsc/headergen/sizegen.cpp", /headers-cpp\.h/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("dead Rust symbols in bun_core / jsc do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/bun_core/string/mod.rs", /\bStringGithubActionFormatter\b/],
    ["src/jsc/JSUint8Array.rs", /pub fn ptr\(&self\) -> \*mut u8/],
    ["src/jsc/sizes.rs", /\bBUN_FFI_POINTER_OFFSET_TO_TYPED_ARRAY_VECTOR\b/],
    ["src/jsc/RefString.rs", /pub fn to_js\(&self,/],
    ["src/jsc/Errorable.rs", /pub fn value\(val: T\)/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});
