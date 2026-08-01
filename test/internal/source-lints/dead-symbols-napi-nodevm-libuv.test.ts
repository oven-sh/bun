// Guards against reintroduction of symbols removed as dead code from napi,
// NodeVM*, JSBufferList, JSStringDecoder, BunClientData, EventLoopTask,
// JSEnvironmentVariableMap, libuv platform headers, zlib, io/windows_event_loop,
// and node/net.ts. Each entry was verified to have zero callers across src/
// and build/debug/codegen/ before deletion; this test fails if any reappear.
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

test("napi / NodeVM / JSBufferList / JSStringDecoder dead methods do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/jsc/bindings/napi.cpp", /JSC::SourceCode generateSourceCode\(WTF::String keyString/],
    ["src/jsc/bindings/napi.h", /JSC::SourceCode generateSourceCode\(/],
    ["src/jsc/bindings/napi.h", /bool isSet\(\) const \{ return m_tag != WeakTypeTag::NotSet; \}/],
    ["src/jsc/bindings/napi.h", /JSCell\* cell\(\) const\s*\{/],
    ["src/jsc/bindings/napi.h", /JSValue primitive\(\) const\s*\{/],
    ["src/jsc/bindings/napi.h", /JSString\* string\(\) const\s*\{/],
    ["src/jsc/bindings/NodeVM.h", /void clearContextifiedObject\(\);/],
    ["src/jsc/bindings/NodeVM.cpp", /void NodeVMGlobalObject::clearContextifiedObject\(\)/],
    ["src/jsc/bindings/NodeVMModule.h", /void addImportAttribute\(WTF::String key/],
    ["src/jsc/bindings/NodeVMModule.cpp", /void NodeVMModuleRequest::addImportAttribute\(/],
    ["src/jsc/bindings/NodeVMModule.h", /void specifier\(WTF::String value\)/],
    ["src/jsc/bindings/NodeVMSourceTextModule.h", /bool hasModuleRecord\(\) const/],
    ["src/jsc/bindings/NodeVMSyntheticModule.h", /bool hasModuleRecord\(\) const/],
    ["src/jsc/bindings/NodeVMScript.h", /RefPtr<JSC::CachedBytecode> cachedBytecode\(\) const/],
    [
      "src/jsc/bindings/JSBufferList.h",
      /void initializeProperties\(JSC::VM& vm, JSC::JSGlobalObject\* globalObject, JSBufferListPrototype\* prototype\);/,
    ],
    ["src/jsc/bindings/JSBufferList.cpp", /void JSBufferListConstructor::initializeProperties\(/],
    ["src/jsc/bindings/JSBufferList.h", /static void destroy\(JSCell\*\) \{\}/],
    [
      "src/jsc/bindings/JSStringDecoder.h",
      /void initializeProperties\(JSC::VM& vm, JSC::JSGlobalObject\* globalObject, JSStringDecoderPrototype\* prototype\);/,
    ],
    ["src/jsc/bindings/JSStringDecoder.cpp", /void JSStringDecoderConstructor::initializeProperties\(/],
    ["src/jsc/bindings/JSNextTickQueue.h", /static std::array<JSValue, numberOfInternalFields> initialValues\(\)/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("BunClientData / EventLoopTask / JSEnvironmentVariableMap / blob / Bindgen dead members do not reappear", () => {
  const clientData = src("src/jsc/bindings/BunClientData.h");
  // The JSHeapData copies (first occurrence) are live; the JSVMClientData
  // duplicates (second occurrence) are the dead ones. After removal there
  // should be exactly one occurrence of each.
  expect((clientData.match(/Vector<JSC::IsoSubspace\*> m_outputConstraintSpaces;/g) ?? []).length).toBe(1);
  expect((clientData.match(/void forEachOutputConstraintSpace\(/g) ?? []).length).toBe(1);
  expect((clientData.match(/Vector<JSC::IsoSubspace\*>& outputConstraintSpaces\(\)/g) ?? []).length).toBe(1);

  const checks: Array<[string, RegExp]> = [
    ["src/jsc/bindings/EventLoopTask.h", /bool isCleanupTask\(\) const/],
    ["src/jsc/bindings/EventLoopTask.h", /bool m_isCleanupTask;/],
    ["src/jsc/bindings/EventLoopTask.h", /enum CleanupTaskTag/],
    ["src/jsc/bindings/JSEnvironmentVariableMap.cpp", /JSC_DEFINE_CUSTOM_SETTER\(jsSetterEnvironmentVariable,/],
    ["src/jsc/bindings/blob.h", /^using BlobRef = Ref<BlobImpl,/m],
    ["src/jsc/bindings/Bindgen/IDLTypes.h", /struct IsIDLStrongAny\b/],
    ["src/jsc/bindings/JSBuffer.cpp", /jsBufferPrototypeToStringWithoutTypeChecks/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("libuv platform headers for non-targeted OSes are gone", () => {
  const deleted = [
    "src/jsc/bindings/libuv/uv/aix.h",
    "src/jsc/bindings/libuv/uv/os390.h",
    "src/jsc/bindings/libuv/uv/sunos.h",
    "src/jsc/bindings/libuv/uv/posix.h",
  ];
  const resurrected = deleted.filter(p => existsSync(path.join(repoRoot, p)));
  expect(resurrected).toEqual([]);

  const unix = src("src/jsc/bindings/libuv/uv/unix.h");
  expect(unix).not.toMatch(/#include "uv\/aix\.h"/);
  expect(unix).not.toMatch(/#include "uv\/os390\.h"/);
  expect(unix).not.toMatch(/#include "uv\/sunos\.h"/);
  expect(unix).not.toMatch(/#include "uv\/posix\.h"/);
});

test("zlib / io / install / net.ts dead items do not reappear", () => {
  expect(existsSync(path.join(repoRoot, "src/zlib/error.rs"))).toBe(false);

  const checks: Array<[string, RegExp]> = [
    ["src/zlib/lib.rs", /^pub mod error;$/m],
    ["src/zlib/lib.rs", /\bgzFile\b/],
    ["src/zlib/lib.rs", /\bstruct_gzFile_s\b/],
    ["src/io/windows_event_loop.rs", /pub fn ref_\(&mut self, event_loop_ctx: EventLoopCtx\)/],
    ["src/io/windows_event_loop.rs", /pub fn activate\(&mut self, loop_: &mut WindowsLoop\)/],
    ["src/io/windows_event_loop.rs", /pub fn can_ref\(&self\) -> bool/],
    ["src/install/lockfile/bun.lock.rs", /\/\/ pub fn save\(this: &Lockfile\)/],
    ["src/js/node/net.ts", /const kpendingRead = Symbol\("kpendingRead"\);/],
    ["src/js/node/net.ts", /const kServerSocket = Symbol\("kServerSocket"\);/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});
