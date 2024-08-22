//#FILE: test-event-emitter-num-args.js
//#SHA1: b17b5bfd071180f4c53c8c408dc14ec860fd4225
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

describe("EventEmitter number of arguments", () => {
  let e;
  let num_args_emitted;

  beforeEach(() => {
    e = new events.EventEmitter();
    num_args_emitted = [];

    e.on("numArgs", function () {
      const numArgs = arguments.length;
      num_args_emitted.push(numArgs);
    });

    e.on("foo", function () {
      num_args_emitted.push(arguments.length);
    });

    e.on("foo", function () {
      num_args_emitted.push(arguments.length);
    });
  });

  it("should emit correct number of arguments", () => {
    e.emit("numArgs");
    e.emit("numArgs", null);
    e.emit("numArgs", null, null);
    e.emit("numArgs", null, null, null);
    e.emit("numArgs", null, null, null, null);
    e.emit("numArgs", null, null, null, null, null);

    e.emit("foo", null, null, null, null);

    expect(num_args_emitted).toEqual([0, 1, 2, 3, 4, 5, 4, 4]);
  });
});

//<#END_FILE: test-event-emitter-num-args.js
