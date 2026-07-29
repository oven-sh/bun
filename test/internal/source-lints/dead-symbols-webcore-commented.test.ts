// Guards against reintroduction of long-stale commented-out WebCore code
// and dead symbols removed from C++ bindings, react_compiler, and bun_core.
// Each removed block had zero compiled references and had been commented out
// or unreferenced since 2022/2023.
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

test("commented-out WebCore IsoSubspace / Event factory blocks do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/jsc/bindings/webcore/DOMIsoSubspaces.h", /\/\/\s*std::unique_ptr<IsoSubspace>\s*m_subspaceForTouch\b/],
    ["src/jsc/bindings/webcore/DOMClientIsoSubspaces.h", /\/\/\s*std::unique_ptr<GCClient::IsoSubspace>\s*m_clientSubspaceForTouch\b/],
    ["src/jsc/bindings/webcore/EventHeaders.h", /\/\/\s*#include "AnimationEvent\.h"/],
    ["src/jsc/bindings/webcore/EventTargetHeaders.h", /\/\/\s*#include "JSClipboard\.h"/],
    ["src/jsc/bindings/webcore/EventFactory.cpp", /\bAnimationEventInterfaceType\b/],
    ["src/jsc/bindings/webcore/EventTargetFactory.cpp", /\bApplePaySessionEventTargetInterfaceType\b/],
    ["src/jsc/bindings/webcore/EventPath.cpp", /\bRelatedNodeRetargeter\b/],
    ["src/jsc/bindings/webcore/PerformanceTiming.h", /\bm_navigationStart\b/],
    ["src/jsc/bindings/JSDOMGlobalObject.cpp", /\blegacyActiveGlobalObjectForAccessor\b/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("dead ZigSourceProvider / ConsoleObject / AsyncContextFrame symbols do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/jsc/bindings/ZigSourceProvider.h", /\bforEachSourceProvider\b/],
    ["src/jsc/bindings/ZigSourceProvider.h", /\bsourceMappingForSourceURL\b/],
    ["src/jsc/bindings/ZigSourceProvider.h", /\breadOrGenerateByteCodeCache\b/],
    ["src/jsc/bindings/ZigSourceProvider.h", /\bfreeSourceCode\b/],
    ["src/jsc/bindings/ZigSourceProvider.cpp", /\bSourceProvider::updateCache\b/],
    ["src/jsc/bindings/ZigSourceProvider.cpp", /\bSourceProvider::readCache\b/],
    ["src/jsc/bindings/ConsoleObject.h", /\bm_consoleAgent\b/],
    ["src/jsc/bindings/ConsoleObject.h", /\bsetPersistentScriptProfilerAgent\b/],
    ["src/jsc/bindings/ConsoleObject.h", /\bwarnUnimplemented\b/],
    ["src/jsc/bindings/AsyncContextFrame.cpp", /\bAsyncContextFrame::run\b/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("dead react_compiler / bun_core / css / net.ts symbols do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/react_compiler/hir/environment.rs", /pub fn for_outlined_fn\b/],
    ["src/react_compiler/hir/environment.rs", /pub fn get_property_type_numeric\b/],
    ["src/react_compiler/hir/environment.rs", /pub fn get_fallthrough_property_type\b/],
    ["src/react_compiler/hir/environment.rs", /pub fn take_outlined_functions\b/],
    ["src/react_compiler/hir/environment.rs", /pub fn identifier_name_for_id\b/],
    ["src/react_compiler/imports.rs", /pub fn is_already_compiled\b/],
    ["src/react_compiler/imports.rs", /pub fn mark_compiled\b/],
    ["src/react_compiler/imports.rs", /\balready_compiled:\s*IndexSet<u32>/],
    ["src/bun_core/fmt.rs", /pub struct CountingWriter\b/],
    ["src/bun_core/fmt.rs", /pub fn hex_int_upper\b/],
    ["src/bun_core/fmt.rs", /pub fn parse_num\b/],
    ["src/css/media_query.rs", /pub fn clone_in\b/],
    ["src/js/node/net.ts", /\bkServerSocket\b/],
    ["src/js/node/net.ts", /\bkpendingRead\b/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});
