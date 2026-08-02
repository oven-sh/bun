// Guards against reintroduction of symbols removed as dead code from
// webcore DOMJIT/EventPath/EventContext/EventListenerMap and assorted C++
// bindings (ErrorCode overloads, DOMException, CookieMap, DOMFormData,
// JSCommonJSModule, ImportMetaObject, Sink). Each entry was verified to have
// zero callers across src/ and build/debug/codegen/ before deletion; this test
// fails if any reappear.
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

test("webcore DOMJIT dead files and helpers do not reappear", () => {
  // Deleted-file absence is asserted indirectly via surviving files: the
  // JSDOMConvert.h include and the JSEvent.* references below are the only
  // places the deleted headers/symbols were wired in.
  const checks: Array<[string, RegExp]> = [
    ["src/jsc/bindings/webcore/DOMJITHelpers.h", /namespace DOMJIT\b/],
    ["src/jsc/bindings/webcore/DOMJITHelpers.h", /branchIfNotWorldIsNormal|branchIfNotEvent|operationToJSNode/],
    ["src/jsc/bindings/webcore/JSDOMConvert.h", /JSDOMConvertSerializedScriptValue\.h/],
    ["src/jsc/bindings/webcore/JSEvent.cpp", /checkSubClassSnippetForJSEvent/],
    ["src/jsc/bindings/webcore/JSEvent.h", /checkSubClassSnippetForJSEvent/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("webcore EventPath/EventContext/EventListenerMap dead members do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/jsc/bindings/webcore/EventListenerMap.h", /removeFirstEventListenerCreatedFromMarkup/],
    ["src/jsc/bindings/webcore/EventListenerMap.h", /copyEventListenersNotCreatedFromMarkupToTarget/],
    [
      "src/jsc/bindings/webcore/EventListenerMap.cpp",
      /removeFirstListenerCreatedFromMarkup|copyListenersNotCreatedFromMarkupToTarget/,
    ],
    ["src/jsc/bindings/webcore/EventPath.h", /eventTargetRespectingTargetRules/],
    ["src/jsc/bindings/webcore/EventPath.h", /\bbuildPath\b|\bcontextAt\b/],
    ["src/jsc/bindings/webcore/EventPath.h", /EventPath\(Node& origin, Event&\)/],
    ["src/jsc/bindings/webcore/EventContext.h", /\bhandleLocalEvents\b/],
    ["src/jsc/bindings/webcore/EventContext.h", /\bsetRelatedTarget\b|\bisMouseOrFocusEventContext\b/],
    ["src/jsc/bindings/webcore/EventContext.h", /\bisTouchEventContext\b|\bisWindowContext\b/],
    ["src/jsc/bindings/webcore/EventContext.h", /\bisCurrentTargetInShadowTree\b|\bEventInvokePhase\b/],
    ["src/jsc/bindings/webcore/EventContext.h", /\bm_node\b|\bm_target\b|\bm_currentTargetIsInShadowTree\b/],
    ["src/jsc/bindings/webcore/EventContext.h", /enum class Type : uint8_t/],
    ["src/jsc/bindings/webcore/EventContext.cpp", /\bhandleLocalEvents\b|\bisUnreachableNode\b/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("misc C++ bindings dead declarations do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/jsc/bindings/ErrorCode.h", /^JSC::JSValue toJS\(JSC::JSGlobalObject\*, ErrorCode\);/m],
    [
      "src/jsc/bindings/ErrorCode.h",
      /CRYPTO_JWK_UNSUPPORTED_CURVE\(JSC::ThrowScope&, JSC::JSGlobalObject\*, const WTF::String&\)/,
    ],
    ["src/jsc/bindings/ErrorCode.cpp", /INVALID_FILE_URL_HOST\([^)]*const ASCIILiteral platform\)/],
    ["src/jsc/bindings/ErrorCode.cpp", /ERR_INVALID_ARG_TYPE\([^)]*const ZigString\* arg_name_string/],
    ["src/jsc/bindings/DOMException.h", /create\(const Exception&\)/],
    ["src/jsc/bindings/DOMException.h", /static ASCIILiteral name\(ExceptionCode ec\)/],
    ["src/jsc/bindings/DOMException.cpp", /DOMException::create\(const Exception& exception\)/],
    ["src/jsc/bindings/CookieMap.h", /struct CookieStoreGetOptions\b/],
    ["src/jsc/bindings/CookieMap.h", /Vector<KeyValuePair<String, String>> getAll\(\)/],
    ["src/jsc/bindings/CookieMap.h", /CookieMap\(Vector<Ref<Cookie>>&& cookies\)/],
    ["src/jsc/bindings/CookieMap.cpp", /CookieMap::getAll\(\)/],
    ["src/jsc/bindings/Cookie.h", /\bisValidCookieValue\b/],
    ["src/jsc/bindings/DOMFormData.h", /Ref<DOMFormData> clone\(\)/],
    ["src/jsc/bindings/DOMFormData.cpp", /DOMFormData::clone\(\)/],
    ["src/jsc/bindings/JSCommonJSModule.h", /void setSourceCode\(JSC::SourceCode&&/],
    ["src/jsc/bindings/JSCommonJSModule.h", /\bclearSourceCode\b/],
    ["src/jsc/bindings/JSCommonJSModule.h", /\bidOrDot\b/],
    ["src/jsc/bindings/ImportMetaObject.h", /\bcreateRequireFunction\b/],
    ["src/jsc/bindings/Sink.h", /\bnumberOfSinkIDs\b/],
    [
      "src/jsc/bindings/ProcessBindingTTYWrap.cpp",
      /^JSC::EncodedJSValue Process_functionInternalGetWindowSize\(JSC::JSGlobalObject/m,
    ],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});
