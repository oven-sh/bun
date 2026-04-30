import { describe, expect, test } from "bun:test";
import { stringsInternals } from "bun:internal-for-testing";

// `bun.strings.toUTF16AllocForReal(..., sentinel = true)` is only called from
// Windows-specific code (`bun build --compile` metadata in `src/windows.zig`),
// so we exercise it directly via an internal binding here.
//
// Previously, the manual-conversion fallback (taken when simdutf rejects the
// input as invalid UTF-8) wrote the null sentinel with
// `output.items[output.items.len] = 0`, which indexes one past the slice
// length: always a bounds-check panic in safe builds, and a heap write past
// the allocation in release builds whenever the ArrayList's capacity equals
// its length.

const { toUTF16AllocSentinel } = stringsInternals;

describe("bun.strings.toUTF16AllocForReal(sentinel=true)", () => {
  test("pure ASCII", () => {
    expect(toUTF16AllocSentinel(Buffer.from("abc"))).toBe("abc");
  });

  test("valid UTF-8 with non-ASCII (simdutf fast path)", () => {
    expect(toUTF16AllocSentinel(Buffer.from("café", "utf8"))).toBe("café");
    expect(toUTF16AllocSentinel(Buffer.from("アプリケーション", "utf8"))).toBe("アプリケーション");
  });

  test("lone continuation byte", () => {
    expect(toUTF16AllocSentinel(new Uint8Array([0x80]))).toBe("\uFFFD");
  });

  test("ASCII prefix then invalid byte (capacity == len at sentinel)", () => {
    // firstNonASCII = 3; simdutf allocates out_length+1 then fails at 0x80;
    // the fallback ArrayList ends up with items.len == capacity after
    // appending U+FFFD, so writing the sentinel must grow the allocation.
    expect(toUTF16AllocSentinel(new Uint8Array([0x61, 0x62, 0x63, 0x80]))).toBe("abc\uFFFD");
  });

  test("multiple invalid sequences ending in non-ASCII", () => {
    expect(toUTF16AllocSentinel(new Uint8Array([0x80, 0x61, 0x80, 0x62, 0x80]))).toBe("\uFFFDa\uFFFDb\uFFFD");
  });

  test("invalid sequence followed by trailing ASCII", () => {
    expect(toUTF16AllocSentinel(new Uint8Array([0x80, 0x61, 0x62, 0x63]))).toBe("\uFFFDabc");
  });
});
