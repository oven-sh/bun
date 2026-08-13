// Guards against reintroduction of code removed as dead: the transferable-streams
// scaffolding in the WebCore streams bindings, the TextEncoder impl stubs, the
// JSKeyObject base-class allocation helpers, the unreachable "deprecated reply"
// ServerResponse path in node:http, unused bun_sys / lsquic_sys / spawn_sys /
// tcc_sys wrappers, stale hawk.toml overrides, and a set of orphaned files
// (Zig-era misctools, an unreferenced ncrypto.patch, stray fixtures). Every entry
// was verified to have zero references across src/, scripts/, packages/, test/
// and the generated build/debug/codegen/ output before deletion, and the removal
// was validated with a full `bun bd` build plus `cargo check --workspace` on the
// linux / darwin / windows / freebsd / android / musl targets.
//
// This is a source-tree lint: it reads files from the repository and does not
// touch the built binary, so it belongs in test/internal/source-lints/.
//
// The Rust and C++ content checks read the working tree; the deleted-file check
// reads the committed tree (HEAD), because `git stash` round-trips can
// temporarily restore files a branch deletes (see dead-code-escapes.test.ts).

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

test("transferable-streams scaffolding and other dead C++ bindings do not reappear", () => {
  expect(
    resurrected([
      // JSCrossRealmTransformState was never created: Bun's structured clone never
      // transfers a stream, so the cell, its per-global Structure slot, its iso
      // subspaces and the [[Detached]] bitfields had no readers.
      ["src/jsc/bindings/webcore/streams/JSStreamsRuntime.h", /crossRealmTransformStateStructure/],
      ["src/jsc/bindings/webcore/streams/JSStreamsRuntime.cpp", /JSCrossRealmTransformState/],
      ["src/jsc/bindings/webcore/DOMIsoSubspaces.h", /m_subspaceForCrossRealmTransformState/],
      ["src/jsc/bindings/webcore/DOMClientIsoSubspaces.h", /m_clientSubspaceForCrossRealmTransformState/],
      ["src/jsc/bindings/webcore/streams/JSReadableStream.h", /\bm_detached\b|\bm_nativeType\b/],
      ["src/jsc/bindings/webcore/streams/JSTransformStream.h", /\bm_detached\b/],
      ["src/jsc/bindings/webcore/streams/JSWritableStream.h", /\bm_detached\b/],
      // $bunNativeType / $disturbed were installed on ReadableStream.prototype but no
      // builtin or C++ caller ever read them ($bunNativePtr is the one still in use).
      ["src/jsc/bindings/webcore/streams/JSReadableStream.cpp", /bunNativeTypePrivateName|disturbedPrivateName/],
      ["src/js/builtins/BunBuiltinNames.h", /macro\((bunNativeType|disturbed)\)/],
      // TextEncoder::encode / encodeInto are implemented by the Rust TextEncoder__*
      // exports; the WebCore impl stubs and the EncodeIntoResult dictionary
      // converters were never called.
      ["src/jsc/bindings/webcore/TextEncoder.h", /EncodeIntoResult|\bencodeInto\b/],
      ["src/jsc/bindings/webcore/JSTextEncoder.h", /EncodeIntoResult/],
      ["src/jsc/bindings/webcore/JSTextEncoder.cpp", /convertDictionary(ToJS)?<?.*EncodeIntoResult/],
      // Every KeyObject is one of the three concrete subclasses, which define their
      // own create()/subspaceFor(); the base-class versions were unreachable.
      ["src/jsc/bindings/node/crypto/JSKeyObject.h", /static JSKeyObject\* create\b|m_subspaceForJSKeyObject/],
      ["src/jsc/bindings/webcore/DOMIsoSubspaces.h", /m_subspaceForJSKeyObject\b/],
      ["src/jsc/bindings/WriteBarrierList.h", /\blist\(\)/],
      ["src/jsc/bindings/Weak.cpp", /WeakRefFinalizeFn/],
      ["src/jsc/bindings/root.h", /JSC_(MAC|IOS)_VERSION_TBA/],
      // The Bun__resolve host export had no C++ or JS caller (only Bun__resolveSync
      // and its variants are used).
      ["src/jsc/bindings/ImportMetaObject.h", /\bBun__resolve\(/],
      ["src/runtime/api/BunObject.rs", /HOST_EXPORT\(Bun__resolve,|\bfn bun_resolve\b/],
    ]),
  ).toEqual([]);
});

test("the deprecated-reply ServerResponse path stays out of node:http", () => {
  // internal/http's kDeprecatedReplySymbol is a module-private Symbol() that nothing
  // ever set on a response's options, so the constructor branch that installed the
  // fetch-Response based write()/end() (and everything only it reached) was unreachable.
  expect(
    resurrected([
      ["src/js/node/_http_server.ts", /kDeprecatedReplySymbol/],
      ["src/js/node/_http_server.ts", /ServerResponse_(write|final)Deprecated/],
      ["src/js/node/_http_server.ts", /\bensureReadableStreamController\b/],
      ["src/js/node/_http_server.ts", /\bdrainHeadersIfObservable\b/],
      ["src/js/node/_http_server.ts", /\bemitRequestCloseNT\b/],
      // The HTTPS flag in internal/http lost its last reader; saving and restoring
      // it around request dispatch had no effect.
      ["src/js/node/_http_server.ts", /IsNextIncomingMessageHTTPS/],
    ]),
  ).toEqual([]);
});

test("dead Rust wrappers do not reappear", () => {
  expect(
    resurrected([
      // bun_sys: callers go through sys_uv on Windows (node_fs) or call libc
      // directly, leaving these platform arms unreachable on every target.
      ["src/sys/lib.rs", /\bpub fn link\(/],
      ["src/sys/lib.rs", /\bpub fn fdatasync\(/],
      ["src/sys/lib.rs", /\bpub fn sendfile\(src: Fd, _dest: Fd, _len: usize\)/],
      ["src/sys/lib.rs", /sys_uv::(fchown|chmod|chown|link|fsync|fdatasync|lchown)\(/],
      ["src/sys/lib.rs", /uv_fs_lutime\(|SetFileTime\(|link\(s_abs, d_abs\)|chmod\(abs, mode\)/],
      // the `bun.c` raw-syscall mirrors (the typed kqueue()/kevent wrappers elsewhere
      // in the file are live)
      ["src/sys/lib.rs", /`bun\.c\.kqueue`|`bun\.c\.kevent`|\bpub unsafe fn fork\(\)/],
      ["src/sys/lib.rs", /\bpub fn sysctlbyname\(/],
      ["src/sys/lib.rs", /\bpub unsafe fn write\(fd: c_int/],
      ["src/sys/lib.rs", /\bpub fn get_fd_path_w\(_fd/],
      ["src/sys/lib.rs", /\bpub type Errno = super::E;/],
      ["src/sys/linux_syscall.rs", /\bfn write_raw\b/],
      ["src/sys/windows/mod.rs", /\bfn timespec_to_filetime\b/],
      // lsquic_sys: node:quic drives the engine through the raw extern fns; the
      // Engine wrapper and these Conn accessors had no callers.
      ["src/lsquic_sys/lib.rs", /\bpub struct Engine\b/],
      ["src/lsquic_sys/lib.rs", /\bfn (global_init|enable_logging|n_avail_streams|earliest_adv_tick)\b/],
      ["src/lsquic_sys/lib.rs", /\bLSQVER_I00[12]\b/],
      ["src/spawn_sys/spawn_process.rs", /\bpub fn close\(&mut self\)|\bpub fn pifd_from_pid\b/],
      ["src/tcc_sys/tcc.rs", /\bfn (tcc_)?run\b/],
      // hawk.toml overrides for enum variants deleted in #36833.
      ["hawk.toml", /bun_platform|darwin::Category::/],
    ]),
  ).toEqual([]);
});

test("orphaned files stay deleted", () => {
  const gone = [
    // Zig standard-library gdb pretty printers and a generator that emitted Zig
    // source; the repository no longer contains any Zig.
    "misctools/gdb/std_gdb_pretty_printers.py",
    "misctools/mime.js",
    "misctools/.gitignore",
    // one-off diff against Node's ncrypto from #17692; not applied by any build
    // step (every other file under patches/ is) and long out of date
    "patches/ncrypto.patch",
    // stray `--metafile` output committed by accident
    "meta.json",
    // 2021 single-folder VS Code workspace with Zig settings; .vscode/ is the live config
    "workspace.code-workspace",
    // unreferenced fixture committed next to the v8 bindings
    "src/jsc/bindings/v8-capture-stack-fixture.cjs",
    // WebKit make_event_factory.pl input; Bun's EventNames.h is hand-written
    "src/jsc/bindings/webcore/EventNames.in",
    // prebuilt archive superseded by the embedded libtcc1.c
    "src/runtime/ffi/libtcc1.a.macos-aarch64",
    // demo component that its own header says the client never uses, plus its stylesheet
    "src/runtime/bake/client/JavaScriptSyntaxHighlighterComponent.tsx",
    "src/runtime/bake/client/JavaScriptSyntaxHighlighter.css",
    // upload-npm.ts ships placeholder bins and bundles only npm-postinstall.ts
    "packages/bun-release/scripts/npm-exec.ts",
    // upstream uSockets leftovers (same class as the bun-uws/misc files)
    "packages/bun-usockets/misc/manual.md",
    "packages/bun-usockets/misc/gen_test_certs.sh",
    "packages/bun-usockets/misc/layout.png",
    "packages/bun-usockets/module.modulemap",
    // the streams/TextEncoder C++ removed above
    "src/jsc/bindings/webcore/streams/JSCrossRealmTransformState.cpp",
    "src/jsc/bindings/webcore/streams/JSCrossRealmTransformState.h",
    "src/jsc/bindings/webcore/TextEncoder.cpp",
  ];
  const tree = headTree();
  expect(gone.filter(p => tree.has(p))).toEqual([]);
});
