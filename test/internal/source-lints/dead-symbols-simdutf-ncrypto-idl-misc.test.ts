// Guards against reintroduction of symbols removed as dead code from the
// simdutf FFI layer, ncrypto, the uws C ABI shims, and assorted JSC/WebCore
// bindings plus their Rust callers. Every entry was confirmed unreferenced two
// ways before deletion: a --gc-sections relink of the debug build dropped the
// function as unreachable, and rg found no textual reference across src/,
// scripts/, test/ and the regenerated build/debug/codegen/ output. The removal
// was validated by `cargo check` on all 10 CI target triples and a full
// `bun bd` build.
//
// This is a source-tree lint: it reads files from src/ and does not touch the
// built binary, so it belongs in test/internal/source-lints/ per the README.
//
// The Rust checks read the working tree. The deleted-file and C++ checks read
// the committed tree (HEAD): `git stash` round-trips can temporarily restore
// files a branch deletes (see dead-code-escapes.test.ts), and those strays
// must not fail the lint. CI runs against the committed tree, so HEAD is what
// matters.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

function src(p: string): string {
  return readFileSync(path.join(repoRoot, p), "utf8");
}

function headFile(p: string): string {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", repoRoot, "show", `HEAD:${p}`],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0) {
    throw new Error(`git show HEAD:${p} failed: ${r.stderr.toString()}`);
  }
  return r.stdout.toString();
}

function headTree(): Set<string> {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", repoRoot, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0) {
    throw new Error(`git ls-tree HEAD failed: ${r.stderr.toString()}`);
  }
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
}

function resurrected(checks: Array<[string, RegExp]>, read: (p: string) => string): string[] {
  return checks.filter(([file, re]) => re.test(read(file))).map(([file, re]) => `${file}: ${re.source}`);
}

test("dead simdutf shims and their Rust wrappers do not reappear", () => {
  // The big-endian UTF-16/UTF-32 conversion family: every C shim had a Rust
  // extern declaration and a safe wrapper, and no wrapper had a caller.
  const checks: Array<[string, RegExp]> = [
    ["src/simdutf_sys/bun-simdutf.cpp", /\bsimdutf__convert_utf8_to_utf16be\b/],
    ["src/simdutf_sys/bun-simdutf.cpp", /\bsimdutf__convert_utf8_to_utf16le\b/],
    ["src/simdutf_sys/bun-simdutf.cpp", /\bsimdutf__convert_valid_utf32_to_utf16be\b/],
    ["src/simdutf_sys/bun-simdutf.cpp", /\bsimdutf__utf32_length_from_utf8\b/],
    ["src/simdutf_sys/simdutf.rs", /\bsimdutf__convert_utf16be_to_utf32_with_errors\b/],
    ["src/simdutf_sys/simdutf.rs", /\bsimdutf__utf8_length_from_utf16be\b/],
    // The whole `convert::utf32` and `length::utf32` module trees went with them.
    ["src/simdutf_sys/simdutf.rs", /pub mod utf32\b/],
    ["src/parsers/benches/support/simdutf_shim.cpp", /\bsimdutf__convert_utf8_to_utf16le\b/],
  ];
  expect(resurrected(checks, src)).toEqual([]);
});

test("dead Rust FFI wrappers and trait methods do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // C ABI entry points nothing on the Rust side called any more.
    ["src/jsc/URL.rs", /\bURL__fromJS\b/],
    ["src/jsc/VM.rs", /\bfn has_termination_request\b/],
    ["src/jsc/array_buffer.rs", /\bBun__allocUint8ArrayForCopy\b/],
    ["src/uws_sys/Loop.rs", /\buws_loop_defer\b|\buws_res_clear_corked_socket\b|\bfn next_tick\b|\bfn uncork\b/],
    ["src/uws_sys/WebSocket.rs", /\buws_ws_iterate_topics\b/],
    ["src/uws_sys/h3.rs", /\buws_h3_req_get_parameter\b/],
    // Never-called helpers.
    ["src/jsc/JSPromise.rs", /\bfn settle_task\b|\bfn resolve_task\b/],
    ["src/zlib_sys/win32.rs", /\bfn gz(open|dopen|read|write|getc|close|error)\b/],
    ["src/zlib_sys/shared.rs", /\bgzFile\b/],
    ["src/bun_core/string/immutable.rs", /\bpub fn rest\b/],
    ["src/bun_core/fmt.rs", /impl OutOfRangeValue for (i32|bun_alloc::String)\b/],
    ["src/runtime/webcore/ReadableStream.rs", /\bpub fn to_js\(&self\) -> JSValue\b/],
    ["src/runtime/webcore/ArrayBufferSink.rs", /\bpub fn to_js\b/],
    ["src/runtime/node/node_fs.rs", /\bimpl Null\b/],
    ["src/runtime/valkey_jsc/js_valkey.rs", /\bfn subscription_ctx_is_deletable\b|\bfn close_subscription_ctx\b/],
    ["src/runtime/api/html_rewriter.rs", /lol_content_ops! \{ RawEndTag,[^}]*\breplace \//],
    // Trait methods that no code dispatched through the trait.
    ["src/runtime/webcore/Sink.rs", /^\s*fn done\(&self\) -> bool/m],
    ["src/runtime/webcore/FileSink.rs", /^\s*fn done\(&self\) -> bool/m],
    ["src/runtime/webcore/Blob.rs", /\bfn get_mime_type\(&self\)|\bfn on_structured_clone_transfer\b/],
    ["src/runtime/webcore/Blob.rs", /^\s*fn update\(&mut self\);/m],
  ];
  expect(resurrected(checks, src)).toEqual([]);
});

