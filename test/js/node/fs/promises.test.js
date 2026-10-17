import { tempDir, tempDirWithFiles } from "harness";
import { join } from "path";
const assert = require("assert");
const os = require("os");
const fs = require("fs");
const fsPromises = require("fs/promises");
const access = fsPromises.access;
const open = fsPromises.open;
const copyFile = fsPromises.copyFile;
const statfs = fsPromises.statfs;
const unlink = fsPromises.unlink;
const readFile = fsPromises.readFile;

//
//
//

async function expectReject(fprom, obj) {
  try {
    await fprom();
    expect.unreachable();
  } catch (e) {
    for (const key of Object.keys(obj)) {
      expect(e[key]).toBe(obj[key]);
    }
  }
}

async function executeOnHandle(func) {
  let dest;
  let handle;
  try {
    [dest, handle] = await getHandle();
    await func([dest, handle]);
  } finally {
    if (handle) {
      await handle.close();
    }
  }
}

async function getHandle() {
  const d = await tmpDir();
  const p = join(d, "baz.fixture.js");
  await copyFile(join(import.meta.dir, "baz.fixture.js"), p);
  await access(p);
  return [p, await open(p, "r+")];
}

let fsPromisesTestIndex = 0;
async function tmpDir() {
  return tempDirWithFiles(`fspromisestest-${fsPromisesTestIndex++}`, {
    "hello.txt": "",
  });
}

function verifyStatObject(stat) {
  expect(typeof stat).toBe("object");
  expect(typeof stat.dev).toBe("number");
  expect(typeof stat.mode).toBe("number");
}

function verifyStatFsObject(stat, isBigint = false) {
  const valueType = isBigint ? "bigint" : "number";

  expect(typeof stat).toBe("object");
  expect(typeof stat.type).toBe(valueType);
  expect(typeof stat.bsize).toBe(valueType);
  expect(typeof stat.blocks).toBe(valueType);
  expect(typeof stat.bfree).toBe(valueType);
  expect(typeof stat.bavail).toBe(valueType);
  expect(typeof stat.files).toBe(valueType);
  expect(typeof stat.ffree).toBe(valueType);
}

//
//
//

it("should exist", () => {
  assert.strictEqual(fsPromises, fs.promises);
  assert.strictEqual(fsPromises.constants, fs.constants);
});

it("should be enumerable", () => {
  assert.strictEqual(Object.prototype.propertyIsEnumerable.call(fs, "promises"), true);
});

describe("access", () => {
  it("should work", async () => {
    await access(__filename, 0);
  });

  it("should fail on non-existant files", async () => {
    await expectReject(() => access("this file does not exist", 0), {
      code: "ENOENT",
    });
  });

  it.skip("should fail on non-existant modes", async () => {
    await expectReject(() => access(__filename, 8), {
      code: "ERR_OUT_OF_RANGE",
    });
  });

  it.skip("should fail on object as the 2nd argument", async () => {
    await expectReject(
      () =>
        access(__filename, {
          [Symbol.toPrimitive]() {
            return 5;
          },
        }),
      {
        code: "ERR_INVALID_ARG_TYPE",
      },
    );
  });
});

describe("open", () => {
  it("should work", async () => {
    await using _ = await open(__filename);
  });

  it("should return an object", async () => {
    await using fh = await open(__filename);
    assert.strictEqual(typeof fh, "object");
    assert.strictEqual(typeof fh.fd, "number");
  });

  it("should be closable", async () => {
    const fh = await open(__filename);
    await fh.close();
  });
});

describe("more", () => {
  it("is an object", async () => {
    await executeOnHandle(async ([_, handle]) => {
      assert.strictEqual(typeof handle, "object");
    });
  });

  it("stat", async () => {
    await executeOnHandle(async ([_, handle]) => {
      let stats = await handle.stat();
      verifyStatObject(stats);
      assert.strictEqual(stats.size, 35);

      await handle.truncate(1);

      stats = await handle.stat();
      verifyStatObject(stats);
      assert.strictEqual(stats.size, 1);

      stats = await handle.stat();
      verifyStatObject(stats);

      await handle.datasync();
      await handle.sync();
    });
  });

  it.skip("statfs", async () => {
    await executeOnHandle(async ([dest, _]) => {
      const statFs = await statfs(dest);
      verifyStatFsObject(statFs);
    });
  });

  it.skip("statfs bigint", async () => {
    await executeOnHandle(async ([dest, _]) => {
      const statFs = await statfs(dest, { bigint: true });
      verifyStatFsObject(statFs, true);
    });
  });

  it.skip("", async () => {
    await executeOnHandle(async ([dest, handle]) => {
      const buf = Buffer.from("DAWGS WIN");
      const bufLen = buf.length;
      await handle.write(buf);
      const ret = await handle.read(Buffer.alloc(bufLen), 0, 0, 0);
      assert.strictEqual(ret.bytesRead, 0);
      await unlink(dest);
    });
  });
});

