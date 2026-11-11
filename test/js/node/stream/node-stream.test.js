import { exposedInternals } from "bun:internal-for-testing";
import { describe, expect, it, jest } from "bun:test";
import { bunEnv, bunExe, bunRun, isGlibcVersionAtLeast, isMacOS, nodeExeAtLeast, tempDir, tmpdirSync } from "harness";
import nodeFetch from "node-fetch";
import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Duplex, duplexPair, finished, PassThrough, Readable, Stream, Transform, Writable } from "node:stream";
import { text } from "node:stream/consumers";
import { finished as finishedP, pipeline as pipelineP } from "node:stream/promises";
import { join } from "path";
import { request as undiciRequest } from "undici";
import { logFor, logOf, rows as readRequestRows } from "./from-web-read-request-fixture.js";

describe("Readable", () => {
  it("should be able to be created without _construct method defined", done => {
    const readable = new Readable({
      read() {
        this.push("Hello World!\n");
        this.push(null);
      },
    });
    expect(readable instanceof Readable).toBe(true);
    let data = "";
    readable.on("data", chunk => {
      data += chunk.toString();
    });
    readable.on("end", () => {
      expect(data).toBe("Hello World!\n");
      done();
    });
  });

  it("should be able to be piped via .pipe", done => {
    const readable = new Readable({
      read() {
        this.push("Hello World!");
        this.push(null);
      },
    });

    const writable = new Writable({
      write(chunk, encoding, callback) {
        expect(chunk.toString()).toBe("Hello World!");
        callback();
        done();
      },
    });

    readable.pipe(writable);
  });

  it("should be able to be piped via .pipe, issue #3607", done => {
    const path = `${tmpdir()}/${Date.now()}.testReadStreamEmptyFile.txt`;
    writeFileSync(path, "");
    const stream = createReadStream(path);
    stream.on("error", err => {
      done(err);
    });

    let called = false;
    const writable = new Writable({
      write(chunk, encoding, callback) {
        called = true;
        callback();
      },
    });
    writable.on("finish", () => {
      try {
        expect(called).toBeFalse();
      } catch (err) {
        return done(err);
      }
      done();
    });

    stream.pipe(writable);
  });

  it("should be able to be piped via .pipe, issue #3668", done => {
    const path = `${tmpdir()}/${Date.now()}.testReadStream.txt`;
    writeFileSync(path, "12345");
    const stream = createReadStream(path, { start: 0, end: 4 });

    const writable = new Writable({
      write(chunk, encoding, callback) {
        try {
          expect(chunk.toString()).toBe("12345");
        } catch (err) {
          done(err);
          return;
        }
        callback();
        done();
      },
    });

    stream.on("error", err => {
      done(err);
    });

    stream.pipe(writable);
  });

  it("should be able to be piped via .pipe, both start and end are 0", done => {
    const path = `${tmpdir()}/${Date.now()}.testReadStream2.txt`;
    writeFileSync(path, "12345");
    const stream = createReadStream(path, { start: 0, end: 0 });

    const writable = new Writable({
      write(chunk, encoding, callback) {
        try {
          // Both start and end are inclusive and start counting at 0.
          expect(chunk.toString()).toBe("1");
        } catch (err) {
          done(err);
          return;
        }
        callback();
        done();
      },
    });

    stream.on("error", err => {
      done(err);
    });

    stream.pipe(writable);
  });

  it("should be able to be piped via .pipe with a large file", done => {
    const data = Buffer.allocUnsafe(768 * 1024)
      .fill("B")
      .toString();
    const length = data.length;
    const path = `${tmpdir()}/${Date.now()}.testReadStreamLargeFile.txt`;
    writeFileSync(path, data);
    const stream = createReadStream(path, { start: 0, end: length - 1 });

    let res = "";
    let count = 0;
    const writable = new Writable({
      write(chunk, encoding, callback) {
        count += 1;
        res += chunk;
        callback();
      },
    });
    writable.on("finish", () => {
      try {
        expect(res).toEqual(data);
        expect(count).toBeGreaterThan(1);
      } catch (err) {
        return done(err);
      }
      done();
    });
    stream.on("error", err => {
      done(err);
    });
    stream.pipe(writable);
  });

  it.todo("should have the correct fields in _events", () => {
    const s = Readable({});
    expect(s._events).toHaveProperty("close");
    expect(s._events).toHaveProperty("error");
    expect(s._events).toHaveProperty("prefinish");
    expect(s._events).toHaveProperty("finish");
    expect(s._events).toHaveProperty("drain");
  });
});

describe("createReadStream", () => {
  it("should allow the options argument to be omitted", done => {
    const testData = "Hello world";
    const path = join(tmpdir(), `${Date.now()}-testNoOptions.txt`);
    writeFileSync(path, testData);
    const stream = createReadStream(path);

    let data = "";
    stream.on("data", chunk => {
      data += chunk.toString();
    });
    stream.on("end", () => {
      expect(data).toBe(testData);
      done();
    });
  });

  it("should interpret the option argument as encoding if it's a string", done => {
    const testData = "Hello world";
    const path = join(tmpdir(), `${Date.now()}-testEncodingArgument.txt`);
    writeFileSync(path, testData);
    const stream = createReadStream(path);

    let data = "";
    stream.on("data", chunk => {
      data += chunk.toString("base64");
    });
    stream.on("end", () => {
      expect(data).toBe(btoa(testData));
      done();
    });
  });

  it("should emit readable on end", async () => {
    expect(await bunRun(join(import.meta.dir, "emit-readable-on-end.js"))).toSpawn();
  });
});

describe("Writable", () => {
  it.todo("should have the correct fields in _events", () => {
    const s = Writable({});
    expect(s._events).toHaveProperty("close");
    expect(s._events).toHaveProperty("error");
    expect(s._events).toHaveProperty("prefinish");
    expect(s._events).toHaveProperty("finish");
    expect(s._events).toHaveProperty("drain");
  });
});

describe("Duplex", () => {
  it("should allow subclasses to be derived via .call() on class", () => {
    function Subclass(opts) {
      if (!(this instanceof Subclass)) return new Subclass(opts);
      Duplex.call(this, opts);
    }

    Object.setPrototypeOf(Subclass.prototype, Duplex.prototype);
    Object.setPrototypeOf(Subclass, Duplex);

    const subclass = new Subclass();
    expect(subclass instanceof Duplex).toBe(true);
  });

  it.todo("should have the correct fields in _events", () => {
    const s = Duplex({});
    expect(s._events).toHaveProperty("close");
    expect(s._events).toHaveProperty("error");
    expect(s._events).toHaveProperty("prefinish");
    expect(s._events).toHaveProperty("finish");
    expect(s._events).toHaveProperty("drain");
    expect(s._events).toHaveProperty("data");
    expect(s._events).toHaveProperty("end");
    expect(s._events).toHaveProperty("readable");
  });
});

describe("Transform", () => {
  it("should allow subclasses to be derived via .call() on class", () => {
    function Subclass(opts) {
      if (!(this instanceof Subclass)) return new Subclass(opts);
      Transform.call(this, opts);
    }

    Object.setPrototypeOf(Subclass.prototype, Transform.prototype);
    Object.setPrototypeOf(Subclass, Transform);

    const subclass = new Subclass();
    expect(subclass instanceof Transform).toBe(true);
  });

  it.todo("should have the correct fields in _events", () => {
    const s = Transform({});
    expect(s._events).toHaveProperty("close");
    expect(s._events).toHaveProperty("error");
    expect(s._events).toHaveProperty("prefinish");
    expect(s._events).toHaveProperty("finish");
    expect(s._events).toHaveProperty("drain");
    expect(s._events).toHaveProperty("data");
    expect(s._events).toHaveProperty("end");
    expect(s._events).toHaveProperty("readable");
  });
});

describe("PassThrough", () => {
  it("should allow subclasses to be derived via .call() on class", () => {
    function Subclass(opts) {
      if (!(this instanceof Subclass)) return new Subclass(opts);
      PassThrough.call(this, opts);
    }

    Object.setPrototypeOf(Subclass.prototype, PassThrough.prototype);
    Object.setPrototypeOf(Subclass, PassThrough);

    const subclass = new Subclass();
    expect(subclass instanceof PassThrough).toBe(true);
  });

  it.todo("should have the correct fields in _events", () => {
    const s = PassThrough({});
    expect(s._events).toHaveProperty("close");
    expect(s._events).toHaveProperty("error");
    expect(s._events).toHaveProperty("prefinish");
    expect(s._events).toHaveProperty("finish");
    expect(s._events).toHaveProperty("drain");
    expect(s._events).toHaveProperty("data");
    expect(s._events).toHaveProperty("end");
    expect(s._events).toHaveProperty("readable");
  });
});

const processStdInTest = `
const { Transform } = require("node:stream");

let totalChunkSize = 0;
const transform = new Transform({
  transform(chunk, _encoding, callback) {
    totalChunkSize += chunk.length;
    callback(null, "");
  },
});

process.stdin.pipe(transform).pipe(process.stdout);
process.stdin.on("end", () => console.log(totalChunkSize));
`;
describe("process.stdin", () => {
  it("should pipe correctly", async () => {
    const dir = join(tmpdir(), "process-stdin-test");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "process-stdin-test.js"), processStdInTest, {});

    // A sufficiently large input to make at least four chunks
    const ARRAY_SIZE = 8_388_628;
    const typedArray = new Uint8Array(ARRAY_SIZE).fill(97);

    const { stdout, exited, stdin } = Bun.spawn({
      cmd: [bunExe(), "process-stdin-test.js"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });

    stdin.write(typedArray);
    await stdin.end();

    expect(await exited).toBe(0);
    expect(await stdout.text()).toBe(`${ARRAY_SIZE}\n`);
  });
});

it.if(isMacOS || isGlibcVersionAtLeast("2.36.0"))("TTY streams", () => {
  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "test", join(import.meta.dir, "tty-streams.fixture.js")],
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  expect(stdout.toString()).toEqual(expect.stringContaining("bun test v1."));
  try {
    expect(stderr.toString()).toContain("0 fail");
  } catch (error) {
    throw new Error(stderr.toString());
  }
  expect(exitCode).toBe(0);
});

it("Readable.toWeb", async () => {
  const readable = new Readable({
    read() {
      this.push("Hello ");
      this.push("World!\n");
      this.push(null);
    },
  });

  const webReadable = Readable.toWeb(readable);
  expect(webReadable).toBeInstanceOf(ReadableStream);

  const result = await new Response(webReadable).text();
  expect(result).toBe("Hello World!\n");
});

it("Readable.fromWeb", async () => {
  const readable = Readable.fromWeb(
    new ReadableStream({
      start(controller) {
        controller.enqueue("Hello ");
        controller.enqueue("World!\n");
        controller.close();
      },
    }),
  );
  expect(readable).toBeInstanceOf(Readable);

  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(chunk);
  }
  expect(Buffer.concat(chunks).toString()).toBe("Hello World!\n");
});

// fromWeb assigns stream.$bunNativePtr on the node Readable. When user code grafts
// ReadableStream.prototype into the node stream prototype chain, that put used to
// reach ReadableStream's private custom setter with the Readable as the receiver,
// writing a JSValue through a type-confused pointer into the Readable's own
// property storage (observable below as a clobbered Symbol(kCapture) slot).
it("Readable.fromWeb with ReadableStream.prototype grafted into the prototype chain", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { Readable } = require("node:stream");
        const { EventEmitter } = require("node:events");
        const snap = o => Object.fromEntries(Reflect.ownKeys(o).map(k => [String(k), Object.prototype.toString.call(o[k])]));
        const before = snap(Readable.fromWeb(new Response("x").body));
        Object.setPrototypeOf(EventEmitter.prototype, ReadableStream.prototype);
        const stream = Readable.fromWeb(new Response("y").body);
        const after = snap(stream);
        for (const key in before) {
          if (before[key] !== after[key]) throw new Error("clobbered own slot " + key + ": " + before[key] + " -> " + after[key]);
        }
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        console.log("read:" + Buffer.concat(chunks).toString());
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("read:y\n");
  expect(exitCode).toBe(0);
});

