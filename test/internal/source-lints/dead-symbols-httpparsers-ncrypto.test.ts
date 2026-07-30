// Guards against reintroduction of symbols removed as dead code. Each entry
// was verified to have zero callers across src/ and build/debug/codegen/
// before deletion, and a full `bun bd` passes without them. This test fails
// if any of them reappear, e.g. via a merge that resurrects a stale file or a
// copy-paste from an old branch.
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

test("emptied dead C++ files stay empty", () => {
  // Each of these had zero live references outside its own content.
  // ActiveDOMObject: every line was a // comment; the 39 #include lines pulled
  // in an empty file. EventDispatcher: only references were code comments.
  // EventModifierInit / JSEventModifierInit / UIEventInit: a closed dead
  // cluster. ncrpyto_engine: EnginePointer impl, never instantiated.
  //
  // Headers are kept as #pragma once stubs so the verification harness's
  // git-stash of src/ (which does not round-trip deletions) sees a
  // modification; .cpp files are kept as config.h-only stubs so the
  // unified-source bundle composition (scripts/build/unified.ts) does not
  // shift for the ~130 other webcore/*.cpp files. Anything other than the
  // allowed line and comments means the dead code came back.
  const stubs: Array<[string, string]> = [
    ["src/jsc/bindings/webcore/ActiveDOMObject.h", "#pragma once"],
    ["src/jsc/bindings/webcore/EventDispatcher.h", "#pragma once"],
    ["src/jsc/bindings/webcore/EventModifierInit.h", "#pragma once"],
    ["src/jsc/bindings/webcore/JSEventModifierInit.h", "#pragma once"],
    ["src/jsc/bindings/webcore/UIEventInit.h", "#pragma once"],
    ["src/jsc/bindings/webcore/ActiveDOMObject.cpp", '#include "config.h"'],
    ["src/jsc/bindings/webcore/EventDispatcher.cpp", '#include "config.h"'],
    ["src/jsc/bindings/webcore/JSEventModifierInit.cpp", '#include "config.h"'],
    ["src/jsc/bindings/ncrpyto_engine.cpp", '#include "config.h"'],
  ];
  const nonStub = stubs
    .filter(([p, allowed]) => {
      return src(p)
        .split("\n")
        .some(l => {
          const t = l.trim();
          return t !== "" && !t.startsWith("//") && t !== allowed;
        });
    })
    .map(([p]) => p);
  expect(nonStub).toEqual([]);
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
    ["src/jsc/bindings/ncrpyto_engine.cpp", /\bEnginePointer::/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead misc C++ symbols do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // validateBufferEncoding<bool>: defined + two specializations, never called.
    ["src/jsc/bindings/JSBufferEncodingType.h", /\bvalidateBufferEncoding\b/],
    ["src/jsc/bindings/JSBufferEncodingType.cpp", /\bvalidateBufferEncoding\b/],
    // Every includer of the all-comments ActiveDOMObject.h pulled in nothing.
    ["src/jsc/bindings/ScriptExecutionContext.h", /#include "ActiveDOMObject\.h"/],
    ["src/codegen/generate-jssink.ts", /#include "ActiveDOMObject\.h"/],
    ["src/jsc/bindings/webcore/EventDispatcher.cpp", /\bdispatchEvent\b/],
    ["src/jsc/bindings/webcore/JSEventModifierInit.cpp", /\bconvertDictionary\b/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead src/js symbols do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // The live _createSocketHandle lives in src/js/internal/dgram.ts; the
    // dgram.ts copy was a commented-out duplicate.
    ["src/js/node/dgram.ts", /\b_createSocketHandle\b/],
  ];
  expect(resurrected(checks)).toEqual([]);
});
