//#FILE: test-process-constrained-memory.js
//#SHA1: 6c09d5733a7ac49f00b4923125a023c670423adf
//-----------------
"use strict";

test("process.constrainedMemory()", () => {
  const constrainedMemory = process.constrainedMemory();
  expect(typeof constrainedMemory).toBe("number");
});

//<#END_FILE: test-process-constrained-memory.js
