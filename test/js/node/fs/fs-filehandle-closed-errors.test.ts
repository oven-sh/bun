/**
 * A closed or transferred FileHandle did not report what Node reports.
 *
 * Its promise methods rejected with the name "SystemError" and the text "Bad
 * file descriptor". Node's fsCall builds a plain Error by hand, with the text
 * "file closed", or "The FileHandle has been transferred" after a transfer:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/promises.js#L1104-L1110
 *
 * A stream over such a handle was built with no check of the descriptor, so
 * fs.createReadStream(null, { fd: handle }) returned a stream that emitted no
 * 'error' and no 'close'. Node validates the descriptor in the constructor,
 * before the `start`, `end` and `flush` options:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/streams.js#L188
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/streams.js#L340
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * `node --test`, which is where the expected values (including the exact error
 * messages) come from. It cannot import from "harness" for the same reason.
 */
import assert from "node:assert";
import { once } from "node:events";
import fs from "node:fs";
import { open } from "node:fs/promises";
import { describe, test } from "node:test";
import { Worker } from "node:worker_threads";

const fdOutOfRange = {
  name: "RangeError",
  code: "ERR_OUT_OF_RANGE",
  message: 'The value of "fd" is out of range. It must be >= 0 && <= 2147483647. Received -1',
};

function rejection(promise: Promise<unknown>) {
  return promise.then(
    () => "resolved",
    e => ({ string: String(e), code: e.code, syscall: e.syscall, ownName: Object.hasOwn(e, "name") }),
  );
}

async function openThenClose() {
  const handle = await open(import.meta.filename, "r");
  await handle.close();
  return handle;
}

describe("a closed FileHandle", () => {
  test("rejects every promise method with a plain Error", async () => {
    const handle = await openThenClose();
    const calls: Array<[method: string, syscall: string, call: () => Promise<unknown>]> = [
      ["appendFile", "writeFile", () => handle.appendFile("x")],
      ["chmod", "fchmod", () => handle.chmod(0o644)],
      ["chown", "fchown", () => handle.chown(0, 0)],
      ["datasync", "fdatasync", () => handle.datasync()],
      ["sync", "fsync", () => handle.sync()],
      ["read", "read", () => handle.read(Buffer.alloc(2), 0, 2, 0)],
      ["readv", "readv", () => handle.readv([Buffer.alloc(2)])],
      ["readFile", "readFile", () => handle.readFile()],
      ["stat", "fstat", () => handle.stat()],
      ["truncate", "ftruncate", () => handle.truncate(0)],
      ["utimes", "futimes", () => handle.utimes(new Date(), new Date())],
      ["write", "write", () => handle.write("x")],
      ["writev", "writev", () => handle.writev([Buffer.from("x")])],
      ["writeFile", "writeFile", () => handle.writeFile("x")],
    ];

    const actual: Record<string, unknown> = {};
    for (const [method, , call] of calls) actual[method] = await rejection(call());

    assert.deepStrictEqual(
      actual,
      Object.fromEntries(
        calls.map(([method, syscall]) => [
          method,
          { string: "Error: file closed", code: "EBADF", syscall, ownName: false },
        ]),
      ),
    );
  });

  test("makes every stream constructor throw for the descriptor, before another option is checked", async () => {
    // A new handle for each group: Node leaves a 'close' listener on the handle for each constructor that throws.
    for (const options of [undefined, { start: -1 }]) {
      const handle = await openThenClose();
      assert.throws(() => handle.createReadStream(options), fdOutOfRange);
      assert.throws(() => handle.createWriteStream(options), fdOutOfRange);
      assert.throws(() => handle.readLines(options), fdOutOfRange);
      assert.throws(() => fs.createReadStream(null!, { ...options, fd: handle }), fdOutOfRange);
      assert.throws(() => fs.createWriteStream(null!, { ...options, fd: handle }), fdOutOfRange);
    }
    const handle = await openThenClose();
    assert.throws(() => fs.createReadStream(null!, { fd: handle, end: "x" as any }), fdOutOfRange);
    assert.throws(() => fs.createWriteStream(null!, { fd: handle, flush: "x" as any }), fdOutOfRange);
  });
});

test("a stream over an object that is not a FileHandle with a descriptor names options.fd or fd", async () => {
  const FileHandlePrototype = Object.getPrototypeOf(await openThenClose());
  const notAFileHandle = {
    name: "TypeError",
    code: "ERR_INVALID_ARG_TYPE",
    message:
      'The "options.fd" property must be of type number or an instance of FileHandle. Received an instance of Object',
  };
  assert.throws(() => FileHandlePrototype.createReadStream.call({}), notAFileHandle);
  assert.throws(() => FileHandlePrototype.createWriteStream.call({}), notAFileHandle);
  // Passes `instanceof FileHandle` but was never constructed, so it has no descriptor.
  assert.throws(() => fs.createReadStream(null!, { fd: Object.create(FileHandlePrototype) }), {
    name: "TypeError",
    code: "ERR_INVALID_ARG_TYPE",
    message: 'The "fd" argument must be of type number. Received undefined',
  });
});

describe("a FileHandle in the transferList of a Worker", () => {
  // Closes the handle it received and reports what stat() says after that.
  const workerSource = `
    const { workerData, parentPort } = require("node:worker_threads");
    workerData.handle
      .close()
      .then(() => workerData.handle.stat())
      .then(() => "resolved", e => String(e))
      .then(message => parentPort.postMessage(message));`;

  function startWorker(workerData: object, handle: fs.promises.FileHandle) {
    return new Worker(workerSource, { eval: true, workerData, transferList: [handle as any] });
  }

  test("reports the transfer on the sending side and an ordinary close on the receiving side", async () => {
    const handle = await open(import.meta.filename, "r");
    const worker = startWorker({ handle }, handle);
    const [receivedAfterClose] = await once(worker, "message");
    await worker.terminate();
    assert.strictEqual(receivedAfterClose, "Error: file closed");

    const transferred = {
      string: "Error: The FileHandle has been transferred",
      code: "EBADF",
      syscall: "fstat",
      ownName: false,
    };
    assert.deepStrictEqual(await rejection(handle.stat()), transferred);
    // close() does nothing on the sending side and does not change the reason.
    await handle.close();
    assert.deepStrictEqual(await rejection(handle.stat()), transferred);
    // Neither does a later Worker that fails to start.
    assert.throws(() => startWorker({ handle, uncloneable() {} }, handle), { name: "DataCloneError" });
    assert.deepStrictEqual(await rejection(handle.stat()), transferred);
  });

  test("is an ordinary handle again when the Worker fails to start", async () => {
    const handle = await open(import.meta.filename, "r");
    assert.throws(() => startWorker({ handle, uncloneable() {} }, handle), { name: "DataCloneError" });
    await handle.close();
    assert.deepStrictEqual(await rejection(handle.stat()), {
      string: "Error: file closed",
      code: "EBADF",
      syscall: "fstat",
      ownName: false,
    });
  });
});
