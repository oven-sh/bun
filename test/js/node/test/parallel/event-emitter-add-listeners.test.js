//#FILE: test-event-emitter-add-listeners.js
//#SHA1: 25d8611a8cf3694d26e53bb90f760beeb3bb1946
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
const EventEmitter = require("events");

test("EventEmitter addListener functionality", () => {
  const ee = new EventEmitter();
  const events_new_listener_emitted = [];
  const listeners_new_listener_emitted = [];

  // Sanity check
  expect(ee.addListener).toBe(ee.on);

  ee.on("newListener", function (event, listener) {
    // Don't track newListener listeners.
    if (event === "newListener") return;

    events_new_listener_emitted.push(event);
    listeners_new_listener_emitted.push(listener);
  });

  const hello = jest.fn((a, b) => {
    expect(a).toBe("a");
    expect(b).toBe("b");
  });

  ee.once("newListener", function (name, listener) {
    expect(name).toBe("hello");
    expect(listener).toBe(hello);
    expect(this.listeners("hello")).toEqual([]);
  });

  ee.on("hello", hello);
  ee.once("foo", () => {
    throw new Error("This should not be called");
  });
  expect(events_new_listener_emitted).toEqual(["hello", "foo"]);
  expect(listeners_new_listener_emitted).toEqual([hello, expect.any(Function)]);

  ee.emit("hello", "a", "b");
  expect(hello).toHaveBeenCalledTimes(1);
});

test("setMaxListeners with 0 does not throw", () => {
  const f = new EventEmitter();
  expect(() => {
    f.setMaxListeners(0);
  }).not.toThrow();
});

test("newListener event and listener order", () => {
  const listen1 = () => {};
  const listen2 = () => {};
  const ee = new EventEmitter();

  ee.once("newListener", function () {
    expect(ee.listeners("hello")).toEqual([]);
    ee.once("newListener", function () {
      expect(ee.listeners("hello")).toEqual([]);
    });
    ee.on("hello", listen2);
  });
  ee.on("hello", listen1);
  // The order of listeners on an event is not always the order in which the
  // listeners were added.
  expect(ee.listeners("hello")).toEqual([listen2, listen1]);
});

//<#END_FILE: test-event-emitter-add-listeners.js
