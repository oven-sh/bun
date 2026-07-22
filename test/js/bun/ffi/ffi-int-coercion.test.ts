import { dlopen, FFIType } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { join } from "node:path";

// Verifies that JS -> C integer argument coercion follows a single, documented
// policy: modular wrap (ToInt32 for <=32-bit widths, ToBigInt64/ToBigUint64 for
// 64-bit widths), matching TypedArray element assignment and the WebAssembly JS
// API. Historically each width chose independently between wrap, saturate, and
// throw.

const echoC = /* c */ `
#include <stdint.h>
int8_t   echo_i8 (int8_t  v) { return v; }
uint8_t  echo_u8 (uint8_t v) { return v; }
int16_t  echo_i16(int16_t v) { return v; }
uint16_t echo_u16(uint16_t v){ return v; }
int32_t  echo_i32(int32_t v) { return v; }
uint32_t echo_u32(uint32_t v){ return v; }
int64_t  echo_i64(int64_t v) { return v; }
uint64_t echo_u64(uint64_t v){ return v; }
int64_t  echo_i64f(int64_t v) { return v; }
uint64_t echo_u64f(uint64_t v){ return v; }
char     echo_char(char v)   { return v; }
`;

const symbols = {
  echo_i8: { args: [FFIType.i8], returns: FFIType.i8 },
  echo_u8: { args: [FFIType.u8], returns: FFIType.u8 },
  echo_i16: { args: [FFIType.i16], returns: FFIType.i16 },
  echo_u16: { args: [FFIType.u16], returns: FFIType.u16 },
  echo_i32: { args: [FFIType.i32], returns: FFIType.i32 },
  echo_u32: { args: [FFIType.u32], returns: FFIType.u32 },
  echo_i64: { args: [FFIType.i64], returns: FFIType.i64 },
  echo_u64: { args: [FFIType.u64], returns: FFIType.u64 },
  echo_i64f: { args: [FFIType.i64_fast], returns: FFIType.i64_fast },
  echo_u64f: { args: [FFIType.u64_fast], returns: FFIType.u64_fast },
  echo_char: { args: [FFIType.char], returns: FFIType.char },
} as const;

let S: any;

function build() {
  if (S) return S;
  const dir = tempDir("ffi-int-coercion", { "echo.c": echoC });
  const out = join(String(dir), "libecho.so");
  const res = Bun.spawnSync({
    cmd: ["cc", "-shared", "-fPIC", "-o", out, join(String(dir), "echo.c")],
    stderr: "pipe",
    stdout: "pipe",
  });
  if (res.exitCode !== 0) {
    throw new Error("cc failed: " + res.stderr.toString());
  }
  S = dlopen(out, symbols).symbols;
  return S;
}

