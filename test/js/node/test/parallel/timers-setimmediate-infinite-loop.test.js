//#FILE: test-timers-setimmediate-infinite-loop.js
//#SHA1: cd4dd01a6d06097758004eaa8d36d8712977d49d
//-----------------
"use strict";

// This test ensures that if an Immediate callback clears subsequent
// immediates we don't get stuck in an infinite loop.
//
// If the process does get stuck, it will be timed out by the test
// runner.
//
// Ref: https://github.com/nodejs/node/issues/9756

test("setImmediate clears subsequent immediates without infinite loop", done => {
  const firstCallback = jest.fn(() => {
    clearImmediate(i2);
    clearImmediate(i3);
  });

  const secondCallback = jest.fn();
  const thirdCallback = jest.fn();

  setImmediate(firstCallback);

  const i2 = setImmediate(secondCallback);
  const i3 = setImmediate(thirdCallback);

  // Use a timeout to ensure all immediates have been processed
  setTimeout(() => {
    expect(firstCallback).toHaveBeenCalledTimes(1);
    expect(secondCallback).not.toHaveBeenCalled();
    expect(thirdCallback).not.toHaveBeenCalled();
    done();
  }, 100);
});

//<#END_FILE: test-timers-setimmediate-infinite-loop.js
