//#FILE: test-zlib-const.js
//#SHA1: d85ad9e395d5781dbe5bf05e5514104bd9503be8
//-----------------
const zlib = require("zlib");

test("zlib constants and codes are immutable", () => {
  // Test Z_OK constant
  expect(zlib.constants.Z_OK).toBe(0);
  zlib.constants.Z_OK = 1;
  expect(zlib.constants.Z_OK).toBe(0);

  // Test Z_OK code
  expect(zlib.codes.Z_OK).toBe(0);
  zlib.codes.Z_OK = 1;
  expect(zlib.codes.Z_OK).toBe(0);
  zlib.codes = { Z_OK: 1 };
  expect(zlib.codes.Z_OK).toBe(0);

  // Test if zlib.codes is frozen
  expect(Object.isFrozen(zlib.codes)).toBe(true);
});

//<#END_FILE: test-zlib-const.js
