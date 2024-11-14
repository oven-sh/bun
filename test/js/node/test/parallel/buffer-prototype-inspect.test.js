//#FILE: test-buffer-prototype-inspect.js
//#SHA1: 3809d957d94134495a61469120087c12580fa3f3
//-----------------
"use strict";

// lib/buffer.js defines Buffer.prototype.inspect() to override how buffers are
// presented by util.inspect().

const util = require("util");
const buffer = require("buffer");
buffer.INSPECT_MAX_BYTES = 50;

test("Buffer.prototype.inspect() for non-empty buffer", () => {
  const buf = Buffer.from("fhqwhgads");
  expect(util.inspect(buf)).toBe("Buffer(9) [Uint8Array] [\n  102, 104, 113, 119,\n  104, 103,  97, 100,\n  115\n]");
});

test("Buffer.prototype.inspect() for empty buffer", () => {
  const buf = Buffer.from("");
  expect(util.inspect(buf)).toBe("Buffer(0) [Uint8Array] []");
});

test("Buffer.prototype.inspect() for large buffer", () => {
  const buf = Buffer.from("x".repeat(51));
  expect(util.inspect(buf)).toBe(
    `Buffer(51) [Uint8Array] [\n` +
      `  120, 120, 120, 120, 120, 120, 120, 120, 120,\n` +
      `  120, 120, 120, 120, 120, 120, 120, 120, 120,\n` +
      `  120, 120, 120, 120, 120, 120, 120, 120, 120,\n` +
      `  120, 120, 120, 120, 120, 120, 120, 120, 120,\n` +
      `  120, 120, 120, 120, 120, 120, 120, 120, 120,\n` +
      `  120, 120, 120, 120, 120,\n` +
      `  ... 1 more item\n` +
      `]`,
  );
});

//<#END_FILE: test-buffer-prototype-inspect.js