// An error from the underlying web stream must surface on the node Readable as an
// 'error' event (and destroy it), not as a global unhandled rejection.
it("Readable.fromWeb propagates web stream errors to 'error' and destroys", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { Readable } = require("node:stream");
        process.on("unhandledRejection", e => {
          console.log("UNHANDLED:" + (e && e.message));
        });
        const web = new ReadableStream({
          start(c) { c.enqueue(new Uint8Array([1, 2, 3])); },
          pull() { throw new Error("boom"); },
        });
        const r = Readable.fromWeb(web);
        r.on("data", d => console.log("DATA:" + d.length));
        r.on("end", () => console.log("END"));
        r.on("error", e => console.log("ERROR:" + e.message));
        r.on("close", () => {
          console.log("CLOSE errored=" + (r.errored && r.errored.message) + " destroyed=" + r.destroyed);
        });
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ out: stdout.trim().split("\n"), err: stderr }).toEqual({
    out: ["DATA:3", "ERROR:boom", "CLOSE errored=boom destroyed=true"],
    err: "",
  });
  expect(exitCode).toBe(0);
});

it("Readable.fromWeb on an already-errored web stream emits 'error' and destroys", async () => {
  const web = new ReadableStream({
    start(c) {
      c.error(new Error("start-boom"));
    },
  });
  const r = Readable.fromWeb(web);
  const { promise, resolve, reject } = Promise.withResolvers();
  r.on("error", resolve);
  r.on("end", () => reject(new Error("should not end")));
  r.resume();
  const err = await promise;
  expect(err.message).toBe("start-boom");
  expect(r.destroyed).toBe(true);
  expect(r.errored?.message).toBe("start-boom");
});

