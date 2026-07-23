import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import { fsync, openSync, readFileSync, Utf8Stream } from "node:fs";
import { join } from "node:path";
import { tempDir } from "harness";

describe("fs.Utf8Stream contentMode: buffer", () => {
  // https://github.com/nodejs/node/pull/63833: when starting a new buffer
  // group, the chunk itself must be stored (bufs.push([data])), not an empty
  // array. Previously the first chunk of every group was silently dropped and
  // #len drifted past the real buffered bytes, crashing in mergeBuf.
  test.each([true, false])("write() stores the first chunk of each group (sync=%p)", async sync => {
    using dir = tempDir("utf8stream-buffer", {});
    const dest = join(String(dir), "out.log");
    const fd = openSync(dest, "w");
    const stream = new Utf8Stream({ fd, sync, contentMode: "buffer" });
    try {
      await once(stream, "ready");
      expect(stream.write(Buffer.from("hello world\n"))).toBe(true);
      expect(stream.write(Buffer.from("something else\n"))).toBe(true);
      stream.end();
      await once(stream, "finish");
      expect(readFileSync(dest, "utf8")).toBe("hello world\nsomething else\n");
    } finally {
      stream.destroy();
    }
  });

  test("write() stores the first chunk when a new group is forced by maxWrite", async () => {
    using dir = tempDir("utf8stream-buffer-maxwrite", {});
    const dest = join(String(dir), "out.log");
    const fd = openSync(dest, "w");
    // minLength: 7 keeps the first 6-byte write buffered so the second write
    // evaluates lens[last] + 6 > maxWrite (8) and starts a fresh group.
    const stream = new Utf8Stream({ fd, sync: true, contentMode: "buffer", maxWrite: 8, minLength: 7 });
    try {
      await once(stream, "ready");
      stream.write(Buffer.from("aaaaaa"));
      stream.write(Buffer.from("bbbbbb"));
      stream.write(Buffer.from("cccccc"));
      stream.flushSync();
      expect(readFileSync(dest, "utf8")).toBe("aaaaaabbbbbbcccccc");
    } finally {
      stream.destroy();
    }
  });
});

describe("fs.Utf8Stream periodicFlush", () => {
  // The periodicFlush timer used to call this.flush(null), which bypasses the
  // default cb argument and then fails validateFunction(cb). Every timer tick
  // would throw an uncaught ERR_INVALID_ARG_TYPE instead of flushing.
  test.each([true, false])("timer tick flushes buffered data (sync=%p)", async sync => {
    using dir = tempDir("utf8stream-periodic", {});
    const dest = join(String(dir), "out.log");
    const fd = openSync(dest, "w");
    // minLength keeps the write buffered until the periodic flush fires.
    const stream = new Utf8Stream({ fd, sync, minLength: 4096, periodicFlush: 5 });
    let errored: unknown;
    stream.on("error", err => (errored = err));
    try {
      await once(stream, "ready");
      stream.write("hello world\n");
      // Data is buffered (below minLength) until periodicFlush fires.
      expect(readFileSync(dest, "utf8")).toBe("");
      await once(stream, "drain");
      expect(errored).toBeUndefined();
      expect(readFileSync(dest, "utf8")).toBe("hello world\n");
    } finally {
      stream.destroy();
    }
  });

  test("timer tick flushes buffered data (contentMode: buffer)", async () => {
    using dir = tempDir("utf8stream-periodic-buffer", {});
    const dest = join(String(dir), "out.log");
    const fd = openSync(dest, "w");
    const stream = new Utf8Stream({ fd, contentMode: "buffer", minLength: 4096, periodicFlush: 5 });
    let errored: unknown;
    stream.on("error", err => (errored = err));
    try {
      await once(stream, "ready");
      stream.write(Buffer.from("hello world\n"));
      await once(stream, "drain");
      expect(errored).toBeUndefined();
      expect(readFileSync(dest, "utf8")).toBe("hello world\n");
    } finally {
      stream.destroy();
    }
  });

  // The periodic tick should only drain the in-memory buffer to the fd, like
  // SonicBoom: no fsync, and no once('drain')/once('error') listeners. A naive
  // fix that routed the timer through flush()'s default no-op cb would call
  // fs.fsync on every tick and accumulate listeners under sustained writes.
  test("timer tick does not fsync or accumulate drain listeners", async () => {
    using dir = tempDir("utf8stream-periodic-nolisten", {});
    const dest = join(String(dir), "out.log");
    const fd = openSync(dest, "w");
    let fsyncCalls = 0;
    const stream = new Utf8Stream({
      fd,
      minLength: 4096,
      periodicFlush: 2,
      fs: {
        fsync: (fd, cb) => {
          fsyncCalls++;
          fsync(fd, cb);
        },
      },
    });
    try {
      await once(stream, "ready");
      stream.write("hello world\n");
      await once(stream, "drain");
      // Let a few more ticks fire with nothing buffered.
      for (let i = 0; i < 3; i++) await once(stream, "drain");
      expect(fsyncCalls).toBe(0);
      expect(stream.listenerCount("drain")).toBe(0);
      expect(stream.listenerCount("error")).toBe(0);
      expect(readFileSync(dest, "utf8")).toBe("hello world\n");
    } finally {
      stream.destroy();
    }
  });

  test("flush(null) from user code still rejects", async () => {
    using dir = tempDir("utf8stream-flush-null", {});
    const dest = join(String(dir), "out.log");
    const fd = openSync(dest, "w");
    const stream = new Utf8Stream({ fd, minLength: 4096 });
    try {
      await once(stream, "ready");
      expect(() => stream.flush(null)).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
      );
    } finally {
      stream.destroy();
    }
  });
});
