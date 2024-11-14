//#FILE: test-timers-timeout-with-non-integer.js
//#SHA1: 371503ab8a31c6749ef77eabac3054e5a43ab231
//-----------------
"use strict";

/**
 * This test is for https://github.com/nodejs/node/issues/24203
 */
test("setTimeout with non-integer time", done => {
  let count = 50;
  const time = 1.00000000000001;

  const exec = jest.fn(() => {
    if (--count === 0) {
      expect(exec).toHaveBeenCalledTimes(50);
      done();
      return;
    }
    setTimeout(exec, time);
  });

  exec();
}, 10000); // Increased timeout to ensure all iterations complete

//<#END_FILE: test-timers-timeout-with-non-integer.js
