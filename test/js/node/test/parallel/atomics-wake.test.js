//#FILE: test-atomics-wake.js
//#SHA1: 311b66a7cd5fbc08a20b77de98a66f9cba763f8f
//-----------------
"use strict";

// https://github.com/nodejs/node/issues/21219
test("Atomics.wake should be undefined", () => {
  expect(Atomics.wake).toBeUndefined();
});

//<#END_FILE: test-atomics-wake.js
