//#FILE: test-event-emitter-special-event-names.js
//#SHA1: 3ae93e3a9f5cd01560264a5c297a2fae25c5c18f
//-----------------
"use strict";

const EventEmitter = require("events");

describe("EventEmitter with special event names", () => {
  let ee;

  beforeEach(() => {
    ee = new EventEmitter();
  });

  test("initial eventNames() is empty", () => {
    expect(ee.eventNames()).toEqual([]);
  });

  test("_events does not have hasOwnProperty or toString", () => {
    expect(ee._events.hasOwnProperty).toBeUndefined();
    expect(ee._events.toString).toBeUndefined();
  });

  test("can add and list special event names", () => {
    const handler = jest.fn();

    ee.on("__proto__", handler);
    ee.on("__defineGetter__", handler);
    ee.on("toString", handler);

    expect(ee.eventNames()).toEqual(["__proto__", "__defineGetter__", "toString"]);

    expect(ee.listeners("__proto__")).toEqual([handler]);
    expect(ee.listeners("__defineGetter__")).toEqual([handler]);
    expect(ee.listeners("toString")).toEqual([handler]);
  });

  test("can emit __proto__ event", () => {
    const handler = jest.fn();
    ee.on("__proto__", handler);
    ee.emit("__proto__", 1);
    expect(handler).toHaveBeenCalledWith(1);
  });

  test("process can emit __proto__ event", () => {
    const handler = jest.fn();
    process.on("__proto__", handler);
    process.emit("__proto__", 1);
    expect(handler).toHaveBeenCalledWith(1);
  });
});

//<#END_FILE: test-event-emitter-special-event-names.js
