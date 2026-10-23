import { bunEnv, bunExe, isWindows, tempDir, tempDirWithFiles } from "harness";
import { mkfifo } from "mkfifo";
import { Worker } from "node:worker_threads";
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

// Takes the outcome of an operation when its promise is created. A test that fails before it
// awaits the operation then leaves no unhandled rejection for the next test.
const settled = promise =>
  promise.then(
    value => ({ value }),
    err => ({ error: err.code ?? err.message }),
  );

const isOpen = fd => {
  try {
    fs.fstatSync(fd);
    return true;
  } catch {
    return false;
  }
};

// Asks for the close of a handle when a test ends, and does not wait for it. A close that a
// leaked ref keeps waiting then fails the assertion of its test, and not the timeout.
const closeAtEnd = handle => ({ [Symbol.dispose]: () => void handle.close().catch(() => {}) });

// readFile, writeFile and appendFile of fs.promises take a FileHandle and run on its
// descriptor number. They hold the handle until they settle, as the FileHandle methods do.
describe("fs.promises functions with a FileHandle argument", () => {
  it.each([
    ["readFile(handle)", handle => fsPromises.readFile(handle, "utf8"), "hello", "hello"],
    ["writeFile(handle, string)", handle => fsPromises.writeFile(handle, "HELLO"), undefined, "HELLO"],
    ["writeFile(handle, Buffer)", handle => fsPromises.writeFile(handle, Buffer.from("HELLO")), undefined, "HELLO"],
    ["writeFile(handle, iterable)", handle => fsPromises.writeFile(handle, ["HE", "LLO"]), undefined, "HELLO"],
    [
      "writeFile(handle, async iterable)",
      handle =>
        fsPromises.writeFile(
          handle,
          (async function* () {
            yield "HE";
            yield "LLO";
          })(),
        ),
      undefined,
      "HELLO",
    ],
    ["appendFile(handle, string)", handle => fsPromises.appendFile(handle, "HELLO"), undefined, "HELLO"],
  ])("%s keeps the descriptor open until it settles", async (_name, call, value, content) => {
    await using dir = tempDir("handle-argument", { "x.txt": "hello" });
    const file = join(dir, "x.txt");
    await using fh = await fsPromises.open(file, "r+");
    const fd = fh.fd;
    const pending = settled(call(fh));
    // close() in the same tick waits for the call
    const closed = fh.close();
    expect(fh.fd).toBe(fd);
    expect(await pending).toEqual({ value });
    await closed;
    expect(fh.fd).toBe(-1);
    expect(fs.readFileSync(file, "utf8")).toBe(content);
  });

  it.each([
    [
      "a signal that is already aborted",
      handle => fsPromises.readFile(handle, { signal: AbortSignal.abort() }),
      "ABORT_ERR",
    ],
    // the handle is open for reading only, so the write of the native task fails
    [
      "a writeFile task that fails",
      handle => fsPromises.writeFile(handle, "x"),
      expect.stringMatching(/^E(BADF|PERM|ACCES)$/),
    ],
    [
      "an appendFile task that fails",
      handle => fsPromises.appendFile(handle, "x"),
      expect.stringMatching(/^E(BADF|PERM|ACCES)$/),
    ],
    [
      "an iterable that throws",
      handle =>
        fsPromises.writeFile(handle, {
          [Symbol.iterator]() {
            throw new Error("from the iterable");
          },
        }),
      "from the iterable",
    ],
  ])("holds the handle until %s rejects, then releases it", async (_name, call, error) => {
    await using dir = tempDir("handle-argument-rejected", { "x.txt": "hello" });
    await using fh = await fsPromises.open(join(dir, "x.txt"), "r");
    const fd = fh.fd;
    const pending = settled(call(fh));
    // close() in the same tick waits for the call
    const closed = fh.close();
    expect(fh.fd).toBe(fd);
    expect(await pending).toEqual({ error });
    // the call released its ref, so the close that waited has run
    expect(fh.fd).toBe(-1);
    await closed;
  });

  // The native call throws before it starts a task, so close() comes from a getter of the options.
  it.each([
    ["readFile", (handle, options) => fsPromises.readFile(handle, options)],
    ["writeFile", (handle, options) => fsPromises.writeFile(handle, "x", options)],
    ["appendFile", (handle, options) => fsPromises.appendFile(handle, "x", options)],
  ])("%s holds the handle across an argument error, then releases it", async (_name, call) => {
    await using dir = tempDir("handle-argument-invalid", { "x.txt": "hello" });
    await using fh = await fsPromises.open(join(dir, "x.txt"), "r");
    const fd = fh.fd;
    let closed, fdInGetter;
    const options = {
      get encoding() {
        closed ??= fh.close();
        fdInGetter ??= fh.fd;
        return "no-such-encoding";
      },
    };
    expect(await settled(call(fh, options))).toEqual({ error: "ERR_INVALID_ARG_VALUE" });
    expect(fdInGetter).toBe(fd);
    // the call released its ref, so the close that waited has run
    expect(fh.fd).toBe(-1);
    await closed;
  });

  // A path, a number and a handle take the same number of turns to reject, as on node.
  it.each([
    ["readFile", target => fsPromises.readFile(target, { encoding: "no-such-encoding" })],
    ["writeFile", target => fsPromises.writeFile(target, "x", { encoding: "no-such-encoding" })],
    ["appendFile", target => fsPromises.appendFile(target, "x", { encoding: "no-such-encoding" })],
  ])("%s rejects an argument error after one turn for a path, a number and a handle", async (_name, call) => {
    await using dir = tempDir("handle-argument-turns", { "x.txt": "hello" });
    const file = join(dir, "x.txt");
    await using fh = await fsPromises.open(file, "r+");
    const orders = [];
    for (const target of [file, fh.fd, fh]) {
      const order = [];
      const rejected = call(target).catch(() => order.push("call"));
      await Promise.resolve()
        .then(() => order.push("turn 1"))
        .then(() => order.push("turn 2"))
        .then(() => order.push("turn 3"));
      await rejected;
      orders.push(order);
    }
    const expected = ["call", "turn 1", "turn 2", "turn 3"];
    expect(orders).toEqual([expected, expected, expected]);
  });

  it("a closed handle rejects and takes no part in a close() that is in progress", async () => {
    await using dir = tempDir("handle-argument-closing", { "x.txt": "hello" });
    await using fh = await fsPromises.open(join(dir, "x.txt"), "r+");
    const read = settled(fh.read(Buffer.alloc(1), 0, 1, 0));
    const closed = fh.close();
    await read;
    // the read released the last ref: fd reads -1 and the descriptor is being closed
    expect(fh.fd).toBe(-1);
    const outcomes = [fsPromises.readFile(fh), fsPromises.writeFile(fh, "x"), fsPromises.appendFile(fh, "x")];
    expect(await Promise.all(outcomes.map(settled))).toEqual([
      { error: "ERR_OUT_OF_RANGE" },
      { error: "ERR_OUT_OF_RANGE" },
      { error: "ERR_OUT_OF_RANGE" },
    ]);
    // Another thread closes the descriptor, so close() cannot settle before the event loop
    // turns. A ref on the closed handle that settled it would do so from a microtask.
    for (let i = 0; i < 32; i++) await Promise.resolve();
    expect(Bun.peek.status(closed)).toBe("pending");
    await closed;
  });

  it("writeFile of a closed handle checks its options as writeFile(-1) does", async () => {
    await using dir = tempDir("handle-argument-closed", { "x.txt": "hello" });
    const fh = await fsPromises.open(join(dir, "x.txt"), "r+");
    await fh.close();
    const calls = target => [
      fsPromises.writeFile(target, ["x"], { signal: AbortSignal.abort() }),
      fsPromises.writeFile(target, ["x"], "no-such-encoding"),
      fsPromises.writeFile(target, ["x"]),
      fsPromises.writeFile(target, "x"),
    ];
    const ofTheHandle = await Promise.all(calls(fh).map(settled));
    expect(ofTheHandle).toEqual([
      { error: "ABORT_ERR" },
      { error: "Unknown encoding: no-such-encoding" },
      { error: "ERR_OUT_OF_RANGE" },
      { error: "ERR_OUT_OF_RANGE" },
    ]);
    expect(ofTheHandle).toEqual(await Promise.all(calls(-1).map(settled)));
  });

  it("a getter that closes the handle does not take the descriptor from the call", async () => {
    await using dir = tempDir("handle-argument-getter", { "iterable.txt": "", "options.txt": "" });
    {
      const file = join(dir, "iterable.txt");
      await using fh = await fsPromises.open(file, "r+");
      const fd = fh.fd;
      let closed, fdInGetter;
      const data = {
        get [Symbol.iterator]() {
          closed ??= fh.close();
          fdInGetter ??= fh.fd;
          return function* () {
            yield "from the iterable";
          };
        },
      };
      await fsPromises.writeFile(fh, data);
      expect(fdInGetter).toBe(fd);
      await closed;
      expect(fs.readFileSync(file, "utf8")).toBe("from the iterable");
    }
    {
      const file = join(dir, "options.txt");
      await using fh = await fsPromises.open(file, "r+");
      const fd = fh.fd;
      let closed, fdInGetter;
      const options = {
        get encoding() {
          closed ??= fh.close();
          fdInGetter ??= fh.fd;
          return "utf8";
        },
      };
      await fsPromises.writeFile(fh, "from the string", options);
      expect(fdInGetter).toBe(fd);
      await closed;
      expect(fs.readFileSync(file, "utf8")).toBe("from the string");
    }
  });

  it("a FileHandle is not transferable while readFile(handle) is pending", async () => {
    await using dir = tempDir("handle-argument-transfer", { "x.txt": "hello", "worker.js": "" });
    await using fh = await fsPromises.open(join(dir, "x.txt"), "r");
    const pending = settled(fsPromises.readFile(fh, "utf8"));
    let worker, thrown;
    try {
      worker = new Worker(join(dir, "worker.js"), { transferList: [fh], workerData: { fh } });
    } catch (err) {
      thrown = err;
    }
    // a worker exists only if the transfer was not refused
    await worker?.terminate();
    expect(thrown).toBeInstanceOf(DOMException);
    expect(thrown).toMatchObject({ name: "DataCloneError", message: "Cannot transfer FileHandle while in use" });
    expect(await pending).toEqual({ value: "hello" });
  });

  // The call counts its ref through the object that it gets. A wrapper that accepts a write and
  // does not store it (a read-only proxy) must leave the handle as it is.
  it.each([
    ["fsPromises.readFile(wrapper)", wrapper => fsPromises.readFile(wrapper, "utf8")],
    ["fsPromises.writeFile(wrapper, string)", wrapper => fsPromises.writeFile(wrapper, "HELLO")],
    ["fsPromises.appendFile(wrapper, string)", wrapper => fsPromises.appendFile(wrapper, "HELLO")],
    ["wrapper.stat()", wrapper => wrapper.stat()],
  ])("%s does not close a handle whose wrapper drops every write", async (_name, call) => {
    await using dir = tempDir("handle-argument-wrapper", { "x.txt": "hello" });
    const fh = await fsPromises.open(join(dir, "x.txt"), "r+");
    using _close = closeAtEnd(fh);
    const fd = fh.fd;
    const dropped = [];
    const wrapper = new Proxy(fh, {
      set(_target, _key, value) {
        dropped.push(value);
        return true;
      },
    });
    await call(wrapper);
    // The release of a last ref writes -1 over the descriptor number, and another thread closes the number.
    const released = dropped.includes(-1);
    // The close() of the handle comes after that close, and then finds the number closed.
    while (released && isOpen(fd)) await new Promise(resolve => setImmediate(resolve));
    const closed = await settled(fh.close());
    expect({ released, closed }).toEqual({ released: false, closed: { value: undefined } });
  });

  it("readFile and appendFile declare their parameters, as in node", () => {
    expect([fsPromises.readFile.length, fsPromises.appendFile.length]).toEqual([2, 3]);
  });

  it("writeFile with no data rejects in the same way for a path, a number and a handle", async () => {
    await using dir = tempDir("handle-argument-nodata-write", { "x.txt": "hello" });
    const file = join(dir, "x.txt");
    await using fh = await fsPromises.open(file, "r+");
    const outcomes = [];
    for (const target of [file, fh.fd, fh]) {
      outcomes.push(
        await fsPromises.writeFile(target).then(
          () => "fulfilled",
          err => `${err.code}: ${err.message}`,
        ),
      );
    }
    expect(outcomes[0]).toStartWith("ERR_INVALID_ARG_TYPE: ");
    expect(outcomes).toEqual([outcomes[0], outcomes[0], outcomes[0]]);
    expect(fs.readFileSync(file, "utf8")).toBe("hello");
  });

  it("appendFile(path) with no data names the data argument and leaves the file as it is", async () => {
    await using dir = tempDir("handle-argument-nodata", { "x.txt": "hello" });
    const file = join(dir, "x.txt");
    const error = await fsPromises.appendFile(file).then(
      () => undefined,
      err => err,
    );
    expect(error).toBeInstanceOf(TypeError);
    expect(error).toMatchObject({
      code: "ERR_INVALID_ARG_TYPE",
      message: expect.stringMatching(
        /^The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView/,
      ),
    });
    expect(fs.readFileSync(file, "utf8")).toBe("hello");
  });
});

