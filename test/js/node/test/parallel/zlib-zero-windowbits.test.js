//#FILE: test-zlib-zero-windowBits.js
//#SHA1: 3f1f031d2f5ab37f2ea2a963d6de0e2ececa9d33
//-----------------
"use strict";

const zlib = require("zlib");

// windowBits is a special case in zlib. On the compression side, 0 is invalid.
// On the decompression side, it indicates that zlib should use the value from
// the header of the compressed stream.
test("windowBits 0 for decompression", () => {
  const inflate = zlib.createInflate({ windowBits: 0 });
  expect(inflate).toBeInstanceOf(zlib.Inflate);

  const gunzip = zlib.createGunzip({ windowBits: 0 });
  expect(gunzip).toBeInstanceOf(zlib.Gunzip);

  const unzip = zlib.createUnzip({ windowBits: 0 });
  expect(unzip).toBeInstanceOf(zlib.Unzip);
});

test("windowBits 0 for compression throws error", () => {
  expect(() => zlib.createGzip({ windowBits: 0 })).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );
});

//<#END_FILE: test-zlib-zero-windowBits.js
