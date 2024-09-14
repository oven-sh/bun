//#FILE: test-buffer-compare.js
//#SHA1: eab68d7262240af3d53eabedb0e7a515b2d84adf
//-----------------
"use strict";

test("Buffer compare", () => {
  const b = Buffer.alloc(1, "a");
  const c = Buffer.alloc(1, "c");
  const d = Buffer.alloc(2, "aa");
  const e = new Uint8Array([0x61, 0x61]); // ASCII 'aa', same as d

  expect(b.compare(c)).toBe(-1);
  expect(c.compare(d)).toBe(1);
  expect(d.compare(b)).toBe(1);
  expect(d.compare(e)).toBe(0);
  expect(b.compare(d)).toBe(-1);
  expect(b.compare(b)).toBe(0);

  expect(Buffer.compare(b, c)).toBe(-1);
  expect(Buffer.compare(c, d)).toBe(1);
  expect(Buffer.compare(d, b)).toBe(1);
  expect(Buffer.compare(b, d)).toBe(-1);
  expect(Buffer.compare(c, c)).toBe(0);
  expect(Buffer.compare(e, e)).toBe(0);
  expect(Buffer.compare(d, e)).toBe(0);
  expect(Buffer.compare(d, b)).toBe(1);

  expect(Buffer.compare(Buffer.alloc(0), Buffer.alloc(0))).toBe(0);
  expect(Buffer.compare(Buffer.alloc(0), Buffer.alloc(1))).toBe(-1);
  expect(Buffer.compare(Buffer.alloc(1), Buffer.alloc(0))).toBe(1);

  expect(() => Buffer.compare(Buffer.alloc(1), "abc")).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      message: expect.stringContaining('The "buf2" argument must be an instance of Buffer or Uint8Array.'),
    }),
  );

  expect(() => Buffer.compare("abc", Buffer.alloc(1))).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      message: expect.stringContaining('The "buf1" argument must be an instance of Buffer or Uint8Array.'),
    }),
  );

  expect(() => Buffer.alloc(1).compare("abc")).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      name: "TypeError",
      message: expect.stringContaining('The "target" argument must be an instance of Buffer or Uint8Array.'),
    }),
  );
});

//<#END_FILE: test-buffer-compare.js