// Delivering a 64 KiB file chunk re-enters the native reader: push() over the
// highWaterMark pauses it, and the next _read unpauses it mid-delivery. On
// Windows that used to free the buffer an in-flight libuv file read was still
// writing into, corrupting the heap (#39890).
it("Readable.fromWeb(Bun.file().stream()) survives pause/unpause during chunk delivery (#39890)", async () => {
  using dir = tempDir("fromweb-file-39890", {
    "repro.ts": `
      import { Readable } from "node:stream";
      const big = Buffer.alloc(1024 * 1024, 0x61);
      await Bun.write("big.bin", big);
      const parts = [];
      for await (const chunk of Readable.fromWeb(Bun.file("big.bin").stream())) {
        parts.push(chunk);
      }
      const out = Buffer.concat(parts);
      if (!out.equals(big)) throw new Error("round-trip mismatch: " + out.length);
      console.log("OK");
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "repro.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr }).toEqual({ stdout: "OK\n", stderr: "" });
  expect(exitCode).toBe(0);
});

it("Readable.fromWeb piped to a Writable surfaces web stream errors on the destination", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { Readable, Writable, pipeline } = require("node:stream");
        process.on("unhandledRejection", e => {
          console.log("UNHANDLED:" + (e && e.message));
        });
        const web = new ReadableStream({
          start(c) { c.enqueue(new Uint8Array([1, 2, 3, 4, 5])); },
          pull() { return Promise.reject(new Error("net-fail")); },
        });
        let written = 0;
        const dest = new Writable({
          write(chunk, enc, cb) { written += chunk.length; cb(); },
        });
        pipeline(Readable.fromWeb(web), dest, err => {
          console.log("PIPELINE err=" + (err && err.message) + " written=" + written);
        });
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ out: stdout.trim(), err: stderr }).toEqual({
    out: "PIPELINE err=net-fail written=5",
    err: "",
  });
  expect(exitCode).toBe(0);
});

it("Readable.fromWeb async iteration rejects with the web stream error", async () => {
  const web = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array([9]));
    },
    pull() {
      throw new Error("iter-boom");
    },
  });
  const r = Readable.fromWeb(web);
  let err;
  try {
    for await (const _ of r) {
    }
  } catch (e) {
    err = e;
  }
  expect(err?.message).toBe("iter-boom");
  expect(r.destroyed).toBe(true);
});

it("Readable.fromWeb destroyed before the first read cancels the web stream", async () => {
  let cancelReason;
  const web = new ReadableStream({
    cancel(reason) {
      cancelReason = reason;
    },
  });
  const r = Readable.fromWeb(web);
  const { promise, resolve } = Promise.withResolvers();
  r.on("error", () => {});
  r.on("close", resolve);
  r.destroy(new Error("user-destroy"));
  await promise;
  expect(cancelReason?.message).toBe("user-destroy");
  expect(r.destroyed).toBe(true);
});

it("Readable.fromWeb: breaking out of for-await cancels the web source with ABORT_ERR", async () => {
  let cancelReason;
  const web = new ReadableStream({
    start(c) {
      for (let i = 0; i < 6; i++) c.enqueue(new Uint8Array(64).fill(i));
      c.close();
    },
    cancel(reason) {
      cancelReason = reason;
    },
  });
  const r = Readable.fromWeb(web);
  r.on("error", () => {});
  const closed = new Promise(resolve => r.once("close", resolve));
  let seen = 0;
  for await (const chunk of r) {
    seen++;
    break;
    void chunk;
  }
  await closed;
  expect(seen).toBe(1);
  expect({ code: cancelReason?.code, name: cancelReason?.name }).toEqual({ code: "ABORT_ERR", name: "AbortError" });
});

it("Readable.fromWeb: destroy(err) after consuming a chunk cancels the web source with that error", async () => {
  let cancelReason;
  const web = new ReadableStream({
    start(c) {
      for (let i = 0; i < 6; i++) c.enqueue(new Uint8Array(64).fill(i));
      c.close();
    },
    cancel(reason) {
      cancelReason = reason;
    },
  });
  const r = Readable.fromWeb(web);
  r.on("error", () => {});
  const closed = new Promise(resolve => r.once("close", resolve));
  const gotData = new Promise(resolve => r.once("data", resolve));
  const first = await gotData;
  expect(first.length).toBe(64);
  r.destroy(new RangeError("consumer-gone"));
  await closed;
  expect({ name: cancelReason?.name, message: cancelReason?.message }).toEqual({
    name: "RangeError",
    message: "consumer-gone",
  });
});

it.each(["before the first read", "after a chunk"])(
  "Readable.fromWeb: destroy() %s emits no 'error' if the source's cancel() rejects, as in Node",
  async when => {
    const web = new ReadableStream({
      pull(c) {
        c.enqueue(new Uint8Array(1));
      },
      cancel() {
        return Promise.reject(new Error("cancel failed"));
      },
    });
    const r = Readable.fromWeb(web);
    const events = [];
    r.on("error", err => events.push(err.message));
    const closed = new Promise(resolve => r.once("close", resolve));
    if (when === "after a chunk") await new Promise(resolve => r.once("data", resolve));
    r.destroy();
    await closed;
    expect({ events, errored: r.errored }).toEqual({ events: [], errored: null });
  },
);

// A native-backed Readable pushes its pull results synchronously, so while it flows Readable has the next chunk
// buffered when a 'data' listener runs, and it pushes EOF a tick after the last chunk. destroy() stopped neither: flow()
// emitted the buffered chunk with `destroyed === true`, and 'end' followed. Node's fromWeb pushes asynchronously, so
// nothing is buffered or due at that point, and it emits only 'close'.
describe.each([
  ["Blob.stream()", size => new Blob([Buffer.alloc(size, "x")]).stream()],
  ["Response.body", size => new Response(Buffer.alloc(size, "x")).body],
])("Readable.fromWeb(%s): destroy() inside a 'data' listener", (_, makeWeb) => {
  // With today's chunking, 100 bytes are the only chunk and EOF is due a tick later, 16484 bytes are two chunks with
  // the last one buffered behind the first, and 1 MiB has more buffered behind every chunk.
  it.each([100, 16384 + 100, 1024 * 1024])("of a %d byte body stops 'data' and 'end'", async size => {
    const r = Readable.fromWeb(makeWeb(size));
    const events = [];
    const { promise: closed, resolve } = Promise.withResolvers();
    r.on("data", () => {
      events.push(`data destroyed=${r.destroyed}`);
      r.destroy();
    });
    r.on("end", () => events.push("end"));
    r.on("close", () => {
      events.push("close");
      resolve();
    });
    await closed;
    expect(events).toEqual(["data destroyed=false", "close"]);
  });
});

it("Readable.fromWeb: destroy() on a paused stream keeps the buffered chunk for read(), as in Node", async () => {
  const r = Readable.fromWeb(new Blob([Buffer.alloc(1024, "x")]).stream());
  const { promise, resolve } = Promise.withResolvers();
  r.once("readable", () => {
    r.destroy();
    resolve(r.read());
  });
  const chunk = await promise;
  expect(chunk?.length).toBe(1024);
});

// Once the source has ended, what is buffered is all that is left. Node delivers it after destroy(), and to drop it
// would let 'end' follow data that never arrived.
it("Readable.fromWeb: a stream that ended while paused still delivers every byte after destroy(), as in Node", async () => {
  const size = 16384 + 100;
  const r = Readable.fromWeb(new Blob([Buffer.alloc(size, "x")]).stream());
  let bytes = 0;
  r.on("data", chunk => {
    bytes += chunk.length;
    r.destroy();
  });
  r.pause();
  const closed = new Promise(resolve => r.once("close", resolve));
  r.read(0);
  while (!r._readableState.ended) await new Promise(resolve => setImmediate(resolve));
  r.resume();
  await closed;
  expect(bytes).toBe(size);
});

it("Readable.toWeb(Readable.fromWeb(rs)).cancel(reason) propagates to the web source", async () => {
  let cancelReason;
  const web = new ReadableStream({
    start(c) {
      for (let i = 0; i < 6; i++) c.enqueue(new Uint8Array(64).fill(i));
      c.close();
    },
    cancel(reason) {
      cancelReason = reason;
    },
  });
  const inner = Readable.fromWeb(web);
  inner.on("error", () => {});
  const innerClosed = new Promise(resolve => inner.once("close", resolve));
  const outer = Readable.toWeb(inner);
  const reader = outer.getReader();
  const first = await reader.read();
  expect(first.done).toBe(false);
  await reader.cancel(new RangeError("consumer-gone")).catch(() => {});
  await innerClosed;
  expect({ name: cancelReason?.name, message: cancelReason?.message }).toEqual({
    name: "RangeError",
    message: "consumer-gone",
  });
});

// Since nodejs/node#65548 (Node.js v26.9.0 and v24.22.0) a read of Readable.fromWeb() and Duplex.fromWeb() is a read request
// of the web stream. The stream runs the close step and the error step of that request where it closes or errors: inside
// read(), controller.close(), controller.error() or reader.cancel(). It hands a chunk over one microtask later.
describe("Readable.fromWeb and Duplex.fromWeb read through a read request of the web stream", () => {
  const readRequestFixture = join(import.meta.dir, "from-web-read-request-fixture.js");
  const adapters = {
    "Readable.fromWeb": web => Readable.fromWeb(web),
    "Duplex.fromWeb": web => Duplex.fromWeb({ readable: web, writable: new WritableStream() }),
  };

  // Each row of the fixture has the log of Node.js v26.12.1. A row with `bun` is a known difference, with its reason
  // in `why`: the row pins the log of Bun, and its `expected` is what to change it to.
  it.each(readRequestRows.map(row => [row.bun ? `${row.name} (differs from Node.js)` : row.name, row]))(
    "%s",
    async (_, row) => {
      expect(await logOf(row)).toEqual(logFor(row));
    },
  );

  // A release of Node.js that changes an order fails here. v26.12.1 is the release that the logs come from: three
  // rows need flowSync() of v26.11.0.
  const node = nodeExeAtLeast("26.12.1");
  it.skipIf(!node)("Node.js prints the expected log of every row of the fixture", async () => {
    await using proc = Bun.spawn({ cmd: [node, readRequestFixture], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const count = readRequestRows.length;
    expect({ stdout, stderr }).toEqual({ stdout: `${count} of ${count} rows have the expected log\n`, stderr: "" });
    expect(exitCode).toBe(0);
  });

  // Streams that only Bun has, or that Bun makes closed where Node.js makes them open.
  it.each([
    ["an empty Blob", () => new Blob([]).stream()],
    ["an empty Response body", () => new Response("").body],
    [
      'a type: "direct" stream that closes in pull()',
      () => new ReadableStream({ type: "direct", pull: c => c.close() }),
    ],
  ])("one read() ends a Readable.fromWeb() over %s", async (_, web) => {
    const log = await logOf({
      make: () => Readable.fromWeb(web()),
      act: (stream, log) => void log.push(`read: ${stream.read()}`),
    });
    expect(log).toEqual(["read: null", "end", "close"]);
  });

  // Readable.fromWeb() hands a stream that has a native source to internal/streams/native-readable, which pushes the
  // end one tick after it learns of it. Duplex.fromWeb() reads the same stream through the read request.
  it.each([
    ["Readable.fromWeb", ["read: null", "read: null", "end", "close"]],
    ["Duplex.fromWeb", ["read: null", "end", "finish", "close"]],
  ])("%s over a Blob stream that another reader drained: the reads that end it", async (adapter, expected) => {
    const web = new Blob(["x"]).stream();
    const reader = web.getReader();
    while (!(await reader.read()).done);
    reader.releaseLock();
    const log = await logOf({
      make: () => adapters[adapter](web),
      act: async (stream, log) => {
        log.push(`read: ${stream.read()}`);
        await new Promise(resolve => setImmediate(resolve));
        if (!stream.readableEnded) log.push(`read: ${stream.read()}`);
      },
    });
    expect(log).toEqual(expected);
  });

  // Node.js never gives the lock of the web stream back. Bun gives it back when the node stream is destroyed, if the
  // web stream closed or errored by itself. A stream that destroy() cancels stays locked.
  it.each([
    ["a closed stream, one read()", false, "unread", controller => controller.close(), stream => void stream.read()],
    [
      "a parked read, controller.close(), and nothing reads the end",
      true,
      "parked",
      null,
      (stream, controller) => controller.close(),
    ],
    [
      "a parked read, controller.close(), then the end is read",
      false,
      "parked",
      null,
      (stream, controller) => (controller.close(), stream.resume()),
    ],
    [
      "an errored stream, one read()",
      false,
      "unread",
      controller => controller.error(new Error("boom")),
      stream => void stream.read(),
    ],
    [
      "a parked read, controller.error()",
      false,
      "parked",
      null,
      (stream, controller) => controller.error(new Error("boom")),
    ],
    ["a parked read, destroy()", true, "parked", null, stream => void stream.destroy()],
    [
      "a parked read, controller.close() then destroy() in one turn",
      false,
      "parked",
      null,
      (stream, controller) => (controller.close(), stream.destroy()),
    ],
    ["destroy() before the first read", false, "unread", null, stream => void stream.destroy()],
  ])("Readable.fromWeb, %s: the web stream is locked afterwards: %p", async (_, locked, state, start, act) => {
    let controller;
    const web = new ReadableStream({
      start(c) {
        controller = c;
        start?.(c);
      },
    });
    const stream = Readable.fromWeb(web);
    stream.on("error", () => {});
    const turn = () => new Promise(resolve => setImmediate(resolve));
    await turn();
    if (state === "parked") {
      stream.read();
      await turn();
    }
    act(stream, controller);
    for (let i = 0; i < 4; i++) await turn();
    expect(web.locked).toBe(locked);
  });

  // A ReadableStream subclass can answer getReader() with an object of its own. The read request takes a
  // ReadableStreamDefaultReader only. Node.js v26.12.1 fails on such a reader too, with a TypeError of its own.
  it.each(Object.keys(adapters))(
    "%s: a reader that is no ReadableStreamDefaultReader destroys the node stream, which cancels the source through it",
    async adapter => {
      class Wrapped extends ReadableStream {
        getReader() {
          const reader = super.getReader();
          return {
            read: () => reader.read(),
            releaseLock: () => reader.releaseLock(),
            cancel: reason => reader.cancel(reason),
            closed: reader.closed,
          };
        }
      }
      const log = await logOf({
        make: (x, log) =>
          adapters[adapter](new Wrapped({ cancel: reason => void log.push(`cancel of the source: ${reason.code}`) })),
        act: (stream, log) => void log.push(`read: ${stream.read()}`),
      });
      expect(log).toEqual([
        "cancel of the source: ERR_INVALID_ARG_TYPE",
        "read: null",
        "error: ERR_INVALID_ARG_TYPE",
        "close",
      ]);
    },
  );

  // User code that keeps the reader of the adapter can release it. The read that waits fails, and so does a later one.
  it.each([
    ["Readable.fromWeb", "a read waits", ["error: ERR_INVALID_STATE", "close"]],
    ["Readable.fromWeb", "no read waits", ["read: 1", "error: ERR_INVALID_STATE", "close"]],
    ["Duplex.fromWeb", "a read waits", ["error: ERR_INVALID_STATE", "close"]],
    ["Duplex.fromWeb", "no read waits", ["read: 1", "error: ERR_INVALID_STATE", "close"]],
  ])(
    "%s: releaseLock() on the reader of the adapter while %s destroys the node stream",
    async (adapter, when, expected) => {
      let reader;
      class Kept extends ReadableStream {
        getReader() {
          return (reader = super.getReader());
        }
      }
      // One chunk fills the buffer of the node stream. The second one stays in the web stream, and no read waits.
      const twoChunks = {
        start(controller) {
          controller.enqueue(new Uint8Array(1));
          controller.enqueue(new Uint8Array(1));
        },
      };
      const web = new Kept(when === "a read waits" ? {} : twoChunks);
      const log = await logOf({
        make: () =>
          adapter === "Readable.fromWeb"
            ? Readable.fromWeb(web, { highWaterMark: 1 })
            : Duplex.fromWeb({ readable: web, writable: new WritableStream() }, { highWaterMark: 1 }),
        act: async (stream, log) => {
          stream.read(0);
          await new Promise(resolve => setImmediate(resolve));
          reader.releaseLock();
          if (when === "no read waits") log.push(`read: ${stream.read()?.length}`);
        },
      });
      expect(log).toEqual(expected);
    },
  );

  // The web stream that closes has work of its own left: the read requests of its other readers, the second branch of
  // a tee(). What node:stream code or a listener throws inside the step was an unhandled rejection before, and still is.
  // Node.js v26.12.1 throws it into controller.close().
  it("a 'readable' listener that throws inside controller.close() does not stop the close", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { Readable } = require("node:stream");
          const log = [];
          process.on("unhandledRejection", error => log.push("unhandledRejection: " + error.message));
          process.on("uncaughtException", error => log.push("uncaughtException: " + error.message));
          let controller;
          const [first, second] = new ReadableStream({ start(c) { controller = c; } }).tee();
          const readable = Readable.fromWeb(first);
          readable.on("readable", () => {
            log.push("readable");
            throw new Error("listener");
          });
          const other = second.getReader().read().then(result => log.push("the other branch is done: " + result.done));
          setImmediate(() => {
            try {
              controller.close();
              log.push("close() returned");
            } catch (error) {
              log.push("close() threw " + error.message);
            }
            setImmediate(async () => {
              await other;
              setImmediate(() => console.log(JSON.stringify(log)));
            });
          });
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ log: stdout.trim() === "" ? stdout : JSON.parse(stdout), stderr }).toEqual({
      log: ["readable", "close() returned", "the other branch is done: true", "unhandledRejection: listener"],
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  it("a 'data' listener that throws is an unhandled rejection, and enqueue() returns", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { Readable } = require("node:stream");
          const log = [];
          process.on("unhandledRejection", error => log.push("unhandledRejection: " + error.message));
          process.on("uncaughtException", error => log.push("uncaughtException: " + error.message));
          let controller;
          const readable = Readable.fromWeb(new ReadableStream({ start(c) { controller = c; } }));
          readable.on("data", () => {
            log.push("data");
            throw new Error("listener");
          });
          setImmediate(() => {
            controller.enqueue(new Uint8Array(1));
            log.push("enqueue() returned");
            setImmediate(() => setImmediate(() => console.log(JSON.stringify(log))));
          });
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ log: stdout.trim() === "" ? stdout : JSON.parse(stdout), stderr }).toEqual({
      log: ["enqueue() returned", "data", "unhandledRejection: listener"],
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // Each 'readable' listener closes the next web stream inside the close step of its own stream, 600 frames deeper. Near
  // the end of the stack a step runs in a job of its own, so no listener meets a RangeError.
  it("close steps nested deeper than the stack end every stream", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { Readable } = require("node:stream");
          const count = 200;
          const log = [];
          process.on("unhandledRejection", error => log.push("unhandledRejection: " + error.constructor.name));
          process.on("uncaughtException", error => log.push("uncaughtException: " + error.constructor.name));
          const controllers = [];
          let ended = 0;
          function deeper(frames, next) {
            if (frames === 0) next();
            else deeper(frames - 1, next);
            return frames;
          }
          for (let i = 0; i < count; i++) {
            const readable = Readable.fromWeb(new ReadableStream({ start(c) { controllers.push(c); } }));
            readable.on("readable", () => {
              ended++;
              if (i + 1 < count) deeper(600, () => controllers[i + 1].close());
            });
          }
          setImmediate(() => {
            try {
              controllers[0].close();
              log.push("close() returned");
            } catch (error) {
              log.push("close() threw " + error.constructor.name);
            }
            setImmediate(() => setImmediate(() => console.log(JSON.stringify([...log, ended + " streams ended"]))));
          });
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ log: stdout.trim() === "" ? stdout : JSON.parse(stdout), stderr }).toEqual({
      log: ["close() returned", "200 streams ended"],
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // The steps run in the async context of the read() that asked, as the promise reaction of reader.read() did, and not
  // in that of whoever closes the stream. A consumer outside every context sees none. The close step still runs
  // inside controller.close(): it does not wait for a job because the two contexts differ. In Node.js v26.12.1 the
  // listeners see the store of the closer.
  it("the listeners see the AsyncLocalStorage store of the consumer, inside the call of the closer", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { Readable, Duplex } = require("node:stream");
          const { AsyncLocalStorage } = require("node:async_hooks");
          const storage = new AsyncLocalStorage();
          const turn = () => new Promise(resolve => setImmediate(resolve));
          const adapters = {
            "Readable.fromWeb": web => Readable.fromWeb(web),
            "Duplex.fromWeb": web => Duplex.fromWeb({ readable: web, writable: new WritableStream() }),
          };
          async function storesSeen(adapter, consumerStore, last) {
            const seen = [];
            let controller;
            let insideCloser = false;
            const where = () => storage.getStore() + (insideCloser ? ", inside the call of the closer" : "");
            const web = new ReadableStream({ start(c) { controller = c; } });
            const listen = () => {
              const stream = adapters[adapter](web);
              stream.on("readable", () => {
                seen.push("readable: " + where());
                while (stream.read() !== null);
              });
              for (const event of ["end", "error", "close"]) stream.on(event, () => seen.push(event + ": " + where()));
            };
            if (consumerStore === undefined) listen();
            else storage.run(consumerStore, listen);
            await turn();
            await turn();
            storage.run("producer", () => controller.enqueue(new Uint8Array(1)));
            await turn();
            await turn();
            storage.run("closer", () => {
              insideCloser = true;
              if (last === "close") controller.close();
              else controller.error(new Error("boom"));
              insideCloser = false;
              seen.push("the closer after its call: " + storage.getStore());
            });
            for (let i = 0; i < 4; i++) await turn();
            return seen;
          }
          // A second _read() while a read waits must not replace the context of the read that waits.
          async function secondRead() {
            let controller;
            const stream = Readable.fromWeb(new ReadableStream({ start(c) { controller = c; } }));
            const seen = [];
            storage.run("first", () => stream.on("data", () => seen.push("data: " + storage.getStore())));
            await turn();
            storage.run("second", () => stream._read());
            await turn();
            controller.enqueue(new Uint8Array(1));
            controller.enqueue(new Uint8Array(1));
            seen.push("chunks that the web stream still has: " + (1 - controller.desiredSize));
            await turn();
            await turn();
            return seen;
          }
          (async () => {
            const result = {};
            for (const adapter of Object.keys(adapters))
              for (const consumerStore of ["consumer", undefined])
                for (const last of ["close", "error"])
                  result[adapter + ", consumer store " + consumerStore + ", " + last] = await storesSeen(adapter, consumerStore, last);
            result["a second _read() while a read waits"] = await secondRead();
            console.log(JSON.stringify(result));
          })();
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const closed = store => [
      `readable: ${store}`,
      `readable: ${store}, inside the call of the closer`,
      "the closer after its call: closer",
      `end: ${store}`,
      `close: ${store}`,
    ];
    const errored = store => [
      `readable: ${store}`,
      "the closer after its call: closer",
      `error: ${store}`,
      `close: ${store}`,
    ];
    expect({ seen: stdout.trim() === "" ? stdout : JSON.parse(stdout), stderr }).toEqual({
      seen: {
        "Readable.fromWeb, consumer store consumer, close": closed("consumer"),
        "Readable.fromWeb, consumer store consumer, error": errored("consumer"),
        "Readable.fromWeb, consumer store undefined, close": closed("undefined"),
        "Readable.fromWeb, consumer store undefined, error": errored("undefined"),
        "Duplex.fromWeb, consumer store consumer, close": closed("consumer"),
        "Duplex.fromWeb, consumer store consumer, error": errored("consumer"),
        "Duplex.fromWeb, consumer store undefined, close": closed("undefined"),
        "Duplex.fromWeb, consumer store undefined, error": errored("undefined"),
        "a second _read() while a read waits": [
          "chunks that the web stream still has: 1",
          "data: first",
          "data: first",
        ],
      },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // A read that waits in the web stream is all that holds the node stream: stream, reader, read request, node stream.
  it("a node stream that only its waiting read holds outlives a collection, also one inside a step", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { Readable, Duplex } = require("node:stream");
          const turn = () => new Promise(resolve => setImmediate(resolve));
          const count = 100;
          const controllers = [];
          const seen = { data: 0, readable: 0, end: 0, error: 0 };
          (() => {
            for (let i = 0; i < count; i++) {
              const web = new ReadableStream({ start(c) { controllers.push(c); } });
              const stream = i % 2 ? Readable.fromWeb(web) : Duplex.fromWeb({ readable: web, writable: new WritableStream() });
              // Stream 1 is paused: its 'readable' listener runs inside the close step.
              if (i === 1) {
                stream.on("readable", () => {
                  seen.readable++;
                  Bun.gc(true);
                  if (stream.read() !== null) seen.data++;
                });
              } else {
                stream.on("data", () => {
                  seen.data++;
                  if (i === 0) Bun.gc(true);
                });
              }
              stream.on("end", () => seen.end++);
              stream.on("error", () => seen.error++);
            }
          })();
          (async () => {
            await turn();
            await turn();
            Bun.gc(true);
            for (const controller of controllers) controller.enqueue(new Uint8Array(8));
            await turn();
            await turn();
            controllers.forEach((controller, i) => (i % 5 === 0 ? controller.error(new Error("boom")) : controller.close()));
            for (let i = 0; i < 4; i++) await turn();
            console.log(JSON.stringify(seen));
          })();
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ seen: stdout.trim() === "" ? stdout : JSON.parse(stdout), stderr }).toEqual({
      seen: { data: 100, readable: 2, end: 80, error: 20 },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // With no read waiting, the web stream holds nothing of the adapter: not the node stream, and not the async context
  // of the read that finished. The web streams stay alive here, through their controllers.
  it("a web stream holds neither an idle Readable.fromWeb() nor the store of its last read", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { Readable } = require("node:stream");
          const { AsyncLocalStorage } = require("node:async_hooks");
          const storage = new AsyncLocalStorage();
          const turn = () => new Promise(resolve => setImmediate(resolve));
          const count = 200;
          const controllers = [];
          // In a scope of its own: start() must not close over a variable that holds the node stream.
          const openStream = () => new ReadableStream({ start(c) { controllers.push(c); } });
          const nodeStreams = [];
          const stores = [];
          let kept = [];
          (() => {
            for (let i = 0; i < count; i++) {
              // One byte fills the buffer, so the node stream reads once and then waits for its consumer.
              const stream = Readable.fromWeb(openStream(), { highWaterMark: 1 });
              const store = { i };
              storage.run(store, () => stream.read(0));
              kept.push(stream);
              nodeStreams.push(new WeakRef(stream));
              stores.push(new WeakRef(store));
            }
          })();
          (async () => {
            await turn();
            for (const controller of controllers) controller.enqueue(new Uint8Array(1));
            await turn();
            await turn();
            const buffered = kept.filter(stream => stream.readableLength === 1).length;
            // The node streams are still held: only the operation could hold the stores now.
            for (let i = 0; i < 3; i++) {
              Bun.gc(true);
              await turn();
            }
            const storesHeld = stores.filter(ref => ref.deref() !== undefined).length;
            kept = null;
            for (let i = 0; i < 3; i++) {
              Bun.gc(true);
              await turn();
            }
            const nodeStreamsHeld = nodeStreams.filter(ref => ref.deref() !== undefined).length;
            console.log(JSON.stringify({ buffered, webStreams: controllers.length, storesHeld, nodeStreamsHeld }));
          })();
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { storesHeld, nodeStreamsHeld, ...rest } = JSON.parse(stdout);
    expect(rest).toEqual({ buffered: 200, webStreams: 200 });
    // A reference from the web stream holds all 200.
    expect(storesHeld).toBeLessThan(20);
    expect(nodeStreamsHeld).toBeLessThan(20);
    expect(exitCode).toBe(0);
  });

  // Duplex.fromWeb() and the bodies of node-fetch and undici read a fetch body, which has a native source, through
  // the read request: its chunks, its end, and its error when the connection breaks.
  describe.each([
    [
      "Duplex.fromWeb",
      async url => Duplex.fromWeb({ readable: (await fetch(url)).body, writable: new WritableStream() }),
    ],
    ["a node-fetch body", async url => (await nodeFetch(url)).body],
    ["an undici body", async url => (await undiciRequest(url)).body],
  ])("%s over a fetch body", (_, bodyOf) => {
    const eventsOf = body =>
      new Promise(resolve => {
        const events = [];
        body.on("data", data => events.push(`data: ${data}`));
        body.on("end", () => events.push("end"));
        body.on("error", () => events.push("error"));
        body.on("close", () => resolve(events));
      });

    it("gets every chunk and the end", async () => {
      const secondChunk = Promise.withResolvers();
      await using server = Bun.serve({
        port: 0,
        fetch: () =>
          new Response(
            new ReadableStream({
              async pull(controller) {
                controller.enqueue("hello ");
                await secondChunk.promise;
                controller.enqueue("world");
                controller.close();
              },
            }),
          ),
      });
      const body = await bodyOf(server.url.href);
      const events = eventsOf(body);
      body.once("data", () => secondChunk.resolve());
      expect(await events).toEqual(["data: hello ", "data: world", "end"]);
    });

    it("gets the error of a connection that breaks", async () => {
      const firstChunk = Promise.withResolvers();
      using server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          data(socket) {
            // The head and one chunk of a body that never completes.
            socket.write("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n");
            firstChunk.promise.then(() => socket.terminate());
          },
        },
      });
      const body = await bodyOf(`http://127.0.0.1:${server.port}/`);
      const events = eventsOf(body);
      body.once("data", () => firstChunk.resolve());
      expect(await events).toEqual(["data: hello", "error"]);
    });
  });
});

