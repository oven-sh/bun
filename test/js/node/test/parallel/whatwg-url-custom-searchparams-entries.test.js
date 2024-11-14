//#FILE: test-whatwg-url-custom-searchparams-entries.js
//#SHA1: 4ba98b18a2f44b46ac4e6e0ee5179e97083100be
//-----------------
"use strict";

// Tests below are not from WPT.
test("URLSearchParams entries", () => {
  const params = new URLSearchParams("a=b&c=d");
  const entries = params.entries();

  expect(typeof entries[Symbol.iterator]).toBe("function");
  expect(entries[Symbol.iterator]()).toBe(entries);

  expect(entries.next()).toEqual({
    value: ["a", "b"],
    done: false,
  });

  expect(entries.next()).toEqual({
    value: ["c", "d"],
    done: false,
  });

  expect(entries.next()).toEqual({
    value: undefined,
    done: true,
  });

  expect(entries.next()).toEqual({
    value: undefined,
    done: true,
  });
});

test("entries.next() throws with invalid this", () => {
  const params = new URLSearchParams("a=b&c=d");
  const entries = params.entries();

  expect(() => {
    entries.next.call(undefined);
  }).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_THIS",
      name: "TypeError",
      message: expect.any(String),
    }),
  );
});

test("params.entries() throws with invalid this", () => {
  expect(() => {
    URLSearchParams.prototype.entries.call(undefined);
  }).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_THIS",
      name: "TypeError",
      message: expect.any(String),
    }),
  );
});

//<#END_FILE: test-whatwg-url-custom-searchparams-entries.js
