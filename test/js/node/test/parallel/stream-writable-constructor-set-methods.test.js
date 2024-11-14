//#FILE: test-stream-writable-constructor-set-methods.js
//#SHA1: 5610c9523a02a55898e40f7c72a09973affd133f
//-----------------
"use strict";

const { Writable } = require("stream");

const bufferBlerg = Buffer.from("blerg");

test("Writable without _write method throws", () => {
  const w = new Writable();

  expect(() => {
    w.end(bufferBlerg);
  }).toThrow(
    expect.objectContaining({
      name: "Error",
      code: "ERR_METHOD_NOT_IMPLEMENTED",
      message: expect.any(String),
    }),
  );
});

test("Writable with custom write and writev methods", () => {
  const _write = jest.fn((chunk, _, next) => {
    next();
  });

  const _writev = jest.fn((chunks, next) => {
    expect(chunks.length).toBe(2);
    next();
  });

  const w2 = new Writable({ write: _write, writev: _writev });

  expect(w2._write).toBe(_write);
  expect(w2._writev).toBe(_writev);

  w2.write(bufferBlerg);

  w2.cork();
  w2.write(bufferBlerg);
  w2.write(bufferBlerg);

  w2.end();

  expect(_write).toHaveBeenCalledTimes(1);
  expect(_writev).toHaveBeenCalledTimes(1);
});

//<#END_FILE: test-stream-writable-constructor-set-methods.js