it("#9242.5 Stream has constructor", () => {
  const s = new Stream({});
  expect(s.constructor).toBe(Stream);
});
it("#9242.6 Readable has constructor", () => {
  const r = new Readable({});
  expect(r.constructor).toBe(Readable);
});
it("#9242.7 Writable has constructor", () => {
  const w = new Writable({});
  expect(w.constructor).toBe(Writable);
});
it("#9242.8 Duplex has constructor", () => {
  const d = new Duplex({});
  expect(d.constructor).toBe(Duplex);
});
it("#9242.9 Transform has constructor", () => {
  const t = new Transform({});
  expect(t.constructor).toBe(Transform);
});
it("#9242.10 PassThrough has constructor", () => {
  const pt = new PassThrough({});
  expect(pt.constructor).toBe(PassThrough);
});

it("should send Readable events in the right order", async () => {
  const package_dir = tmpdirSync();
  const fixture_path = join(package_dir, "fixture.js");

  await Bun.write(
    fixture_path,
    String.raw`
    function patchEmitter(emitter, prefix) {
      var oldEmit = emitter.emit;

      emitter.emit = function () {
        console.log([prefix, arguments[0]]);
        oldEmit.apply(emitter, arguments);
      };
    }

    const stream = require("node:stream");

    const readable = new stream.Readable({
      read() {
        this.push("Hello ");
        this.push("World!\n");
        this.push(null);
      },
    });
    patchEmitter(readable, "readable");

    const webReadable = stream.Readable.toWeb(readable);

    const result = await new Response(webReadable).text();
    console.log([1, result]);
    `,
  );

  const { stdout, stderr } = Bun.spawn({
    cmd: [bunExe(), "run", fixture_path],
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env: bunEnv,
  });
  const err = await stderr.text();
  expect(err).toBeEmpty();
  const out = await stdout.text();
  expect(out.split("\n")).toEqual([
    `[ "readable", "pause" ]`,
    `[ "readable", "resume" ]`,
    `[ "readable", "data" ]`,
    `[ "readable", "data" ]`,
    `[ "readable", "readable" ]`,
    `[ "readable", "end" ]`,
    `[ "readable", "close" ]`,
    `[ 1, "Hello World!\\n" ]`,
    ``,
  ]);
});

it("emits newListener event _before_ adding the listener", () => {
  const cb = jest.fn(event => {
    expect(stream.listenerCount(event)).toBe(0);
  });
  const stream = new Stream();
  stream.on("newListener", cb);
  stream.on("foo", () => {});
  expect(cb).toHaveBeenCalled();
});

it("reports error", () => {
  expect(() => {
    const dup = new Duplex({
      read() {
        this.push("Hello World!\n");
        this.push(null);
      },
      write(chunk, encoding, callback) {
        callback(new Error("test"));
      },
    });

    dup.emit("error", new Error("test"));
  }).toThrow("test");
});

it("should correctly call removed listeners", () => {
  const s = new Stream();
  let l2Called = false;
  const l1 = () => {
    s.removeListener("x", l2);
  };
  const l2 = () => {
    l2Called = true;
  };
  s.on("x", l1);
  s.on("x", l2);

  s.emit("x");
  expect(l2Called).toBeTrue();
});

it("should emit prefinish on current tick", done => {
  class UpperCaseTransform extends Transform {
    _transform(chunk, encoding, callback) {
      this.push(chunk.toString().toUpperCase());
      callback();
    }
  }

  const upperCaseTransform = new UpperCaseTransform();

  let prefinishCalled = false;
  upperCaseTransform.on("prefinish", () => {
    prefinishCalled = true;
  });

  let finishCalled = false;
  upperCaseTransform.on("finish", () => {
    finishCalled = true;
  });

  upperCaseTransform.end("hi");

  expect(prefinishCalled).toBeTrue();

  const res = upperCaseTransform.read();
  expect(res.toString()).toBe("HI");

  expect(finishCalled).toBeFalse();

  process.nextTick(() => {
    expect(finishCalled).toBeTrue();
    done();
  });
});

