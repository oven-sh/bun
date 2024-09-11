//#FILE: test-buffer-writeuint.js
//#SHA1: 2a0cca5ed04fac65227a836185b8ec24f9410e6d
//-----------------
"use strict";

// We need to check the following things:
//  - We are correctly resolving big endian (doesn't mean anything for 8 bit)
//  - Correctly resolving little endian (doesn't mean anything for 8 bit)
//  - Correctly using the offsets
//  - Correctly interpreting values that are beyond the signed range as unsigned

describe("Buffer writeUint tests", () => {
  test("OOB", () => {
    const data = Buffer.alloc(8);
    ["UInt8", "UInt16BE", "UInt16LE", "UInt32BE", "UInt32LE"].forEach(fn => {
      // Verify that default offset works fine.
      data[`write${fn}`](23, undefined);
      data[`write${fn}`](23);

      ["", "0", null, {}, [], () => {}, true, false].forEach(o => {
        expect(() => data[`write${fn}`](23, o)).toThrow(
          expect.objectContaining({
            code: "ERR_INVALID_ARG_TYPE",
          }),
        );
      });

      [NaN, Infinity, -1, 1.01].forEach(o => {
        expect(() => data[`write${fn}`](23, o)).toThrow(
          expect.objectContaining({
            code: "ERR_OUT_OF_RANGE",
          }),
        );
      });
    });
  });

  test("8 bit", () => {
    const data = Buffer.alloc(4);

    data.writeUInt8(23, 0);
    data.writeUInt8(23, 1);
    data.writeUInt8(23, 2);
    data.writeUInt8(23, 3);
    expect(data).toEqual(Buffer.from([23, 23, 23, 23]));

    data.writeUInt8(23, 0);
    data.writeUInt8(23, 1);
    data.writeUInt8(23, 2);
    data.writeUInt8(23, 3);
    expect(data).toEqual(Buffer.from([23, 23, 23, 23]));

    data.writeUInt8(255, 0);
    expect(data[0]).toBe(255);

    data.writeUInt8(255, 0);
    expect(data[0]).toBe(255);

    let value = 0xfffff;
    ["writeUInt8"].forEach(fn => {
      expect(() => data[fn](value, 0)).toThrow(
        expect.objectContaining({
          code: "ERR_OUT_OF_RANGE",
          message: expect.stringContaining('The value of "value" is out of range.'),
        }),
      );
    });
  });

  test("16 bit", () => {
    let value = 0x2343;
    const data = Buffer.alloc(4);

    data.writeUInt16BE(value, 0);
    expect(data).toEqual(Buffer.from([0x23, 0x43, 0, 0]));

    data.writeUInt16BE(value, 1);
    expect(data).toEqual(Buffer.from([0x23, 0x23, 0x43, 0]));

    data.writeUInt16BE(value, 2);
    expect(data).toEqual(Buffer.from([0x23, 0x23, 0x23, 0x43]));

    data.writeUInt16LE(value, 0);
    expect(data).toEqual(Buffer.from([0x43, 0x23, 0x23, 0x43]));

    data.writeUInt16LE(value, 1);
    expect(data).toEqual(Buffer.from([0x43, 0x43, 0x23, 0x43]));

    data.writeUInt16LE(value, 2);
    expect(data).toEqual(Buffer.from([0x43, 0x43, 0x43, 0x23]));

    value = 0xff80;
    data.writeUInt16LE(value, 0);
    expect(data).toEqual(Buffer.from([0x80, 0xff, 0x43, 0x23]));

    data.writeUInt16BE(value, 0);
    expect(data).toEqual(Buffer.from([0xff, 0x80, 0x43, 0x23]));

    value = 0xfffff;
    ["writeUInt16BE", "writeUInt16LE"].forEach(fn => {
      expect(() => data[fn](value, 0)).toThrow(
        expect.objectContaining({
          code: "ERR_OUT_OF_RANGE",
          message: expect.stringContaining('The value of "value" is out of range.'),
        }),
      );
    });
  });

  test("32 bit", () => {
    const data = Buffer.alloc(6);
    let value = 0xe7f90a6d;

    data.writeUInt32BE(value, 0);
    expect(data).toEqual(Buffer.from([0xe7, 0xf9, 0x0a, 0x6d, 0, 0]));

    data.writeUInt32BE(value, 1);
    expect(data).toEqual(Buffer.from([0xe7, 0xe7, 0xf9, 0x0a, 0x6d, 0]));

    data.writeUInt32BE(value, 2);
    expect(data).toEqual(Buffer.from([0xe7, 0xe7, 0xe7, 0xf9, 0x0a, 0x6d]));

    data.writeUInt32LE(value, 0);
    expect(data).toEqual(Buffer.from([0x6d, 0x0a, 0xf9, 0xe7, 0x0a, 0x6d]));

    data.writeUInt32LE(value, 1);
    expect(data).toEqual(Buffer.from([0x6d, 0x6d, 0x0a, 0xf9, 0xe7, 0x6d]));

    data.writeUInt32LE(value, 2);
    expect(data).toEqual(Buffer.from([0x6d, 0x6d, 0x6d, 0x0a, 0xf9, 0xe7]));

    value = 0xfffffffff;
    ["writeUInt32BE", "writeUInt32LE"].forEach(fn => {
      expect(() => data[fn](value, 0)).toThrow(
        expect.objectContaining({
          code: "ERR_OUT_OF_RANGE",
          message: expect.stringContaining('The value of "value" is out of range.'),
        }),
      );
    });
  });

  test("48 bit", () => {
    const value = 0x1234567890ab;
    const data = Buffer.allocUnsafe(6);
    data.writeUIntBE(value, 0, 6);
    expect(data).toEqual(Buffer.from([0x12, 0x34, 0x56, 0x78, 0x90, 0xab]));

    data.writeUIntLE(value, 0, 6);
    expect(data).toEqual(Buffer.from([0xab, 0x90, 0x78, 0x56, 0x34, 0x12]));
  });

  describe("UInt", () => {
    const data = Buffer.alloc(8);
    let val = 0x100;

    // Check byteLength.
    ["writeUIntBE", "writeUIntLE"].forEach(fn => {
      ["", "0", null, {}, [], () => {}, true, false, undefined].forEach(bl => {
        test(`${fn}(23, 0, ${bl})`, () => {
          expect(() => data[fn](23, 0, bl)).toThrow(
            expect.objectContaining({
              code: "ERR_INVALID_ARG_TYPE",
            }),
          );
        });
      });

      [Infinity, -1].forEach(byteLength => {
        test(`${fn}(23, 0, ${byteLength}`, () => {
          expect(() => data[fn](23, 0, byteLength)).toThrow(
            expect.objectContaining({
              code: "ERR_OUT_OF_RANGE",
              message: expect.stringContaining('The value of "byteLength" is out of range.'),
            }),
          );
        });
      });

      [NaN, 1.01].forEach(byteLength => {
        test(`${fn}(42, 0, ${byteLength}`, () => {
          expect(() => data[fn](42, 0, byteLength)).toThrow(
            expect.objectContaining({
              code: "ERR_OUT_OF_RANGE",
              name: "RangeError",
              message: expect.stringContaining('The value of "byteLength" is out of range.'),
            }),
          );
        });
      });
    });

    // Test 1 to 6 bytes.
    for (let i = 1; i <= 6; i++) {
      ["writeUIntBE", "writeUIntLE"].forEach(fn => {
        test(`${fn}(${val}, 0, ${i}`, () => {
          expect(() => {
            data[fn](val, 0, i);
          }).toThrow(
            expect.objectContaining({
              code: "ERR_OUT_OF_RANGE",
              name: "RangeError",
              message: expect.stringContaining('The value of "value" is out of range.'),
            }),
          );
        });

        ["", "0", null, {}, [], () => {}, true, false].forEach(o => {
          test(`${fn}(23, ${o}, ${i})`, () => {
            expect(() => data[fn](23, o, i)).toThrow(
              expect.objectContaining({
                code: "ERR_INVALID_ARG_TYPE",
                name: "TypeError",
              }),
            );
          });
        });

        [Infinity, -1, -4294967295].forEach(offset => {
          test(`${fn}(${val - 1}, ${offset}, ${i})`, () => {
            expect(() => data[fn](val - 1, offset, i)).toThrow(
              expect.objectContaining({
                code: "ERR_OUT_OF_RANGE",
                name: "RangeError",
                message: expect.stringContaining('The value of "offset" is out of range.'),
              }),
            );
          });
        });

        [NaN, 1.01].forEach(offset => {
          test(`${fn}(${val - 1}, ${offset}, ${i})`, () => {
            expect(() => data[fn](val - 1, offset, i)).toThrow(
              expect.objectContaining({
                code: "ERR_OUT_OF_RANGE",
                name: "RangeError",
                message: expect.stringContaining('The value of "offset" is out of range.'),
              }),
            );
          });
        });
      });

      val *= 0x100;
    }
  });

  const functionPairs = [
    "UInt8",
    "UInt16LE",
    "UInt16BE",
    "UInt32LE",
    "UInt32BE",
    "UIntLE",
    "UIntBE",
    "BigUInt64LE",
    "BigUInt64BE",
  ];
  for (const fn of functionPairs) {
    test(`UInt function aliases: ${fn}`, () => {
      const p = Buffer.prototype;
      const lowerFn = fn.replace(/UInt/, "Uint");
      expect(p[`write${fn}`]).toBe(p[`write${lowerFn}`]);
      expect(p[`read${fn}`]).toBe(p[`read${lowerFn}`]);
    });
  }
});

//<#END_FILE: test-buffer-writeuint.js
