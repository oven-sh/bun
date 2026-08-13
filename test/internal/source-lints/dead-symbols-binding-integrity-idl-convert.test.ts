// Guards against reintroduction of code removed as dead from the WebCore
// bindings (the inert ENABLE(BINDING_INTEGRITY) scaffolding, EnumTraits
// tables, IDL converter specializations nothing instantiates, opaque-root
// helpers), a few JSC binding headers, and some small Rust FFI wrappers.
// Each entry was verified to have zero references across src/, scripts/,
// test/, and freshly regenerated build/debug/codegen/ output (the Rust side
// additionally through the cross-crate hawk analysis in hawk.toml), and the
// removal was validated by a full `bun bd` build plus `cargo check` on every
// CI target triple.
//
// This is a source-tree lint: it reads files from src/ and does not touch the
// built binary, so it belongs in test/internal/source-lints/ per the README.
//
// Content checks read the working tree. The deleted-file check reads the
// committed tree (HEAD) instead: `git stash` round-trips can temporarily
// restore files a branch deletes (see the same note in
// dead-code-escapes.test.ts), and those strays must not fail the lint.

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

// The vtable check these blocks were scaffolding for has been commented out
// since the files were imported: the file-scope block only declared the
// `_ZTV...` vtable symbol and the `if constexpr (std::is_polymorphic_v<T>)`
// body in toJSNewlyCreated was empty after preprocessing. JSURLPattern.cpp
// still performs the check and keeps its blocks.
const bindingIntegrityFiles = [
  "src/jsc/bindings/webcore/JSAbortController.cpp",
  "src/jsc/bindings/webcore/JSAbortSignal.cpp",
  "src/jsc/bindings/webcore/JSBroadcastChannel.cpp",
  "src/jsc/bindings/webcore/JSCloseEvent.cpp",
  "src/jsc/bindings/webcore/JSCustomEvent.cpp",
  "src/jsc/bindings/webcore/JSDOMFormData.cpp",
  "src/jsc/bindings/webcore/JSDOMURL.cpp",
  "src/jsc/bindings/webcore/JSMessageChannel.cpp",
  "src/jsc/bindings/webcore/JSMessageEvent.cpp",
  "src/jsc/bindings/webcore/JSMessagePort.cpp",
  "src/jsc/bindings/webcore/JSPerformanceMark.cpp",
  "src/jsc/bindings/webcore/JSPerformanceObserver.cpp",
  "src/jsc/bindings/webcore/JSPerformanceObserverEntryList.cpp",
  "src/jsc/bindings/webcore/JSPerformanceServerTiming.cpp",
  "src/jsc/bindings/webcore/JSPerformanceTiming.cpp",
  "src/jsc/bindings/webcore/JSTextEncoder.cpp",
  "src/jsc/bindings/webcore/JSWebSocket.cpp",
  "src/jsc/bindings/webcore/JSWorker.cpp",
  "src/jsc/bindings/webcrypto/JSSubtleCrypto.cpp",
];

test("inert BINDING_INTEGRITY scaffolding does not reappear in the webcore bindings", () => {
  const checks: Array<[string, RegExp]> = bindingIntegrityFiles.flatMap(file => [
    [file, /ENABLE\(BINDING_INTEGRITY\)/],
    [file, /_ZTVN7WebCore/],
    [file, /std::is_polymorphic_v/],
  ]);
  expect(resurrected(checks)).toEqual([]);
});

