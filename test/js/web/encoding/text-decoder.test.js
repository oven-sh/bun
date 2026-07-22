import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, gc as gcTrace, isASAN, normalizeBunSnapshot, tempDir, withoutAggressiveGC } from "harness";

const getByteLength = str => {
  // returns the byte length of an utf8 string
  var s = str.length;
  for (var i = str.length - 1; i >= 0; i--) {
    var code = str.charCodeAt(i);
    if (code > 0x7f && code <= 0x7ff) s++;
    else if (code > 0x7ff && code <= 0xffff) s += 2;
    if (code >= 0xdc00 && code <= 0xdfff) i--; //trail surrogate
  }
  return s;
};

describe("TextDecoder", () => {
  it("should not crash on empty text", () => {
    const decoder = new TextDecoder();
    gcTrace(true);
    const fixtures = [new Uint8Array(), new Uint8Array([]), new Buffer(0), new ArrayBuffer(0), new Uint16Array(0)];

    for (let input of fixtures) {
      expect(decoder.decode(input)).toBe("");
    }

    // Cause a de-opt
    try {
      decoder.decode([NaN, Symbol("s")]);
    } catch (e) {}

    // DOMJIT test
    for (let i = 0; i < 90000; i++) {
      decoder.decode(fixtures[0]);
    }

    gcTrace(true);
  }, 30_000); // 90k decodes take ~2.5s under ASAN.
  it("should decode ascii text", () => {
    const decoder = new TextDecoder("latin1");
    gcTrace(true);
    expect(decoder.encoding).toBe("windows-1252");
    gcTrace(true);
    expect(decoder.decode(new Uint8Array([0x41, 0x42, 0x43]))).toBe("ABC");
    gcTrace(true);

    // hit the SIMD code path
    const result = [
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
      72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33,
    ];
    gcTrace(true);
    expect(decoder.decode(Uint8Array.from(result))).toBe(String.fromCharCode(...result));
    gcTrace(true);
  });

  it("should decode unicode text", () => {
    const decoder = new TextDecoder();
    gcTrace(true);
    const inputBytes = [226, 157, 164, 239, 184, 143, 32, 82, 101, 100, 32, 72, 101, 97, 114, 116];
    for (var repeat = 1; repeat < 100; repeat++) {
      var text = `❤️ Red Heart`.repeat(repeat);

      var bytes = Array.from({ length: repeat }, () => inputBytes).flat();
      var decoded = decoder.decode(Uint8Array.from(bytes));
      expect(decoder.encoding).toBe("utf-8");
      expect(decoded).toBe(text);
      gcTrace(true);
    }
  }, 30_000); // 99 Bun.gc(true) passes take ~3s under ASAN.

  describe("typedArrays", () => {
    var text = `ABC DEF GHI JKL MNO PQR STU VWX YZ ABC DEF GHI JKL MNO PQR STU V`;
    var bytes = new TextEncoder().encode(text);
    var decoder = new TextDecoder();
    for (let TypedArray of [
      Uint8Array,
      Uint16Array,
      Uint32Array,
      Int8Array,
      Int16Array,
      Int32Array,
      Float16Array,
      Float32Array,
      Float64Array,
      DataView,
      BigInt64Array,
      BigUint64Array,
    ]) {
      it(`should decode ${TypedArray.name}`, () => {
        const decoded = decoder.decode(new TypedArray(bytes.buffer));
        expect(decoded).toBe(text);
      });
    }

    it("DOMJIT call", () => {
      const array = new Uint8Array(bytes.buffer);
      withoutAggressiveGC(() => {
        for (let i = 0; i < 100_000; i++) {
          const decoded = decoder.decode(array);
          expect(decoded).toBe(text);
        }
      });
    }, 120_000); // 100k iterations under ASAN instrumentation take ~21s.
  });

  it("should decode unicode text with multiple consecutive emoji", () => {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    gcTrace(true);
    var text = `❤️❤️❤️❤️❤️❤️ Red Heart`;

    text += ` ✨ Sparkles 🔥 Fire 😀 😃 😄 😁 😆 😅 😂 🤣 🥲 ☺️ 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰`;
    gcTrace(true);
    const result = decoder.decode(encoder.encode(text));
    expect(result).toBe(text);
    expect(result).toBeUTF16String();
    gcTrace(true);
    const bytes = new Uint8Array(getByteLength(text) * 8);
    gcTrace(true);
    const amount = encoder.encodeInto(text, bytes);
    gcTrace(true);
    expect(decoder.decode(bytes.subarray(0, amount.written))).toBe(text);
    gcTrace(true);
  });

  it("coerces the fatal flag to boolean : 1 -> true", () => {
    const decoder = new TextDecoder("utf-8", { fatal: 1 });
    expect(decoder.fatal).toBe(true);
  });

  it("coerces the fatal flag to boolean : 0 -> false", () => {
    const decoder = new TextDecoder("utf-8", { fatal: 0 });
    expect(decoder.fatal).toBe(false);
  });

  it("coerces the fatal flag to boolean : string -> true", () => {
    const decoder = new TextDecoder("utf-8", { fatal: "string" });
    expect(decoder.fatal).toBe(true);
  });

  it("coerces the fatal flag to boolean : null -> false", () => {
    const decoder = new TextDecoder("utf-8", { fatal: null });
    expect(decoder.fatal).toBe(false);
  });

  it("coerces the fatal flag to boolean : empty-string -> false", () => {
    const decoder = new TextDecoder("utf-8", { fatal: "" });
    expect(decoder.fatal).toBe(false);
  });

  it("should respect fatal when encountering invalid data", () => {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    expect(() => {
      decoder.decode(new Uint8Array([0xc0])); // Invalid UTF8
    }).toThrow(Error);
    let err;
    try {
      decoder.decode(new Uint8Array([0xc0, 0x80])); // Invalid UTF8
    } catch (e) {
      err = e;
    }
    expect(err.code).toBe("ERR_ENCODING_INVALID_ENCODED_DATA");
  });

  it("should not trim invalid byte sequences when fatal is false", () => {
    const buf = Buffer.from([77, 97, 110, 32, 208, 129, 240, 164, 173]);
    const received = new TextDecoder("utf-8").decode(buf);
    const expected = "Man Ё\ufffd";
    expect(received).toBe(expected);
  });

  it("should trim when stream is true", () => {
    const buf = Buffer.from([77, 97, 110, 32, 208, 129, 240, 164, 173]);
    const received = new TextDecoder("utf-8").decode(buf, { stream: true });
    const expected = "Man Ё";
    expect(received).toBe(expected);
  });

  it("constructor should set values", () => {
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
    expect(decoder.fatal).toBe(true);
    expect(decoder.ignoreBOM).toBe(false);
  });

  it("should throw on invalid input", () => {
    expect(() => {
      const decoder = new TextDecoder("utf-8", { fatal: 10, ignoreBOM: {} });
    }).toThrow();
  });

  it("should support undifined", () => {
    const decoder = new TextDecoder(undefined);
    expect(decoder.encoding).toBe("utf-8");
  });

  it("should support undefined options", () => {
    expect(() => {
      const decoder = new TextDecoder("utf-8", undefined);
    }).not.toThrow();
  });

  // https://webidl.spec.whatwg.org/#es-dictionary step 1:
  // "If Type(V) is not Undefined, Null or Object, then throw a TypeError."
  describe("options WebIDL dictionary conversion", () => {
    const bytes = new Uint8Array([0x41, 0x42, 0x43]);

    it.each([5, "x", true, 0n])("decode() rejects primitive options: %p", opt => {
      const decoder = new TextDecoder();
      expect(() => decoder.decode(bytes, opt)).toThrow(
        expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE" }),
      );
    });

    it("decode() rejects symbol options", () => {
      const decoder = new TextDecoder();
      expect(() => decoder.decode(bytes, Symbol())).toThrow(
        expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE" }),
      );
    });

    it.each([[null], [undefined], [{}], [() => {}], [[]]])("decode() accepts %p options", opt => {
      expect(new TextDecoder().decode(bytes, opt)).toBe("ABC");
    });

    it("decode() with bad options throws before touching stream state", () => {
      const decoder = new TextDecoder();
      decoder.decode(new Uint8Array([0xf0, 0x9f]), { stream: true });
      expect(() => decoder.decode(new Uint8Array(), 5)).toThrow(TypeError);
      // The streamed partial sequence is still buffered: the throw above did
      // not flush it.
      expect(decoder.decode(new Uint8Array([0x92, 0xa9]))).toBe("\u{1F4A9}");
    });

    it("constructor accepts null options", () => {
      const decoder = new TextDecoder("utf-8", null);
      expect(decoder.encoding).toBe("utf-8");
      expect(decoder.fatal).toBe(false);
      expect(decoder.ignoreBOM).toBe(false);
    });

    it("constructor rejects primitive options with ERR_INVALID_ARG_TYPE", () => {
      expect(() => new TextDecoder("utf-8", 5)).toThrow(
        expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE" }),
      );
    });
  });
});

