// https://github.com/oven-sh/bun/issues/28607
//
// scrypt was non-deterministic on Arch Linux (Bun built with Clang 22) because
// WebKit's `IntegralTypedArrayAdaptor::toNativeFromDouble()` did:
//
//     int32_t result = static_cast<int32_t>(value);
//     if (static_cast<double>(result) != value) result = toInt32(value);
//     return static_cast<Type>(result);
//
// `static_cast<int32_t>(double)` is undefined behavior in C++ when `value` is
// outside `[INT32_MIN, INT32_MAX]`. Clang 22 legally optimized the subsequent
// range check away, silently turning every out-of-range typed-array store into
// `INT32_MIN` (and sometimes into arbitrary-looking values depending on
// surrounding codegen). That corrupted `@noble/hashes/scrypt` — and therefore
// Better Auth's `hashPassword` — producing different output for the same
// input across runs.
//
// Fix: always route through `toInt32()`, which on x86_64 uses a `cvttsd2si`
// inline-asm fast path with a fallback to the portable `toIntImpl<int32_t>()`
// when truncation isn't exact. Matches the existing ARM (FJCVTZS) code path.
//
// WebKit PR: https://github.com/oven-sh/WebKit/pull/179
//
// These tests exercise the JS-visible behavior (Int32Array / Uint32Array store
// of values outside their representable range) so that any future compiler
// that reintroduces the UB is caught by CI regardless of the build toolchain.

import { describe, expect, test } from "bun:test";

describe("issue 28607 — typed array int32 coercion must follow ECMA-262 ToInt32", () => {
  test("Int32Array coerces values > 2^31 per ECMA-262 ToInt32", () => {
    const cases: number[] = [
      2 ** 31, //            INT32_MAX + 1 → INT32_MIN
      2 ** 31 + 1, //        → -2147483647
      2 ** 31 + 2, //        → -2147483646
      2 ** 32 - 1, //        → -1
      2 ** 32, //            → 0
      2 ** 32 + 1, //        → 1
      2 ** 32 + 100, //      → 100
      2 ** 33, //            → 0
      2 ** 33 + 42, //       → 42
      2 ** 34 + 7, //        → 7
      15_000_000_000, //     → 2115098112
      1.5e10, //             → same as above
      Number.MAX_SAFE_INTEGER, // → -1
      -(2 ** 31) - 1, //     → INT32_MAX
      -(2 ** 32), //         → 0
      -(2 ** 33) - 7, //     → -7
      -15_000_000_000, //    → -2115098112
      -Number.MAX_SAFE_INTEGER, // → 1
    ];

    const arr = new Int32Array(cases.length);
    for (let i = 0; i < cases.length; i++) arr[i] = cases[i];

    // `v | 0` is ECMA-262 ToInt32 evaluated at the JS bytecode level, which
    // goes through a different WebKit code path than the typed-array store.
    // Both must agree.
    const expected = cases.map(v => v | 0);
    expect(Array.from(arr)).toEqual(expected);
  });

  test("Uint32Array coerces values > 2^32 per ECMA-262 ToUint32", () => {
    const cases: number[] = [
      2 ** 32, //            → 0
      2 ** 32 + 1, //        → 1
      2 ** 32 + 100, //      → 100
      2 ** 33, //            → 0
      2 ** 33 + 42, //       → 42
      4_294_967_295, //      → 4294967295
      Number.MAX_SAFE_INTEGER, // → 4294967295
      -1, //                 → 4294967295
      -100, //               → 4294967196
      -(2 ** 31), //         → 2147483648
      -(2 ** 32), //         → 0
    ];

    const arr = new Uint32Array(cases.length);
    for (let i = 0; i < cases.length; i++) arr[i] = cases[i];

    const expected = cases.map(v => v >>> 0);
    expect(Array.from(arr)).toEqual(expected);
  });

  test("Int16Array coerces values outside int16 range per ECMA-262 ToInt16", () => {
    const cases: number[] = [
      2 ** 15, //            → -32768
      2 ** 15 + 1, //        → -32767
      2 ** 16, //            → 0
      2 ** 16 + 100, //      → 100
      2 ** 31, //            → 0
      2 ** 31 + 1, //        → 1
      2 ** 32 + 5, //        → 5
      -(2 ** 15) - 1, //     → 32767
      -(2 ** 32), //         → 0
    ];

    const arr = new Int16Array(cases.length);
    for (let i = 0; i < cases.length; i++) arr[i] = cases[i];

    // ECMA-262 ToInt16: wrap mod 2^16, sign-adjust on [2^15, 2^16).
    const expected = cases.map(v => ((v | 0) << 16) >> 16);
    expect(Array.from(arr)).toEqual(expected);
  });

  test("Int32Array write is deterministic across repeated runs", () => {
    // With the UB, the same store can produce different values across runs
    // because the optimizer is free to reorder / constant-fold based on UB
    // assumptions. A fixed input must always produce the same output.
    const inputs = [2 ** 31, 2 ** 32 + 17, 1.5e10, -(2 ** 33) - 3, Number.MAX_SAFE_INTEGER];

    const first = (() => {
      const a = new Int32Array(inputs.length);
      for (let i = 0; i < inputs.length; i++) a[i] = inputs[i];
      return Array.from(a);
    })();

    for (let run = 0; run < 50; run++) {
      const a = new Int32Array(inputs.length);
      for (let i = 0; i < inputs.length; i++) a[i] = inputs[i];
      expect(Array.from(a)).toEqual(first);
    }
  });

  test("scrypt-style Int32Array bitwise mixing is deterministic (the @noble/hashes regression)", () => {
    // Mirrors the shape of @noble/hashes' scrypt Salsa20 core: repeated
    // `add + rotate + xor` on 16 Int32Array lanes. `a[i] + a[next]` routinely
    // overflows int32; the store must wrap mod 2^32 so the XOR chain
    // round-trips cleanly. With the UB, every overflowed store becomes
    // INT32_MIN and the chain collapses (or varies across runs).
    const seed = Array.from({ length: 16 }, (_, i) => (i + 1) * 0x10000001);

    const mix = (): string => {
      const a = new Int32Array(seed);
      for (let round = 0; round < 8; round++) {
        for (let i = 0; i < 16; i++) {
          const next = (i + 1) % 16;
          const sum = a[i] + a[next];
          a[next] = (sum << 5) | (sum >>> 27);
        }
      }
      return Array.from(a).join(",");
    };

    const first = mix();
    const runs = new Set<string>([first]);
    for (let i = 0; i < 50; i++) runs.add(mix());

    expect([...runs]).toEqual([first]);
  });
});
