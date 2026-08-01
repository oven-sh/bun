// Guards against reintroduction of symbols and files removed as dead code from
// the C++ webcore bindings (RFC7230 duplicate, CommonAtomStrings, DOMPromiseProxy,
// HTTPHeaderField class, NetworkLoadMetrics/ResourceTiming/ServerTiming/HTTPHeaderMap
// isolatedCopy+encode/decode+addIfNotPresent, FetchHeaders::filterAndFill) and an
// uncalled Rust trait method in bun_install (VersionExt::is_less_than for Version).
// Each entry was verified to have zero callers across src/ and build/debug/codegen/
// before deletion.
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

test("deleted webcore C++ files do not reappear", () => {
  const deleted = [
    "src/jsc/bindings/webcore/RFC7230.cpp",
    "src/jsc/bindings/webcore/RFC7230.h",
    "src/jsc/bindings/webcore/CommonAtomStrings.cpp",
    "src/jsc/bindings/webcore/CommonAtomStrings.h",
    "src/jsc/bindings/webcore/DOMPromiseProxy.h",
    "src/jsc/bindings/webcore/ServerTiming.cpp",
  ];
  const resurrected = deleted.filter(p => existsSync(path.join(repoRoot, p)));
  expect(resurrected).toEqual([]);
});

test("dead C++ symbols in webcore headers/timing do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/jsc/bindings/webcrypto/JSSubtleCrypto.cpp", /DOMPromiseProxy\.h/],
    ["src/jsc/bindings/webcore/HTTPHeaderField.h", /class WEBCORE_EXPORT HTTPHeaderField\b/],
    ["src/jsc/bindings/webcore/HTTPHeaderField.h", /\bisDelimiter\b/],
    ["src/jsc/bindings/webcore/HTTPHeaderField.h", /\bisQuotedPairSecondOctet\b/],
    ["src/jsc/bindings/webcore/HTTPHeaderField.cpp", /HTTPHeaderField::create/],
    ["src/jsc/bindings/webcore/HTTPHeaderField.cpp", /\bisValidValue\b/],
    ["src/jsc/bindings/webcore/NetworkLoadMetrics.h", /\bupdateFromFinalMetrics\b/],
    ["src/jsc/bindings/webcore/NetworkLoadMetrics.h", /\bemptyMetrics\b/],
    ["src/jsc/bindings/webcore/NetworkLoadMetrics.h", /NetworkLoadMetrics isolatedCopy/],
    ["src/jsc/bindings/webcore/NetworkLoadMetrics.cpp", /\bupdateFromFinalMetrics\b/],
    ["src/jsc/bindings/webcore/NetworkLoadMetrics.cpp", /AdditionalNetworkLoadMetricsForWebInspector::create\(NetworkLoadPriority/],
    ["src/jsc/bindings/webcore/ResourceTiming.h", /ResourceTiming isolatedCopy/],
    ["src/jsc/bindings/webcore/ResourceTiming.cpp", /ResourceTiming::isolatedCopy/],
    ["src/jsc/bindings/webcore/ServerTiming.h", /ServerTiming isolatedCopy/],
    ["src/jsc/bindings/webcore/HTTPHeaderMap.h", /\baddIfNotPresent\b/],
    ["src/jsc/bindings/webcore/HTTPHeaderMap.h", /HTTPHeaderMap isolatedCopy/],
    ["src/jsc/bindings/webcore/HTTPHeaderMap.h", /HTTPHeaderMap::encode/],
    ["src/jsc/bindings/webcore/HTTPHeaderMap.h", /#if USE\(CF\)/],
    ["src/jsc/bindings/webcore/HTTPHeaderMap.cpp", /\baddIfNotPresent\b/],
    ["src/jsc/bindings/webcore/HTTPHeaderMap.cpp", /#if USE\(CF\)/],
    ["src/jsc/bindings/webcore/FetchHeaders.h", /\bfilterAndFill\b/],
    ["src/jsc/bindings/webcore/FetchHeaders.cpp", /FetchHeaders::filterAndFill/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("dead Rust symbols in install do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/install/dependency.rs", /fn is_less_than\(string_buf: &\[u8\], lhs: &Version, rhs: &Version\) -> bool;/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});
