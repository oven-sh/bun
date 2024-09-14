//#FILE: test-buffer-readdouble.js
//#SHA1: f20bbcdd359fb12ae549c75baf44554d0b0edab6
//-----------------
"use strict";

// Test (64 bit) double
test("Buffer readDouble", () => {
  const buffer = Buffer.allocUnsafe(8);

  buffer[0] = 0x55;
  buffer[1] = 0x55;
  buffer[2] = 0x55;
  buffer[3] = 0x55;
  buffer[4] = 0x55;
  buffer[5] = 0x55;
  buffer[6] = 0xd5;
  buffer[7] = 0x3f;
  expect(buffer.readDoubleBE(0)).toBe(1.1945305291680097e103);
  expect(buffer.readDoubleLE(0)).toBe(0.3333333333333333);

  buffer[0] = 1;
  buffer[1] = 0;
  buffer[2] = 0;
  buffer[3] = 0;
  buffer[4] = 0;
  buffer[5] = 0;
  buffer[6] = 0xf0;
  buffer[7] = 0x3f;
  expect(buffer.readDoubleBE(0)).toBe(7.291122019655968e-304);
  expect(buffer.readDoubleLE(0)).toBe(1.0000000000000002);

  buffer[0] = 2;
  expect(buffer.readDoubleBE(0)).toBe(4.778309726801735e-299);
  expect(buffer.readDoubleLE(0)).toBe(1.0000000000000004);

  buffer[0] = 1;
  buffer[6] = 0;
  buffer[7] = 0;
  // eslint-disable-next-line no-loss-of-precision
  expect(buffer.readDoubleBE(0)).toBe(7.291122019556398e-304);
  expect(buffer.readDoubleLE(0)).toBe(5e-324);

  buffer[0] = 0xff;
  buffer[1] = 0xff;
  buffer[2] = 0xff;
  buffer[3] = 0xff;
  buffer[4] = 0xff;
  buffer[5] = 0xff;
  buffer[6] = 0x0f;
  buffer[7] = 0x00;
  expect(Number.isNaN(buffer.readDoubleBE(0))).toBe(true);
  expect(buffer.readDoubleLE(0)).toBe(2.225073858507201e-308);

  buffer[6] = 0xef;
  buffer[7] = 0x7f;
  expect(Number.isNaN(buffer.readDoubleBE(0))).toBe(true);
  expect(buffer.readDoubleLE(0)).toBe(1.7976931348623157e308);

  buffer[0] = 0;
  buffer[1] = 0;
  buffer[2] = 0;
  buffer[3] = 0;
  buffer[4] = 0;
  buffer[5] = 0;
  buffer[6] = 0xf0;
  buffer[7] = 0x3f;
  expect(buffer.readDoubleBE(0)).toBe(3.03865e-319);
  expect(buffer.readDoubleLE(0)).toBe(1);

  buffer[6] = 0;
  buffer[7] = 0x40;
  expect(buffer.readDoubleBE(0)).toBe(3.16e-322);
  expect(buffer.readDoubleLE(0)).toBe(2);

  buffer[7] = 0xc0;
  expect(buffer.readDoubleBE(0)).toBe(9.5e-322);
  expect(buffer.readDoubleLE(0)).toBe(-2);

  buffer[6] = 0x10;
  buffer[7] = 0;
  expect(buffer.readDoubleBE(0)).toBe(2.0237e-320);
  expect(buffer.readDoubleLE(0)).toBe(2.2250738585072014e-308);

  buffer[6] = 0;
  expect(buffer.readDoubleBE(0)).toBe(0);
  expect(buffer.readDoubleLE(0)).toBe(0);
  expect(1 / buffer.readDoubleLE(0) >= 0).toBe(true);

  buffer[7] = 0x80;
  expect(buffer.readDoubleBE(0)).toBe(6.3e-322);
  expect(buffer.readDoubleLE(0)).toBe(-0);
  expect(1 / buffer.readDoubleLE(0) < 0).toBe(true);

  buffer[6] = 0xf0;
  buffer[7] = 0x7f;
  expect(buffer.readDoubleBE(0)).toBe(3.0418e-319);
  expect(buffer.readDoubleLE(0)).toBe(Infinity);

  buffer[7] = 0xff;
  expect(buffer.readDoubleBE(0)).toBe(3.04814e-319);
  expect(buffer.readDoubleLE(0)).toBe(-Infinity);
});

["readDoubleLE", "readDoubleBE"].forEach(fn => {
  const buffer = Buffer.allocUnsafe(8);

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

//<#END_FILE: test-buffer-readdouble.js
