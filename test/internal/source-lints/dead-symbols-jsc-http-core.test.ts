// Guards against reintroduction of symbols removed as dead code from the
// bun_jsc FFI glue, the C++ require.extensions registered-functions vector,
// bun_core, bun_http_types, the websocket deflate error enums, and the
// write-only `[bundle].packages` bunfig cluster. Each entry was verified to
// have zero references across src/, scripts/, and freshly regenerated
// build/debug/codegen/ output before deletion, and the removal was validated
// by `cargo check` on all 10 CI target triples plus a full `bun bd` build.
//
// This is a source-tree lint: it reads files from src/ and does not touch the
// built binary, so it belongs in test/internal/source-lints/ per the README.
//
// The Rust checks read the working tree. The C++/deleted-file checks read the
// committed tree (HEAD) instead: `git stash` round-trips can temporarily
// restore files a branch deletes (see the same note in
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

test("dead Rust symbols (bun_jsc FFI glue) do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // DeprecatedStrong::unref: never called (sole user test_runner/Collection.rs
    // uses init + Drop only).
    ["src/jsc/DeprecatedStrong.rs", /pub fn unref\b/],
    // Unused extern "C" imports of C++ fns with zero Rust call sites; the
    // C++ definitions were removed with them (see the HEAD checks below).
    ["src/jsc/NodeModuleModule.rs", /JSCommonJSExtensions__(appendFunction|setFunction|swapRemove)/],
    // Exported fns with zero C++ callers (the only cross-references were
    // stale header prototypes, removed in the same change).
    ["src/jsc/ZigString.rs", /\bZigString__free\b/],
    ["src/jsc/JSGlobalObject.rs", /\bZig__GlobalObject__reportUncaughtException\b/],
    ["src/jsc/AbortSignal.rs", /\bAbortSignal__Timeout__run\b/],
    ["src/jsc/resolver_jsc.rs", /\bResolver__propForRequireMainPaths\b/],
  ];
  for (const [file, re] of checks) {
    expect(src(file)).not.toMatch(re);
  }
});

test("dead Rust symbols (bun_core, http_types, websocket, webcore, perf) do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // fmt::raw: shorthand constructor duplicating `s()`, zero callers.
    ["src/bun_core/fmt.rs", /^pub const fn raw\b/m],
    // `bun_core::schema` wrapper module: zero users (everyone imports the
    // flattened `bun_core::StringPointer`).
    ["src/bun_core/lib.rs", /^pub mod schema\b/m],
    // Feature counter never incremented or read by analytics.
    ["src/bun_core/Global.rs", /\bNAPI_MODULE_REGISTER\b/],
    // Outbound-only FrameType variants a client never sends (inbound dispatch
    // is on raw u8, so they cannot become live for parsing).
    ["src/http_types/h2.rs", /HTTP_FRAME_(ALTSVC|ORIGIN)\b/],
    // Never-constructed OutOfMemory variants of the websocket deflate errors
    // (compress/decompress return only DeflateFailed / InflateFailed+TooLarge).
    ["src/http_jsc/websocket_client/WebSocketDeflate.rs", /\bOutOfMemory\b/],
    // No-op vestige whose body was emptied in 85534281c6.
    ["src/runtime/webcore/ReadableStream.rs", /\bdetach_if_possible\b/],
    // WASM stub method with no counterpart in the real (non-WASM) Timer impl,
    // so no portable caller can exist.
    ["src/perf/system_timer.rs", /pub fn lap\b/],
  ];
  for (const [file, re] of checks) {
    expect(src(file)).not.toMatch(re);
  }
});

test("write-only [bundle].packages bunfig cluster does not reappear", () => {
  // BundlePackage enum + DebugOptions::package_bundle_map were written by the
  // bunfig parser and read by nothing.
  const checks: Array<[string, RegExp]> = [
    ["src/options_types/bundle_enums.rs", /\bBundlePackage\b/],
    ["src/options_types/context.rs", /\bpackage_bundle_map\b/],
    ["src/options_types/lib.rs", /\bBundlePackage\b/],
    ["src/bunfig/bunfig.rs", /\bpackage_bundle_map\b/],
    ["src/bundler/options.rs", /\bBundlePackage\b/],
  ];
  for (const [file, re] of checks) {
    expect(src(file)).not.toMatch(re);
  }
});

test("dead C++ symbols and stale header prototypes do not reappear (HEAD)", () => {
  // The require.extensions m_registeredFunctions vector: its three extern "C"
  // writers had their Rust imports deleted, making the member and its GC-visit
  // loop dead with them.
  expect(headFile("src/jsc/bindings/JSCommonJSExtensions.cpp")).not.toMatch(
    /JSCommonJSExtensions__(appendFunction|setFunction|swapRemove)|m_registeredFunctions/,
  );
  expect(headFile("src/jsc/bindings/JSCommonJSExtensions.h")).not.toMatch(/m_registeredFunctions/);
  // Stale prototypes for the removed Rust exports.
  expect(headFile("src/jsc/bindings/headers-handwritten.h")).not.toMatch(/\bZigString__free\b/);
  expect(headFile("src/jsc/bindings/headers.h")).not.toMatch(/\bZig__GlobalObject__reportUncaughtException\b/);
  expect(headFile("src/jsc/bindings/JSCommonJSModule.cpp")).not.toMatch(/\bResolver__propForRequireMainPaths\b/);
});

test("orphan data file stays deleted (HEAD)", () => {
  // mime_type_list.txt: 2309-line list fully duplicated by the hand-maintained
  // table in mime_type_list_enum.rs; not read by any build step (absent from
  // cargo dep-info), referenced only by two doc comments, both updated.
  expect(headTree().has("src/http_types/mime_type_list.txt")).toBe(false);
});
