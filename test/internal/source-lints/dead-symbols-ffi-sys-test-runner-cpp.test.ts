// Guards against reintroduction of symbols removed as dead code from the
// Windows libuv FFI crate, bun_cares_sys, bun_brotli_sys, the simdutf FFI
// (Rust declarations plus their C++ wrappers), the test-runner JSValue
// extension trait, and the C++ bindings (event emitter, cookies, node:module,
// streams, webcore headers). Every entry was verified to have zero references
// across src/, scripts/, test/ and the regenerated build/debug/codegen/ output
// before deletion; the removal was validated by `cargo check --workspace` on
// all 10 CI target triples, `cargo check --workspace --tests`, and a full
// `bun bd` build.
//
// This is a source-tree lint: it reads files from src/ and does not touch the
// built binary, so it belongs in test/internal/source-lints/ per the README.
// All checks read the working tree; nothing in this sweep deleted a whole file.

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

test("dead libuv FFI declarations (windows-only crate) do not reappear", () => {
  expect(
    resurrected([
      // extern "C" declarations no Rust code called: tcp/udp/tty/poll/prepare/
      // check/fs_poll/threading/os-info surface of uv.h that bun never uses.
      ["src/libuv_sys/libuv.rs", /\bfn uv_tcp_connect\b/],
      ["src/libuv_sys/libuv.rs", /\bfn uv_udp_recv_start\b/],
      ["src/libuv_sys/libuv.rs", /\bfn uv_tty_get_winsize\b/],
      ["src/libuv_sys/libuv.rs", /\bfn uv_prepare_init\b/],
      ["src/libuv_sys/libuv.rs", /\bfn uv_fs_poll_start\b/],
      ["src/libuv_sys/libuv.rs", /\bfn uv_thread_create\b/],
      ["src/libuv_sys/libuv.rs", /\bfn uv_os_get_passwd\b/],
      ["src/libuv_sys/libuv.rs", /\bfn uv_queue_work\b/],
      ["src/libuv_sys/libuv.rs", /\bfn uv_async_init\b/],
      ["src/libuv_sys/libuv.rs", /\bfn uv_dlopen\b/],
      // structs / callback aliases that only those declarations referenced.
      ["src/libuv_sys/libuv.rs", /\bstruct uv_passwd_t\b/],
      ["src/libuv_sys/libuv.rs", /\bstruct uv_getnameinfo_t\b/],
      ["src/libuv_sys/libuv.rs", /\bstruct uv_thread_options_t\b/],
      ["src/libuv_sys/libuv.rs", /\bstruct uv_lib_t\b/],
      ["src/libuv_sys/libuv.rs", /\bstruct uv_dirent_t\b/],
      ["src/libuv_sys/libuv.rs", /\btype uv_random_cb\b/],
      // never-used wrappers: the UvReq marker trait, Pipe/Loop/async helpers.
      ["src/libuv_sys/libuv.rs", /\btrait UvReq\b/],
      ["src/libuv_sys/libuv.rs", /\bfn dump_active_handles\b/],
      ["src/libuv_sys/libuv.rs", /\bfn set_pending_instances_count\b/],
      ["src/libuv_sys/libuv.rs", /\bfn as_stream_ptr\b/],
      // alias tables nothing read: StdioFlags (bun_spawn uses UV_* directly),
      // UV_FS_O_* (duplicates of the `O` module), priorities, clock ids.
      ["src/libuv_sys/libuv.rs", /\bmod StdioFlags\b/],
      ["src/libuv_sys/libuv.rs", /\bUV_FS_O_APPEND\b/],
      ["src/libuv_sys/libuv.rs", /\bUV_PRIORITY_LOW\b/],
      ["src/libuv_sys/libuv.rs", /\bUV_CLOCK_MONOTONIC\b/],
      ["src/spawn/process.rs", /\bStdioFlags\b/],
    ]),
  ).toEqual([]);
});

