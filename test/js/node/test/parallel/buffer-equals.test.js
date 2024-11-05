//#FILE: test-buffer-equals.js
//#SHA1: 917344b9c4ba47f1e30d02ec6adfad938b2d342a
//-----------------
"use strict";

test("Buffer.equals", () => {
  const b = Buffer.from("abcdf");
  const c = Buffer.from("abcdf");
  const d = Buffer.from("abcde");
  const e = Buffer.from("abcdef");

  expect(b.equals(c)).toBe(true);
  expect(c.equals(d)).toBe(false);
  expect(d.equals(e)).toBe(false);
  expect(d.equals(d)).toBe(true);
  expect(d.equals(new Uint8Array([0x61, 0x62, 0x63, 0x64, 0x65]))).toBe(true);

  expect(() => Buffer.alloc(1).equals("abc")).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      name: "TypeError",
      message: expect.stringContaining(
        `The "otherBuffer" argument must be an instance of Buffer or Uint8Array. Received`,
      ),
    }),
  );
});

//<#END_FILE: test-buffer-equals.js