test("writing to file in append mode works", async () => {
  const tempFile = os.tmpdir() + "/" + Date.now() + ".txt";

  const f = await open(tempFile, "a");

  await f.writeFile("test\n");
  await f.appendFile("test\n");
  await f.write("test\n");
  await f.datasync();

  await f.close();

  expect((await readFile(tempFile)).toString()).toEqual("test\ntest\ntest\n");
});

test("appendFile with flag 'ax' rejects with EEXIST on an existing file", async () => {
  const dir = tempDirWithFiles("appendfile-exclusive-flag", { "existing.txt": "keep" });
  const existing = join(dir, "existing.txt");
  await expectReject(() => fsPromises.appendFile(existing, "more", { flag: "ax" }), {
    code: "EEXIST",
    syscall: "open",
  });
  expect(await readFile(existing, "utf8")).toEqual("keep");

  const fresh = join(dir, "fresh.txt");
  await fsPromises.appendFile(fresh, "first", { flag: "ax" });
  await fsPromises.appendFile(fresh, "second", { flag: "a" });
  expect(await readFile(fresh, "utf8")).toEqual("firstsecond");
});

test("errors from fs.promises include async stack frames", async () => {
  async function level3() {
    await readFile("/nonexistent-path/does-not-exist.txt");
  }
  async function level2() {
    await level3();
  }
  async function level1() {
    await level2();
  }

  let caught;
  try {
    await level1();
  } catch (e) {
    caught = e;
  }

  expect(caught).toBeDefined();
  expect(caught.code).toBe("ENOENT");
  expect(caught.stack).toContain("at async level3");
  expect(caught.stack).toContain("at async level2");
  expect(caught.stack).toContain("at async level1");
});

test("fs.promises async stack through Promise subclass", async () => {
  class MyPromise extends Promise {}

  async function caller() {
    await MyPromise.resolve().then(() => readFile("/nonexistent-path/x.txt"));
  }

  let caught;
  try {
    await caller();
  } catch (e) {
    caught = e;
  }

  expect(caught).toBeDefined();
  expect(caught.code).toBe("ENOENT");
  // Subclass .then() may not preserve the reaction chain — must not crash.
  expect(typeof caught.stack === "string" || caught.stack === undefined).toBe(true);
});

test("fs.promises async stack through custom thenable", async () => {
  async function caller() {
    const thenable = {
      then(onFulfilled, onRejected) {
        return readFile("/nonexistent-path/x.txt").then(onFulfilled, onRejected);
      },
    };
    await thenable;
  }

  let caught;
  try {
    await caller();
  } catch (e) {
    caught = e;
  }

  expect(caught).toBeDefined();
  expect(caught.code).toBe("ENOENT");
  // Custom thenables break the direct reaction chain — must not crash.
  expect(typeof caught.stack === "string" || caught.stack === undefined).toBe(true);
});

test("fs.promises async stack with Promise.all", async () => {
  async function caller() {
    await Promise.all([readFile("/nonexistent-path/a.txt"), readFile("/nonexistent-path/b.txt")]);
  }

  let caught;
  try {
    await caller();
  } catch (e) {
    caught = e;
  }

  expect(caught).toBeDefined();
  expect(caught.code).toBe("ENOENT");
  // Promise.all uses combinator context — must not crash.
  expect(typeof caught.stack === "string" || caught.stack === undefined).toBe(true);
});

it("an unused FileHandle.writer() does not prevent close()", async () => {
  await using dir = tempDir("unused-writer", { "x.txt": "hello" });
  const fh = await fsPromises.open(join(dir, "x.txt"), "r+");
  fh.writer(); // never written to, never ended
  // must not hang: the writer only refs the handle once a write happens
  await fh.close();
  expect(fh.fd).toBe(-1);
});

