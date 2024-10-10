//#FILE: test-whatwg-url-custom-searchparams.js
//#SHA1: 8308ed9fc341a1caaadcf01653bd49b96cebf599
//-----------------
"use strict";

// Tests below are not from WPT.

const assert = require("assert");
const fixtures = require("../common/fixtures");

const serialized =
  "a=a&a=1&a=true&a=undefined&a=null&a=%EF%BF%BD" +
  "&a=%EF%BF%BD&a=%F0%9F%98%80&a=%EF%BF%BD%EF%BF%BD" +
  "&a=%5Bobject+Object%5D";
const values = ["a", 1, true, undefined, null, "\uD83D", "\uDE00", "\uD83D\uDE00", "\uDE00\uD83D", {}];
const normalizedValues = [
  "a",
  "1",
  "true",
  "undefined",
  "null",
  "\uFFFD",
  "\uFFFD",
  "\uD83D\uDE00",
  "\uFFFD\uFFFD",
  "[object Object]",
];

describe("WHATWG URL Custom SearchParams", () => {
  let m, sp;

  beforeEach(() => {
    m = new URL("http://example.org");
    sp = m.searchParams;
  });

  it("should not modify own symbols when accessing searchParams", () => {
    const ownSymbolsBeforeGetterAccess = Object.getOwnPropertySymbols(m);
    expect(sp).toBeDefined();
    expect(Object.getOwnPropertySymbols(m)).toEqual(ownSymbolsBeforeGetterAccess);
  });

  it("should initialize with empty search params", () => {
    expect(sp.toString()).toBe("");
    expect(m.search).toBe("");
  });

  it("should handle setting and deleting search params", () => {
    expect(sp.has("a")).toBe(false);
    values.forEach(i => sp.set("a", i));
    expect(sp.has("a")).toBe(true);
    expect(sp.get("a")).toBe("[object Object]");
    sp.delete("a");
    expect(sp.has("a")).toBe(false);
  });

  it("should handle appending search params", () => {
    m.search = "";
    expect(sp.toString()).toBe("");

    values.forEach(i => sp.append("a", i));
    expect(sp.has("a")).toBe(true);
    expect(sp.getAll("a").length).toBe(values.length);
    expect(sp.get("a")).toBe("a");

    expect(sp.toString()).toBe(serialized);
    expect(m.search).toBe(`?${serialized}`);
  });

  it("should update URL components when modifying search params", () => {
    sp.delete("a");
    values.forEach(i => sp.append("a", i));
    expect(m.href).toBe(`http://example.org/?${serialized}`);
    expect(m.toString()).toBe(`http://example.org/?${serialized}`);
    expect(m.toJSON()).toBe(`http://example.org/?${serialized}`);
  });

  it("should clear search params when setting href or search", () => {
    sp.delete("a");
    values.forEach(i => sp.append("a", i));
    m.href = "http://example.org";
    expect(m.href).toBe("http://example.org/");
    expect(sp.size).toBe(0);

    values.forEach(i => sp.append("a", i));
    m.search = "";
    expect(m.href).toBe("http://example.org/");
    expect(sp.size).toBe(0);
  });

  it("should update URL components when modifying pathname or hash", () => {
    sp.delete("a");
    values.forEach(i => sp.append("a", i));
    m.pathname = "/test";
    expect(m.href).toBe(`http://example.org/test?${serialized}`);
    m.pathname = "";

    sp.delete("a");
    values.forEach(i => sp.append("a", i));
    m.hash = "#test";
    expect(m.href).toBe(`http://example.org/?${serialized}#test`);
    m.hash = "";
  });

  it("should have correct iteration behavior", () => {
    expect(sp[Symbol.iterator]).toBe(sp.entries);

    sp.delete("a");
    values.forEach(i => sp.append("a", i));

    let n = 0;
    for (const [key, val] of sp) {
      expect(key).toBe("a");
      expect(val).toBe(normalizedValues[n]);
      n++;
    }

    n = 0;
    for (const key of sp.keys()) {
      expect(key).toBe("a");
      n++;
    }

    n = 0;
    for (const val of sp.values()) {
      expect(val).toBe(normalizedValues[n]);
      n++;
    }

    n = 0;
    sp.forEach(function (val, key, obj) {
      expect(this).toBeUndefined();
      expect(key).toBe("a");
      expect(val).toBe(normalizedValues[n]);
      expect(obj).toBe(sp);
      n++;
    });

    sp.forEach(function () {
      expect(this).toBe(m);
    }, m);
  });

  it("should throw for invalid forEach arguments", () => {
    expect(() => sp.forEach()).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
      }),
    );
    expect(() => sp.forEach(1)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
      }),
    );
  });

  it("should handle setting search directly", () => {
    m.search = "?a=a&b=b";
    expect(sp.toString()).toBe("a=a&b=b");
  });

  it("should pass URL search params tests", () => {
    const tests = require(fixtures.path("url-searchparams.js"));

    for (const [input, expected, parsed] of tests) {
      if (input[0] !== "?") {
        const sp = new URLSearchParams(input);
        expect(String(sp)).toBe(expected);
        expect(Array.from(sp)).toEqual(parsed);

        m.search = input;
        expect(String(m.searchParams)).toBe(expected);
        expect(Array.from(m.searchParams)).toEqual(parsed);
      }

      {
        const sp = new URLSearchParams(`?${input}`);
        expect(String(sp)).toBe(expected);
        expect(Array.from(sp)).toEqual(parsed);

        m.search = `?${input}`;
        expect(String(m.searchParams)).toBe(expected);
        expect(Array.from(m.searchParams)).toEqual(parsed);
      }
    }
  });
});

//<#END_FILE: test-whatwg-url-custom-searchparams.js
