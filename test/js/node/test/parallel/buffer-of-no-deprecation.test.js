//#FILE: test-buffer-of-no-deprecation.js
//#SHA1: 7c233f8a82411a5d1c293daecef6494d02d7dabf
//-----------------
"use strict";

test("Buffer.of() should not emit deprecation warning", () => {
  const warningListener = jest.fn();
  process.on("warning", warningListener);

  Buffer.of(0, 1);

  expect(warningListener).not.toHaveBeenCalled();

  // Clean up the listener
  process.removeListener("warning", warningListener);
});

//<#END_FILE: test-buffer-of-no-deprecation.js
