//#FILE: test-diagnostics-channel-tracing-channel-promise.js
//#SHA1: 6a692d8400685da6c930b662562adb3e36b2da9a
//-----------------
"use strict";

const dc = require("diagnostics_channel");

const channel = dc.tracingChannel("test");

const expectedResult = { foo: "bar" };
const input = { foo: "bar" };
const thisArg = { baz: "buz" };

function check(found) {
  expect(found).toEqual(input);
}

function checkAsync(found) {
  check(found);
  expect(found.error).toBeUndefined();
  expect(found.result).toEqual(expectedResult);
}

const handlers = {
  start: jest.fn(check),
  end: jest.fn(check),
  asyncStart: jest.fn(checkAsync),
  asyncEnd: jest.fn(checkAsync),
  error: jest.fn(),
};

test("diagnostics_channel tracing channel promise", async () => {
  channel.subscribe(handlers);

  await channel.tracePromise(
    function (value) {
      expect(this).toEqual(thisArg);
      return Promise.resolve(value);
    },
    input,
    thisArg,
    expectedResult,
  );

  expect(handlers.start).toHaveBeenCalledTimes(1);
  expect(handlers.end).toHaveBeenCalledTimes(1);
  expect(handlers.asyncStart).toHaveBeenCalledTimes(1);
  expect(handlers.asyncEnd).toHaveBeenCalledTimes(1);
  expect(handlers.error).not.toHaveBeenCalled();

  const value = await channel.tracePromise(
    function (value) {
      expect(this).toEqual(thisArg);
      return Promise.resolve(value);
    },
    input,
    thisArg,
    expectedResult,
  );

  expect(value).toEqual(expectedResult);
});

//<#END_FILE: test-diagnostics-channel-tracing-channel-promise.js
