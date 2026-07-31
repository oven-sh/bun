// Guards against reintroduction of symbols removed as dead code from the
// top-level C++ bindings and bun_core. Each entry was verified to have zero
// callers across src/ and build/debug/codegen/ before deletion; this test
// fails if any reappear.
//
// This is a source-tree lint: it reads files from src/ and does not touch the
// built binary, so it belongs in test/internal/source-lints/ per the README.

import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

function src(p: string): string {
  return readFileSync(path.join(repoRoot, p), "utf8");
}

test("empty JSX509CertificateConstructor.{h,cpp} and BunHeapProfiler.h do not reappear", () => {
  // JSX509CertificateConstructor.{h,cpp} contained only includes and an empty
  // `namespace Bun { }` block; the real constructor class is defined inline in
  // JSX509Certificate.cpp. BunHeapProfiler.h was only included by its own .cpp;
  // generateHeapProfile is now file-static.
  const deleted = [
    "src/jsc/bindings/JSX509CertificateConstructor.h",
    "src/jsc/bindings/JSX509CertificateConstructor.cpp",
    "src/jsc/bindings/BunHeapProfiler.h",
  ];
  const resurrected = deleted.filter(p => existsSync(path.join(repoRoot, p)));
  expect(resurrected).toEqual([]);
});

test("dead Bun::ERR:: throw wrappers and binding declarations do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // Bun::ERR:: wrappers with zero C++ callers (the corresponding ErrorCode
    // enum values remain; only these convenience throw functions are dead).
    ["src/jsc/bindings/ErrorCode.h", /EncodedJSValue CRYPTO_TIMING_SAFE_EQUAL_LENGTH\(/],
    ["src/jsc/bindings/ErrorCode.h", /EncodedJSValue KEY_GENERATION_JOB_FAILED\(/],
    ["src/jsc/bindings/ErrorCode.h", /EncodedJSValue CLOSED_MESSAGE_PORT\(/],
    ["src/jsc/bindings/ErrorCode.h", /CRYPTO_INVALID_KEYTYPE\(JSC::ThrowScope&, JSC::JSGlobalObject\*\);/],
    ["src/jsc/bindings/ErrorCode.cpp", /EncodedJSValue CRYPTO_TIMING_SAFE_EQUAL_LENGTH\(/],
    ["src/jsc/bindings/ErrorCode.cpp", /EncodedJSValue KEY_GENERATION_JOB_FAILED\(/],
    ["src/jsc/bindings/ErrorCode.cpp", /EncodedJSValue CLOSED_MESSAGE_PORT\(/],
    ["src/jsc/bindings/ErrorCode.cpp", /CRYPTO_INVALID_KEYTYPE\(JSC::ThrowScope& throwScope, JSC::JSGlobalObject\* globalObject\)\n/],
    // Forward-declared template that was never defined or instantiated.
    ["src/jsc/bindings/JSDOMWrapperCache.h", /deprecatedGetDOMStructure/],
    ["src/jsc/bindings/JSDOMWrapperCache.h", /getOrCreateWrapper/],
    // Static factory methods declared but never defined (would link-error if called).
    ["src/jsc/bindings/ModuleLoader.h", /createWithInitialValues/],
    ["src/jsc/bindings/JSNextTickQueue.h", /createWithInitialValues/],
    ["src/jsc/bindings/JSMockFunction.h", /createWithInitialValues/],
    // Constructor declared but never defined.
    ["src/jsc/bindings/AsymmetricKeyValue.h", /AsymmetricKeyValue\(EVP_PKEY\* key, bool owned\);/],
    // Free function with zero callers; ZigGlobalObject::JSBufferList() is used directly.
    ["src/jsc/bindings/JSBufferList.h", /getBufferList/],
    ["src/jsc/bindings/JSBufferList.cpp", /getBufferList/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("bun_core dead helpers do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // *const-out variant of container_of with zero callers; the *mut-out
    // container_of covers every call site.
    ["src/bun_core/lib.rs", /pub const unsafe fn container_of_const\b/],
    ["src/ptr/lib.rs", /\bcontainer_of_const\b/],
    // #[macro_export] literal! macro with zero invocations; callers use byte
    // literals or w!() directly.
    ["src/bun_core/string/immutable/unicode.rs", /macro_rules! literal \{/],
    ["src/bun_core/string/mod.rs", /pub use crate::\{literal,/],
    // From<Arc<SSLConfig>> for SharedPtr: Arc<SSLConfig> is never constructed
    // outside ssl_config.rs; construction sites use SharedPtr::new or the
    // tuple constructor directly.
    ["src/http/ssl_config.rs", /impl From<Arc<SSLConfig>> for SharedPtr/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});
