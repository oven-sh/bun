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
    assert.throws(() => fs.writeSync(fd, buf, { offset: 6 } as any), offsetOutOfRange(5, 6));
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

/**
 * filehandle.write(view, offset) computed the default length,
 * `view.byteLength - offset`, before anything had checked `offset`. A bigint or
 * a symbol made the subtraction throw a TypeError with no `code`, an object had
 * its valueOf() called, and a function was taken for a callback, so the whole
 * view was written. Node validates `offset` before the subtraction:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/promises.js#L1381-L1387
 */
describe("filehandle.write() checks the type of offset before it uses it", () => {
  const abcd = Buffer.from("abcd");
  const initial = "0123456789";
  let dir: string;
  let files = 0;

  function offsetFn() {}

  function invalidOffset(received: string) {
    return {
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
      message: `The "offset" argument must be of type number. Received ${received}`,
    };
  }

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "filehandle-write-offset-type-"));
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Runs `fn` on a handle to a fresh copy of `initial` and returns the bytes of the file afterwards.
  // The handle is `any` because most rows pass arguments that the types forbid.
  async function withHandle(fn: (handle: any) => Promise<void>) {
    const file = path.join(dir, `${files++}.txt`);
    fs.writeFileSync(file, initial);
    const handle = await fs.promises.open(file, "r+");
    try {
      await fn(handle);
    } finally {
      await handle.close();
    }
    return fs.readFileSync(file, "latin1");
  }

  test("a non-number offset rejects with ERR_INVALID_ARG_TYPE and is not converted", async () => {
    let calls = 0;
    const hook = () => {
      calls++;
      return 1;
    };
    const hookedFn = Object.assign(function hookedFn() {}, { valueOf: hook });
    const bigint = invalidOffset("type bigint (1n)");
    const symbol = invalidOffset("type symbol (Symbol())");
    const func = invalidOffset("function offsetFn");
    const object = invalidOffset("an instance of Object");

    const bytes = await withHandle(async handle => {
      for (const view of [Buffer.from("abcd"), new Uint16Array(2), new DataView(new ArrayBuffer(4))]) {
        await assert.rejects(handle.write(view, 1n), bigint);
        await assert.rejects(handle.write(view, 0n), invalidOffset("type bigint (0n)"));
        await assert.rejects(handle.write(view, 1n, null), bigint);
        await assert.rejects(handle.write(view, 1n, "4"), bigint);
        await assert.rejects(handle.write(view, 1n, 4n), bigint);
        await assert.rejects(handle.write(view, 1n, 4, 0), bigint);
        await assert.rejects(handle.write(view, Symbol()), symbol);
        await assert.rejects(handle.write(view, "1"), invalidOffset("type string ('1')"));
        await assert.rejects(handle.write(view, true), invalidOffset("type boolean (true)"));
        await assert.rejects(handle.write(view, offsetFn), func);
        await assert.rejects(handle.write(view, offsetFn, 1, 0), func);
        await assert.rejects(handle.write(view, hookedFn), invalidOffset("function hookedFn"));
        await assert.rejects(handle.write(view, { offset: 1n, length: null }), bigint);
        await assert.rejects(handle.write(view, { offset: 0n, length: null }), invalidOffset("type bigint (0n)"));
        await assert.rejects(handle.write(view, { offset: 1n, length: 2n }), bigint);
        await assert.rejects(handle.write(view, { offset: Symbol(), length: null }), symbol);
        await assert.rejects(handle.write(view, { offset: offsetFn, length: null }), func);
        await assert.rejects(handle.write(view, { offset: offsetFn }), func);
        await assert.rejects(handle.write(view, { offset: { valueOf: hook }, length: null }), object);
        await assert.rejects(handle.write(view, { offset: { [Symbol.toPrimitive]: hook }, length: "x" }), object);
      }
    });
    assert.strictEqual(calls, 0);
    assert.strictEqual(bytes, initial);
  });

  test("a refused offset rejects one turn after the call, as in node", async () => {
    await withHandle(async handle => {
      // Node's fsCall() awaits write(), so the rejection is one turn away when the call returns.
      // A promise that is already rejected wins this race. One that rejects a turn later loses it.
      for (const offset of ["1", true, 1n, offsetFn]) {
        assert.strictEqual(await Promise.race([handle.write(abcd, offset), Promise.resolve("first")]), "first");
      }
    });
  });

  test("the length default inside the options destructure runs before the check, as in node", async () => {
    let calls = 0;
    const hook = () => {
      calls++;
      return 1;
    };
    const bytes = await withHandle(async handle => {
      await assert.rejects(handle.write(abcd, { offset: { valueOf: hook } }), invalidOffset("an instance of Object"));
      assert.strictEqual(calls, 1);
      // `view.byteLength - 1n` throws inside the destructure.
      await assert.rejects(handle.write(abcd, { offset: 1n }), (err: any) => {
        assert.strictEqual(err.code, undefined);
        assert.ok(err instanceof TypeError);
        return true;
      });
    });
    assert.strictEqual(bytes, initial);
  });

  test("the checks in front of the offset check still decide first", async () => {
    const bytes = await withHandle(async handle => {
      // An empty view resolves before `offset` is read.
      assert.strictEqual((await handle.write(Buffer.alloc(0), 1n)).bytesWritten, 0);
      // A string takes the (string, position, encoding) form. A bigint position means the current one.
      assert.strictEqual((await handle.write("ab", 1n)).bytesWritten, 2);
      await assert.rejects(handle.write(123, 1n), {
        name: "TypeError",
        code: "ERR_INVALID_ARG_TYPE",
        message:
          'The "buffer" argument must be of type string or an instance of Buffer, TypedArray, or DataView. ' +
          "Received type number (123)",
      });
      await handle.close();
      await assert.rejects(handle.write(abcd, 1n), { code: "EBADF", syscall: "write" });
    });
    assert.strictEqual(bytes, "ab23456789");
  });

  test("a valid call writes what it wrote before", async () => {
    async function written(...args: unknown[]) {
      let bytesWritten = -1;
      const bytes = await withHandle(async handle => {
        ({ bytesWritten } = await handle.write(abcd, ...args));
      });
      return [bytesWritten, bytes];
    }
    assert.deepStrictEqual(await written(), [4, "abcd456789"]);
    assert.deepStrictEqual(await written(1), [3, "bcd3456789"]);
    assert.deepStrictEqual(await written(-0), [4, "abcd456789"]);
    assert.deepStrictEqual(await written(4), [0, initial]);
    assert.deepStrictEqual(await written(undefined, undefined, 2), [4, "01abcd6789"]);
    assert.deepStrictEqual(await written(0, null, 3), [4, "012abcd789"]);
    assert.deepStrictEqual(await written(1, "2", 0), [3, "bcd3456789"]);
    assert.deepStrictEqual(await written(0, 2n), [4, "abcd456789"]);
    // `null` and any other object are the options form, so the length and the position arguments are not read.
    assert.deepStrictEqual(await written(null, 2, 5), [4, "abcd456789"]);
    assert.deepStrictEqual(await written({ valueOf: () => assert.fail("not an offset") }), [4, "abcd456789"]);
    assert.deepStrictEqual(await written({ offset: null, length: null }), [4, "abcd456789"]);
    assert.deepStrictEqual(await written({ offset: 1, length: null, position: 0 }), [3, "bcd3456789"]);
    assert.deepStrictEqual(await written({ position: 5 }), [4, "01234abcd9"]);
  });

  test("a number that is not a valid offset is still ERR_OUT_OF_RANGE", async () => {
    function outOfRange(must: string, received: string) {
      return {
        name: "RangeError",
        code: "ERR_OUT_OF_RANGE",
        message: `The value of "offset" is out of range. It must be ${must}. Received ${received}`,
      };
    }
    const bytes = await withHandle(async handle => {
      await assert.rejects(handle.write(abcd, -1), outOfRange(">= 0 && <= 9007199254740991", "-1"));
      await assert.rejects(handle.write(abcd, 1.5), outOfRange("an integer", "1.5"));
      await assert.rejects(handle.write(abcd, NaN), outOfRange("an integer", "NaN"));
      await assert.rejects(handle.write(abcd, Infinity), outOfRange("an integer", "Infinity"));
      await assert.rejects(handle.write(abcd, 5), offsetOutOfRange(4, 5));
      // No message for this row: Node prints the received value as 9_007_199_254_740_992 and Bun prints no separators.
      await assert.rejects(handle.write(abcd, 2 ** 53), { name: "RangeError", code: "ERR_OUT_OF_RANGE" });
    });
    assert.strictEqual(bytes, initial);
  });

  test("a refused write does not keep the handle open", async () => {
    const ab = Buffer.from("ab");
    const bytes = await withHandle(async handle => {
      assert.strictEqual((await handle.write(ab)).bytesWritten, 2);
      await assert.rejects(handle.write(ab, 1n), invalidOffset("type bigint (1n)"));
      // A write is refused while another write is in flight and close() waits for that one.
      const inFlight = handle.write(ab);
      const closed = handle.close();
      await assert.rejects(handle.write(ab, 1n), invalidOffset("type bigint (1n)"));
      assert.strictEqual((await inFlight).bytesWritten, 2);
      await closed;
      assert.strictEqual(handle.fd, -1);
    });
    assert.strictEqual(bytes, "abab456789");
  });
});
