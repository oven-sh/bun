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
});
