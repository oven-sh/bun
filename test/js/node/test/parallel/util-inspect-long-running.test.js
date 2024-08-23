//#FILE: test-util-inspect-long-running.js
//#SHA1: 2e4cbb5743a4dfcf869e84ce6d58795f96465aeb
//-----------------
"use strict";

// Test that huge objects don't crash due to exceeding the maximum heap size.

const util = require("util");

test("util.inspect handles huge objects without crashing", () => {
  // Create a difficult to stringify object. Without the artificial limitation
  // this would crash or throw an maximum string size error.
  let last = {};
  const obj = last;

  for (let i = 0; i < 1000; i++) {
    last.next = { circular: obj, last, obj: { a: 1, b: 2, c: true } };
    last = last.next;
    obj[i] = last;
  }

  // This should not throw an error or crash
  expect(() => {
    util.inspect(obj, { depth: Infinity });
  }).not.toThrow();
});

//<#END_FILE: test-util-inspect-long-running.js
