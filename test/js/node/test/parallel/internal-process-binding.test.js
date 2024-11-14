//#FILE: test-internal-process-binding.js
//#SHA1: e14c48cb6cd21ab499bd5d72cf8c8d0cddccf767
//-----------------
"use strict";

test("process internal binding", () => {
  expect(process._internalBinding).toBeUndefined();
  expect(process.internalBinding).toBeUndefined();
  expect(() => {
    process.binding("module_wrap");
  }).toThrow(
    expect.objectContaining({
      message: expect.any(String),
    }),
  );
});

//<#END_FILE: test-internal-process-binding.js
