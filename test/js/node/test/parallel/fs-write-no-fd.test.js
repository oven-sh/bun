//#FILE: test-fs-write-no-fd.js
//#SHA1: eade06241743a0d7e72b5239633e1ddd947f3a28
//-----------------
"use strict";
const fs = require("fs");

test("fs.write with null fd and Buffer throws TypeError", () => {
  expect(() => {
    fs.write(null, Buffer.allocUnsafe(1), 0, 1, () => {});
  }).toThrow(
    expect.objectContaining({
      name: "TypeError",
      message: expect.any(String),
    }),
  );
});

test("fs.write with null fd and string throws TypeError", () => {
  expect(() => {
    fs.write(null, "1", 0, 1, () => {});
  }).toThrow(
    expect.objectContaining({
      name: "TypeError",
      message: expect.any(String),
    }),
  );
});

//<#END_FILE: test-fs-write-no-fd.js
