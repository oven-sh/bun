// Guards against reintroduction of symbols removed as dead code in the
// linker-driven sweep: the debug binary was relinked with
// `--gc-sections --print-gc-sections`, every function the linker discarded was
// cross-checked for textual references across src/, packages/, scripts/ and
// freshly regenerated build/debug/codegen/ output, and the survivors were
// deleted together with their declarations and Rust-side FFI wrappers. The
// removal was validated by `cargo check` on all CI target triples plus a full
// `bun bd` build.
//
// This is a source-tree lint: it reads files from the repository and does not
// touch the built binary, so it belongs in test/internal/source-lints/ per the
// README. It reads the committed tree (HEAD) rather than the working tree:
// `git stash` round-trips can temporarily restore files a branch deletes (see
// the same note in dead-code-escapes.test.ts), and those strays must not fail
// the lint. CI runs against the committed tree, so HEAD is what matters.

import { expect, test } from "bun:test";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

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

function resurrected(checks: Array<[string, RegExp]>): string[] {
  const cache = new Map<string, string>();
  const read = (file: string) => {
    let text = cache.get(file);
    if (text === undefined) {
      text = headFile(file);
      cache.set(file, text);
    }
    return text;
  };
  return checks.filter(([file, re]) => re.test(read(file))).map(([file, re]) => `${file}: ${re.source}`);
}

