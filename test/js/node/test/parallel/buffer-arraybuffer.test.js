//#FILE: test-buffer-arraybuffer.js
//#SHA1: 2297240ef18399097bd3383db051d8e37339a123
//-----------------
"use strict";

const LENGTH = 16;

test("Buffer from ArrayBuffer", () => {
  const ab = new ArrayBuffer(LENGTH);
  const dv = new DataView(ab);
  const ui = new Uint8Array(ab);
  const buf = Buffer.from(ab);

  expect(buf).toBeInstanceOf(Buffer);
  expect(buf.parent).toBe(buf.buffer);
  expect(buf.buffer).toBe(ab);
  expect(buf.length).toBe(ab.byteLength);

  buf.fill(0xc);
  for (let i = 0; i < LENGTH; i++) {
    expect(ui[i]).toBe(0xc);
    ui[i] = 0xf;
    expect(buf[i]).toBe(0xf);
  }

  buf.writeUInt32LE(0xf00, 0);
  buf.writeUInt32BE(0xb47, 4);
  buf.writeDoubleLE(3.1415, 8);

  expect(dv.getUint32(0, true)).toBe(0xf00);
  expect(dv.getUint32(4)).toBe(0xb47);
  expect(dv.getFloat64(8, true)).toBe(3.1415);
});

test.todo("Buffer.from with invalid ArrayBuffer", () => {
  expect(() => {
    function AB() {}
    Object.setPrototypeOf(AB, ArrayBuffer);
    Object.setPrototypeOf(AB.prototype, ArrayBuffer.prototype);
    Buffer.from(new AB());
  }).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      name: "TypeError",
      message: expect.stringContaining(
        "The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object.",
      ),
    }),
  );
});

test("Buffer.from with byteOffset and length arguments", () => {
  const ab = new Uint8Array(5);
  ab[0] = 1;
  ab[1] = 2;
  ab[2] = 3;
  ab[3] = 4;
  ab[4] = 5;
  const buf = Buffer.from(ab.buffer, 1, 3);
  expect(buf.length).toBe(3);
  expect(buf[0]).toBe(2);
  expect(buf[1]).toBe(3);
  expect(buf[2]).toBe(4);
  buf[0] = 9;
  expect(ab[1]).toBe(9);

  expect(() => Buffer.from(ab.buffer, 6)).toThrow(
    expect.objectContaining({
      name: "RangeError",
      // code: "ERR_BUFFER_OUT_OF_BOUNDS",
      // message: expect.stringContaining('"offset" is outside of buffer bounds'),
    }),
  );

  expect(() => Buffer.from(ab.buffer, 3, 6)).toThrow(
    expect.objectContaining({
      name: "RangeError",
      // code: "ERR_BUFFER_OUT_OF_BOUNDS",
      // message: expect.stringContaining('"length" is outside of buffer bounds'),
    }),
  );
});

test("Deprecated Buffer() constructor", () => {
  const ab = new Uint8Array(5);
  ab[0] = 1;
  ab[1] = 2;
  ab[2] = 3;
  ab[3] = 4;
  ab[4] = 5;
  const buf = Buffer(ab.buffer, 1, 3);
  expect(buf.length).toBe(3);
  expect(buf[0]).toBe(2);
  expect(buf[1]).toBe(3);
  expect(buf[2]).toBe(4);
  buf[0] = 9;
  expect(ab[1]).toBe(9);

  expect(() => Buffer(ab.buffer, 6)).toThrow(
    expect.objectContaining({
      name: "RangeError",
      // code: "ERR_BUFFER_OUT_OF_BOUNDS",
      // message: expect.stringContaining('"offset" is outside of buffer bounds'),
    }),
  );

  expect(() => Buffer(ab.buffer, 3, 6)).toThrow(
    expect.objectContaining({
      name: "RangeError",
      // code: "ERR_BUFFER_OUT_OF_BOUNDS",
      // message: expect.stringContaining('"length" is outside of buffer bounds'),
    }),
  );
});

test("Buffer.from with non-numeric byteOffset", () => {
  const ab = new ArrayBuffer(10);
  const expected = Buffer.from(ab, 0);
  expect(Buffer.from(ab, "fhqwhgads")).toEqual(expected);
  expect(Buffer.from(ab, NaN)).toEqual(expected);
  expect(Buffer.from(ab, {})).toEqual(expected);
  expect(Buffer.from(ab, [])).toEqual(expected);

  expect(Buffer.from(ab, [1])).toEqual(Buffer.from(ab, 1));

  expect(() => Buffer.from(ab, Infinity)).toThrow(
    expect.objectContaining({
      name: "RangeError",
      // code: "ERR_BUFFER_OUT_OF_BOUNDS",
      // message: expect.stringContaining('"offset" is outside of buffer bounds'),
    }),
  );
});

test("Buffer.from with non-numeric length", () => {
  const ab = new ArrayBuffer(10);
  const expected = Buffer.from(ab, 0, 0);
  expect(Buffer.from(ab, 0, "fhqwhgads")).toEqual(expected);
  expect(Buffer.from(ab, 0, NaN)).toEqual(expected);
  expect(Buffer.from(ab, 0, {})).toEqual(expected);
  expect(Buffer.from(ab, 0, [])).toEqual(expected);

  expect(Buffer.from(ab, 0, [1])).toEqual(Buffer.from(ab, 0, 1));

  expect(() => Buffer.from(ab, 0, Infinity)).toThrow(
    expect.objectContaining({
      name: "RangeError",
      // code: "ERR_BUFFER_OUT_OF_BOUNDS",
      // message: expect.stringContaining('"length" is outside of buffer bounds'),
    }),
  );
});

test("Buffer.from with array-like entry and NaN length", () => {
  expect(Buffer.from({ length: NaN })).toEqual(Buffer.alloc(0));
});

//<#END_FILE: test-buffer-arraybuffer.js
