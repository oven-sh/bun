//#FILE: test-buffer-inspect.js
//#SHA1: 8578a4ec2de348a758e5c4dcbaa13a2ee7005451
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
const util = require("util");
const buffer = require("buffer");

describe("Buffer inspect", () => {
  beforeEach(() => {
    buffer.INSPECT_MAX_BYTES = 2;
  });

  afterEach(() => {
    buffer.INSPECT_MAX_BYTES = Infinity;
  });

  test("Buffer and SlowBuffer inspection with INSPECT_MAX_BYTES = 2", () => {
    const b = Buffer.allocUnsafe(4);
    b.fill("1234");

    const s = buffer.SlowBuffer(4);
    s.fill("1234");

    const expected = "Buffer(4) [Uint8Array] [ 49, 50, ... 2 more items ]";

    expect(util.inspect(b)).toBe(expected);
    expect(util.inspect(s)).toBe(expected);
  });

  test("Buffer and SlowBuffer inspection with 2 bytes", () => {
    const b = Buffer.allocUnsafe(2);
    b.fill("12");

    const s = buffer.SlowBuffer(2);
    s.fill("12");

    const expected = "Buffer(2) [Uint8Array] [ 49, 50 ]";

    expect(util.inspect(b)).toBe(expected);
    expect(util.inspect(s)).toBe(expected);
  });

  test("Buffer and SlowBuffer inspection with INSPECT_MAX_BYTES = Infinity", () => {
    const b = Buffer.allocUnsafe(2);
    b.fill("12");

    const s = buffer.SlowBuffer(2);
    s.fill("12");

    const expected = "Buffer(2) [Uint8Array] [ 49, 50 ]";

    buffer.INSPECT_MAX_BYTES = Infinity;

    expect(util.inspect(b)).toBe(expected);
    expect(util.inspect(s)).toBe(expected);
  });

  test("Buffer inspection with custom properties", () => {
    const b = Buffer.allocUnsafe(2);
    b.fill("12");
    b.inspect = undefined;
    b.prop = new Uint8Array(0);

    expect(util.inspect(b)).toBe(
      "Buffer(2) [Uint8Array] [\n  49,\n  50,\n  inspect: undefined,\n  prop: Uint8Array(0) []\n]",
    );
  });

  test("Empty Buffer inspection with custom property", () => {
    const b = Buffer.alloc(0);
    b.prop = 123;

    expect(util.inspect(b)).toBe("Buffer(0) [Uint8Array] [ prop: 123 ]");
  });
});

//<#END_FILE: test-buffer-inspect.js