// The close of an autoClose writer() or pullSync() waits, like close(), when another operation
// of the handle is pending.
describe("autoClose of FileHandle.writer() and pullSync() under another pending operation", () => {
  it.each([
    // endSync() cannot finish its end now. It starts the end and returns -1, and end() gives the promise.
    ["writer().endSync()", handle => handle.writer({ autoClose: true }).endSync(), -1],
    ["writer().fail()", handle => handle.writer({ autoClose: true }).fail(new Error("stop")), undefined],
    ["writer()[Symbol.dispose]()", handle => handle.writer({ autoClose: true })[Symbol.dispose](), undefined],
    [
      "return() of a pullSync() iterator",
      handle => handle.pullSync({ autoClose: true })[Symbol.iterator]().return(),
      { value: undefined, done: true },
    ],
  ])("%s waits for the operation", async (_name, teardown, result) => {
    await using dir = tempDir("autoclose-pending", { "x.txt": "hello" });
    await using fh = await fsPromises.open(join(dir, "x.txt"), "r+");
    const fd = fh.fd;
    let closeEvents = 0;
    fh.on("close", () => closeEvents++);
    const stat = settled(fh.stat());
    expect(teardown(fh)).toEqual(result);
    // 'close' is emitted at once, the descriptor stays until the stat is done
    expect({ fd: fh.fd, closeEvents }).toEqual({ fd, closeEvents: 1 });
    expect(await stat).toEqual({ value: expect.objectContaining({ size: 5 }) });
    expect({ fd: fh.fd, closeEvents }).toEqual({ fd: -1, closeEvents: 1 });
  });

  it("end() after an endSync() that returned -1 settles when the descriptor is closed", async () => {
    await using dir = tempDir("autoclose-endsync", { "x.txt": "hello" });
    await using fh = await fsPromises.open(join(dir, "x.txt"), "r+");
    const fd = fh.fd;
    const stat = settled(fh.stat());
    const writer = fh.writer({ autoClose: true });
    expect(writer.writeSync("HE")).toBe(true);
    expect(writer.endSync()).toBe(-1);
    expect(fh.fd).toBe(fd);
    // what pipeTo() does after a negative endSync()
    expect(await writer.end()).toBe(2);
    expect(fh.fd).toBe(-1);
    expect(await stat).toEqual({ value: expect.objectContaining({ size: 5 }) });
  });

  it("endSync() ends at once when only the writer holds the handle", async () => {
    await using dir = tempDir("autoclose-endsync-alone", { "x.txt": "hello" });
    const file = join(dir, "x.txt");
    await using fh = await fsPromises.open(file, "r+");
    const writer = fh.writer({ autoClose: true });
    // the writer takes its ref at this write
    expect(writer.writeSync("HE")).toBe(true);
    expect({ written: writer.endSync(), fd: fh.fd }).toEqual({ written: 2, fd: -1 });
    expect(fs.readFileSync(file, "utf8")).toBe("HEllo");
  });

  it("endSync() of a writer without autoClose does not wait for another operation", async () => {
    await using dir = tempDir("autoclose-off-endsync", { "x.txt": "hello" });
    await using fh = await fsPromises.open(join(dir, "x.txt"), "r+");
    const fd = fh.fd;
    const stat = settled(fh.stat());
    const writer = fh.writer();
    expect(writer.writeSync("HE")).toBe(true);
    expect({ written: writer.endSync(), fd: fh.fd }).toEqual({ written: 2, fd });
    await stat;
  });

  it("the teardown of a failed writer is a no-op after an endSync() that waits", async () => {
    await using dir = tempDir("autoclose-two-writers", { "x.txt": "" });
    const file = join(dir, "x.txt");
    await using fh = await fsPromises.open(file, "r+");
    // an operation of the handle that lasts until the gate opens
    const { promise: gate, resolve: openGate } = Promise.withResolvers();
    const held = settled(
      fh.writeFile({
        [Symbol.asyncIterator]: () => ({ next: () => gate.then(() => ({ done: true, value: undefined })) }),
      }),
    );
    // the first writer fails with a write in flight, so its teardown runs when the write lands
    const first = fh.writer({ autoClose: true, start: 0 });
    const written = settled(first.write(Buffer.alloc(1 << 20, "a")));
    first.fail(new Error("stop"));
    const ended = fh.writer({ autoClose: true }).endSync();
    const outcome = await written;
    // the gate opens before the assertions, so that a failure does not leave close() waiting
    openGate();
    expect({ ended, outcome, held: await held }).toEqual({
      ended: -1,
      outcome: { value: undefined },
      held: { value: undefined },
    });
    expect(fh.fd).toBe(-1);
    expect(fs.statSync(file).size).toBe(1 << 20);
  });

  it("a second teardown is a no-op while the first one waits", async () => {
    await using dir = tempDir("autoclose-twice", { "x.txt": "hello" });
    await using fh = await fsPromises.open(join(dir, "x.txt"), "r");
    const fd = fh.fd;
    const stat = settled(fh.stat());
    const source = fh.pullSync({ autoClose: true });
    const first = source[Symbol.iterator]();
    const second = source[Symbol.iterator]();
    first.return();
    expect(fh.fd).toBe(fd);
    second.return();
    expect(fh.fd).toBe(fd);
    await stat;
    expect(fh.fd).toBe(-1);
  });

  it("a teardown after close() throws as before, and a 'close' listener that throws is not swallowed", async () => {
    await using dir = tempDir("autoclose-throws", { "x.txt": "hello" });
    const file = join(dir, "x.txt");
    {
      await using fh = await fsPromises.open(file, "r+");
      const writer = fh.writer({ autoClose: true });
      // two operations, so that one ref more than the own ref of the handle is left after close()
      const stats = [settled(fh.stat()), settled(fh.stat())];
      const closed = fh.close();
      expect(() => writer.endSync()).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_STATE", message: "Invalid state: The FileHandle is closing" }),
      );
      await Promise.all(stats);
      await closed;
    }
    {
      await using fh = await fsPromises.open(file, "r+");
      const fd = fh.fd;
      const listener = () => {
        throw new Error("from the listener");
      };
      fh.on("close", listener);
      try {
        const stat = settled(fh.stat());
        expect(() => fh.writer({ autoClose: true }).fail(new Error("stop"))).toThrow("from the listener");
        expect(fh.fd).toBe(fd);
        await stat;
        expect(fh.fd).toBe(-1);
      } finally {
        fh.off("close", listener);
      }
    }
  });

  it("does not go through FileHandle.prototype.readFile or close", async () => {
    await using dir = tempDir("autoclose-patched", { "x.txt": "hello" });
    await using fh = await fsPromises.open(join(dir, "x.txt"), "r+");
    const fd = fh.fd;
    const prototype = Object.getPrototypeOf(fh);
    const { readFile, close } = prototype;
    let calls = 0;
    prototype.readFile = function (...args) {
      calls++;
      return readFile.apply(this, args);
    };
    prototype.close = function (...args) {
      calls++;
      return close.apply(this, args);
    };
    try {
      expect(await fsPromises.readFile(fh, "utf8")).toBe("hello");
      const stat = settled(fh.stat());
      fh.writer({ autoClose: true }).fail(new Error("stop"));
      expect({ calls, fd: fh.fd }).toEqual({ calls: 0, fd });
      await stat;
    } finally {
      prototype.readFile = readFile;
      prototype.close = close;
    }
    expect(fh.fd).toBe(-1);
  });

  // A stream of the handle holds a ref until it is destroyed. The 'close' event of the handle ends it.
  it.each([
    ["writer().endSync()", handle => handle.writer({ autoClose: true }).endSync()],
    ["writer().fail()", handle => handle.writer({ autoClose: true }).fail(new Error("stop"))],
    ["return() of a pullSync() iterator", handle => handle.pullSync({ autoClose: true })[Symbol.iterator]().return()],
  ])("%s waits for a WriteStream of the handle, which finishes its write first", async (_name, teardown) => {
    await using dir = tempDir("autoclose-writestream", { "x.txt": "hello" });
    const file = join(dir, "x.txt");
    await using fh = await fsPromises.open(file, "r+");
    const fd = fh.fd;
    const stream = fh.createWriteStream();
    const { promise: written, resolve } = Promise.withResolvers();
    stream.write("HELLO", err => resolve(err?.code ?? "written"));
    const events = [];
    stream.on("error", err => events.push("error:" + err.code));
    stream.on("finish", () => events.push("finish"));
    const { promise: closed, resolve: onClose } = Promise.withResolvers();
    stream.on("close", onClose);
    teardown(fh);
    expect(fh.fd).toBe(fd);
    expect(await written).toBe("written");
    await closed;
    expect({ fd: fh.fd, events }).toEqual({ fd: -1, events: ["finish"] });
    expect(fs.readFileSync(file, "utf8")).toBe("HELLO");
  });

  it("writer().fail() ends a paused ReadStream of the handle, and then the descriptor closes", async () => {
    await using dir = tempDir("autoclose-readstream", { "x.txt": "hello" });
    await using fh = await fsPromises.open(join(dir, "x.txt"), "r+");
    const fd = fh.fd;
    const stream = fh.createReadStream();
    const events = [];
    stream.on("error", err => events.push("error:" + err.code));
    const { promise: closed, resolve: onClose } = Promise.withResolvers();
    stream.on("close", onClose);
    // the stream is not constructed yet, so it ends on a later tick and holds the handle until then
    fh.writer({ autoClose: true }).fail(new Error("stop"));
    expect(fh.fd).toBe(fd);
    await closed;
    expect({ fd: fh.fd, events }).toEqual({ fd: -1, events: [] });
  });

  // With autoClose off, a WriteStream is not destroyed when it finishes or fails, and its close()
  // waits for a 'finish' event that does not come again. It still lets go of the handle.
  it.each([
    ["writer().endSync()", handle => handle.writer({ autoClose: true }).endSync(), -1],
    ["writer().fail()", handle => handle.writer({ autoClose: true }).fail(new Error("stop")), undefined],
    [
      "return() of a pullSync() iterator",
      handle => handle.pullSync({ autoClose: true })[Symbol.iterator]().return(),
      { value: undefined, done: true },
    ],
    ["close()", handle => void handle.close(), undefined],
  ])("%s is not held by a WriteStream that finished or failed with autoClose off", async (_name, teardown, result) => {
    await using dir = tempDir("autoclose-idle-writestream", { "x.txt": "hello" });
    // a write on a handle that is open for reading fails
    for (const [flags, settles] of [
      ["r+", "finish"],
      ["r", "error"],
    ]) {
      const fh = await fsPromises.open(join(dir, "x.txt"), flags);
      using _close = closeAtEnd(fh);
      const stream = fh.createWriteStream({ autoClose: false });
      const { promise: ended, resolve } = Promise.withResolvers();
      stream.on("finish", () => resolve("finish")).on("error", () => resolve("error"));
      stream.end("HE");
      expect(await ended).toBe(settles);
      expect(teardown(fh)).toEqual(result);
      // the 'close' event of the handle destroys the stream, and the release of its ref closes the descriptor
      expect({ destroyed: stream.destroyed, fd: fh.fd }).toEqual({ destroyed: true, fd: -1 });
    }
  });
});