it("sources created before close() refuse to use the stale fd", async () => {
  await using dir = tempDir("stale-fd", { "x.txt": "hello" });
  const file = join(dir, "x.txt");

  // writer
  {
    const fh = await fsPromises.open(file, "r+");
    const w = fh.writer();
    await fh.close();
    await expect(w.write(Buffer.from("a"))).rejects.toMatchObject({ code: "ERR_INVALID_STATE" });
    expect(() => w.writeSync(Buffer.from("a"))).toThrow(expect.objectContaining({ code: "ERR_INVALID_STATE" }));
  }
  // pull
  {
    const fh = await fsPromises.open(file, "r");
    const src = fh.pull();
    await fh.close();
    await expect(
      (async () => {
        for await (const _ of src);
      })(),
    ).rejects.toMatchObject({ code: "ERR_INVALID_STATE" });
  }
  // pullSync
  {
    const fh = await fsPromises.open(file, "r");
    const src = fh.pullSync();
    await fh.close();
    expect(() => {
      for (const _ of src);
    }).toThrow(expect.objectContaining({ code: "ERR_INVALID_STATE" }));
  }
});

it("rm and promises.rm report ERR_FS_EISDIR for directories like rmSync", async () => {
  await using dir = tempDir("rm-eisdir", { "sub/a.txt": "x" });
  const target = join(dir, "sub");
  await expect(fsPromises.rm(target)).rejects.toMatchObject({ code: "ERR_FS_EISDIR" });
  const { promise, resolve } = Promise.withResolvers();
  fs.rm(target, err => resolve(err));
  expect((await promise)?.code).toBe("ERR_FS_EISDIR");
  // directory is still removable the supported way
  await fsPromises.rm(target, { recursive: true });
  expect(fs.existsSync(target)).toBe(false);
});

it("close() while an operation is in flight actually closes the fd", async () => {
  await using dir = tempDir("deferred-close", { "x.txt": "hello" });
  const fh = await fsPromises.open(join(dir, "x.txt"), "r");
  const fd = fh.fd;
  // take an extra ref so close() defers, then release it
  const read = fh.read(Buffer.alloc(5), 0, 5, 0);
  const closed = fh.close();
  await read;
  await closed;
  expect(fh.fd).toBe(-1);
  // the deferred path must have issued the real close; nothing else runs in
  // this process between the close and this check, so EBADF is deterministic
  expect(() => fs.fstatSync(fd)).toThrow(expect.objectContaining({ code: "EBADF" }));
});

