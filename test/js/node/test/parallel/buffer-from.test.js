//#FILE: test-buffer-from.js
//#SHA1: fdbb08fe98b94d1566ade587f17bb970130e1edd
//-----------------
"use strict";

const { runInNewContext } = require("vm");

const checkString = "test";

const check = Buffer.from(checkString);

class MyString extends String {
  constructor() {
    super(checkString);
  }
}

class MyPrimitive {
  [Symbol.toPrimitive]() {
    return checkString;
  }
}

class MyBadPrimitive {
  [Symbol.toPrimitive]() {
    return 1;
  }
}

test("Buffer.from with various string-like inputs", () => {
  expect(Buffer.from(new String(checkString))).toStrictEqual(check);
  expect(Buffer.from(new MyString())).toStrictEqual(check);
  expect(Buffer.from(new MyPrimitive())).toStrictEqual(check);
  // expect(Buffer.from(runInNewContext("new String(checkString)", { checkString }))).toStrictEqual(check); //TODO:
});

describe("Buffer.from with invalid inputs", () => {
  const invalidInputs = [
    {},
    new Boolean(true),
    {
      valueOf() {
        return null;
      },
    },
    {
      valueOf() {
        return undefined;
      },
    },
    { valueOf: null },
    { __proto__: null },
    new Number(true),
    new MyBadPrimitive(),
    Symbol(),
    5n,
    (one, two, three) => {},
    undefined,
    null,
  ];

  for (const input of invalidInputs) {
    test(`${Bun.inspect(input)}`, () => {
      expect(() => Buffer.from(input)).toThrow(
        expect.objectContaining({
          // code: "ERR_INVALID_ARG_TYPE", //TODO:
          name: "TypeError",
          message: expect.any(String),
        }),
      );
      expect(() => Buffer.from(input, "hex")).toThrow(
        expect.objectContaining({
          // code: "ERR_INVALID_ARG_TYPE", //TODO:
          name: "TypeError",
          message: expect.any(String),
        }),
      );
    });
  }
});

test("Buffer.allocUnsafe and Buffer.from with valid inputs", () => {
  expect(() => Buffer.allocUnsafe(10)).not.toThrow();
  expect(() => Buffer.from("deadbeaf", "hex")).not.toThrow();
});

test("Buffer.copyBytesFrom with Uint16Array", () => {
  const u16 = new Uint16Array([0xffff]);
  const b16 = Buffer.copyBytesFrom(u16);
  u16[0] = 0;
  expect(b16.length).toBe(2);
  expect(b16[0]).toBe(255);
  expect(b16[1]).toBe(255);
});

test("Buffer.copyBytesFrom with Uint16Array and offset", () => {
  const u16 = new Uint16Array([0, 0xffff]);
  const b16 = Buffer.copyBytesFrom(u16, 1, 5);
  u16[0] = 0xffff;
  u16[1] = 0;
  expect(b16.length).toBe(2);
  expect(b16[0]).toBe(255);
  expect(b16[1]).toBe(255);
});

test("Buffer.copyBytesFrom with Uint32Array", () => {
  const u32 = new Uint32Array([0xffffffff]);
  const b32 = Buffer.copyBytesFrom(u32);
  u32[0] = 0;
  expect(b32.length).toBe(4);
  expect(b32[0]).toBe(255);
  expect(b32[1]).toBe(255);
  expect(b32[2]).toBe(255);
  expect(b32[3]).toBe(255);
});

test("Buffer.copyBytesFrom with invalid inputs", () => {
  expect(() => Buffer.copyBytesFrom()).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
    }),
  );

  const invalidInputs = ["", Symbol(), true, false, {}, [], () => {}, 1, 1n, null, undefined];
  invalidInputs.forEach(notTypedArray => {
    expect(() => Buffer.copyBytesFrom(notTypedArray)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
      }),
    );
  });

  const invalidSecondArgs = ["", Symbol(), true, false, {}, [], () => {}, 1n];
  invalidSecondArgs.forEach(notANumber => {
    expect(() => Buffer.copyBytesFrom(new Uint8Array(1), notANumber)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
      }),
    );
  });

  const outOfRangeInputs = [-1, NaN, 1.1, -Infinity];
  outOfRangeInputs.forEach(outOfRange => {
    expect(() => Buffer.copyBytesFrom(new Uint8Array(1), outOfRange)).toThrow(
      expect.objectContaining({
        code: "ERR_OUT_OF_RANGE",
      }),
    );
  });

  invalidSecondArgs.forEach(notANumber => {
    expect(() => Buffer.copyBytesFrom(new Uint8Array(1), 0, notANumber)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
      }),
    );
  });

  outOfRangeInputs.forEach(outOfRange => {
    expect(() => Buffer.copyBytesFrom(new Uint8Array(1), 0, outOfRange)).toThrow(
      expect.objectContaining({
        code: "ERR_OUT_OF_RANGE",
      }),
    );
  });
});

//<#END_FILE: test-buffer-from.js
