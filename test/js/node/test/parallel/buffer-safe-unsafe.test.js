//#FILE: test-buffer-safe-unsafe.js
//#SHA1: 87831e463ab52a79fca3ac2e28eec57666ea9e5e
//-----------------
"use strict";

test("Buffer safe and unsafe allocations", () => {
  const safe = Buffer.alloc(10);

  function isZeroFilled(buf) {
    for (let n = 0; n < buf.length; n++) if (buf[n] !== 0) return false;
    return true;
  }

  expect(isZeroFilled(safe)).toBe(true);

  // Test that unsafe allocations doesn't affect subsequent safe allocations
  Buffer.allocUnsafe(10);
  expect(isZeroFilled(new Float64Array(10))).toBe(true);

  new Buffer(10);
  expect(isZeroFilled(new Float64Array(10))).toBe(true);

  Buffer.allocUnsafe(10);
  expect(isZeroFilled(Buffer.alloc(10))).toBe(true);
});

//<#END_FILE: test-buffer-safe-unsafe.js
