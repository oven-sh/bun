//#FILE: test-buffer-readfloat.js
//#SHA1: 08f4183be3d17e88f259da252bbc6fea2a06294e
//-----------------
"use strict";

// Test 32 bit float
test("32 bit float", () => {
  const buffer = Buffer.alloc(4);

  buffer[0] = 0;
  buffer[1] = 0;
  buffer[2] = 0x80;
  buffer[3] = 0x3f;
  expect(buffer.readFloatBE(0)).toBeCloseTo(4.600602988224807e-41);
  expect(buffer.readFloatLE(0)).toBe(1);

  buffer[0] = 0;
  buffer[1] = 0;
  buffer[2] = 0;
  buffer[3] = 0xc0;
  expect(buffer.readFloatBE(0)).toBeCloseTo(2.6904930515036488e-43);
  expect(buffer.readFloatLE(0)).toBe(-2);

  buffer[0] = 0xff;
  buffer[1] = 0xff;
  buffer[2] = 0x7f;
  buffer[3] = 0x7f;
  expect(Number.isNaN(buffer.readFloatBE(0))).toBe(true);
  expect(buffer.readFloatLE(0)).toBeCloseTo(3.4028234663852886e38);

  buffer[0] = 0xab;
  buffer[1] = 0xaa;
  buffer[2] = 0xaa;
  buffer[3] = 0x3e;
  expect(buffer.readFloatBE(0)).toBeCloseTo(-1.2126478207002966e-12);
  expect(buffer.readFloatLE(0)).toBeCloseTo(0.3333333432674408);

  buffer[0] = 0;
  buffer[1] = 0;
  buffer[2] = 0;
  buffer[3] = 0;
  expect(buffer.readFloatBE(0)).toBe(0);
  expect(buffer.readFloatLE(0)).toBe(0);
  expect(1 / buffer.readFloatLE(0) >= 0).toBe(true);

  buffer[3] = 0x80;
  expect(buffer.readFloatBE(0)).toBeCloseTo(1.793662034335766e-43);
  expect(buffer.readFloatLE(0)).toBe(-0);
  expect(1 / buffer.readFloatLE(0) < 0).toBe(true);

  buffer[0] = 0;
  buffer[1] = 0;
  buffer[2] = 0x80;
  buffer[3] = 0x7f;
  expect(buffer.readFloatBE(0)).toBeCloseTo(4.609571298396486e-41);
  expect(buffer.readFloatLE(0)).toBe(Infinity);

  buffer[0] = 0;
  buffer[1] = 0;
  buffer[2] = 0x80;
  buffer[3] = 0xff;
  expect(buffer.readFloatBE(0)).toBeCloseTo(4.627507918739843e-41);
  expect(buffer.readFloatLE(0)).toBe(-Infinity);
});

["readFloatLE", "readFloatBE"].forEach(fn => {
  const buffer = Buffer.alloc(4);

  test("works", () => {
    // Verify that default offset works fine.
    expect(() => buffer[fn](undefined)).not.toThrow();
    expect(() => buffer[fn]()).not.toThrow();
  });

  ["", "0", null, {}, [], () => {}, true, false].forEach(off => {
    test(`${fn}(${off})`, () => {
      expect(() => buffer[fn](off)).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );
    });
  });

  [Infinity, -1, 1].forEach(offset => {
    test(`${fn}(${offset})`, () => {
      expect(() => buffer[fn](offset)).toThrow(
        expect.objectContaining({
          code: "ERR_OUT_OF_RANGE",
          name: "RangeError",
          message: `The value of "offset" is out of range. It must be >= 0 and <= 0. Received ${offset}`,
        }),
      );
    });
  });

  test(`Buffer.alloc(1)[${fn}](1)`, () => {
    expect(() => Buffer.alloc(1)[fn](1)).toThrow(
      expect.objectContaining({
        code: "ERR_BUFFER_OUT_OF_BOUNDS",
        name: "RangeError",
        message: "Attempt to access memory outside buffer bounds",
      }),
    );
  });

  [NaN, 1.01].forEach(offset => {
    test(`${fn}(${offset})`, () => {
      expect(() => buffer[fn](offset)).toThrow(
        expect.objectContaining({
          code: "ERR_OUT_OF_RANGE",
          name: "RangeError",
          message: `The value of "offset" is out of range. It must be an integer. Received ${offset}`,
        }),
      );
    });
  });
});

//<#END_FILE: test-buffer-readfloat.js
