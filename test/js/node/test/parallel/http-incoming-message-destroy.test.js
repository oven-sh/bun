//#FILE: test-http-incoming-message-destroy.js
//#SHA1: 6bd9cad6412e348a506c2f9c9ff8e6f2e958420e
//-----------------
"use strict";

// Test that http.IncomingMessage,prototype.destroy() returns `this`.

const http = require("http");

test("http.IncomingMessage.prototype.destroy() returns `this`", () => {
  const incomingMessage = new http.IncomingMessage();
  expect(incomingMessage.destroy()).toBe(incomingMessage);
});

//<#END_FILE: test-http-incoming-message-destroy.js