// A stream on a FileHandle holds a ref on the handle and listens for its 'close'. Node keeps both when the
// constructor throws (handle.close() then throws, and the descriptor stays open). Bun gives them back.
describe("a stream constructor that throws gives the FileHandle back", () => {
  // Runs `build`, which has to throw, and closes the handle before a test asserts anything.
  async function afterThrow(handle, build) {
    let closeEvents = 0;
    handle.on("close", () => closeEvents++);
    let thrown;
    try {
      build(handle);
    } catch (err) {
      thrown = err;
    }
    const listeners = handle.listenerCount("close");
    const closed = await handle.close().then(
      () => "fulfilled",
      err => err,
    );
    return { thrown, listeners, closed, fd: handle.fd, closeEvents };
  }
  // The one listener that stays is the listener of `afterThrow`.
  const givenBack = { listeners: 1, closed: "fulfilled", fd: -1, closeEvents: 1 };
  const boom = () => {
    throw new Error("boom");
  };

  // One row for each check of an option. `end: -1` is `end: size - 1` for an empty file.
  it.each([
    ["createReadStream", { start: -1 }, "ERR_OUT_OF_RANGE"],
    ["createReadStream", { end: -1 }, "ERR_OUT_OF_RANGE"],
    ["createReadStream", { start: 5, end: 2 }, "ERR_OUT_OF_RANGE"],
    ["createReadStream", { highWaterMark: -1 }, "ERR_INVALID_ARG_VALUE"],
    ["createReadStream", { defaultEncoding: "nope" }, "ERR_UNKNOWN_ENCODING"],
    ["createReadStream", { encoding: "buffer" }, "ERR_UNKNOWN_ENCODING"],
    ["createReadStream", { signal: {} }, "ERR_INVALID_ARG_TYPE"],
    ["createReadStream", { captureRejections: 1 }, "ERR_INVALID_ARG_TYPE"],
    ["createWriteStream", { flush: 1 }, "ERR_INVALID_ARG_TYPE"],
    ["createWriteStream", { start: -1 }, "ERR_OUT_OF_RANGE"],
    ["createWriteStream", { highWaterMark: -1 }, "ERR_INVALID_ARG_VALUE"],
    ["createWriteStream", { defaultEncoding: "nope" }, "ERR_UNKNOWN_ENCODING"],
    ["createWriteStream", { signal: {} }, "ERR_INVALID_ARG_TYPE"],
    ["createWriteStream", { captureRejections: 1 }, "ERR_INVALID_ARG_TYPE"],
    ["createWriteStream", { encoding: "buffer" }, "ERR_UNKNOWN_ENCODING"],
  ])("handle.%s(%j)", async (method, options, code) => {
    await using dir = tempDir("filehandle-stream-throws", { "x.txt": "hello world" });
    const handle = await open(join(dir, "x.txt"), "r+");
    expect(await afterThrow(handle, () => handle[method](options))).toEqual({
      thrown: expect.objectContaining({ code }),
      ...givenBack,
    });
  });

  // `highWaterMark` is checked in Readable / Writable, after the stream took the ref.
  it.each([
    ["fs.createReadStream(null, { fd })", fd => fs.createReadStream(null, { fd, highWaterMark: -1 })],
    ["fs.createWriteStream(null, { fd })", fd => fs.createWriteStream(null, { fd, highWaterMark: -1 })],
    ["new fs.ReadStream(null, { fd })", fd => new fs.ReadStream(null, { fd, highWaterMark: -1 })],
    ["new fs.WriteStream(null, { fd })", fd => new fs.WriteStream(null, { fd, highWaterMark: -1 })],
    ["fs.ReadStream(null, { fd })", fd => fs.ReadStream(null, { fd, highWaterMark: -1 })],
    ["fs.WriteStream(null, { fd })", fd => fs.WriteStream(null, { fd, highWaterMark: -1 })],
    ["a subclass of fs.ReadStream", fd => new (class extends fs.ReadStream {})(null, { fd, highWaterMark: -1 })],
    ["a subclass of fs.WriteStream", fd => new (class extends fs.WriteStream {})(null, { fd, highWaterMark: -1 })],
    ["handle.readLines()", handle => handle.readLines({ highWaterMark: -1 })],
  ])("%s", async (_, build) => {
    await using dir = tempDir("filehandle-stream-throws", { "x.txt": "hello world" });
    const handle = await open(join(dir, "x.txt"), "r+");
    expect(await afterThrow(handle, build)).toEqual({
      thrown: expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
      ...givenBack,
    });
  });

  // Code of the caller that runs while the stream takes the ref and adds its listener.
  describe.each(["ReadStream", "WriteStream"])("fs.%s gives the ref back when", name => {
    it.each([
      [
        "a 'newListener' listener of the handle throws",
        fd => {
          fd.once("newListener", boom);
          new fs[name](null, { fd });
        },
      ],
      [
        "a `close` getter of a subclass throws",
        fd =>
          new (class extends fs[name] {
            get close() {
              return boom();
            }
          })(null, { fd }),
      ],
    ])("%s", async (_, build) => {
      await using dir = tempDir("filehandle-stream-throws", { "x.txt": "hello world" });
      const handle = await open(join(dir, "x.txt"), "r+");
      expect(await afterThrow(handle, build)).toEqual({
        thrown: expect.objectContaining({ message: "boom" }),
        ...givenBack,
      });
    });
  });

  // A stream on a path takes nothing from a handle. The error of Readable / Writable is the one thrown.
  it.each(["createReadStream", "createWriteStream"])("fs.%s(path) throws the same error", async method => {
    await using dir = tempDir("filehandle-stream-throws", { "x.txt": "hello world" });
    expect(() => fs[method](join(dir, "x.txt"), { highWaterMark: -1 })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
  });

  it("settles a close() that was pending when the constructor threw", async () => {
    await using dir = tempDir("filehandle-stream-throws", { "x.txt": "hello world" });
    const handle = await open(join(dir, "x.txt"), "r+");
    const read = handle.read(Buffer.alloc(5), 0, 5, 0);
    const closed = handle.close();
    expect(() => handle.createReadStream({ highWaterMark: -1 })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
    await read;
    await closed;
    expect(handle.fd).toBe(-1);
  });

  it("leaves a live stream of the same handle as it is", async () => {
    await using dir = tempDir("filehandle-stream-throws", { "x.txt": "hello world" });
    const handle = await open(join(dir, "x.txt"), "r+");
    const live = handle.createReadStream();
    // The close in `afterThrow` closes the live stream through its listener, and waits for it.
    const result = await afterThrow(handle, () => handle.createReadStream({ highWaterMark: -1 }));
    expect({ ...result, liveDestroyed: live.destroyed }).toEqual({
      thrown: expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
      ...givenBack,
      listeners: 2,
      liveDestroyed: true,
    });
  });

  it("lets the next stream of the same handle read the file and close the handle", async () => {
    await using dir = tempDir("filehandle-stream-throws", { "x.txt": "hello world" });
    const handle = await open(join(dir, "x.txt"), "r+");
    let thrown;
    try {
      handle.createReadStream({ highWaterMark: -1 });
    } catch (err) {
      thrown = err;
    }
    const text = await handle
      .createReadStream({ encoding: "utf8" })
      .toArray()
      .then(
        chunks => chunks.join(""),
        err => err,
      );
    const closed = await handle.close().then(
      () => "fulfilled",
      err => err,
    );
    expect({ thrown, text, closed, fd: handle.fd }).toEqual({
      thrown: expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
      text: "hello world",
      closed: "fulfilled",
      fd: -1,
    });
  });

  // Plain inheritance lets the caller keep a stream whose constructor threw. The handle can then close the
  // descriptor, and another file can get its number.
  it("leaves no descriptor number in a stream that the caller kept", async () => {
    await using dir = tempDir("filehandle-stream-throws", { "x.txt": "hello world", "other.txt": "other" });
    const handle = await open(join(dir, "x.txt"), "r+");
    const stream = Object.create(fs.WriteStream.prototype);
    const result = await afterThrow(handle, fd => fs.WriteStream.call(stream, null, { fd, encoding: "buffer" }));
    // The lowest free number is the number that the handle had.
    const other = fs.openSync(join(dir, "other.txt"), "r+");
    const { promise: written, resolve } = Promise.withResolvers();
    try {
      stream.write("zombie", resolve);
    } catch (err) {
      resolve(err);
    }
    const writeError = await written;
    fs.closeSync(other);
    expect({
      ...result,
      streamFd: stream.fd,
      writeError,
      other: fs.readFileSync(join(dir, "other.txt"), "utf8"),
    }).toEqual({
      thrown: expect.objectContaining({ code: "ERR_UNKNOWN_ENCODING" }),
      ...givenBack,
      streamFd: -1,
      writeError: expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }),
      other: "other",
    });
  });

  it.each(["createReadStream", "createWriteStream"])("handle.%s() keeps `fd` as its first property", async method => {
    await using dir = tempDir("filehandle-stream-throws", { "x.txt": "hello world" });
    await using handle = await open(join(dir, "x.txt"), "r+");
    expect(Object.keys(handle[method]())[0]).toBe("fd");
  });

  // The listener runs while the stream adds its own 'close' listener. The stream holds its ref by then.
  it("takes the ref before code of the caller can close the handle", async () => {
    await using dir = tempDir("filehandle-stream-throws", { "x.txt": "hello world" });
    const handle = await open(join(dir, "x.txt"), "r+");
    let closed;
    handle.once("newListener", () => {
      closed = handle.close();
    });
    const text = await handle
      .createReadStream({ encoding: "utf8" })
      .toArray()
      .then(
        chunks => chunks.join(""),
        err => err,
      );
    const listenerRan = closed !== undefined;
    await (closed ?? handle.close());
    expect({ listenerRan, text, fd: handle.fd }).toEqual({ listenerRan: true, text: "hello world", fd: -1 });
  });

  // The `aborted` getter runs in Readable and closes the handle: the stream gives its ref back there.
  it("does not give the ref back a second time", async () => {
    await using dir = tempDir("filehandle-stream-throws", { "x.txt": "hello world" });
    const handle = await open(join(dir, "x.txt"), "r+");
    const read = handle.read(Buffer.alloc(5), 0, 5, 0);
    let closed;
    const signal = {
      get aborted() {
        closed = handle.close();
        return boom();
      },
    };
    let thrown;
    try {
      handle.createReadStream({ signal });
    } catch (err) {
      thrown = err;
    }
    // The read still holds its ref, so the descriptor stays open until the read ends.
    const openDuringRead = handle.fd !== -1;
    const bytesRead = await read.then(
      result => result.bytesRead,
      err => err,
    );
    await (closed ?? handle.close());
    expect({ thrown, openDuringRead, bytesRead, fd: handle.fd }).toEqual({
      thrown: expect.objectContaining({ message: "boom" }),
      openDuringRead: true,
      bytesRead: 5,
      fd: -1,
    });
  });

  // Readable adds an abort listener before it checks `captureRejections`, so the signal can destroy the stream later.
  it("does not close the handle when the signal of the stream aborts later", async () => {
    await using dir = tempDir("filehandle-stream-throws", { "x.txt": "hello world" });
    await using handle = await open(join(dir, "x.txt"), "r+");
    // Plain inheritance keeps the stream in reach, so that its AbortError has a listener.
    const stream = Object.create(fs.ReadStream.prototype);
    const onError = jest.fn();
    const { promise: streamClosed, resolve } = Promise.withResolvers();
    stream.on("error", onError).on("close", resolve);
    const controller = new AbortController();
    expect(() =>
      fs.ReadStream.call(stream, null, { fd: handle, signal: controller.signal, captureRejections: 1 }),
    ).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
    controller.abort();
    await streamClosed;
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "ABORT_ERR" }));
    expect((await handle.stat()).isFile()).toBe(true);
  });
});

