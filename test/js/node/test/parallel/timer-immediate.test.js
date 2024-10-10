//#FILE: test-timer-immediate.js
//#SHA1: 00e4e451b5feda969bd3352a194ba0ee0e5bab85
//-----------------
"use strict";

// Note: We're not using the 'common' module as it's not necessary for this test

test("setImmediate should be called", done => {
  // Recreate the global.process object
  global.process = {};

  // Use setImmediate and expect it to be called
  setImmediate(() => {
    expect(true).toBe(true); // This assertion is just to ensure the callback is called
    done();
  });
});

//<#END_FILE: test-timer-immediate.js
