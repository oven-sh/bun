// Guards against reintroduction of port-era comment jargon left behind from
// the incremental Zig→Rust port. These markers ("blocked_on:", "un-gates",
// "``-gated", "re-gated", etc.) described temporary gating that no longer
// exists; they accumulate as misleading noise and justify dead shims.
//
// "cfg-gated" on its own is NOT banned here: it is used legitimately to
// describe real platform/feature `#[cfg(...)]` attributes.

import { file } from "bun";
import { expect, test } from "bun:test";
import path from "node:path";
import { globAllSources } from "../../scripts/glob-sources.ts";

const root = path.resolve(import.meta.dir, "..", "..");

// Patterns that indicate stale port-era comments. Each was driven to zero
// occurrences in src/**/*.rs; any reappearance is almost certainly copied
// from a .zig reference file or an old draft.
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

const rustSources = globAllSources().rust.filter(p => p.endsWith(".rs"));

const hits: Record<string, string[]> = {};
for (const { pattern } of banned) {
  hits[pattern.source] = [];
}

for (const abs of rustSources) {
  const rel = path.relative(root, abs);
  const content = await file(abs).text();
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // These markers are comment jargon; skip non-comment lines so an
    // identifier or string literal that happens to match never trips the lint.
    if (!line.includes("//")) continue;
    for (const { pattern } of banned) {
      if (pattern.test(line)) {
        hits[pattern.source].push(`${rel}:${i + 1}`);
      }
    }
  }
}

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
