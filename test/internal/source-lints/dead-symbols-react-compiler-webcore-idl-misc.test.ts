// Guards against reintroduction of symbols removed as dead code in one sweep
// spanning bun_react_compiler, the WebCore/IDL C++ bindings, bun_install_jsc,
// bun_css, bun_jsc, the FFI declaration crates, and assorted leaf crates.
// Every entry had zero references across src/, scripts/, test/ and the
// regenerated build/debug/codegen/ output when it was deleted, and the removal
// was validated by `cargo check --workspace` on all CI target triples plus a
// full `bun bd` build.
//
// This is a source-tree lint: it reads files from src/ and does not touch the
// built binary, so it belongs in test/internal/source-lints/ per the README.
//
// Rust checks read the working tree. Deleted-file and C++/JS checks read the
// committed tree (HEAD): `git stash` round-trips can temporarily restore files
// a branch deletes (see dead-code-escapes.test.ts), and those strays must not
// fail the lint. CI runs against the committed tree, so HEAD is what matters.

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

/**
 * `[file, item]` fails when `item` matches anywhere in the file.
 * `[file, block, item]` fails when `item` matches inside the first match of
 * `block` (used where a same-named item legitimately exists on another type in
 * the same file). A block that no longer exists at all counts as clean.
 */
type Check = [file: string, item: RegExp] | [file: string, block: RegExp, item: RegExp];

function resurrected(checks: Check[], read: (p: string) => string = src): string[] {
  const out: string[] = [];
  for (const check of checks) {
    const source = read(check[0]);
    if (check.length === 2) {
      if (check[1].test(source)) out.push(`${check[0]}: ${check[1].source}`);
      continue;
    }
    const block = check[1].exec(source);
    if (block && check[2].test(block[0])) out.push(`${check[0]}: ${check[1].source} :: ${check[2].source}`);
  }
  return out;
}

