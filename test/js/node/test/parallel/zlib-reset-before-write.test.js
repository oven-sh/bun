//#FILE: test-zlib-reset-before-write.js
//#SHA1: 44561d35a5b7e4fc363d7dbde7ec6891af1f338a
//-----------------
"use strict";
const zlib = require("zlib");

// Tests that zlib streams support .reset() and .params()
// before the first write. That is important to ensure that
// lazy init of zlib native library handles these cases.

const testCases = [
  (z, cb) => {
    z.reset();
    cb();
  },
  (z, cb) => z.params(0, zlib.constants.Z_DEFAULT_STRATEGY, cb),
];

testCases.forEach((fn, index) => {
  test(`zlib stream supports ${index === 0 ? ".reset()" : ".params()"} before first write`, done => {
    const deflate = zlib.createDeflate();
    const inflate = zlib.createInflate();

    deflate.pipe(inflate);

    const output = [];
    inflate
      .on("error", err => {
        expect(err).toBeFalsy();
      })
      .on("data", chunk => output.push(chunk))
      .on("end", () => {
        expect(Buffer.concat(output).toString()).toBe("abc");
        done();
      });

    fn(deflate, () => {
      fn(inflate, () => {
        deflate.write("abc");
        deflate.end();
      });
    });
  });
});

//<#END_FILE: test-zlib-reset-before-write.js
