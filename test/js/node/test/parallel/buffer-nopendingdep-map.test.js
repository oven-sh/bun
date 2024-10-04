//#FILE: test-buffer-nopendingdep-map.js
//#SHA1: 908b5747ec3c5873c180b66b6e50221fd29169e3
//-----------------
// Flags: --no-warnings --pending-deprecation
"use strict";

test("Buffer methods should not emit deprecation warnings with --pending-deprecation", () => {
  const warningListener = jest.fn();
  process.on("warning", warningListener);

  // With the --pending-deprecation flag, the deprecation warning for
  // new Buffer() should not be emitted when Uint8Array methods are called.

  Buffer.from("abc").map(i => i);
  Buffer.from("abc").filter(i => i);
  Buffer.from("abc").slice(1, 2);

  expect(warningListener).not.toHaveBeenCalled();

  process.removeListener("warning", warningListener);
});

//<#END_FILE: test-buffer-nopendingdep-map.js
