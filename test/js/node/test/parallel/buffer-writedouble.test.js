//#FILE: test-buffer-writedouble.js
//#SHA1: eb8c657fe982b3e0acaf9e7d8690ec47a363b0c7
//-----------------
"use strict";

// Tests to verify doubles are correctly written

test("writeDoubleBE and writeDoubleLE", () => {
  const buffer = Buffer.allocUnsafe(16);

  buffer.writeDoubleBE(2.225073858507201e-308, 0);
  buffer.writeDoubleLE(2.225073858507201e-308, 8);
  expect(buffer).toEqual(
    Buffer.from([0x00, 0x0f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x0f, 0x00]),
  );

  buffer.writeDoubleBE(1.0000000000000004, 0);
  buffer.writeDoubleLE(1.0000000000000004, 8);
  expect(buffer).toEqual(
    Buffer.from([0x3f, 0xf0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0x3f]),
  );

  buffer.writeDoubleBE(-2, 0);
  buffer.writeDoubleLE(-2, 8);
  expect(buffer).toEqual(
    Buffer.from([0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc0]),
  );

  buffer.writeDoubleBE(1.7976931348623157e308, 0);
  buffer.writeDoubleLE(1.7976931348623157e308, 8);
  expect(buffer).toEqual(
    Buffer.from([0x7f, 0xef, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xef, 0x7f]),
  );

  buffer.writeDoubleBE(0 * -1, 0);
  buffer.writeDoubleLE(0 * -1, 8);
  expect(buffer).toEqual(
    Buffer.from([0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80]),
  );

  buffer.writeDoubleBE(Infinity, 0);
  buffer.writeDoubleLE(Infinity, 8);

  expect(buffer).toEqual(
    Buffer.from([0x7f, 0xf0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0x7f]),
  );

  expect(buffer.readDoubleBE(0)).toBe(Infinity);
  expect(buffer.readDoubleLE(8)).toBe(Infinity);

  buffer.writeDoubleBE(-Infinity, 0);
  buffer.writeDoubleLE(-Infinity, 8);

  expect(buffer).toEqual(
    Buffer.from([0xff, 0xf0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0xff]),
  );

  expect(buffer.readDoubleBE(0)).toBe(-Infinity);
  expect(buffer.readDoubleLE(8)).toBe(-Infinity);

  buffer.writeDoubleBE(NaN, 0);
  buffer.writeDoubleLE(NaN, 8);

  // JS only knows a single NaN but there exist two platform specific
  // implementations. Therefore, allow both quiet and signalling NaNs.
  if (buffer[1] === 0xf7) {
    expect(buffer).toEqual(
      Buffer.from([0x7f, 0xf7, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xf7, 0x7f]),
    );
  } else {
    expect(buffer).toEqual(
      Buffer.from([0x7f, 0xf8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf8, 0x7f]),
    );
  }

  expect(Number.isNaN(buffer.readDoubleBE(0))).toBe(true);
  expect(Number.isNaN(buffer.readDoubleLE(8))).toBe(true);
});

// OOB in writeDouble{LE,BE} should throw.
test("OOB in writeDoubleLE and writeDoubleBE", () => {
  const small = Buffer.allocUnsafe(1);
  const buffer = Buffer.allocUnsafe(16);

  ["writeDoubleLE", "writeDoubleBE"].forEach(fn => {
    // Verify that default offset works fine.
    buffer[fn](23, undefined);
    buffer[fn](23);

    expect(() => small[fn](11.11, 0)).toThrow(
      expect.objectContaining({
        code: "ERR_BUFFER_OUT_OF_BOUNDS",
        name: "RangeError",
        message: expect.any(String),
      }),
    );

    ["", "0", null, {}, [], () => {}, true, false].forEach(off => {
      expect(() => small[fn](23, off)).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
          name: "TypeError",
          message: expect.any(String),
        }),
      );
    });

    [Infinity, -1, 9].forEach(offset => {
      expect(() => buffer[fn](23, offset)).toThrow(
        expect.objectContaining({
          code: "ERR_OUT_OF_RANGE",
          name: "RangeError",
          message: expect.any(String),
        }),
      );
    });

    [NaN, 1.01].forEach(offset => {
      expect(() => buffer[fn](42, offset)).toThrow(
        expect.objectContaining({
          code: "ERR_OUT_OF_RANGE",
          name: "RangeError",
          message: expect.any(String),
        }),
      );
    });
  });
});

//<#END_FILE: test-buffer-writedouble.js