// A getter of an argument is caller code and can close the handle. The methods that read
// their arguments in JavaScript take their ref first, so that close() waits for the call.
it.each([
  [
    "appendFile(data, options)",
    (handle, getter) =>
      handle.appendFile("x", {
        get encoding() {
          getter();
          return "utf8";
        },
      }),
  ],
  [
    "writeFile(data, options)",
    (handle, getter) =>
      handle.writeFile("x", {
        get encoding() {
          getter();
          return "utf8";
        },
      }),
  ],
  [
    "read(options)",
    (handle, getter) =>
      handle.read({
        get buffer() {
          getter();
          return Buffer.alloc(5);
        },
      }),
  ],
  [
    "write(buffer, options)",
    (handle, getter) =>
      handle.write(Buffer.from("x"), {
        get offset() {
          getter();
          return 0;
        },
      }),
  ],
])("FileHandle.%s takes its ref before it reads its arguments", async (_name, call) => {
  await using dir = tempDir("handle-method-getter", { "x.txt": "hello" });
  await using fh = await fsPromises.open(join(dir, "x.txt"), "r+");
  const fd = fh.fd;
  let closed, fdInGetter;
  await call(fh, () => {
    closed ??= fh.close();
    fdInGetter ??= fh.fd;
  });
  expect(fdInGetter).toBe(fd);
  await closed;
  expect(fh.fd).toBe(-1);
});