describe("webstreams adapters (Node v26 sync)", () => {
  // Upstream: test-whatwg-webstreams-adapters-to-writablestream.js
  // (nodejs/node#61197, fixes nodejs/node#61145)
  it("Writable.toWeb does not hang when 'drain' is emitted synchronously during write()", async () => {
    const writable = new Writable({
      write(chunk, encoding, callback) {
        callback();
      },
    });

    // Force synchronous 'drain' emission during write() to simulate a
    // stream that doesn't have Node.js's built-in kSync protection.
    writable.write = function (chunk) {
      this.emit("drain");
      return false;
    };

    const writableStream = Writable.toWeb(writable);
    const writer = writableStream.getWriter();
    await writer.write(new Uint8Array([1, 2, 3]));
    await writer.write(new Uint8Array([4, 5, 6]));
  });

  // Upstream: nodejs/node#62986 (fixes nodejs/node#56269, oven-sh/bun#34588) —
  // non-object-mode Writable.toWeb must size chunks in bytes so desiredSize
  // reflects the byte-based highWaterMark.
  it("Writable.toWeb desiredSize is byte-based for non-object-mode writables", () => {
    const writable = new Writable({
      highWaterMark: 1024,
      write(chunk, encoding, callback) {
        // hold the write in flight so the chunk stays queued
      },
    });

    const writer = Writable.toWeb(writable).getWriter();
    expect(writer.desiredSize).toBe(1024);
    void writer.write(new Uint8Array(64 * 1024));
    // 1024 - 65536; without byte sizing this would be 1023.
    expect(writer.desiredSize).toBe(1024 - 64 * 1024);
  });

  it("pipeTo into Writable.toWeb applies backpressure instead of buffering the whole source (#34588)", async () => {
    const TOTAL = 20;
    let writes = 0;
    let writeArrived = Promise.withResolvers();
    const writable = new Writable({
      highWaterMark: 1024,
      write(chunk, encoding, callback) {
        writes++;
        writeArrived.resolve(callback);
      },
    });

    let pulled = 0;
    const chunk = new Uint8Array(64 * 1024);
    const source = new ReadableStream(
      {
        pull(controller) {
          pulled++;
          if (pulled > TOTAL) return controller.close();
          controller.enqueue(chunk.slice());
        },
      },
      { highWaterMark: 1, size: c => c.byteLength },
    );

    const pipe = source.pipeTo(Writable.toWeb(writable));

    // Hold the first write in flight and let pending microtasks drain; with
    // backpressure the source is only a few chunks ahead, without it the
    // whole source (TOTAL + 1 pulls) is buffered while the sink is blocked.
    const firstCallback = await writeArrived.promise;
    await new Promise(resolve => setImmediate(resolve));
    expect(pulled).toBeLessThanOrEqual(4);

    writeArrived = Promise.withResolvers();
    firstCallback();
    while (writes < TOTAL) {
      const callback = await writeArrived.promise;
      writeArrived = Promise.withResolvers();
      callback();
    }
    await pipe;
    expect(writes).toBe(TOTAL);
  });

  // newStreamWritableFromWritableStream's write() decodes string chunks that
  // reach _write undecoded, using TypedArrayPrototypeGetBuffer/ByteOffset/
  // ByteLength from internal/primordials. Those three were missing from
  // Bun's primordials, so this path threw "TypedArrayPrototypeGetBuffer is
  // not a function" where Node hands the sink a plain Uint8Array.
  it("Writable.fromWeb _write decodes non-utf8 string chunks like Node", async () => {
    const chunks = [];
    const ws = new WritableStream({
      write(chunk) {
        chunks.push(chunk);
      },
    });
    const w = Writable.fromWeb(ws);
    await new Promise((resolve, reject) => {
      w._write("68656c6c6f", "hex", err => (err ? reject(err) : resolve()));
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].constructor).toBe(Uint8Array);
    expect(chunks[0]).toEqual(new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]));
  });

  it("Duplex.fromWeb _write decodes non-utf8 string chunks like Node", async () => {
    const chunks = [];
    const pair = {
      readable: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      writable: new WritableStream({
        write(chunk) {
          chunks.push(chunk);
        },
      }),
    };
    const d = Duplex.fromWeb(pair);
    await new Promise((resolve, reject) => {
      d._write("aGVsbG8=", "base64", err => (err ? reject(err) : resolve()));
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].constructor).toBe(Uint8Array);
    expect(chunks[0]).toEqual(new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]));
  });

  // Upstream: v26 newStreamWritableFromWritableStream writev done() shape —
  // a rejected chunk write during a corked writev must error the stream with
  // the original error and must not produce an unhandled rejection.
  it("Writable.fromWeb writev rejection errors the stream with the original error", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { Writable } = require("node:stream");
          const theError = new Error("boom");
          const ws = new WritableStream({
            write() {
              return Promise.reject(theError);
            },
          });
          const w = Writable.fromWeb(ws);
          process.on("unhandledRejection", () => {
            console.log("UNHANDLED");
            process.exit(2);
          });
          w.on("error", e => {
            console.log("error-is-original:" + (e === theError));
          });
          w.cork();
          w.write("a");
          w.write("b");
          process.nextTick(() => w.uncork());
        `,
      ],
      env: bunEnv,
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("error-is-original:true");
    expect(exitCode).toBe(0);
  });

  // Upstream: test-stream-readable-to-web.js (v26) — options.type: 'bytes'
  it("Readable.toWeb supports options.type: 'bytes' (BYOB)", async () => {
    const readable = Readable.from([new Uint8Array([1, 2, 3])]);
    const rs = Readable.toWeb(readable, { type: "bytes" });
    const reader = rs.getReader({ mode: "byob" });

    const first = await reader.read(new Uint8Array(10));
    expect(first.done).toBe(false);
    expect(Array.from(first.value)).toEqual([1, 2, 3]);

    const second = await reader.read(new Uint8Array(10));
    expect(second.done).toBe(true);
  });

  it("Readable.toWeb validates options", () => {
    const readable = Readable.from(["x"]);
    expect(() => Readable.toWeb(readable, null)).toThrow();
    try {
      Readable.toWeb(readable, null);
    } catch (e) {
      expect(e.code).toBe("ERR_INVALID_ARG_TYPE");
    }
    try {
      Readable.toWeb(readable, { type: "banana" });
      expect.unreachable();
    } catch (e) {
      expect(e.code).toBe("ERR_INVALID_ARG_VALUE");
    }
    readable.destroy();
  });

  // Upstream: test-stream-readable-to-web-termination.js (v26) — a readable
  // already destroyed with an error must produce an errored ReadableStream,
  // not a canceled empty one.
  it("Readable.toWeb propagates the destroy error of an already-destroyed readable", async () => {
    const readable = new Readable({ read() {} });
    const theError = new Error("destroy-err");
    readable.on("error", () => {});
    readable.destroy(theError);
    await new Promise(resolve => readable.on("close", resolve));

    const rs = Readable.toWeb(readable);
    await expect(rs.getReader().read()).rejects.toBe(theError);
  });

  it("Readable.toWeb closes cleanly for an already-ended readable", async () => {
    const readable = new Readable({ read() {} });
    readable.push(null);
    readable.read();
    await new Promise(resolve => readable.on("close", resolve));

    const rs = Readable.toWeb(readable);
    const { done } = await rs.getReader().read();
    expect(done).toBe(true);
  });

  // The toWeb adapter's pull() calls resume() on the source. After 'end' and
  // autoDestroy, Node 26's resume() is a no-op on destroyed streams, so the
  // source is left paused / non-flowing. We narrow that guard (see the
  // fd-slicer test below) but must still match Node's resting state here.
  it("Readable.toWeb leaves the source paused / non-flowing after EOF", async () => {
    const src = Readable.from([Buffer.from("a"), Buffer.from("b")], { objectMode: false });
    const reader = Readable.toWeb(src).getReader();
    const chunks = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    await new Promise(resolve => (src.closed ? resolve() : src.once("close", resolve)));
    expect(Buffer.concat(chunks).toString()).toBe("ab");
    expect({
      readableEnded: src.readableEnded,
      destroyed: src.destroyed,
      readableFlowing: src.readableFlowing,
      isPaused: src.isPaused(),
    }).toEqual({
      readableEnded: true,
      destroyed: true,
      readableFlowing: false,
      isPaused: true,
    });
  });

  // Upstream: v26 adapters use eos(stream, { writable: false }) so a Duplex
  // readable side completes without waiting for the half-open writable side.
  it("Readable.toWeb of a half-open Duplex closes when the readable side ends", async () => {
    const duplex = new Duplex({
      read() {
        this.push(null);
      },
      write(chunk, encoding, callback) {
        callback();
      },
    });
    const rs = Readable.toWeb(duplex);
    const { done } = await rs.getReader().read();
    expect(done).toBe(true);
    expect(duplex.writable).toBe(true);
  });

  // Upstream: Duplex.toWeb(duplex, { readableType: 'bytes' })
  it("Duplex.toWeb supports options.readableType: 'bytes'", async () => {
    const duplex = new PassThrough();
    const pair = Duplex.toWeb(duplex, { readableType: "bytes" });
    duplex.end(new Uint8Array([5, 6]));

    const reader = pair.readable.getReader({ mode: "byob" });
    const { value } = await reader.read(new Uint8Array(4));
    expect(Array.from(value)).toEqual([5, 6]);
  });

  // Upstream: DEP0201 — options.type is a deprecated alias for options.readableType
  it("Duplex.toWeb emits DEP0201 for the deprecated options.type alias", async () => {
    const warning = new Promise(resolve => process.once("warning", resolve));
    const duplex = new PassThrough();
    Duplex.toWeb(duplex, { type: "bytes" });
    const w = await warning;
    expect(w.name).toBe("DeprecationWarning");
    expect(w.code).toBe("DEP0201");
    duplex.destroy();
  });

  it("Readable.fromWeb(Readable.toWeb()) preserves chunk order", async () => {
    const src = Readable.from(["A", "B", "C", "D", "E", "F"]);
    const chunks = [];
    for await (const chunk of Readable.fromWeb(Readable.toWeb(src))) {
      chunks.push(chunk.toString());
    }
    expect(chunks.join("")).toBe("ABCDEF");
  });

  it("Readable.fromWeb(Readable.toWeb()) preserves chunk order in object mode", async () => {
    const expected = Array.from({ length: 30 }, (_, i) => `chunk-${i}`);
    const src = Readable.from(expected);
    const chunks = [];
    for await (const chunk of Readable.fromWeb(Readable.toWeb(src), { objectMode: true })) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(expected);
  });

  it("Readable.fromWeb(Readable.toWeb()) preserves chunk order under backpressure", async () => {
    const expected = Array.from({ length: 25 }, (_, i) => `x${i}`);
    const src = Readable.from(expected);
    const dst = Readable.fromWeb(Readable.toWeb(src), { objectMode: true, highWaterMark: 2 });
    const chunks = [];
    for await (const chunk of dst) {
      chunks.push(chunk);
      await null;
    }
    expect(chunks).toEqual(expected);
  });

  // Paused mode drains inside the 'readable' handler, so no microtask runs
  // between read() calls. _read() has to be able to start the next pump on
  // every one of them or the stream stalls with kReading stuck on.
  it.each([1, 2, 16])(
    "Readable.fromWeb(Readable.toWeb()) preserves chunk order in paused mode (highWaterMark: %i)",
    async highWaterMark => {
      const expected = Array.from({ length: 30 }, (_, i) => `p${i}`);
      const src = Readable.from(expected);
      const dst = Readable.fromWeb(Readable.toWeb(src), { objectMode: true, highWaterMark });

      const { promise, resolve, reject } = Promise.withResolvers();
      const chunks = [];
      dst.on("readable", () => {
        let chunk;
        while ((chunk = dst.read()) !== null) chunks.push(chunk);
      });
      dst.on("end", resolve);
      dst.on("error", reject);
      await promise;

      expect(chunks).toEqual(expected);
    },
  );

  it("Readable.fromWeb(Readable.toWeb()) preserves chunk order in flowing mode", async () => {
    const expected = Array.from({ length: 30 }, (_, i) => `f${i}`);
    const src = Readable.from(expected);
    const dst = Readable.fromWeb(Readable.toWeb(src), { objectMode: true, highWaterMark: 1 });

    const { promise, resolve, reject } = Promise.withResolvers();
    const chunks = [];
    dst.on("data", chunk => chunks.push(chunk));
    dst.on("end", resolve);
    dst.on("error", reject);
    await promise;

    expect(chunks).toEqual(expected);
  });

  // Node ends the Readable when destroy() cancels a read of the web stream that waits. With no read waiting, the
  // premature close stays. https://github.com/nodejs/node/blob/v26.12.1/lib/internal/webstreams/adapters.js#L688-L690
  const fromWebDestroyFixture = join(import.meta.dir, "readable-from-web-destroy-fixture.js");
  const fromWebDestroyExpected = `read() waits, destroy()
  always: locked=true | close | finished=ok source.cancel(null) ended=true
for await waits, destroy()
  always: resolves [] | close | finished=ok source.cancel(null) ended=true
for await took a chunk and waits, destroy()
  always: resolves [3] | close | finished=ok source.cancel(null) ended=true
for await and destroy() in one tick
  always: resolves [] | close | finished=ok source.cancel(null) ended=true
toArray() waits, destroy()
  always: resolves [] | close | finished=ok source.cancel(null) ended=true
'data' listener, a read waits, destroy()
  always: end close | finished=ok source.cancel(null) ended=true
'data' listener took a chunk, a read waits, destroy()
  always: data:3 end close | finished=ok source.cancel(null) ended=true
'data' listener, encoding utf8, half a character is held, a read waits, destroy()
  always: data:U+FFFD end close | finished=ok source.cancel(null) ended=true
pipe(dest), a read waits, destroy()
  always: end close | finished=ok source.cancel(null) ended=true dest.finished=true
pipe(dest), encoding utf8, half a character is held, a read waits, destroy()
  always: dest.write:U+FFFD end close | finished=ok source.cancel(null) ended=true dest.finished=true
pipeline(r, dest), a read waits, destroy()
  always: end close | finished=ok source.cancel(null) ended=true dest.finished=true pipeline=ok
pipeline(r, dest, { end: false }), a read waits, destroy()
  always: end close | finished=ok source.cancel(null) ended=true dest.finished=false pipeline=ok
new Response(r).arrayBuffer() took a chunk, a read waits, destroy()
  always: resolves 3 | close | finished=ok source.cancel(null) ended=true
read() waits, the source enqueues null, destroy()
  promise job, nextTick, setImmediate: close | finished=ok source.cancel(null) ended=true
  promise job over a bytes source, nextTick over a bytes source, setImmediate over a bytes source: enqueue(null) throws | close | finished=ok source.cancel(null) ended=true
read() waits, destroy(error)
  always: error:boom close | finished=boom source.cancel(boom) ended=true
for await waits, destroy(error)
  always: rejects boom | error:boom close | finished=boom source.cancel(boom) ended=true
'data' listener, encoding utf8, half a character is held, a read waits, destroy(error)
  always: data:U+FFFD error:boom close | finished=boom source.cancel(boom) ended=true
pipe(dest), encoding utf8, half a character is held, a read waits, destroy(error)
  always: dest.write:U+FFFD error:boom close | finished=boom source.cancel(boom) ended=true dest.finished=false
read() waits, the source closes, destroy()
  always: close | finished=ok source.cancel() ended=true
TransformStream: read() waits, destroy()
  always: close | finished=ok source.cancel() ended=true
tee() branch: 'data' listener, a read waits, destroy()
  always: end | finished=ok source.cancel() ended=true
'data' listener, pull() of the source calls destroy()
  always: end close | finished=ok source.cancel(null) ended=true
a chunk is buffered, the next read waits, destroy()
  always: buffered=3 | close | finished=ERR_STREAM_PREMATURE_CLOSE source.cancel(null) ended=true
Duplex.from(r) with a 'data' listener, a read waits, destroy()
  always: close | finished=ok source.cancel(null) ended=true duplex=never
for await over Duplex.from(r) waits, destroy()
  always: never | close | finished=ok source.cancel(null) ended=true
pipeline(Duplex.from(r), dest), a read waits, destroy()
  always: close | finished=ok source.cancel(null) ended=true dest.finished=false pipeline=never
read() waits, destroy(), then pipeline(r, dest) after 'close'
  always: close | finished=ok source.cancel(null) ended=true dest.finished=false pipeline=never
destroy() before the first read
  always: close | finished=ERR_STREAM_PREMATURE_CLOSE source.cancel(null) ended=false
resume() and destroy() in one tick
  always: close | finished=ERR_STREAM_PREMATURE_CLOSE source.cancel(null) ended=false
destroy() in a 'data' listener
  always: data:3 close | finished=ERR_STREAM_PREMATURE_CLOSE source.cancel(null) ended=false
a chunk is queued, read() and destroy() in one tick
  always: close | finished=ERR_STREAM_PREMATURE_CLOSE source.cancel(null) ended=false
read() waits, the source has a chunk, destroy()
  always: close | finished=ERR_STREAM_PREMATURE_CLOSE source.cancel(null) ended=false
`;
  for (const [name, runtime] of [
    ["bun", bunExe()],
    // v26.3.0 and v26.12.1 print this text. They differ in when the EOF arrives, which the fixture leaves out.
    ["node", nodeExeAtLeast("26.3.0")],
  ]) {
    it.skipIf(!runtime)(
      `Readable.fromWeb: destroy() ends a stream whose read waits, as node does (${name})`,
      async () => {
        await using proc = Bun.spawn({
          cmd: [runtime, fromWebDestroyFixture],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({ stdout, stderr, exitCode }).toEqual({ stdout: fromWebDestroyExpected, stderr: "", exitCode: 0 });
      },
    );
  }

  // Node has no direct streams. They follow the default ones.
  it("Readable.fromWeb(direct stream): destroy() ends a stream whose read waits", async () => {
    const r = Readable.fromWeb(new ReadableStream({ type: "direct", pull: () => new Promise(() => {}) }));
    r.read();
    r.destroy();
    expect(await finishedP(r)).toBeUndefined();
    expect(r._readableState.ended).toBe(true);
  });

  // A pipeline() that hangs must fail the test at once, not at the timeout of the runner.
  const outcomeOf = async pipelined => {
    const turns = (async () => {
      for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
      return "never settles";
    })();
    return Promise.race([
      pipelined.then(
        () => "resolves",
        error => error.code,
      ),
      turns,
    ]);
  };
  // pull() runs inside the first read(), closes the source and destroys the Readable that reads it.
  const closedAndDestroyedByPull = async () => {
    const ctx = {};
    const web = new ReadableStream(
      {
        pull(controller) {
          controller.close();
          ctx.r.destroy();
        },
      },
      { highWaterMark: 0 },
    );
    // Once the source has started, read() calls pull() before it returns.
    await new Promise(resolve => setImmediate(resolve));
    ctx.r = Readable.fromWeb(web);
    ctx.dest = new Writable({ write: (chunk, encoding, callback) => callback() });
    return ctx;
  };

  // The node stream has its EOF inside close(), before pull() destroys it. So 'end' comes ahead of 'close' and the
  // pipeline completes, as in Node.js from v26.9.0 on. Before, Node.js never called back here.
  it("Readable.fromWeb: pipeline() resolves when pull() closes the source and then destroys the Readable", async () => {
    const { r, dest } = await closedAndDestroyedByPull();
    expect({ outcome: await outcomeOf(pipelineP(r, dest)), destDestroyed: dest.destroyed }).toEqual({
      outcome: "resolves",
      destDestroyed: true,
    });
  });

  // A stream that has its EOF and closes before 'end' never emits 'end', and pipeline() ends its destination on
  // 'end'. So it never calls back, as in Node.js, which pushes the same EOF inside destroy(). Without that EOF
  // pipeline() reports ERR_STREAM_PREMATURE_CLOSE.
  it.each([
    ["after the Readable closed", "never settles"],
    ["in the tick of destroy()", "never settles"],
  ])(
    "Readable.fromWeb: pipeline() whose destination holds a write when destroy() runs, the write released %s",
    async (when, outcome) => {
      let pulls = 0;
      const nextReadWaits = Promise.withResolvers();
      const web = new ReadableStream(
        {
          pull(controller) {
            if (pulls++ === 0) controller.enqueue(new Uint8Array(8));
            else nextReadWaits.resolve();
          },
        },
        { highWaterMark: 0 },
      );
      const r = Readable.fromWeb(web);
      const heldWrite = Promise.withResolvers();
      const dest = new Writable({
        highWaterMark: 1,
        write: (chunk, encoding, callback) => heldWrite.resolve(callback),
      });
      const pipelined = pipelineP(r, dest);
      const release = await heldWrite.promise;
      await nextReadWaits.promise;
      const flowing = r.readableFlowing;
      const closed = new Promise(resolve => r.once("close", resolve));
      r.destroy();
      if (when === "after the Readable closed") await closed;
      release();
      expect({ flowing, outcome: await outcomeOf(pipelined) }).toEqual({ flowing: false, outcome });
    },
  );

  // One chunk, then every read of the source waits.
  const oneChunkThenWaits = () => {
    let pulls = 0;
    const nextReadWaits = Promise.withResolvers();
    const web = new ReadableStream(
      {
        pull(controller) {
          if (pulls++ === 0) controller.enqueue(new TextEncoder().encode("partial"));
          else nextReadWaits.resolve();
        },
      },
      { highWaterMark: 0 },
    );
    return { r: Readable.fromWeb(web), nextReadWaits: nextReadWaits.promise };
  };

  // Bun's own sinks read a Node stream through its async iterator, so the end of that stream is the end of the body.
  it.each([
    ["destroy()", undefined, "resolves partial"],
    ["destroy(error)", new Error("stop"), "rejects"],
  ])("Bun.serve: a Readable.fromWeb() body that stops with %s", async (_, error, outcome) => {
    const { r, nextReadWaits } = oneChunkThenWaits();
    r.on("error", () => {});
    await using server = Bun.serve({ port: 0, development: false, fetch: () => new Response(r) });
    const response = await fetch(server.url);
    await nextReadWaits;
    r.destroy(error);
    const body = await response.text().then(
      text => `resolves ${text}`,
      () => "rejects",
    );
    expect(body).toBe(outcome);
  });

  it("Bun.write: a Readable.fromWeb() body that stops with destroy() gives the bytes so far", async () => {
    using dir = tempDir("fromweb-destroy", {});
    const file = join(String(dir), "body");
    const { r, nextReadWaits } = oneChunkThenWaits();
    const written = Bun.write(file, new Response(r));
    await nextReadWaits;
    r.destroy();
    expect({ written: await written, content: await Bun.file(file).text() }).toEqual({
      written: 7,
      content: "partial",
    });
  });

  // The node-fetch and undici bodies use the class of Readable.fromWeb(), but in Node they are plain Readables:
  // node-fetch reports ERR_STREAM_PREMATURE_CLOSE here too, and undici reports UND_ERR_ABORTED.
  it.each([
    ["node-fetch", async url => (await nodeFetch(url)).body],
    ["undici", async url => (await undiciRequest(url)).body],
  ])("a %s body does not end when destroy() cancels a read that waits", async (_, bodyOf) => {
    // The head of a response, and never a byte of its body.
    using server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket) {
          socket.write("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n");
        },
      },
    });
    const body = await bodyOf(`http://127.0.0.1:${server.port}/`);
    const events = [];
    body.on("end", () => events.push("end"));
    body.read();
    body.destroy();
    const error = await finishedP(body).catch(error => error);
    expect({ code: error?.code, events, ended: body._readableState.ended }).toEqual({
      code: "ERR_STREAM_PREMATURE_CLOSE",
      events: [],
      ended: false,
    });
  });

  // Upstream: v26 Writable.toWeb wraps (Shared)ArrayBuffer chunks in a
  // Uint8Array before writing to the Node stream.
  it("Writable.toWeb accepts ArrayBuffer chunks", async () => {
    const chunks = [];
    const writable = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });
    const writer = Writable.toWeb(writable).getWriter();
    await writer.write(new TextEncoder().encode("ab").buffer);
    await writer.close();
    expect(chunks.length).toBe(1);
    expect(Buffer.concat(chunks).toString()).toBe("ab");
  });

  // Upstream: v26 end-of-stream only snapshots the AsyncLocalStorage context
  // when one is active at registration time; a callback registered outside
  // any context observes the context active when the stream settles.
  it("finished() callback registered outside an ALS context observes the firing context", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { Readable, finished } = require("node:stream");
          const { AsyncLocalStorage } = require("node:async_hooks");
          const als = new AsyncLocalStorage();
          const r = new Readable({ read() {} });
          finished(r, () => {
            console.log("store:" + als.getStore());
          });
          als.run("ctx", () => r.destroy());
        `,
      ],
      env: bunEnv,
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("store:ctx");
    expect(exitCode).toBe(0);
  });

  it("finished() callback registered inside an ALS context observes the registration context", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { Readable, finished } = require("node:stream");
          const { AsyncLocalStorage } = require("node:async_hooks");
          const als = new AsyncLocalStorage();
          const r = new Readable({ read() {} });
          als.run("reg-ctx", () => {
            finished(r, () => {
              console.log("store:" + als.getStore());
            });
          });
          r.destroy();
        `,
      ],
      env: bunEnv,
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("store:reg-ctx");
    expect(exitCode).toBe(0);
  });

  // Node supports finished() on WHATWG streams since v19. It must observe the terminal state
  // without locking the stream.
  describe("finished() on WHATWG streams", () => {
    it("ReadableStream that closes", async () => {
      let close;
      const rs = new ReadableStream({
        start(c) {
          close = () => c.close();
        },
      });
      const { promise, resolve } = Promise.withResolvers();
      expect(() => finished(rs, err => resolve(err))).not.toThrow();
      close();
      expect(await promise).toBeUndefined();
    });

    it("ReadableStream that errors", async () => {
      let error;
      const rs = new ReadableStream({
        start(c) {
          error = e => c.error(e);
        },
      });
      const { promise, resolve } = Promise.withResolvers();
      expect(() => finished(rs, err => resolve(err))).not.toThrow();
      error(new Error("rs-boom"));
      const err = await promise;
      expect(err?.message).toBe("rs-boom");
    });

    it("ReadableStream already closed", async () => {
      const rs = new ReadableStream({
        start(c) {
          c.close();
        },
      });
      await expect(finishedP(rs)).resolves.toBeUndefined();
    });

    it("ReadableStream already errored", async () => {
      const rs = new ReadableStream({
        start(c) {
          c.error(new Error("already"));
        },
      });
      await expect(finishedP(rs)).rejects.toThrow("already");
    });

    it("WritableStream that closes", async () => {
      const ws = new WritableStream({});
      const { promise, resolve } = Promise.withResolvers();
      expect(() => finished(ws, err => resolve(err))).not.toThrow();
      ws.close();
      expect(await promise).toBeUndefined();
    });

    it("WritableStream that errors", async () => {
      const ws = new WritableStream({});
      const { promise, resolve } = Promise.withResolvers();
      expect(() => finished(ws, err => resolve(err))).not.toThrow();
      ws.abort(new Error("ws-boom"));
      const err = await promise;
      expect(err?.message).toBe("ws-boom");
    });

    it("WritableStream already closed", async () => {
      const ws = new WritableStream({});
      await ws.close();
      await expect(finishedP(ws)).resolves.toBeUndefined();
    });

    it("WritableStream already errored", async () => {
      const ws = new WritableStream({});
      await ws.abort(new Error("already-ws"));
      await expect(finishedP(ws)).rejects.toThrow("already-ws");
    });

    it("ReadableStream cancelled", async () => {
      const rs = new ReadableStream({});
      const { promise, resolve } = Promise.withResolvers();
      finished(rs, err => resolve(err));
      await rs.cancel();
      expect(await promise).toBeUndefined();
    });

    it("does not lock the stream", async () => {
      const rs = new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array([1, 2]));
          c.close();
        },
      });
      finished(rs, () => {});
      expect(rs.locked).toBe(false);
      expect((await new Response(rs).arrayBuffer()).byteLength).toBe(2);
    });

    // Exercises the direct-stream close path, which writes the terminal state itself rather
    // than going through readableStreamClose().
    it("type: 'direct' ReadableStream consumed by a native sink (Bun.serve)", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const { finished } = require("node:stream");
            using server = Bun.serve({
              port: 0,
              fetch() {
                const rs = new ReadableStream({
                  type: "direct",
                  pull(c) { c.write(new Uint8Array([1, 2, 3])); c.end(); },
                });
                finished(rs, err => console.log("FINISHED:" + (err ? err.message : "ok")));
                return new Response(rs);
              },
            });
            const ab = await fetch(server.url).then(r => r.arrayBuffer());
            console.log("BYTES:" + ab.byteLength);
          `,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ out: stdout.trim().split("\n").sort(), err: stderr }).toEqual({
        out: ["BYTES:3", "FINISHED:ok"],
        err: "",
      });
      expect(exitCode).toBe(0);
    });
  });

  it("Duplex.toWeb doesn't throw when the duplex is destroyed with an error after the writer closed", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          import { Duplex } from "node:stream";
          const duplex = new Duplex({
            allowHalfOpen: false,
            read() {},
            write(chunk, encoding, callback) { callback(); },
            final(callback) { setImmediate(callback); },
          });
          const { readable, writable } = Duplex.toWeb(duplex);
          duplex.on("error", e => console.log("duplex error:" + e.message));
          duplex.on("close", () => console.log("close event, errored:" + duplex.errored?.message));
          duplex.push(null);
          const { done } = await readable.getReader().read();
          await writable.getWriter().close();
          console.log("close resolved, done:" + done);
          duplex.destroy(new Error("boom"));
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ out: stdout, err: stderr }).toEqual({
      out: "close resolved, done:true\nduplex error:boom\nclose event, errored:boom\n",
      err: "",
    });
    expect(exitCode).toBe(0);
  });
});

for (const size of [0x10, 0xffff, 0x10000, 0x1f000, 0x20000, 0x20010, 0x7ffff, 0x80000, 0xa0000, 0xa0010]) {
  it(`should emit 'readable' with null data and 'close' exactly once each, 0x${size.toString(16)} bytes`, async () => {
    const path = `${tmpdir()}/${Date.now()}.readable_and_close.txt`;
    writeFileSync(path, new Uint8Array(size));
    const stream = createReadStream(path);
    const close_resolvers = Promise.withResolvers();
    const readable_resolvers = Promise.withResolvers();

    stream.on("close", () => {
      close_resolvers.resolve();
    });

    stream.on("readable", () => {
      const data = stream.read();
      if (data === null) {
        readable_resolvers.resolve();
      }
    });

    await Promise.all([close_resolvers.promise, readable_resolvers.promise]);
  });
}

it("stream/iter consumers reject an unknown encoding with node's ERR_INVALID_ARG_VALUE RangeError", async () => {
  // Regression: ERR_INVALID_ARG_VALUE_RangeError had no case in
  // jsFunctionMakeErrorWithCode's switch, so the thrown error's message was
  // just the property name instead of node's formatted message.
  const script = `
    const { text, from } = require("node:stream/iter");
    text(from("hello"), { encoding: "not-a-real-encoding" }).then(
      () => console.log("FAIL: resolved"),
      err => console.log([err.name, err.code, err.message].join("|")),
    );
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--experimental-stream-iter", "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.trim()).toBe(
    "RangeError|ERR_INVALID_ARG_VALUE|The property 'options.encoding' is invalid. Received 'not-a-real-encoding'",
  );
  // Loading node:stream/iter emits an ExperimentalWarning to stderr.
  expect(stderr).toContain("ExperimentalWarning");
  expect(exitCode).toBe(0);
});

