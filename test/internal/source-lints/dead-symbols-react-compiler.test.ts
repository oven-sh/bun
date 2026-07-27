// Guards against reintroduction of symbols removed as dead code from
// react_compiler, sql_jsc and parsers. Each entry was verified to have zero
// callers across src/ and build/debug/codegen/ before deletion; this test
// fails if any reappear.
//
// This is a source-tree lint: it reads files from src/ and does not touch the
// built binary, so it belongs in test/internal/source-lints/ per the README.

import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

function src(p: string): string {
  return readFileSync(path.join(repoRoot, p), "utf8");
}

test("react_compiler dead debug-printing modules do not reappear", () => {
  // Both modules had zero external references; print.rs's doc comment named
  // `debug_print` / `print_reactive_function` as callers, neither of which
  // exists. code_frame.rs was only reachable via `format_compiler_error`.
  const deletedFiles = ["src/react_compiler/hir/print.rs", "src/react_compiler/diagnostics/code_frame.rs"];
  const resurrected = deletedFiles.filter(f => existsSync(path.join(repoRoot, f)));
  expect(resurrected).toEqual([]);
});

test("react_compiler dead visitor and helper functions do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/react_compiler/hir/visitors.rs", /pub fn each_instruction_lvalue_with_kind\b/],
    ["src/react_compiler/hir/visitors.rs", /pub fn each_instruction_operand_with_functions\b/],
    ["src/react_compiler/hir/visitors.rs", /pub fn map_instruction_lvalues\b/],
    ["src/react_compiler/hir/visitors.rs", /pub fn map_instruction_operands\b/],
    ["src/react_compiler/hir/visitors.rs", /pub fn map_instruction_value_operands\b/],
    ["src/react_compiler/hir/visitors.rs", /pub fn map_call_arguments\b/],
    ["src/react_compiler/hir/visitors.rs", /pub fn map_terminal_operands\b/],
    ["src/react_compiler/hir/visitors.rs", /pub fn terminal_has_fallthrough\b/],
    ["src/react_compiler/hir/visitors.rs", /pub fn each_pattern_operand_ids\b/],
    ["src/react_compiler/hir/visitors.rs", /pub fn each_operand_mut\b/],
    ["src/react_compiler/hir/environment.rs", /pub fn error_count\b/],
    ["src/react_compiler/hir/environment.rs", /pub fn take_errors_since\b/],
    ["src/react_compiler/hir/environment.rs", /pub fn has_todo_errors\b/],
    ["src/react_compiler/hir/environment.rs", /pub fn take_thrown_errors\b/],
    ["src/react_compiler/hir/environment.rs", /pub fn is_react_like_name\b/],
    ["src/react_compiler/hir/mod.rs", /pub fn is_set_type\b/],
    ["src/react_compiler/hir/mod.rs", /pub fn is_map_type\b/],
    ["src/react_compiler/hir/mod.rs", /^pub mod print;$/m],
    ["src/react_compiler/hir/globals.rs", /pub fn install_type_config\(/],
    ["src/react_compiler/diagnostics/mod.rs", /pub fn is_all_non_invariant\b/],
    ["src/react_compiler/diagnostics/mod.rs", /pub fn to_string_for_event\b/],
    ["src/react_compiler/diagnostics/mod.rs", /^pub mod code_frame;$/m],
    ["src/react_compiler/compile_result.rs", /pub fn from_loc_simple\b/],
    ["src/react_compiler/codegen.rs", /pub fn into_fn_body\b/],
    ["src/react_compiler/imports.rs", /pub fn set_source_filename\b/],
    ["src/react_compiler/imports.rs", /pub fn source_filename\b/],
    ["src/react_compiler/imports.rs", /^\s*source_filename: /m],
    ["src/react_compiler/hir/globals.rs", /&mut Option<&mut Vec<String>>/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});

test("sql_jsc and parsers dead helpers do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    ["src/sql_jsc/shared/SQLDataCell.rs", /pub fn allocated_slice\b/],
    ["src/parsers/yaml.rs", /pub fn print<Enc: Encoding, W/],
  ];
  const resurrected = checks.filter(([file, re]) => re.test(src(file))).map(([file, re]) => `${file}: ${re.source}`);
  expect(resurrected).toEqual([]);
});
