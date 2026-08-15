// Guards against reintroduction of symbols removed as dead code from the
// FFI declaration crates (mimalloc/cares/lsquic/zlib/libuv/brotli/boringssl/
// libdeflate/windows_sys), bun_core, test_runner, and the built-in JS/codegen
// sources. Each entry was verified to have zero references across src/,
// scripts/, test/, and freshly regenerated build/debug/codegen/ output before
// deletion, and the removal was validated by `cargo check` on all 10 CI
// target triples plus a full `bun bd` build.
//
// This is a source-tree lint: it reads files from src/ and does not touch the
// built binary, so it belongs in test/internal/source-lints/ per the README.
//
// The Rust checks read the working tree. The deleted-file and JS/C++ content
// checks read the committed tree (HEAD) instead: `git stash` round-trips can
// temporarily restore files a branch deletes (see the same note in
// dead-code-escapes.test.ts), and those strays must not fail the lint. CI
// runs against the committed tree, so HEAD is what matters.

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

test("dead FFI declarations (sys crates) do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // windows_sys — unused Win32 imports and the never-constructed WinsockError
    // cluster (~100 WSA* consts); bun reports winsock errors via bun_errno.
    ["src/windows_sys/externs.rs", /\bfn GetBinaryTypeW\b/],
    ["src/windows_sys/externs.rs", /\bfn CreateJobObjectW\b/],
    ["src/windows_sys/externs.rs", /\bstruct WinsockError\b/],
    ["src/windows_sys/externs.rs", /\bWSA_QOS_ESHAPERATEOBJ\b/],
    // mimalloc_sys — ~100 unused declarations (heap-local variants, stats,
    // options, posix shims); bun only uses the small hot subset.
    ["src/mimalloc_sys/mimalloc.rs", /\bfn mi_stats_print\b/],
    ["src/mimalloc_sys/mimalloc.rs", /\bfn mi_reserve_huge_os_pages_interleave\b/],
    ["src/mimalloc_sys/mimalloc.rs", /\bfn mi_heap_recalloc_aligned_at\b/],
    ["src/mimalloc_sys/mimalloc.rs", /\bfn mi_wdupenv_s\b/],
    // zlib_sys/win32 — unused gz* file API and introspection entry points.
    ["src/zlib_sys/win32.rs", /\bfn gzprintf\b/],
    ["src/zlib_sys/win32.rs", /\bfn inflateUndermine\b/],
    ["src/zlib_sys/win32.rs", /\bfn deflateTune\b/],
    // cares_sys — unused configuration/parsing surface.
    ["src/cares_sys/c_ares.rs", /\bfn ares_mkquery\b/],
    ["src/cares_sys/c_ares.rs", /\bfn ares_set_sortlist\b/],
    ["src/cares_sys/c_ares.rs", /\bstruct struct_ares_addr_node\b/],
    // lsquic_sys — unused handshake-status consts and stream-ctx helpers.
    ["src/lsquic_sys/lib.rs", /\bfn lsquic_stream_is_pushed\b/],
    ["src/lsquic_sys/lib.rs", /\bLSCONN_ST_PEER_GOING_AWAY\b/],
    // libdeflate_sys / brotli_sys / boringssl_sys
    ["src/libdeflate_sys/libdeflate.rs", /\bfn libdeflate_gzip_decompress\b/],
    ["src/brotli_sys/brotli_c.rs", /\bfn BrotliEncoderEstimatePeakMemoryUsage\b/],
    ["src/boringssl_sys/boringssl.rs", /\bfn TLS_with_buffers_method\b/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("dead Rust symbols (bun_core, jsc, test_runner) do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // BuildTarget::Wasi was never constructed (BUILD_TARGET is Native or Wasm).
    ["src/bun_core/env.rs", /\bWasi\b/],
    ["src/bun_core/env.rs", /\bIS_WASI\b/],
    // Rust-side imports of HTTPServerAgent notify hooks that no Rust code calls.
    ["src/jsc/HTTPServerAgent.rs", /\bBun__HTTPServerAgent__notifyRequestWillBeSent\b/],
    // throw2 + its carrier trait duplicated JSGlobalObject::throw_error.
    ["src/runtime/test_runner/mod.rs", /\btrait JSGlobalObjectTestExt\b/],
    ["src/runtime/test_runner/mod.rs", /\bfn throw2\b/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("orphaned files stay deleted", () => {
  const gone = [
    // never registered in src/resolver/node_fallbacks.rs's 23-module registry
    "src/node-fallbacks/timers.promises.js",
    // process.binding("crypto/x509") is implemented natively in BunProcess.cpp
    "src/js/internal/crypto/x509.ts",
    // unreferenced fixtures from the 2021-era inline zlib tests
    "src/zlib.test.txt",
    "src/zlib.test.gz",
    // the dev error page template lives at src/runtime/server/dev-error-page.html
    "src/fallback.html",
    "src/fixtures_example.com.html",
    "src/logo.svg",
    "src/favicon.png",
  ];
  const tree = headTree();
  const resurrected = gone.filter(p => tree.has(p));
  expect(resurrected).toEqual([]);
});

test("dead JS/codegen helpers do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/js/internal/validators.ts", /\bfunction validateUndefined\b/],
    // C++ host functions whose only callers were the removed $newCppFunction bindings
    ["src/jsc/bindings/NodeValidator.cpp", /jsFunction_validate(SignalName|PlainFunction|Undefined)\b/],
    ["src/codegen/helpers.ts", /\bfunction camelCase\b/],
    ["src/codegen/helpers.ts", /\bfunction pascalCase\b/],
    ["src/codegen/replacements.ts", /\bwarnOnIdentifiersNotPresentAtRuntime\b/],
    ["src/codegen/generate-classes.ts", /\bDOMJITReturnType\b/],
    ["src/codegen/generate-js2native.ts", /\bfunction cppPointer\b/],
    ["scripts/build/flags.ts", /\bfunction explainFlags\b/],
    ["scripts/build/error.ts", /\bfunction assertDefined\b/],
    ["scripts/build/source.ts", /\bfunction depSourceStamp\b/],
  ];
  const resurrected = checks
    .filter(([file, re]) => re.test(headFile(file)))
    .map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("stale commented-out C++ blocks stay deleted", () => {
  const checks: Array<[string, RegExp]> = [
    // minicoro scaffolding commented out since 2022; Bun__startMacro calls ctx() directly
    ["src/jsc/bindings/coroutine.cpp", /mco_create/],
    // pasted JS source of Node's getFlags() above the C++ reimplementation
    ["src/jsc/bindings/JSX509CertificatePrototype.cpp", /X509_CHECK_FLAG_ALWAYS_CHECK_SUBJECT/],
    // commented BINDING_INTEGRITY vtable checks (2024)
    ["src/jsc/bindings/webcore/JSCustomEvent.cpp", /expectedVTablePointer/],
    ["src/jsc/bindings/webcore/JSPerformanceServerTiming.cpp", /expectedVTablePointer/],
    // whole commented mainThreadNormalWorld() (2022)
    ["src/jsc/bindings/DOMWrapperWorld.cpp", /mainThreadNormalWorld/],
  ];
  const resurrected = checks
    .filter(([file, re]) => re.test(headFile(file)))
    .map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});