// A writer() takes its ref at its first write, after it read the arguments of that write. Their
// getters are caller code. A write does not start on a handle or a writer that they ended.
describe("the first write of a FileHandle.writer()", () => {
  it.each([
    [
      "write(chunk, options)",
      (writer, getter) =>
        writer.write(Buffer.from("x"), {
          get signal() {
            getter();
            return undefined;
          },
        }),
    ],
    [
      "writev(chunks, options)",
      (writer, getter) =>
        writer.writev([Buffer.from("x")], {
          get signal() {
            getter();
            return undefined;
          },
        }),
    ],
    [
      "writeSync(chunk)",
      (writer, getter) => {
        const chunk = Buffer.from("x");
        Object.defineProperty(chunk, "byteLength", {
          get() {
            getter();
            return 1;
          },
        });
        return writer.writeSync(chunk);
      },
    ],
    [
      "writevSync(chunks)",
      (writer, getter) => {
        const chunks = [];
        Object.defineProperty(chunks, 0, {
          get() {
            getter();
            return Buffer.from("x");
          },
        });
        return writer.writevSync(chunks);
      },
    ],
  ])("%s does not start on a handle that a getter of its arguments closed", async (_name, call) => {
    await using dir = tempDir("writer-getter-closes", { "x.txt": "" });
    const file = join(dir, "x.txt");
    await using fh = await fsPromises.open(file, "r+");
    const writer = fh.writer();
    let closed;
    let outcome;
    try {
      outcome = await call(writer, () => {
        closed ??= fh.close();
      });
    } catch (err) {
      outcome = err;
    }
    expect(outcome).toMatchObject({ code: "ERR_INVALID_STATE", message: "Invalid state: The FileHandle is closed" });
    await closed;
    expect(fh.fd).toBe(-1);
    // the write did not start, so it did not fail the writer
    expect(await settled(writer.end())).toEqual({ value: 0 });
    expect(fs.readFileSync(file, "utf8")).toBe("");
  });

  it.each([
    ["fail()", writer => writer.fail(new Error("stop")), "stop"],
    ["end()", writer => void writer.end(), "ERR_INVALID_STATE"],
    ["endSync()", writer => writer.endSync(), "ERR_INVALID_STATE"],
  ])("does not start, and takes no ref, when a getter of its arguments called %s", async (_name, end, error) => {
    await using dir = tempDir("writer-getter-ends", { "x.txt": "" });
    const file = join(dir, "x.txt");
    const fh = await fsPromises.open(file, "r+");
    using _close = closeAtEnd(fh);
    const writer = fh.writer();
    const outcome = await settled(
      writer.write(Buffer.from("x"), {
        get signal() {
          end(writer);
          return undefined;
        },
      }),
    );
    // close() takes the descriptor at once when no operation holds a ref
    const closed = fh.close();
    expect({ outcome, fd: fh.fd }).toEqual({ outcome: { error }, fd: -1 });
    await closed;
    expect(fs.readFileSync(file, "utf8")).toBe("");
  });

  it.each([
    ["write() over options.limit", { limit: 1 }, writer => writer.write(Buffer.from("too long"))],
    ["write() with an aborted signal", {}, writer => writer.write(Buffer.from("x"), { signal: AbortSignal.abort() })],
    ["writev() over options.limit", { limit: 1 }, writer => writer.writev([Buffer.from("too long")])],
    ["writeSync() over options.chunkSize", { chunkSize: 1 }, writer => writer.writeSync(Buffer.from("too long"))],
    ["writevSync() over options.chunkSize", { chunkSize: 1 }, writer => writer.writevSync([Buffer.from("too long")])],
  ])("a writer whose first call is %s does not prevent close()", async (_name, options, call) => {
    await using dir = tempDir("writer-no-pin", { "x.txt": "" });
    const fh = await fsPromises.open(join(dir, "x.txt"), "r+");
    using _close = closeAtEnd(fh);
    const writer = fh.writer(options);
    await settled(Promise.resolve().then(() => call(writer)));
    // close() takes the descriptor at once when no operation holds a ref
    const closed = fh.close();
    expect(fh.fd).toBe(-1);
    await closed;
  });

  it("writev() reads the size of a chunk once, before it checks the writer", async () => {
    await using dir = tempDir("writer-writev-size", { "x.txt": "" });
    const file = join(dir, "x.txt");
    await using fh = await fsPromises.open(file, "r+");
    const writer = fh.writer();
    const chunk = Buffer.from("WXYZ");
    let reads = 0;
    Object.defineProperty(chunk, "byteLength", {
      get() {
        // a later read would come after the check of the writer
        if (++reads > 1) writer.fail(new Error("stop"));
        return 4;
      },
    });
    expect(await settled(writer.writev([chunk]))).toEqual({ value: undefined });
    expect(await settled(writer.end())).toEqual({ value: 4 });
    expect(fs.readFileSync(file, "utf8")).toBe("WXYZ");
  });

  it("end() called from a 'close' listener of the handle, inside the end, returns a promise of the count", async () => {
    await using dir = tempDir("writer-end-reentrant", { "x.txt": "" });
    await using fh = await fsPromises.open(join(dir, "x.txt"), "r+");
    const writer = fh.writer({ autoClose: true });
    expect(writer.writeSync("HE")).toBe(true);
    let inner;
    fh.on("close", () => {
      inner = writer.end();
    });
    expect(await writer.end()).toBe(2);
    expect(inner).toBeInstanceOf(Promise);
    expect(await inner).toBe(2);
  });
});

