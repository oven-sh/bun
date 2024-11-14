//#FILE: test-event-emitter-symbols.js
//#SHA1: c3fa4a8db31f2a88317d3c60fb52aa2921eaa20d
//-----------------
"use strict";

const EventEmitter = require("events");

test("EventEmitter with Symbol events", () => {
  const ee = new EventEmitter();
  const foo = Symbol("foo");
  const listener = jest.fn();

  ee.on(foo, listener);
  expect(ee.listeners(foo)).toEqual([listener]);

  ee.emit(foo);
  expect(listener).toHaveBeenCalledTimes(1);

  ee.removeAllListeners();
  expect(ee.listeners(foo)).toEqual([]);

  ee.on(foo, listener);
  expect(ee.listeners(foo)).toEqual([listener]);

  ee.removeListener(foo, listener);
  expect(ee.listeners(foo)).toEqual([]);
});

//<#END_FILE: test-event-emitter-symbols.js
