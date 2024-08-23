//#FILE: test-event-emitter-modify-in-emit.js
//#SHA1: 6d378f9c7700ce7946f7d59bbc32b7cb82efc836
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

describe("EventEmitter modify in emit", () => {
  let callbacks_called;
  let e;

  function callback1() {
    callbacks_called.push("callback1");
    e.on("foo", callback2);
    e.on("foo", callback3);
    e.removeListener("foo", callback1);
  }

  function callback2() {
    callbacks_called.push("callback2");
    e.removeListener("foo", callback2);
  }

  function callback3() {
    callbacks_called.push("callback3");
    e.removeListener("foo", callback3);
  }

  beforeEach(() => {
    callbacks_called = [];
    e = new events.EventEmitter();
  });

  test("listeners are modified during emit", () => {
    e.on("foo", callback1);
    expect(e.listeners("foo").length).toBe(1);

    e.emit("foo");
    expect(e.listeners("foo").length).toBe(2);
    expect(callbacks_called).toEqual(["callback1"]);

    e.emit("foo");
    expect(e.listeners("foo").length).toBe(0);
    expect(callbacks_called).toEqual(["callback1", "callback2", "callback3"]);

    e.emit("foo");
    expect(e.listeners("foo").length).toBe(0);
    expect(callbacks_called).toEqual(["callback1", "callback2", "callback3"]);
  });

  test("removeAllListeners removes all listeners", () => {
    e.on("foo", callback1);
    e.on("foo", callback2);
    expect(e.listeners("foo").length).toBe(2);
    e.removeAllListeners("foo");
    expect(e.listeners("foo").length).toBe(0);
  });

  test("removing callbacks during emit allows emits to propagate to all listeners", () => {
    e.on("foo", callback2);
    e.on("foo", callback3);
    expect(e.listeners("foo").length).toBe(2);
    e.emit("foo");
    expect(callbacks_called).toEqual(["callback2", "callback3"]);
    expect(e.listeners("foo").length).toBe(0);
  });
});

//<#END_FILE: test-event-emitter-modify-in-emit.js
