// Guards against reintroduction of symbols removed as dead code from
// sys/windows, runtime/cli, runtime/shell, runtime/test_runner, and the v8
// C++ shim. Each entry was verified to have zero references across src/ and
// build/debug/codegen/ before deletion.
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

test("dead Rust symbols (sys, cli, shell, test_runner) do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // sys — Tag::is_windows() has no callers
    ["src/sys/lib.rs", /pub const fn is_windows\(self\) -> bool/],
    // sys/windows — wrapper + error enum never called (getenv_w uses kernel32_2 directly);
    // translate_ntstatus_to_errno alias never called (callers use translate_nt_status_to_errno)
    ["src/sys/windows/mod.rs", /pub enum GetEnvironmentVariableError\b/],
    ["src/sys/windows/mod.rs", /^pub fn GetEnvironmentVariableW\(/m],
    ["src/sys/windows/mod.rs", /^pub fn translate_ntstatus_to_errno\b/m],

    // runtime/cli — IS_MAIN_THREAD was write-only (crash_handler uses its own tid global);
    // Channel::close duplicated by Drop impl and had no callers
    ["src/runtime/cli/mod.rs", /static IS_MAIN_THREAD:/],
    ["src/runtime/cli/test/parallel/Channel.rs", /pub fn close\(&mut self\) \{/],

    // runtime/shell — ShellErr::{InvalidArguments, Todo} were only matched, never constructed
    ["src/runtime/shell/shell_body.rs", /^\s*InvalidArguments \{ val: /m],
    ["src/runtime/shell/shell_body.rs", /^\s*Todo\(Box<\[u8\]>\),/m],

    // runtime/test_runner — sequences_const was byte-identical to sequences;
    // StepResult::default never called
    ["src/runtime/test_runner/Execution.rs", /pub\(crate\) fn sequences_const\b/],
    ["src/runtime/test_runner/bun_test.rs", /impl Default for StepResult\b/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("dead C++ v8 shim symbols do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // Local<T>::reinterpret<U>() — added in initial V8 impl, never called; real
    // V8's Local has no such method so addons cannot link it.
    ["src/jsc/bindings/v8/V8Local.h", /Local<U> reinterpret\(\) const/],
    // Handle(const ObjectLayout*) — last caller removed in #13754's refactor
    ["src/jsc/bindings/v8/shim/Handle.h", /Handle\(const ObjectLayout\* that\);/],
    ["src/jsc/bindings/v8/shim/Handle.cpp", /Handle::Handle\(const ObjectLayout\* that\)/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});
