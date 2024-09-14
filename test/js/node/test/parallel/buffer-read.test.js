//#FILE: test-buffer-read.js
//#SHA1: e3c1ca217ea00561b3b3fae86fd36959b7f32f1a
//-----------------
"use strict";

// Testing basic buffer read functions
const buf = Buffer.from([0xa4, 0xfd, 0x48, 0xea, 0xcf, 0xff, 0xd9, 0x01, 0xde]);

function read(buff, funx, args, expected) {
  expect(buff[funx](...args)).toBe(expected);
  expect(() => buff[funx](-1, args[1])).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
    }),
  );
}

// Testing basic functionality of readDoubleBE() and readDoubleLE()
test("readDoubleBE and readDoubleLE", () => {
  read(buf, "readDoubleBE", [1], -3.1827727774563287e295);
  read(buf, "readDoubleLE", [1], -6.966010051009108e144);
});

// Testing basic functionality of readFloatBE() and readFloatLE()
test("readFloatBE and readFloatLE", () => {
  read(buf, "readFloatBE", [1], -1.6691549692541768e37);
  read(buf, "readFloatLE", [1], -7861303808);
});

// Testing basic functionality of readInt8()
test("readInt8", () => {
  read(buf, "readInt8", [1], -3);
});

// Testing basic functionality of readInt16BE() and readInt16LE()
test("readInt16BE and readInt16LE", () => {
  read(buf, "readInt16BE", [1], -696);
  read(buf, "readInt16LE", [1], 0x48fd);
});

// Testing basic functionality of readInt32BE() and readInt32LE()
test("readInt32BE and readInt32LE", () => {
  read(buf, "readInt32BE", [1], -45552945);
  read(buf, "readInt32LE", [1], -806729475);
});

// Testing basic functionality of readIntBE() and readIntLE()
test("readIntBE and readIntLE", () => {
  read(buf, "readIntBE", [1, 1], -3);
  read(buf, "readIntLE", [2, 1], 0x48);
});

// Testing basic functionality of readUInt8()
test("readUInt8", () => {
  read(buf, "readUInt8", [1], 0xfd);
});

// Testing basic functionality of readUInt16BE() and readUInt16LE()
test("readUInt16BE and readUInt16LE", () => {
  read(buf, "readUInt16BE", [2], 0x48ea);
  read(buf, "readUInt16LE", [2], 0xea48);
});

// Testing basic functionality of readUInt32BE() and readUInt32LE()
test("readUInt32BE and readUInt32LE", () => {
  read(buf, "readUInt32BE", [1], 0xfd48eacf);
  read(buf, "readUInt32LE", [1], 0xcfea48fd);
});

// Testing basic functionality of readUIntBE() and readUIntLE()
test("readUIntBE and readUIntLE", () => {
  read(buf, "readUIntBE", [2, 2], 0x48ea);
  read(buf, "readUIntLE", [2, 2], 0xea48);
});

// Error name and message
const OOR_ERROR = expect.objectContaining({
  name: "RangeError",
});

const OOB_ERROR = expect.objectContaining({
  name: "RangeError",
  message: expect.any(String),
});

// Attempt to overflow buffers, similar to previous bug in array buffers
test("Buffer overflow attempts", () => {
  expect(() => Buffer.allocUnsafe(8).readFloatBE(0xffffffff)).toThrow(OOR_ERROR);
  expect(() => Buffer.allocUnsafe(8).readFloatLE(0xffffffff)).toThrow(OOR_ERROR);
});

// Ensure negative values can't get past offset
test("Negative offset attempts", () => {
  expect(() => Buffer.allocUnsafe(8).readFloatBE(-1)).toThrow(OOR_ERROR);
  expect(() => Buffer.allocUnsafe(8).readFloatLE(-1)).toThrow(OOR_ERROR);
});

// Offset checks
test("Offset checks for empty buffer", () => {
  const buf = Buffer.allocUnsafe(0);

  expect(() => buf.readUInt8(0)).toThrow(OOB_ERROR);
  expect(() => buf.readInt8(0)).toThrow(OOB_ERROR);
});

test("Offset checks for undersized buffers", () => {
  [16, 32].forEach(bit => {
    const buf = Buffer.allocUnsafe(bit / 8 - 1);
    [`Int${bit}B`, `Int${bit}L`, `UInt${bit}B`, `UInt${bit}L`].forEach(fn => {
      expect(() => buf[`read${fn}E`](0)).toThrow(OOB_ERROR);
    });
  });
});

test("Reading max values for different bit sizes", () => {
  [16, 32].forEach(bits => {
    const buf = Buffer.from([0xff, 0xff, 0xff, 0xff]);
    ["LE", "BE"].forEach(endian => {
      expect(buf[`readUInt${bits}${endian}`](0)).toBe(0xffffffff >>> (32 - bits));
      expect(buf[`readInt${bits}${endian}`](0)).toBe(0xffffffff >> (32 - bits));
    });
  });
});

//<#END_FILE: test-buffer-read.js
