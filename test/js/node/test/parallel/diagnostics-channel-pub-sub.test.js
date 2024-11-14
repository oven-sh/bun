//#FILE: test-diagnostics-channel-pub-sub.js
//#SHA1: cc5eee7f44117c2fd8446e8050ac19f5341f85a5
//-----------------
"use strict";

const dc = require("diagnostics_channel");
const { Channel } = dc;

const name = "test";
const input = {
  foo: "bar",
};

test("diagnostics_channel pub/sub functionality", () => {
  // Individual channel objects can be created to avoid future lookups
  const channel = dc.channel(name);
  expect(channel).toBeInstanceOf(Channel);

  // No subscribers yet, should not publish
  expect(channel.hasSubscribers).toBeFalsy();

  const subscriber = jest.fn((message, channelName) => {
    expect(channelName).toBe(channel.name);
    expect(message).toEqual(input);
  });

  // Now there's a subscriber, should publish
  dc.subscribe(name, subscriber);
  expect(channel.hasSubscribers).toBeTruthy();

  // The ActiveChannel prototype swap should not fail instanceof
  expect(channel).toBeInstanceOf(Channel);

  // Should trigger the subscriber once
  channel.publish(input);
  expect(subscriber).toHaveBeenCalledTimes(1);

  // Should not publish after subscriber is unsubscribed
  expect(dc.unsubscribe(name, subscriber)).toBeTruthy();
  expect(channel.hasSubscribers).toBeFalsy();

  // unsubscribe() should return false when subscriber is not found
  expect(dc.unsubscribe(name, subscriber)).toBeFalsy();

  expect(() => {
    dc.subscribe(name, null);
  }).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      message: expect.any(String),
    }),
  );

  // Reaching zero subscribers should not delete from the channels map as there
  // will be no more weakref to incRef if another subscribe happens while the
  // channel object itself exists.
  channel.subscribe(subscriber);
  channel.unsubscribe(subscriber);
  channel.subscribe(subscriber);
});

//<#END_FILE: test-diagnostics-channel-pub-sub.js