describe("TextDecoder ignoreBOM", () => {
  it.each([
    {
      encoding: "utf-8",
      bytes: [0xef, 0xbb, 0xbf, 0x61, 0x62, 0x63],
    },
    {
      encoding: "utf-16le",
      bytes: [0xff, 0xfe, 0x61, 0x00, 0x62, 0x00, 0x63, 0x00],
    },
  ])("should ignoreBOM for: %o", ({ encoding, bytes }) => {
    const BOM = "\uFEFF";
    const array = new Uint8Array(bytes);

    const decoder_ignore_bom = new TextDecoder(encoding, { ignoreBOM: true });
    expect(decoder_ignore_bom.decode(array)).toStrictEqual(`${BOM}abc`);

    const decoder_not_ignore_bom = new TextDecoder(encoding, { ignoreBOM: false });
    expect(decoder_not_ignore_bom.decode(array)).toStrictEqual("abc");

    const decoder_not_ignore_bom_default = new TextDecoder(encoding);
    expect(decoder_not_ignore_bom_default.decode(array)).toStrictEqual(`abc`);
  });
});

// https://encoding.spec.whatwg.org/#concept-td-serialize: per stream, only the
// FIRST output code point is dropped if it is U+FEFF. Its bytes may be split
// across `{stream: true}` chunks, and a later U+FEFF must NOT be dropped.
describe("TextDecoder BOM across {stream: true} chunks", () => {
  const decodeChunks = (encoding, chunks) => {
    const d = new TextDecoder(encoding);
    let out = "";
    for (let i = 0; i < chunks.length; i++) {
      out += d.decode(Uint8Array.from(chunks[i]), { stream: i + 1 < chunks.length });
    }
    return out;
  };

  it.each([
    // A BOM split across chunks is still the stream's BOM.
    ["utf-8", [[0xef], [0xbb, 0xbf, 0x41]], "A"],
    [
      "utf-8",
      [
        [0xef, 0xbb],
        [0xbf, 0x41],
      ],
      "A",
    ],
    ["utf-8", [[0xef], [0xbb], [0xbf], [0x41]], "A"],
    ["utf-16le", [[0xff], [0xfe, 0x41, 0x00]], "A"],
    ["utf-16be", [[0xfe], [0xff, 0x00, 0x41]], "A"],
    // A second U+FEFF, or one not at the start of the stream, is literal.
    [
      "utf-8",
      [
        [0xef, 0xbb, 0xbf],
        [0xef, 0xbb, 0xbf, 0x41],
      ],
      "\uFEFFA",
    ],
    // Same, with both in ONE chunk: only the first may be stripped.
    ["utf-8", [[0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x41]], "\uFEFFA"],
    ["utf-16le", [[0xff, 0xfe, 0xff, 0xfe, 0x42, 0x00]], "\uFEFFB"],
    ["utf-16be", [[0xfe, 0xff, 0xfe, 0xff, 0x00, 0x42]], "\uFEFFB"],
    ["utf-8", [[0x41], [0xef, 0xbb, 0xbf, 0x42]], "A\uFEFFB"],
    [
      "utf-16le",
      [
        [0x41, 0x00],
        [0xff, 0xfe, 0x42, 0x00],
      ],
      "A\uFEFFB",
    ],
    [
      "utf-16be",
      [
        [0x00, 0x41],
        [0xfe, 0xff, 0x00, 0x42],
      ],
      "A\uFEFFB",
    ],
    // Bytes that only LOOK like a BOM prefix are not silently dropped.
    ["utf-8", [[0xef], [0x41]], "\uFFFDA"],
    ["utf-16be", [[0xfe], [0xff, 0x41]], "\uFFFD"],
    // The UTF-16LE BOM is FF FE; FE FF decodes to U+FFFE and is kept.
    ["utf-16le", [[0xfe, 0xff, 0x41, 0x00]], "\uFFFEA"],
    // A carried unpaired high surrogate is the stream's FIRST output (as
    // U+FFFD), so the following chunk's BOM bytes are a literal U+FEFF.
    [
      "utf-16le",
      [
        [0x00, 0xd8],
        [0xff, 0xfe],
      ],
      "\uFFFD\uFEFF",
    ],
    [
      "utf-16be",
      [
        [0xd8, 0x00],
        [0xfe, 0xff],
      ],
      "\uFFFD\uFEFF",
    ],
    [
      "utf-16le",
      [
        [0x00, 0xd8],
        [0xff, 0xfe, 0x42, 0x00],
      ],
      "\uFFFD\uFEFFB",
    ],
  ])("%s %j -> %j", (encoding, chunks, expected) => {
    expect(decodeChunks(encoding, chunks)).toBe(expected);
  });

  it.each(["utf-8", "utf-16le", "utf-16be"])("%s: ignoreBOM keeps a split BOM", encoding => {
    const bom = { "utf-8": [0xef, 0xbb, 0xbf], "utf-16le": [0xff, 0xfe], "utf-16be": [0xfe, 0xff] }[encoding];
    const a = { "utf-8": [0x41], "utf-16le": [0x41, 0x00], "utf-16be": [0x00, 0x41] }[encoding];
    const d = new TextDecoder(encoding, { ignoreBOM: true });
    let out = d.decode(Uint8Array.of(bom[0]), { stream: true });
    out += d.decode(Uint8Array.from(bom.slice(1).concat(a)));
    expect(out).toBe("\uFEFFA");
  });

  it("each new stream on the same decoder strips its own BOM", () => {
    const d = new TextDecoder();
    expect(d.decode(Uint8Array.of(0xef), { stream: true })).toBe("");
    expect(d.decode(Uint8Array.of(0xbb, 0xbf, 0x41))).toBe("A");
    // The flushing decode ended the stream, so the next decode starts a new
    // one whose (again split) BOM must also be stripped.
    expect(d.decode(Uint8Array.of(0xef, 0xbb), { stream: true })).toBe("");
    expect(d.decode(Uint8Array.of(0xbf, 0x42))).toBe("B");
  });

  // https://github.com/oven-sh/bun/issues/25495
  it("only the first U+FEFF of a stream is the BOM", () => {
    // The BOM of the first chunk is consumed; the same three bytes in later
    // chunks of the SAME stream are a literal U+FEFF.
    const d = new TextDecoder();
    expect(d.decode(Uint8Array.of(0xef, 0xbb, 0xbf), { stream: true })).toBe("");
    expect(d.decode(Uint8Array.of(0xef, 0xbb, 0xbf), { stream: true })).toBe("\uFEFF");
    expect(d.decode(Uint8Array.of(0xef, 0xbb, 0xbf))).toBe("\uFEFF");

    // A BOM assembled from two chunks is still consumed, not emitted.
    const n = new TextDecoder();
    expect(n.decode(Uint8Array.of(0xef), { stream: true })).toBe("");
    expect(n.decode(Uint8Array.of(0xbb, 0xbf), { stream: true })).toBe("");
    expect(n.decode()).toBe("");
  });

  // A fatal decode() that throws never reaches the spec's "serialize I/O
  // queue" step, so it must not spend the stream's one suppressible U+FEFF.
  it.each([
    ["utf-16le", [0x00, 0xdc], [0xff, 0xfe, 0x42, 0x00]],
    ["utf-8", [0xff], [0xef, 0xbb, 0xbf, 0x42]],
  ])("%s: a fatal chunk that throws does not consume the stream's BOM", (encoding, bad, next) => {
    const d = new TextDecoder(encoding, { fatal: true });
    expect(() => d.decode(Uint8Array.from(bad), { stream: true })).toThrow(TypeError);
    expect(d.decode(Uint8Array.from(next))).toBe("B");
  });

  // https://encoding.spec.whatwg.org/#dom-textdecoder-decode: the `input`
  // argument is converted before step 1, so a non-BufferSource input throws a
  // TypeError without touching `do not flush` (and therefore `BOM seen`).
  it("a decode() with an invalid input does not end the stream", () => {
    const d = new TextDecoder();
    expect(d.decode(Uint8Array.of(0x41), { stream: true })).toBe("A");
    expect(() => d.decode(123)).toThrow(TypeError);
    // Still the same stream: its suppressible U+FEFF was already spent on "A".
    expect(d.decode(Uint8Array.of(0xef, 0xbb, 0xbf, 0x42))).toBe("\uFEFFB");
  });
});

