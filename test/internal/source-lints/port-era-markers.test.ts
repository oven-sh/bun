// Guards against reintroduction of port-era comment jargon left behind from
// the incremental Zig→Rust port. These markers ("blocked_on:", "un-gates",
// "``-gated", "re-gated", etc.) described temporary gating that no longer
// exists; they accumulate as misleading noise and justify dead shims.
//
// "cfg-gated" on its own is NOT banned here: it is used legitimately to
// describe real platform/feature `#[cfg(...)]` attributes.

import { expect, test } from "bun:test";
import { parseRustFragment } from "../../../scripts/rust-parser/index.ts";
import { rustSources } from "./rust-sources.ts";

// Patterns that indicate stale port-era comments. Each was driven to zero
// occurrences in src/**/*.rs; any reappearance is almost certainly copied
// from an old draft.
const banned: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /\bblocked_on\b/i,
    reason: "port-era 'blocked_on:' markers describe dependencies that have since landed",
  },
  {
    pattern: /``-gated\b/i,
    reason: "empty-backtick '``-gated' is a deleted gate-marker token; the comment is stale",
  },
  {
    pattern: /\bun-gates\b/i,
    reason: "'X un-gates' is port-era future-tense jargon; the referenced code is live",
  },
  {
    pattern: /\bun-gate\b(?!d)/i,
    reason: "'un-gate when/once X lands' is port-era jargon; X has landed",
  },
  {
    pattern: /\bre-gated\b/i,
    reason: "'re-gated' described a temporary port state; nothing is re-gated",
  },
  {
    pattern: /\bungated\b/i,
    reason: "'ungated' is port-era progress narrative, not useful documentation",
  },
  {
    pattern: /\bun-gated\b/i,
    reason: "'un-gated' is port-era progress narrative, not useful documentation",
  },
];

const hits: Record<string, string[]> = {};
for (const { pattern } of banned) {
  hits[pattern.source] = [];
}

// Only comment text is searched, every style included (`//`, `///`, `//!` and
// block comments, which a "does the line contain `//`" heuristic missed), so an
// identifier or a string literal that happens to match (or a `//` inside a URL
// string) never trips the lint. Tracked files only (the corpus filters on
// `git ls-tree`), so a stray `.rs` left in the working tree is not linted.
for (const src of rustSources()) {
  for (const { pattern } of banned) {
    for (const offset of src.file.commentsMatching(pattern).map(m => m.offset)) {
      hits[pattern.source].push(src.file.location(offset));
    }
  }
}

test("the patterns recognize the comment jargon they claim to", () => {
  const matches = (snippet: string) =>
    banned.some(({ pattern }) => parseRustFragment(snippet).commentsMatching(pattern).length > 0);
  const stale = [
    "// blocked_on: the Zig side still owns the handle",
    "/* this un-gates the fast path */",
    "/// re-gated until the port of the parent lands",
    "//! ``-gated: see the tracking issue",
    "let x = 1; // Ungated now",
    "// un-gate once the event loop lands",
    "// un-gated in the last sweep",
  ];
  const fine = [
    // Real `#[cfg]` gating is described as cfg-gated.
    "// cfg-gated behind #[cfg(windows)]",
    "/// The feature is gated by a runtime flag.",
    // Code and string literals are not comments.
    "let blocked_on = 1;",
    'log("un-gates");',
    'let x = "// blocked_on";',
  ];
  expect(stale.filter(s => !matches(s))).toEqual([]);
  expect(fine.filter(matches)).toEqual([]);
});

for (const { pattern, reason } of banned) {
  test(`no stale port marker: ${pattern}`, () => {
    const found = hits[pattern.source];
    if (found.length > 0) {
      const sample = found.slice(0, 20);
      throw new Error(
        `Found ${found.length} occurrence(s) of stale port-era marker ${pattern} in src/**/*.rs.\n` +
          `Reason: ${reason}\n` +
          `Locations${found.length > 20 ? ` (first 20 of ${found.length})` : ""}:\n` +
          sample.map(l => `  ${l}`).join("\n"),
      );
    }
    expect(found).toEqual([]);
  });
}