test("dead react_compiler symbols do not reappear", () => {
  const checks: Check[] = [
    // The experimental variant of the derived-computations-in-effects
    // validation (~1.1k lines). The pipeline only ever invoked the non-exp
    // version; the _exp config flag is parsed from pragmas but never read.
    [
      "src/react_compiler/validation/validate_no_derived_computations_in_effects.rs",
      /validate_no_derived_computations_in_effects_exp/,
    ],
    // The write-only env-config flag and pragma arm that fed it.
    ["src/react_compiler/hir/environment_config.rs", /validate_no_derived_computations_in_effects_exp/],
    ["src/react_compiler/program.rs", /validate_no_derived_computations_in_effects_exp/],
    // Back-compat alias for a previous parser-hook API; nothing used it.
    ["src/react_compiler/program.rs", /\bSymbolHost\b/],
    ["src/react_compiler/lib.rs", /\bSymbolHost\b/],
    // Arena box alias with zero uses (HirVec is the one HIR actually uses).
    ["src/react_compiler/hir/mod.rs", /\bHirBox\b/],
    // Type predicate whose only callers were in the removed _exp validation.
    ["src/react_compiler/hir/mod.rs", /\bis_use_state_type\b/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead exe_format symbols do not reappear", () => {
  const checks: Check[] = [
    // pe::Error::InsufficientSpace was never constructed.
    ["src/exe_format/pe.rs", /\bInsufficientSpace\b/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead bun_core / bun_alloc / bun_ast / bun_ptr items do not reappear", () => {
  expect(
    resurrected([
      ["src/bun_core/bounded_array.rs", /\bpub fn get\(&self, i: usize\)/],
      ["src/bun_core/string/mod.rs", /\bfn from_utf8\(utf8: &\[u8\]\) -> SliceWithUnderlyingString\b/],
      ["src/bun_core/string/write.rs", /\bpub type Result\b/],
      ["src/bun_alloc/lib.rs", /^impl AllocError \{/m],
      ["src/bun_alloc/lib.rs", /^pub fn usable_size\b/m],
      [
        "src/bun_alloc/lib.rs",
        /^impl<ValueType, const COUNT: usize> BSSList<ValueType, COUNT> \{[^]*?\n\}/m,
        /\bpub fn init\(\)/,
      ],
      ["src/ast/symbol.rs", /\bfn init\(source_count: usize\) -> Map\b/],
      ["src/ptr/lib.rs", /\bfn shared\(self\) -> BackRef<T, Shared>/],
      ["src/ptr/lib.rs", /^impl<T> DetachablePtr<T> \{[^]*?\n\}/m, /\bpub fn as_ptr\b/],
    ]),
  ).toEqual([]);
});

test("dead bun_css items do not reappear", () => {
  expect(
    resurrected([
      // Inherent eql / to_css / parse forwarders whose callers all go through
      // the CssEql / ToCss / Parse trait impls.
      ["src/css/css_parser.rs", /^impl DefaultAtRule \{/m],
      ["src/css/css_parser.rs", /\bfn eql\(lhs: &Token, rhs: &Token\)/],
      ["src/css/css_parser.rs", /\bfn eql\(lhs: &Num, rhs: &Num\)/],
      ["src/css/generics.rs", /\bfn implement_eql\b/],
      ["src/css/generics.rs", /^pub fn parse<T: Parse>/m],
      ["src/css/properties/custom.rs", /\bfn parse_with_options\b/],
      ["src/css/values/calc.rs", /\bfn eql\b/],
      ["src/css/values/calc.rs", /\bfn eql_calc_list\b/],
      ["src/css/values/css_string.rs", /\bfn parse\(input: &mut css::Parser\) -> Result<CssString>/],
      ["src/css/values/angle.rs", /\bpub\(crate\) fn eql\b/],
      ["src/css/values/time.rs", /\bpub fn eql\b/],
    ]),
  ).toEqual([]);
});

test("dead bun_jsc items do not reappear", () => {
  expect(
    resurrected([
      ["src/jsc/AbortSignal.rs", /^impl AbortReason \{/m],
      ["src/jsc/ConsoleObject.rs", /^    impl TagPayload \{[^]*?\n    \}/m, /\bpub fn get\b/],
      ["src/jsc/ErrorCode.rs", /\bfn new\(global: &'a G, code: ErrorCode, args: Arguments<'a>\)/],
      ["src/jsc/JSCell.rs", /\bfn to_js\b/],
      ["src/jsc/JSGlobalObject.rs", /\bpub fn to_js<T: Into<JSValue>>/],
      ["src/jsc/JSGlobalObject.rs", /\bpub fn ref_\b/],
      ["src/jsc/JSGlobalObject.rs", /\bpub fn ctx\b/],
      ["src/jsc/Task.rs", /\bpub fn new<T: Taskable>/],
      ["src/jsc/TopExceptionScope.rs", /\bpub fn new\b/],
      ["src/jsc/array_buffer.rs", /\bpub fn to_js\(&mut self, global: &JSGlobalObject\)/],
      ["src/jsc/job.rs", /\bfn on_js_thread\b/],
      ["src/jsc/job.rs", /\bfn off_thread\b/],
      ["src/jsc/lib.rs", /\bBUILTIN_NAME_MAP\b/],
      ["src/jsc/uuid.rs", /\bconst ZERO\b/],
    ]),
  ).toEqual([]);
});

test("dead FFI-crate items do not reappear", () => {
  expect(
    resurrected([
      ["src/boringssl_sys/boringssl.rs", /\bX509_V_OK\b/],
      ["src/boringssl_sys/boringssl.rs", /\bSSL_SESS_CACHE_CLIENT\b/],
      ["src/boringssl_sys/boringssl.rs", /^impl GeneralNames \{[^]*?\n\}/m, /\bfn is_empty\b/],
      ["src/cares_sys/c_ares.rs", /^impl AddrInfo_hints \{/m],
      ["src/uws_sys/Loop.rs", /^impl PosixLoop \{[^]*?\n\}/m, /\bpub fn wake\b/],
      ["src/uws_sys/Loop.rs", /^impl PosixLoop \{[^]*?\n\}/m, /\bpub fn run\b/],
      ["src/uws_sys/Response.rs", /\bpub fn init<T>\(response: T\) -> AnyResponse\b/],
      ["src/uws_sys/SocketGroup.rs", /\bfn is_empty\b/],
      ["src/uws_sys/lib.rs", /\bconst Close: Opcode\b/],
      ["src/uws_sys/lib.rs", /\bpub type WindowsLoop\b/],
      ["src/uws_sys/socket.rs", /\bpub type SocketTcp\b/],
      ["src/uws_sys/socket.rs", /\bpub type SocketTls\b/],
      ["src/uws_sys/socket.rs", /\bpub fn group\b/],
      ["src/windows_sys/externs.rs", /\bWaitForSingleObject_raw\b/],
      ["src/windows_sys/externs.rs", /\bpub unsafe fn WaitForSingleObject\b/],
      ["src/windows_sys/externs.rs", /\bpub const fn raw\(self\) -> u32\b/],
      // Alternate spellings of alloc_func / free_func / struct_internal_state /
      // zStream_struct that only the per-platform re-export lists mentioned.
      ["src/zlib_sys/shared.rs", /\bz_(alloc|free)_(fn|func)\b/],
      ["src/zlib_sys/shared.rs", /\bpub type (internal_state|struct_z_stream_s|z_stream_s|Byte)\b/],
      ["src/zlib_sys/win32.rs", /\bstruct_internal_state\b|\bz_stream_s\b/],
      ["src/zlib_sys/posix.rs", /\bstruct_internal_state\b|\balloc_func\b/],
    ]),
  ).toEqual([]);
});

test("dead Rust symbols (install, webcore, jsc, leaf crates) do not reappear", () => {
  const checks: Check[] = [
    // jsc: js_class_module! emitted a dangerously_set_ptr wrapper plus its
    // extern import in every instantiation; no instantiation called it.
    ["src/jsc/generated.rs", /__dangerouslySetPtr/],

    // sha_hmac: deprecated-API hashers with no callers (only SHA1 and SHA256
    // have consumers), plus unused evp types.
    ["src/sha_hmac/sha.rs", /SHA512_Init,\s*\n\s*boringssl_sys::SHA512_Update/],
    ["src/sha_hmac/sha.rs", /RIPEMD160_Init/],
    ["src/sha_hmac/sha.rs", /new_evp!\(MD5_SHA1/],
    ["src/sha_hmac/sha.rs", /new_evp!\(Blake2,/],

    // wyhash: hash_int's single caller instantiates u32.
    ["src/wyhash/lib.rs", /impl HashInt for u16\b/],
    ["src/wyhash/lib.rs", /impl HashInt for u64\b/],

    // clap: never-constructed variant and the From impl that was its only
    // would-be constructor.
    ["src/clap/error.rs", /WriteFailed/],

    // md: never constructed or matched.
    ["src/md/types.rs", /Setextheader/],

    // react_compiler: zero references.
    ["src/react_compiler/hir/environment_config.rs", /fn default_true\b/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("unused re-export names do not reappear", () => {
  const checks: Check[] = [
    // Each name was unreferenced under the re-exported path; the underlying
    // items (where they still exist) are reached via their own modules.
    ["src/sql_jsc/jsc.rs", /pub use SSLConfig as SslConfig;/],
    ["src/sql_jsc/jsc.rs", /ExternColumnIdentifierValue/],
    ["src/errno/linux_errno.rs", /mode_t as Mode/],
    ["src/errno/darwin_errno.rs", /mode_t as Mode/],
    ["src/errno/freebsd_errno.rs", /mode_t as Mode/],
    ["src/spawn/lib.rs", /posix_spawn as PosixSpawn/],
    ["src/runtime/api/bun/spawn.rs", /\bPosixSpawn\b/],
    ["src/runtime/ffi/mod.rs", /pub use abi_type::/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("stale build-script entries do not reappear", () => {
  const checks: Check[] = [
    // src/asan-config.c (the glob's last match) was deleted in #29655; the
    // pattern silently matched nothing.
    ["scripts/glob-sources.ts", /"src\/\*\.c"/],
    // Generated #define BUN_DEP_* block was write-only; BunProcess.cpp reads
    // only the BUN_VERSION_* constants.
    ["scripts/build/depVersionsHeader.ts", /BUN_DEP_/],
    // Computed, stored, never read.
    ["scripts/build/config.ts", /kqueue/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead Rust FFI wrappers and trait methods do not reappear", () => {
  const checks: Check[] = [
    ["src/uws_sys/Loop.rs", /\buws_loop_defer\b|\buws_res_clear_corked_socket\b|\bfn next_tick\b|\bfn uncork\b/],
    ["src/uws_sys/WebSocket.rs", /\buws_ws_iterate_topics\b/],
    ["src/uws_sys/h3.rs", /\buws_h3_req_get_parameter\b/],
    // Never-called helpers.
    ["src/jsc/JSPromise.rs", /\bfn settle_task\b|\bfn resolve_task\b/],
    ["src/zlib_sys/win32.rs", /\bfn gz(open|dopen|read|write|getc|close|error)\b/],
    ["src/zlib_sys/shared.rs", /\bgzFile\b/],
    ["src/bun_core/string/immutable.rs", /\bpub fn rest\b/],
    ["src/bun_core/fmt.rs", /impl OutOfRangeValue for (i32|bun_alloc::String)\b/],
    ["src/runtime/webcore/ArrayBufferSink.rs", /\bpub fn to_js\b/],
    // Bun.nanoseconds is functionBunNanoseconds in BunObject.cpp; the Rust
    // callback export (and the BunObject+exports.h declarations of it and five
    // other callbacks that no longer exist on the Rust side) had no consumer.
    ["src/runtime/api/BunObject.rs", /\bBunObject_callback_nanoseconds\b|\bfn nanoseconds\b/],
    ["src/jsc/bindings/BunObject+exports.h", /macro\((braces|fs|gc|generateHeapSnapshot|nanoseconds|assetPrefix)\)/],
  ];
  expect(resurrected(checks, src)).toEqual([]);
});

test("dead C++ binding helpers do not reappear", () => {
  const checks: Check[] = [
    ["src/jsc/bindings/BunString.cpp", /\bBunString__toInt32\b|\butf8ByteLength\b/],
    ["src/jsc/bindings/headers-handwritten.h", /\butf8ByteLength\b/],
    ["src/jsc/bindings/BunString.h", /toCrossThreadShareable\(Ref<WTF::StringImpl>/],
    ["src/jsc/bindings/JSBuffer.h", /createBuffer\([^)]*const char\* ptr/],
    ["src/jsc/bindings/JSBuffer.h", /constructFromEncoding\([^)]*std::span<const uint8_t>/],
    ["src/jsc/bindings/JSX509Certificate.h", /\bm_infoAccess\b|\bJSString\* infoAccess\(\)/],
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

test("dead WebCore / IDL binding code does not reappear", () => {
  const checks: Check[] = [
    // IDL typed-array specializations and toPossiblyShared*Array helpers for
    // every element type no binding converts (only Uint8Array/ArrayBuffer
    // views are used).
    [
      "src/jsc/bindings/webcore/JSDOMConvertBufferSource.h",
      /\bIDLInt8Array\b|\bIDLFloat16Array\b|\bIDLBigInt64Array\b/,
    ],
    ["src/jsc/bindings/webcore/JSDOMConvertBufferSource.h", /\btoPossiblySharedInt8Array\b/],
    // DeferredPromise resolution helpers with no callers.
    [
      "src/jsc/bindings/webcore/JSDOMPromiseDeferred.h",
      /\bresolveWithJSValue\b|\bresolveWithNewlyCreated\b|\bresolveCallbackValueWithNewlyCreated\b/,
    ],
    // WebKit networking-stack leftovers; bun never reads these fields.
    ["src/jsc/bindings/webcore/NetworkLoadMetrics.h", /\bNetworkLoadPriority\b|\bPrivacyStance\b|\bisCellular\b/],
    // The IDLUnsupportedType family, the IDB/WebGL/ScheduledAction wrappers and
    // the JSDOMConvertDate.h converter (deleted below) had no users.
    ["src/jsc/bindings/IDLTypes.h", /\bIDLUnsupportedType\b|\bIDLScheduledAction\b|\bIDLIDBKey\b|\bIDLWebGLAny\b/],
    ["src/jsc/bindings/webcore/JSDOMConvert.h", /JSDOMConvertDate\.h/],
    [
      "src/jsc/bindings/webcore/JSDOMOperationReturningPromise.h",
      /\bcallReturningOwnPromise\b|\bcallStaticReturningOwnPromise\b/,
    ],
    ["src/jsc/bindings/webcore/JSDOMAttribute.h", /\bsetPassingPropertyName\b|\bsetStatic\b/],
    ["src/jsc/bindings/webcore/JSDOMIterator.h", /\baddValueIterableMethods\b/],
    ["src/jsc/bindings/webcore/HTTPHeaderIdentifiers.h", /\bidentifierFor\b/],
    ["src/jsc/bindings/webcore/HTTPHeaderIdentifiers.cpp", /\bidentifierFor\b/],
    ["src/jsc/bindings/webcore/JSURLPatternResult.cpp", /\bconvertDictionary</],
    ["src/jsc/bindings/webcore/BufferSource.h", /\bmutableData\b|\btoBufferSource\b/],
    // Event flags only the (absent) default-event-handler machinery set or
    // read, and the EventTarget::isNode() hook nothing overrode.
    [
      "src/jsc/bindings/webcore/Event.h",
      /\bresetBeforeDispatch\b|\bm_defaultHandled\b|\bm_isDefaultEventHandlerIgnored\b/,
    ],
    ["src/jsc/bindings/webcore/EventTarget.h", /\bisNode\b/],
    ["src/jsc/bindings/webcore/EventEmitter.cpp", /EventEmitter::eventTypes\(\)|EventEmitter::eventListeners\(/],
    ["src/jsc/bindings/webcore/PerformanceTiming.h", /\bmonotonicTimeToIntegerMilliseconds\b/],
    ["src/jsc/bindings/webcore/ContextDestructionObserver.h", /\bprotectedScriptExecutionContext\b/],
    ["src/jsc/bindings/webcrypto/JSCryptoKeyUsage.cpp", /\bexpectedEnumerationValues</],
    // bun:internal-for-testing stopped exporting lsanDoLeakCheck (tests use
    // isASANEnabled) and the dependency.rs helpers, so their native halves went too.
    ["src/jsc/bindings/InternalForTesting.cpp", /\bjsFunction_lsanDoLeakCheck\b/],
    ["src/jsc/bindings/InternalForTesting.h", /\bjsFunction_lsanDoLeakCheck\b/],
    ["src/js/internal-for-testing.ts", /\blsanDoLeakCheck\b|dependency\.rs/],
    ["src/codegen/generate-js2native.ts", /"dependency\.rs"/],
    // node-fallbacks: util.types was a ~270 line commented-out block, and the
    // package only bundles the handful of polyfill packages its sources import.
    ["src/node-fallbacks/util.js", /\bisArgumentsObject\b|\bcheckBoxedPrimitive\b/],
    ["src/node-fallbacks/package.json", /"(esbuild|vm-browserify|os-browserify|path-browserify|timers-browserify)"/],
    ["src/node-fallbacks/tsconfig.json", /browserify\/browser|timers-browserify|tty-browserify/],
    // REPL primordials entries nothing read. The shim was also the only
    // importer of SafeWeakSet, so internal/primordials stopped exporting it.
    ["src/js/internal/repl/node-primordials.js", /\bArrayPrototypeFindLastIndex\b|\bSafeWeakSet\b|\bSafeMap\b/],
    ["src/js/internal/primordials.js", /\bSafeWeakSet\b/],
  ];
  expect(resurrected(checks, headFile)).toEqual([]);
});

test("dead code in install_jsc, install_types and runtime/node does not reappear", () => {
  const checks: Check[] = [
    // Host-fn bodies whose only JS consumers were the removed
    // bun:internal-for-testing exports.
    ["src/install_jsc/lib.rs", /\bdependency_jsc\b|\bupdate_request_jsc\b/],
    ["src/runtime/dispatch_js2native.rs", /\bdependency_jsc\b/],
    // Re-export modules no path ever named; everything imports these types
    // from bun_semver directly.
    ["src/install_types/lib.rs", /pub mod (ExternalString|SlicedString|SemverString)\b/],
    // No shipped target is wasi, and the bun_sys::wasi module it used does not exist.
    ["src/runtime/node/dir_iterator.rs", /\bwasi\b/],
    // Diff / DiffKind are marshalled to JS field by field; nothing formats them.
    ["src/runtime/node/assert/myers_diff.rs", /\bDisplay\b/],
    // fs_events.rs is only compiled on macOS (see src/runtime/node.rs), so its
    // non-unix stub and not-macos dead_code escapes were unreachable.
    ["src/runtime/node/fs_events.rs", /cfg\(not\(unix\)\)|cfg_attr\(not\(target_os = "macos"\)/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("orphaned files stay deleted", () => {
  const gone = [
    // Ruby predecessor of scripts/build/unified.ts; nothing invoked it.
    "src/codegen/generate-unified-source-bundles.rb",
    // Only reachable through the removed bun:internal-for-testing exports.
    "src/install_jsc/dependency_jsc.rs",
    "src/install_jsc/update_request_jsc.rs",
    // Each held a single declaration/definition with no callers: the IDLDate
    // converter, addValueIterableMethods, createMIMEBinding, and
    // convertDictionary<WorkerOptions> (JSWorker.cpp builds WorkerOptions by hand).
    "src/jsc/bindings/webcore/JSDOMConvertDate.cpp",
    "src/jsc/bindings/webcore/JSDOMConvertDate.h",
    "src/jsc/bindings/webcore/JSDOMIterator.cpp",
    "src/jsc/bindings/webcore/JSMIMEBindings.cpp",
    "src/jsc/bindings/webcore/JSMIMEBindings.h",
    "src/jsc/bindings/webcore/JSWorkerOptions.cpp",
    "src/jsc/bindings/webcore/JSWorkerOptions.h",
  ];
  const tree = headTree();
  expect(gone.filter(p => tree.has(p))).toEqual([]);
});
