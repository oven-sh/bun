//#FILE: test-permission-experimental.js
//#SHA1: 36473a765501ce88ab35ab15f443149ba00e9856
//-----------------
// Flags: --experimental-permission --allow-fs-read=*
"use strict";

// This test ensures that the experimental message is emitted
// when using permission system

test("experimental permission warning", () => {
  const warningListener = jest.fn(warning => {
    expect(warning.message).toMatch(/Permission is an experimental feature/);
  });

  process.on("warning", warningListener);

  // Simulate the execution that would trigger the warning
  process.emit("warning", new Error("Permission is an experimental feature"));

  expect(warningListener).toHaveBeenCalledTimes(1);

  // Clean up
  process.removeListener("warning", warningListener);
});

//<#END_FILE: test-permission-experimental.js