it("fail()/end() with autoClose defer the close past an in-flight write", async () => {
  await using dir = tempDir("writer-teardown", { "a.bin": "", "b.bin": "" });
  // fail() while a large write is on the threadpool must not close the fd
  // under it; the write completes, then the handle closes.
  {
    const fh = await fsPromises.open(join(dir, "a.bin"), "w");
    const w = fh.writer({ autoClose: true });
    const big = Buffer.alloc(8 << 20, 65);
    const pending = w.write(big);
    w.fail(new Error("stop"));
    await pending; // must not reject with EBADF
    expect(fs.statSync(join(dir, "a.bin")).size).toBe(big.byteLength);
    expect(fh.fd).toBe(-1); // deferred teardown closed the handle
  }
  // end() while a write is pending waits for it and reports all bytes
  {
    const fh = await fsPromises.open(join(dir, "b.bin"), "w");
    const w = fh.writer({ autoClose: true });
    const big = Buffer.alloc(8 << 20, 66);
    const pending = w.write(big);
    const total = await w.end();
    await pending;
    expect(total).toBe(big.byteLength);
    expect(fs.statSync(join(dir, "b.bin")).size).toBe(big.byteLength);
    expect(fh.fd).toBe(-1);
  }
});

it("teardown waits for every concurrent in-flight write", async () => {
  await using dir = tempDir("writer-concurrent", { "a.bin": "" });
  const fh = await fsPromises.open(join(dir, "a.bin"), "w");
  const w = fh.writer({ autoClose: true, start: 0 });
  const big = Buffer.alloc(4 << 20, 65);
  // two unawaited writes in flight; the first one finishing must not run the
  // deferred teardown while the second is still on the threadpool
  const p1 = w.write(big);
  const p2 = w.write(big);
  w.fail(new Error("stop"));
  await p1;
  await p2; // must not reject with EBADF
  expect(fs.statSync(join(dir, "a.bin")).size).toBe(big.byteLength * 2);
  expect(fh.fd).toBe(-1);
});

