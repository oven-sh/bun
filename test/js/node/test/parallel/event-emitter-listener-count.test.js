//#FILE: test-event-emitter-listener-count.js
//#SHA1: 0f4b7f14fe432472b51524b3853db6d8615614f1
//-----------------
"use strict";

const EventEmitter = require("events");

describe("EventEmitter.listenerCount and emitter.listenerCount", () => {
  let emitter;

  beforeEach(() => {
    emitter = new EventEmitter();
    emitter.on("foo", () => {});
    emitter.on("foo", () => {});
    emitter.on("baz", () => {});
    // Allow any type
    emitter.on(123, () => {});
  });

  test("EventEmitter.listenerCount returns correct count", () => {
    expect(EventEmitter.listenerCount(emitter, "foo")).toBe(2);
  });

  test("emitter.listenerCount returns correct counts for various events", () => {
    expect(emitter.listenerCount("foo")).toBe(2);
    expect(emitter.listenerCount("bar")).toBe(0);
    expect(emitter.listenerCount("baz")).toBe(1);
    expect(emitter.listenerCount(123)).toBe(1);
  });
});

//<#END_FILE: test-event-emitter-listener-count.js
