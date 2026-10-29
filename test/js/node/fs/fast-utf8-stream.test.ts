import { afterEach, describe, expect, it } from "bun:test";
import { tempDir } from "harness";
import { once, type EventEmitter } from "node:events";
import fs, { openSync, readFileSync } from "node:fs";
import path from "node:path";

interface Utf8Stream extends EventEmitter {
  write(data: string | Buffer): boolean;
  flush(callback?: (err?: Error | null) => void): void;
  flushSync(): void;
  reopen(file?: string): void;
  end(): void;
  destroy(): void;
}

type Held = {
  args: any[];
  /** Makes the real call. */
  run(): void;
  /** Calls back without the real call. */
  finish(err?: Error | null, value?: unknown): void;
};

describe("fs.Utf8Stream", () => {
  // A test that an uncaught exception fails never reaches its own cleanup.
  const streams: Utf8Stream[] = [];
  afterEach(() => {
    for (const stream of streams.splice(0)) {
      stream.on("error", () => {});
      stream.destroy();
    }
  });

  function utf8Stream(options: Record<string, unknown>): Utf8Stream {
    const stream: Utf8Stream = new (fs as any).Utf8Stream(options);
    streams.push(stream);
    return stream;
  }

  /** Stands in for one asynchronous function of `options.fs`. A call completes only when the test says so. */
  function held(name: "open" | "write" | "fsync" | "close") {
    const calls: Held[] = [];
    let arrived = Promise.withResolvers<void>();
    function fn(...args: any[]) {
      const callback = args.pop();
      calls.push({
        args,
        run: () => (fs[name] as Function)(...args, callback),
        finish: (err, value) => callback(err ?? null, value),
      });
      arrived.resolve();
      arrived = Promise.withResolvers<void>();
    }
    /** Resolves when the stream has made `count` calls. */
    async function called(count: number) {
      while (calls.length < count) await arrived.promise;
    }
    return { fn, calls, called };
  }

  async function close(stream: Utf8Stream) {
    const closed = once(stream, "close");
    stream.destroy();
    await closed;
  }

  const chunk = (contentMode: string, text: string) => (contentMode === "buffer" ? Buffer.from(text) : text);
  const ioError = () => Object.assign(new Error("EIO"), { code: "EIO" });
  const turn = () => new Promise<void>(resolve => setImmediate(resolve));

  // https://github.com/nodejs/node/pull/63833
  describe("contentMode 'buffer'", () => {
    it.each([true, false])("writes every chunk (sync: %p)", async sync => {
      using dir = tempDir("utf8stream-buffer", {});
      const dest = path.join(String(dir), "out.log");
      const stream = utf8Stream({ fd: openSync(dest, "w"), sync, contentMode: "buffer" });

      expect(stream.write(Buffer.from("hello world\n"))).toBe(true);
      expect(stream.write(Buffer.from("something else\n"))).toBe(true);
      const closed = once(stream, "close");
      stream.end();
      await closed;
      expect(readFileSync(dest, "utf8")).toBe("hello world\nsomething else\n");
    });

    it("keeps a chunk that stays below minLength", async () => {
      using dir = tempDir("utf8stream-buffer-minlength", {});
      const dest = path.join(String(dir), "out.log");
      const stream = utf8Stream({ fd: openSync(dest, "w"), sync: true, contentMode: "buffer", minLength: 4096 });

      stream.write(Buffer.from("hello\n"));
      stream.write(Buffer.from("world\n"));
      stream.flushSync();
      expect(readFileSync(dest, "utf8")).toBe("hello\nworld\n");
      await close(stream);
    });

    it("keeps the chunk that starts a new group at maxWrite", async () => {
      using dir = tempDir("utf8stream-buffer-maxwrite", {});
      const dest = path.join(String(dir), "out.log");
      // The first 6 bytes stay below minLength. The second write takes the group past maxWrite.
      const stream = utf8Stream({
        fd: openSync(dest, "w"),
        sync: true,
        contentMode: "buffer",
        minLength: 7,
        maxWrite: 8,
      });

      stream.write(Buffer.from("aaaaaa"));
      stream.write(Buffer.from("bbbbbb"));
      stream.write(Buffer.from("cccccc"));
      stream.flushSync();
      expect(readFileSync(dest, "utf8")).toBe("aaaaaabbbbbbcccccc");
      await close(stream);
    });

    it("flushSync() writes every group after a write fails", async () => {
      using dir = tempDir("utf8stream-buffer-flushsync", {});
      const dest = path.join(String(dir), "out.log");
      let fail = true;
      const stream = utf8Stream({
        fd: openSync(dest, "w"),
        sync: true,
        contentMode: "buffer",
        maxWrite: 64,
        fs: {
          writeSync(fd: number, data: Buffer) {
            if (fail) throw ioError();
            return fs.writeSync(fd, data);
          },
        },
      });
      const errors: string[] = [];
      stream.on("error", err => errors.push(err.code));

      // The failed write keeps the 20 bytes of "a". The next writes queue a group of 60 bytes and a group of 40.
      for (const fill of "acccdd") stream.write(Buffer.alloc(20, fill));
      expect(errors).toEqual(["EIO", "EIO", "EIO", "EIO", "EIO", "EIO"]);
      fail = false;
      stream.flushSync();
      expect(readFileSync(dest, "latin1")).toBe(
        Buffer.alloc(20, "a").toString() + Buffer.alloc(60, "c").toString() + Buffer.alloc(40, "d").toString(),
      );
      await close(stream);
    });
  });

  describe("periodicFlush", () => {
    const period = 1;

    // The stream's interval is unref'd. A ref'd timer keeps the event loop turning while a test awaits a tick.
    function keepAlive() {
      const timer = setInterval(() => {}, period);
      return { [Symbol.dispose]: () => clearInterval(timer) };
    }

    // Resolves after `count` turns of an interval with the stream's period.
    function ticks(count: number) {
      const { promise, resolve } = Promise.withResolvers<void>();
      const timer = setInterval(() => {
        if (--count > 0) return;
        clearInterval(timer);
        resolve();
      }, period);
      return promise;
    }

    it.each([
      ["utf8", true],
      ["utf8", false],
      ["buffer", true],
      ["buffer", false],
    ])("writes the buffered data (contentMode: %s, sync: %p)", async (contentMode, sync) => {
      using _ = keepAlive();
      using dir = tempDir("utf8stream-periodic", {});
      const dest = path.join(String(dir), "out.log");
      const stream = utf8Stream({
        fd: openSync(dest, "w"),
        sync,
        contentMode,
        minLength: 4096,
        periodicFlush: period,
      });

      const drained = once(stream, "drain");
      stream.write(chunk(contentMode, "hello\n"));
      expect(readFileSync(dest, "utf8")).toBe("");
      await drained;
      expect(readFileSync(dest, "utf8")).toBe("hello\n");
      await close(stream);
    });

    // https://github.com/nodejs/node/pull/66473
    it("syncs the file once per flush and skips the ticks of a flush in progress", async () => {
      using _ = keepAlive();
      using dir = tempDir("utf8stream-periodic-fsync", {});
      const dest = path.join(String(dir), "out.log");
      const fsync = held("fsync");
      const stream = utf8Stream({
        fd: openSync(dest, "w"),
        minLength: 4096,
        periodicFlush: period,
        fs: { fsync: fsync.fn },
      });
      let writes = 0;
      stream.on("write", () => writes++);

      stream.write("hello\n");
      await fsync.called(1);
      expect(readFileSync(dest, "utf8")).toBe("hello\n");

      // The first flush waits for its fsync. A tick that starts another flush writes again.
      await ticks(5);
      expect({
        fsyncCalls: fsync.calls.length,
        writes,
        drainListeners: stream.listenerCount("drain"),
        errorListeners: stream.listenerCount("error"),
      }).toEqual({ fsyncCalls: 1, writes: 1, drainListeners: 0, errorListeners: 0 });

      fsync.calls[0].run();
      await fsync.called(2);
      expect(writes).toBe(2);

      const closed = once(stream, "close");
      stream.destroy();
      await fsync.called(3);
      for (const call of fsync.calls.slice(1)) call.run();
      await closed;
    });

    it("skips the ticks of a flush that waits for its write", async () => {
      using _ = keepAlive();
      using dir = tempDir("utf8stream-periodic-write", {});
      const dest = path.join(String(dir), "out.log");
      const write = held("write");
      let fsyncCalls = 0;
      const stream = utf8Stream({
        fd: openSync(dest, "w"),
        minLength: 4096,
        periodicFlush: period,
        fs: {
          write: write.fn,
          fsync(fd: number, callback: () => void) {
            fsyncCalls++;
            fs.fsync(fd, callback);
          },
        },
      });

      stream.write("hello\n");
      await write.called(1);
      await ticks(5);
      expect({ writes: write.calls.length, errorListeners: stream.listenerCount("error") }).toEqual({
        writes: 1,
        errorListeners: 1,
      });

      const drained = once(stream, "drain");
      write.calls[0].run();
      await drained;
      expect(fsyncCalls).toBe(1);
      expect(readFileSync(dest, "utf8")).toBe("hello\n");
      await close(stream);
    });

    it("gives a write error to the flush, and the next tick writes again", async () => {
      using _ = keepAlive();
      using dir = tempDir("utf8stream-periodic-error", {});
      const dest = path.join(String(dir), "out.log");
      const write = held("write");
      const stream = utf8Stream({
        fd: openSync(dest, "w"),
        minLength: 4096,
        periodicFlush: period,
        fs: { write: write.fn },
      });

      stream.write("hello\n");
      await write.called(1);
      // The stream has no 'error' listener of its own.
      write.calls[0].finish(ioError());
      expect(stream.eventNames()).toEqual(["newListener"]);

      await write.called(2);
      const drained = once(stream, "drain");
      write.calls[1].run();
      await drained;
      expect(readFileSync(dest, "utf8")).toBe("hello\n");
      await close(stream);
    });
  });

  // https://github.com/nodejs/node/pull/66473
  describe("flush()", () => {
    it.each(["utf8", "buffer"])("waits for the file to open (contentMode: %s)", async contentMode => {
      using dir = tempDir("utf8stream-flush-open", {});
      const dest = path.join(String(dir), "out.log");
      const open = held("open");
      const stream = utf8Stream({ dest, contentMode, fs: { open: open.fn } });

      const flushed = Promise.withResolvers<Error | null | undefined>();
      stream.flush(flushed.resolve);
      const opened = once(stream, "ready");
      let settled = false;
      flushed.promise.then(() => (settled = true));
      await turn();
      expect(settled).toBe(false);

      open.calls[0].run();
      await opened;
      expect(await flushed.promise).toBeNull();

      stream.write(chunk(contentMode, "hello\n"));
      const closed = once(stream, "close");
      stream.end();
      await closed;
      expect(readFileSync(dest, "utf8")).toBe("hello\n");
    });

    it.each(["utf8", "buffer"])("waits for the write in flight, then syncs (contentMode: %s)", async contentMode => {
      using dir = tempDir("utf8stream-flush-inflight", {});
      const dest = path.join(String(dir), "out.log");
      const write = held("write");
      const log: string[] = [];
      const stream = utf8Stream({
        fd: openSync(dest, "w"),
        contentMode,
        fs: {
          write: write.fn,
          fsync(fd: number, callback: () => void) {
            log.push("fsync");
            fs.fsync(fd, callback);
          },
        },
      });

      stream.write(chunk(contentMode, "hello\n"));
      const flushed = Promise.withResolvers<void>();
      stream.flush(() => {
        log.push(`flushed ${JSON.stringify(readFileSync(dest, "utf8"))}`);
        flushed.resolve();
      });
      expect(log).toEqual([]);

      write.calls[0].run();
      await flushed.promise;
      expect(log).toEqual(["fsync", 'flushed "hello\\n"']);
      await close(stream);
    });

    it.each(["utf8", "buffer"])("writes what a failed write left (contentMode: %s)", async contentMode => {
      using dir = tempDir("utf8stream-flush-retry", {});
      const dest = path.join(String(dir), "out.log");
      const write = held("write");
      const stream = utf8Stream({ fd: openSync(dest, "w"), contentMode, fs: { write: write.fn } });
      const errors: string[] = [];
      stream.on("error", err => errors.push(err.code));

      stream.write(chunk(contentMode, "hello\n"));
      write.calls[0].finish(ioError());
      expect(errors).toEqual(["EIO"]);

      const flushed = Promise.withResolvers<Error | null | undefined>();
      stream.flush(flushed.resolve);
      expect(write.calls.length).toBe(2);
      write.calls[1].run();
      expect(await flushed.promise).toBeNull();
      expect(readFileSync(dest, "utf8")).toBe("hello\n");
      await close(stream);
    });

    it("calls back once when fsync calls back and then throws", async () => {
      using dir = tempDir("utf8stream-flush-once", {});
      const dest = path.join(String(dir), "out.log");
      const stream = utf8Stream({
        fd: openSync(dest, "w"),
        minLength: 4096,
        fs: {
          fsync(_fd: number, callback: () => void) {
            callback();
            throw new Error("after the callback");
          },
        },
      });

      const results: unknown[] = [];
      const drained = once(stream, "drain");
      stream.write("hello\n");
      stream.flush(err => results.push(err ?? null));
      await drained;
      expect(results).toEqual([null]);
      await close(stream);
    });

    it("a callback that throws inside the write's completion does not stop later flushes", async () => {
      using dir = tempDir("utf8stream-flush-throw", {});
      const dest = path.join(String(dir), "out.log");
      let thrown: unknown;
      // With fsync: true a flush completes without a call to fs.fsync, inside the write's completion.
      const stream = utf8Stream({
        fd: openSync(dest, "w"),
        minLength: 4096,
        fsync: true,
        fs: {
          write(_fd: number, data: string, _encoding: string, callback: (err: null, written: number) => void) {
            try {
              callback(null, data.length);
            } catch (err) {
              thrown = err;
            }
          },
          fsyncSync() {},
        },
      });

      stream.write("a");
      stream.flush(() => {
        throw new Error("from the callback");
      });
      expect(thrown).toMatchObject({ message: "from the callback" });

      const results: unknown[] = [];
      stream.write("b");
      stream.flush(err => results.push(err ?? null));
      expect(results).toEqual([null]);
      await close(stream);
    });
  });

  // https://github.com/nodejs/node/pull/66473
  describe("end()", () => {
    it("waits for the flush, and closes when its callback throws", async () => {
      using dir = tempDir("utf8stream-end-flush", {});
      const dest = path.join(String(dir), "out.log");
      const fsync = held("fsync");
      const stream = utf8Stream({ fd: openSync(dest, "w"), minLength: 4096, fs: { fsync: fsync.fn } });
      const events: string[] = [];
      stream.on("finish", () => events.push("finish"));
      stream.on("close", () => events.push("close"));

      stream.write("hello\n");
      stream.flush(() => {
        events.push("flushed");
        throw new Error("from the callback");
      });
      stream.end();
      await fsync.called(1);
      expect(events).toEqual([]);

      expect(() => fsync.calls[0].finish()).toThrow("from the callback");
      const closed = once(stream, "close");
      await fsync.called(2);
      fsync.calls[1].run();
      await closed;
      expect(events).toEqual(["flushed", "finish", "close"]);
      expect(readFileSync(dest, "utf8")).toBe("hello\n");
    });

    it.each([
      ["once, after every pending flush", false, ["wrote 6", "first flush", "second flush", "close starts"]],
      [
        "after the data that a flush callback writes",
        true,
        ["wrote 6", "first flush", "second flush", "wrote 5", "close starts"],
      ],
    ])("closes %s", async (_name, writeMore, expected) => {
      using dir = tempDir("utf8stream-end-flushes", {});
      const dest = path.join(String(dir), "out.log");
      const log: string[] = [];
      // With fsync: true only the close calls fs.fsync.
      const stream = utf8Stream({
        fd: openSync(dest, "w"),
        minLength: 4096,
        fsync: true,
        fs: {
          fsync(fd: number, callback: () => void) {
            log.push("close starts");
            fs.fsync(fd, callback);
          },
        },
      });
      stream.on("write", written => log.push(`wrote ${written}`));

      stream.write("hello\n");
      stream.flush(() => log.push("first flush"));
      stream.flush(() => {
        log.push("second flush");
        if (writeMore) stream.write("more\n");
      });
      const closed = once(stream, "close");
      stream.end();
      await closed;
      expect(log).toEqual(expected);
      expect(readFileSync(dest, "utf8")).toBe(writeMore ? "hello\nmore\n" : "hello\n");
    });

    it("keeps a write that starts while the flush syncs", async () => {
      using dir = tempDir("utf8stream-end-write", {});
      const dest = path.join(String(dir), "out.log");
      const write = held("write");
      const fsync = held("fsync");
      const stream = utf8Stream({ fd: openSync(dest, "w"), fs: { write: write.fn, fsync: fsync.fn } });

      stream.write("a");
      stream.flush();
      stream.end();
      write.calls[0].run();
      await fsync.called(1);

      expect(stream.write("b")).toBe(true);
      expect(write.calls.length).toBe(2);
      fsync.calls[0].finish();
      expect(write.calls.length).toBe(2);

      const closed = once(stream, "close");
      write.calls[1].run();
      await fsync.called(2);
      fsync.calls[1].run();
      await closed;
      expect(readFileSync(dest, "utf8")).toBe("ab");
    });

    it("closes when an 'error' listener calls it while a flush waits", async () => {
      using dir = tempDir("utf8stream-end-error", {});
      const dest = path.join(String(dir), "out.log");
      const write = held("write");
      const stream = utf8Stream({ fd: openSync(dest, "w"), minLength: 4096, fs: { write: write.fn } });
      stream.on("error", () => stream.end());

      const results: unknown[] = [];
      stream.flush(err => results.push(err ?? null));
      write.calls[0].finish(ioError());
      await once(stream, "close");
      expect(results).toEqual([null]);
    });
  });

  // https://github.com/nodejs/node/pull/66473
  describe("destroy()", () => {
    it("closes once after reopen() while the file opens", async () => {
      using dir = tempDir("utf8stream-destroy-reopen", {});
      const dest = path.join(String(dir), "out.log");
      const open = held("open");
      const closes: number[] = [];
      const stream = utf8Stream({
        dest,
        fs: {
          open: open.fn,
          close(fd: number, callback: () => void) {
            closes.push(fd);
            fs.close(fd, callback);
          },
        },
      });

      stream.reopen();
      const closed = once(stream, "close");
      stream.destroy();
      open.calls[0].run();
      await closed;
      expect({ opens: open.calls.length, closes: closes.length }).toEqual({ opens: 1, closes: 1 });
    });

    it("writes nothing more when the write in flight completes", async () => {
      using dir = tempDir("utf8stream-destroy-inflight", {});
      const dest = path.join(String(dir), "out.log");
      const write = held("write");
      const stream = utf8Stream({ fd: openSync(dest, "w"), minLength: 10, fs: { write: write.fn } });
      const errors: string[] = [];
      stream.on("error", err => errors.push(err.code));

      stream.write("aaaaaaaaaaaa");
      stream.write("bbbbbbbbbbbbbbb");
      await close(stream);
      write.calls[0].finish(null, 12);
      expect({ writes: write.calls.length, errors }).toEqual({ writes: 1, errors: [] });
    });

    it("fails a flush whose data the write in flight leaves behind", async () => {
      using dir = tempDir("utf8stream-destroy-flush", {});
      const dest = path.join(String(dir), "out.log");
      const write = held("write");
      const stream = utf8Stream({ fd: openSync(dest, "w"), minLength: 10, fs: { write: write.fn } });

      stream.write("aaaaaaaaaaaa");
      stream.write("bbbbbbbbbbbbbbb");
      const flushed = Promise.withResolvers<Error | null | undefined>();
      stream.flush(flushed.resolve);
      await close(stream);
      write.calls[0].finish(null, 12);
      expect(write.calls.length).toBe(1);
      expect(await flushed.promise).toMatchObject({ code: "ERR_INVALID_STATE" });
    });

    it("drops the data that end() left buffered when a flush completes afterwards", async () => {
      using dir = tempDir("utf8stream-destroy-end", {});
      const dest = path.join(String(dir), "out.log");
      const write = held("write");
      const fsync = held("fsync");
      const stream = utf8Stream({
        fd: openSync(dest, "w"),
        minLength: 4096,
        fs: { write: write.fn, fsync: fsync.fn },
      });

      stream.write("a");
      stream.flush();
      write.calls[0].run();
      await fsync.called(1);

      stream.end();
      stream.write("b");
      const closed = once(stream, "close");
      stream.destroy();
      fsync.calls[0].finish();
      expect(write.calls.length).toBe(1);

      fsync.calls[1].run();
      await closed;
      expect(readFileSync(dest, "utf8")).toBe("a");
    });
  });

  // https://github.com/nodejs/node/pull/66473
  describe("'drain'", () => {
    it("reaches a sync stream for a write that follows a turn without a listener", async () => {
      using dir = tempDir("utf8stream-drain-sync", {});
      const dest = path.join(String(dir), "out.log");
      const stream = utf8Stream({ fd: openSync(dest, "w"), sync: true });

      stream.write("a\n");
      await turn();
      stream.write("b\n");
      let drained = false;
      stream.once("drain", () => (drained = true));
      // 'drain' comes from process.nextTick, which runs before the next turn.
      await turn();
      expect(drained).toBe(true);
      await close(stream);
    });

    it.each([
      ["destroys the stream", (stream: Utf8Stream) => stream.destroy(), 0],
      ["starts a write", (stream: Utf8Stream) => stream.write(Buffer.alloc(4096, "b").toString()), 1],
    ])("does not come before a flush callback that %s returns", async (_name, callback, drains) => {
      using dir = tempDir("utf8stream-drain-flush", {});
      const dest = path.join(String(dir), "out.log");
      // With fsync: true a flush completes without a call to fs.fsync, inside the write's completion.
      const stream = utf8Stream({ fd: openSync(dest, "w"), minLength: 4096, fsync: true });
      const events: string[] = [];
      stream.on("drain", () => events.push("drain"));
      const closed = once(stream, "close");

      stream.write("a");
      const flushed = Promise.withResolvers<void>();
      stream.flush(() => {
        callback(stream);
        events.push("flushed");
        flushed.resolve();
      });
      await flushed.promise;
      expect(events).toEqual(["flushed"]);

      if (drains) {
        await once(stream, "drain");
        stream.destroy();
      }
      await closed;
      expect(events).toEqual(["flushed", ...Array(drains).fill("drain")]);
    });

    it("waits after reopen() for a write and a flush that a tick from 'ready' started", async () => {
      using dir = tempDir("utf8stream-drain-reopen", {});
      const dest = path.join(String(dir), "out.log");
      const write = held("write");
      const fsync = held("fsync");
      let hold = false;
      const stream = utf8Stream({
        dest,
        fs: {
          write: (...args: any[]) => (hold ? write.fn(...args) : (fs.write as Function)(...args)),
          fsync: fsync.fn,
        },
      });

      stream.write("before\n");
      await once(stream, "drain");
      const events: string[] = [];
      stream.on("drain", () => events.push("drain"));
      stream.once("ready", () => {
        // This tick runs before the one that reopen() queues for its 'drain'.
        process.nextTick(() => {
          hold = true;
          stream.write("after\n");
          stream.flush(() => events.push("flushed"));
        });
      });
      stream.reopen();
      await write.called(1);
      await turn();
      expect({ events, fsyncCalls: fsync.calls.length }).toEqual({ events: [], fsyncCalls: 0 });

      write.calls[0].run();
      await fsync.called(1);
      expect(events).toEqual(["drain"]);
      fsync.calls[0].finish();
      expect(events).toEqual(["drain", "flushed"]);
      expect(readFileSync(dest, "utf8")).toBe("before\nafter\n");

      const closed = once(stream, "close");
      stream.destroy();
      fsync.calls[1].run();
      await closed;
    });
  });
});
