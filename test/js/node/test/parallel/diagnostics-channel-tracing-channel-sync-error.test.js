//#FILE: test-diagnostics-channel-tracing-channel-sync-error.js
//#SHA1: faf279d48c76f3c97ddf7e258df9ed49154a4cac
//-----------------
"use strict";

const dc = require("diagnostics_channel");

const channel = dc.tracingChannel("test");

const expectedError = new Error("test");
const input = { foo: "bar" };
const thisArg = { baz: "buz" };

function check(found) {
  expect(found).toEqual(input);
}

test("traceSync with error", () => {
  const handlers = {
    start: jest.fn(check),
    end: jest.fn(check),
    asyncStart: jest.fn(),
    asyncEnd: jest.fn(),
    error: jest.fn(found => {
      check(found);
      expect(found.error).toBe(expectedError);
    }),
  };

  channel.subscribe(handlers);

  expect(() => {
    channel.traceSync(
      function (err) {
        expect(this).toEqual(thisArg);
        expect(err).toBe(expectedError);
        throw err;
      },
      input,
      thisArg,
      expectedError,
    );
  }).toThrow(expectedError);

  expect(handlers.start).toHaveBeenCalledTimes(1);
  expect(handlers.end).toHaveBeenCalledTimes(1);
  expect(handlers.asyncStart).not.toHaveBeenCalled();
  expect(handlers.asyncEnd).not.toHaveBeenCalled();
  expect(handlers.error).toHaveBeenCalledTimes(1);
});

//<#END_FILE: test-diagnostics-channel-tracing-channel-sync-error.js
