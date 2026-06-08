// Source-text consistency check for oven-sh/bun#31971.
//
// `us_socket_stream_buffer_t` hands the raw parts of a `Vec<u8>` back and
// forth across the C++ boundary. Before #31971 the conversion back to an
// owning `StreamBuffer` was `pub fn to_stream_buffer(&self)`: it rebuilt a
// `Vec` via `Vec::from_raw_parts` without clearing `list_ptr`/`list_len`/
// `list_cap`, so entirely safe Rust could mint two owners of the same
// allocation (double free / use-after-free). The fix makes the conversion a
// one-shot ownership transfer, `pub fn take_stream_buffer(&mut self)`, which
// nulls the raw parts it transfers out.
//
// The primary guard is behavioral: `stream_buffer_tests` in
// src/uws_sys/us_socket_t.rs runs under `cargo miri test -p bun_uws_sys`
// (MIRI_CRATES in scripts/rust-miri.ts, CI lane .github/workflows/miri.yml),
// where Miri deterministically reports the double free / leak if the take
// ever stops clearing the raw parts. This file is a belt-and-suspenders lint
// that pins the same invariant at the source-text layer so a reviewer can see
// it without running cargo — same pattern + test/internal/ placement as
// ban-words.test.ts and dead-code-escapes.test.ts (a coding-convention lint,
// not a behavioral test). Not under test/regression/issue/ because the
// conversion was unsound from the day it landed; there is no prior release
// where it worked.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// test/internal/ is one level under repo root.
const repoRoot = join(import.meta.dir, "..", "..");

// Whitespace-tolerant so benign reformatting doesn't break the lint; only
// signatures and call-site counts are asserted.
const source = readFileSync(join(repoRoot, "src/uws_sys/us_socket_t.rs"), "utf8").replace(/\s+/g, " ");

test("stream-buffer conversion is a one-shot take (&mut self), not a safe &self copy (#31971)", () => {
  // The conversion must require exclusive access so it can null the raw
  // parts whose ownership it transfers out.
  expect(source).toMatch(/\bpub\s+fn\s+take_stream_buffer\s*\(\s*&\s*mut\s+self\s*\)\s*->\s*StreamBuffer\b/);
  // The old `&self` conversion rebuilt an owning Vec without clearing the
  // parts, so two calls (or one call plus `destroy`) double-freed.
  expect(source).not.toMatch(/\bfn\s+to_stream_buffer\b/);
  expect(source).not.toMatch(/\bfn\s+take_stream_buffer\s*\(\s*&\s*self\b/);
});

test("take_stream_buffer is the only place that rebuilds the Vec from raw parts (#31971)", () => {
  // A single rebuild site keeps the ownership transfer auditable: `destroy`
  // and `update` route through the take instead of re-deriving a Vec from
  // `list_ptr` themselves. (`stream_buffer_tests` at the bottom of the file
  // exercises the behavior; this only pins the structure.)
  const rebuilds = source.match(/Vec::from_raw_parts/g) ?? [];
  expect(rebuilds).toHaveLength(1);
});
