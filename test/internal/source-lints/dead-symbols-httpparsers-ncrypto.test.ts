// Guards against reintroduction of symbols removed as dead code. Each entry
// was verified to have zero callers across src/ and build/debug/codegen/
// before deletion, and a full `bun bd` passes without them. This test fails
// if any of them reappear, e.g. via a merge that resurrects a stale file or a
// copy-paste from an old branch.
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

test("deleted whole files stay deleted", () => {
  // Each of these had zero live references outside its own content.
  // ActiveDOMObject.{h,cpp}: every line was a // comment; the 39 #include
  // lines pulled in an empty file.
  // EventDispatcher.{h,cpp}: only references were a code comment in
  // EventTarget.cpp and an unrelated RemoteLayerTreeEventDispatcher mention.
  // EventModifierInit / JSEventModifierInit / UIEventInit: a closed dead
  // cluster (only referenced each other); convertDictionary<EventModifierInit>
  // was never called.
  // ncrpyto_engine.cpp: EnginePointer impl; no caller anywhere.
  // JSVMClientDataClient.h: addClient() was never called so m_clients was
  // always empty.
  const deleted = [
    "src/jsc/bindings/webcore/ActiveDOMObject.h",
    "src/jsc/bindings/webcore/ActiveDOMObject.cpp",
    "src/jsc/bindings/webcore/EventDispatcher.h",
    "src/jsc/bindings/webcore/EventDispatcher.cpp",
    "src/jsc/bindings/webcore/EventModifierInit.h",
    "src/jsc/bindings/webcore/JSEventModifierInit.h",
    "src/jsc/bindings/webcore/JSEventModifierInit.cpp",
    "src/jsc/bindings/webcore/UIEventInit.h",
    "src/jsc/bindings/ncrpyto_engine.cpp",
    "src/jsc/bindings/JSVMClientDataClient.h",
  ];
  const reappeared = deleted.filter(p => existsSync(path.join(repoRoot, p)));
  expect(reappeared).toEqual([]);
});

test("dead HTTPParsers functions do not reappear", () => {
  // Bun only ever calls isValidHTTPHeaderValue, isValidHTTPToken, isHTTPSpace,
  // and Bun__writeHTTPDate from this file. Everything else was WebKit browser
  // machinery (XSS auditor, X-Frame-Options, CORS preflight, Content-Disposition
  // filename parsing) with zero callers in Bun.
  const checks: Array<[string, RegExp]> = [
    ["src/jsc/bindings/webcore/HTTPParsers.h", /\bXSSProtectionDisposition\b/],
    ["src/jsc/bindings/webcore/HTTPParsers.h", /\bXFrameOptionsDisposition\b/],
    ["src/jsc/bindings/webcore/HTTPParsers.h", /\bCrossOriginResourcePolicy\b/],
    ["src/jsc/bindings/webcore/HTTPParsers.h", /\bparseXSSProtectionHeader\b/],
    ["src/jsc/bindings/webcore/HTTPParsers.h", /\bisForbiddenHeaderName\b/],
    ["src/jsc/bindings/webcore/HTTPParsers.h", /\bparseRange\b/],
    ["src/jsc/bindings/webcore/HTTPParsers.cpp", /\bparseXSSProtectionHeader\b/],
    ["src/jsc/bindings/webcore/HTTPParsers.cpp", /\bparseHTTPHeader\b/],
    ["src/jsc/bindings/webcore/HTTPParsers.cpp", /\bextractMIMETypeFromMediaType\b/],
    ["src/jsc/bindings/webcore/HTTPParsers.cpp", /\bextractCharsetFromMediaType\b/],
    ["src/jsc/bindings/webcore/HTTPParsers.cpp", /\bfilenameFromHTTPContentDisposition\b/],
    ["src/jsc/bindings/webcore/HTTPParsers.cpp", /\bisCrossOriginSafeRequestHeader\b/],
    ["src/jsc/bindings/webcore/HTTPParsers.cpp", /\bnormalizeHTTPMethod\b/],
    ["src/jsc/bindings/webcore/HTTPParsers.cpp", /\bparseXFrameOptionsHeader\b/],
    ["src/jsc/bindings/webcore/HTTPParsers.cpp", /\bisValidUserAgentHeaderValue\b/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead ncrypto SSL/Engine/X509Name wrappers do not reappear", () => {
  // Bun's TLS goes through usockets/boringssl directly; the Node.js ncrypto
  // SSLPointer/SSLCtxPointer/EnginePointer/X509Name C++ wrappers were never
  // wired up. X509View and X509Pointer stay (JSX509Certificate uses them).
  const checks: Array<[string, RegExp]> = [
    ["src/jsc/bindings/ncrypto.h", /\bclass SSLPointer\b/],
    ["src/jsc/bindings/ncrypto.h", /\bclass SSLCtxPointer\b/],
    ["src/jsc/bindings/ncrypto.h", /\bclass X509Name\b/],
    ["src/jsc/bindings/ncrypto.h", /\bclass EnginePointer\b/],
    ["src/jsc/bindings/ncrypto.h", /\bStackOfX509\b/],
    ["src/jsc/bindings/ncrypto.h", /\bSSLSessionPointer\b/],
    ["src/jsc/bindings/ncrypto.cpp", /\bSSLPointer::/],
    ["src/jsc/bindings/ncrypto.cpp", /\bSSLCtxPointer::/],
    ["src/jsc/bindings/ncrypto.cpp", /\bX509Name::/],
    ["src/jsc/bindings/ncrypto.cpp", /\bX509Pointer::IssuerFrom\b/],
    ["src/jsc/bindings/ncrypto.cpp", /\bX509Pointer::PeerFrom\b/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead misc C++ symbols do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // validateBufferEncoding<bool>: defined + two specializations, never called.
    ["src/jsc/bindings/JSBufferEncodingType.h", /\bvalidateBufferEncoding\b/],
    ["src/jsc/bindings/JSBufferEncodingType.cpp", /\bvalidateBufferEncoding\b/],
    // JSVMClientData::addClient was never called, so m_clients was always empty
    // and the willDestroyVM() dispatch in the destructor ran over nothing.
    ["src/jsc/bindings/BunClientData.h", /\bJSVMClientDataClient\b/],
    ["src/jsc/bindings/BunClientData.h", /\bm_clients\b/],
    // Every includer of the all-comments ActiveDOMObject.h pulled in nothing.
    ["src/jsc/bindings/ScriptExecutionContext.h", /#include "ActiveDOMObject\.h"/],
    ["src/codegen/generate-jssink.ts", /#include "ActiveDOMObject\.h"/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead src/js symbols do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // Both symbols were write-only: local Symbol()s assigned once and never
    // read. kServerSocket was introduced for cluster but the reader side was
    // never added; kpendingRead was leftover from a refactor.
    ["src/js/node/net.ts", /\bkServerSocket\b/],
    ["src/js/node/net.ts", /\bkpendingRead\b/],
    // The live _createSocketHandle lives in src/js/internal/dgram.ts; the
    // dgram.ts copy was a commented-out duplicate.
    ["src/js/node/dgram.ts", /\b_createSocketHandle\b/],
  ];
  expect(resurrected(checks)).toEqual([]);
});
