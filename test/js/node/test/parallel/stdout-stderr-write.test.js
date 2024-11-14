//#FILE: test-stdout-stderr-write.js
//#SHA1: 8811b3e776c91c3300ee6eb32b7d1ccb4d3d5d6a
//-----------------
"use strict";

// This test checks if process.stderr.write() and process.stdout.write() return true

test("process.stderr.write() and process.stdout.write() return true", () => {
  expect(process.stderr.write("asd")).toBe(true);
  expect(process.stdout.write("asd")).toBe(true);
});

//<#END_FILE: test-stdout-stderr-write.js
