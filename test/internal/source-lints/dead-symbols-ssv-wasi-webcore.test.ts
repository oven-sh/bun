// Guards against reintroduction of symbols removed as dead code from
// SerializedScriptValue, WebSocket, Performance, EventTarget, AbortSignal,
// the JSDOMConvert* template headers, windows/rescle, node:wasi, and a few
// small Rust crates. Each entry was verified to have zero callers across
// src/ and build/debug/codegen/ before deletion, and a full `bun bd` plus
// `bun run rust:check-all` (all targets) passes without them. This test
// fails if any of them reappear, e.g. via a merge that resurrects a stale
// file or a copy-paste from WebKit upstream.
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

function resurrected(checks: Array<[string, RegExp]>): string[] {
  return checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
}

test("dead SerializedScriptValue ENABLE() blocks and unused public methods do not reappear", () => {
  // Bun's JSCOnly cmakeconfig.h sets ENABLE_OFFSCREEN_CANVAS_IN_WORKERS,
  // ENABLE_WEB_RTC, ENABLE_WEB_CODECS, ENABLE_PREDEFINED_COLOR_SPACE_DISPLAY_P3
  // to 0 on every target; the referenced types (OffscreenCanvas, RTCCertificate,
  // WebCodecsVideoFrame) have no headers under src/, so the guarded bodies could
  // not compile if the macros flipped. The uncalled public methods were verified
  // against src/ and build/debug/codegen/.
  const checks: Array<[string, RegExp]> = [
    ["src/jsc/bindings/webcore/SerializedScriptValue.cpp", /ENABLE\(OFFSCREEN_CANVAS_IN_WORKERS\)/],
    ["src/jsc/bindings/webcore/SerializedScriptValue.cpp", /ENABLE\(WEB_RTC\)/],
    ["src/jsc/bindings/webcore/SerializedScriptValue.cpp", /ENABLE\(WEB_CODECS\)/],
    ["src/jsc/bindings/webcore/SerializedScriptValue.cpp", /readRTCCertificate/],
    ["src/jsc/bindings/webcore/SerializedScriptValue.cpp", /readOffscreenCanvas/],
    ["src/jsc/bindings/webcore/SerializedScriptValue.cpp", /readWebCodecsVideoFrame/],
    ["src/jsc/bindings/webcore/SerializedScriptValue.cpp", /SerializedScriptValue::nullValue/],
    ["src/jsc/bindings/webcore/SerializedScriptValue.cpp", /SerializedScriptValue::toString/],
    ["src/jsc/bindings/webcore/SerializedScriptValue.cpp", /SerializedScriptValue::wireFormatVersion/],
    ["src/jsc/bindings/webcore/SerializedScriptValue.cpp", /CloneDeserializer::deserializeString/],
    ["src/jsc/bindings/webcore/SerializedScriptValue.cpp", /blobFilePathForBlobURL/],
    ["src/jsc/bindings/webcore/SerializedScriptValue.h", /ENABLE\(WEB_RTC\)/],
    ["src/jsc/bindings/webcore/SerializedScriptValue.h", /static Ref<SerializedScriptValue> nullValue\(\)/],
    ["src/jsc/bindings/webcore/SerializedScriptValue.h", /static uint32_t wireFormatVersion\(\)/],
    ["src/jsc/bindings/webcore/SerializedScriptValue.h", /void encode\(Encoder&\) const/],
    ["src/jsc/bindings/webcore/SerializedScriptValue.h", /static RefPtr<SerializedScriptValue> decode\(Decoder&/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead WebSocket create/connect overloads and commented-out WebKit blocks do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/jsc/bindings/webcore/WebSocket.cpp", /ENABLE\(INTELLIGENT_TRACKING_PREVENTION\)/],
    ["src/jsc/bindings/webcore/WebSocket.cpp", /MixedContentChecker/],
    ["src/jsc/bindings/webcore/WebSocket.cpp", /WebSocket::didUpdateBufferedAmount/],
    ["src/jsc/bindings/webcore/WebSocket.cpp", /ConnectedWebSocketKind::Server:/],
    ["src/jsc/bindings/webcore/WebSocket.h", /void didReceiveData\(const char\*, size_t\);/],
    ["src/jsc/bindings/webcore/WebSocket.h", /void didUpdateBufferedAmount\(unsigned/],
    ["src/jsc/bindings/webcore/WebSocket.h", /WebSocket\(ScriptExecutionContext&, const String& url\);/],
    ["src/jsc/bindings/webcore/WebSocket.h", /void connect\(const String& url\);/],
    ["src/jsc/bindings/webcore/WebSocket.h", /void connect\(const String& url, const String& protocol\);/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead Performance/PerformanceObserver/EventTarget/AbortSignal members do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // addResourceTiming had no callers; Bun's fetch produces PerformanceResourceTiming
    // via Performance::appendBufferedEntry / queueEntry directly.
    ["src/jsc/bindings/webcore/Performance.cpp", /Performance::addResourceTiming/],
    ["src/jsc/bindings/webcore/Performance.cpp", /Performance::isResourceTimingBufferFull/],
    ["src/jsc/bindings/webcore/Performance.cpp", /Performance::allowHighPrecisionTime/],
    ["src/jsc/bindings/webcore/Performance.cpp", /Performance::timeResolution/],
    ["src/jsc/bindings/webcore/Performance.cpp", /relativeTimeFromTimeOriginInReducedResolution/],
    ["src/jsc/bindings/webcore/Performance.cpp", /resourceTimingBufferFullTimerFired/],
    ["src/jsc/bindings/webcore/Performance.h", /m_backupResourceTimingBuffer/],
    ["src/jsc/bindings/webcore/Performance.h", /m_waitingForBackupBufferToBeProcessed/],
    ["src/jsc/bindings/webcore/PerformanceObserver.h", /m_hasNavigationTiming/],
    ["src/jsc/bindings/webcore/EventTarget.cpp", /static const AtomString& legacyType/],
    ["src/jsc/bindings/webcore/EventTarget.cpp", /EventTarget::isPaymentRequest/],
    ["src/jsc/bindings/webcore/EventTarget.h", /hasCapturingEventListeners/],
    ["src/jsc/bindings/webcore/EventTarget.h", /void invalidateJSEventListeners\(JSC::JSObject\*\)/],
    // signalFollow was unreferenced and the only writer of m_followingSignal;
    // JSAbortSignalCustom's isFollowingSignal() check was therefore always false.
    ["src/jsc/bindings/webcore/AbortSignal.cpp", /AbortSignal::signalFollow/],
    ["src/jsc/bindings/webcore/AbortSignal.h", /m_followingSignal/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead JSDOMConvert* template specializations do not reappear", () => {
  // IDLSequence<T> is only instantiated with string/enum/interface/dictionary
  // element types in Bun; none of the numeric specializations (nor the
  // NumericSequenceConverter they dispatch to) are reachable.
  const checks: Array<[string, RegExp]> = [
    ["src/jsc/bindings/webcore/JSDOMConvertSequences.h", /struct NumericSequenceConverter/],
    ["src/jsc/bindings/webcore/JSDOMConvertSequences.h", /SequenceConverter<IDLLong>/],
    ["src/jsc/bindings/webcore/JSDOMConvertSequences.h", /SequenceConverter<IDLUnrestrictedDouble>/],
    ["src/jsc/bindings/webcore/JSDOMConvertSequences.h", /struct Converter<IDLFrozenArray<T>>/],
    ["src/jsc/bindings/webcore/JSDOMConvertStrings.h", /propertyNameToAtomString/],
    ["src/jsc/bindings/webcore/JSDOMConvertStrings.h", /IDLLegacyNullToEmptyStringAdaptor/],
    ["src/jsc/bindings/webcore/JSDOMConvertStrings.h", /IDLAtomStringAdaptor<IDLUSVString>/],
    ["src/jsc/bindings/webcore/JSDOMConvertStrings.h", /IDLAtomStringAdaptor<IDLByteString>/],
    ["src/jsc/bindings/webcore/JSDOMConvertStrings.cpp", /valueToByteAtomString/],
    ["src/jsc/bindings/webcore/JSDOMConvertStrings.cpp", /valueToUSVAtomString/],
    ["src/jsc/bindings/webcore/JSDOMConvertRecord.h", /struct JSConverter<IDLRecord<K, V>>/],
    ["src/jsc/bindings/webcore/JSDOMConvertUnion.h", /IDLAllowSharedAdaptor<IDLUnion</],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead windows/rescle.cpp resource-editing methods do not reappear", () => {
  // The only Rust entry point (rescle__setWindowsMetadata) uses Load, SetIcon,
  // SetVersionString, SetFileVersion, SetProductVersion, and Commit. All other
  // ResourceUpdater public methods were unreachable.
  const checks: Array<[string, RegExp]> = [
    ["src/jsc/bindings/windows/rescle.cpp", /ResourceUpdater::SetExecutionLevel/],
    ["src/jsc/bindings/windows/rescle.cpp", /ResourceUpdater::SetApplicationManifest/],
    ["src/jsc/bindings/windows/rescle.cpp", /ResourceUpdater::GetVersionString/],
    ["src/jsc/bindings/windows/rescle.cpp", /ResourceUpdater::ChangeString/],
    ["src/jsc/bindings/windows/rescle.cpp", /ResourceUpdater::ChangeRcData/],
    ["src/jsc/bindings/windows/rescle.cpp", /ResourceUpdater::GetString/],
    ["src/jsc/bindings/windows/rescle.cpp", /OnEnumResourceManifest/],
    ["src/jsc/bindings/windows/rescle.h", /RU_VS_LEGAL_TRADEMARKS/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead wasi.ts bundle artifacts and debug scaffolding do not reappear", () => {
  // The `= void 0` chains are esbuild/tsc emit artifacts from the original
  // wasi-js npm bundle; every property is immediately re-assigned to its real
  // value. initWasiFdInfo() was unreferenced debug code with console.log calls.
  const checks: Array<[string, RegExp]> = [
    ["src/js/node/wasi.ts", /exports\.WASI_ENOMSG =\n/],
    ["src/js/node/wasi.ts", /class extends Error \{\n\s+constructor\(signal\)/],
    ["src/js/node/wasi.ts", /WASIKillError/],
    ["src/js/node/wasi.ts", /SOCKET_DEFAULT_RIGHTS/],
    ["src/js/node/wasi.ts", /initWasiFdInfo/],
    ["src/js/node/wasi.ts", /if \(log\.enabled\)/],
    ["src/js/thirdparty/ws.js", /secWebSocketExtensions/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead Rust http/threading/standalone_graph/bunfig items do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/http/lib.rs", /const PRINT_EVERY: usize/],
    ["src/threading/lib.rs", /RwLockReadGuard, RwLockWriteGuard/],
    ["src/standalone_graph/error.rs", /UnsupportedTarget/],
    ["src/bunfig/bunfig.rs", /pub use bun_options_types::offline_mode::OfflineMode/],
  ];
  expect(resurrected(checks)).toEqual([]);
});
