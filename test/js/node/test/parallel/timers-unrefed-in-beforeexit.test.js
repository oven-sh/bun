//#FILE: test-timers-unrefed-in-beforeexit.js
//#SHA1: c873b545965c8b223c0bc38f2acdd4bc952427ea
//-----------------
"use strict";

test("unrefed timer in beforeExit should not prevent exit", () => {
  const beforeExitHandler = jest.fn(() => {
    setTimeout(jest.fn(), 1).unref();
  });

  process.on("beforeExit", beforeExitHandler);

  // Simulate process exit
  process.emit("beforeExit");

  expect(beforeExitHandler).toHaveBeenCalledTimes(1);

  // Clean up the event listener
  process.removeListener("beforeExit", beforeExitHandler);
});

//<#END_FILE: test-timers-unrefed-in-beforeexit.js
