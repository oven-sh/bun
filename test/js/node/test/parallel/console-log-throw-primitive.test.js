//#FILE: test-console-log-throw-primitive.js
//#SHA1: a1889badf1058f6fadc8984a5075f3d048e2948c
//-----------------
"use strict";

const { Writable } = require("stream");
const { Console } = require("console");

test("Console.log should not throw when stream throws null", () => {
  const stream = new Writable({
    write() {
      throw null; // eslint-disable-line no-throw-literal
    },
  });

  const console = new Console({ stdout: stream });

  // Should not throw
  expect(() => console.log("test")).not.toThrow();
});

//<#END_FILE: test-console-log-throw-primitive.js
