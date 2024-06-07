import { expect } from "bun:test";

let monitorCalled = false;

setTimeout(() => {
  // uncaughtExceptionMonitor should be called
  if (!monitorCalled) {
    process.exit(1);
  }
  // timeouts should be processed
  process.exit(42);
}, 100);

process.on("uncaughtExceptionMonitor", err => {
  // Ensure this is not zero or another invalid argument
  Object.getOwnPropertyNames(err);
  String(err);

  monitorCalled = true;
  if (!err) {
    process.exit(1);
  }
});

process.on("uncaughtException", err => {
  // Ensure this is not zero or another invalid argument
  Object.getOwnPropertyNames(err);
  String(err);

  // there should be an error
  if (!err) {
    process.exit(1);
  }

  expect(Bun.inspect(err)).toBe(`46 |   //
47 |   //
48 | });
49 |\x20
50 | setTimeout(() => {
51 |   throw new Error(\"Error\");
                 ^
error: Error
      at /Users/dave/code/bun/test/js/node/process/process-onUncaughtExceptionSetTimeout.js:51:13
`);
  //
  //
  //
});

setTimeout(() => {
  throw new Error("Error");
}, 1);
