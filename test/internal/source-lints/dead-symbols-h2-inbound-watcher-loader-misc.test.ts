// Guards against reintroduction of code removed as dead:
//
// - the pre-engine inbound frame path of h2_frame_parser.rs (everything rustc
//   reported once the file-level `allow(dead_code)` was dropped) and the
//   HPACK static-table JSString cache (`Bun::Http2CommonStrings`) whose only
//   reader was that path's header decoder;
// - native class methods no built-in JS calls (QuicSession.silentClose,
//   QuicEndpoint.ref, NodeJSFS.unwatchFile, FSWatcher.hasRef), removed from
//   the .classes.ts declarations together with their Rust implementations;
// - the watcher's write-only `WatchItem.loader` column, the `bun_watcher::Loader`
//   cycle-break newtype that existed only to carry it, and the `loader`
//   parameters that threaded it through every `add_file` caller;
// - `pub` helpers in bun_core, bun_sys, bun_jsc and tcc_sys with no caller in
//   any crate, and `$`-declarations in src/js/builtins.d.ts no built-in uses.
//
// Every Rust removal was validated by `cargo check --workspace` on every CI
// target triple and a full `bun bd` build (which regenerates the class codegen
// that consumed the .classes.ts entries); the builtins.d.ts removals by
// `tsc -p src/js` reporting the same diagnostics before and after.
//
// This is a source-tree lint: it reads files from src/ and does not touch the
// built binary, so it belongs in test/internal/source-lints/ per the README.
// Content checks read the working tree; the deleted-file check reads the
// committed tree (HEAD), because `git stash` round-trips can temporarily
// restore files a branch deletes (see dead-code-escapes.test.ts).

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
  const byFile = new Map<string, string>();
  return checks
    .filter(([file, re]) => {
      let text = byFile.get(file);
      if (text === undefined) byFile.set(file, (text = src(file)));
      return re.test(text);
    })
    .map(([file, re]) => `${file}: ${re.source}`);
}

/** The text from `opener` up to the next line that is exactly `}` (the end of that top-level block). */
function block(text: string, opener: string): string {
  const start = text.indexOf(opener);
  expect(start).toBeGreaterThan(-1);
  const end = text.indexOf("\n}\n", start);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
}

test("h2_frame_parser.rs stays under dead_code = deny", () => {
  const text = src("src/runtime/api/bun/h2_frame_parser.rs");
  // The inner attribute at the top of the file must not suppress dead_code
  // again; rustc is what keeps the retired inbound path from growing back.
  const innerAttrs = text.slice(0, text.indexOf("\nuse "));
  expect(innerAttrs).not.toMatch(/\bdead_code\b/);
});

test("the legacy h2 inbound path does not reappear", () => {
  const h2 = "src/runtime/api/bun/h2_frame_parser.rs";
  const checks: Array<[string, RegExp]> = [
    // The byte reader and frame dispatcher that fed the handlers.
    [h2, /\bfn (read_bytes|dispatch_frame|lookup_inbound_stream)\b/],
    // The per-frame handlers and their payload helper.
    [
      h2,
      /\bfn handle_(incomming_payload|window_update_frame|unknown_frame|push_promise_frame|data_frame|go_away_frame|origin_frame|altsvc_frame|rst_stream_frame|ping_frame|priority_frame|continuation_frame|headers_frame|settings_frame)\b/,
    ],
    [
      h2,
      /\bfn (decode_header_block|finish_headers_end_stream|adjust_window_size|increment_window_size_if_needed|send_settings_ack|dispatch_with_3_extra)\b/,
    ],
    [h2, /\bstruct Payload\b/],
    // Decode-direction wire helpers only those handlers used.
    [h2, /\bfn (u32_from_bytes|from_bytes|update_with)\b|\benum SettingsFlags\b|\btype HeaderValue\b/],
    // FullSettingsPayload lost its wire layout with `write()`: the per-entry
    // type ids, the packed repr, the bytemuck impls and SettingsType went too.
    [h2, /\bstruct (SettingsPayloadUnit|SettingsType)\b|_header_table_size_type|bytemuck::Pod for FullSettingsPayload/],
    // Parser / stream state only the inbound path maintained.
    [h2, /\b(current_frame|remaining_length|expecting_continuation|preface_received_len|read_buffer)\b/],
    [
      h2,
      /\b(is_waiting_more_headers|header_block_size|header_block_count|pending_header_block|pending_header_flags)\b/,
    ],
    // The HPACK static-table JSString cache the decoder read through.
    [h2, /getHTTP2CommonString|get_http2_common_string/],
    ["src/jsc/bindings/ZigGlobalObject.h", /Http2CommonStrings/],
    ["src/jsc/bindings/ZigGlobalObject.cpp", /http2CommonStrings|getHTTP2CommonString/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("orphaned files stay deleted", () => {
  const gone = ["src/jsc/bindings/BunHttp2CommonStrings.h", "src/jsc/bindings/BunHttp2CommonStrings.cpp"];
  const tree = headTree();
  expect(gone.filter(p => tree.has(p))).toEqual([]);
});

test("native methods no built-in JS calls do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/runtime/node/quic/quic.classes.ts", /\bsilentClose\b|fn: "doRef"/],
    ["src/runtime/node/quic/session.rs", /\bfn silent_close\b/],
    ["src/runtime/node/quic/endpoint.rs", /\bfn do_ref\b/],
    ["src/runtime/node/node.classes.ts", /\bunwatchFile\b/],
    ["src/runtime/node/node_fs_binding.rs", /\bunwatch_file\b/],
    ["src/runtime/node/node_fs.rs", /\bunwatch_file\b|\bUnwatchFile\b/],
    ["src/runtime/node/node_fs_watcher.rs", /\bfn has_ref\b/],
  ];
  expect(resurrected(checks)).toEqual([]);

  // Timeout and Immediate legitimately expose hasRef; only the FSWatcher
  // declaration lost it, so scope the check to that class.
  const classes = src("src/runtime/node/node.classes.ts");
  const start = classes.indexOf('name: "FSWatcher"');
  expect(start).toBeGreaterThan(-1);
  const end = classes.indexOf("name: ", start + 1);
  expect(end).toBeGreaterThan(start);
  expect(classes.slice(start, end)).not.toMatch(/\bhasRef\b/);
});

test("the watcher loader column does not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/watcher/lib.rs", /\bstruct Loader\b|CYCLEBREAK/],
    ["src/watcher/Watcher.rs", /\bloader\b/],
    ["src/jsc/hot_reloader.rs", /bun_watcher::Loader\b|\bloader: bun_ast::Loader\b/],
    ["src/jsc/VirtualMachine.rs", /add_file_by_path_slow\(main, loader\)/],
    ["src/runtime/cli/test_command.rs", /add_file_by_path_slow\(path, loader\)/],
    ["src/bundler/bundle_v2.rs", /bun_watcher::Loader\(/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead bun_core / bun_sys / bun_jsc / tcc_sys helpers do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // bun_core::util::{Mutex, RwLock}::get_mut, Timespec::new.
    ["src/bun_core/util.rs", /\bpub fn get_mut\(&mut self\) -> &mut T\b/],
    ["src/bun_core/util.rs", /\bfn new\(sec: i64, nsec: i64\)/],
    // RawSlice::from_raw.
    ["src/bun_core/lib.rs", /\bunsafe fn from_raw\(p: \*const \[T\]\)/],
    // DynLib::handle.
    ["src/sys/lib.rs", /\bfn handle\(&self\) -> \*mut c_void\b/],
    // JSValue::cast.
    ["src/jsc/JSValue.rs", /\bfn cast<T>\(ptr: \*const T\)/],
    // tcc_sys::SymbolCallback.
    ["src/tcc_sys/tcc.rs", /\bSymbolCallback\b/],
    ["src/tcc_sys/lib.rs", /\bSymbolCallback\b/],
  ];
  expect(resurrected(checks)).toEqual([]);

  // Unaligned::new (other types in util.rs keep a `new(value: T)`), and
  // posix::read (bun_sys::linux::read has the same signature and is live).
  expect(block(src("src/bun_core/util.rs"), "impl<T: Copy> Unaligned<T> {")).not.toMatch(/\bfn new\b/);
  expect(block(src("src/sys/lib.rs"), "pub mod posix {")).not.toMatch(/\bfn read\b/);
});