it("require.resolve.paths agrees with require about gated stream/iter specifiers", async () => {
  // Without the flag the introspection APIs must not report stream/iter as
  // a builtin (node returns a lookup-paths array there); with the flag they
  // must (null, like any builtin).
  const script = `
    const r = require.resolve.paths("stream/iter");
    console.log(Array.isArray(r) ? "array" : String(r));
  `;
  for (const [flags, expected] of [
    [[], "array"],
    [["--experimental-stream-iter"], "null"],
  ]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...flags, "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe(expected);
    expect(exitCode).toBe(0);
  }
});

// Node.js v26 semver-major stream semantics.
describe("node v26 stream semantics", () => {
  // Upstream: v26 howMuchToRead() fast path; covered upstream by the updated
  // test-stream2-readable-non-empty-end.js / test-stream-readable-emittedReadable.js.
  it("read() with no size returns one buffered chunk at a time in paused mode", async () => {
    const r = new Readable({ read() {} });
    r.push(Buffer.from("abc"));
    r.push(Buffer.from("de"));
    r.push(null);
    await new Promise(resolve => setImmediate(resolve));
    expect(r.read().toString()).toBe("abc");
    expect(r.read().toString()).toBe("de");
    expect(r.read()).toBeNull();
  });

  it("read() with no size still concatenates when setEncoding is active", async () => {
    const r = new Readable({ read() {} });
    r.setEncoding("utf8");
    r.push("abc");
    r.push("de");
    r.push(null);
    await new Promise(resolve => setImmediate(resolve));
    expect(r.read()).toBe("abcde");
    expect(r.read()).toBeNull();
  });

  // Upstream: nodejs/node#62557 (test-stream-destroy.js).
  it("pause() is a no-op on a destroyed stream", async () => {
    const r = new Readable({ read() {} });
    r.resume();
    r.destroy();
    const emitted = [];
    r.on("pause", () => emitted.push("pause"));
    expect(r.pause()).toBe(r);
    expect(r.readableFlowing).toBe(true);
    expect(r.isPaused()).toBe(false);
    await new Promise(resolve => setImmediate(resolve));
    expect(emitted).toEqual([]);
  });

  // A completed pipe unpipes the source, and unpipe() calls source.pause().
  // On a source that autoDestroy'd itself at 'end', that pause() must no-op so
  // the post-pipe readable state matches a plain resume()'d stream.
  it("a source autoDestroyed by a completed pipe stays flowing", async () => {
    const sink = () =>
      new Writable({
        write(chunk, encoding, callback) {
          callback();
        },
      });
    // 'unpipe' on the destination is emitted by Readable.prototype.unpipe right
    // after it calls source.pause(), so it is the exact point to assert on.
    const unpiped = dest => new Promise(resolve => dest.on("unpipe", resolve));

    const resumed = new PassThrough();
    resumed.resume();
    resumed.end("x");

    const pipedDest = sink();
    const piped = new PassThrough();
    piped.pipe(pipedDest);
    piped.end("x");

    // autoDestroy: false keeps the source alive, so unpipe() does pause it.
    const aliveDest = sink();
    const pipedAlive = new PassThrough({ autoDestroy: false });
    pipedAlive.pipe(aliveDest);
    pipedAlive.end("x");

    await Promise.all([new Promise(resolve => resumed.on("close", resolve)), unpiped(pipedDest), unpiped(aliveDest)]);

    const state = s => ({ readableFlowing: s.readableFlowing, isPaused: s.isPaused(), destroyed: s.destroyed });
    expect(state(resumed)).toEqual({ readableFlowing: true, isPaused: false, destroyed: true });
    expect(state(piped)).toEqual({ readableFlowing: true, isPaused: false, destroyed: true });
    expect(state(pipedAlive)).toEqual({ readableFlowing: false, isPaused: true, destroyed: false });
  });

  // Deliberate divergence from Node 26 (nodejs/node#62557 also made resume() a
  // no-op on destroyed streams): legacy Readable subclasses like fd-slicer
  // (yauzl → extract-zip → puppeteer/electron tooling) assign
  // `this.destroyed = true` via the prototype setter right before push(null).
  // With the upstream guard, a piped destination's drain can no longer resume
  // the source, so the final buffered chunk is silently dropped and the
  // pipeline never finishes. We keep the Node 24 behavior: a destroyed-flagged
  // stream still flushes its buffered data to a piped destination.
  it("drain still resumes a source that flagged itself destroyed before EOF (fd-slicer pattern)", async () => {
    const chunks = [Buffer.alloc(65536, 1), Buffer.alloc(65536, 2), Buffer.alloc(40000, 3)];
    const src = new Readable({
      read() {
        const chunk = chunks.shift();
        if (chunk) {
          this.push(chunk);
        } else {
          // fd-slicer's ReadStream._read: sets the destroyed flag (which hits
          // the prototype setter on modern streams) and then pushes EOF.
          this.destroyed = true;
          this.push(null);
        }
      },
    });
    // Small writableHighWaterMark forces write() to return false so the pipe
    // pauses and must be revived by 'drain' → src.resume().
    const slow = new Transform({
      writableHighWaterMark: 1024,
      transform(chunk, encoding, callback) {
        setImmediate(() => callback(null, chunk));
      },
    });
    let received = 0;
    slow.on("data", c => (received += c.length));
    const ended = new Promise((resolve, reject) => {
      slow.on("end", resolve);
      slow.on("error", reject);
    });
    src.pipe(slow);
    await ended;
    expect(received).toBe(65536 * 2 + 40000);
  });

  // Upstream: nodejs/node#60907 (test-stream-compose-operator.js).
  it("compose returns the composed Duplex directly", () => {
    expect(Object.hasOwn(Readable.prototype, "compose")).toBe(true);
    const composed = Readable.from(["a"]).compose(
      new Transform({
        transform(chunk, encoding, callback) {
          callback(null, chunk);
        },
      }),
    );
    expect(composed).toBeInstanceOf(Duplex);
  });

  it("compose rejects a non-writable destination with the streams[1] arg name", () => {
    let err;
    try {
      Readable.from(["a"]).compose(new Readable({ read() {} }));
    } catch (e) {
      err = e;
    }
    expect(err?.code).toBe("ERR_INVALID_ARG_VALUE");
    expect(err?.message).toContain("streams[1]");
  });

  it("compose validates the options argument", () => {
    let err;
    try {
      Readable.from(["a"]).compose(new PassThrough(), 42);
    } catch (e) {
      err = e;
    }
    expect(err?.code).toBe("ERR_INVALID_ARG_TYPE");
  });

  it("compose with an already-aborted signal errors the composed stream", async () => {
    const controller = new AbortController();
    controller.abort();
    const composed = Readable.from(["a"]).compose(new PassThrough(), { signal: controller.signal });
    const { promise, resolve } = Promise.withResolvers();
    composed.on("error", resolve);
    composed.resume();
    const err = await promise;
    expect(err.name).toBe("AbortError");
    expect(err.code).toBe("ABORT_ERR");
  });

  // Upstream: v26 test-stream-writable-decoded-encoding.js.
  it("write(string, 'buffer') throws ERR_UNKNOWN_ENCODING", () => {
    for (const opts of [{ decodeStrings: false }, {}]) {
      const w = new Writable({
        ...opts,
        write(chunk, encoding, callback) {
          callback();
        },
      });
      let err;
      try {
        w.write("hi", "buffer");
      } catch (e) {
        err = e;
      }
      expect(err?.code).toBe("ERR_UNKNOWN_ENCODING");

      // Buffer chunks with 'buffer' encoding still work.
      const w2 = new Writable({
        ...opts,
        write(chunk, encoding, callback) {
          callback();
        },
      });
      expect(w2.write(Buffer.from("x"), "buffer")).toBe(true);
    }
  });
});

