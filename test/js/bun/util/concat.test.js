import { concatArrayBuffers } from "bun";
import { describe, expect, it } from "bun:test";

describe("concat", () => {
  function polyfill(chunks) {
    var size = 0;
    for (const chunk of chunks) {
      size += chunk.byteLength;
    }
    var buffer = new ArrayBuffer(size);
    var view = new Uint8Array(buffer);
    var offset = 0;
    for (const chunk of chunks) {
      view.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return buffer;
  }

  function concatToString(chunks) {
    return Array.from(concatArrayBuffers(chunks, Infinity, true)).join("");
  }

  function polyfillToString(chunks) {
    return Array.from(new Uint8Array(polyfill(chunks))).join("");
  }

  it("works with one element", () => {
    expect(concatToString([new Uint8Array([123])])).toBe(polyfillToString([new Uint8Array([123])]));
  });

  it("works with two elements", () => {
    expect(concatToString([Uint8Array.from([123]), Uint8Array.from([456])])).toBe(
      polyfillToString([Uint8Array.from([123]), Uint8Array.from([456])]),
    );
  });

  it("works with mix of ArrayBuffer and TypedArray elements", () => {
    expect(concatToString([Uint8Array.from([123]).buffer, Uint8Array.from([456])])).toBe(
      polyfillToString([Uint8Array.from([123]), Uint8Array.from([456])]),
    );
  });

  it("can be trimmed to a max length", () => {
    const a = Uint8Array.from([1, 2, 3]);
    const b = Uint8Array.from([4, 5, 6]);
    expect(concatArrayBuffers([a, b], 4, true)).toEqual(Uint8Array.from([1, 2, 3, 4]));
  });

  it("can be trimmed to a max length (ArrayBuffer)", () => {
    const a = Uint8Array.from([1, 2, 3]);
    const b = Uint8Array.from([4, 5, 6]);
    expect(concatArrayBuffers([a, b], 4)).toEqual(Uint8Array.from([1, 2, 3, 4]).buffer);
  });

  const all = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  it.each([
    [0, []],
    [3, [1, 2, 3]],
    [3.9, [1, 2, 3]],
    [2 ** 32 - 1, all],
    [2 ** 32, all],
    [2 ** 32 + 3, all],
    [2 ** 33 + 7, all],
    [2 ** 53, all],
    [2 ** 64, all],
    [Number.MAX_VALUE, all],
    [Infinity, all],
  ])("trims to a max length of %d", (maxLength, bytes) => {
    const chunks = [Uint8Array.from([1, 2, 3, 4, 5]), Uint8Array.from([6, 7, 8, 9, 10])];
    const expected = Uint8Array.from(bytes);
    expect(concatArrayBuffers(chunks, maxLength, true)).toEqual(expected);
    expect(concatArrayBuffers(chunks, maxLength, false)).toEqual(expected.buffer);
    expect(concatArrayBuffers(chunks, maxLength)).toEqual(expected.buffer);
  });

  it.each([2 ** 32 + 3, 2 ** 33 + 7])("does not wrap a max length of %d that is shorter than the input", maxLength => {
    // 64 GiB of input from one 64 MiB view.
    const chunks = new Array(1024).fill(new Uint8Array(64 * 1024 * 1024));
    // The result would be longer than the largest ArrayBuffer, as it is with no max length.
    expect(() => concatArrayBuffers(chunks, maxLength)).toThrow("Failed to allocate ArrayBuffer");
    expect(() => concatArrayBuffers(chunks, maxLength, true)).toThrow("Failed to allocate ArrayBuffer");
  });
});