test("unreferenced builtins.d.ts declarations do not reappear", () => {
  const dts = src("src/js/builtins.d.ts");
  const names = [
    "getByValWithThis",
    "getPrototypeOf",
    "fulfillPromise",
    "getGeneratorInternalField",
    "getAsyncGeneratorInternalField",
    "getAbstractModuleRecordInternalField",
    "getArrayIteratorInternalField",
    "getStringIteratorInternalField",
    "idWithProfile",
    "isConstructor",
    "isDerivedArray",
    "isGenerator",
    "isAsyncGenerator",
    "isShadowRealm",
    "isStringIterator",
    "isArrayIterator",
    "putByValWithThisSloppy",
    "putByValWithThisStrict",
    "putGeneratorInternalField",
    "putAsyncGeneratorInternalField",
    "putArrayIteratorInternalField",
    "putStringIteratorInternalField",
    "superSamplerBegin",
    "superSamplerEnd",
    "toNumber",
    "toString",
    "toPropertyKey",
    "toObject",
    "newArrayWithSpecies",
    "newPromise",
    "createPromise",
    "iterationKindKey",
    "MAX_SAFE_INTEGER",
    "ModuleTranslate",
    "ModuleReady",
    "promiseRejectionReject",
    "generatorFieldState",
    "GeneratorResumeModeNormal",
    "GeneratorStateCompleted",
    "arrayIteratorFieldIndex",
    "mapIteratorFieldMapBucket",
    "setIteratorFieldSetBucket",
    "stringIteratorFieldIndex",
    "asyncGeneratorFieldSuspendReason",
    "AsyncGeneratorStateCompleted",
    "AsyncGeneratorSuspendReasonYield",
    "abstractModuleRecordFieldState",
    "trunc",
    "newHandledRejectedPromise",
    "ERR_TLS_PROTOCOL_VERSION_CONFLICT",
    "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE",
    "ERR_CRYPTO_INCOMPATIBLE_KEY",
    "ERR_IPC_CHANNEL_CLOSED",
    "ERR_INVALID_MIME_SYNTAX",
    "enqueueJob",
    "Object",
    "ReadableStream",
    "ReadableStreamBYOBReader",
    "ReadableStreamDefaultReader",
    "ReadableStreamDefaultController",
    "ReadableStreamDirectController",
  ];
  const declared = names.filter(name =>
    new RegExp(`^declare (?:function|const|var|type) \\$${name}\\b`, "m").test(dts),
  );
  expect(declared).toEqual([]);
  // $ERR_INVALID_HANDLE_TYPE stays, but only once.
  expect(dts.match(/^declare function \$ERR_INVALID_HANDLE_TYPE\b/gm)?.length).toBe(1);
});
