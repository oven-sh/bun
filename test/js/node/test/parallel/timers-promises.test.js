//#FILE: test-timers-promises.js
//#SHA1: 78e3867e4cb1a41f11f7fa930e5a7319149c9452
//-----------------
"use strict";

const timer = require("node:timers");
const timerPromises = require("node:timers/promises");

test("(node:timers/promises) is equal to (node:timers).promises", () => {
  expect(timerPromises).toEqual(timer.promises);
});

//<#END_FILE: test-timers-promises.js
