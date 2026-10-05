/**
 * fs.read()/fs.readSync(fd, buffer, offset, length) validated `offset` before
 * the type of `buffer`. With both arguments invalid, Bun threw ERR_OUT_OF_RANGE
 * (or ERR_INVALID_ARG_TYPE) for "offset". Node runs validateBuffer(buffer)
 * first, so the error names "buffer":
 * https://github.com/nodejs/node/blob/v26.3.0/lib/fs.js#L622-L640 (read)
 * https://github.com/nodejs/node/blob/v26.3.0/lib/fs.js#L709-L727 (readSync)
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * `node --test`, which is where the expected values (including the exact error
 * messages) come from. It cannot import from "harness" for the same reason.
 */
import assert from "node:assert";
import fs from "node:fs";
import { after, before, describe, test } from "node:test";

function invalidBuffer(received: string) {
  return {
    name: "TypeError",
    code: "ERR_INVALID_ARG_TYPE",
    message: `The "buffer" argument must be an instance of Buffer, TypedArray, or DataView. Received ${received}`,
  };
}

// [buffer, offset, what Node prints for the buffer]
const cases: [unknown, unknown, string][] = [
  ["not a buffer", -1, "type string ('not a buffer')"],
  [123, "bad", "type number (123)"],
  [null, -1, "null"],
  [{}, 1.5, "an instance of Object"],
  [[1, 2, 3], -1, "an instance of Array"],
];

describe("fs.read()/fs.readSync() check the buffer type before the offset", () => {
  let fd: number;

  before(() => {
    fd = fs.openSync(import.meta.filename, "r");
  });

  after(() => {
    fs.closeSync(fd);
  });

  test("readSync(fd, buffer, offset, length)", () => {
    for (const [buffer, offset, received] of cases) {
      assert.throws(() => fs.readSync(fd, buffer as any, offset as any, 5), invalidBuffer(received));
    }
  });

  test("readSync(fd, buffer, { offset })", () => {
    assert.throws(() => fs.readSync(fd, "x" as any, { offset: -1 }), invalidBuffer("type string ('x')"));
  });

  test("read(fd, buffer, offset, length, position, callback) throws synchronously", () => {
    for (const [buffer, offset, received] of cases) {
      assert.throws(
        () => fs.read(fd, buffer as any, offset as any, 5, 0, () => assert.fail("the callback must not run")),
        invalidBuffer(received),
      );
    }
  });

  test("a valid buffer still gets the offset error", () => {
    const buffer = Buffer.alloc(4);
    assert.throws(() => fs.readSync(fd, buffer, -1, 4), {
      name: "RangeError",
      code: "ERR_OUT_OF_RANGE",
      message: 'The value of "offset" is out of range. It must be >= 0 && <= 9007199254740991. Received -1',
    });
    assert.throws(() => fs.readSync(fd, buffer, "bad" as any, 4), {
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
      message: `The "offset" argument must be of type number. Received type string ('bad')`,
    });
  });

  test("a valid call still reads", () => {
    const buffer = Buffer.alloc(3);
    assert.strictEqual(fs.readSync(fd, buffer, 0, 3, 0), 3);
    assert.strictEqual(buffer.toString(), "/**");
  });
});
