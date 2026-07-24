// Ratchet for `reshaped for borrowck` comment markers in src/**/*.rs.
//
// Each marker flags code the Zig->Rust port restructured to satisfy the borrow
// checker: an extra allocation, a double hash lookup, a raw-pointer launder, or
// a split borrow. The cleanup effort removes them by putting each site into its
// idiomatic Rust form (see docs/dev/borrowck-audit on the audit branch). This
// test pins the current count so it only moves down.
//
// If this fails because the count went UP: you added a new workaround. Prefer
// writing the idiomatic form directly (disjoint borrows, mem::take, index +
// reborrow, entry API). If a reshape is genuinely unavoidable, bump the limit
// below and explain why in the comment at the site.
//
// If this fails because the count went DOWN: you removed workarounds. Lower the
// limit to the new count.

import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import path from "node:path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

const LIMIT = 311;

const root = path.resolve(import.meta.dir, "..", "..", "..");
const rustSources = globAllSources().rust.filter(p => p.endsWith(".rs"));

let count = 0;
const sample: string[] = [];
for (const abs of rustSources) {
  const rel = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once
  // under its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== rel) continue;
  const content = await file(abs).text();
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("reshaped for borrowck")) {
      count++;
      if (sample.length < 20) sample.push(`${rel}:${i + 1}`);
    }
  }
}

test(`'reshaped for borrowck' markers are at or below the ratchet (${LIMIT})`, () => {
  if (count > LIMIT) {
    throw new Error(
      `Found ${count} 'reshaped for borrowck' markers in src/**/*.rs, up from ${LIMIT}.\n` +
        `Prefer the idiomatic Rust form over adding a new workaround; if unavoidable, bump LIMIT in this file.\n` +
        `First ${sample.length}:\n` +
        sample.map(l => `  ${l}`).join("\n"),
    );
  }
  if (count < LIMIT) {
    throw new Error(
      `Found ${count} 'reshaped for borrowck' markers in src/**/*.rs, down from ${LIMIT}.\n` +
        `Lower LIMIT in test/internal/source-lints/borrowck-reshape-markers.test.ts to ${count}.`,
    );
  }
  expect(count).toBe(LIMIT);
});
