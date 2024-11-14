//#FILE: test-next-tick-when-exiting.js
//#SHA1: fcca0c205805ee8c1d9e994013d5e3738e3ef6e4
//-----------------
"use strict";

test("process.nextTick should not be called when exiting", () => {
  const exitHandler = jest.fn(() => {
    expect(process._exiting).toBe(true);

    process.nextTick(jest.fn().mockName("process is exiting, should not be called"));
  });

  process.on("exit", exitHandler);

  process.exit();

  expect(exitHandler).toHaveBeenCalledTimes(1);
  expect(exitHandler.mock.calls[0][0]).toBe(undefined);
});

//<#END_FILE: test-next-tick-when-exiting.js
