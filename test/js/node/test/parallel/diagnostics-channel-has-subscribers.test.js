//#FILE: test-diagnostics-channel-has-subscribers.js
//#SHA1: 8040abda8d37916d6f6d5f3966e8c531d1770e1a
//-----------------
"use strict";

const { channel, hasSubscribers } = require("diagnostics_channel");

describe("diagnostics_channel", () => {
  test("hasSubscribers returns correct state", () => {
    const dc = channel("test");
    expect(hasSubscribers("test")).toBe(false);

    dc.subscribe(() => {});
    expect(hasSubscribers("test")).toBe(true);
  });
});

//<#END_FILE: test-diagnostics-channel-has-subscribers.js
