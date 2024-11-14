//#FILE: test-fs-readdir-buffer.js
//#SHA1: 333645cb13aa3c15d61428ecfa2794e7393ef91c
//-----------------
"use strict";

const fs = require("fs");

if (process.platform !== "darwin") {
  it("skips test on non-MacOS platforms", () => {
    test.skip("this test works only on MacOS");
  });
} else {
  test("readdir with buffer and withFileTypes options on MacOS", () => {
    return new Promise(resolve => {
      fs.readdir(Buffer.from("/dev"), { withFileTypes: true, encoding: "buffer" }, (err, files) => {
        expect(err).toBeNull();
        resolve();
      });
    });
  });
}

//<#END_FILE: test-fs-readdir-buffer.js
