import { describe, expect, it } from "bun:test";
import { gc as gcTrace, withoutAggressiveGC } from "harness";

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
  });
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
  });

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
    });
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
