//#FILE: test-async-hooks-run-in-async-scope-this-arg.js
//#SHA1: a716f9818bdd704e1cf7ca188ffd4ccb9501a8a7
//-----------------
"use strict";

// Test that passing thisArg to runInAsyncScope() works.

const { AsyncResource } = require("async_hooks");

const thisArg = {};

const res = new AsyncResource("fhqwhgads");

function callback() {
  expect(this).toBe(thisArg);
}

test("runInAsyncScope with thisArg", () => {
  const callbackSpy = jest.fn(callback);
  res.runInAsyncScope(callbackSpy, thisArg);
  expect(callbackSpy).toHaveBeenCalledTimes(1);
});

//<#END_FILE: test-async-hooks-run-in-async-scope-this-arg.js
