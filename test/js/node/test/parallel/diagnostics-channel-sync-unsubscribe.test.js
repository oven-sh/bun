//#FILE: test-diagnostics-channel-sync-unsubscribe.js
//#SHA1: 85d73bd9ce82a4293daca05617b2aece359745ff
//-----------------
"use strict";

const dc = require("node:diagnostics_channel");

const channel_name = "test:channel";
const published_data = "some message";

test("diagnostics channel sync unsubscribe", () => {
  const onMessageHandler = jest.fn(() => dc.unsubscribe(channel_name, onMessageHandler));

  dc.subscribe(channel_name, onMessageHandler);

  // This must not throw.
  expect(() => {
    dc.channel(channel_name).publish(published_data);
  }).not.toThrow();

  expect(onMessageHandler).toHaveBeenCalledTimes(1);
});

//<#END_FILE: test-diagnostics-channel-sync-unsubscribe.js