it("truncated sequences", () => {
  const assert_equals = (a, b) => expect(a).toBe(b);

  // Truncated sequences
  assert_equals(new TextDecoder().decode(new Uint8Array([0xf0])), "\uFFFD");
  assert_equals(new TextDecoder().decode(new Uint8Array([0xf0, 0x9f])), "\uFFFD");
  assert_equals(new TextDecoder().decode(new Uint8Array([0xf0, 0x9f, 0x92])), "\uFFFD");

  // Errors near end-of-queue
  assert_equals(new TextDecoder().decode(new Uint8Array([0xf0, 0x9f, 0x41])), "\uFFFDA");
  assert_equals(new TextDecoder().decode(new Uint8Array([0xf0, 0x41, 0x42])), "\uFFFDAB");
  assert_equals(new TextDecoder().decode(new Uint8Array([0xf0, 0x41, 0xf0])), "\uFFFDA\uFFFD");
  assert_equals(new TextDecoder().decode(new Uint8Array([0xf0, 0x8f, 0x92])), "\uFFFD\uFFFD\uFFFD");
});

it.each([
  [0xc0, 0x80], // 192
  [0xc1, 0x80], // 193
])(`should handle %d`, (...input) => {
  const decoder = new TextDecoder();
  const output = decoder.decode(Uint8Array.from(input));
  expect(output).toBe("\uFFFD\uFFFD");
});