// node rejects abortable fs APIs with an AbortError (an Error whose code is the
// string "ABORT_ERR", whose message has no trailing period, and whose cause is
// signal.reason), never with the raw DOMException held in signal.reason (whose
// .code is the number 20 and whose message ends in a period).
describe("AbortSignal rejections use node's AbortError shape", () => {
  function expectNodeAbortError(err, reason) {
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(DOMException);
    expect({ name: err.name, code: err.code, message: err.message }).toEqual({
      name: "AbortError",
      code: "ABORT_ERR",
      message: "The operation was aborted",
    });
    expect(err.cause).toBe(reason);
  }

  test("readFile with a pre-aborted signal", async () => {
    await using dir = tempDir("fs-abort-readfile", { "f.txt": "hello" });
    const signal = AbortSignal.abort();
    expect.assertions(4);
    try {
      await fsPromises.readFile(join(dir, "f.txt"), { signal });
    } catch (err) {
      expectNodeAbortError(err, signal.reason);
    }
  });

  test("readFile with a custom abort reason", async () => {
    await using dir = tempDir("fs-abort-readfile-reason", { "f.txt": "hello" });
    const reason = new Error("my reason");
    expect.assertions(4);
    try {
      await fsPromises.readFile(join(dir, "f.txt"), { signal: AbortSignal.abort(reason) });
    } catch (err) {
      expectNodeAbortError(err, reason);
    }
  });

  test("readFile aborted while in flight", async () => {
    await using dir = tempDir("fs-abort-readfile-inflight", { "f.txt": "hello" });
    const ac = new AbortController();
    const reason = new Error("stop");
    const promise = fsPromises.readFile(join(dir, "f.txt"), { signal: ac.signal });
    ac.abort(reason);
    expect.assertions(4);
    try {
      await promise;
    } catch (err) {
      expectNodeAbortError(err, reason);
    }
  });

  // abort() with no reason stores the signal's lazily-created DOMException in a
  // common-reason slot; the cause must still be that exact object, not a copy.
  test("readFile aborted while in flight with the default abort reason", async () => {
    await using dir = tempDir("fs-abort-readfile-inflight-default", { "f.txt": "hello" });
    const ac = new AbortController();
    const promise = fsPromises.readFile(join(dir, "f.txt"), { signal: ac.signal });
    ac.abort();
    expect.assertions(4);
    try {
      await promise;
    } catch (err) {
      expectNodeAbortError(err, ac.signal.reason);
    }
  });

  test("appendFile with a pre-aborted signal", async () => {
    await using dir = tempDir("fs-abort-appendfile", {});
    const signal = AbortSignal.abort();
    expect.assertions(4);
    try {
      await fsPromises.appendFile(join(dir, "f.txt"), "data", { signal });
    } catch (err) {
      expectNodeAbortError(err, signal.reason);
    }
  });

  test("writeFile with a pre-aborted signal", async () => {
    await using dir = tempDir("fs-abort-writefile", {});
    const signal = AbortSignal.abort();
    expect.assertions(4);
    try {
      await fsPromises.writeFile(join(dir, "f.txt"), "data", { signal });
    } catch (err) {
      expectNodeAbortError(err, signal.reason);
    }
  });

  test("writeFile of an async iterable with a pre-aborted signal", async () => {
    await using dir = tempDir("fs-abort-writefile-iter", {});
    const signal = AbortSignal.abort();
    expect.assertions(4);
    try {
      await fsPromises.writeFile(
        join(dir, "f.txt"),
        (async function* () {
          yield "a";
        })(),
        { signal },
      );
    } catch (err) {
      expectNodeAbortError(err, signal.reason);
    }
  });

  test("writeFile of an async iterable aborted between chunks", async () => {
    await using dir = tempDir("fs-abort-writefile-iter-inflight", {});
    const ac = new AbortController();
    expect.assertions(4);
    try {
      await fsPromises.writeFile(
        join(dir, "f.txt"),
        (async function* () {
          yield "a";
          ac.abort();
          yield "b";
        })(),
        { signal: ac.signal },
      );
    } catch (err) {
      expectNodeAbortError(err, ac.signal.reason);
    }
  });

  test("callback readFile and writeFile with a pre-aborted signal", async () => {
    await using dir = tempDir("fs-abort-callback", { "f.txt": "hello" });
    const signal = AbortSignal.abort();
    const readErr = await new Promise(resolve => fs.readFile(join(dir, "f.txt"), { signal }, resolve));
    expectNodeAbortError(readErr, signal.reason);
    const writeErr = await new Promise(resolve => fs.writeFile(join(dir, "o.txt"), "x", { signal }, resolve));
    expectNodeAbortError(writeErr, signal.reason);
  });
});
