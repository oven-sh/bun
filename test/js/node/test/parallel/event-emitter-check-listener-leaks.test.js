//#FILE: test-event-emitter-check-listener-leaks.js
//#SHA1: c9d313a0879cc331d8ad1afafe5b9f482597bc7c
//-----------------
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

"use strict";

const events = require("events");

test("default", () => {
  const e = new events.EventEmitter();

  for (let i = 0; i < 10; i++) {
    e.on("default", jest.fn());
  }
  expect(Object.hasOwn(e._events.default, "warned")).toBe(false);
  e.on("default", jest.fn());
  expect(e._events.default.warned).toBe(true);

  // symbol
  const symbol = Symbol("symbol");
  e.setMaxListeners(1);
  e.on(symbol, jest.fn());
  expect(Object.hasOwn(e._events[symbol], "warned")).toBe(false);
  e.on(symbol, jest.fn());
  expect(Object.hasOwn(e._events[symbol], "warned")).toBe(true);

  // specific
  e.setMaxListeners(5);
  for (let i = 0; i < 5; i++) {
    e.on("specific", jest.fn());
  }
  expect(Object.hasOwn(e._events.specific, "warned")).toBe(false);
  e.on("specific", jest.fn());
  expect(e._events.specific.warned).toBe(true);

  // only one
  e.setMaxListeners(1);
  e.on("only one", jest.fn());
  expect(Object.hasOwn(e._events["only one"], "warned")).toBe(false);
  e.on("only one", jest.fn());
  expect(Object.hasOwn(e._events["only one"], "warned")).toBe(true);

  // unlimited
  e.setMaxListeners(0);
  for (let i = 0; i < 1000; i++) {
    e.on("unlimited", jest.fn());
  }
  expect(Object.hasOwn(e._events.unlimited, "warned")).toBe(false);
});

test("process-wide", () => {
  events.EventEmitter.defaultMaxListeners = 42;
  const e = new events.EventEmitter();

  for (let i = 0; i < 42; ++i) {
    e.on("fortytwo", jest.fn());
  }
  expect(Object.hasOwn(e._events.fortytwo, "warned")).toBe(false);
  e.on("fortytwo", jest.fn());
  expect(Object.hasOwn(e._events.fortytwo, "warned")).toBe(true);
  delete e._events.fortytwo.warned;

  events.EventEmitter.defaultMaxListeners = 44;
  e.on("fortytwo", jest.fn());
  expect(Object.hasOwn(e._events.fortytwo, "warned")).toBe(false);
  e.on("fortytwo", jest.fn());
  expect(Object.hasOwn(e._events.fortytwo, "warned")).toBe(true);
});

test("_maxListeners precedence over defaultMaxListeners", () => {
  events.EventEmitter.defaultMaxListeners = 42;
  const e = new events.EventEmitter();
  e.setMaxListeners(1);
  e.on("uno", jest.fn());
  expect(Object.hasOwn(e._events.uno, "warned")).toBe(false);
  e.on("uno", jest.fn());
  expect(Object.hasOwn(e._events.uno, "warned")).toBe(true);

  // chainable
  expect(e.setMaxListeners(1)).toBe(e);
});

//<#END_FILE: test-event-emitter-check-listener-leaks.js
