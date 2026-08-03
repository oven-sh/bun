// Guards against reintroduction of symbols removed as dead code. Each symbol
// was verified to have zero callers across src/ and build/debug/codegen/
// before deletion; `bun bd` and `rust:check-all` (all targets) pass without
// them. Only checks files that are modified (not deleted) so readFileSync
// never sees ENOENT.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
const src = (p: string) => readFileSync(path.join(repoRoot, p), "utf8");

test("dead TextEncoding/DOMURL/JSDOMExceptionHandling C++ does not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/jsc/bindings/TextEncoding.cpp", /decodeURLEscapeSequences|UTF7Encoding|domName/],
    ["src/jsc/bindings/TextEncoding.cpp", /encodingForFormSubmissionOrURLParsing|WindowsLatin1Encoding/],
    ["src/jsc/bindings/TextEncodingRegistry.cpp", /isJapaneseEncoding|defaultTextEncodingNameForSystemLanguage/],
    ["src/jsc/bindings/JSDOMExceptionHandling.cpp", /throwNotSupportedError|throwSecurityError|throwDOMSyntaxError/],
    ["src/jsc/bindings/JSDOMExceptionHandling.cpp", /retrieveErrorMessageWithoutName|reportCurrentException/],
    ["src/jsc/bindings/DOMURL.cpp", /class URLRegistrable|DOMURL::createObjectURL|DOMURL::createPublicURL/],
    ["src/jsc/bindings/webcore/JSDOMURL.cpp", /jsDOMURLConstructorFunction_createObjectURL\b/],
    ["src/jsc/bindings/DOMWrapperWorld-class.h", /clearWrappers|didCreateWindowProxy|m_jsWindowProxies/],
    ["src/jsc/bindings/ActiveDOMCallback.cpp", /ActiveDOMCallback::activeDOMObjectsAreSuspended/],
  ];
  const found = checks.filter(([f, re]) => re.test(src(f))).map(([f, re]) => `${f}: ${re.source}`);
  expect(found).toEqual([]);
});

test("dead src/js internal helpers and commented-out blocks do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/js/internal/assert/utils.ts", /function getErrMessage\b|findColumn|escapeSequencesRegExp/],
    ["src/js/internal/util/inspect.js", /stylizeWithHTML|function escapeHTML\b/],
    ["src/js/node/_http_server.ts", /\/\/ fetch\(req, _server\)/],
    ["src/js/internal/streams/utils.ts", /isReadableEnded/],
    ["src/js/internal/sql/shared.ts", /isOptionsOfAdapter/],
    ["src/js/internal/primordials.js", /\bSafePromiseAll\b|arrayToSafePromiseIterable/],
    ["src/js/internal/validators.ts", /validateInternalField/],
  ];
  const found = checks.filter(([f, re]) => re.test(src(f))).map(([f, re]) => `${f}: ${re.source}`);
  expect(found).toEqual([]);
});

test("dead http_types/h2 and postgres Default impls do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/http_types/h2.rs", /struct FullSettingsPayload|SETTINGS_ENABLE_CONNECT_PROTOCOL/],
    ["src/sql/postgres/protocol/StartupMessage.rs", /impl Default for StartupMessage/],
    ["src/sql/postgres/protocol/SASLInitialResponse.rs", /impl Default for SASLInitialResponse/],
    ["src/sql/postgres/protocol/PasswordMessage.rs", /impl Default for PasswordMessage/],
    ["src/runtime/valkey_jsc/mod.rs", /pub mod index\b|pub use valkey_command as ValkeyCommand/],
  ];
  const found = checks.filter(([f, re]) => re.test(src(f))).map(([f, re]) => `${f}: ${re.source}`);
  expect(found).toEqual([]);
});
