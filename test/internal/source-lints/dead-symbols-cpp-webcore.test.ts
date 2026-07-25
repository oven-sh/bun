// Guards against reintroduction of symbols removed in the C++ webcore / src/js
// dead-code sweep. Each entry was verified to have zero callers across src/ and
// build/debug/codegen/ before deletion, and a full build passes without them.
// Failing means a merge or copy-paste resurrected a stale definition.
//
// Source-tree lint: reads files from src/ only, never touches the built binary.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

function src(p: string): string {
  return readFileSync(path.join(repoRoot, p), "utf8");
}

function resurrected(checks: Array<[string, RegExp]>): string[] {
  return checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
}

test("dead C++ static helpers in JSMIMEType.cpp do not reappear", () => {
  // JSMIMEParams.cpp has its own copies of these which are live; the
  // JSMIMEType.cpp copies were never called.
  const checks: Array<[string, RegExp]> = [
    ["src/jsc/bindings/webcore/JSMIMEType.cpp", /static int findFirstInvalidHTTPQuotedStringChar/],
    ["src/jsc/bindings/webcore/JSMIMEType.cpp", /static String removeBackslashes/],
    ["src/jsc/bindings/webcore/JSMIMEType.cpp", /static String escapeQuoteOrBackslash/],
    ["src/jsc/bindings/webcore/JSMIMEType.cpp", /static String encodeParamValue/],
    ["src/jsc/bindings/webcore/JSMIMEType.cpp", /static inline bool isHTTPQuotedStringChar/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead extern C functions do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // setupBunPlugin always wires the *Bun variants; Node/Browser variants
    // were defined but never passed to putDirectNativeFunction.
    ["src/jsc/bindings/BunPlugin.cpp", /jsFunctionAppendOnLoadPluginNode/],
    ["src/jsc/bindings/BunPlugin.cpp", /jsFunctionAppendOnLoadPluginBrowser/],
    ["src/jsc/bindings/BunPlugin.cpp", /jsFunctionAppendOnResolvePluginNode/],
    ["src/jsc/bindings/BunPlugin.cpp", /jsFunctionAppendOnResolvePluginBrowser/],
    ["src/jsc/bindings/FormatStackTraceForJS.cpp", /formatStackTraceToJSValueWithoutPrepareStackTrace/],
    // Not in BunProcess.lut.h and not referenced by name anywhere.
    ["src/jsc/bindings/BunProcess.cpp", /Process_defaultSetter/],
    // rescle__setWindowsMetadata is the unified replacement; this was orphaned
    // when its Rust caller was removed.
    ["src/jsc/bindings/windows/rescle-binding.cpp", /extern "C" int rescle__setIcon/],
    // Non-standard N-API; no caller in the tree or in vendor/nodejs headers.
    ["src/jsc/bindings/napi.cpp", /extern "C" void napi_set_ref/],
    ["src/jsc/bindings/napi.cpp", /extern "C" uint32_t napi_internal_get_version/],
    ["src/jsc/bindings/node/crypto/CryptoUtil.cpp", /Bun__NodeCrypto__createCryptoError/],
    ["src/jsc/bindings/ErrorStackTrace.cpp", /Bun__errorInstance__finalize/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead src/js items do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // Replaced by $ERR_* intrinsics; this block has been commented out since
    // 2022 (be108c0f).
    ["src/js/node/child_process.ts", /^\/\/ function makeNodeErrorWithCode/m],
    ["src/js/node/url.ts", /^\/\/ function fileURLToPath\(\.\.\.args\)/m],
    // kSettingIds (the inverse map) is what getUnpackedSettings uses.
    ["src/js/node/http2.ts", /^const kSettingNames = \{/m],
    ["src/js/node/http2.ts", /^const bunTLSConnectOptions = Symbol/m],
    ["src/js/node/http2.ts", /^const RegExpPrototypeExec =/m],
    ["src/js/node/http2.ts", /^const DatePrototypeToUTCString =/m],
    ["src/js/node/http2.ts", /^const DatePrototypeGetMilliseconds =/m],
    ["src/js/internal/shared.ts", /kGetNativeReadableProto/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead Rust items do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // All call sites resolve to bun_jsc::console_object::formatter::ZigFormatter
    // (2-arg new); this 3-arg duplicate over pretty_format::Formatter was
    // unreachable.
    ["src/runtime/test_runner/pretty_format.rs", /pub struct ZigFormatter/],
    // Commented-out Zig leftover from the port.
    ["src/runtime/bake/dev_server/serialized_failure.rs", /\/\/ fn writeJsValue\(value: JSValue/],
    ["src/runtime/shell/subproc.rs", /\/\/ pub const Pipe = struct \{/],
  ];
  expect(resurrected(checks)).toEqual([]);
});
