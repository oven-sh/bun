//#FILE: test-buffer-zero-fill.js
//#SHA1: b710e0c9405c90f7526cf0efabd4c61ede37b1f7
//-----------------
"use strict";

// Tests deprecated Buffer API on purpose
test("Buffer zero-fill", () => {
  const buf1 = Buffer(100);
  const buf2 = new Buffer(100);

  for (let n = 0; n < buf1.length; n++) {
    expect(buf1[n]).toBe(0);
  }

  for (let n = 0; n < buf2.length; n++) {
    expect(buf2[n]).toBe(0);
  }
});

//<#END_FILE: test-buffer-zero-fill.js
