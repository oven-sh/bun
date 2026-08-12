// Guards against reintroduction of symbols removed as dead code from the
// Rust <-> C++ FFI shim layer (bindings.cpp / headers.h), the
// `bun_dispatch::link_interface!` tables, a handful of `#[no_mangle]` Rust
// exports nothing in C++ calls any more, and two codegen surfaces
// (generate-jssink.ts, jest.classes.ts) that emitted functions nothing
// referenced.
//
// Every function below was reported unreferenced by relinking the debug
// binary with `--gc-sections --print-gc-sections`, then confirmed to have no
// textual reference (other than its own declaration/definition and generated
// wrappers) across src/, packages/, scripts/ and build/debug/codegen/, so that
// code only live on another platform was left alone. The removal was
// validated by a full `bun bd` build and `bun run rust:check-all`.
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
  const cache = new Map<string, string>();
  const read = (p: string) => {
    let s = cache.get(p);
    if (s === undefined) {
      s = src(p);
      cache.set(p, s);
    }
    return s;
  };
  return checks.filter(([file, re]) => re.test(read(file))).map(([file, re]) => `${file}: ${re.source}`);
}

test("C-ABI shims in bindings.cpp that no Rust code calls stay deleted", () => {
  const bindings = "src/jsc/bindings/bindings.cpp";
  const headers = "src/jsc/bindings/headers.h";
  const names = [
    // JSValue predicates / constructors: the Rust JSValue type implements
    // these inline; the shims (and their cppbind wrappers) had no callers.
    "JSC__JSValue__isCell",
    "JSC__JSValue__isNull",
    "JSC__JSValue__isUndefined",
    "JSC__JSValue__isUndefinedOrNull",
    "JSC__JSValue__isNumber",
    "JSC__JSValue__isObject",
    "JSC__JSValue__isInt32",
    "JSC__JSValue__isInt32AsAnyInt",
    "JSC__JSValue__isError",
    "JSC__JSValue__isGetterSetter",
    "JSC__JSValue__isCustomGetterSetter",
    "JSC__JSValue__eqlCell",
    "JSC__JSValue__deepEquals",
    "JSC__JSValue__jsNumberFromChar",
    "JSC__JSValue__jsNumberFromU16",
    "JSC__JSValue__jsNumberFromInt32",
    "JSC__JSValue__jsNumberFromInt64",
    "JSC__JSValue__jsNumberFromUint64",
    "JSC__JSValue__jsTDZValue",
    "JSC__JSValue__jsType",
    "JSC__JSValue__createInternalPromise",
    "JSC__JSValue__createRangeError",
    "JSC__JSValue__createTypeError",
    "JSC__JSValue__fastGetDirect_",
    "JSC__JSValue__getPropertyValue",
    "JSC__JSValue__putRecord",
    "JSC__JSValue__symbolKeyFor",
    // JSInternalPromise was aliased to JSPromise; only resolvedPromise is used.
    "JSC__JSInternalPromise__create",
    "JSC__JSInternalPromise__isHandled",
    "JSC__JSInternalPromise__reject",
    "JSC__JSInternalPromise__rejectAsHandled",
    "JSC__JSInternalPromise__rejectAsHandledException",
    "JSC__JSInternalPromise__rejectedPromise",
    "JSC__JSInternalPromise__resolve",
    "JSC__JSInternalPromise__result",
    "JSC__JSInternalPromise__setHandled",
    "JSC__JSInternalPromise__status",
    "JSC__JSPromise__asValue",
    "JSC__JSPromise__isHandled",
    "JSC__JSPromise__resolveOnNextTick",
    "JSC__JSPromise__rejectOnNextTickWithHandled",
    // Object / cell / string / module-loader helpers.
    "JSC__JSObject__getArrayLength",
    "JSC__JSObject__getDirect",
    "JSC__JSObject__putDirect",
    "JSC__JSCell__getObject",
    "JSC__JSCell__toObject",
    "JSC__JSString__toObject",
    "JSC__JSFunction__optimizeSoon",
    "JSC__JSGlobalObject__getCachedObject",
    "JSC__JSGlobalObject__putCachedObject",
    "JSC__JSMap__has",
    "JSC__JSModuleLoader__evaluate",
    "JSC__createRangeError",
    // VM: execution time limits, watchdog / shell-timeout traps, JIT query.
    "JSC__VM__clearExecutionTimeLimit",
    "JSC__VM__setExecutionTimeLimit",
    "JSC__VM__deleteAllCode",
    "JSC__VM__isEntered",
    "JSC__VM__isJITEnabled",
    "JSC__VM__notifyNeedShellTimeoutCheck",
    "JSC__VM__notifyNeedWatchdogCheck",
    "JSC__VM__performOpportunisticallyScheduledTasks",
    // ZigString / DOMURL / FetchHeaders conversions superseded by BunString.
    "ZigString__to16BitValue",
    "ZigString__toAtomicValue",
    "ZigString__toExternalValueWithCallback",
    "WebCore__DOMURL__href_",
    "WebCore__DOMURL__pathname_",
    "WebCore__FetchHeaders__createValue",
    "Bun__CallFrame__isFromBunMain",
  ];
  const checks: Array<[string, RegExp]> = names.flatMap(name => {
    const re = new RegExp(`\\b${name}\\s*\\(`);
    return [
      [bindings, re],
      [headers, re],
    ] as Array<[string, RegExp]>;
  });
  // Only these shims used it.
  checks.push(["src/jsc/bindings/helpers.h", /\btoJSString\(/]);
  // Rust callers of the two shims above that were themselves unreferenced.
  checks.push(["src/jsc/bun_string_jsc.rs", /JSC__createRangeError|fn to_range_error_instance/]);
  checks.push(["src/jsc/FetchHeaders.rs", /WebCore__FetchHeaders__createValue\b/]);
  expect(resurrected(checks)).toEqual([]);
});

test("declarations in headers.h for functions that no longer exist stay deleted", () => {
  const headers = "src/jsc/bindings/headers.h";
  const checks: Array<[string, RegExp]> = [
    // The DOMJIT fast paths were removed long ago; only the slow paths exist.
    [headers, /__fastpath\b/],
    [headers, /\bJSC__JSGlobalObject__createSyntheticModule_\b/],
    [headers, /\bJSC__JSValue__then\b/],
    [headers, /\bJSC__JSValue__createStringArray\b/],
    [headers, /\bJSC__JSValue__hasOwnProperty\b/],
    [headers, /\bJSC__JSValue__toString\b/],
    [headers, /\bJSC__VM__create\b/],
    [headers, /\bZigException__fromException\b/],
    [headers, /\bZig__GlobalObject__fetch\b/],
    [headers, /\bZig__GlobalObject__promiseRejectionTracker\b/],
    [headers, /\b_fromJS\b/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("Rust exports nothing in C++ calls stay deleted", () => {
  const checks: Array<[string, RegExp]> = [
    // ConsoleObject.cpp only forwards timeStamp; the other no-op hooks had no
    // C++ caller.
    [
      "src/jsc/ConsoleObject.rs",
      /console_noop_hooks|Bun__ConsoleObject__(profile|profileEnd|record|recordEnd|screenshot)\b/,
    ],
    ["src/jsc/bindings/headers.h", /Bun__ConsoleObject__(profile|profileEnd|record|recordEnd|screenshot)\b/],
    ["src/jsc/bindings/headers.h", /\bBun__Timer__getNextID\b/],
    ["src/runtime/timer/Timer.rs", /\bBun__Timer__getNextID\b|\bBun__internal_drainTimers\b|fn drain_timers_export\b/],
    // BunDebugger.cpp's runWhilePaused blocks on a condition variable now.
    ["src/jsc/JSCScheduler.rs", /\bBun__tickWhilePaused\b/],
    ["src/jsc/event_loop.rs", /fn tick_while_paused\b|fn pipe_read_buffer\b/],
    ["src/jsc/bindings/BunDebugger.cpp", /\bBun__tickWhilePaused\b/],
    ["src/jsc/virtual_machine_exports.rs", /\bBun__getVerboseFetchValue\b|fn get_verbose_fetch_value\b/],
    ["src/jsc/bindings/JSEnvironmentVariableMap.cpp", /\bBun__getVerboseFetchValue\b/],
    // ref/deref are inlined in Rust; only the destroy slow path crosses FFI.
    ["src/jsc/bindings/BunString.cpp", /\bBun__WTFStringImpl__(ref|deref)\b/],
    ["src/jsc/bindings/headers-handwritten.h", /\bBun__WTFStringImpl__(ref|deref)\b/],
    ["src/bun_alloc/lib.rs", /\bBun__WTFStringImpl__(ref|deref)\b/],
    // Blob.rs has blob_store_array_buffer_deallocator; this was the Zig-era twin.
    ["src/runtime/webcore/blob/Store.rs", /\bBlobArrayBuffer_deallocator\b/],
    // WebSocket.cpp sends blobs through writeBinaryData.
    ["src/http_jsc/websocket_client.rs", /\bwrite_blob\b|__writeBlob\b/],
    ["src/bun_core/util.rs", /\bBun__linux_trace_close\b/],
    ["src/jsc/bindings/linux_perf_tracing.cpp", /\bBun__linux_trace_close\b/],
    // Exported names no C++ declared a caller for; both functions are reached
    // through Rust tables instead.
    ["src/runtime/node/util/parse_args.rs", /\bBun__NodeUtil__jsParseArgs\b/],
    ["src/jsc/bindings/ZigGlobalObject.cpp", /\bBun__NodeUtil__jsParseArgs\b/],
    ["src/sql_jsc/postgres/PostgresSQLConnection.rs", /\bPostgresSQLConnection__createInstance\b/],
    // Only i64 comparisons are performed against BigInts.
    ["src/jsc/JSBigInt.rs", /\bJSC__JSBigInt__order(Double|Uint64)\b|BigIntOrderable for (f64|u64)\b/],
    ["src/jsc/bindings/JSBigIntBinding.cpp", /\bJSC__JSBigInt__order(Double|Uint64)\b/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("link_interface! methods nothing dispatched through stay deleted", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/event_loop/lib.rs", /^\s*fn (file_polls|put_file_poll|pipe_read_buffer|stdout|stderr)\(/m],
    ["src/jsc/event_loop.rs", /^\s*(file_polls|put_file_poll|pipe_read_buffer|stdout|stderr)\(.*=>/m],
    ["src/bun_core/lib.rs", /^\s*fn (max_dense|win32_name)\(/m],
    ["src/errno/lib.rs", /\bwin32_errno_name\b|\bsystem_errno_max_dense\b|^\s*(max_dense|win32_name)\(.*=>/m],
    ["src/ast/transpiler_cache.rs", /^\s*fn is_disabled\(/m],
    ["src/jsc/RuntimeTranspilerCache.rs", /^\s*is_disabled\(\)\s*=>/m],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead C++ helpers on the global object stay deleted", () => {
  const cpp = "src/jsc/bindings/ZigGlobalObject.cpp";
  const h = "src/jsc/bindings/ZigGlobalObject.h";
  const checks: Array<[string, RegExp]> = [
    // `navigator` / `performance` / `File` are installed from the LUT and the
    // lazy-property tables directly.
    [cpp, /\bJSDOMFileConstructor_(getter|setter)\b/],
    [cpp, /\bfunctionLazyNavigatorGetter\b|GlobalObject::navigatorObject\b/],
    [cpp, /\bGlobalObject_getPerformanceObject\b/],
    [cpp, /GlobalObject::hasNapiFinalizers\b/],
    [h, /\bnavigatorObject\(\)/],
    [h, /\bperformanceObject\(\)/],
    [h, /\bhasNapiFinalizers\(\)/],
    ["src/jsc/bindings/napi.h", /\bhasFinalizers\(\)/],
    ["src/jsc/bindings/napi.h", /\bisVMTerminating\(\)/],
    ["src/jsc/bindings/ScriptExecutionContext.h", /\bpostCrossThreadTask\b/],
    // Constructor accessors whose only reader was the generated per-sink
    // getter below; Bun.ArrayBufferSink keeps its own.
    [
      h,
      /JSObject\* (FileSink|HTTPResponseSink|HTTPSResponseSink|NetworkSink|H3ResponseSink|FetchRequestBodySink|HTMLRewriterSink)\(\)/,
    ],
    [h, /\bNodeVM(SourceText|Synthetic)ModulePrototype\(\)/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("REPL shim exports nothing destructures stay deleted", () => {
  const checks: Array<[string, RegExp]> = [
    // Consumers read .inspect, getStringWidth and stripVTControlCharacters only.
    ["src/js/internal/repl/node-inspect.js", /get format(WithOptions)?\(\)/],
    // completion.js only calls BuiltinModule.getSchemeOnlyModuleNames() and
    // destructures constants.{ALL_PROPERTIES, SKIP_SYMBOLS}.
    ["src/js/internal/repl/node-shims.js", /^\s*(exists|canBeRequiredByUsers|canBeRequiredWithoutScheme)\(id\)/m],
    ["src/js/internal/repl/node-shims.js", /constants: \{[^}]*\b(ONLY_ENUMERABLE|SKIP_STRINGS)\b/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("codegen no longer emits functions nothing references", () => {
  const checks: Array<[string, RegExp]> = [
    // function<Sink>__getter was declared and defined for every sink and
    // installed for none of them.
    ["src/codegen/generate-jssink.ts", /__getter\b/],
  ];
  expect(resurrected(checks)).toEqual([]);

  // The asymmetric matcher classes have no constructor object, so the
  // `<Class>Class__call` thunk `call: true` generated for them was never
  // wired up; the matchers are reached through Expect's static methods.
  const jest = src("src/runtime/test_runner/jest.classes.ts");
  const callable = [...jest.matchAll(/name: "(\w+)",[^}]*?\n\s*call: true,/g)].map(m => m[1]).sort();
  expect(callable).toEqual(["Expect", "ExpectTypeOf"]);
});
