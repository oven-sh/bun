//#FILE: test-errors-systemerror-stackTraceLimit-deleted-and-Error-sealed.js
//#SHA1: 5d9d37ff8651fd7b7ffd5e9ae1b54e4ebc900355
//-----------------
"use strict";

test("SystemError with deleted stackTraceLimit and sealed Error", () => {
  delete Error.stackTraceLimit;
  Object.seal(Error);

  const ctx = {
    code: "ETEST",
    message: "code message",
    syscall: "syscall_test",
    path: "/str",
    dest: "/str2",
  };

  const errorThrowingFunction = () => {
    const error = new Error("custom message");
    error.code = "ERR_TEST";
    error.name = "SystemError";
    error.info = ctx;
    throw error;
  };

  expect(errorThrowingFunction).toThrow(
    expect.objectContaining({
      code: "ERR_TEST",
      name: "SystemError",
      info: ctx,
      message: expect.any(String),
    }),
  );
});

//<#END_FILE: test-errors-systemerror-stackTraceLimit-deleted-and-Error-sealed.js
