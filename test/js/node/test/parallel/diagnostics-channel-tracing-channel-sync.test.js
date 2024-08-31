//#FILE: test-diagnostics-channel-tracing-channel-sync.js
//#SHA1: fad9bfb35032ed67643b026f8e79611d8197a131
//-----------------
"use strict";

const dc = require("diagnostics_channel");

const channel = dc.tracingChannel("test");

const expectedResult = { foo: "bar" };
const input = { foo: "bar" };
const thisArg = { baz: "buz" };
const arg = { baz: "buz" };

function check(found) {
  expect(found).toBe(input);
}

describe("diagnostics_channel tracing channel sync", () => {
  const handlers = {
    start: jest.fn(check),
    end: jest.fn(found => {
      check(found);
      expect(found.result).toBe(expectedResult);
    }),
    asyncStart: jest.fn(),
    asyncEnd: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("channel subscription and traceSync", () => {
    expect(channel.start.hasSubscribers).toBe(false);
    channel.subscribe(handlers);
    expect(channel.start.hasSubscribers).toBe(true);

    const result1 = channel.traceSync(
      function (arg1) {
        expect(arg1).toBe(arg);
        expect(this).toBe(thisArg);
        return expectedResult;
      },
      input,
      thisArg,
      arg,
    );

    expect(result1).toBe(expectedResult);
    expect(handlers.start).toHaveBeenCalledTimes(1);
    expect(handlers.end).toHaveBeenCalledTimes(1);
    expect(handlers.asyncStart).not.toHaveBeenCalled();
    expect(handlers.asyncEnd).not.toHaveBeenCalled();
    expect(handlers.error).not.toHaveBeenCalled();
  });

  test("channel unsubscription", () => {
    channel.unsubscribe(handlers);
    expect(channel.start.hasSubscribers).toBe(false);

    const result2 = channel.traceSync(
      function (arg1) {
        expect(arg1).toBe(arg);
        expect(this).toBe(thisArg);
        return expectedResult;
      },
      input,
      thisArg,
      arg,
    );

    expect(result2).toBe(expectedResult);
    expect(handlers.start).not.toHaveBeenCalled();
    expect(handlers.end).not.toHaveBeenCalled();
  });
});

//<#END_FILE: test-diagnostics-channel-tracing-channel-sync.js
