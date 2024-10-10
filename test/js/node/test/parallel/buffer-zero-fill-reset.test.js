//#FILE: test-buffer-zero-fill-reset.js
//#SHA1: 2278dd06a2e113e875c1f0f46580c0fcc4fc5254
//-----------------
"use strict";

test("Uint8Array is zero-filled after Buffer.alloc(0)", () => {
  function testUint8Array(ui) {
    const length = ui.length;
    for (let i = 0; i < length; i++) if (ui[i] !== 0) return false;
    return true;
  }

  for (let i = 0; i < 100; i++) {
    Buffer.alloc(0);
    const ui = new Uint8Array(65);
    expect(testUint8Array(ui)).toBe(true);
  }
});

//<#END_FILE: test-buffer-zero-fill-reset.js
