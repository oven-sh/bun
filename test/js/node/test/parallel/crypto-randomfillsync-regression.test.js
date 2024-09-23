//#FILE: test-crypto-randomfillsync-regression.js
//#SHA1: f37bc7cc1eab82ab93665b246c0d44e9fce8d112
//-----------------
"use strict";

// Skip the test if crypto is not available
let randomFillSync;
try {
  ({ randomFillSync } = require("crypto"));
} catch {
  test.skip("missing crypto", () => {});
}

if (randomFillSync) {
  test("randomFillSync regression test", () => {
    const ab = new ArrayBuffer(20);
    const buf = Buffer.from(ab, 10);

    const before = buf.toString("hex");

    randomFillSync(buf);

    const after = buf.toString("hex");

    expect(before).not.toBe(after);
  });
}

//<#END_FILE: test-crypto-randomfillsync-regression.js
