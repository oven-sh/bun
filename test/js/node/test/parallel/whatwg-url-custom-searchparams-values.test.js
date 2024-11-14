//#FILE: test-whatwg-url-custom-searchparams-values.js
//#SHA1: 7df0ccf30363d589199bb3f71c68e5559e9e4f59
//-----------------
"use strict";

// Tests below are not from WPT.

test("URLSearchParams values() method", () => {
  const params = new URLSearchParams("a=b&c=d");
  const values = params.values();

  expect(typeof values[Symbol.iterator]).toBe("function");
  expect(values[Symbol.iterator]()).toBe(values);
  expect(values.next()).toEqual({
    value: "b",
    done: false,
  });
  expect(values.next()).toEqual({
    value: "d",
    done: false,
  });
  expect(values.next()).toEqual({
    value: undefined,
    done: true,
  });
  expect(values.next()).toEqual({
    value: undefined,
    done: true,
  });

  expect(() => {
    values.next.call(undefined);
  }).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_THIS",
      name: "TypeError",
      message: expect.any(String),
    }),
  );

  expect(() => {
    params.values.call(undefined);
  }).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_THIS",
      name: "TypeError",
      message: expect.any(String),
    }),
  );
});

//<#END_FILE: test-whatwg-url-custom-searchparams-values.js
