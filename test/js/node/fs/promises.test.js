import { bunEnv, bunExe, tempDir, tempDirWithFiles } from "harness";
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

// Node takes any object that has an `aborted` property for a signal:
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/validators.js#L444-L451
describe.concurrent("options.signal of readFile, writeFile and appendFile", () => {
  const refused = received =>
    `ERR_INVALID_ARG_TYPE: The "options.signal" property must be an instance of AbortSignal. Received ${received}`;
  // Node's `new AbortError(undefined, { cause: signal.reason })` has an own `cause`, also for a reason that is undefined.
  const abortedWith = cause => ({
    name: "AbortError",
    code: "ABORT_ERR",
    message: "The operation was aborted",
    cause,
    hasOwnCause: true,
  });
  const describeAbort = error => ({
    name: error.name,
    code: error.code,
    message: error.message,
    cause: error.cause,
    hasOwnCause: Object.hasOwn(error, "cause"),
  });

  const withCallback = start =>
    new Promise((resolve, reject) => start((error, data) => (error ? reject(error) : resolve(data))));
  // `called` runs once `use` has made its call.
  async function withHandle(file, flags, use, called) {
    const handle = await open(file, flags);
    try {
      const pending = use(handle);
      called?.();
      return await pending;
    } finally {
      await handle.close();
    }
  }

  // Every way to the option. Each settles with what the call gives, and rejects with what it throws or reports.
  const forms = {
    "readFileSync": async (file, options) => fs.readFileSync(file, options),
    "writeFileSync": async (file, options, data) => fs.writeFileSync(file, data, options),
    "appendFileSync": async (file, options, data) => fs.appendFileSync(file, data, options),
    "fs.readFile": (file, options) => withCallback(done => fs.readFile(file, options, done)),
    "fs.writeFile": (file, options, data) => withCallback(done => fs.writeFile(file, data, options, done)),
    "fs.appendFile": (file, options, data) => withCallback(done => fs.appendFile(file, data, options, done)),
    "fs.promises.readFile": (file, options) => fsPromises.readFile(file, options),
    "fs.promises.writeFile": (file, options, data) => fsPromises.writeFile(file, data, options),
    "fs.promises.appendFile": (file, options, data) => fsPromises.appendFile(file, data, options),
    "FileHandle#readFile": (file, options, _, called) =>
      withHandle(file, "r", handle => handle.readFile(options), called),
    "FileHandle#writeFile": (file, options, data, called) =>
      withHandle(file, "w", handle => handle.writeFile(data, options), called),
    "FileHandle#appendFile": (file, options, data, called) =>
      withHandle(file, "a", handle => handle.appendFile(data, options), called),
  };
  const all = Object.keys(forms);
  const sync = all.filter(name => name.endsWith("Sync"));
  const async_ = all.filter(name => !name.endsWith("Sync"));
  const reads = name => name.includes("readFile");
  // The test opens the file of these forms itself, which creates it.
  const opensFile = name => name.startsWith("FileHandle");

  // What each form makes of `{ signal }`: what it answers or how it fails, and for a form that writes, what its file
  // holds afterwards. `afterCall` gets the signal once the form has made its call of node:fs.
  async function outcomes(names, makeSignal, afterCall) {
    using dir = tempDir("fs-signal-option", { "read.txt": "hello" });
    const results = {};
    for (const name of names) {
      const file = join(dir, reads(name) ? "read.txt" : `${name.replace(/\W/g, "-")}.txt`);
      const signal = makeSignal();
      const called = () => afterCall?.(signal);
      // A form that opens the file first makes its call later than this line.
      const pending = forms[name](file, { encoding: "utf8", signal }, "data", called);
      if (!opensFile(name)) called();
      const result = await pending.then(
        value => value ?? "done",
        error => (error.code === "ABORT_ERR" ? describeAbort(error) : `${error.code}: ${error.message}`),
      );
      results[name] = reads(name) ? result : [result, fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null];
    }
    return results;
  }
  // The same result from every form: `forRead` from one that reads, `[forWrite, contents of the file]` from one that writes.
  const every = (names, forRead, forWrite, contents) =>
    Object.fromEntries(names.map(name => [name, reads(name) ? forRead : [forWrite, contents(name)]]));

  // What happy-dom makes: a class of its own over EventTarget, with the state in own properties.
  class OtherSignal extends EventTarget {
    aborted = false;
    reason = null;
    abort(reason) {
      this.aborted = true;
      this.reason = reason;
    }
  }
  function otherSignalAbortedWith(reason) {
    const signal = new OtherSignal();
    signal.abort(reason);
    return signal;
  }

  test.each([
    ["0", 0, "type number (0)"],
    ["false", false, "type boolean (false)"],
    ["'x'", "x", "type string ('x')"],
    ["a symbol", Symbol("s"), "type symbol (Symbol(s))"],
    ["a function that has `aborted`", Object.assign(function f() {}, { aborted: false }), "function f"],
    ["{}", {}, "an instance of Object"],
    ["[]", [], "an instance of Array"],
    ["an AbortController", new AbortController(), "an instance of AbortController"],
    ["an EventTarget", new EventTarget(), "an instance of EventTarget"],
  ])("%s is no signal, and nothing is read or written", async (_, signal, received) => {
    expect(await outcomes(all, () => signal)).toEqual(
      every(all, refused(received), refused(received), name => (opensFile(name) ? "" : null)),
    );
  });

  test("fs.readFile, fs.writeFile and fs.appendFile throw for a value that is no signal", () => {
    using dir = tempDir("fs-signal-option-throws", { "read.txt": "hello" });
    const calls = [];
    const callback = (...args) => calls.push(args);
    const message = refused("an instance of Object").slice("ERR_INVALID_ARG_TYPE: ".length);
    expect(() => fs.readFile(join(dir, "read.txt"), { signal: {} }, callback)).toThrow(message);
    expect(() => fs.writeFile(join(dir, "write.txt"), "data", { signal: {} }, callback)).toThrow(message);
    expect(() => fs.appendFile(join(dir, "append.txt"), "data", { signal: {} }, callback)).toThrow(message);
    expect(calls).toEqual([]);
  });

  test("undefined is no signal at all", async () => {
    expect(await outcomes(all, () => undefined)).toEqual(every(all, "hello", "done", () => "data"));
  });

  // Bun only. Node throws ERR_INVALID_ARG_TYPE for both: only undefined is no signal there.
  test.each([
    ["null", null],
    ["''", ""],
  ])("%s is no signal either", async (_, signal) => {
    expect(await outcomes(all, () => signal)).toEqual(every(all, "hello", "done", () => "data"));
  });

  // Node's sync forms check the signal and never read it.
  test.each([
    ["{ aborted: false }", () => ({ aborted: false })],
    ["{ aborted: true }", () => ({ aborted: true })],
    ["an object that inherits `aborted`", () => Object.create({ aborted: true })],
    [
      "an object with a getter that throws",
      () => ({
        get aborted() {
          throw new Error("the sync forms do not read `aborted`");
        },
      }),
    ],
    ["a signal of another class", () => otherSignalAbortedWith("never read")],
    ["a Proxy of an AbortSignal", () => new Proxy(AbortSignal.abort(), {})],
    ["an object over AbortSignal.prototype", () => Object.create(AbortSignal.prototype)],
    ["an aborted AbortSignal", () => AbortSignal.abort()],
  ])("the sync forms take %s and do the I/O", async (_, makeSignal) => {
    expect(await outcomes(sync, makeSignal)).toEqual(every(sync, "hello", "done", () => "data"));
  });

  // Node judges `aborted` by its truthiness.
  test.each([
    ["{ aborted: false }", () => ({ aborted: false })],
    ["{ aborted: 0 }", () => ({ aborted: 0 })],
    ["{ aborted: undefined }", () => ({ aborted: undefined })],
    ["an object that inherits `aborted`", () => Object.create({ aborted: false })],
    ["a signal of another class", () => new OtherSignal()],
  ])("the async forms take %s and do the I/O", async (_, makeSignal) => {
    expect(await outcomes(async_, makeSignal)).toEqual(every(async_, "hello", "done", () => "data"));
  });

  test.each([
    ["{ aborted: true }", () => ({ aborted: true }), undefined],
    ["{ aborted: 1 }", () => ({ aborted: 1 }), undefined],
    ["{ aborted: true, reason }", () => ({ aborted: true, reason: "why" }), "why"],
    ["an object that inherits `aborted`", () => Object.create({ aborted: true, reason: "inherited" }), "inherited"],
    ["a signal of another class", () => otherSignalAbortedWith("stop"), "stop"],
  ])("the async forms give AbortError for %s that is aborted before the call", async (_, makeSignal, cause) => {
    expect(await outcomes(async_, makeSignal)).toEqual(
      every(async_, abortedWith(cause), abortedWith(cause), name => (opensFile(name) ? "" : null)),
    );
  });

  // The signal is asked again when the operation completes, as an AbortSignal is. What is on disk by then is not part
  // of the answer.
  test("the async forms give AbortError for a signal that is aborted once the call has returned", async () => {
    const results = await outcomes(
      async_,
      () => new OtherSignal(),
      signal => signal.abort("later"),
    );
    expect(
      Object.fromEntries(Object.entries(results).map(([name, result]) => [name, reads(name) ? result : result[0]])),
    ).toEqual(Object.fromEntries(async_.map(name => [name, abortedWith("later")])));
  });

  // `aborted` is read before the operation is scheduled and when it completes. `reason` is read where `aborted` is truthy.
  test("what the async forms read of a signal, and an error that one of its getters throws", async () => {
    using dir = tempDir("fs-signal-option-getter", { "read.txt": "hello" });
    const file = join(dir, "read.txt");
    // `aborted` is true from its read number `abortedFrom` on. A getter throws at its read number `throwsAt`.
    function recording({ abortedFrom = Infinity, abortedThrowsAt = 0, reasonThrowsAt = 0 }) {
      const reads = [];
      const count = name => reads.filter(read => read === name).length;
      return {
        reads,
        get aborted() {
          reads.push("aborted");
          if (count("aborted") === abortedThrowsAt) throw new Error(`aborted, read ${abortedThrowsAt}`);
          return count("aborted") >= abortedFrom;
        },
        get reason() {
          reads.push("reason");
          if (count("reason") === reasonThrowsAt) throw new Error(`reason, read ${reasonThrowsAt}`);
          return "the reason";
        },
      };
    }
    const settled = (signal, pending) =>
      pending.then(
        value => [value, signal.reads],
        error => [error.code === "ABORT_ERR" ? describeAbort(error) : error.message, signal.reads],
      );
    const withPromise = signal => settled(signal, fsPromises.readFile(file, { encoding: "utf8", signal }));
    const withCallbackOf = signal =>
      settled(
        signal,
        withCallback(done => fs.readFile(file, { encoding: "utf8", signal }, done)),
      );

    const calls = [];
    const callback = (...args) => calls.push(args);
    expect(() => fs.readFile(file, { signal: recording({ abortedThrowsAt: 1 }) }, callback)).toThrow("aborted, read 1");
    expect(() => fs.readFile(file, { signal: recording({ abortedFrom: 1, reasonThrowsAt: 1 }) }, callback)).toThrow(
      "reason, read 1",
    );
    expect(calls).toEqual([]);

    expect({
      neverAborted: await withPromise(recording({ reasonThrowsAt: 1 })),
      abortedBeforeTheCall: await withPromise(recording({ abortedFrom: 1 })),
      abortedAtTheEnd: await withPromise(recording({ abortedFrom: 2 })),
      abortedThrowsBeforeTheCall: await withPromise(recording({ abortedThrowsAt: 1 })),
      abortedThrowsAtTheEnd: await withPromise(recording({ abortedThrowsAt: 2 })),
      reasonThrowsBeforeTheCall: await withPromise(recording({ abortedFrom: 1, reasonThrowsAt: 1 })),
      reasonThrowsAtTheEnd: await withPromise(recording({ abortedFrom: 2, reasonThrowsAt: 1 })),
      // Bun only, these two: Node raises what a getter throws at the end of fs.readFile as an uncaught exception.
      callbackAbortedThrowsAtTheEnd: await withCallbackOf(recording({ abortedThrowsAt: 2 })),
      callbackReasonThrowsAtTheEnd: await withCallbackOf(recording({ abortedFrom: 2, reasonThrowsAt: 1 })),
    }).toEqual({
      neverAborted: ["hello", ["aborted", "aborted"]],
      abortedBeforeTheCall: [abortedWith("the reason"), ["aborted", "reason"]],
      abortedAtTheEnd: [abortedWith("the reason"), ["aborted", "aborted", "reason"]],
      abortedThrowsBeforeTheCall: ["aborted, read 1", ["aborted"]],
      abortedThrowsAtTheEnd: ["aborted, read 2", ["aborted", "aborted"]],
      reasonThrowsBeforeTheCall: ["reason, read 1", ["aborted", "reason"]],
      reasonThrowsAtTheEnd: ["reason, read 1", ["aborted", "aborted", "reason"]],
      callbackAbortedThrowsAtTheEnd: ["aborted, read 2", ["aborted", "aborted"]],
      callbackReasonThrowsAtTheEnd: ["reason, read 1", ["aborted", "aborted", "reason"]],
    });
  });

  // The arguments pin their buffers while the operation runs: transfer() of a pinned buffer does not detach it.
  // The getters of the signal are code of the program. At the end they run once the arguments are dropped.
  test("the buffers of a call are pinned at the first read of `aborted`, and free at the last", async () => {
    using dir = tempDir("fs-signal-option-pinned", { "read.txt": "hello" });
    // Not Buffer.from(): that can be a slice of the pool.
    const bytesOf = text => {
      const bytes = new Uint8Array(new ArrayBuffer(Buffer.byteLength(text)));
      bytes.set(Buffer.from(text));
      return bytes;
    };
    async function detachedAtEachRead(name, start) {
      const buffers = [bytesOf(join(dir, name)), bytesOf("data")];
      const log = [];
      const detached = getter => {
        for (const { buffer } of buffers) if (!buffer.detached) buffer.transfer();
        log.push([getter, ...buffers.map(({ buffer }) => buffer.detached)]);
      };
      const signal = {
        reads: 0,
        get aborted() {
          detached("aborted");
          return ++this.reads === 2;
        },
        get reason() {
          detached("reason");
        },
      };
      const code = await start(buffers[0], buffers[1], signal).then(
        () => "done",
        error => error.code,
      );
      return [code, ...log];
    }
    const pinnedThenFree = ["ABORT_ERR", ["aborted", false, false], ["aborted", true, true], ["reason", true, true]];
    expect({
      "fs.promises.writeFile": await detachedAtEachRead("write.txt", (path, data, signal) =>
        fsPromises.writeFile(path, data, { signal }),
      ),
      "fs.promises.appendFile": await detachedAtEachRead("append.txt", (path, data, signal) =>
        fsPromises.appendFile(path, data, { signal }),
      ),
      "fs.writeFile": await detachedAtEachRead("callback.txt", (path, data, signal) =>
        withCallback(done => fs.writeFile(path, data, { signal }, done)),
      ),
      // No data: the second buffer is not an argument, so the first transfer() detaches it.
      "fs.promises.readFile": await detachedAtEachRead("read.txt", (path, _, signal) =>
        fsPromises.readFile(path, { signal }),
      ),
    }).toEqual({
      "fs.promises.writeFile": pinnedThenFree,
      "fs.promises.appendFile": pinnedThenFree,
      "fs.writeFile": pinnedThenFree,
      "fs.promises.readFile": ["ABORT_ERR", ["aborted", false, true], ["aborted", true, true], ["reason", true, true]],
    });
    expect(fs.readFileSync(join(dir, "write.txt"), "utf8")).toBe("data");
  });

  // The signal is GC-protected from the parse of the call to the end of the operation, whichever way it ends.
  test("a signal that is no AbortSignal is protected while its operation is pending, and no longer", async () => {
    using dir = tempDir("fs-signal-option-protected", {
      "read.txt": "hello",
      "count.js": `
        const { heapStats } = require("bun:jsc");
        const fs = require("node:fs");
        const path = require("node:path");
        // No other object of this class is protected.
        class Foreign extends EventTarget {
          aborted = false;
        }
        const protectedSignals = () => (Bun.gc(true), heapStats().protectedObjectTypeCounts.EventTarget ?? 0);
        const file = path.join(__dirname, "read.txt");
        const cases = {
          resolves: signal => fs.promises.readFile(file, { signal }),
          rejects: signal => fs.promises.readFile(file + ".missing", { signal }),
          abortedAtTheEnd: signal => {
            const pending = fs.promises.readFile(file, { signal });
            signal.aborted = true;
            return pending;
          },
          abortedBeforeTheCall: signal => fs.promises.readFile(file, { signal: Object.assign(signal, { aborted: true }) }),
          callsBack: signal => new Promise(resolve => fs.writeFile(file + ".out", "data", { signal }, resolve)),
          refusedAfterTheSignal: signal => fs.promises.writeFile(file + ".out", {}, { signal }),
        };
        (async () => {
          const counts = {};
          for (const [name, start] of Object.entries(cases)) {
            const pending = [];
            for (let i = 0; i < 50; i++) pending.push(start(new Foreign()).catch(() => {}));
            const whilePending = protectedSignals();
            await Promise.all(pending);
            counts[name] = [whilePending, protectedSignals()];
          }
          console.log(JSON.stringify(counts));
        })();
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "count.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      resolves: [50, 0],
      rejects: [50, 0],
      abortedAtTheEnd: [50, 0],
      abortedBeforeTheCall: [0, 0],
      callsBack: [50, 0],
      refusedAfterTheSignal: [0, 0],
    });
    expect(exitCode).toBe(0);
  });

  // Iterable data does not reach the binding: fs.promises.writeFile checks the signal itself.
  test("fs.promises.writeFile has the same rule for iterable data", async () => {
    using dir = tempDir("fs-signal-option-iterable", {});
    const write = (name, data, options) =>
      fsPromises.writeFile(join(dir, name), data, options).then(
        () => fs.readFileSync(join(dir, name), "utf8"),
        error => [error.code === "ABORT_ERR" ? describeAbort(error) : error.message, fs.existsSync(join(dir, name))],
      );
    const refusedAs = received => [refused(received).slice("ERR_INVALID_ARG_TYPE: ".length), false];
    expect({
      number: await write("number.txt", ["a", "b"], { signal: 1 }),
      object: await write("object.txt", ["a", "b"], { signal: {} }),
      function: await write("function.txt", ["a", "b"], { signal: Object.assign(function f() {}, { aborted: false }) }),
      // The same sentence as for a string.
      numberForString: await write("string.txt", "ab", { signal: 1 }),
      // The encoding is checked first, as in Node.
      numberAndEncoding: await write("encoding.txt", ["a", "b"], { signal: 1, encoding: "nope" }),
      notAborted: await write("not-aborted.txt", ["a", "b"], { signal: { aborted: false } }),
      aborted: await write("aborted.txt", ["a", "b"], { signal: { aborted: true } }),
      // Bun only, these two: Node throws ERR_INVALID_ARG_TYPE for a signal that is null or "".
      null: await write("null.txt", ["a", "b"], { signal: null }),
      empty: await write("empty.txt", ["a", "b"], { signal: "" }),
    }).toEqual({
      number: refusedAs("type number (1)"),
      object: refusedAs("an instance of Object"),
      function: refusedAs("function f"),
      numberForString: refusedAs("type number (1)"),
      numberAndEncoding: ["Unknown encoding: nope", false],
      notAborted: "ab",
      aborted: [abortedWith(undefined), false],
      null: "ab",
      empty: "ab",
    });
  });

  test("FileHandle#appendFile takes the signal", async () => {
    using dir = tempDir("fs-signal-option-append", { "file.txt": "seed" });
    const file = join(dir, "file.txt");
    const signal = AbortSignal.abort();
    const error = await withHandle(file, "a", handle => handle.appendFile("data", { signal })).catch(error => error);
    expect(describeAbort(error)).toEqual(abortedWith(signal.reason));
    expect(fs.readFileSync(file, "utf8")).toBe("seed");
  });

  // Bun only: as fs.promises.appendFile does, it rejects for a signal that is aborted while the append runs, and the
  // data may be in the file. Node resolves for data of one chunk.
  test("FileHandle#appendFile rejects for an AbortSignal that is aborted once the call has returned", async () => {
    using dir = tempDir("fs-signal-option-append-later", { "file.txt": "seed" });
    const controller = new AbortController();
    const error = await withHandle(join(dir, "file.txt"), "a", handle => {
      const pending = handle.appendFile("data", { signal: controller.signal });
      controller.abort();
      return pending;
    }).catch(error => error);
    expect(describeAbort(error)).toEqual(abortedWith(controller.signal.reason));
  });

  // `bun test` with the happy-dom environment makes the AbortController of the window the global one. The package here
  // has only that class, shaped as happy-dom 17 has it: the real one takes seconds to load in a debug build.
  test("the signal of the AbortController that the happy-dom environment puts on the global object", async () => {
    using dir = tempDir("fs-signal-option-happy-dom", {
      "node_modules/happy-dom/package.json": JSON.stringify({ name: "happy-dom", main: "index.js" }),
      "node_modules/happy-dom/index.js": `
        // The window has no Event and no EventTarget to take the place of Bun's.
        const { Event, EventTarget } = globalThis;
        exports.Window = class Window {
          document = { body: {}, defaultView: this };
          happyDOM = { async abort() {} };
          close() {}
          AbortSignal = class AbortSignal extends EventTarget {
            aborted = false;
            reason = null;
          };
          AbortController = (window =>
            class AbortController {
              signal = new window.AbortSignal();
              abort(reason) {
                this.signal.reason = reason;
                this.signal.aborted = true;
                this.signal.dispatchEvent(new Event("abort"));
              }
            })(this);
        };
      `,
      // `bun test` looks for the name of the comment in the whole text of a test file, this one too.
      "signal.test.js": `// ${"@vitest" + "-environment"} happy-dom
        import { expect, test } from "bun:test";
        import fs from "node:fs";
        import { join } from "node:path";

        test("readFile, writeFile and appendFile", async () => {
          const controller = new AbortController();
          const { signal } = controller;
          expect(signal).toBeInstanceOf(window.AbortSignal);
          const file = join(import.meta.dir, "file.txt");

          fs.writeFileSync(file, "a", { signal });
          await fs.promises.appendFile(file, "b", { signal });
          await new Promise((resolve, reject) =>
            fs.appendFile(file, "c", { signal }, error => (error ? reject(error) : resolve())),
          );
          expect([
            fs.readFileSync(file, { encoding: "utf8", signal }),
            await fs.promises.readFile(file, { encoding: "utf8", signal }),
          ]).toEqual(["abc", "abc"]);

          controller.abort("stop");
          const error = await fs.promises.writeFile(file, "d", { signal }).catch(error => error);
          expect({ name: error.name, code: error.code, cause: error.cause }).toEqual({
            name: "AbortError",
            code: "ABORT_ERR",
            cause: "stop",
          });
          expect(fs.readFileSync(file, "utf8")).toBe("abc");
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: String(dir),
      env: { ...bunEnv, NODE_PATH: undefined },
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(" 1 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });
});