test("dead c-ares and brotli FFI declarations do not reappear", () => {
  expect(
    resurrected([
      // bun drives c-ares through ares_init_options / ares_query /
      // ares_getaddrinfo; these entry points were declared but never called.
      ["src/cares_sys/c_ares.rs", /\bfn ares_init\b/],
      ["src/cares_sys/c_ares.rs", /\bfn ares_gethostbyname\b/],
      ["src/cares_sys/c_ares.rs", /\bfn ares_expand_name\b/],
      ["src/cares_sys/c_ares.rs", /\bfn ares_timeout\b/],
      ["src/cares_sys/c_ares.rs", /\bfn ares_parse_uri_reply\b/],
      ["src/cares_sys/c_ares.rs", /\bstruct ares_socket_functions\b/],
      ["src/cares_sys/c_ares.rs", /\bstruct_ares_uri_reply\b/],
      // Windows-only struct definitions that existed solely for the above.
      ["src/cares_sys/lib.rs", /\bstruct (timeval|iovec)\b/],
      // BrotliDecoder helpers no caller used (callers use the raw
      // BrotliDecoderGetErrorCode directly).
      ["src/brotli_sys/brotli_c.rs", /\bBrotliDecoderIsFinished\b/],
      ["src/brotli_sys/brotli_c.rs", /\bBrotliDecoderVersion\b/],
      ["src/brotli_sys/brotli_c.rs", /\bfn (is_finished|get_error_code|version)\b/],
    ]),
  ).toEqual([]);
});

test("dead simdutf wrappers stay removed on both sides of the FFI", () => {
  // The complete set of wrappers removed (22 had an unused Rust declaration,
  // 8 had already lost theirs). The trailing \b keeps the still-live
  // `*_with_errors` / `*be` siblings of several of these from matching.
  const removed = [
    "base64_decode_from_binary16",
    "change_endianness_utf16",
    "convert_latin1_to_utf8",
    "convert_utf16be_to_utf32",
    "convert_utf16be_to_utf8",
    "convert_utf16le_to_utf32",
    "convert_utf16le_to_utf32_with_errors",
    "convert_utf16le_to_utf8",
    "convert_utf32_to_utf16be",
    "convert_utf32_to_utf16le",
    "convert_utf32_to_utf16le_with_errors",
    "convert_utf32_to_utf8",
    "convert_utf8_to_utf32",
    "convert_valid_utf16le_to_utf32",
    "convert_valid_utf32_to_utf16le",
    "convert_valid_utf8_to_utf16be",
    "convert_valid_utf8_to_utf16le",
    "count_utf16be",
    "count_utf16le",
    "count_utf8",
    "detect_encodings",
    "utf16_length_from_latin1",
    "utf16_length_from_utf32",
    "utf32_length_from_utf16le",
    "utf8_length_from_utf32",
    "validate_utf16be",
    "validate_utf16be_with_errors",
    "validate_utf16le_with_errors",
    "validate_utf32",
    "validate_utf32_with_errors",
  ];
  const names = new RegExp(`\\bsimdutf__(?:${removed.join("|")})\\b`);
  expect(
    resurrected([
      ["src/simdutf_sys/simdutf.rs", names],
      ["src/simdutf_sys/bun-simdutf.cpp", names],
      ["src/parsers/benches/support/simdutf_shim.cpp", names],
    ]),
  ).toEqual([]);

  // Every wrapper the C++ side still defines must have a Rust declaration and
  // vice versa, so the two files cannot drift apart again.
  const collect = (text: string) => new Set([...text.matchAll(/\bsimdutf__\w+/g)].map(m => m[0]));
  const rust = collect(src("src/simdutf_sys/simdutf.rs"));
  const cpp = collect(src("src/simdutf_sys/bun-simdutf.cpp"));
  expect([...rust].filter(n => !cpp.has(n)).sort()).toEqual([]);
  expect([...cpp].filter(n => !rust.has(n)).sort()).toEqual([]);

  // The parser bench shim only exists to satisfy those same declarations, so
  // it must not define wrappers the Rust side never declares (it carried
  // six such orphans before this sweep).
  const shim = collect(src("src/parsers/benches/support/simdutf_shim.cpp"));
  expect([...shim].filter(n => !rust.has(n)).sort()).toEqual([]);
});