test("dead C++ binding helpers do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/jsc/bindings/BunString.cpp", /\bBunString__toInt32\b|\bURL__fromJS\b|\butf8ByteLength\b/],
    ["src/jsc/bindings/BunString.h", /toCrossThreadShareable\(Ref<WTF::StringImpl>/],
    [
      "src/jsc/bindings/bindings.cpp",
      /\bJSC__VM__(hasTerminationRequest|isTerminationException|notifyNeedDebuggerBreak)\b/,
    ],
    ["src/jsc/bindings/ZigGlobalObject.cpp", /\bBun__allocUint8ArrayForCopy\b|\bjsFunctionNotImplemented\b/],
    ["src/jsc/bindings/ZigGlobalObject.h", /\bjsFunctionCreateFunctionThatMasqueradesAsUndefined\b/],
    ["src/jsc/bindings/ErrorStackTrace.h", /\bgetStackTraceForThrownValue\b/],
    ["src/jsc/bindings/NodeValidator.h", /validateOneOf\([^)]*std::span<const ASCIILiteral>/],
    ["src/jsc/bindings/NodeValidator.h", /validateString\([^)]*JSValue value, JSValue name\)/],
    ["src/jsc/bindings/ErrorCode.h", /CRYPTO_INVALID_KEY_OBJECT_TYPE\([^)]*JSValue received/],
    ["src/jsc/bindings/JSBuffer.h", /createBuffer\([^)]*const char\* ptr/],
    ["src/jsc/bindings/JSBuffer.h", /constructFromEncoding\([^)]*std::span<const uint8_t>/],
    ["src/jsc/bindings/JSX509Certificate.h", /\bm_infoAccess\b|\bJSString\* infoAccess\(\)/],
    ["src/jsc/bindings/BunProcess.h", /queueNextTick\(JSC::JSGlobalObject\* globalObject, JSValue\);/],
    ["src/jsc/bindings/BakeAdditionsToGlobalObject.h", /\bwrapComponent\b/],
    ["src/jsc/bindings/DOMWrapperWorld.h", /\bnormalWorld\(JSC::VM&\)/],
    ["src/jsc/bindings/TextEncoding.h", /TextEncoding\(const String& name\)/],
    ["src/jsc/bindings/ncrypto.h", /\bisZero\(\)|DataPointer sign\(const Buffer<const unsigned char>& data\);/],
    [
      "src/jsc/bindings/ncrypto.h",
      /(BIOPointer|CipherCtxPointer|ECDSASigPointer|ECGroupPointer|ECPointPointer)& operator=\(/,
    ],
    ["src/jsc/bindings/ncrypto.h", /PrivateKeyEncodingConfig& operator=\(/],
    ["src/jsc/bindings/ncrypto.h", /AsymmetricKeyEncodingConfig\(bool output_key_object/],
    ["src/jsc/bindings/webcore/EventEmitter.h", /\beventTypes\(\)|\beventListeners\(/],
    [
      "src/jsc/bindings/webcore/TransferredMessagePort.h",
      /TransferredMessagePort& operator=\(TransferredMessagePort&&\)/,
    ],
    ["src/jsc/bindings/webcore/JSDOMGuardedObject.h", /\bDoNotRegisterWithGlobalObjectTag\b/],
    ["src/jsc/bindings/webcore/JSURLPatternResult.h", /\bconvertDictionary</],
    ["src/jsc/bindings/webcrypto/JSCryptoKeyUsage.h", /\bexpectedEnumerationValues</],
    ["src/uws_sys/libuwsockets.cpp", /\buws_loop_defer\b|\buws_res_clear_corked_socket\b|\buws_ws_iterate_topics\b/],
    ["src/uws_sys/libuwsockets_h3.cpp", /\buws_h3_req_get_parameter\b/],
  ];
  expect(resurrected(checks, headFile)).toEqual([]);
});

test("orphaned files stay deleted", () => {
  // convertDictionary<WorkerOptions> was the only content; JSWorker.cpp builds
  // WorkerOptions by hand.
  const gone = ["src/jsc/bindings/webcore/JSWorkerOptions.cpp", "src/jsc/bindings/webcore/JSWorkerOptions.h"];
  const tree = headTree();
  expect(gone.filter(p => tree.has(p))).toEqual([]);
});
