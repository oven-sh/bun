//#FILE: test-event-emitter-get-max-listeners.js
//#SHA1: ff5c2f7b9525ae4137ea8eddd742572bd399c5ce
//-----------------
"use strict";

const EventEmitter = require("events");

test("EventEmitter getMaxListeners", () => {
  const emitter = new EventEmitter();

  expect(emitter.getMaxListeners()).toBe(EventEmitter.defaultMaxListeners);

  emitter.setMaxListeners(0);
  expect(emitter.getMaxListeners()).toBe(0);

  emitter.setMaxListeners(3);
  expect(emitter.getMaxListeners()).toBe(3);
});

// https://github.com/nodejs/node/issues/523 - second call should not throw.
test("EventEmitter.prototype.on should not throw on second call", () => {
  const recv = {};
  expect(() => {
    EventEmitter.prototype.on.call(recv, "event", () => {});
    EventEmitter.prototype.on.call(recv, "event", () => {});
  }).not.toThrow();
});

//<#END_FILE: test-event-emitter-get-max-listeners.js