describe("fromList string chunk boundary (nodejs/node#61884)", () => {
  it("read(n) with setEncoding does not over-read when n equals the buffered array length", () => {
    const r = new Readable({ read() {} });
    r.setEncoding("utf8");
    r.push("a");
    r.push("bcd");
    // With the v24 bug (`n === buf.length` instead of `n === str.length`),
    // read(3) returned "abcd".
    expect(r.read(3)).toBe("abc");
    expect(r.read(1)).toBe("d");
  });
});

it.each([
  ["base64", "YWJjZA=="],
  ["base64url", "YWJjZA"],
  ["hex", "61626364"],
])("setEncoding(%j) after the end keeps what the decoder holds back", (encoding, expected) => {
  const r = new Readable({ read() {} });
  r.push(Buffer.from("abcd"));
  r.push(null);
  r.setEncoding(encoding);
  expect(r.read()).toBe(expected);
});

describe("maybeReadMore is a no-op while a read is in flight (nodejs/node#60454)", () => {
  it("does not schedule a redundant _read while kReading is set", async () => {
    let reads = 0;
    const r = new Readable({
      highWaterMark: 1024,
      read() {
        reads++;
      },
    });

    r.read(10); // _read #1 is now in flight (kReading set, no sync push)
    expect(reads).toBe(1);

    // Old gate ((kReadingMore | kConstructed) === kConstructed) scheduled
    // maybeReadMore_ HERE, while the read was still in flight.
    r.unshift("x");

    // Queued between the buggy (unshift-time) and fixed (push-time) schedule
    // points: with the old gate maybeReadMore_ ran BEFORE this tick, saw the
    // read completed and the stream not yet ended, and issued a redundant
    // stream.read(0) -> _read #2. With the v26 gate the schedule happens at
    // push("y") below, so this tick ends the stream first and no extra _read
    // is issued. Verified against node v26.3.0 (reads === 1) and the old
    // gate (reads === 2).
    process.nextTick(() => r.push(null));

    r.push("y"); // completes the in-flight read; v26 schedules maybeReadMore_ here

    // All process.nextTick callbacks (including maybeReadMore_) run before
    // setImmediate fires, so this is a deterministic ordering, not a timeout.
    await new Promise(resolve => setImmediate(resolve));
    expect(reads).toBe(1);
  });
});

