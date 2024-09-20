//#FILE: test-stream-readable-event.js
//#SHA1: 8a3da958252097730dcd22e82d325d106d5512a5
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

const { Readable } = require("stream");

test("not reading when the readable is added", done => {
  const r = new Readable({
    highWaterMark: 3,
  });

  r._read = jest.fn();

  // This triggers a 'readable' event, which is lost.
  r.push(Buffer.from("blerg"));

  setTimeout(() => {
    // We're testing what we think we are
    expect(r._readableState.reading).toBe(false);
    const readableSpy = jest.fn();
    r.on("readable", readableSpy);

    // Allow time for the 'readable' event to potentially fire
    setTimeout(() => {
      expect(readableSpy).toHaveBeenCalled();
      expect(r._read).not.toHaveBeenCalled();
      done();
    }, 10);
  }, 1);
});

test("readable is re-emitted if there's already a length, while it IS reading", done => {
  const r = new Readable({
    highWaterMark: 3,
  });

  r._read = jest.fn();

  // This triggers a 'readable' event, which is lost.
  r.push(Buffer.from("bl"));

  setTimeout(() => {
    // Assert we're testing what we think we are
    expect(r._readableState.reading).toBe(true);
    const readableSpy = jest.fn();
    r.on("readable", readableSpy);

    // Allow time for the 'readable' event to potentially fire
    setTimeout(() => {
      expect(readableSpy).toHaveBeenCalled();
      expect(r._read).toHaveBeenCalled();
      done();
    }, 10);
  }, 1);
});

test("not reading when the stream has not passed the highWaterMark but has reached EOF", done => {
  const r = new Readable({
    highWaterMark: 30,
  });

  r._read = jest.fn();

  // This triggers a 'readable' event, which is lost.
  r.push(Buffer.from("blerg"));
  r.push(null);

  setTimeout(() => {
    // Assert we're testing what we think we are
    expect(r._readableState.reading).toBe(false);
    const readableSpy = jest.fn();
    r.on("readable", readableSpy);

    // Allow time for the 'readable' event to potentially fire
    setTimeout(() => {
      expect(readableSpy).toHaveBeenCalled();
      expect(r._read).not.toHaveBeenCalled();
      done();
    }, 10);
  }, 1);
});

test("Pushing an empty string in non-objectMode should trigger next `read()`", done => {
  const underlyingData = ["", "x", "y", "", "z"];
  const expected = underlyingData.filter(data => data);
  const result = [];

  const r = new Readable({
    encoding: "utf8",
  });
  r._read = function () {
    process.nextTick(() => {
      if (!underlyingData.length) {
        this.push(null);
      } else {
        this.push(underlyingData.shift());
      }
    });
  };

  r.on("readable", () => {
    const data = r.read();
    if (data !== null) result.push(data);
  });

  r.on("end", () => {
    expect(result).toEqual(expected);
    done();
  });
});

test("#20923 - removeAllListeners should clear all event listeners", () => {
  const r = new Readable();
  r._read = function () {
    // Actually doing thing here
  };
  r.on("data", function () {});

  r.removeAllListeners();

  expect(r.eventNames().length).toBe(0);
});

//<#END_FILE: test-stream-readable-event.js