// Each form parks one read of a FileHandle on a named pipe. While the read is pending, the
// handle is closed or dropped, or a writer()/pullSync() with autoClose ends. Then the pipe is
// fed and ended. The read must fulfil, and the descriptor must stay open under it. One child
// process runs all forms.
it.skipIf(isWindows)("a pending read keeps the descriptor of its FileHandle", async () => {
  // The dropped form leaves its handle open, so it is last.
  const forms = [
    "readFile-closed",
    "writer-endSync",
    "writer-fail",
    "writer-dispose",
    "pullSync-return",
    "readFile-dropped",
  ];
  using dir = tempDir("handle-pending-read", {});
  for (const form of forms) mkfifo(join(String(dir), "pipe-" + form), 0o666);
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "fs-promises-filehandle-pending-op-fixture.ts"), String(dir), ...forms],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const held = { fulfilled: "bytes of the pipe;", openWhilePending: true, collected: 0 };
  const { "readFile-dropped": dropped, ...closedOrEnded } = JSON.parse(stdout);
  // A handle that the caller dropped stays alive while the call is pending, as in node. Nobody holds it to close it.
  expect(dropped).toEqual(held);
  const heldThenClosed = { ...held, closedAfterTheRead: true };
  expect(closedOrEnded).toEqual({
    "readFile-closed": heldThenClosed,
    "writer-endSync": heldThenClosed,
    "writer-fail": heldThenClosed,
    "writer-dispose": heldThenClosed,
    "pullSync-return": heldThenClosed,
  });
  expect(exitCode).toBe(0);
});

