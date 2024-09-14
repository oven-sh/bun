//#FILE: test-buffer-no-negative-allocation.js
//#SHA1: c7f13ec857490bc5d1ffbf8da3fff19049c421f8
//-----------------
"use strict";

const { SlowBuffer } = require("buffer");

// Test that negative Buffer length inputs throw errors.

const msg = expect.objectContaining({
  code: "ERR_OUT_OF_RANGE",
  name: "RangeError",
  message: expect.any(String),
});

for (const f of [Buffer, Buffer.alloc, Buffer.allocUnsafe, Buffer.allocUnsafeSlow, SlowBuffer]) {
  for (const n of [-Buffer.poolSize, -100, -1, NaN]) {
    test(`${f.name} throws on ${n} length`, () => {
      expect(() => f(n)).toThrow(msg);
    });
  }
}

//<#END_FILE: test-buffer-no-negative-allocation.js
