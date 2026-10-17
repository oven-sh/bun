import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";
import { unsupported } from "./run-programs";

const modulesWithUntypedFunctions = [
  "/$bun/js/builtins/Bake.ts", "/$bun/js/builtins/BundlerPlugin.ts",
  "/$bun/js/builtins/CommonJS.ts", "/$bun/js/builtins/ConsoleObject.ts", "/$bun/js/builtins/Fifo.ts", "/$bun/js/builtins/Glob.ts",
  "/$bun/js/builtins/Ipc.ts", "/$bun/js/builtins/JSBufferConstructor.ts", "/$bun/js/builtins/JSBufferPrototype.ts",
  "/$bun/js/builtins/NodeModuleObject.ts", "/$bun/js/builtins/Peek.ts", "/$bun/js/builtins/ProcessObjectInternals.ts",
  "/$bun/js/builtins/UtilInspect.ts", "/$bun/js/builtins/WasmStreaming.ts", "/$bun/js/builtins/shell.ts",
  "/$bun/js/engine/ArrayConstructor.js", "/$bun/js/engine/ArrayIteratorPrototype.js", "/$bun/js/engine/ArrayPrototype.js",
  "/$bun/js/engine/AsyncDisposableStackPrototype.js", "/$bun/js/engine/AsyncIteratorPrototype.js",
  "/$bun/js/engine/DisposableStackPrototype.js", "/$bun/js/engine/FunctionPrototype.js", "/$bun/js/engine/GeneratorPrototype.ts",
  "/$bun/js/engine/IteratorHelpers.js", "/$bun/js/engine/IteratorOperations.ts", "/$bun/js/engine/JSIteratorConstructor.js",
  "/$bun/js/engine/JSIteratorHelperPrototype.ts", "/$bun/js/engine/JSIteratorPrototype.js", "/$bun/js/engine/MapConstructor.js",
  "/$bun/js/engine/MapPrototype.js", "/$bun/js/engine/ObjectConstructor.js", "/$bun/js/engine/PromiseConstructor.js",
  "/$bun/js/engine/ReflectObject.js", "/$bun/js/engine/SetPrototype.js", "/$bun/js/engine/ShadowRealmPrototype.js",
  "/$bun/js/engine/TypedArrayConstructor.js", "/$bun/js/engine/TypedArrayPrototype.js", "/$bun/js/engine/WrapForValidIteratorPrototype.js",
  "bun:ffi", "bun:internal-for-testing", "bun:sql", "bun:sqlite", "internal:abort_listener", "internal:assert/assertion_error",
  "internal:assert/calltracker", "internal:assert/myers_diff", "internal:assert/utils", "internal:async_context_frame",
  "internal:async_hooks", "internal:async_hooks_tick", "internal:cluster/RoundRobinHandle", "internal:cluster/SharedHandle",
  "internal:cluster/Worker", "internal:cluster/child", "internal:cluster/isPrimary", "internal:cluster/primary", "internal:dgram",
  "internal:errors", "internal:fifo", "internal:fixed_queue", "internal:freelist", "internal:fs/binding", "internal:fs/cp",
  "internal:fs/cp-sync", "internal:fs/glob", "internal:fs/streams", "internal:fs/watch", "internal:fs/watchfile",
  "internal:http/FakeSocket", "internal:http1_server_fallback", "internal:linkedlist", "internal:net/isIP",
  "internal:net/server_abort_signal", "internal:net/symbols", "internal:perf_hooks/monitorEventLoopDelay", "internal:primordials",
  "internal:promisify", "internal:quic/binding", "internal:quic/diagnostics", "internal:quic/http2util", "internal:quic/quic",
  "internal:quic/state", "internal:quic/stats", "internal:quic/symbols", "internal:readline/callbacks",
  "internal:readline/emitKeypressEvents", "internal:readline/interface", "internal:readline/promises", "internal:readline/utils",
  "internal:repl", "internal:repl/acorn", "internal:repl/acorn-walk", "internal:repl/await", "internal:repl/completion",
  "internal:repl/history", "internal:repl/mode", "internal:repl/node-errors", "internal:repl/node-inspect",
  "internal:repl/node-primordials", "internal:repl/node-shims", "internal:repl/utils", "internal:serialization_buffers", "internal:shared",
  "internal:sql/errors", "internal:sql/mysql", "internal:sql/postgres", "internal:sql/query", "internal:sql/shared", "internal:sql/sqlite",
  "internal:stream", "internal:stream/promises", "internal:streams/compose",
  "internal:streams/duplexify", "internal:streams/duplexpair",
  "internal:streams/fast-utf8-stream", "internal:streams/iter/broadcast",
  "internal:streams/iter/classic", "internal:streams/iter/consumers", "internal:streams/iter/duplex", "internal:streams/iter/from",
  "internal:streams/iter/pull", "internal:streams/iter/push", "internal:streams/iter/ringbuffer", "internal:streams/iter/share",
  "internal:streams/iter/transform", "internal:streams/iter/types", "internal:streams/iter/utils", "internal:streams/lazy_transform",
  "internal:streams/native-readable", "internal:streams/operators",
  "internal:streams/readable",
  "internal:streams/writable", "internal:test_runner/mock_timers", "internal:timers", "internal:tls",
  "internal:trace_events", "internal:tty", "internal:url", "internal:util/colors", "internal:util/comparisons", "internal:util/debuglog",
  "internal:util/deprecate", "internal:util/mime", "internal:webstreams_adapters", "internal:worker/messaging", "internal:worker/stdio",
  "isomorphic-fetch", "node-fetch", "node:_http2_upgrade", "node:_http_agent", "node:_http_client", "node:_http_common",
  "node:_http_incoming", "node:_http_server", "node:_stream_duplex", "node:_stream_passthrough",
  "node:_stream_readable", "node:_stream_transform", "node:_stream_wrap", "node:_stream_writable", "node:_tls_common", "node:_tls_wrap",
  "node:assert", "node:assert/strict", "node:async_hooks", "node:child_process", "node:cluster", "node:console", "node:crypto",
  "node:dgram", "node:diagnostics_channel", "node:dns", "node:dns/promises", "node:domain", "node:events", "node:fs", "node:fs/promises",
  "node:http", "node:http2", "node:https", "node:inspector", "node:inspector/promises", "node:net", "node:os", "node:path/posix",
  "node:path/win32", "node:perf_hooks", "node:punycode", "node:quic", "node:readline", "node:readline/promises", "node:repl",
  "node:stream", "node:stream/consumers", "node:stream/iter", "node:stream/promises", "node:stream/web", "node:test", "node:timers",
  "node:timers/promises", "node:tls", "node:trace_events", "node:tty", "node:url", "node:util", "node:v8", "node:vm", "node:wasi",
  "node:worker_threads", "node:zlib", "node:zlib/iter", "undici", "vercel_fetch", "ws",
];

