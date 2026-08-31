/**
 * fs.write()/fs.writeSync(fd, buffer, offset) only checked `offset` against
 * the buffer when a numeric `length` argument followed it. Without one, an
 * offset past the end of the buffer was accepted and wrote 0 bytes. Node
 * defaults `length` to `byteLength - offset` and always runs
 * validateOffsetLengthWrite(), which throws ERR_OUT_OF_RANGE for the offset:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/fs.js#L827-L831 (write)
 * https://github.com/nodejs/node/blob/v26.3.0/lib/fs.js#L898-L900 (writeSync)
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/utils.js#L813-L816
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * `node --test`, which is where the expected values (including the exact error
 * messages) come from. It cannot import from "harness" for the same reason, so
 * it manages its own temporary directory.
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

const buf = Buffer.from("hello");

function offsetOutOfRange(byteLength: number, offset: number) {
  return {
    name: "RangeError",
    code: "ERR_OUT_OF_RANGE",
    message: `The value of "offset" is out of range. It must be <= ${byteLength}. Received ${offset}`,
  };
}

describe("fs.write()/fs.writeSync() reject an offset past the end of the buffer", () => {
  let dir: string;
  let fd: number;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-write-offset-bound-"));
    fd = fs.openSync(path.join(dir, "out.txt"), "w+");
  });

  after(() => {
    fs.closeSync(fd);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("writeSync(fd, view, offset) with no length", () => {
    const views = [
      Buffer.from("hello"),
      new Uint8Array(3),
      // byteLength (4) is the bound, not the element count (2)
      new Uint16Array(2),
      new DataView(new ArrayBuffer(3)),
      new Uint8Array(0),
    ];
    for (const view of views) {
      const offset = view.byteLength + 1;
      assert.throws(() => fs.writeSync(fd, view, offset), offsetOutOfRange(view.byteLength, offset));
    }
  });

  test("writeSync(fd, buffer, offset, length) with a non-number length", () => {
    for (const length of [undefined, null, "5"]) {
      assert.throws(() => fs.writeSync(fd, buf, 6, length as any), offsetOutOfRange(5, 6));
    }
    assert.throws(() => fs.writeSync(fd, buf, 6, undefined, 0), offsetOutOfRange(5, 6));
  });

  test("writeSync(fd, buffer, { offset })", () => {
    assert.throws(() => fs.writeSync(fd, buf, { offset: 6 }), offsetOutOfRange(5, 6));
  });

  test("write() throws synchronously instead of invoking the callback", () => {
    const callback = () => assert.fail("callback must not be invoked");
    assert.throws(() => fs.write(fd, buf, 6, callback), offsetOutOfRange(5, 6));
    assert.throws(() => fs.write(fd, buf, 6, undefined, undefined, callback), offsetOutOfRange(5, 6));
    assert.throws(() => fs.write(fd, buf, { offset: 6 }, callback), offsetOutOfRange(5, 6));
  });

  test("filehandle.write() rejects with the same error", async () => {
    const handle = await fs.promises.open(path.join(dir, "handle.txt"), "w+");
    try {
      await assert.rejects(handle.write(buf, 6), offsetOutOfRange(5, 6));
      assert.strictEqual((await handle.write(buf, 5)).bytesWritten, 0);
    } finally {
      await handle.close();
    }
  });

  test("offset equal to the byte length writes nothing", async () => {
    assert.strictEqual(fs.writeSync(fd, buf, 5), 0);

    const { promise, resolve, reject } = Promise.withResolvers<[number, Buffer]>();
    fs.write(fd, buf, 5, (err, written, buffer) => (err ? reject(err) : resolve([written, buffer])));
    assert.deepStrictEqual(await promise, [0, buf]);
  });

  test("offset inside the buffer writes the rest of it", () => {
    const file = path.join(dir, "tail.txt");
    const tailFd = fs.openSync(file, "w+");
    try {
      assert.strictEqual(fs.writeSync(tailFd, buf, 2), 3);
    } finally {
      fs.closeSync(tailFd);
    }
    assert.strictEqual(fs.readFileSync(file, "utf8"), "llo");
  });
});
