// Guards against reintroduction of symbols removed as dead code. Each entry
// was verified to have zero constructors/callers across src/ and
// build/debug/codegen/ before deletion; this test fails if any reappear.
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

test("dead js_printer Format::Cjs chain does not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/js_printer/lib.rs", /^\s*Cjs,$/m],
    ["src/js_printer/lib.rs", /^\s*CjsAscii,$/m],
    ["src/js_printer/lib.rs", /pub fn print_common_js\b/],
    ["src/js_printer/lib.rs", /impl PrintArg for u16\b/],
    ["src/js_printer/lib.rs", /REWRITE_ESM_TO_CJS/],
    ["src/js_printer/lib.rs", /fn print_bundled_export\b/],
    ["src/js_printer/lib.rs", /fn print_module_export_symbol\b/],
    ["src/bundler/transpiler.rs", /fn print_cjs_cold\b/],
    ["src/bundler/transpiler.rs", /Format::CjsAscii => unreachable/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("dead OutputFile::Value variants do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/bundler/OutputFile.rs", /Value::Move\b/],
    ["src/bundler/OutputFile.rs", /Value::Pending\b/],
    ["src/bundler/OutputFile.rs", /pub fn move_to\b/],
    ["src/bundler/OutputFile.rs", /pub fn get_pathname\b/],
    ["src/bundler/OutputFile.rs", /pub enum Kind \{/],
    ["src/runtime/api/output_file_jsc.rs", /OutputFileValue::Move\b/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("dead shell / http / patch items do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/js_parser/parse/parse_entry.rs", /^\s*if false \{$/m],
    ["src/js_parser/parse/parse_entry.rs", /else if p\.options\.bundle && parts\.is_empty\(\) \{/],
    ["src/runtime/shell/IOWriter.rs", /pub fn run_from_main_thread\b/],
    ["src/event_loop/ConcurrentTask.rs", /^\s*ShellIOWriter,$/m],
    ["src/runtime/shell/builtin/ls.rs", /LsParseError::ShowUsage/],
    ["src/http/InternalState.rs", /^\s*Connect,$/m],
    ["src/http/H2Client.rs", /live_sessions as LIVE_SESSIONS/],
    ["src/http/ssl_config.rs", /global_registry as GlobalRegistry/],
    ["src/patch/lib.rs", /git_diff_preprocess_paths<const SENTINEL/],
    ["src/install/lib.rs", /pub use .*CacheDirAndSubpath;/],
    ["src/runtime/bake/dev_server/mod.rs", /pub use packed_map::PackedMap;/],
    ["src/runtime/valkey_jsc/mod.rs", /pub use valkey_context::ValkeyContext;/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});
