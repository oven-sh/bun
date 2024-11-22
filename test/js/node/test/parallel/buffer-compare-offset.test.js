//#FILE: test-buffer-compare-offset.js
//#SHA1: 460e187ac1a40db0dbc00801ad68f1272d27c3cd
//-----------------
"use strict";

const assert = require("assert");

describe("Buffer.compare with offset", () => {
  const a = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
  const b = Buffer.from([5, 6, 7, 8, 9, 0, 1, 2, 3, 4]);

  test("basic comparison", () => {
    expect(a.compare(b)).toBe(-1);
  });

  test("comparison with default arguments", () => {
    expect(a.compare(b, 0)).toBe(-1);
    expect(() => a.compare(b, "0")).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
      }),
    );
    expect(a.compare(b, undefined)).toBe(-1);
  });

  test("comparison with specified ranges", () => {
    expect(a.compare(b, 0, undefined, 0)).toBe(-1);
    expect(a.compare(b, 0, 0, 0)).toBe(1);
    expect(() => a.compare(b, 0, "0", "0")).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
      }),
    );
    expect(a.compare(b, 6, 10)).toBe(1);
    expect(a.compare(b, 6, 10, 0, 0)).toBe(-1);
    expect(a.compare(b, 0, 0, 0, 0)).toBe(0);
    expect(a.compare(b, 1, 1, 2, 2)).toBe(0);
    expect(a.compare(b, 0, 5, 4)).toBe(1);
    expect(a.compare(b, 5, undefined, 1)).toBe(1);
    expect(a.compare(b, 2, 4, 2)).toBe(-1);
    expect(a.compare(b, 0, 7, 4)).toBe(-1);
    expect(a.compare(b, 0, 7, 4, 6)).toBe(-1);
  });

  test("invalid arguments", () => {
    expect(() => a.compare(b, 0, null)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
      }),
    );
    expect(() => a.compare(b, 0, { valueOf: () => 5 })).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
      }),
    );
    expect(() => a.compare(b, Infinity, -Infinity)).toThrow(
      expect.objectContaining({
        code: "ERR_OUT_OF_RANGE",
      }),
    );
    expect(a.compare(b, 0xff)).toBe(1);
    expect(() => a.compare(b, "0xff")).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
      }),
    );
    expect(() => a.compare(b, 0, "0xff")).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
      }),
    );
  });

  test("out of range arguments", () => {
    const oor = expect.objectContaining({ code: "ERR_OUT_OF_RANGE" });
    expect(() => a.compare(b, 0, 100, 0)).toThrow(oor);
    expect(() => a.compare(b, 0, 1, 0, 100)).toThrow(oor);
    expect(() => a.compare(b, -1)).toThrow(oor);
    expect(() => a.compare(b, 0, Infinity)).toThrow(oor);
    expect(() => a.compare(b, 0, 1, -1)).toThrow(oor);
    expect(() => a.compare(b, -Infinity, Infinity)).toThrow(oor);
  });

  test("missing target argument", () => {
    expect(() => a.compare()).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: expect.stringContaining('The "target" argument must be an instance of Buffer or Uint8Array'),
      }),
    );
  });
});

//<#END_FILE: test-buffer-compare-offset.js
