//#FILE: test-process-available-memory.js
//#SHA1: 9dd0a4755f67f4786a0b7fc076d81be2a0b2063b
//-----------------
"use strict";

test("process.availableMemory()", () => {
  const availableMemory = process.availableMemory();
  expect(typeof availableMemory).toBe("number");
});

//<#END_FILE: test-process-available-memory.js
