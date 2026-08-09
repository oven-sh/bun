// Guards against reintroduction of symbols removed as dead code from
// bun_react_compiler, the node:http2 frame parser, and bun_exe_format.
// Each entry was verified to have zero references across src/, scripts/,
// test/, and build/debug/codegen/ output before deletion; the Rust removals
// were additionally confirmed by `rustc --force-warn dead_code` reaching a
// warning-free fixpoint on the touched crates.
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
  const hits: string[] = [];
  for (const [file, re] of checks) {
    if (re.test(src(file))) {
      hits.push(`${file}: ${re}`);
    }
  }
  return hits;
}

test("dead react_compiler symbols do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // The experimental variant of the derived-computations-in-effects
    // validation (~1.1k lines). The pipeline only ever invoked the non-exp
    // version; the _exp config flag is parsed from pragmas but never read.
    [
      "src/react_compiler/validation/validate_no_derived_computations_in_effects.rs",
      /validate_no_derived_computations_in_effects_exp/,
    ],
    // Back-compat alias for a previous parser-hook API; nothing used it.
    ["src/react_compiler/program.rs", /\bSymbolHost\b/],
    ["src/react_compiler/lib.rs", /\bSymbolHost\b/],
    // Arena box alias with zero uses (HirVec is the one HIR actually uses).
    ["src/react_compiler/hir/mod.rs", /\bHirBox\b/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead h2_frame_parser inbound-path symbols do not reappear", () => {
  // The pre-engine inbound frame-handling path: once rewrite_read() routed all
  // inbound bytes through crate::api::h2::Connection, these handlers and their
  // wire-decoding helpers and buffering state became unreachable.
  const file = "src/runtime/api/bun/h2_frame_parser.rs";
  const checks: Array<[string, RegExp]> = [
    [file, /fn handle_incomming_payload\b/],
    [file, /fn handle_window_update_frame\b/],
    [file, /fn handle_unknown_frame\b/],
    [file, /fn handle_push_promise_frame\b/],
    [file, /fn decode_header_block\b/],
    [file, /fn handle_data_frame\b/],
    [file, /fn handle_go_away_frame\b/],
    [file, /fn handle_origin_frame\b/],
    [file, /fn handle_altsvc_frame\b/],
    [file, /fn handle_rst_stream_frame\b/],
    [file, /fn handle_ping_frame\b/],
    [file, /fn handle_priority_frame\b/],
    [file, /fn handle_continuation_frame\b/],
    [file, /fn finish_headers_end_stream\b/],
    [file, /fn handle_headers_frame\b/],
    [file, /fn handle_settings_frame\b/],
    [file, /fn lookup_inbound_stream\b/],
    [file, /fn read_bytes\b/],
    [file, /fn dispatch_frame\b/],
    // Decode-direction wire helpers only the handlers above used.
    [file, /fn u32_from_bytes\b/],
    [file, /enum SettingsFlags\b/],
    [file, /fn get_http2_common_string\b/],
    [file, /JSC__JSGlobalObject__getHTTP2CommonString/],
    [file, /type HeaderValue\b/],
    [file, /fn dispatch_with_3_extra\b/],
    [file, /fn send_settings_ack\b/],
    [file, /fn adjust_window_size\b/],
    [file, /fn increment_window_size_if_needed\b/],
    [file, /struct Payload\b/],
    // Write-only parser/stream state the dead handlers maintained.
    [file, /\bexpecting_continuation\b/],
    [file, /\bpreface_received_len\b/],
    [file, /\bpending_header_block\b/],
    [file, /\bis_waiting_more_headers\b/],
  ];
  expect(resurrected(checks)).toEqual([]);
});

test("dead exe_format symbols do not reappear", () => {
  const checks: Array<[string, RegExp]> = [
    // pe::Error::InsufficientSpace was never constructed.
    ["src/exe_format/pe.rs", /\bInsufficientSpace\b/],
  ];
  expect(resurrected(checks)).toEqual([]);
});
