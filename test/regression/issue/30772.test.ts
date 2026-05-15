// Regression test for https://github.com/oven-sh/bun/issues/30772
//
// `IdentOrRef::hash` (used by the CSS-modules local identifier in the
// selector parser) was hashing only the first 2 of the 16 bytes of the packed
// `u128` in the `Ref` branch. In release builds the low `ptrbits` lane is
// always zero, so every ref-tagged `IdentOrRef` collapsed to the same hash;
// in debug builds the first 2 bytes were a heap-address slice, which made the
// hash differ for two logically-equal refs (breaking the `hash`/`eql`
// contract).
//
// The fix hashes `Ref::as_u64()` — the identity bits that `Ref::eql` compares
// against — so equal refs hash identically and distinct refs hash distinctly.

import { test, expect } from "bun:test";
import { cssInternals } from "bun:internal-for-testing";

test("IdentOrRef::hash distinguishes distinct refs and is invariant over debug-only ptrbits", () => {
  const [h_a, h_a_dup, h_b, h_b_dup] = cssInternals.identOrRefHashRefs(
    /* aInner  */ 1,
    /* aSource */ 0,
    /* bInner  */ 2,
    /* bSource */ 0,
  );

  // Equal refs must hash identically — in debug builds this is only true if
  // the hash ignores the per-construction `ptrbits` heap address. Before the
  // fix, this assertion failed in debug (each `from_ref` call allocated a
  // fresh debug-ident slice at a different address, and those bytes made it
  // into the hash).
  expect(h_a).toBe(h_a_dup);
  expect(h_b).toBe(h_b_dup);

  // Distinct refs must hash distinctly (with overwhelming probability — the
  // wyhash collision probability on 8-byte inputs is ~2^-64). Before the fix,
  // this assertion failed in release (every ref hashed to the same 2-byte
  // pattern `[0x00, 0x00]` since `ptrbits` was 0).
  expect(h_a).not.toBe(h_b);
});

test("IdentOrRef::hash over many distinct refs yields many distinct hashes", () => {
  // Pick N pairs of refs, confirming that the hash actually distributes. With
  // the bug in release, every hash would collapse to one value; with the bug
  // in debug, hashes would depend on the non-deterministic debug-ident heap
  // address. After the fix, every distinct ref gets a distinct hash (modulo
  // astronomically-unlikely wyhash collisions).
  const hashes = new Set<number>();
  for (let i = 1; i <= 16; i++) {
    const [h] = cssInternals.identOrRefHashRefs(i, 0, i, 0);
    hashes.add(h);
  }
  expect(hashes.size).toBe(16);
});
