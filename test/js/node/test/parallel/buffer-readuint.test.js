//#FILE: test-buffer-readuint.js
//#SHA1: 5a48fd4b94090352cd0aaea48eaa18c76e1814a1
//-----------------
"use strict";

// Test OOB
describe("OOB tests", () => {
  const buffer = Buffer.alloc(4);

  for (const fn of ["UInt8", "UInt16BE", "UInt16LE", "UInt32BE", "UInt32LE"]) {
    describe(`read${fn}`, () => {
      test("not throws", () => {
        expect(() => buffer[`read${fn}`](undefined)).not.toThrow();
        expect(() => buffer[`read${fn}`]()).not.toThrow();
      });

      for (const o of ["", "0", null, {}, [], () => {}, true, false]) {
        test(`(${o})`, () => {
          expect(() => buffer[`read${fn}`](o)).toThrow(
            expect.objectContaining({
              code: "ERR_INVALID_ARG_TYPE",
              name: "TypeError",
            }),
          );
        });
      }

      for (const o of [Infinity, -1, -4294967295]) {
        test(`(${o})`, () => {
          expect(() => buffer[`read${fn}`](o)).toThrow(
            expect.objectContaining({
              code: "ERR_OUT_OF_RANGE",
              name: "RangeError",
            }),
          );
        });
      }

      for (const o of [NaN, 1.01]) {
        test(`(${o})`, () => {
          expect(() => buffer[`read${fn}`](o)).toThrow(
            expect.objectContaining({
              code: "ERR_OUT_OF_RANGE",
              name: "RangeError",
              message: expect.stringContaining(`It must be an integer. Received ${o}`),
            }),
          );
        });
      }
    });
  }
});

// Test 8 bit unsigned integers
test("8 bit unsigned integers", () => {
  const data = Buffer.from([0xff, 0x2a, 0x2a, 0x2a]);
  expect(data.readUInt8(0)).toBe(255);
  expect(data.readUInt8(1)).toBe(42);
  expect(data.readUInt8(2)).toBe(42);
  expect(data.readUInt8(3)).toBe(42);
});

// Test 16 bit unsigned integers
test("16 bit unsigned integers", () => {
  const data = Buffer.from([0x00, 0x2a, 0x42, 0x3f]);
  expect(data.readUInt16BE(0)).toBe(0x2a);
  expect(data.readUInt16BE(1)).toBe(0x2a42);
  expect(data.readUInt16BE(2)).toBe(0x423f);
  expect(data.readUInt16LE(0)).toBe(0x2a00);
  expect(data.readUInt16LE(1)).toBe(0x422a);
  expect(data.readUInt16LE(2)).toBe(0x3f42);

  data[0] = 0xfe;
  data[1] = 0xfe;
  expect(data.readUInt16BE(0)).toBe(0xfefe);
  expect(data.readUInt16LE(0)).toBe(0xfefe);
});

// Test 32 bit unsigned integers
test("32 bit unsigned integers", () => {
  const data = Buffer.from([0x32, 0x65, 0x42, 0x56, 0x23, 0xff]);
  expect(data.readUInt32BE(0)).toBe(0x32654256);
  expect(data.readUInt32BE(1)).toBe(0x65425623);
  expect(data.readUInt32BE(2)).toBe(0x425623ff);
  expect(data.readUInt32LE(0)).toBe(0x56426532);
  expect(data.readUInt32LE(1)).toBe(0x23564265);
  expect(data.readUInt32LE(2)).toBe(0xff235642);
});

// Test UInt
describe("UInt", () => {
  const buffer = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);

  test("works", () => {
    expect(buffer.readUIntLE(0, 1)).toBe(0x01);
    expect(buffer.readUIntBE(0, 1)).toBe(0x01);
    expect(buffer.readUIntLE(0, 3)).toBe(0x030201);
    expect(buffer.readUIntBE(0, 3)).toBe(0x010203);
    expect(buffer.readUIntLE(0, 5)).toBe(0x0504030201);
    expect(buffer.readUIntBE(0, 5)).toBe(0x0102030405);
    expect(buffer.readUIntLE(0, 6)).toBe(0x060504030201);
    expect(buffer.readUIntBE(0, 6)).toBe(0x010203040506);
    expect(buffer.readUIntLE(1, 6)).toBe(0x070605040302);
    expect(buffer.readUIntBE(1, 6)).toBe(0x020304050607);
    expect(buffer.readUIntLE(2, 6)).toBe(0x080706050403);
    expect(buffer.readUIntBE(2, 6)).toBe(0x030405060708);
  });

  // Check byteLength.
  for (const fn of ["readUIntBE", "readUIntLE"]) {
    describe(fn, () => {
      for (const len of ["", "0", null, {}, [], () => {}, true, false, undefined]) {
        test(`(0, ${len})`, () => {
          expect(() => buffer[fn](0, len)).toThrow(
            expect.objectContaining({
              code: "ERR_INVALID_ARG_TYPE",
            }),
          );
        });
      }

      for (const len of [Infinity, -1]) {
        test(`(0, ${len})`, () => {
          expect(() => buffer[fn](0, len)).toThrow(
            expect.objectContaining({
              code: "ERR_OUT_OF_RANGE",
              message: expect.stringContaining(`It must be >= 1 and <= 6. Received ${len}`),
            }),
          );
        });
      }

      for (const len of [NaN, 1.01]) {
        test(`(0, ${len})`, () => {
          expect(() => buffer[fn](0, len)).toThrow(
            expect.objectContaining({
              code: "ERR_OUT_OF_RANGE",
              name: "RangeError",
              message: expect.stringContaining(`It must be an integer. Received ${len}`),
            }),
          );
        });
      }
    });
  }

  // Test 1 to 6 bytes.
  ["readUIntBE", "readUIntLE"].forEach(fn => {
    for (let i = 1; i <= 6; i++) {
      ["", "0", null, {}, [], () => {}, true, false, undefined].forEach(o => {
        test(`${fn}(${o}, ${i})`, () => {
          expect(() => buffer[fn](o, i)).toThrow(
            expect.objectContaining({
              code: "ERR_INVALID_ARG_TYPE",
              name: "TypeError",
            }),
          );
        });
      });

      [Infinity, -1, -4294967295].forEach(offset => {
        test(`${fn}(${offset}, ${i})`, () => {
          expect(() => buffer[fn](offset, i)).toThrow(
            expect.objectContaining({
              code: "ERR_OUT_OF_RANGE",
              name: "RangeError",
              message: expect.stringContaining(`It must be >= 0 and <= ${8 - i}. Received ${offset}`),
            }),
          );
        });
      });

      [NaN, 1.01].forEach(offset => {
        test(`${fn}(${offset}, ${i})`, () => {
          expect(() => buffer[fn](offset, i)).toThrow(
            expect.objectContaining({
              code: "ERR_OUT_OF_RANGE",
              name: "RangeError",
              message: expect.stringContaining(`It must be an integer. Received ${offset}`),
            }),
          );
        });
      });
    }
  });
});

//<#END_FILE: test-buffer-readuint.js