test.skipIf(!!unsupported)("the modules of Bun that hold untyped functions are the listed ones, and the list only shrinks", async () => {
  const specifiers = builtinModules
    .filter(name => name !== "bun:test" && name !== "bun")
    .map(name => (name.includes(":") || name === "undici" || name === "ws" ? name : "node:" + name))
    .concat("node:test");
  const required = [...new Set(specifiers)].sort().map(specifier => `require(${JSON.stringify(specifier)})`);
  using dir = tempDir("aot-builtin-modules", { "main.js": `console.log([${required.join(", ")}].length);\n` });
  const map = join(String(dir), "image.map");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", "main"],
    cwd: String(dir),
    env: { ...bunEnv, BUN_JSC_aotMapFilePath: map },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr: stderr.split("\n").filter(line => line.startsWith("error")), exitCode }).toEqual({ stderr: [], exitCode: 0 });
  const found = new Set<string>();
  for (const line of readFileSync(map, "utf8").split("\n")) {
    const [record, , , , , , , , kind, , module] = line.split("\t");
    if (record === "F" && (kind === "untyped" || kind === "generic-untyped") && module !== "main.js" && !module!.startsWith(".bun-aot-prelude/")) found.add(module!);
  }
  expect([...found].sort()).toEqual(modulesWithUntypedFunctions);
}, 120_000);
