//#FILE: test-net-server-close-before-calling-lookup-callback.js
//#SHA1: 42a269f691f19c53994f939bacf7e0451f065107
//-----------------
"use strict";

const net = require("net");

test("server closes before calling lookup callback", () => {
  // Process should exit because it does not create a real TCP server.
  // Pass localhost to ensure create TCP handle asynchronously because It causes DNS resolution.
  const server = net.createServer();

  expect(() => {
    server.listen(0, "localhost", () => {
      throw new Error("This callback should not be called");
    });
    server.close();
  }).not.toThrow();
});

//<#END_FILE: test-net-server-close-before-calling-lookup-callback.js
