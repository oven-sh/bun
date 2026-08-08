// Guards against reintroduction of symbols removed as dead code from
// bun_uws_sys (unused C API wrappers and their Rust declarations), the
// C++ JSC bindings (DOMConstructors entries, stray macros and forward
// declarations), bun_crash_handler (the error-return-trace apparatus,
// which Rust cannot produce), bun_collections, the bun:sql builtin, and the
// retired scripts/clippy-loop tooling.
// Each entry was verified to have zero references across src/, scripts/,
// test/, vendor/, and regenerated build/debug/codegen/ output before deletion,
// and the removal was validated by `cargo check` on all 10 CI target triples
// plus a full `bun bd` build.
//
// This is a source-tree lint: it reads files from src/ and does not touch the
// built binary, so it belongs in test/internal/source-lints/ per the README.
//
// The Rust checks read the working tree. The C++/JS checks read the committed
// tree (HEAD) instead: `git stash` round-trips can temporarily restore files a
// branch deletes (see the same note in dead-code-escapes.test.ts), and those
// strays must not fail the lint. CI runs against the committed tree, so HEAD
// is what matters.

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

function existsInHead(p: string): boolean {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", repoRoot, "ls-tree", "--name-only", "HEAD", "--", p],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0) {
    throw new Error(`git ls-tree HEAD -- ${p} failed: ${r.stderr.toString()}`);
  }
  return r.stdout.toString().trim().length > 0;
}

test("dead Rust symbols (uws_sys, crash_handler, collections) do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // uws_sys: extern declarations whose C side had no callers, and safe
    // wrappers nothing invoked (the *_with_options counterparts are the live
    // paths).
    ["src/uws_sys/WebSocket.rs", /uws_ws_send_fragment|uws_ws_send_first_fragment|uws_ws_get_remote_address_as_text/],
    ["src/uws_sys/Response.rs", /override_write_offset/],
    ["src/uws_sys/h3.rs", /override_write_offset/],
    ["src/uws_sys/Loop.rs", /add_pre_handler|add_post_handler|uws_loop_addPreHandler|uws_loop_addPostHandler/],
    ["src/uws_sys/socket.rs", /\bfrom_named_pipe\b/],
    ["src/uws_sys/lib.rs", /us_fault_clear\b|LIBUS_LISTEN_DISALLOW_REUSE_PORT_FAILURE/],
    // crash_handler: error-return tracing is a Zig feature Rust has no
    // equivalent of; the whole reporting path was unreachable behind a
    // `const false`.
    [
      "src/crash_handler/lib.rs",
      /cold_handle_error_return_trace|handle_error_return_trace_extra|VERBOSE_ERROR_TRACE|HAVE_ERROR_RETURN_TRACING/,
    ],
    // Nothing Display-formats a StackLine (the symbolizer formats its
    // .address field directly).
    ["src/crash_handler/lib.rs", /impl fmt::Display for StackLine/],
    // handle_oom arms for crate::Error / bare AllocError: the only importer
    // (js_parser scan_imports) threads Result<T, AllocError>.
    ["src/crash_handler/handle_oom.rs", /impl HandleOom for (Error|AllocError)|Result<T, Error>/],
    // The --verbose-error-trace debug flag only fed the deleted trace path.
    ["src/runtime/cli/Arguments.rs", /verbose-error-trace|maybe_verbose_error_trace/],
    // All PriorityQueue construction goes through ::init.
    ["src/collections/lib.rs", /impl<T, C: Default> Default for PriorityQueue/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("dead uws_sys C wrappers do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // Wrappers with no Rust-side declaration (or an unused one); the
    // `(`-anchored patterns deliberately miss the live *_with_options names.
    [
      "src/uws_sys/libuwsockets.cpp",
      /uws_ws_send\(|uws_ws_publish\(|uws_app_listen_domain\(|uws_add_server_name\(|uws_remove_server_name\(|uws_missing_server_name\(/,
    ],
    [
      "src/uws_sys/libuwsockets.cpp",
      /uws_constructor_failed|uws_get_native_handle|uws_res_get_write_offset|uws_res_override_write_offset|uws_res_get_socket_data/,
    ],
    [
      "src/uws_sys/libuwsockets.cpp",
      /uws_req_is_ancient|uws_req_get_yield|uws_req_for_each_header|uws_req_get_query|uws_loop_addPostHandler|uws_loop_removePostHandler|uws_loop_removePreHandler/,
    ],
    [
      "src/uws_sys/libuwsockets_h3.cpp",
      /uws_h3_constructor_failed|uws_h3_get_native_handle|uws_h3_res_get_write_offset|uws_h3_res_override_write_offset|uws_h3_res_uncork|uws_h3_res_is_corked|uws_h3_req_for_each_header|uws_h3_req_get_query/,
    ],
    // Handler typedefs only the deleted wrappers used.
    ["src/uws_sys/_libusockets.h", /uws_missing_server_handler|uws_get_headers_server_handler/],
  ];
  const resurrected = checks
    .filter(([file, re]) => re.test(headFile(file)))
    .map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("dead C++ bindings do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // DOMConstructors.h is trimmed to the constructors bun actually wires;
    // these are sentinels for the ~800 WebKit-inherited entries.
    ["src/jsc/bindings/webcore/DOMConstructors.h", /^\s*(Touch|ApplePaySession|GPUDevice|WebKitMediaKeys),$/m],
    ["src/jsc/bindings/webcore/DOMConstructors.h", /numberOfDOMConstructorsBase|bunExtraConstructors/],
    ["src/jsc/bindings/napi.h", /NAPI_PERISH/],
    ["src/jsc/bindings/dh-primes.h", /OPENSSL_ARRAY_SIZE/],
    ["src/jsc/bindings/JSDOMWrapper.h", /hasCustomPtrTraits/],
    ["src/jsc/bindings/webcore/JSPerformance.h", /class JSPerformanceObject;/],
    ["src/jsc/bindings/webcore/SerializedScriptValue.h", /class MemoryHandle;|class FragmentedSharedBuffer;/],
    ["src/jsc/bindings/node/crypto/KeyObject.h", /createJwk/],
    // Commented-out $create*Error helpers native code never called.
    ["src/js/bun/sql.ts", /\$createPostgresError|\$createSQLiteError|\$createSQLError/],
  ];
  const resurrected = checks
    .filter(([file, re]) => re.test(headFile(file)))
    .map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("deleted files stay deleted", () => {
  const gone = [
    // Orphan LLVM bitcode blob with no build-system reference.
    "src/base64/neonbase64",
    // One-shot tooling for the completed 2026-05 clippy campaign.
    "scripts/clippy-loop/harvest.ts",
    "scripts/clippy-loop/collect.sh",
    "scripts/clippy-loop/apply-patches.ts",
  ];
  expect(gone.filter(existsInHead)).toEqual([]);
});
