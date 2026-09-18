// Guards against comments (SAFETY comments in particular) naming functions and
// fields by their pre-port Zig spelling. A SAFETY comment that points at
// `markInactive` cannot be checked against a tree whose function is
// `mark_inactive`, and the stale name tends to get copied into neighbouring
// comments.
//
// Each name below was driven to zero occurrences in comment lines of
// src/**/*.rs, and none of them is also a C++ or JS identifier in this tree, so
// a reappearance is a stale reference rather than a cross-language one. Names
// with a live C++/JS namesake (`collectAsync`, `drainMicrotasks`, ...) and the
// `/// \`Zig.name\`` provenance line that heads many ported functions are
// deliberately not listed.

import { file } from "bun";
import { expect, test } from "bun:test";
import path from "node:path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

const root = path.resolve(import.meta.dir, "..", "..", "..");

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

const rustSources = globAllSources().rust.filter(p => p.endsWith(".rs"));

const hits: Record<string, string[]> = {};
for (const { zig } of banned) {
  hits[zig] = [];
}

for (const abs of rustSources) {
  const rel = path.relative(root, abs);
  const lines = (await file(abs).text()).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Only comments are linted; a string literal such as a log message that
    // still carries the old spelling is not a stale cross-reference.
    if (!line.includes("//")) continue;
    for (const { zig, pattern } of banned) {
      if (pattern.test(line)) {
        hits[zig].push(`${rel}:${i + 1}`);
      }
    }
  }
}

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
