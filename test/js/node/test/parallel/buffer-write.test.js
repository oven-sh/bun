//#FILE: test-buffer-write.js
//#SHA1: 9577e31a533888b164b0abf4ebececbe04e381cb
//-----------------
"use strict";

[-1, 10].forEach(offset => {
  test(`Buffer.alloc(9).write('foo', ${offset}) throws RangeError`, () => {
    expect(() => Buffer.alloc(9).write("foo", offset)).toThrow(
      expect.objectContaining({
        code: "ERR_OUT_OF_RANGE",
        name: "RangeError",
        message: expect.any(String),
      }),
    );
  });
});

const resultMap = new Map([
  ["utf8", Buffer.from([102, 111, 111, 0, 0, 0, 0, 0, 0])],
  ["ucs2", Buffer.from([102, 0, 111, 0, 111, 0, 0, 0, 0])],
  ["ascii", Buffer.from([102, 111, 111, 0, 0, 0, 0, 0, 0])],
  ["latin1", Buffer.from([102, 111, 111, 0, 0, 0, 0, 0, 0])],
  ["binary", Buffer.from([102, 111, 111, 0, 0, 0, 0, 0, 0])],
  ["utf16le", Buffer.from([102, 0, 111, 0, 111, 0, 0, 0, 0])],
  ["base64", Buffer.from([102, 111, 111, 0, 0, 0, 0, 0, 0])],
  ["base64url", Buffer.from([102, 111, 111, 0, 0, 0, 0, 0, 0])],
  ["hex", Buffer.from([102, 111, 111, 0, 0, 0, 0, 0, 0])],
]);

// utf8, ucs2, ascii, latin1, utf16le
const encodings = ["utf8", "utf-8", "ucs2", "ucs-2", "ascii", "latin1", "binary", "utf16le", "utf-16le"];

encodings
  .reduce((es, e) => es.concat(e, e.toUpperCase()), [])
  .forEach(encoding => {
    test(`Buffer.write with encoding ${encoding}`, () => {
      const buf = Buffer.alloc(9);
      const len = Buffer.byteLength("foo", encoding);
      expect(buf.write("foo", 0, len, encoding)).toBe(len);

      if (encoding.includes("-")) encoding = encoding.replace("-", "");

      expect(buf).toEqual(resultMap.get(encoding.toLowerCase()));
    });
  });

// base64
["base64", "BASE64", "base64url", "BASE64URL"].forEach(encoding => {
  test(`Buffer.write with encoding ${encoding}`, () => {
    const buf = Buffer.alloc(9);
    const len = Buffer.byteLength("Zm9v", encoding);

    expect(buf.write("Zm9v", 0, len, encoding)).toBe(len);
    expect(buf).toEqual(resultMap.get(encoding.toLowerCase()));
  });
});

// hex
["hex", "HEX"].forEach(encoding => {
  test(`Buffer.write with encoding ${encoding}`, () => {
    const buf = Buffer.alloc(9);
    const len = Buffer.byteLength("666f6f", encoding);

    expect(buf.write("666f6f", 0, len, encoding)).toBe(len);
    expect(buf).toEqual(resultMap.get(encoding.toLowerCase()));
  });
});

// Invalid encodings
for (let i = 1; i < 10; i++) {
  const encoding = String(i).repeat(i);

  test(`Invalid encoding ${encoding}`, () => {
    expect(Buffer.isEncoding(encoding)).toBe(false);
    expect(() => Buffer.alloc(9).write("foo", encoding)).toThrow(
      expect.objectContaining({
        code: "ERR_UNKNOWN_ENCODING",
        name: "TypeError",
        message: expect.any(String),
      }),
    );
  });
}

// UCS-2 overflow CVE-2018-12115
for (let i = 1; i < 4; i++) {
  test(`UCS-2 overflow test ${i}`, () => {
    // Allocate two Buffers sequentially off the pool. Run more than once in case
    // we hit the end of the pool and don't get sequential allocations
    const x = Buffer.allocUnsafe(4).fill(0);
    const y = Buffer.allocUnsafe(4).fill(1);
    // Should not write anything, pos 3 doesn't have enough room for a 16-bit char
    expect(x.write("ыыыыыы", 3, "ucs2")).toBe(0);
    // CVE-2018-12115 experienced via buffer overrun to next block in the pool
    expect(Buffer.compare(y, Buffer.alloc(4, 1))).toBe(0);
  });
}

test("Should not write any data when there is no space for 16-bit chars", () => {
  const z = Buffer.alloc(4, 0);
  expect(z.write("\u0001", 3, "ucs2")).toBe(0);
  expect(Buffer.compare(z, Buffer.alloc(4, 0))).toBe(0);
  // Make sure longer strings are written up to the buffer end.
  expect(z.write("abcd", 2)).toBe(2);
  expect([...z]).toEqual([0, 0, 0x61, 0x62]);
});

test("Large overrun should not corrupt the process", () => {
  expect(Buffer.alloc(4).write("ыыыыыы".repeat(100), 3, "utf16le")).toBe(0);
});

test(".write() does not affect the byte after the written-to slice of the Buffer", () => {
  // Refs: https://github.com/nodejs/node/issues/26422
  const buf = Buffer.alloc(8);
  expect(buf.write("ыы", 1, "utf16le")).toBe(4);
  expect([...buf]).toEqual([0, 0x4b, 0x04, 0x4b, 0x04, 0, 0, 0]);
});

//<#END_FILE: test-buffer-write.js
