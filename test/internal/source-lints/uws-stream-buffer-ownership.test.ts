// Source-text lint for oven-sh/bun#31971.
//
// `us_socket_stream_buffer_t` hands the raw parts of a `Vec<u8>` across the
// C++ boundary. The conversion back to an owning `StreamBuffer` used to be
// `pub fn to_stream_buffer(&self)`, which rebuilt a `Vec` via
// `Vec::from_raw_parts` without clearing the parts, so safe Rust could mint
// two owners of one allocation. The fix is a one-shot
// `pub fn take_stream_buffer(&mut self)` that nulls the parts it moves out.
//
// The behavioral guard is `stream_buffer_tests` in src/uws_sys/us_socket_t.rs,
// which `cargo miri test -p bun_uws_sys` runs (MIRI_CRATES in
// scripts/rust-miri.ts, the miri job in .github/workflows/rust-lints.yml).
// This file pins the same invariant at the source-text layer so a reviewer can
// see it without running cargo.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..", "..", "..");

// Whitespace-tolerant so reformatting doesn't break the lint.
const source = readFileSync(path.join(root, "src/uws_sys/us_socket_t.rs"), "utf8").replace(/\s+/g, " ");

test("stream-buffer conversion is a one-shot take (&mut self), not a safe &self copy (#31971)", () => {
  // The conversion must require exclusive access so it can null the raw
  // parts whose ownership it transfers out.
  expect(source).toMatch(/\bpub\s+fn\s+take_stream_buffer\s*\(\s*&\s*mut\s+self\s*\)\s*->\s*StreamBuffer\b/);
  expect(source).not.toMatch(/\bfn\s+to_stream_buffer\b/);
  expect(source).not.toMatch(/\bfn\s+take_stream_buffer\s*\(\s*&\s*self\b/);
});

test("take_stream_buffer is the only place that rebuilds the Vec from raw parts (#31971)", () => {
  // `destroy` and `update` route through the take instead of re-deriving a
  // Vec from `list_ptr` themselves.
  const rebuilds = source.match(/Vec::from_raw_parts/g) ?? [];
  expect(rebuilds).toHaveLength(1);
});
