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

// readFile, writeFile and appendFile of fs.promises take a FileHandle and run on its
// descriptor number. They hold the handle until they settle, as the FileHandle methods do.
describe("fs.promises functions with a FileHandle argument", () => {
  it.each([
    ["readFile(handle)", handle => fsPromises.readFile(handle, "utf8"), "hello", "hello"],
    ["writeFile(handle, string)", handle => fsPromises.writeFile(handle, "HELLO"), undefined, "HELLO"],
    ["writeFile(handle, iterable)", handle => fsPromises.writeFile(handle, ["HE", "LLO"]), undefined, "HELLO"],
    ["appendFile(handle, string)", handle => fsPromises.appendFile(handle, "HELLO"), undefined, "HELLO"],
  ])("%s keeps the descriptor open until it settles", async (_name, call, value, content) => {
    await using dir = tempDir("handle-argument", { "x.txt": "hello" });
    const file = join(dir, "x.txt");
    const fh = await fsPromises.open(file, "r+");
    const fd = fh.fd;
    const pending = call(fh);
    // close() in the same tick waits for the call
    const closed = fh.close();
    expect(fh.fd).toBe(fd);
    expect(await pending).toBe(value);
    await closed;
    expect(fh.fd).toBe(-1);
    expect(fs.readFileSync(file, "utf8")).toContain(content);
  });

  it.each([
    ["a fulfilled call", handle => fsPromises.readFile(handle), undefined],
    ["an argument error", handle => fsPromises.readFile(handle, { encoding: "no-such-encoding" }), "ERR_INVALID_ARG_VALUE"],
    ["a signal that is already aborted", handle => fsPromises.readFile(handle, { signal: AbortSignal.abort() }), "ABORT_ERR"],
    // the handle is open for reading only
    ["a task that fails", handle => fsPromises.writeFile(handle, "x"), expect.any(String)],
    [
      "an iterable that throws",
      handle =>
        fsPromises.writeFile(
          handle,
          (function* () {
            throw new Error("from the iterable");
          })(),
        ),
      "from the iterable",
    ],
  ])("releases the handle after %s", async (_name, call, outcome) => {
    await using dir = tempDir("handle-argument-settled", { "x.txt": "hello" });
    const fh = await fsPromises.open(join(dir, "x.txt"), "r");
    expect(
      await call(fh).then(
        () => undefined,
        err => err.code ?? err.message,
      ),
    ).toEqual(outcome);
    // nothing holds the handle any more, so close() does not wait
    const closed = fh.close();
    expect(fh.fd).toBe(-1);
    await closed;
  });

  it("a closed handle rejects with ERR_OUT_OF_RANGE and takes no part in a close() that is in progress", async () => {
    await using dir = tempDir("handle-argument-closed", { "x.txt": "hello" });
    const fh = await fsPromises.open(join(dir, "x.txt"), "r+");
    const fd = fh.fd;
    const read = fh.read(Buffer.alloc(1), 0, 1, 0);
    const closed = fh.close();
    await read;
    // the read released the last ref: fd reads -1 and the descriptor is being closed
    expect(fh.fd).toBe(-1);
    const outcomes = [
      fsPromises.readFile(fh),
      fsPromises.writeFile(fh, "x"),
      fsPromises.writeFile(fh, ["x"]),
      fsPromises.appendFile(fh, "x"),
    ].map(call =>
      call.then(
        () => "fulfilled",
        err => err.code,
      ),
    );
    expect(await Promise.all(outcomes)).toEqual([
      "ERR_OUT_OF_RANGE",
      "ERR_OUT_OF_RANGE",
      "ERR_OUT_OF_RANGE",
      "ERR_OUT_OF_RANGE",
    ]);
    await closed;
    // close() settled after the descriptor was closed. Nothing else opens a file in this
    // process between the close and this check.
    expect(() => fs.fstatSync(fd)).toThrow(expect.objectContaining({ code: "EBADF" }));
  });

  it("a getter that closes the handle does not take the descriptor from the call", async () => {
    await using dir = tempDir("handle-argument-getter", { "iterable.txt": "", "options.txt": "" });
    {
      const file = join(dir, "iterable.txt");
      const fh = await fsPromises.open(file, "r+");
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
      const fh = await fsPromises.open(file, "r+");
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
    const fh = await fsPromises.open(join(dir, "x.txt"), "r");
    const pending = fsPromises.readFile(fh, "utf8");
    let worker, thrown;
    try {
      worker = new Worker(join(dir, "worker.js"), { transferList: [fh], workerData: { fh } });
    } catch (err) {
      thrown = err;
    }
    // a worker exists only if the transfer was not refused
    await worker?.terminate();
    expect(thrown).toMatchObject({ name: "DataCloneError" });
    expect(await pending).toBe("hello");
    await fh.close();
  });
});

// The close of an autoClose writer() or pullSync() is synchronous. It waits, like close(),
// when another operation of the handle is pending.
describe("autoClose of FileHandle.writer() and pullSync() under another pending operation", () => {
  it.each([
    ["writer().endSync()", handle => handle.writer({ autoClose: true }).endSync()],
    ["writer().fail()", handle => handle.writer({ autoClose: true }).fail(new Error("stop"))],
    ["writer()[Symbol.dispose]()", handle => handle.writer({ autoClose: true })[Symbol.dispose]()],
    ["return() of a pullSync() iterator", handle => handle.pullSync({ autoClose: true })[Symbol.iterator]().return()],
  ])("%s waits for the operation", async (_name, teardown) => {
    await using dir = tempDir("autoclose-pending", { "x.txt": "hello" });
    const fh = await fsPromises.open(join(dir, "x.txt"), "r+");
    const fd = fh.fd;
    let closeEvents = 0;
    fh.on("close", () => closeEvents++);
    const stat = fh.stat();
    teardown(fh);
    // 'close' is emitted at once, the descriptor stays until the stat is done
    expect({ fd: fh.fd, closeEvents }).toEqual({ fd, closeEvents: 1 });
    expect((await stat).size).toBe(5);
    expect({ fd: fh.fd, closeEvents }).toEqual({ fd: -1, closeEvents: 1 });
  });

  it("a second teardown is a no-op while the first one waits", async () => {
    await using dir = tempDir("autoclose-twice", { "x.txt": "hello" });
    const fh = await fsPromises.open(join(dir, "x.txt"), "r");
    const fd = fh.fd;
    const stat = fh.stat();
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
      const fh = await fsPromises.open(file, "r+");
      const writer = fh.writer({ autoClose: true });
      const stat = fh.stat();
      const closed = fh.close();
      expect(() => writer.endSync()).toThrow(expect.objectContaining({ code: "ERR_INVALID_STATE" }));
      await stat;
      await closed;
    }
    {
      const fh = await fsPromises.open(file, "r+");
      const fd = fh.fd;
      fh.on("close", () => {
        throw new Error("from the listener");
      });
      const stat = fh.stat();
      expect(() => fh.writer({ autoClose: true }).endSync()).toThrow("from the listener");
      expect(fh.fd).toBe(fd);
      await stat;
      expect(fh.fd).toBe(-1);
    }
  });

  it("does not go through FileHandle.prototype.readFile or close", async () => {
    await using dir = tempDir("autoclose-patched", { "x.txt": "hello" });
    const fh = await fsPromises.open(join(dir, "x.txt"), "r+");
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
      const stat = fh.stat();
      fh.writer({ autoClose: true }).endSync();
      expect({ calls, fd: fh.fd }).toEqual({ calls: 0, fd });
      await stat;
    } finally {
      prototype.readFile = readFile;
      prototype.close = close;
    }
    expect(fh.fd).toBe(-1);
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
  const fh = await fsPromises.open(join(dir, "x.txt"), "r+");
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

// Each form parks one read of a FileHandle on a named pipe. While the read is pending, the
// handle is closed or dropped, or a writer()/pullSync() with autoClose ends. Then another
// file takes the descriptor number if the number is free. The read must give the bytes of
// the pipe, and the descriptor must stay open under it. One child process runs all forms.
it.skipIf(isWindows)("a pending read keeps the descriptor of its FileHandle", async () => {
  // The dropped form leaves its handle open, so it is last.
  const forms = ["readFile-closed", "writer-endSync", "writer-fail", "writer-dispose", "pullSync-return", "readFile-dropped"];
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
  const held = { fulfilled: "bytes of the pipe;", openWhilePending: true, otherTookTheNumber: false, collected: 0 };
  const heldThenClosed = { ...held, closedAfterTheRead: true };
  expect(JSON.parse(stdout)).toEqual({
    "readFile-closed": heldThenClosed,
    "writer-endSync": heldThenClosed,
    "writer-fail": heldThenClosed,
    "writer-dispose": heldThenClosed,
    "pullSync-return": heldThenClosed,
    // nobody holds the dropped handle to close it
    "readFile-dropped": held,
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