// https://github.com/nodejs/node/blob/492032f34c1bf264eae01dc5cdfc77c8032b8552/test/fixtures/wpt/encoding/textdecoder-fatal-streaming.any.js#L4
it("Fatal flag, non-streaming cases", () => {
  [
    { encoding: "utf-8", sequence: [0xc0] },
    { encoding: "utf-16le", sequence: [0x00] },
    { encoding: "utf-16be", sequence: [0x00] },
  ].forEach(function (testCase) {
    expect(
      () => {
        var decoder = new TextDecoder(testCase.encoding, { fatal: true });
        decoder.decode(new Uint8Array(testCase.sequence));
      },
      "Unterminated " + testCase.encoding + " sequence should throw if fatal flag is set",
    ).toThrow();

    expect(
      new TextDecoder(testCase.encoding).decode(new Uint8Array([testCase.sequence])),
      "Unterminated UTF-8 sequence should emit replacement character if fatal flag is unset",
    ).toBe("\uFFFD");
  });
});

describe("stream", () => {
  {
    // https://github.com/nodejs/node/blob/492032f34c1bf264eae01dc5cdfc77c8032b8552/test/fixtures/wpt/encoding/textdecoder-arguments.any.js#L3
    it("TextDecoder decode() with explicit undefined", () => {
      const decoder = new TextDecoder();

      // Just passing nothing.
      expect(decoder.decode(undefined), "Undefined as first arg should decode to empty string").toBe("");

      // Flushing an incomplete sequence.
      decoder.decode(new Uint8Array([0xc9]), { stream: true });
      expect(decoder.decode(undefined), "Undefined as first arg should flush the stream").toBe("\uFFFD");
    });

    it("TextDecoder decode() with undefined and undefined", () => {
      const decoder = new TextDecoder();

      // Just passing nothing.
      expect(decoder.decode(undefined, undefined), "Undefined as first arg should decode to empty string").toBe("");

      // Flushing an incomplete sequence.
      decoder.decode(new Uint8Array([0xc9]), { stream: true });
      expect(decoder.decode(undefined, undefined), "Undefined as first arg should flush the stream").toBe("\uFFFD");
    });

    it("TextDecoder decode() with undefined and options", () => {
      const decoder = new TextDecoder();

      // Just passing nothing.
      expect(decoder.decode(undefined, {}), "Undefined as first arg should decode to empty string").toBe("");

      // Flushing an incomplete sequence.
      decoder.decode(new Uint8Array([0xc9]), { stream: true });
      expect(decoder.decode(undefined, {}), "Undefined as first arg should flush the stream").toBe("\uFFFD");
    });
  }
  {
    // https://github.com/nodejs/node/blob/492032f34c1bf264eae01dc5cdfc77c8032b8552/test/fixtures/wpt/encoding/textdecoder-eof.any.js#L14
    it("TextDecoder end-of-queue handling using stream: true", () => {
      const decoder = new TextDecoder();
      decoder.decode(new Uint8Array([0xf0]), { stream: true });
      expect(decoder.decode()).toBe("\uFFFD");

      decoder.decode(new Uint8Array([0xf0]), { stream: true });
      decoder.decode(new Uint8Array([0x9f]), { stream: true });
      expect(decoder.decode()).toBe("\uFFFD");

      decoder.decode(new Uint8Array([0xf0, 0x9f]), { stream: true });
      expect(decoder.decode(new Uint8Array([0x92]))).toBe("\uFFFD");

      expect(decoder.decode(new Uint8Array([0xf0, 0x9f]), { stream: true })).toBe("");
      expect(decoder.decode(new Uint8Array([0x41]), { stream: true })).toBe("\uFFFDA");
      expect(decoder.decode()).toBe("");

      expect(decoder.decode(new Uint8Array([0xf0, 0x41, 0x42]), { stream: true })).toBe("\uFFFDAB");
      expect(decoder.decode()).toBe("");

      expect(decoder.decode(new Uint8Array([0xf0, 0x41, 0xf0]), { stream: true })).toBe("\uFFFDA");
      expect(decoder.decode()).toBe("\uFFFD");

      expect(decoder.decode(new Uint8Array([0xf0]), { stream: true })).toBe("");
      expect(decoder.decode(new Uint8Array([0x8f]), { stream: true })).toBe("\uFFFD\uFFFD");
      expect(decoder.decode(new Uint8Array([0x92]), { stream: true })).toBe("\uFFFD");
      expect(decoder.decode()).toBe("");
    });
  }
  {
    // https://github.com/WebKit/WebKit/blob/443e796d1538654c34f2690e39600c70c8052b63/LayoutTests/imported/w3c/web-platform-tests/encoding/textdecoder-fatal-streaming.any.js#L22
    it("Fatal flag, streaming cases", () => {
      var decoder = new TextDecoder("utf-16le", { fatal: true });
      var odd = new Uint8Array([0x00]);
      var even = new Uint8Array([0x00, 0x00]);

      expect(decoder.decode(odd, { stream: true })).toBe("");
      expect(decoder.decode(odd, { stream: true })).toBe("\u0000");

      expect(() => {
        decoder.decode(even, { stream: true });
        decoder.decode(odd);
      }).toThrow(TypeError);

      expect(() => {
        decoder.decode(odd, { stream: true });
        decoder.decode(even);
      }).toThrow(TypeError);

      expect(decoder.decode(even, { stream: true })).toBe("\u0000");
      expect(() => {
        decoder.decode(odd);
      }).toThrow(TypeError);
      // expect(decoder.decode(odd)).toBe("\u0000");
    });
  }
  {
    // https://github.com/nodejs/node/blob/926503b66910d9ec895c33c7fd94361fd78dea72/test/fixtures/wpt/encoding/textdecoder-streaming.any.js#L6
    // META: title=Encoding API: Streaming decode
    // META: global=window,worker
    // META: script=resources/encodings.js
    // META: script=/common/sab.js

    var string = "\x00123ABCabc\x80\xFF\u0100\u1000\uFFFD\uD800\uDC00\uDBFF\uDFFF";
    var octets = {
      "utf-8": [
        0x00, 0x31, 0x32, 0x33, 0x41, 0x42, 0x43, 0x61, 0x62, 0x63, 0xc2, 0x80, 0xc3, 0xbf, 0xc4, 0x80, 0xe1, 0x80,
        0x80, 0xef, 0xbf, 0xbd, 0xf0, 0x90, 0x80, 0x80, 0xf4, 0x8f, 0xbf, 0xbf,
      ],
      "utf-16le": [
        0x00, 0x00, 0x31, 0x00, 0x32, 0x00, 0x33, 0x00, 0x41, 0x00, 0x42, 0x00, 0x43, 0x00, 0x61, 0x00, 0x62, 0x00,
        0x63, 0x00, 0x80, 0x00, 0xff, 0x00, 0x00, 0x01, 0x00, 0x10, 0xfd, 0xff, 0x00, 0xd8, 0x00, 0xdc, 0xff, 0xdb,
        0xff, 0xdf,
      ],
      "utf-16be": [
        0x00, 0x00, 0x00, 0x31, 0x00, 0x32, 0x00, 0x33, 0x00, 0x41, 0x00, 0x42, 0x00, 0x43, 0x00, 0x61, 0x00, 0x62,
        0x00, 0x63, 0x00, 0x80, 0x00, 0xff, 0x01, 0x00, 0x10, 0x00, 0xff, 0xfd, 0xd8, 0x00, 0xdc, 0x00, 0xdb, 0xff,
        0xdf, 0xff,
      ],
    };

    [ArrayBuffer, SharedArrayBuffer].forEach(arrayBufferOrSharedArrayBuffer => {
      Object.keys(octets).forEach(function (encoding) {
        for (var len = 1; len <= 5; ++len) {
          it(
            "Streaming decode: " + encoding + ", " + len + " byte window (" + arrayBufferOrSharedArrayBuffer.name + ")",
            () => {
              var encoded = octets[encoding];

              var out = "";
              var decoder = new TextDecoder(encoding);
              for (var i = 0; i < encoded.length; i += len) {
                var sub = [];
                for (var j = i; j < encoded.length && j < i + len; ++j) {
                  sub.push(encoded[j]);
                }
                var uintArray = new Uint8Array(new arrayBufferOrSharedArrayBuffer(sub.length));
                uintArray.set(sub);
                out += decoder.decode(uintArray, { stream: true });
              }
              out += decoder.decode();
              expect(out).toEqual(string);
            },
          );
        }
      });

      it(`Streaming decode: UTF-8 chunk tests (${arrayBufferOrSharedArrayBuffer.name})`, () => {
        function bytes(byteArray) {
          const view = new Uint8Array(new arrayBufferOrSharedArrayBuffer(byteArray.length));
          view.set(byteArray);
          return view;
        }

        const decoder = new TextDecoder();

        expect(decoder.decode(bytes([0xc1]), { stream: true })).toEqual("\uFFFD");
        expect(decoder.decode()).toEqual("");

        expect(decoder.decode(bytes([0xf5]), { stream: true })).toEqual("\uFFFD");
        expect(decoder.decode()).toEqual("");

        expect(decoder.decode(bytes([0xe0, 0x41]), { stream: true })).toEqual("\uFFFDA");
        expect(decoder.decode(bytes([0x42]))).toEqual("B");

        expect(decoder.decode(bytes([0xe0, 0x80]), { stream: true })).toEqual("\uFFFD\uFFFD");
        expect(decoder.decode(bytes([0x80]))).toEqual("\uFFFD");

        expect(decoder.decode(bytes([0xed, 0xa0]), { stream: true })).toEqual("\uFFFD\uFFFD");
        expect(decoder.decode(bytes([0x80]))).toEqual("\uFFFD");

        expect(decoder.decode(bytes([0xf0, 0x41]), { stream: true })).toEqual("\uFFFDA");
        expect(decoder.decode(bytes([0x42]), { stream: true })).toEqual("B");
        expect(decoder.decode(bytes([0x43]))).toEqual("C");

        expect(decoder.decode(bytes([0xf0, 0x80]), { stream: true })).toEqual("\uFFFD\uFFFD");
        expect(decoder.decode(bytes([0x80]), { stream: true })).toEqual("\uFFFD");
        expect(decoder.decode(bytes([0x80]))).toEqual("\uFFFD");

        expect(decoder.decode(bytes([0xf4, 0xa0]), { stream: true })).toEqual("\uFFFD\uFFFD");
        expect(decoder.decode(bytes([0x80]), { stream: true })).toEqual("\uFFFD");
        expect(decoder.decode(bytes([0x80]))).toEqual("\uFFFD");

        expect(decoder.decode(bytes([0xf0, 0x90, 0x41]), { stream: true })).toEqual("\uFFFDA");
        expect(decoder.decode(bytes([0x42]))).toEqual("B");

        // 4-byte UTF-8 sequences always correspond to non-BMP characters. Here
        // we make sure that, although the first 3 bytes are enough to emit the
        // lead surrogate, it only gets emitted when the fourth byte is read.
        expect(decoder.decode(bytes([0xf0, 0x9f, 0x92]), { stream: true })).toEqual("");
        expect(decoder.decode(bytes([0xa9]))).toEqual("\u{1F4A9}");
      });
    });
  }
});

