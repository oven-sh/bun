//#FILE: test-timers-clearImmediate.js
//#SHA1: 819914471d2e9d0a4629df9ef4b96e8e87ae7606
//-----------------
"use strict";

const N = 3;

function next() {
  const fn = jest.fn();
  const immediate = setImmediate(fn);
  clearImmediate(immediate);
  expect(fn).not.toHaveBeenCalled();
}

test("clearImmediate cancels setImmediate", () => {
  for (let i = 0; i < N; i++) {
    next();
  }
});

//<#END_FILE: test-timers-clearImmediate.js
