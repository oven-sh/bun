//#FILE: test-outgoing-message-destroy.js
//#SHA1: 64f5438a6e8b8315e79f25d8f9e40b7dde6e3c19
//-----------------
"use strict";

// Test that http.OutgoingMessage,prototype.destroy() returns `this`.

const http = require("http");

test("http.OutgoingMessage.prototype.destroy() returns `this`", () => {
  const outgoingMessage = new http.OutgoingMessage();

  expect(outgoingMessage.destroyed).toBe(false);
  expect(outgoingMessage.destroy()).toBe(outgoingMessage);
  expect(outgoingMessage.destroyed).toBe(true);
  expect(outgoingMessage.destroy()).toBe(outgoingMessage);
});

//<#END_FILE: test-outgoing-message-destroy.js