it("should not crash with a getter that throws", () => {
  expect(() =>
    new TextDecoder().decode(new Uint8Array(32), {
      get stream() {
        throw new Error("stream get error");
      },
    }),
  ).toThrowErrorMatchingInlineSnapshot(`"stream get error"`);
});

it("reads the input after the options.stream getter runs", () => {
  // The Encoding spec processes options before pushing a copy of the input to
  // the I/O queue, and Node.js matches that: a `stream` getter that detaches
  // the input buffer causes decode() to see an empty input. Previously Bun
  // cached the byte pointer before evaluating the getter and then read through
  // it afterwards — a stale pointer into memory that no longer belongs to the
  // input buffer.
  const buf = new Uint8Array(300);
  for (let i = 0; i < buf.length; i += 3) {
    buf[i] = 0xe2;
    buf[i + 1] = 0x82;
    buf[i + 2] = 0xac;
  }
  let ran = 0;
  const result = new TextDecoder().decode(buf, {
    get stream() {
      ran++;
      const transferred = buf.buffer.transfer();
      // Overwrite the transferred backing store so that if decode() still
      // reads through the old pointer it cannot coincidentally produce "".
      new Uint8Array(transferred).fill(0x41);
      return false;
    },
  });
  expect(ran).toBe(1);
  expect(buf.byteLength).toBe(0);
  expect(result).toBe("");
});

