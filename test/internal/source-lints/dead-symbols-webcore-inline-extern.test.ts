// Guards against reintroduction of symbols removed as dead code. Each symbol
// was verified to have zero callers across src/ and build/debug/codegen/
// before deletion; `bun bd` and `rust:check-all` (all targets) pass without
// them. Only checks files that are modified (not deleted) so readFileSync
// never sees ENOENT.

import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
const src = (p: string) => readFileSync(path.join(repoRoot, p), "utf8");
const exists = (p: string) => existsSync(path.join(repoRoot, p));

test("deleted webcore/bindings header files do not reappear", () => {
  const deleted = [
    "src/jsc/bindings/TextCodecASCIIFastPath.h",
    "src/jsc/bindings/webcore/Node.h",
    "src/jsc/bindings/webcore/JSDOMWindow.h",
    "src/jsc/bindings/webcore/JSServiceWorker.h",
    "src/jsc/bindings/webcore/JSWindowProxy.h",
  ];
  const found = deleted.filter(exists);
  expect(found).toEqual([]);
});

test("dead extern C wrappers and cascaded methods do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/jsc/bindings/StrongRef.cpp", /Bun__StrongRef__get|Bun__StrongRef__clear/],
    ["src/jsc/bindings/StrongRef.h", /Bun__StrongRef__get|Bun__StrongRef__clear/],
    ["src/jsc/bindings/StrongRootBlock.h", /void clearValue\(/],
    ["src/jsc/bindings/TextCodecWrapper.cpp", /Bun__isEncodingSupported|Bun__getCanonicalEncodingName/],
    ["src/jsc/bindings/InspectorLifecycleAgent.cpp", /Bun__LifecycleAgentReportReload|::reportReload\b/],
    ["src/jsc/bindings/InspectorLifecycleAgent.h", /void reportReload\(/],
    ["src/jsc/bindings/InspectorBunFrontendDevServerAgent.cpp", /notifyClientErrorReported|notifyGraphUpdate/],
    ["src/jsc/bindings/InspectorBunFrontendDevServerAgent.h", /clientErrorReported|graphUpdate|BunFrontendDevServerAgent__notify/],
    ["src/jsc/bindings/highway_strings.cpp", /ScanCharFrequencyImpl|highway_char_frequency/],
    ["src/jsc/bindings/JSS3File.cpp", /JSS3File__hasInstance|customHasInstance/],
  ];
  const found = checks.filter(([f, re]) => re.test(src(f))).map(([f, re]) => `${f}: ${re.source}`);
  expect(found).toEqual([]);
});

test("commented-out DOMJIT/BINDING_INTEGRITY blocks in webcore do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/jsc/bindings/webcore/JSTextEncoder.cpp", /jsTextEncoderEncodeWithoutTypeCheck|DOMJITSignatureForJSTextEncoder/],
    ["src/jsc/bindings/webcore/JSURLSearchParams.cpp", /BINDING_INTEGRITY|_ZTVN7WebCore15URLSearchParamsE/],
    ["src/jsc/bindings/webcore/JSErrorEvent.cpp", /BINDING_INTEGRITY|_ZTVN7WebCore10ErrorEventE/],
    ["src/jsc/bindings/webcore/JSDOMException.cpp", /BINDING_INTEGRITY|_ZTVN7WebCore12DOMExceptionE/],
    ["src/jsc/bindings/webcore/JSPerformance.cpp", /hasDisabledRuntimeProperties/],
    ["src/jsc/bindings/webcore/JSDOMURL.cpp", /\/\/.*createObjectURL.*DeletePropertyMode/s],
    ["src/jsc/bindings/webcore/JSWorkerOptions.cpp", /credentialsValue|\bWorkerType::Classic\b/],
    ["src/jsc/bindings/webcore/JSEventListener.cpp", /handleBeforeUnloadEventReturnValue/],
    ["src/jsc/bindings/webcore/PerformanceUserTiming.cpp", /restrictedMarkFunctions\.tryGet/],
  ];
  const found = checks.filter(([f, re]) => re.test(src(f))).map(([f, re]) => `${f}: ${re.source}`);
  expect(found).toEqual([]);
});

test("dead InlineBlob struct and S3File hasInstance do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/runtime/webcore/Blob.rs", /pub struct Inline \{|impl Inline \{/],
    ["src/runtime/webcore/Body.rs", /InlineBlob/],
    ["src/runtime/server/RequestContext.rs", /\.InlineBlob,/],
    ["src/runtime/webcore/S3File.rs", /JSS3File__hasInstance|fn has_instance\b/],
    ["src/runtime/webcore/streams.rs", /pub fn get\(&self\) -> \*mut JSPromise/],
    ["src/runtime/webcore/FileReader.rs", /pub const TAG: readable_stream::Tag/],
  ];
  const found = checks.filter(([f, re]) => re.test(src(f))).map(([f, re]) => `${f}: ${re.source}`);
  expect(found).toEqual([]);
});

test("commented-out handleConversion/fs-stream blocks in src/js do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/js/builtins/Ipc.ts", /const handleConversion = \{/],
    ["src/js/internal/fs/streams.ts", /\/\/.*fastPath\._getFd\(\)/],
    ["src/js/node/worker_threads.ts", /^\/\/ import type/m],
  ];
  const found = checks.filter(([f, re]) => re.test(src(f))).map(([f, re]) => `${f}: ${re.source}`);
  expect(found).toEqual([]);
});