test("dead IDL converter specializations and convert headers do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // No IDL in bun uses float; codegen only emits IDLDouble/IDLUnrestrictedDouble.
    ["src/jsc/bindings/webcore/JSDOMConvertNumbers.h", /\bIDLFloat\b|\bIDLUnrestrictedFloat\b/],
    // ByteString/object/atom-string adaptors are only ever converted JS -> C++.
    ["src/jsc/bindings/webcore/JSDOMConvertStrings.h", /JSConverter<IDLByteString>/],
    ["src/jsc/bindings/webcore/JSDOMConvertStrings.h", /JSConverter<IDLAtomStringAdaptor/],
    ["src/jsc/bindings/webcore/JSDOMConvertStrings.h", /IDLRequiresExistingAtomStringAdaptor/],
    // Nothing constructs the UncachedString/OwnedString adaptors (StringAdaptors.h).
    ["src/jsc/bindings/webcore/JSDOMConvertStrings.h", /\bUncachedString\b|\bOwnedString\b/],
    ["src/jsc/bindings/webcore/JSDOMConvertObject.h", /JSConverter<IDLObject>/],
    // IDLCallbackInterface has no users; IDLCallbackFunction is only converted
    // JS -> C++ through the overload that takes the global object.
    ["src/jsc/bindings/webcore/JSDOMConvertCallbacks.h", /IDLCallbackInterface/],
    ["src/jsc/bindings/webcore/JSDOMConvertCallbacks.h", /JSConverter<IDLCallbackFunction/],
    ["src/jsc/bindings/webcore/JSDOMConvertCallbacks.h", /T::create\(vm, JSC::asObject\(value\)\)/],
    // convertVariadicArguments (JSDOMConvertVariadic.h) is never included, so
    // its per-type specializations can never be instantiated.
    ["src/jsc/bindings/webcore/JSDOMConvertAny.h", /VariadicConverter/],
    ["src/jsc/bindings/webcore/JSDOMConvertInterface.h", /VariadicConverter/],
    // JSDOMConvertNull.h / JSDOMConvertPromise.h are deleted (see below); the
    // includes that pulled them in must stay gone too.
    ["src/jsc/bindings/webcore/JSDOMConvert.h", /JSDOMConvertNull\.h/],
    ["src/jsc/bindings/webcore/JSDOMConvertUnion.h", /JSDOMConvertNull\.h/],
    ["src/jsc/bindings/webcrypto/JSSubtleCrypto.cpp", /JSDOMConvertPromise\.h/],
    // DOMPromise instances were only created by Converter<IDLPromise>; the
    // class now only carries the static whenPromiseIsSettled().
    ["src/jsc/bindings/webcore/JSDOMPromise.h", /static Ref<DOMPromise> create\(/],
    ["src/jsc/bindings/webcore/JSDOMPromise.h", /JSC::JSPromise\* promise\(\) const/],
    // CastedThisErrorBehavior::ReturnEarly was never referenced.
    ["src/jsc/bindings/webcore/JSDOMCastThisValue.h", /\bReturnEarly\b/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("deleted convert headers stay deleted", () => {
  const gone = ["src/jsc/bindings/webcore/JSDOMConvertPromise.h", "src/jsc/bindings/webcore/JSDOMConvertNull.h"];
  const tree = headTree();
  expect(gone.filter(p => tree.has(p))).toEqual([]);
});

test("dead WebCore/JSC binding helpers do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // EnumTraits<>::values tables with no consumer (no EnumeratedArray,
    // OptionSet or isZeroBasedContiguousEnum use of either enum).
    ["src/jsc/bindings/webcore/HTTPHeaderNames.h", /EnumTraits</],
    ["src/jsc/bindings/ExceptionCode.h", /EnumTraits</],
    // ExceptionOr<T&> was never instantiated; the isolatedCopy free functions
    // had no callers (crossThreadCopy uses the member); m_wasReleased was
    // declared but never touched.
    ["src/jsc/bindings/ExceptionOr.h", /ReturnReferenceType/],
    ["src/jsc/bindings/ExceptionOr.h", /\bisolatedCopy\(/],
    ["src/jsc/bindings/ExceptionOr.h", /m_wasReleased/],
    ["src/jsc/bindings/Exception.h", /isolatedCopy\(Exception&&\)/],
    ["src/jsc/bindings/Exception.h", /\bextra\(\) const/],
    // The only opaque-root user passes a WebCoreOpaqueRoot value
    // (JSAbortController); the pointer/reference forwarding overloads, the
    // contains* queries and the MessagePort/CryptoKey root() functions that
    // only they could reach were dead.
    ["src/jsc/bindings/WebCoreOpaqueRoot.h", /containsWebCoreOpaqueRoot|ImplType|std::nullptr_t/],
    ["src/jsc/bindings/WebCoreOpaqueRootInlines.h", /containsWebCoreOpaqueRoot|ImplType/],
    ["src/jsc/bindings/webcore/MessagePort.h", /WebCoreOpaqueRoot/],
    ["src/jsc/bindings/webcore/MessagePort.cpp", /WebCoreOpaqueRoot/],
    ["src/jsc/bindings/webcrypto/CryptoKey.h", /WebCoreOpaqueRoot/],
    ["src/jsc/bindings/webcrypto/CryptoKey.cpp", /WebCoreOpaqueRoot/],
    // Common strings nothing reads (the http* entries are reached via token
    // pasting in BunCommonStrings.cpp and are live).
    [
      "src/jsc/bindings/BunCommonStrings.h",
      /macro\((ConnectionWasClosed|OperationFailed|OperationTimedOut|ec|ed25519|rsa|rsaPss|jwkDsa|jwkG|systemError|x25519),/,
    ],
    // Every EventLoopTask is built from a Function<void(ScriptExecutionContext&)>.
    ["src/jsc/bindings/EventLoopTask.h", /Function<void\(\)>/],
    // Initialized and visited, never read; the alias duplicated ZigGlobalObject's.
    ["src/jsc/bindings/BakeAdditionsToGlobalObject.h", /m_bakeGetAsyncLocalStorage|LazyPropertyOfGlobalObject/],
    // Enumerators nothing names.
    [
      "src/jsc/bindings/webcore/TaskSource.h",
      /DOMManipulation|FileReading|Networking|PerformanceTimeline|\bTimer\b|InternalAsyncTask/,
    ],
    [
      "src/jsc/bindings/webcore/EventListener.h",
      /(Image|ObjC|CPP|Condition|GObject|Native|SVGTRefTarget|PDFDocument)EventListenerType/,
    ],
    // Preprocessor branches that can never be taken.
    ["src/jsc/bindings/webcrypto/CryptoAlgorithmRSA_PSSOpenSSL.cpp", /^#if 1\b/m],
    ["src/jsc/bindings/webcore/JSEventTargetCustom.cpp", /OFFSCREEN_CANVAS/],
    ["src/jsc/bindings/webcore/JSDOMURL.cpp", /MEDIA_SOURCE/],
    // Declarations without a definition.
    ["src/jsc/bindings/webcrypto/CryptoKeyOKP.h", /platformExportSpki|platformExportPkcs8/],
    ["src/jsc/bindings/node/crypto/CryptoKeygen.h", /JSC::JSValue result\(\) const/],
    ["src/jsc/bindings/node/crypto/CryptoGenKeyPair.h", /\bdeinit\(\)/],
    ["src/jsc/bindings/JSNodePerformanceHooksHistogram.h", /template<typename Visitor>/],
    ["src/jsc/bindings/JSX509Certificate.h", /template<typename Visitor>/],
    // Unreferenced accessors, fields, macros and a stale commented-out declaration.
    ["src/jsc/bindings/JSNodePerformanceHooksHistogram.h", /hdr_histogram& histogram\(\)|getHistogramDataForCloning/],
    ["src/jsc/bindings/NodeVMSourceTextModule.h", /cachedExecutable\(\) const/],
    ["src/jsc/bindings/webcore/Worker.h", /\bisOnline\b/],
    ["src/jsc/bindings/ModuleLoader.h", /\bwasMock\b/],
    ["src/jsc/bindings/ModuleLoader.cpp", /\bwasMock\b/],
    ["src/jsc/bindings/webcore/streams/JSOneShotDirectSink.h", /m_asUint8Array/],
    ["src/jsc/bindings/webcore/streams/BunStreamConsumers.cpp", /m_asUint8Array/],
    ["src/jsc/bindings/JSBufferEncodingType.h", /expectedEnumerationValues/],
    ["src/jsc/bindings/JSBufferEncodingType.cpp", /expectedEnumerationValues/],
    ["src/jsc/bindings/SecretsLinux.cpp", /\bG_FALSE\b|\bG_TRUE\b/],
    ["src/jsc/bindings/workaround-missing-symbols.cpp", /BUN_WRAP_FWD_VOID/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead Rust FFI wrappers and css items do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // Callers go through the raw mi_heap_* functions with a *mut Heap
    // (MimallocArena deliberately never hands out a &Heap); the &mut self
    // methods and the two imports only they used were unreachable.
    ["src/mimalloc_sys/mimalloc.rs", /^impl Heap \{/m],
    ["src/mimalloc_sys/mimalloc.rs", /\bmi_heap_calloc\b|\bfn mi_heap_realloc\(/],
    // The RAII wrappers free through libdeflate_free_* directly.
    ["src/libdeflate_sys/libdeflate.rs", /pub unsafe fn destroy\(/],
    // App::run / App::listen (the server listens through listen_with_config)
    // and the imports/constructor/alias only they used. The live NewApp alias
    // is the one in src/uws_sys/lib.rs.
    [
      "src/uws_sys/App.rs",
      /\buws_app_run\b|\bfn uws_app_listen\(|pub fn run\(|pub type NewApp\b|impl uws_app_listen_config_t/,
    ],
    // DeclarationContext::Keyframes was never constructed or matched.
    ["src/css/context.rs", /^\s*Keyframes,$/m],
    // Empty marker module whose `use` in color.rs no longer exists.
    ["src/css/values/color_generated.rs", /generated_color_conversions/],
  ];
  expect(resurrected(checks)).toEqual([]);
});