test("dead node:crypto helpers (CryptoUtil, ncrypto) do not reappear", () => {
  expect(
    resurrected([
      // Key parsing helpers superseded by the ThrowScope-taking overloads.
      ["src/jsc/bindings/node/crypto/CryptoUtil.h", /\bkeyFromString\b/],
      ["src/jsc/bindings/node/crypto/CryptoUtil.h", /\bparseKeyFormat\b/],
      ["src/jsc/bindings/node/crypto/CryptoUtil.h", /\bparseKeyType\b/],
      ["src/jsc/bindings/node/crypto/CryptoUtil.h", /\bpassphraseFromBufferSource\b/],
      ["src/jsc/bindings/node/crypto/CryptoUtil.h", /\bfromBIO\b/],
      ["src/jsc/bindings/node/crypto/CryptoUtil.h", /static ByteSource foreign\b/],
      // RSA raw encrypt/decrypt: the live path is Cipher::encrypt/decrypt.
      ["src/jsc/bindings/ncrypto.cpp", /\bRSA_Cipher\b/],
      ["src/jsc/bindings/ncrypto.cpp", /\bRsa::(encrypt|decrypt)\b/],
      ["src/jsc/bindings/ncrypto.h", /\bsetRsaMgf1Md\b/],
      // Cipher enumeration: node_crypto_binding.cpp calls EVP_CIPHER_do_all_sorted directly.
      ["src/jsc/bindings/ncrypto.h", /\bCipherNameCallback\b/],
      ["src/jsc/bindings/ncrypto.cpp", /\bCipher::ForEach\b/],
      // scrypt/pbkdf2 run through the Rust bindings; these C++ wrappers had no callers.
      ["src/jsc/bindings/ncrypto.h", /\bcheckScryptParams\b/],
      ["src/jsc/bindings/ncrypto.h", /DataPointer scrypt\(/],
      ["src/jsc/bindings/ncrypto.h", /DataPointer pbkdf2\(/],
      ["src/jsc/bindings/ncrypto.h", /\bifRsa\b/],
      ["src/jsc/bindings/ncrypto.h", /\bifEc\b/],
      ["src/jsc/bindings/ncrypto.h", /\bisOne\b/],
      ["src/jsc/bindings/ncrypto.h", /\bNewFp\b/],
    ]),
  ).toEqual([]);
});

test("dead JSC/WebCore binding helpers do not reappear", () => {
  expect(
    resurrected([
      // Request-level inspector notifications; the Rust callers were removed earlier.
      ["src/jsc/bindings/InspectorHTTPServerAgent.h", /\brequestWillBeSent\b/],
      ["src/jsc/bindings/InspectorHTTPServerAgent.h", /\bresponseReceived\b/],
      ["src/jsc/bindings/InspectorHTTPServerAgent.h", /\bbodyChunkReceived\b/],
      ["src/jsc/bindings/InspectorHTTPServerAgent.h", /\brequestFinished\b/],
      ["src/jsc/bindings/InspectorHTTPServerAgent.h", /\brequestHandlerException\b/],
      ["src/jsc/bindings/ScriptExecutionContext.h", /\bensureOnMainThread\b/],
      ["src/jsc/bindings/ScriptExecutionContext.h", /^ScriptExecutionContext\* executionContext\(/m],
      ["src/jsc/bindings/ErrorStackTrace.h", /\bretrieveTypeName\b/],
      ["src/jsc/bindings/ErrorStackTrace.h", /\bm_typeName\b/],
      // PerformanceResourceTiming is exposed as a constructor but never instantiated natively.
      ["src/jsc/bindings/webcore/PerformanceResourceTiming.h", /static Ref<PerformanceResourceTiming> create\(/],
      ["src/jsc/bindings/webcore/ResourceTiming.h", /\bpopulateServerTiming\b/],
      // Only reachable from the never-instantiated RejectPromise branch of IDLAttribute::get.
      ["src/jsc/bindings/JSDOMExceptionHandling.h", /\brejectPromiseWithGetterTypeError\b/],
      ["src/jsc/bindings/webcore/JSDOMAttribute.h", /\brejectPromiseWithGetterTypeError\b/],
      // Nothing ever registered a JSErrorHandler attribute listener.
      ["src/jsc/bindings/webcore/EventTarget.cpp", /\bJSErrorHandler\b/],
      ["src/jsc/bindings/webcore/EventEmitter.cpp", /\bJSErrorHandler\b/],
      // native -> JS conversions of callback interfaces; only the JS -> native direction is used.
      ["src/jsc/bindings/webcore/JSAbortAlgorithm.h", /\bcallbackData\b/],
      ["src/jsc/bindings/webcore/JSAbortAlgorithm.h", /toJS\(AbortAlgorithm/],
      ["src/jsc/bindings/webcore/JSPerformanceObserverCallback.h", /\bcallbackData\b/],
      ["src/jsc/bindings/webcore/JSPerformanceObserverCallback.h", /toJS\(PerformanceObserverCallback/],
      // DOMJIT operations whose signatures were removed in #9457.
      ["src/jsc/bindings/JSBuffer.cpp", /\bjsBufferConstructorAllocWithoutTypeChecks\b/],
      ["src/jsc/bindings/JSBuffer.cpp", /\bjsBufferConstructorAllocUnsafeWithoutTypeChecks\b/],
      ["src/jsc/bindings/JSBuffer.cpp", /\bjsBufferConstructorAllocUnsafeSlowWithoutTypeChecks\b/],
    ]),
  ).toEqual([]);
});

test("orphaned files stay deleted", () => {
  const tree = headTree();
  const gone = ["src/jsc/bindings/webcore/JSErrorHandler.cpp", "src/jsc/bindings/webcore/JSErrorHandler.h"];
  expect(gone.filter(p => tree.has(p))).toEqual([]);
});

test("dead uSockets entry points and their Rust wrappers do not reappear", () => {
  const h = "packages/bun-usockets/src/libusockets.h";
  const quic = "packages/bun-usockets/src/quic.h";
  expect(
    resurrected([
      ["src/uws_sys/SocketGroup.rs", /\bus_socket_pair\b/],
      ["src/uws_sys/us_socket_t.rs", /\bus_socket_open\b/],
      ["src/uws_sys/ListenSocket.rs", /\bus_listen_socket_get_fd\b/],
      ["src/uws_sys/quic/Socket.rs", /\bus_quic_socket_close\b/],
      ["src/lsquic_sys/lib.rs", /\bus_nq_spec_peer_ctx\b/],
      [h, /\bus_socket_is_tls\b/],
      [h, /\bus_socket_detach\b/],
      [h, /\bus_connecting_socket_get_loop\b/],
      [h, /\bus_socket_pair\b/],
      [h, /\bus_socket_open\b/],
      [h, /\bus_listen_socket_ext\b/],
      [h, /\bus_listen_socket_port\b/],
      [h, /\bus_listen_socket_get_fd\b/],
      [h, /\bus_socket_group_next\b/],
      [h, /\bus_socket_group_timestamp\b/],
      [h, /\bus_loop_iteration_number\b/],
      [h, /\bus_poll_ext\b/],
      [h, /\bus_listen_socket_find_server_name_userdata\b/],
      [h, /\bus_udp_packet_buffer_local_ip\b/],
      ["packages/bun-usockets/src/internal/networking/bsd.h", /\bbsd_udp_packet_buffer_local_ip\b/],
      [quic, /\bus_quic_pending_connect_user\b/],
      [quic, /\bus_quic_socket_context_on_open\b/],
      [quic, /\bus_quic_stream_flush\b/],
      [quic, /\bus_quic_stream_has_unacked\b/],
      [quic, /\bus_quic_socket_context\b/],
      [quic, /\bus_quic_socket_close\b/],
      ["packages/bun-usockets/src/node_quic_shim.c", /\bus_nq_spec_peer_ctx\b/],
    ]),
  ).toEqual([]);
});

test("unused llhttp API surface does not reappear", () => {
  const h = "src/jsc/bindings/node/http/llhttp/llhttp.h";
  expect(
    resurrected([
      [h, /\bllhttp_alloc\b/],
      [h, /\bllhttp_free\b/],
      [h, /\bllhttp_get_type\b/],
      [h, /\bllhttp_get_http_major\b/],
      [h, /\bllhttp_get_http_minor\b/],
      [h, /\bllhttp_get_method\b/],
      [h, /\bllhttp_get_status_code\b/],
      [h, /\bllhttp_get_upgrade\b/],
      [h, /\bllhttp_reset\b/],
      [h, /\bllhttp_settings_init\b/],
      [h, /\bllhttp_get_errno\b/],
      [h, /\bllhttp_method_name\b/],
      [h, /\bllhttp_status_name\b/],
      ["src/jsc/bindings/node/http/llhttp/api.c", /\bllhttp__debug\b/],
      ["src/jsc/bindings/node/http/llhttp/api.c", /__wasm__/],
    ]),
  ).toEqual([]);
});

test("environment variables nothing reads any more are not re-declared", () => {
  // BUN_NEEDS_PROC_SELF_WORKAROUND, MI_VERBOSE and TODIUM are removed (and pinned) by #35437.
  expect(resurrected([["src/bun_core/env_var.rs", /\bBUN_DUMP_STATE_ON_CRASH\b/]])).toEqual([]);
});