// A close that waits for an operation that never ends is not lost: the descriptor closes when
// the handle is collected, and the handle is not reported. The operation is an abandoned
// iterator of pullSync(), or a writeFile() whose source never gives a chunk, in a
// Bun.ModuleGraph that is disposed. A close that waited and then ran leaves nothing for the
// collection to close.
it("a close that waits for an operation that never ends happens when the handle is collected", async () => {
  using dir = tempDir("close-at-collection", {
    "x.txt": Buffer.alloc(300_000, "a").toString(),
    "script.mjs": `
      import fs from "node:fs";
      export const start = async (file, how) => {
        const handle = await fs.promises.open(file, "r+");
        const number = handle.fd;
        const source = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) };
        if (how === "function") fs.promises.writeFile(handle, source);
        else handle.writeFile(source);
        handle.close();
        return number;
      };
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "fs-promises-filehandle-collected-fixture.ts"), String(dir)],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const closedAtCollection = { openAfterTheRequest: true, openAfterCollection: false };
  expect(JSON.parse(stdout)).toEqual({
    closeThatRan: { numberTakenAgain: true, openAfterCollection: true },
    autoCloseBehindAnIterator: closedAtCollection,
    closeBehindAnIterator: closedAtCollection,
    closeBehindWriteFileOfADisposedGraph: closedAtCollection,
    closeBehindAMethodOfADisposedGraph: closedAtCollection,
    reported: 0,
  });
  expect(exitCode).toBe(0);
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
