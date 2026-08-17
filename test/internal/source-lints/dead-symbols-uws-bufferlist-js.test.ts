// Guards against reintroduction of code removed as dead from Bun's uWebSockets
// fork (packages/bun-uws), the native BufferList class (src/jsc/bindings), the
// built-in JS modules, and two Rust extern "C" exports.
//
// Every entry was verified to have zero references across src/, packages/,
// scripts/, test/ and build/debug/codegen/ before deletion. bun-uws is header
// templates, so the linker never sees an uninstantiated method; each member
// below was checked by hand against every includer of the header. The Rust
// exports were additionally checked against vendor/ and against the symbol
// tables (undefined and weak-defined) of the prebuilt WebKit libraries, which
// is what keeps e.g. Bun__thisThreadHasVM and WTFTimer__* alive.
//
// This is a source-tree lint: it reads files from the tree and does not touch
// the built binary, so it belongs in test/internal/source-lints/ per the README.
//
// The in-file checks read the working tree. The deleted-file checks read the
// committed tree (HEAD) instead: `git stash` round-trips can temporarily
// restore files a branch deletes (see the same note in dead-code-escapes.test.ts).

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

function src(p: string): string {
  return readFileSync(path.join(repoRoot, p), "utf8");
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

function resurrected(checks: Array<[string, RegExp]>): string[] {
  return checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
}

test("deleted files stay deleted", () => {
  const gone = [
    // bun-uws headers that nothing #includes (ProxyParser.h was only reachable
    // under UWS_WITH_PROXY, which no build defines).
    "packages/bun-uws/src/ClientApp.h",
    "packages/bun-uws/src/HttpError.h",
    "packages/bun-uws/src/Multipart.h",
    "packages/bun-uws/src/MessageParser.h",
    "packages/bun-uws/src/ProxyParser.h",
    // upstream README assets and demo certs, referenced by nothing in the repo
    "packages/bun-uws/misc/READMORE.md",
    "packages/bun-uws/misc/cert.pem",
    "packages/bun-uws/misc/key.pem",
    // native BufferList: the JS streams implementation stopped using it long ago
    "src/jsc/bindings/JSBufferList.cpp",
    "src/jsc/bindings/JSBufferList.h",
    // ambient types for a module nothing imports
    "src/js/internal/util/inspect.d.ts",
    // ignored src/js/out, which codegen has not written to in years
    "src/js/.gitignore",
  ];
  const tree = headTree();
  expect(gone.filter(p => tree.has(p))).toEqual([]);
});

test("dead bun-uws template members do not reappear", () => {
  expect(
    resurrected([
      // PROXY protocol support was never compiled in; the reserved/proxyParser
      // plumbing only existed to carry its parser into getHeaders().
      ["packages/bun-uws/src/HttpParser.h", /UWS_WITH_PROXY|ProxyParser|void \*reserved/],
      ["packages/bun-uws/src/HttpContext.h", /UWS_WITH_PROXY|proxyParser/],
      ["packages/bun-uws/src/HttpResponseData.h", /UWS_WITH_PROXY|ProxyParser/],
      ["packages/bun-uws/src/HttpResponse.h", /getProxiedRemoteAddress/],
      // HttpRequest: route parameters are only ever read by index
      ["packages/bun-uws/src/HttpParser.h", /\bsetParameterOffsets\b|\bcurrentParameterOffsets\b/],
      ["packages/bun-uws/src/HttpParser.h", /getParameter\(std::string_view/],
      ["packages/bun-uws/src/HttpContext.h", /\bparameterOffsets\b/],
      ["packages/bun-uws/src/HttpParser.h", /\bisShortRead\b|\bnotFieldNameWord\b|\bhasBetween\b/],
      // HttpRequest::getQuery() with no key (the keyed overload is still used)
      ["packages/bun-uws/src/HttpParser.h", /std::string_view getQuery\(\)/],
      ["packages/bun-uws/src/HttpContext.h", /\bHTTP_IDLE_TIMEOUT_S\b|\blayoutAssert\b/],
      ["packages/bun-uws/src/WebSocketContext.h", /\blayoutAssert\b/],
      ["packages/bun-uws/src/HttpContextData.h", /\bisAuthorized\b/],
      ["packages/bun-uws/src/HttpResponse.h", /\bgetHttpResponseDataS\b|\bendWithoutBody\b|\boverrideWriteOffset\b/],
      // WebSocketBehavior::subscription was never settable through the C API,
      // so every subscriptionHandler dispatch site was unreachable.
      ["packages/bun-uws/src/App.h", /\bsubscription\b/],
      ["packages/bun-uws/src/WebSocketContextData.h", /\bsubscriptionHandler\b/],
      ["packages/bun-uws/src/WebSocket.h", /\bsubscriptionHandler\b/],
      ["packages/bun-uws/src/WebSocketContext.h", /\bsubscriptionHandler\b/],
      ["packages/bun-uws/src/TopicTree.h", /std::tuple<bool, bool, int> unsubscribe/],
      // App overloads the C shim never calls
      ["packages/bun-uws/src/App.h", /unsigned char opCode/],
      ["packages/bun-uws/src/App.h", /listen\(const std::string &host, int port, MoveOnlyFunction/],
      [
        "packages/bun-uws/src/App.h",
        /listen\(MoveOnlyFunction<void\(us_listen_socket_t \*\)> &&handler, std::string_view path/,
      ],
      ["packages/bun-uws/src/App.h", /UWS_NO_ZLIB/],
      ["packages/bun-uws/src/Http3App.h", /listen\(int port,/],
      ["packages/bun-uws/src/Http3Request.h", /\bisAncient\b|\bgetCaseSensitiveMethod\b/],
      [
        "packages/bun-uws/src/Http3Response.h",
        /\bsetWriteOffset\b|\bprepareForSendfile\b|\bisConnectRequest\b|\bgetNativeHandle\b/,
      ],
      ["packages/bun-uws/src/Http3ResponseData.h", /\btotalSize\b/],
      ["packages/bun-uws/src/Loop.h", /\bintegrate\b|\bsetSilent\b/],
      ["packages/bun-uws/src/LoopData.h", /\bnoMark\b/],
      // Bun always builds with zlib and libdeflate; the mock streams and the
      // UWS_USE_LIBDEFLATE toggle (defined unconditionally in this header) were
      // constant-folded away in every build.
      ["packages/bun-uws/src/PerMessageDeflate.h", /UWS_NO_ZLIB|UWS_MOCK_ZLIB|UWS_USE_LIBDEFLATE/],
    ]),
  ).toEqual([]);
});

test("native BufferList wiring does not reappear", () => {
  expect(
    resurrected([
      ["src/jsc/bindings/ZigGlobalObject.h", /JSBufferList/],
      ["src/jsc/bindings/ZigGlobalObject.cpp", /JSBufferList/],
      ["src/jsc/bindings/webcore/DOMIsoSubspaces.h", /m_subspaceForBufferList\b/],
      ["src/jsc/bindings/webcore/DOMClientIsoSubspaces.h", /m_clientSubspaceForBufferList\b/],
    ]),
  ).toEqual([]);
});

test("dead built-in JS helpers do not reappear", () => {
  expect(
    resurrected([
      // QuicStream[kSendHeaders] had no caller; the public header methods call
      // the native handle directly.
      ["src/js/internal/quic/quic.ts", /\bkSendHeaders\b/],
      ["src/js/internal/quic/symbols.ts", /\bkSendHeaders\b/],
      ["src/js/internal/quic/quic.ts", /get \[kVerifyPeer\]\(\)/],
      // colors.ts consumers only read white/red/green/blue/hasColors
      ["src/js/internal/util/colors.ts", /\byellow\b|\bgray\b|\bclear\b|\breset\b/],
      // repl.js takes the modes from internal/repl/mode, not from utils. utils.js
      // still uses REPL_MODE_STRICT internally, so only the sloppy one is pinned.
      ["src/js/internal/repl/utils.js", /\bREPL_MODE_SLOPPY\b/],
      // SSLMode is only ever imported as a type
      ["src/js/internal/sql/shared.ts", /^\s+SSLMode,$/m],
      ["src/js/internal/fifo.ts", /\bclear\(\)/],
      ["src/js/internal/assert/assertion_error.ts", /\binterface Diff\b|\benum Operation\b/],
      // The write-only Server property; the cluster code's local `listeningId` is unrelated.
      ["src/js/node/net.ts", /this\.listeningId\b/],
      ["src/js/node/util.ts", /node-inspect-extracted/],
      // Bun.fs() and its watcher types no longer exist
      [
        "src/js/private.d.ts",
        /\bBunFS\b|\bBunFSWatcher\b|\bBunFSWatchOptions\b|\bBunWatchEventType\b|\bBunWatchListener\b/,
      ],
      ["src/js/private.d.ts", /\bvar TOML\b|\bvar tty\b/],
    ]),
  ).toEqual([]);
});

test('unreferenced Rust extern "C" exports do not reappear', () => {
  expect(
    resurrected([
      // Neither is declared or called from C++ (BunAnalyzeTranspiledModule.cpp
      // frees through zig__ModuleInfoDeserialized__deinit), nor from WebKit.
      ["src/bundler/analyze_transpiled_module.rs", /\bzig__ModuleInfo__destroy\b|\bzig_log\b/],
    ]),
  ).toEqual([]);
});
