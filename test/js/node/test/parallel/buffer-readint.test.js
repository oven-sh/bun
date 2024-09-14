//#FILE: test-buffer-readint.js
//#SHA1: 95feae5d0540f00ae75fb16610ad161ab8f69300
//-----------------
"use strict";

// Test OOB
test("Out of bounds reads", () => {
  const buffer = Buffer.alloc(4);

  ["Int8", "Int16BE", "Int16LE", "Int32BE", "Int32LE"].forEach(fn => {
    // Verify that default offset works fine.
    expect(() => buffer[`read${fn}`](undefined)).not.toThrow();
    expect(() => buffer[`read${fn}`]()).not.toThrow();

    ["", "0", null, {}, [], () => {}, true, false].forEach(o => {
      expect(() => buffer[`read${fn}`](o)).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
          name: "TypeError",
          message: expect.any(String),
        }),
      );
    });

    [Infinity, -1, -4294967295].forEach(offset => {
      expect(() => buffer[`read${fn}`](offset)).toThrow(
        expect.objectContaining({
          code: "ERR_OUT_OF_RANGE",
          name: "RangeError",
          message: expect.any(String),
        }),
      );
    });

    [NaN, 1.01].forEach(offset => {
      expect(() => buffer[`read${fn}`](offset)).toThrow(
        expect.objectContaining({
          code: "ERR_OUT_OF_RANGE",
          name: "RangeError",
          message: expect.any(String),
        }),
      );
    });
  });
});

// Test 8 bit signed integers
test("8 bit signed integers", () => {
  const data = Buffer.from([0x23, 0xab, 0x7c, 0xef]);

  expect(data.readInt8(0)).toBe(0x23);

  data[0] = 0xff;
  expect(data.readInt8(0)).toBe(-1);

  data[0] = 0x87;
  expect(data.readInt8(0)).toBe(-121);
  expect(data.readInt8(1)).toBe(-85);
  expect(data.readInt8(2)).toBe(124);
  expect(data.readInt8(3)).toBe(-17);
});

// Test 16 bit integers
test("16 bit integers", () => {
  const buffer = Buffer.from([0x16, 0x79, 0x65, 0x6e, 0x69, 0x78]);

  expect(buffer.readInt16BE(0)).toBe(0x1679);
  expect(buffer.readInt16LE(0)).toBe(0x7916);

  buffer[0] = 0xff;
  buffer[1] = 0x80;
  expect(buffer.readInt16BE(0)).toBe(-128);
  expect(buffer.readInt16LE(0)).toBe(-32513);

  buffer[0] = 0x77;
  buffer[1] = 0x65;
  expect(buffer.readInt16BE(0)).toBe(0x7765);
  expect(buffer.readInt16BE(1)).toBe(0x6565);
  expect(buffer.readInt16BE(2)).toBe(0x656e);
  expect(buffer.readInt16BE(3)).toBe(0x6e69);
  expect(buffer.readInt16BE(4)).toBe(0x6978);
  expect(buffer.readInt16LE(0)).toBe(0x6577);
  expect(buffer.readInt16LE(1)).toBe(0x6565);
  expect(buffer.readInt16LE(2)).toBe(0x6e65);
  expect(buffer.readInt16LE(3)).toBe(0x696e);
  expect(buffer.readInt16LE(4)).toBe(0x7869);
});

// Test 32 bit integers
test("32 bit integers", () => {
  const buffer = Buffer.from([0x43, 0x53, 0x16, 0x79, 0x36, 0x17]);

  expect(buffer.readInt32BE(0)).toBe(0x43531679);
  expect(buffer.readInt32LE(0)).toBe(0x79165343);

  buffer[0] = 0xff;
  buffer[1] = 0xfe;
  buffer[2] = 0xef;
  buffer[3] = 0xfa;
  expect(buffer.readInt32BE(0)).toBe(-69638);
  expect(buffer.readInt32LE(0)).toBe(-84934913);

  buffer[0] = 0x42;
  buffer[1] = 0xc3;
  buffer[2] = 0x95;
  buffer[3] = 0xa9;
  expect(buffer.readInt32BE(0)).toBe(0x42c395a9);
  expect(buffer.readInt32BE(1)).toBe(-1013601994);
  expect(buffer.readInt32BE(2)).toBe(-1784072681);
  expect(buffer.readInt32LE(0)).toBe(-1449802942);
  expect(buffer.readInt32LE(1)).toBe(917083587);
  expect(buffer.readInt32LE(2)).toBe(389458325);
});

// Test Int
test("Int", () => {
  const buffer = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);

  expect(buffer.readIntLE(0, 1)).toBe(0x01);
  expect(buffer.readIntBE(0, 1)).toBe(0x01);
  expect(buffer.readIntLE(0, 3)).toBe(0x030201);
  expect(buffer.readIntBE(0, 3)).toBe(0x010203);
  expect(buffer.readIntLE(0, 5)).toBe(0x0504030201);
  expect(buffer.readIntBE(0, 5)).toBe(0x0102030405);
  expect(buffer.readIntLE(0, 6)).toBe(0x060504030201);
  expect(buffer.readIntBE(0, 6)).toBe(0x010203040506);
  expect(buffer.readIntLE(1, 6)).toBe(0x070605040302);
  expect(buffer.readIntBE(1, 6)).toBe(0x020304050607);
  expect(buffer.readIntLE(2, 6)).toBe(0x080706050403);
  expect(buffer.readIntBE(2, 6)).toBe(0x030405060708);

  // Check byteLength.
  ["readIntBE", "readIntLE"].forEach(fn => {
    ["", "0", null, {}, [], () => {}, true, false, undefined].forEach(len => {
      expect(() => buffer[fn](0, len)).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
          message: expect.any(String),
        }),
      );
    });

    [Infinity, -1].forEach(byteLength => {
      expect(() => buffer[fn](0, byteLength)).toThrow(
        expect.objectContaining({
          code: "ERR_OUT_OF_RANGE",
          message: expect.any(String),
        }),
      );
    });

    [NaN, 1.01].forEach(byteLength => {
      expect(() => buffer[fn](0, byteLength)).toThrow(
        expect.objectContaining({
          code: "ERR_OUT_OF_RANGE",
          name: "RangeError",
          message: expect.any(String),
        }),
      );
    });
  });

  // Test 1 to 6 bytes.
  for (let i = 1; i <= 6; i++) {
    ["readIntBE", "readIntLE"].forEach(fn => {
      ["", "0", null, {}, [], () => {}, true, false, undefined].forEach(o => {
        expect(() => buffer[fn](o, i)).toThrow(
          expect.objectContaining({
            code: "ERR_INVALID_ARG_TYPE",
            name: "TypeError",
            message: expect.any(String),
          }),
        );
      });

      [Infinity, -1, -4294967295].forEach(offset => {
        expect(() => buffer[fn](offset, i)).toThrow(
          expect.objectContaining({
            code: "ERR_OUT_OF_RANGE",
            name: "RangeError",
            message: expect.any(String),
          }),
        );
      });

      [NaN, 1.01].forEach(offset => {
        expect(() => buffer[fn](offset, i)).toThrow(
          expect.objectContaining({
            code: "ERR_OUT_OF_RANGE",
            name: "RangeError",
            message: expect.any(String),
          }),
        );
      });
    });
  }
});

//<#END_FILE: test-buffer-readint.js
