// Guards against comments (SAFETY comments in particular) naming functions and
// fields by their pre-port Zig spelling. A SAFETY comment that points at
// `markInactive` cannot be checked against a tree whose function is
// `mark_inactive`, and the stale name tends to get copied into neighbouring
// comments.
//
// Each name below was driven to zero occurrences in the comments of
// src/**/*.rs, and none of them is also a C++ or JS identifier in this tree, so
// a reappearance is a stale reference rather than a cross-language one. Names
// with a live C++/JS namesake (`collectAsync`, `drainMicrotasks`, ...) and the
// `/// \`Zig.name\`` provenance line that heads many ported functions are
// deliberately not listed.

import { expect, test } from "bun:test";
import { parseRustFragment } from "../../../scripts/rust-parser/index.ts";
import { rustSources } from "./rust-sources.ts";

const renamed: { zig: string; rust: string }[] = [
  { zig: "calculateEstimatedByteSize", rust: "calculate_estimated_byte_size" },
  { zig: "callWriteOrEnd", rust: "call_write_or_end" },
  { zig: "closeAndDetach", rust: "close_and_detach" },
  { zig: "computeHasPendingActivity", rust: "compute_has_pending_activity" },
  { zig: "deinitInNextTick", rust: "deinit_in_next_tick" },
  { zig: "dirInfoUncached", rust: "dir_info_uncached" },
  { zig: "handleConnectError", rust: "handle_connect_error" },
  { zig: "incrementPendingTasks", rust: "increment_pending_tasks" },
  { zig: "initBake", rust: "VirtualMachine::init_bake" },
  { zig: "initSubproc", rust: "ShellSubprocess::spawn_async" },
  { zig: "internalFlush", rust: "internal_flush" },
  { zig: "isSliceInBuffer", rust: "bun_alloc::is_slice_in_buffer" },
  { zig: "markInactive", rust: "mark_inactive" },
  { zig: "onResolveJSC", rust: "plugin_runner::on_resolve_jsc" },
  { zig: "resetStore", rust: "reset_store" },
  { zig: "startTLSWithCTX", rust: "start_tls_with_ctx" },
  { zig: "toJSUnchecked", rust: "to_js_unchecked" },
];

const banned = renamed.map(({ zig, rust }) => ({
  zig,
  rust,
  // `\b` keeps `Prefix__name` C symbols (`_` is a word character) from matching.
  pattern: new RegExp(`\\b${zig}\\b`),
}));

const hits: Record<string, string[]> = {};
for (const { zig } of banned) {
  hits[zig] = [];
}

// Only comment text is searched, every style included (`//`, `///`, `//!` and
// block comments, which a "does the line contain `//`" heuristic missed). A
// string literal such as a log message that still carries the old spelling is
// not a stale cross-reference, and a `//` inside a URL string no longer turns
// its line into a comment. Tracked files only (the corpus filters on
// `git ls-tree`), so a stray `.rs` left in the working tree is not linted.
for (const src of rustSources()) {
  for (const { zig, pattern } of banned) {
    for (const offset of src.file.commentsMatching(pattern).map(m => m.offset)) {
      hits[zig].push(src.file.location(offset));
    }
  }
}

test("the patterns recognize the stale names they claim to", () => {
  const matches = (snippet: string) =>
    banned.some(({ pattern }) => parseRustFragment(snippet).commentsMatching(pattern).length > 0);
  const stale = [
    "// SAFETY: markInactive was called by the owner",
    "/* see toJSUnchecked */",
    "/// Ported from `initBake`.",
    "//! Mirrors onResolveJSC.",
    "let x = 1; // then internalFlush",
  ];
  const fine = [
    // The Rust spelling.
    "// SAFETY: mark_inactive was called by the owner",
    // Code and string literals are not comments.
    "let x = markInactive();",
    'log("toJSUnchecked");',
    // `_` is a word character, so a prefixed C symbol is a different word.
    "// Bun__markInactive",
    "// marks inactive",
  ];
  expect(stale.filter(s => !matches(s))).toEqual([]);
  expect(fine.filter(matches)).toEqual([]);
});

for (const { zig, rust } of banned) {
  test(`comments do not name pre-port \`${zig}\``, () => {
    const found = hits[zig];
    if (found.length > 0) {
      const sample = found.slice(0, 20);
      throw new Error(
        `Found ${found.length} comment(s) in src/**/*.rs naming \`${zig}\`, which no longer exists; ` +
          `the Rust identifier is \`${rust}\`.\n` +
          `Locations${found.length > 20 ? ` (first 20 of ${found.length})` : ""}:\n` +
          sample.map(l => `  ${l}`).join("\n"),
      );
    }
    expect(found).toEqual([]);
  });
}
