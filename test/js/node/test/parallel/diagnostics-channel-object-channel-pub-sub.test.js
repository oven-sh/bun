//#FILE: test-diagnostics-channel-object-channel-pub-sub.js
//#SHA1: 185a8134da179dfda5f6b2d1a1a2622752431a90
//-----------------
"use strict";

const dc = require("diagnostics_channel");
const { Channel } = dc;

const input = {
  foo: "bar",
};

test("Channel creation and subscription", () => {
  // Should not have named channel
  expect(dc.hasSubscribers("test")).toBe(false);

  // Individual channel objects can be created to avoid future lookups
  const channel = dc.channel("test");
  expect(channel).toBeInstanceOf(Channel);

  // No subscribers yet, should not publish
  expect(channel.hasSubscribers).toBe(false);

  const subscriber = jest.fn((message, name) => {
    expect(name).toBe(channel.name);
    expect(message).toEqual(input);
  });

  // Now there's a subscriber, should publish
  channel.subscribe(subscriber);
  expect(channel.hasSubscribers).toBe(true);

  // The ActiveChannel prototype swap should not fail instanceof
  expect(channel).toBeInstanceOf(Channel);

  // Should trigger the subscriber once
  channel.publish(input);
  expect(subscriber).toHaveBeenCalledTimes(1);

  // Should not publish after subscriber is unsubscribed
  expect(channel.unsubscribe(subscriber)).toBe(true);
  expect(channel.hasSubscribers).toBe(false);

  // unsubscribe() should return false when subscriber is not found
  expect(channel.unsubscribe(subscriber)).toBe(false);
});

test("Invalid subscriber", () => {
  const channel = dc.channel("test");
  expect(() => {
    channel.subscribe(null);
  }).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      message: expect.any(String),
    }),
  );
});

//<#END_FILE: test-diagnostics-channel-object-channel-pub-sub.js