it("sees writes made by the options.stream getter", () => {
  // Conversely, mutations the getter makes to a still-attached buffer must be
  // visible to the decoder — the bytes are read after the getter runs.
  const buf = new Uint8Array(4).fill(0x41); // "AAAA"
  const result = new TextDecoder().decode(buf, {
    get stream() {
      buf.set([0x42, 0x42, 0x42, 0x42]); // "BBBB"
      return false;
    },
  });
  expect(result).toBe("BBBB");
});

it("decodes a stable snapshot of a Uint8Array over a SharedArrayBuffer while another thread writes to it", async () => {
  using dir = tempDir("text-decoder-shared", {
    "index.js": `
      const N = 4096;
      const dataSab = new SharedArrayBuffer(N);
      const flagSab = new SharedArrayBuffer(4);
      const data = new Uint8Array(dataSab);
      const flag = new Int32Array(flagSab);
      data.fill(0x61);
      const worker = new Worker(new URL("./worker.js", import.meta.url).href);
      const ready = new Promise((resolve, reject) => {
        worker.onmessage = resolve;
        worker.onerror = reject;
      });
      worker.postMessage({ dataSab, flagSab });
      await ready;
      const decoder = new TextDecoder();
      const allowed = new Set([0x61, 0x3042, 0xfffd]);
      let bad = -1;
      for (let i = 0; i < 10000 && bad < 0; i++) {
        const out = decoder.decode(data);
        const limit = Math.min(4, out.length);
        for (let j = 0; j < limit; j++) {
          const code = out.charCodeAt(j);
          if (!allowed.has(code)) {
            bad = code;
            break;
          }
        }
      }
      Atomics.store(flag, 0, 1);
      worker.terminate();
      console.log(bad < 0 ? "consistent" : "unexpected code unit 0x" + bad.toString(16));
      if (bad >= 0) process.exitCode = 1;
    `,
    "worker.js": `
      self.onmessage = function (event) {
        const data = new Uint8Array(event.data.dataSab);
        const flag = new Int32Array(event.data.flagSab);
        postMessage("ready");
        let phase = 0;
        while (Atomics.load(flag, 0) === 0) {
          if (phase === 0) {
            data[0] = 0xe3;
            data[1] = 0x81;
            data[2] = 0x82;
            phase = 1;
          } else {
            data[0] = 0x61;
            data[1] = 0x61;
            data[2] = 0x61;
            phase = 0;
          }
        }
      };
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(normalizeBunSnapshot(stdout)).toBe("consistent");
  expect(exitCode).toBe(0);
});

it.each(["utf-16le", "utf-16be"])(
  "TextDecoder(%s).decode() should not leak the output buffer",
  encoding => {
    const unit = encoding === "utf-16le" ? [0x61, 0x00] : [0x00, 0x61];
    const CODE_UNITS = 16 * 1024;
    const input = new Uint8Array(CODE_UNITS * 2);
    for (let i = 0; i < CODE_UNITS; i++) {
      input[i * 2] = unit[0];
      input[i * 2 + 1] = unit[1];
    }
    const expected = Buffer.alloc(CODE_UNITS, "a").toString();
    const decoder = new TextDecoder(encoding);

    // Sanity check.
    expect(decoder.decode(input)).toBe(expected);

    const run = batches => {
      for (let i = 0; i < batches; i++) {
        for (let j = 0; j < 128; j++) decoder.decode(input);
        Bun.gc();
      }
      Bun.gc(true);
    };

    // Warm up so allocator arenas / JIT reach steady state, then snapshot RSS.
    run(2);
    const before = process.memoryUsage.rss();

    // Prior to the fix each call leaked ~CODE_UNITS * 2 bytes = 32 KiB, so 3072
    // calls leaked ~96 MiB regardless of GC.
    run(24);
    const after = process.memoryUsage.rss();

    const deltaMiB = (after - before) / 1024 / 1024;
    // ASAN's quarantine retains freed allocations (default 256 MB) so the delta
    // runs higher under bun-asan even with the fix; widen the threshold there.
    expect(deltaMiB).toBeLessThan(isASAN ? 128 : 48);
  },
  30_000,
); // 3072 decodes + repeated Bun.gc(true) take ~4s under ASAN.