test("dead bun_runtime helpers do not reappear", () => {
  expect(
    resurrected([
      // JSValueTestExt forwarders shadowed by the same-named bun_jsc inherent
      // methods, so no call site could ever resolve to them.
      [
        "src/runtime/test_runner/mod.rs",
        /\bfn (to_fmt|jest_deep_equals|is_uint32_as_any_int|to_u32|string_includes)\b/,
      ],
      // Never-read fields.
      ["src/runtime/test_runner/expect.rs", /struct CustomMatcherParamsFormatter<'a>/],
      ["src/runtime/test_runner/expect.rs", /struct SuccessfulReturnsFormatter<'g, 'f> \{\s*pub global_this:/],
      ["src/runtime/webcore/fetch/FetchTasklet.rs", /\bglobal_this: Option<GlobalRef>/],
      // S3ErrorJsc::to_js duplicated the s3_error_to_js free fn nobody called
      // through the trait.
      ["src/runtime/webcore/s3/error_jsc.rs", /\bfn to_js\(/],
    ]),
  ).toEqual([]);
});

test("dead C++ bindings do not reappear", () => {
  expect(
    resurrected([
      // simdutf C++ wrappers are covered above; these are JSC host functions
      // that were declared and defined but never installed on any object.
      ["src/jsc/bindings/webcore/JSEventEmitter.cpp", /\bEvents_function(GetEventListeners|ListenerCount|Once|On)\b/],
      ["src/jsc/bindings/webcore/JSEventEmitter.h", /\bEvents_function\w+/],
      ["src/jsc/bindings/webcore/JSEventEmitterCustom.h", /\bJSEventEmitterWrapper\b|\bjsEventEmitterCast\b/],
      ["src/jsc/modules/NodeModuleModule.cpp", /\bjsFunction(DebugNoop|SyncBuiltinExports)\b/],
      ["src/jsc/bindings/webcore/JSCookie.cpp", /\bjsCookieStaticFunctionSerialize\b/],
      ["src/jsc/bindings/Cookie.h", /static String serialize\(/],
      // Declarations with no definition anywhere.
      ["src/jsc/bindings/JSBakeResponse.cpp", /JSC_DECLARE_CUSTOM_GETTER\(jsBakeResponsePrototypeGet/],
      // Helpers with zero callers.
      ["src/jsc/bindings/TextEncoding.h", /\bUTF8Encoding\b/],
      ["src/jsc/bindings/JSMockFunction.cpp", /\bcreateMockResultStructure\b/],
      [
        "src/jsc/bindings/webcore/ActiveDOMObject.h",
        /\bqueueTaskToDispatchEvent(Internal)?\b|\bisAllowedToRunScript\b/,
      ],
      ["src/jsc/bindings/webcore/streams/StreamQueue.h", /\bsetTotalSize\b/],
      ["src/jsc/bindings/webcore/WorkerMessagingProxy.h", /\baskedToTerminate\(\)|\bloaderContextIdentifier\(\)/],
      ["src/jsc/bindings/BunHttp2CommonStrings.h", /\bcommonStringInitializer\b/],
      ["src/jsc/modules/NativeModuleList.h", /\bBUN_FOREACH_CJS_NATIVE_MODULE\b/],
      // Iso-subspace slots no class ever allocated from.
      [
        "src/jsc/bindings/webcore/DOMIsoSubspaces.h",
        /m_subspaceFor(JSS3File|JSS3Bucket|NapiPrototype|EventListener)\b/,
      ],
      [
        "src/jsc/bindings/webcore/DOMClientIsoSubspaces.h",
        /m_clientSubspaceFor(JSS3File|JSS3Bucket|NapiPrototype|EventListener)\b/,
      ],
      // Transferable-stream stubs that only threw "not implemented" and had
      // no callers.
      [
        "src/jsc/bindings/webcore/streams/WebStreamsInternals.h",
        /\bsetUpCrossRealmTransform(Readable|Writable)\b|\bpackAndPostMessage\b/,
      ],
      [
        "src/jsc/bindings/webcore/streams/CrossRealmTransform.cpp",
        /\bsetUpCrossRealmTransform(Readable|Writable)\b|\bpackAndPostMessage\b/,
      ],
      ["src/jsc/bindings/webcore/streams/StreamsForward.h", /\bCrossRealmMessageType\b/],
    ]),
  ).toEqual([]);
});

test("WebCore event interface enums stay trimmed to the interfaces bun implements", () => {
  // These checked-in copies of WebCore's generated enums listed every event /
  // event-target interface in WebKit; only the entries bun's Event and
  // EventTarget subclasses report survive.
  expect(
    resurrected([
      [
        "src/jsc/bindings/webcore/EventInterfaces.h",
        /\b(ApplePayCancelEvent|WebGLContextEvent|MouseEvent|ProgressEvent)InterfaceType\b/,
      ],
      ["src/jsc/bindings/webcore/EventInterfaces.h", /#if ENABLE\(/],
      [
        "src/jsc/bindings/webcore/EventTargetInterfaces.h",
        /\b(ApplePaySession|MediaKeySession|Node|XMLHttpRequest)EventTargetInterfaceType\b/,
      ],
      ["src/jsc/bindings/webcore/EventTargetInterfaces.h", /#if ENABLE\(/],
    ]),
  ).toEqual([]);
  // The survivors keep their original numeric values (Event::m_eventInterface
  // is a 7-bit field and the factories switch on these constants).
  expect(src("src/jsc/bindings/webcore/EventInterfaces.h")).toMatch(/\bMessageEventInterfaceType = 67\b/);
  expect(src("src/jsc/bindings/webcore/EventTargetInterfaces.h")).toMatch(/\bEventTargetInterfaceType = 45\b/);
});
