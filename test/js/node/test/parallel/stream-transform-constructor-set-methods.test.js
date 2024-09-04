//#FILE: test-stream-transform-constructor-set-methods.js
//#SHA1: a827edab0555cd9f8bd240738812b4d6a48b4e7d
//-----------------
"use strict";

const { Transform } = require("stream");

test("Transform constructor throws when _transform is not implemented", () => {
  const t = new Transform();

  expect(() => {
    t.end(Buffer.from("blerg"));
  }).toThrow(
    expect.objectContaining({
      name: "Error",
      code: "ERR_METHOD_NOT_IMPLEMENTED",
      message: expect.any(String),
    }),
  );
});

test("Transform constructor sets methods correctly", () => {
  const _transform = jest.fn((chunk, _, next) => {
    next();
  });

  const _final = jest.fn(next => {
    next();
  });

  const _flush = jest.fn(next => {
    next();
  });

  const t2 = new Transform({
    transform: _transform,
    flush: _flush,
    final: _final,
  });

  expect(t2._transform).toBe(_transform);
  expect(t2._flush).toBe(_flush);
  expect(t2._final).toBe(_final);

  t2.end(Buffer.from("blerg"));
  t2.resume();

  expect(_transform).toHaveBeenCalled();
  expect(_final).toHaveBeenCalled();
  expect(_flush).toHaveBeenCalled();
});

//<#END_FILE: test-stream-transform-constructor-set-methods.js
