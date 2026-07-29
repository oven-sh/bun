// Guards against reintroduction of symbols removed as dead code. Each entry
// was verified to have zero callers across src/ and build/debug/codegen/
// before deletion, and a full `bun bd` plus `bun run rust:check-all` (all
// targets) passes without them. This test fails if any of them reappear,
// e.g. via a merge that resurrects a stale file or a copy-paste from an old
// branch.
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

function resurrected(checks: Array<[string, RegExp]>): string[] {
  return checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
}

test("dead PAL::TextEncoding helpers do not reappear", () => {
  // decodeURLEscapeSequences was the only consumer of DecodeEscapeSequences.h;
  // the other encodings (ASCII/Latin1/UTF16/WinLatin1) and the form-submission
  // path existed only to serve each other. Only UTF8Encoding() stays live.
  expect(existsSync(path.join(repoRoot, "src/jsc/bindings/DecodeEscapeSequences.h"))).toBe(false);
  const checks: Array<[string, RegExp]> = [
    ["src/jsc/bindings/TextEncoding.cpp", /decodeURLEscapeSequences/],
    ["src/jsc/bindings/TextEncoding.cpp", /UTF7Encoding/],
    ["src/jsc/bindings/TextEncoding.cpp", /domName/],
    ["src/jsc/bindings/TextEncoding.cpp", /usesVisualOrdering/],
    ["src/jsc/bindings/TextEncoding.cpp", /encodingForFormSubmissionOrURLParsing/],
    ["src/jsc/bindings/TextEncoding.cpp", /ASCIIEncoding/],
    ["src/jsc/bindings/TextEncoding.cpp", /Latin1Encoding/],
    ["src/jsc/bindings/TextEncoding.cpp", /WindowsLatin1Encoding/],
    ["src/jsc/bindings/TextEncoding.cpp", /UTF16BigEndianEncoding/],
    ["src/jsc/bindings/TextEncoding.h", /isByteBasedEncoding/],
    ["src/jsc/bindings/TextEncoding.h", /decodeURLEscapeSequences/],
    // Registry side: the japanese-encodings set is only read by isJapanese().
    ["src/jsc/bindings/TextEncodingRegistry.cpp", /isJapaneseEncoding/],
    ["src/jsc/bindings/TextEncodingRegistry.cpp", /noExtendedTextEncodingNameUsed/],
    ["src/jsc/bindings/TextEncodingRegistry.cpp", /defaultTextEncodingNameForSystemLanguage/],
    ["src/jsc/bindings/TextEncodingRegistry.cpp", /japaneseEncodings/],
    ["src/jsc/bindings/TextEncodingRegistry.h", /webDefaultCFStringEncoding/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead JSDOMExceptionHandling helpers do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/jsc/bindings/JSDOMExceptionHandling.cpp", /retrieveErrorMessageWithoutName/],
    ["src/jsc/bindings/JSDOMExceptionHandling.cpp", /reportCurrentException/],
    ["src/jsc/bindings/JSDOMExceptionHandling.cpp", /throwNotSupportedError/],
    ["src/jsc/bindings/JSDOMExceptionHandling.cpp", /throwInvalidStateError/],
    ["src/jsc/bindings/JSDOMExceptionHandling.cpp", /throwSecurityError/],
    ["src/jsc/bindings/JSDOMExceptionHandling.cpp", /throwAttributeTypeError/],
    ["src/jsc/bindings/JSDOMExceptionHandling.cpp", /makeUnsupportedIndexedSetterErrorMessage/],
    ["src/jsc/bindings/JSDOMExceptionHandling.cpp", /throwDOMSyntaxError/],
    ["src/jsc/bindings/JSDOMExceptionHandling.h", /reportExceptionIfJSDOMWindow/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead DOMURL/JSDOMURL C++ createObjectURL stubs do not reappear", () => {
  // URL.createObjectURL/revokeObjectURL are implemented in Rust
  // (Bun__createObjectURL/Bun__revokeObjectURL); the C++ bodies were no-op
  // stubs referenced only from commented-out IDL-generated code.
  const checks: Array<[string, RegExp]> = [
    ["src/jsc/bindings/DOMURL.cpp", /class URLRegistrable/],
    ["src/jsc/bindings/DOMURL.cpp", /DOMURL::createObjectURL/],
    ["src/jsc/bindings/DOMURL.cpp", /DOMURL::createPublicURL/],
    ["src/jsc/bindings/DOMURL.cpp", /DOMURL::revokeObjectURL/],
    ["src/jsc/bindings/DOMURL.h", /createPublicURL/],
    ["src/jsc/bindings/webcore/JSDOMURL.cpp", /jsDOMURLConstructorFunction_createObjectURL\b/],
    ["src/jsc/bindings/webcore/JSDOMURL.cpp", /jsDOMURLConstructorFunction_revokeObjectURL\b/],
    ["src/jsc/bindings/webcore/JSDOMURL.cpp", /createObjectURLOverloadDispatcher/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead DOMWrapperWorld/ActiveDOMCallback members do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/jsc/bindings/DOMWrapperWorld-class.h", /class WindowProxy/],
    ["src/jsc/bindings/DOMWrapperWorld-class.h", /clearWrappers/],
    ["src/jsc/bindings/DOMWrapperWorld-class.h", /didCreateWindowProxy/],
    ["src/jsc/bindings/DOMWrapperWorld-class.h", /shadowRootIsAlwaysOpen/],
    ["src/jsc/bindings/DOMWrapperWorld-class.h", /m_jsWindowProxies/],
    ["src/jsc/bindings/DOMWrapperWorld.cpp", /clearWrappers/],
    // The ScriptExecutionContext methods stay; only ActiveDOMCallback's own
    // forwarders were dead.
    ["src/jsc/bindings/ActiveDOMCallback.cpp", /ActiveDOMCallback::activeDOMObjectsAreSuspended/],
    ["src/jsc/bindings/ActiveDOMCallback.cpp", /ActiveDOMCallback::activeDOMObjectAreStopped/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("stale commented-out src/js blocks and unused internal helpers do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // 230 lines of commented-out acorn-based source-parsing scaffolding; the
    // live getErrMessage() always returned undefined.
    ["src/js/internal/assert/utils.ts", /function getErrMessage\b/],
    ["src/js/internal/assert/utils.ts", /findColumn/],
    ["src/js/internal/assert/utils.ts", /escapeSequencesRegExp/],
    ["src/js/internal/util/inspect.js", /stylizeWithHTML/],
    ["src/js/internal/util/inspect.js", /function escapeHTML\b/],
    ["src/js/node/_http_server.ts", /\/\/ fetch\(req, _server\)/],
    ["src/js/node/_http_server.ts", /http_req\.socket\[kInternalSocketData\]/],
    ["src/js/internal/cluster/primary.ts", /isUsingInspector/],
    // Internal-only exports with zero consumers across src/.
    ["src/js/internal/streams/utils.ts", /isReadableEnded/],
    ["src/js/internal/sql/shared.ts", /isOptionsOfAdapter/],
    ["src/js/internal/sql/shared.ts", /assertIsOptionsOfAdapter/],
    ["src/js/internal/primordials.js", /\bSafePromiseAll\b/],
    ["src/js/internal/primordials.js", /arrayToSafePromiseIterable/],
    ["src/js/internal/validators.ts", /validateInternalField/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead http_types/h2 wire types and postgres Default impls do not reappear", () => {
  // FullSettingsPayload duplicated runtime/api/bun/h2_frame_parser.rs's own
  // local copy; nothing in bun_http_types or bun_http referenced it.
  expect(existsSync(path.join(repoRoot, "src/runtime/valkey_jsc/index.rs"))).toBe(false);
  const checks: Array<[string, RegExp]> = [
    ["src/http_types/h2.rs", /struct FullSettingsPayload/],
    ["src/http_types/h2.rs", /SETTINGS_ENABLE_CONNECT_PROTOCOL/],
    ["src/http_types/h2.rs", /pub const fn init\(value: u32, reserved: bool\)/],
    ["src/http_types/mime_type_list_enum.rs", /pub const fn as_str\b/],
    // These Default impls are never invoked; each struct is constructed with
    // all fields explicit at its single call site.
    ["src/sql/postgres/protocol/StartupMessage.rs", /impl Default for StartupMessage/],
    ["src/sql/postgres/protocol/SASLInitialResponse.rs", /impl Default for SASLInitialResponse/],
    ["src/sql/postgres/protocol/PasswordMessage.rs", /impl Default for PasswordMessage/],
    ["src/sql/postgres/protocol/FieldDescription.rs", /impl Default for FieldDescription/],
    ["src/sql/postgres/protocol/ReadyForQuery.rs", /impl Default for ReadyForQuery/],
    ["src/sql/postgres/protocol/TransactionStatusIndicator.rs", /impl TransactionStatusIndicator/],
    ["src/bun_core/string/MutableString.rs", /pub fn index_of\(&self, str: u8\)/],
    ["src/bun_core/string/MutableString.rs", /pub fn eql\(&self, other: &\[u8\]\)/],
    ["src/runtime/valkey_jsc/mod.rs", /pub use valkey_command as ValkeyCommand/],
  ];
  expect(resurrected(checks)).toEqual([]);
});
