import { tempDirWithFiles } from "harness";
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
  const dir = tempDirWithFiles("unused-writer", { "x.txt": "hello" });
  const fh = await fsPromises.open(join(dir, "x.txt"), "r+");
  fh.writer(); // never written to, never ended
  // must not hang: the writer only refs the handle once a write happens
  await fh.close();
  expect(fh.fd).toBe(-1);
});

it("sources created before close() refuse to use the stale fd", async () => {
  const dir = tempDirWithFiles("stale-fd", { "x.txt": "hello" });
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
  const dir = tempDirWithFiles("rm-eisdir", { "sub/a.txt": "x" });
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
  const dir = tempDirWithFiles("deferred-close", { "x.txt": "hello" });
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
  const dir = tempDirWithFiles("writer-teardown", { "a.bin": "", "b.bin": "" });
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
  const dir = tempDirWithFiles("writer-concurrent", { "a.bin": "" });
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
// string "ABORT_ERR" and whose cause is signal.reason), never with the raw
// DOMException held in signal.reason (whose .code is the number 20).
describe("AbortSignal rejections use node's AbortError shape", () => {
  function expectNodeAbortError(err, reason) {
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(DOMException);
    expect({ name: err.name, code: err.code, message: err.message }).toEqual({
      name: "AbortError",
      code: "ABORT_ERR",
      message: "The operation was aborted.",
    });
    expect(err.cause).toBe(reason);
  }

  test("readFile with a pre-aborted signal", async () => {
    const dir = tempDirWithFiles("fs-abort-readfile", { "f.txt": "hello" });
    const signal = AbortSignal.abort();
    expect.assertions(4);
    try {
      await fsPromises.readFile(join(dir, "f.txt"), { signal });
    } catch (err) {
      expectNodeAbortError(err, signal.reason);
    }
  });

  test("readFile with a custom abort reason", async () => {
    const dir = tempDirWithFiles("fs-abort-readfile-reason", { "f.txt": "hello" });
    const reason = new Error("my reason");
    expect.assertions(4);
    try {
      await fsPromises.readFile(join(dir, "f.txt"), { signal: AbortSignal.abort(reason) });
    } catch (err) {
      expectNodeAbortError(err, reason);
    }
  });

  test("readFile aborted while in flight", async () => {
    const dir = tempDirWithFiles("fs-abort-readfile-inflight", { "f.txt": "hello" });
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
    const dir = tempDirWithFiles("fs-abort-readfile-inflight-default", { "f.txt": "hello" });
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
    const dir = tempDirWithFiles("fs-abort-appendfile", {});
    const signal = AbortSignal.abort();
    expect.assertions(4);
    try {
      await fsPromises.appendFile(join(dir, "f.txt"), "data", { signal });
    } catch (err) {
      expectNodeAbortError(err, signal.reason);
    }
  });

  test("writeFile with a pre-aborted signal", async () => {
    const dir = tempDirWithFiles("fs-abort-writefile", {});
    const signal = AbortSignal.abort();
    expect.assertions(4);
    try {
      await fsPromises.writeFile(join(dir, "f.txt"), "data", { signal });
    } catch (err) {
      expectNodeAbortError(err, signal.reason);
    }
  });

  test("writeFile of an async iterable with a pre-aborted signal", async () => {
    const dir = tempDirWithFiles("fs-abort-writefile-iter", {});
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
    const dir = tempDirWithFiles("fs-abort-writefile-iter-inflight", {});
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
    const dir = tempDirWithFiles("fs-abort-callback", { "f.txt": "hello" });
    const signal = AbortSignal.abort();
    const readErr = await new Promise(resolve => fs.readFile(join(dir, "f.txt"), { signal }, resolve));
    expectNodeAbortError(readErr, signal.reason);
    const writeErr = await new Promise(resolve => fs.writeFile(join(dir, "o.txt"), "x", { signal }, resolve));
    expectNodeAbortError(writeErr, signal.reason);
  });
});

// node's validateAbortSignal accepts any object with an `aborted` property, so
// abort-controller polyfills and cross-realm signals work. Bun's timers.promises,
// child_process and events already accept these; fs.readFile/writeFile must too.
describe("readFile/writeFile accept AbortSignal-shaped objects", () => {
  const duck = {
    aborted: false,
    reason: undefined,
    addEventListener() {},
    removeEventListener() {},
    onabort: null,
  };

  test("fsPromises.readFile", async () => {
    const dir = tempDirWithFiles("fs-duck-signal-read", { "f.txt": "hello" });
    expect(await fsPromises.readFile(join(dir, "f.txt"), { signal: duck, encoding: "utf8" })).toBe("hello");
  });

  test("fsPromises.writeFile and appendFile", async () => {
    const dir = tempDirWithFiles("fs-duck-signal-write", {});
    const p = join(dir, "f.txt");
    await fsPromises.writeFile(p, "a", { signal: duck });
    await fsPromises.appendFile(p, "b", { signal: duck });
    expect(await fsPromises.readFile(p, "utf8")).toBe("ab");
  });

  test("callback fs.readFile and fs.writeFile", async () => {
    const dir = tempDirWithFiles("fs-duck-signal-cb", { "f.txt": "hello" });
    const readErr = await new Promise(resolve => fs.readFile(join(dir, "f.txt"), { signal: duck }, resolve));
    expect(readErr).toBeNull();
    const writeErr = await new Promise(resolve => fs.writeFile(join(dir, "o.txt"), "x", { signal: duck }, resolve));
    expect(writeErr).toBeNull();
  });

  test("fs.watch", () => {
    const dir = tempDirWithFiles("fs-duck-signal-watch", { "f.txt": "hello" });
    const w = fs.watch(dir, { signal: duck });
    w.close();
  });

  test("fs.watch with a pre-aborted signal-shaped object closes on nextTick", async () => {
    const dir = tempDirWithFiles("fs-duck-signal-watch-aborted", { "f.txt": "hello" });
    const aborted = { aborted: true, reason: new Error("stop"), addEventListener() {}, removeEventListener() {} };
    const w = fs.watch(dir, { signal: aborted });
    const { promise, resolve, reject } = Promise.withResolvers();
    w.on("close", resolve);
    w.on("error", reject);
    await promise;
  });

  // node's fs.readFile checks `signal.aborted` on the object itself (not via a
  // brand check), so a pre-aborted polyfill signal rejects with AbortError.
  test("a pre-aborted signal-shaped object rejects with AbortError", async () => {
    const dir = tempDirWithFiles("fs-duck-signal-preaborted", { "f.txt": "hello" });
    const reason = new Error("stop");
    const aborted = { aborted: true, reason, addEventListener() {}, removeEventListener() {} };
    for (const op of [
      () => fsPromises.readFile(join(dir, "f.txt"), { signal: aborted }),
      () => fsPromises.writeFile(join(dir, "o.txt"), "x", { signal: aborted }),
      () => fsPromises.appendFile(join(dir, "o.txt"), "x", { signal: aborted }),
    ]) {
      let err;
      try {
        await op();
      } catch (e) {
        err = e;
      }
      expect({ name: err?.name, code: err?.code, cause: err?.cause }).toEqual({
        name: "AbortError",
        code: "ABORT_ERR",
        cause: reason,
      });
    }
    expect(fs.existsSync(join(dir, "o.txt"))).toBe(false);
  });

  test("callback readFile/writeFile/appendFile with a pre-aborted signal-shaped object", async () => {
    const dir = tempDirWithFiles("fs-duck-signal-preaborted-cb", { "f.txt": "hello" });
    const reason = new Error("stop");
    const aborted = { aborted: true, reason, addEventListener() {}, removeEventListener() {} };
    const expected = { name: "AbortError", code: "ABORT_ERR", cause: reason };
    const readErr = await new Promise(resolve => fs.readFile(join(dir, "f.txt"), { signal: aborted }, resolve));
    expect({ name: readErr?.name, code: readErr?.code, cause: readErr?.cause }).toEqual(expected);
    const writeErr = await new Promise(resolve => fs.writeFile(join(dir, "o.txt"), "x", { signal: aborted }, resolve));
    expect({ name: writeErr?.name, code: writeErr?.code, cause: writeErr?.cause }).toEqual(expected);
    const appendErr = await new Promise(resolve =>
      fs.appendFile(join(dir, "o.txt"), "x", { signal: aborted }, resolve),
    );
    expect({ name: appendErr?.name, code: appendErr?.code, cause: appendErr?.cause }).toEqual(expected);
    expect(fs.existsSync(join(dir, "o.txt"))).toBe(false);
  });

  test("values that fail node's shape check still throw ERR_INVALID_ARG_TYPE", async () => {
    const dir = tempDirWithFiles("fs-duck-signal-reject", { "f.txt": "hello" });
    for (const signal of [{}, 42, "x"]) {
      await expectReject(() => fsPromises.readFile(join(dir, "f.txt"), { signal }), { code: "ERR_INVALID_ARG_TYPE" });
      await expectReject(() => fsPromises.writeFile(join(dir, "o.txt"), "x", { signal }), {
        code: "ERR_INVALID_ARG_TYPE",
      });
    }
  });
});
