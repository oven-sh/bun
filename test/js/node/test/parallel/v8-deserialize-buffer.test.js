//#FILE: test-v8-deserialize-buffer.js
//#SHA1: ef80f8c41f9e9b893ea639f4558713addcf82b9a
//-----------------
"use strict";

const v8 = require("v8");

test("v8.deserialize should not emit warnings for Buffer.alloc(0)", () => {
  const warningListener = jest.fn();
  process.on("warning", warningListener);

  v8.deserialize(v8.serialize(Buffer.alloc(0)));

  expect(warningListener).not.toHaveBeenCalled();

  // Clean up the listener
  process.removeListener("warning", warningListener);
});

//<#END_FILE: test-v8-deserialize-buffer.js