// Requires a system C compiler for the dlopen fixture.
describe.skipIf(isWindows)("integer argument coercion wraps modularly at every width", () => {
  // ToInt32 reference: what a typed array would store.
  const i8 = (n: number) => new Int8Array([n])[0];
  const u8 = (n: number) => new Uint8Array([n])[0];
  const i16 = (n: number) => new Int16Array([n])[0];
  const u16 = (n: number) => new Uint16Array([n])[0];
  const i32 = (n: number) => new Int32Array([n])[0];
  const u32 = (n: number) => new Uint32Array([n])[0];

  test("char/i8/u8 wrap like Int8Array/Uint8Array", () => {
    const s = build();
    expect(s.echo_i8(300)).toBe(i8(300)); // 44
    expect(s.echo_i8(-200)).toBe(i8(-200)); // 56
    expect(s.echo_i8(5.7)).toBe(5);
    expect(s.echo_u8(300)).toBe(u8(300)); // 44, not 255
    expect(s.echo_u8(-1)).toBe(u8(-1)); // 255, not 0
    expect(s.echo_u8(5.7)).toBe(5);
    expect(s.echo_char(300)).toBe(i8(300));
  });

  test("i16/u16 wrap like Int16Array/Uint16Array", () => {
    const s = build();
    expect(s.echo_i16(40000)).toBe(i16(40000)); // -25536, not 32767
    expect(s.echo_i16(32768)).toBe(i16(32768)); // -32768 (current off-by-one gives this by accident)
    expect(s.echo_i16(-40000)).toBe(i16(-40000)); // 25536, not -32768
    expect(s.echo_u16(70000)).toBe(u16(70000)); // 4464, not 65535
    expect(s.echo_u16(-1)).toBe(u16(-1)); // 65535, not 0
  });

  test("i32/u32 wrap like Int32Array/Uint32Array", () => {
    const s = build();
    expect(s.echo_i32(5_000_000_000)).toBe(i32(5_000_000_000)); // 705032704
    expect(s.echo_i32(5.7)).toBe(5);
    expect(s.echo_u32(-1)).toBe(u32(-1)); // 4294967295, not 0
    expect(s.echo_u32(5_000_000_000)).toBe(u32(5_000_000_000)); // 705032704, not 4294967295
    expect(s.echo_u32(5.7)).toBe(5);
  });

  test("i64/u64 truncate fractional numbers instead of throwing", () => {
    const s = build();
    expect(s.echo_i64(5.7)).toBe(5n);
    expect(s.echo_i64(-5.7)).toBe(-5n);
    expect(s.echo_u64(5.7)).toBe(5n);
  });

  test("u64 wraps negative numbers instead of saturating to 0", () => {
    const s = build();
    expect(s.echo_u64(-1)).toBe(0xffff_ffff_ffff_ffffn);
    expect(s.echo_u64(-2)).toBe(0xffff_ffff_ffff_fffen);
  });

  test("i64_fast/u64_fast share the same argument coercion as i64/u64", () => {
    const s = build();
    // u64_fast previously saturated negatives to 0
    expect(BigInt(s.echo_u64f(-1))).toBe(0xffff_ffff_ffff_ffffn);
    expect(s.echo_u64f(5.7)).toBe(5);
    expect(s.echo_i64f(5.7)).toBe(5);
    expect(s.echo_i64f(-5.7)).toBe(-5);
    expect(s.echo_i64f(NaN)).toBe(0);
    expect(s.echo_u64f(NaN)).toBe(0);
    expect(s.echo_i64f(42)).toBe(42);
    expect(s.echo_u64f(42)).toBe(42);
  });

  test("i64/u64 wrap out-of-range BigInt", () => {
    const s = build();
    expect(s.echo_i64(1n << 64n)).toBe(0n);
    expect(s.echo_i64((1n << 63n) + 1n)).toBe(-(1n << 63n) + 1n);
    expect(s.echo_u64(1n << 64n)).toBe(0n);
    expect(s.echo_u64(-1n)).toBe(0xffff_ffff_ffff_ffffn);
  });

  test("NaN and Infinity coerce to 0 at every width", () => {
    const s = build();
    for (const fn of [s.echo_i8, s.echo_u8, s.echo_i16, s.echo_u16, s.echo_i32, s.echo_u32]) {
      expect(fn(NaN)).toBe(0);
      expect(fn(Infinity)).toBe(0);
      expect(fn(-Infinity)).toBe(0);
    }
    expect(s.echo_i64(NaN)).toBe(0n);
    expect(s.echo_i64(Infinity)).toBe(0n);
    expect(s.echo_u64(NaN)).toBe(0n);
    expect(s.echo_u64(-Infinity)).toBe(0n);
  });

  test("in-range values are unchanged", () => {
    const s = build();
    expect(s.echo_i8(-128)).toBe(-128);
    expect(s.echo_i8(127)).toBe(127);
    expect(s.echo_u8(0)).toBe(0);
    expect(s.echo_u8(255)).toBe(255);
    expect(s.echo_i16(-32768)).toBe(-32768);
    expect(s.echo_i16(32767)).toBe(32767);
    expect(s.echo_u16(65535)).toBe(65535);
    expect(s.echo_i32(-2147483648)).toBe(-2147483648);
    expect(s.echo_i32(2147483647)).toBe(2147483647);
    expect(s.echo_u32(0)).toBe(0);
    expect(s.echo_u32(4294967295)).toBe(4294967295);
    expect(s.echo_i64(9007199254740991)).toBe(9007199254740991n);
    expect(s.echo_i64(-9007199254740991)).toBe(-9007199254740991n);
    expect(s.echo_u64(9007199254740991)).toBe(9007199254740991n);
    expect(s.echo_i64(0x7fff_ffff_ffff_ffffn)).toBe(0x7fff_ffff_ffff_ffffn);
    expect(s.echo_u64(0xffff_ffff_ffff_ffffn)).toBe(0xffff_ffff_ffff_ffffn);
  });
});
