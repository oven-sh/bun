//#FILE: test-stream2-objects.js
//#SHA1: e9aa308270bcb656e33df7deb63c8ce8739c0f35
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

const { Readable, Writable } = require("stream");

function toArray(callback) {
  const stream = new Writable({ objectMode: true });
  const list = [];
  stream.write = function (chunk) {
    list.push(chunk);
  };

  stream.end = function () {
    callback(list);
  };

  return stream;
}

function fromArray(list) {
  const r = new Readable({ objectMode: true });
  r._read = jest.fn();
  list.forEach(function (chunk) {
    r.push(chunk);
  });
  r.push(null);

  return r;
}

test("Verify that objects can be read from the stream", () => {
  const r = fromArray([{ one: "1" }, { two: "2" }]);

  const v1 = r.read();
  const v2 = r.read();
  const v3 = r.read();

  expect(v1).toEqual({ one: "1" });
  expect(v2).toEqual({ two: "2" });
  expect(v3).toBeNull();
});

test("Verify that objects can be piped into the stream", done => {
  const r = fromArray([{ one: "1" }, { two: "2" }]);

  r.pipe(
    toArray(list => {
      expect(list).toEqual([{ one: "1" }, { two: "2" }]);
      done();
    }),
  );
});

test("Verify that read(n) is ignored", () => {
  const r = fromArray([{ one: "1" }, { two: "2" }]);
  const value = r.read(2);

  expect(value).toEqual({ one: "1" });
});

test("Verify that objects can be synchronously read", done => {
  const r = new Readable({ objectMode: true });
  const list = [{ one: "1" }, { two: "2" }];
  r._read = function (n) {
    const item = list.shift();
    r.push(item || null);
  };

  r.pipe(
    toArray(list => {
      expect(list).toEqual([{ one: "1" }, { two: "2" }]);
      done();
    }),
  );
});

test("Verify that objects can be asynchronously read", done => {
  const r = new Readable({ objectMode: true });
  const list = [{ one: "1" }, { two: "2" }];
  r._read = function (n) {
    const item = list.shift();
    process.nextTick(function () {
      r.push(item || null);
    });
  };

  r.pipe(
    toArray(list => {
      expect(list).toEqual([{ one: "1" }, { two: "2" }]);
      done();
    }),
  );
});

test("Verify that strings can be read as objects", done => {
  const r = new Readable({
    objectMode: true,
  });
  r._read = jest.fn();
  const list = ["one", "two", "three"];
  list.forEach(function (str) {
    r.push(str);
  });
  r.push(null);

  r.pipe(
    toArray(array => {
      expect(array).toEqual(list);
      done();
    }),
  );
});

test("Verify read(0) behavior for object streams", done => {
  const r = new Readable({
    objectMode: true,
  });
  r._read = jest.fn();

  r.push("foobar");
  r.push(null);

  r.pipe(
    toArray(array => {
      expect(array).toEqual(["foobar"]);
      done();
    }),
  );
});

test("Verify the behavior of pushing falsey values", done => {
  const r = new Readable({
    objectMode: true,
  });
  r._read = jest.fn();

  r.push(false);
  r.push(0);
  r.push("");
  r.push(null);

  r.pipe(
    toArray(array => {
      expect(array).toEqual([false, 0, ""]);
      done();
    }),
  );
});

test("Verify high watermark _read() behavior", () => {
  const r = new Readable({
    highWaterMark: 6,
    objectMode: true,
  });
  let calls = 0;
  const list = ["1", "2", "3", "4", "5", "6", "7", "8"];

  r._read = function (n) {
    calls++;
  };

  list.forEach(function (c) {
    r.push(c);
  });

  const v = r.read();

  expect(calls).toBe(0);
  expect(v).toBe("1");

  const v2 = r.read();
  expect(v2).toBe("2");

  const v3 = r.read();
  expect(v3).toBe("3");

  expect(calls).toBe(1);
});

test("Verify high watermark push behavior", () => {
  const r = new Readable({
    highWaterMark: 6,
    objectMode: true,
  });
  r._read = jest.fn();
  for (let i = 0; i < 6; i++) {
    const bool = r.push(i);
    expect(bool).toBe(i !== 5);
  }
});

test("Verify that objects can be written to stream", done => {
  const w = new Writable({ objectMode: true });

  w._write = function (chunk, encoding, cb) {
    expect(chunk).toEqual({ foo: "bar" });
    cb();
  };

  w.on("finish", done);
  w.write({ foo: "bar" });
  w.end();
});

test("Verify that multiple objects can be written to stream", done => {
  const w = new Writable({ objectMode: true });
  const list = [];

  w._write = function (chunk, encoding, cb) {
    list.push(chunk);
    cb();
  };

  w.on("finish", () => {
    expect(list).toEqual([0, 1, 2, 3, 4]);
    done();
  });

  w.write(0);
  w.write(1);
  w.write(2);
  w.write(3);
  w.write(4);
  w.end();
});

test("Verify that strings can be written as objects", done => {
  const w = new Writable({
    objectMode: true,
  });
  const list = [];

  w._write = function (chunk, encoding, cb) {
    list.push(chunk);
    process.nextTick(cb);
  };

  w.on("finish", () => {
    expect(list).toEqual(["0", "1", "2", "3", "4"]);
    done();
  });

  w.write("0");
  w.write("1");
  w.write("2");
  w.write("3");
  w.write("4");
  w.end();
});

test("Verify that stream buffers finish until callback is called", done => {
  const w = new Writable({
    objectMode: true,
  });
  let called = false;

  w._write = function (chunk, encoding, cb) {
    expect(chunk).toBe("foo");

    process.nextTick(function () {
      called = true;
      cb();
    });
  };

  w.on("finish", () => {
    expect(called).toBe(true);
    done();
  });

  w.write("foo");
  w.end();
});

//<#END_FILE: test-stream2-objects.js
