//#FILE: test-net-write-arguments.js
//#SHA1: 2a9ed0086e2675e0e31ef15c1e86b15c47c10c5b
//-----------------
"use strict";
const net = require("net");

test("net.Stream write arguments", () => {
  const socket = net.Stream({ highWaterMark: 0 });

  // Make sure that anything besides a buffer or a string throws.
  socket.on("error", jest.fn());
  expect(() => {
    socket.write(null);
  }).toThrow(
    expect.objectContaining({
      code: "ERR_STREAM_NULL_VALUES",
      name: "TypeError",
      message: expect.any(String),
    }),
  );

  [true, false, undefined, 1, 1.0, +Infinity, -Infinity, [], {}].forEach(value => {
    const socket = net.Stream({ highWaterMark: 0 });
    // We need to check the callback since 'error' will only
    // be emitted once per instance.
    expect(() => {
      socket.write(value);
    }).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: expect.any(String),
      }),
    );
  });
});

//<#END_FILE: test-net-write-arguments.js
