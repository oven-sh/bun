//#FILE: test-whatwg-url-custom-searchparams-keys.js
//#SHA1: 06abe929cfe842fcdd80b44cee8a0092358e5fdf
//-----------------
"use strict";

// Tests below are not from WPT.

describe("URLSearchParams keys", () => {
  let params;
  let keys;

  beforeEach(() => {
    params = new URLSearchParams("a=b&c=d");
    keys = params.keys();
  });

  test("keys iterator is a function and returns self", () => {
    expect(typeof keys[Symbol.iterator]).toBe("function");
    expect(keys[Symbol.iterator]()).toBe(keys);
  });

  test("keys iterator returns correct values", () => {
    expect(keys.next()).toEqual({
      value: "a",
      done: false,
    });
    expect(keys.next()).toEqual({
      value: "c",
      done: false,
    });
    expect(keys.next()).toEqual({
      value: undefined,
      done: true,
    });
    expect(keys.next()).toEqual({
      value: undefined,
      done: true,
    });
  });

  test("keys.next() throws with invalid this", () => {
    expect(() => {
      keys.next.call(undefined);
    }).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_THIS",
        name: "TypeError",
        message: expect.any(String),
      }),
    );
  });

  test("params.keys() throws with invalid this", () => {
    expect(() => {
      params.keys.call(undefined);
    }).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_THIS",
        name: "TypeError",
        message: expect.any(String),
      }),
    );
  });
});

//<#END_FILE: test-whatwg-url-custom-searchparams-keys.js
