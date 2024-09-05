//#FILE: test-dgram-abort-closed.js
//#SHA1: 8d3ab4d13dda99cdccb6994f165f2ddacf58360c
//-----------------
"use strict";

const dgram = require("dgram");

test("AbortController with closed dgram socket", () => {
  const controller = new AbortController();
  const socket = dgram.createSocket({ type: "udp4", signal: controller.signal });

  socket.close();

  // This should not throw or cause any issues
  expect(() => {
    controller.abort();
  }).not.toThrow();
});

//<#END_FILE: test-dgram-abort-closed.js
