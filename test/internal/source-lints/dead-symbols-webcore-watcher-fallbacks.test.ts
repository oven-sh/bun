// Guards against reintroduction of symbols removed as dead code from the
// webcore C++ bindings, the file watcher's write-only `loader` column, the
// sha_hmac/csrf/valkey/picohttp/windows_sys crates, the node-fallbacks
// bundle, and the built-in JS sources. Each entry was verified to have zero
// references across src/, packages/, test/, and build/debug/codegen/ output
// before deletion, and the removal was validated by `cargo check --workspace`
// plus a full `bun bd` build.
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

function expectAbsent(checks: Array<[string, RegExp]>) {
  for (const [file, re] of checks) {
    expect(re.test(src(file)), `${file} should not match ${re}`).toBe(false);
  }
}

test("dead webcore C++ symbols do not reappear", () => {
  expectAbsent([
    // Unused typed-array IDL types and their converters; only
    // IDLUint8Array / IDLArrayBuffer / IDLDataView / IDLArrayBufferView
    // have consumers.
    ["src/jsc/bindings/webcore/JSDOMConvertBufferSource.h", /\bIDLBigUint64Array\b/],
    ["src/jsc/bindings/webcore/JSDOMConvertBufferSource.h", /\btoPossiblySharedFloat64Array\b/],
    ["src/jsc/bindings/webcore/JSDOMConvertBufferSource.h", /\btoUnsharedArrayBufferView\b/],
    // IDL types with no converter or binding left.
    ["src/jsc/bindings/IDLTypes.h", /\bIDLDate\b/],
    ["src/jsc/bindings/IDLTypes.h", /\bIDLUnsupportedType\b/],
    ["src/jsc/bindings/IDLTypes.h", /\bIDLIDBKey\b/],
    ["src/jsc/bindings/IDLTypes.h", /\bIDLWebGLAny\b/],
    // DOMPromiseDeferred class cluster and unused DeferredPromise methods.
    ["src/jsc/bindings/webcore/JSDOMPromiseDeferred.h", /\bDOMPromiseDeferredBase\b/],
    ["src/jsc/bindings/webcore/JSDOMPromiseDeferred.h", /\bresolveWithJSValue\b/],
    ["src/jsc/bindings/webcore/JSDOMPromiseDeferred.h", /\bfulfillPromiseWithJSON\b/],
    ["src/jsc/bindings/webcore/JSDOMPromiseDeferred.cpp", /\bparseAsJSON\b/],
    // WebInspector-only metrics struct and its flags.
    ["src/jsc/bindings/webcore/NetworkLoadMetrics.h", /\bAdditionalNetworkLoadMetricsForWebInspector\b/],
    ["src/jsc/bindings/webcore/NetworkLoadMetrics.h", /\bPrivacyStance\b/],
    // [ReturnsOwnPromise] variants no generated binding uses.
    ["src/jsc/bindings/webcore/JSDOMOperationReturningPromise.h", /\bcallReturningOwnPromise\b/],
    // IDLAttribute setter variants no generated binding uses.
    ["src/jsc/bindings/webcore/JSDOMAttribute.h", /\bsetPassingPropertyName\b/],
    ["src/jsc/bindings/webcore/JSDOMAttribute.h", /\bsetStatic\b/],
    // Pointer-to-member dispatch table with no caller.
    ["src/jsc/bindings/webcore/HTTPHeaderIdentifiers.cpp", /\bidentifierFor\b/],
    // Write-only Event flags and never-overridden virtuals.
    ["src/jsc/bindings/webcore/Event.h", /\bm_defaultHandled\b/],
    ["src/jsc/bindings/webcore/Event.h", /\bsetRelatedTarget\b/],
    ["src/jsc/bindings/webcore/EventTarget.h", /\bvirtual bool isNode\b/],
    // Stubbed-out TUs (see the stub comments in each file).
    ["src/jsc/bindings/webcore/JSDOMConvertDate.cpp", /\bvalueToDate\b/],
    ["src/jsc/bindings/webcore/JSMIMEBindings.cpp", /createMIMEBinding\(/],
    ["src/jsc/bindings/webcore/JSDOMIterator.cpp", /addValueIterableMethods\(JSC/],
  ]);
});

test("watcher loader column stays deleted", () => {
  expectAbsent([
    // WatchItem.loader was write-only: stored by every add_file path, read by
    // nothing (no MultiArrayList column accessor ever queried it).
    ["src/watcher/lib.rs", /\bpub struct Loader\b/],
    ["src/watcher/Watcher.rs", /\bloader\b/],
    ["src/jsc/hot_reloader.rs", /\bbun_watcher::Loader\b/],
  ]);
});

test("dead Rust symbols do not reappear", () => {
  expectAbsent([
    // sha_hmac: OpenSSL-3-deprecated hashers with no consumers (SHA1/SHA256
    // remain) and EVP wrappers nothing names.
    ["src/sha_hmac/sha.rs", /\bRIPEMD160_Init\b/],
    ["src/sha_hmac/sha.rs", /\bnew_evp!\(MD5_SHA1\b/],
    ["src/sha_hmac/sha.rs", /\bnew_evp!\(Blake2\b/],
    // csrf: variants never constructed (verify() returns bool).
    ["src/csrf/lib.rs", /\bInvalidToken\b/],
    // valkey: protocol-error variants the parser never produces.
    ["src/valkey/valkey_protocol.rs", /\bInvalidBigNumber\b/],
    ["src/valkey/valkey_protocol.rs", /\bInvalidSimpleString\b/],
    // picohttp: write-only Request fields (Response keeps both).
    ["src/picohttp/lib.rs", /bytes_read: u32/],
    // windows_sys: consts/types whose only references were unused re-exports.
    ["src/windows_sys/externs.rs", /\bFILE_ATTRIBUTE_SYSTEM\b/],
    ["src/windows_sys/externs.rs", /\bfn SetFileInformationByHandle\b/],
    ["src/windows_sys/externs.rs", /\bfn ResumeThread\b/],
    ["src/windows_sys/externs.rs", /\btype PebView\b/],
    // zlib: deflateInit_/inflateInit_ (all code uses the *2_ variants).
    ["src/zlib/lib.rs", /\bfn deflateInit_\(/],
    ["src/zlib/lib.rs", /\bfn inflateInit_\(/],
    ["src/zlib_sys/posix.rs", /\bfn deflateInit_\(/],
    ["src/zlib_sys/win32.rs", /\bfn inflateInit_\(/],
    // libarchive/css_jsc: commented-out Zig code left from the port
    // (`callconv(.c)` / `getTruthy` only ever appeared inside those blocks).
    ["src/libarchive/lib.rs", /callconv/],
    ["src/css_jsc/css_internals.rs", /getTruthy/],
    // opaque: macro arm no instantiation ever called.
    ["src/opaque/lib.rs", /\bopaque_mut_nn\b/],
    // exe_format/md/node: never-constructed variants and unused helpers.
    ["src/exe_format/pe.rs", /\bInputIsSigned\b/],
    ["src/md/types.rs", /\bSetextheader\b/],
    ["src/runtime/node/assert/myers_diff.rs", /\bOutOfMemory\b/],
    ["src/runtime/node/node_cluster_binding.rs", /\bBun__Process__queueNextTick1\b/],
    // Bun.nanoseconds is implemented in C++ (functionBunNanoseconds); the
    // Rust host_fn was never wired into the lut.
    ["src/runtime/api/BunObject.rs", /\bBunObject_callback_nanoseconds\b/],
    ["src/jsc/bindings/BunObject+exports.h", /macro\(nanoseconds\)/],
    ["src/jsc/bindings/BunObject+exports.h", /macro\(assetPrefix\)/],
    // bake: no_mangle export C++ never declared or called.
    ["src/runtime/bake/production.rs", /\bBakeProdSourceMap\b/],
  ]);
});

test("dead JS builtin exports do not reappear", () => {
  expectAbsent([
    // repl primordials: export keys none of the 13 repl/readline consumers
    // reference (requires are stringly-typed, so TS can't see this).
    ["src/js/internal/repl/node-primordials.js", /\bArrayPrototypeFindLastIndex\b/],
    ["src/js/internal/repl/node-primordials.js", /\bSafeWeakSet\b/],
    // internal-for-testing: bindings with zero references in test/ or bench/.
    ["src/js/internal-for-testing.ts", /\blsanDoLeakCheck\b/],
    ["src/js/internal-for-testing.ts", /\bnpmTag\b/],
    ["src/jsc/bindings/InternalForTesting.cpp", /\bjsFunction_lsanDoLeakCheck\b/],
    // node-fallbacks util.js: 270-line commented-out legacy util.types body.
    ["src/node-fallbacks/util.js", /isGeneratorFunction/],
  ]);
});

// No existence check for the deleted generate-unified-source-bundles.rb:
// git-stash round-trips can temporarily restore files a branch deletes (see
// the same note in dead-symbols-pub-exports-sweep.test.ts), so a working-tree
// existsSync assertion is unreliable. The content checks above carry the lint.
