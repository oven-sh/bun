//#FILE: test-diagnostics-channel-symbol-named.js
//#SHA1: e0ae87b803333891439e11fa2306eefd23b507e4
//-----------------
"use strict";

const dc = require("diagnostics_channel");

const input = {
  foo: "bar",
};

const symbol = Symbol("test");

// Individual channel objects can be created to avoid future lookups
const channel = dc.channel(symbol);

test("diagnostics channel with symbol name", () => {
  // Expect two successful publishes later
  const subscriber = jest.fn((message, name) => {
    expect(name).toBe(symbol);
    expect(message).toEqual(input);
  });

  channel.subscribe(subscriber);

  channel.publish(input);

  expect(subscriber).toHaveBeenCalledTimes(1);
});

test("channel creation with invalid argument", () => {
  expect(() => {
    dc.channel(null);
  }).toThrow(
    expect.objectContaining({
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
      message: expect.any(String),
    }),
  );
});

//<#END_FILE: test-diagnostics-channel-symbol-named.js
