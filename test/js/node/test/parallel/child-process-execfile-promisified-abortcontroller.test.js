//#FILE: test-child-process-execFile-promisified-abortController.js
//#SHA1: 133445acf9aaafea4be11eb7965f222c5827f2f3
//-----------------
"use strict";

const { promisify } = require("util");
const execFile = require("child_process").execFile;
const fixtures = require("../common/fixtures");

const echoFixture = fixtures.path("echo.js");
const promisified = promisify(execFile);
const invalidArgTypeError = {
  code: "ERR_INVALID_ARG_TYPE",
  name: "TypeError",
};

test("Verify that the signal option works properly", async () => {
  const ac = new AbortController();
  const signal = ac.signal;
  const promise = promisified(process.execPath, [echoFixture, 0], { signal });

  ac.abort();

  await expect(promise).rejects.toThrow(
    expect.objectContaining({
      name: "AbortError",
      message: expect.any(String),
    }),
  );
});

test("Verify that the signal option works properly when already aborted", async () => {
  const signal = AbortSignal.abort();

  await expect(promisified(process.execPath, [echoFixture, 0], { signal })).rejects.toThrow(
    expect.objectContaining({
      name: "AbortError",
      message: expect.any(String),
    }),
  );
});

test("Verify that if something different than Abortcontroller.signal is passed, ERR_INVALID_ARG_TYPE is thrown", () => {
  const signal = {};
  expect(() => {
    promisified(process.execPath, [echoFixture, 0], { signal });
  }).toThrow(expect.objectContaining(invalidArgTypeError));
});

test("Verify that if a string is passed as signal, ERR_INVALID_ARG_TYPE is thrown", () => {
  const signal = "world!";
  expect(() => {
    promisified(process.execPath, [echoFixture, 0], { signal });
  }).toThrow(expect.objectContaining(invalidArgTypeError));
});

//<#END_FILE: test-child-process-execFile-promisified-abortController.js
