import { bunEnv, bunExe, isWindows, tempDir, tempDirWithFiles } from "harness";
import { mkfifo } from "mkfifo";
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

// A rejected write makes the writer refuse further writes. Node keeps it
// usable, its writeAll() has no catch:
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/promises.js#L759-L789
// The writer must still give the handle back: end(), endSync(), fail() and the
// disposers behave as in node, and the ref on the handle does not outlive the
// last write in flight.
describe("FileHandle.writer() after a rejected write", () => {
  // A test that fails before it closes its handle must not leave the handle to
  // the collector: that reports the handle as an error in a later test.
  const opened = [];
  async function openHandle(path, flags) {
    const fh = await fsPromises.open(path, flags);
    opened.push(fh);
    return fh;
  }
  afterEach(() => {
    for (const fh of opened.splice(0)) fh.close().catch(() => {});
  });

  // close() takes the descriptor at once only when nothing else holds a ref on
  // the handle, so a ref that the writer kept fails the fd check with no wait.
  async function expectHandleReleased(fh, fd) {
    const closing = fh.close();
    expect(fh.fd).toBe(-1);
    await closing;
    expect(() => fs.fstatSync(fd)).toThrow(expect.objectContaining({ code: "EBADF" }));
  }

  // The signal aborts while the write is in flight: the bytes land and the
  // write rejects with the reason.
  function abortedWrite(w, reason) {
    const ac = new AbortController();
    const pending = w.write("x", { signal: ac.signal });
    ac.abort(reason);
    return pending;
  }

  const terminals = {
    "end()": w => w.end(),
    "endSync()": w => w.endSync(),
    "fail()": w => w.fail(new Error("stop")),
    "[Symbol.asyncDispose]()": w => w[Symbol.asyncDispose](),
    "[Symbol.dispose]()": w => w[Symbol.dispose](),
  };

  // Every write on a read-only handle rejects. On Windows, libuv maps the access error to EBADF too.
  const readOnlyError = { code: "EBADF" };
  const writeOnce = (w, method) => (method === "write" ? w.write("x") : w.writev(["x", "y"]));

  describe.each(["write", "writev"])("%s on a read-only handle", method => {
    describe.each([false, true])("autoClose: %p", autoClose => {
      it.each(Object.keys(terminals))("%s gives the handle back", async terminal => {
        await using dir = tempDir("writer-rejected-write", { "x.txt": "hello" });
        const fh = await openHandle(join(dir, "x.txt"), "r");
        const fd = fh.fd;
        const w = fh.writer({ autoClose });
        await expect(writeOnce(w, method)).rejects.toMatchObject(readOnlyError);
        await terminals[terminal](w);
        if (autoClose) {
          expect(fh.fd).toBe(-1);
        } else {
          // the handle is unlocked
          fh.writer().endSync();
        }
        await expectHandleReleased(fh, fd);
      });
    });

    it("with no terminal call the handle stays locked and can be closed", async () => {
      await using dir = tempDir("writer-rejected-no-terminal", { "x.txt": "hello" });
      const fh = await openHandle(join(dir, "x.txt"), "r");
      const fd = fh.fd;
      const w = fh.writer({ autoClose: true });
      await expect(writeOnce(w, method)).rejects.toMatchObject(readOnlyError);
      // the lock and autoClose wait for end() or fail(), as in node
      expect(fh.fd).toBe(fd);
      expect(() => fh.writer()).toThrow(expect.objectContaining({ code: "ERR_INVALID_STATE" }));
      await expectHandleReleased(fh, fd);
      // a late terminal call finds the handle closed
      expect(await w.end()).toBe(0);
    });
  });

  it("further writes reject with the first error until fail() sets its reason", async () => {
    await using dir = tempDir("writer-rejected-poison", { "x.txt": "hello" });
    const fh = await openHandle(join(dir, "x.txt"), "r");
    const fd = fh.fd;
    const w = fh.writer();
    // two writes in flight: the one that rejects first sets the error
    const errors = [];
    await Promise.all([w.write("x"), w.writev(["y"])].map(p => p.then(expect.unreachable, e => errors.push(e))));
    const [first] = errors;
    expect(first).toMatchObject(readOnlyError);
    await expect(w.write("z")).rejects.toBe(first);
    await expect(w.writev(["z"])).rejects.toBe(first);
    expect([w.writeSync("z"), w.writevSync(["z"])]).toEqual([false, false]);

    const reason = new Error("stop");
    w.fail(reason);
    await expect(w.write("z")).rejects.toBe(reason);
    await expect(w.end()).rejects.toBe(reason);
    expect(w.endSync()).toBe(-1);
    await expectHandleReleased(fh, fd);
  });

  it("end() and endSync() return the bytes written before it", async () => {
    await using dir = tempDir("writer-rejected-count", {});
    for (const terminal of ["end", "endSync"]) {
      const file = join(dir, terminal);
      const fh = await openHandle(file, "w");
      const fd = fh.fd;
      const w = fh.writer({ autoClose: true });
      await w.write("abc");
      const reason = new Error("stop");
      await expect(abortedWrite(w, reason)).rejects.toBe(reason);
      await expect(w.write("y")).rejects.toBe(reason);
      expect([w.writeSync("y"), w.writevSync(["y"])]).toEqual([false, false]);
      expect(terminal === "end" ? await w.end() : w.endSync()).toBe(3);
      // ended: a later write reports the closed writer, as in node
      const closedError = {
        name: "TypeError",
        code: "ERR_INVALID_STATE",
        message: "Invalid state: The writer is closed",
      };
      await expect(w.write("z")).rejects.toMatchObject(closedError);
      await expect(w.writev(["z"])).rejects.toMatchObject(closedError);
      await expectHandleReleased(fh, fd);
      // the aborted write had landed, the refused one was never issued
      expect(fs.readFileSync(file, "utf8")).toBe("abcx");
    }
  });

  it("end() that runs before the write rejects keeps its teardown", async () => {
    await using dir = tempDir("writer-rejected-after-end", {});
    const fh = await openHandle(join(dir, "x.txt"), "w");
    const fd = fh.fd;
    const w = fh.writer({ autoClose: true });
    const reason = new Error("stop");
    const pending = abortedWrite(w, reason);
    const ended = w.end();
    await expect(pending).rejects.toBe(reason);
    expect(await ended).toBe(0);
    expect(fh.fd).toBe(-1);
    expect(() => fs.fstatSync(fd)).toThrow(expect.objectContaining({ code: "EBADF" }));
  });

  it("a close() that already waits settles when the rejected write lands", async () => {
    await using dir = tempDir("writer-rejected-pending-close", {});
    const fh = await openHandle(join(dir, "x.txt"), "w");
    const fd = fh.fd;
    const w = fh.writer({ autoClose: true });
    const reason = new Error("stop");
    const pending = abortedWrite(w, reason);
    const closing = fh.close();
    // the write in flight holds the ref
    expect(fh.fd).toBe(fd);
    // it rejects with its own error, not with one from the release
    await expect(pending).rejects.toBe(reason);
    expect(fh.fd).toBe(-1);
    await closing;
    expect(() => fs.fstatSync(fd)).toThrow(expect.objectContaining({ code: "EBADF" }));
    // a late terminal call finds the handle closed
    w.fail(new Error("late"));
  });

  it("a write in flight beside the rejected one lands in full", async () => {
    await using dir = tempDir("writer-rejected-concurrent", {});
    const file = join(dir, "a.bin");
    const fh = await openHandle(file, "w");
    const w = fh.writer({ start: 0 });
    const big = Buffer.alloc(4 << 20, 65);
    const reason = new Error("stop");
    const first = abortedWrite(w, reason);
    const second = w.write(big);
    // from here the writer's ref is all that keeps the descriptor open
    const closing = fh.close();
    await expect(first).rejects.toBe(reason);
    await second; // must not reject with EBADF
    expect(fs.statSync(file).size).toBe(1 + big.byteLength);
    expect(fh.fd).toBe(-1);
    await closing;
  });

  // A write larger than a pipe stays on the threadpool until the pipe is
  // drained, so the order of the two writes does not depend on timing.
  it.skipIf(isWindows)("keeps its ref until every write in flight has landed", async () => {
    await using dir = tempDir("writer-rejected-in-flight", {});
    const fifo = join(dir, "fifo");
    mkfifo(fifo);
    const fh = await openHandle(fifo, "r+");
    const fd = fh.fd;
    const reader = fs.openSync(fifo, "r");
    try {
      const w = fh.writer();
      const ac = new AbortController();
      const reason = new Error("stop");
      const chunk = Buffer.alloc(65536);
      const big = Buffer.alloc(1 << 20, 66);

      const first = w.write("x", { signal: ac.signal });
      // the first write has landed once its byte can be read back
      let drained = fs.readSync(reader, chunk, 0, 1);
      const second = w.write(big);
      ac.abort(reason);
      await expect(first).rejects.toBe(reason);

      // released now, this close() would take the descriptor from under the second write
      const closing = fh.close();
      const fdWhileInFlight = fh.fd;
      while (drained < 1 + big.byteLength) {
        const n = fs.readSync(reader, chunk);
        if (n === 0) break; // no writer is left, the comparison below reports it
        drained += n;
      }
      await second;
      expect({ fdWhileInFlight, fdAfterLanding: fh.fd, drained }).toEqual({
        fdWhileInFlight: fd,
        fdAfterLanding: -1,
        drained: 1 + big.byteLength,
      });
      await closing;
    } finally {
      fs.closeSync(reader);
    }
  });

  // A full pipe takes a part of the writev. The write of the rest then fails,
  // so the rejection passes both catch arms.
  it.skipIf(isWindows)("a writev that rejects in its write fallback releases once", async () => {
    await using dir = tempDir("writer-rejected-partial", {});
    const fifo = join(dir, "fifo");
    mkfifo(fifo);
    const fh = await openHandle(fifo, fs.constants.O_RDWR | fs.constants.O_NONBLOCK);
    const fd = fh.fd;
    const w = fh.writer();
    const half = Buffer.alloc(1 << 20, 67);
    await expect(w.writev([half, half])).rejects.toMatchObject({ code: "EAGAIN", syscall: "write" });
    // a second release would have closed the handle
    expect(fh.fd).toBe(fd);
    await expectHandleReleased(fh, fd);
  });

  it("a write that rejects with a falsy reason does not fail the writer", async () => {
    await using dir = tempDir("writer-rejected-falsy", {});
    const file = join(dir, "x.txt");
    const fh = await openHandle(file, "w");
    const fd = fh.fd;
    const w = fh.writer();
    expect(
      await abortedWrite(w, 0).then(
        () => "fulfilled",
        e => e,
      ),
    ).toBe(0);
    // the writer keeps its ref, so close() waits for end()
    const closing = fh.close();
    expect(fh.fd).toBe(fd);
    expect(w.writeSync("y")).toBe(true);
    expect(await w.end()).toBe(1);
    expect(fh.fd).toBe(-1);
    await closing;
    expect(fs.readFileSync(file, "utf8")).toBe("xy");
  });

  it("pipeTo() and toWritable() of node:stream/iter give the handle back", async () => {
    await using dir = tempDir("writer-rejected-consumers", { "x.txt": "hello" });
    const script = `
      const { open } = require("node:fs/promises");
      const { pipeTo, from, toWritable } = require("node:stream/iter");
      const settled = p => p.then(v => v ?? "fulfilled", () => "rejected");
      (async () => {
        const out = {};
        {
          // pipeTo() fails the writer when a write rejects
          const fh = await open("x.txt", "r");
          out.pipeTo = [await settled(pipeTo(from("hello"), fh.writer({ autoClose: true }))), fh.fd];
        }
        {
          // with preventFail the caller ends the writer
          const fh = await open("x.txt", "r");
          const w = fh.writer({ autoClose: true });
          out.preventFail = [
            await settled(pipeTo(from("hello"), w, { preventFail: true })),
            await settled(w.end()),
            fh.fd,
          ];
        }
        {
          // the Writable fails the writer when it is destroyed with the error
          const fh = await open("x.txt", "r");
          const writable = toWritable(fh.writer({ autoClose: true }));
          const { promise, resolve } = Promise.withResolvers();
          writable.on("close", resolve);
          let failed;
          writable.write("hello", err => (failed = err instanceof Error));
          await promise;
          out.toWritable = [failed, fh.fd];
        }
        console.log(JSON.stringify(out));
      })();
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--experimental-stream-iter", "--no-warnings", "-e", script],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({
        pipeTo: ["rejected", -1],
        preventFail: ["rejected", 0, -1],
        toWritable: [true, -1],
      }),
      stderr: "",
      exitCode: 0,
    });
  });
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
