// Guards against reintroduction of symbols removed in #35559. Each entry was
// verified to have zero callers across src/ and build/debug/codegen/ before
// deletion, and a full build plus rust:check-all (all targets) passes without
// them. This test fails if any of them reappear, e.g. via a merge that
// resurrects a stale file or a copy-paste from an old branch.
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
  return checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
}

test("dead webcore items removed in #35559 do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // blob::Inline was never constructed; every Body::Value::InlineBlob arm
    // existed only as commented-out code.
    ["src/runtime/webcore/Blob.rs", /pub struct Inline \{/],
    ["src/runtime/webcore/Blob.rs", /impl Inline \{/],
    ["src/runtime/webcore/Body.rs", /InlineBlob/],
    ["src/runtime/server/RequestContext.rs", /InlineBlob/],
    // StreamResult::is_done is live; Writable's is the one that was removed.
    ["src/runtime/webcore/streams.rs", /impl Writable \{\n\s*pub fn is_done\b/],
    ["src/runtime/webcore/streams.rs", /pub fn init<T: SignalHandler>\(handler: &mut T\) -> Signal \{/],
    // BufferAction is consumed only via fulfill/reject/value/swap.
    ["src/runtime/webcore/streams.rs", /pub fn get\(&self\) -> \*mut JSPromise \{/],
    ["src/runtime/webcore/Response.rs", /pub fn header\(&self, name: HTTPHeaderName\)/],
    ["src/runtime/webcore/Response.rs", /pub fn from_js_direct\(value: JSValue\) -> Option<\*mut Response>/],
    ["src/runtime/webcore/ReadableStream.rs", /pub fn unref\(&mut self\) \{\s*\n\s*if C::SUPPORTS_REF/],
    ["src/runtime/webcore/FileReader.rs", /pub const TAG: readable_stream::Tag/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead jsc helpers removed in #35559 do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // The only user (test_runner/Collection.rs) uses init + Drop; no ref()
    // counterpart exists.
    ["src/jsc/DeprecatedStrong.rs", /pub fn unref\(&mut self\)/],
    ["src/jsc/Strong.rs", /pub fn call\(&mut self, global: &JSGlobalObject, args: &\[JSValue\]\)/],
    ["src/jsc/Weak.rs", /pub fn init\(\) -> Self \{/],
    ["src/jsc/Weak.rs", /pub fn has\(&self\) -> bool \{/],
    ["src/jsc/JSPropertyIterator.rs", /pub fn reset\(&mut self\) \{/],
    ["src/jsc/JSString.rs", /pub fn eql\(&self, global: &JSGlobalObject, other: &JSString\)/],
    ["src/jsc/JSString.rs", /JSC__JSString__eql/],
    ["src/jsc/URLSearchParams.rs", /URLSearchParams__create/],
    // C++ sides of the removed extern imports.
    ["src/jsc/bindings/bindings.cpp", /JSC__JSString__eql/],
    ["src/jsc/bindings/headers.h", /JSC__JSString__eql/],
    ["src/jsc/bindings/URLSearchParams.cpp", /URLSearchParams__create/],
    // ref_count became write-only once unref() was removed.
    ["src/jsc/DeprecatedStrong.rs", /ref_count/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead bundler/ast items removed in #35559 do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // Callers use PathTemplate::print directly; nothing formats either type
    // via Display.
    ["src/bundler/options.rs", /impl PathTemplateConst \{/],
    ["src/bundler/options.rs", /impl core::fmt::Display for PathTemplateConst/],
    ["src/bundler/options.rs", /impl core::fmt::Display for PathTemplate \{/],
    // Only self-recursive; external is_boolean() calls are on JSValue.
    ["src/ast/expr.rs", /pub fn is_boolean\(&self\) -> bool \{/],
    ["src/ast/lib.rs", /pub fn init_comptime\(\) -> Log \{/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead install/spawn/node/resolver items removed in #35559 do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/install/PackageManager/ProgressStrings.rs", /pub fn extract\(\) -> &'static \[u8\]/],
    ["src/install/PackageManager/ProgressStrings.rs", /EXTRACT_NO_EMOJI_/],
    ["src/install/bin.rs", /pub type Context = PriorityQueueContext;/],
    ["src/install/PackageManager/security_scanner.rs", /pub fn event_loop\(&self\) -> &AnyEventLoop \{/],
    ["src/install/lockfile/Package/Scripts.rs", /pub fn first\(&self\) -> &\[u8\] \{/],
    ["src/spawn/static_pipe_writer.rs", /pub fn get_buffer\(&self\) -> &\[u8\]/],
    ["src/spawn/static_pipe_writer.rs", /pub fn flush\(&mut self\) \{/],
    ["src/spawn/static_pipe_writer.rs", /pub fn loop_\(&self\) -> \*mut AsyncLoop/],
    // ResultTaskMini::run_from_main_thread_mini (private) is live; the
    // removed one was `pub fn` on ResultTask.
    ["src/spawn/process.rs", /pub fn run_from_main_thread_mini\b/],
    // Never constructed; the iterator returns bun_sys::Error.
    ["src/runtime/node/dir_iterator.rs", /pub enum IteratorError \{/],
    ["src/runtime/error.rs", /DirIterator\(/],
    ["src/runtime/node/node_fs.rs", /impl Null \{\s*\n\s*pub fn to_js/],
    ["src/runtime/node/types.rs", /impl VectorArrayBuffer \{\s*\n\s*pub fn to_js/],
    ["src/resolver/dir_info.rs", /pub const fn as_ptr\(self\) -> \*mut DirInfo/],
    ["src/resolver/fs.rs", /pub fn statBatch/],
    ["src/libarchive/lib.rs", /pub fn as_ptr\(&self\) -> \*mut Archive \{/],
  ];
  expect(resurrected(checks)).toEqual([]);
});