describe("Duplex.from(blob)", () => {
  it("reads a File", async () => {
    expect(await text(Duplex.from(new File(["from a File"], "file.txt")))).toBe("from a File");
  });

  it("reads an S3 file", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: req => new Response("from " + new URL(req.url).pathname),
    });
    const s3 = new Bun.S3Client({
      accessKeyId: "test",
      secretAccessKey: "test",
      bucket: "bucket",
      endpoint: server.url.href,
    });
    expect(await text(Duplex.from(s3.file("key.txt")))).toBe("from /bucket/key.txt");
  });
});

describe("Duplex.from({ readable, writable }) destroy propagation (nodejs/node#62824)", () => {
  it("destroys the writable side when the readable side errors", async () => {
    const r = new Readable({ read() {} });
    const w = new Writable({
      write(chunk, enc, cb) {
        cb();
      },
    });
    const d = Duplex.from({ readable: r, writable: w });

    const writableError = Promise.withResolvers();
    const writableClose = Promise.withResolvers();
    const duplexError = Promise.withResolvers();
    w.on("error", writableError.resolve);
    w.on("close", writableClose.resolve);
    d.on("error", duplexError.resolve);

    const err = new Error("boom");
    r.destroy(err);

    expect(await writableError.promise).toBe(err);
    await writableClose.promise;
    expect(w.destroyed).toBe(true);
    expect(await duplexError.promise).toBe(err);
  });
});

describe("pipeline real error overrides AbortError (nodejs/node#62113)", () => {
  it("reports the real error when a destroy callback errors after abort", async () => {
    const ac = new AbortController();
    const r = new Readable({ read() {} });
    const w = new Writable({
      write(chunk, enc, cb) {
        cb();
      },
      destroy(err, cb) {
        cb(new Error("realboom"));
      },
    });
    const p = Stream.promises.pipeline(r, w, { signal: ac.signal });
    setImmediate(() => ac.abort());
    let caught;
    await p.catch(e => {
      caught = e;
    });
    expect(caught.name).toBe("Error");
    expect(caught.message).toBe("realboom");
  });
});

// Symbol.asyncDispose destroys an unfinished stream with `new AbortError()`:
// node's default message has no trailing period and, with no signal involved,
// no cause (https://github.com/nodejs/node/blob/v26.3.0/lib/internal/errors.js#L980).
describe("Symbol.asyncDispose destroys with node's default AbortError", () => {
  const cases = [
    ["Readable", () => new Readable({ read() {} })],
    [
      "Writable",
      () =>
        new Writable({
          write(chunk, encoding, cb) {
            cb();
          },
        }),
    ],
  ];

  it.each(cases)("%s", async (_, create) => {
    const stream = create();
    const errored = new Promise(resolve => stream.once("error", resolve));
    await stream[Symbol.asyncDispose]();
    const err = await errored;
    expect(err).toBeInstanceOf(Error);
    expect({ name: err.name, code: err.code, message: err.message, hasCause: "cause" in err }).toEqual({
      name: "AbortError",
      code: "ABORT_ERR",
      message: "The operation was aborted",
      hasCause: false,
    });
  });
});

describe("stream operators argument validation (nodejs/node#59529)", () => {
  it("map/filter throw synchronously with the validateFunction message", () => {
    for (const method of ["map", "filter"]) {
      const r = Readable.from([1]);
      expect(() => r[method](123)).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
          message: 'The "fn" argument must be of type function. Received type number (123)',
        }),
      );
      r.destroy();
    }
  });

  it("forEach/every/reduce reject asynchronously with the validateFunction message", async () => {
    for (const [method, name] of [
      ["forEach", "fn"],
      ["every", "fn"],
      ["reduce", "reducer"],
    ]) {
      const r = Readable.from([1]);
      let caught;
      await r[method](123).catch(e => {
        caught = e;
      });
      expect(caught.code).toBe("ERR_INVALID_ARG_TYPE");
      expect(caught.message).toBe(`The "${name}" argument must be of type function. Received type number (123)`);
      r.destroy();
    }
  });
});

describe("duplexPair teardown (test-duplex-error.js)", () => {
  const once = (emitter, event) => new Promise(resolve => emitter.once(event, resolve));

  it("destroying one side with an error destroys the peer without re-emitting the error", async () => {
    const [a, b] = duplexPair();
    const aError = jest.fn();
    const bError = jest.fn();
    a.on("error", aError);
    b.on("error", bError);
    const bClosed = once(b, "close");
    a.resume();
    b.resume();
    a.destroy(new Error("boom"));
    await bClosed;
    expect({ a: a.destroyed, b: b.destroyed }).toEqual({ a: true, b: true });
    expect(aError).toHaveBeenCalledTimes(1);
    expect(aError.mock.calls[0][0].message).toBe("boom");
    expect(bError).not.toHaveBeenCalled();
  });

  it("destroying one side without an error ends the peer's readable", async () => {
    const [a, b] = duplexPair();
    const bEnded = once(b, "end");
    b.resume();
    a.destroy();
    await bEnded;
    expect(a.destroyed).toBe(true);
  });
});

it("internal FixedQueue backing list is not holey (test-fixed-queue.js)", () => {
  // Reachable via exposedInternals["internal/fixed_queue"]; without the src/
  // change that entry (and the .fill()) is absent, so this test fails either way.
  const FixedQueue = exposedInternals["internal/fixed_queue"];
  expect(typeof FixedQueue).toBe("function");
  const q = new FixedQueue();
  const list = q.head.list;
  expect(list.length).toBeGreaterThan(0);
  let holes = 0;
  for (let i = 0; i < list.length; i++) if (!(i in list)) holes++;
  expect(holes).toBe(0);
});

it("stream/consumers do not read Blob and TextDecoder from globalThis", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `globalThis.Blob = globalThis.TextDecoder = class {};
       const consumers = require("node:stream/consumers");
       const from = () => require("node:stream").Readable.from([Buffer.from("12")]);
       Promise.all([
         consumers.arrayBuffer(from()).then(arrayBuffer => arrayBuffer.byteLength),
         consumers.blob(from()).then(blob => blob.text()),
         consumers.buffer(from()).then(buffer => buffer.toString()),
         consumers.json(from()),
         consumers.text(from()),
       ]).then(results => console.log(JSON.stringify(results)));`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual([2, "12", "12", 12, "12"]);
  expect(exitCode).toBe(0);
});

it("Readable.fromWeb's native source accepts pull(view) without the flags array", async () => {
  // The Blob source doesn't define setFlowing(), so the Readable calls this one with the native source as `this`.
  const { promise, resolve } = Promise.withResolvers();
  Object.defineProperty(Object.prototype, "setFlowing", {
    configurable: true,
    value() {
      delete Object.prototype.setFlowing;
      this.start(65536);
      const view = new Uint8Array(64);
      resolve(Buffer.from(view.subarray(0, this.pull(view))).toString());
    },
  });
  try {
    Readable.fromWeb(new Blob(["hello world"]).stream()).resume();
    expect(await promise).toBe("hello world");
  } finally {
    delete Object.prototype.setFlowing;
  }
});
