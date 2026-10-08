import { exposedInternals } from "bun:internal-for-testing";
import { describe, expect, it, jest } from "bun:test";
import { bunEnv, bunExe, bunRun, isGlibcVersionAtLeast, isMacOS, tempDir, tmpdirSync } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { once } from "node:events";
import { createReadStream, createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { connect as connectHttp2, createServer as createHttp2Server, constants as http2Constants } from "node:http2";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { Duplex, duplexPair, finished, PassThrough, Readable, Stream, Transform, Writable } from "node:stream";
import { finished as finishedP } from "node:stream/promises";
import { join } from "path";

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

// Node v26.3.0 has the same pumps and never calls back in the cells below that are new here: nothing
// can wake a read that waits on an idle web source. Node's documentation promises destroy(err) on
// every stream and a callback (doc/api/stream.md, stream.pipeline), so those cells assert that
// contract. A cell that node settles must settle the same way: the last group pins those.
describe("pipeline() wakes a pump that waits on a web source", () => {
  const { pipeline, compose } = Stream;
  const pipelineP = Stream.promises.pipeline;
  const turn = () => new Promise(resolve => setImmediate(resolve));

  // A source that is idle until push(). `cancelled` resolves with the reason of cancel().
  function webSource({ cancel } = {}) {
    const cancelled = Promise.withResolvers();
    let controller;
    const stream = new ReadableStream({
      start(c) {
        controller = c;
      },
      cancel(reason) {
        cancelled.resolve(reason);
        return cancel?.();
      },
    });
    const push = () => controller.enqueue(Buffer.from("x"));
    return { stream, cancelled: cancelled.promise, controller: () => controller, push };
  }

  // `destroyed` resolves with the error of destroy().
  function nodeSource() {
    const destroyed = Promise.withResolvers();
    const stream = new Readable({
      read() {},
      destroy(err, callback) {
        destroyed.resolve(err);
        callback(err);
      },
    });
    return { stream, destroyed: destroyed.promise };
  }

  function nodeSink(options) {
    const writes = [];
    const firstWrite = Promise.withResolvers();
    const stream = new Writable({
      write(chunk, encoding, callback) {
        writes.push(chunk);
        firstWrite.resolve();
        callback();
      },
      ...options,
    });
    return { stream, writes, firstWrite: firstWrite.promise };
  }

  // `aborted` resolves with the reason of abort().
  function webSink(options) {
    const writes = [];
    const firstWrite = Promise.withResolvers();
    const aborted = Promise.withResolvers();
    let controller;
    const stream = new WritableStream({
      start(c) {
        controller = c;
      },
      write(chunk) {
        writes.push(chunk);
        firstWrite.resolve();
      },
      abort(reason) {
        aborted.resolve(reason);
      },
      ...options,
    });
    return {
      stream,
      writes,
      firstWrite: firstWrite.promise,
      aborted: aborted.promise,
      error: err => controller.error(err),
    };
  }

  const settled = promise =>
    promise.then(
      () => "resolved",
      err => err,
    );

  describe("in memory", () => {
    describe.each(["is aborted already", "aborts when the source is idle", "aborts after a chunk"])(
      "a signal that %s",
      when => {
        const cases = [
          ["ReadableStream > Writable", () => ({ source: webSource(), middle: [], sink: nodeSink() })],
          ["ReadableStream > WritableStream", () => ({ source: webSource(), middle: [], sink: webSink() })],
          [
            "ReadableStream > TransformStream > Writable",
            () => ({ source: webSource(), middle: [new TransformStream()], sink: nodeSink() }),
          ],
          [
            "ReadableStream > TransformStream > WritableStream",
            () => ({ source: webSource(), middle: [new TransformStream()], sink: webSink() }),
          ],
        ];

        it.each(cases)("%s", async (_, build) => {
          const { source, middle, sink } = build();
          const ac = new AbortController();
          if (when === "is aborted already") ac.abort();
          const promise = pipelineP(source.stream, ...middle, sink.stream, { signal: ac.signal });
          if (when === "aborts after a chunk") {
            source.push();
            await sink.firstWrite;
          }
          ac.abort();
          const err = await settled(promise);
          expect(err).toMatchObject({ name: "AbortError", code: "ABORT_ERR" });

          // With no reason, as the stream's own iterator cancels when node leaves the loop.
          expect(await source.cancelled).toBeUndefined();
          if (sink.aborted) {
            expect(await sink.aborted).toBe(err);
          } else {
            // The callback comes after the destination has closed, as with a node source.
            expect({ destroyed: sink.stream.destroyed, closed: sink.stream.closed }).toEqual({
              destroyed: true,
              closed: true,
            });
          }
        });
      },
    );

    it("ReadableStream > CompressionStream > WritableStream, a signal", async () => {
      const source = webSource();
      const sink = webSink();
      const ac = new AbortController();
      const promise = pipelineP(source.stream, new CompressionStream("gzip"), sink.stream, { signal: ac.signal });
      ac.abort();
      const err = await settled(promise);
      expect(err).toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
      expect(await source.cancelled).toBeUndefined();
      expect(await sink.aborted).toBe(err);
    });

    it("the callback waits for a destination that closes later", async () => {
      const source = webSource();
      const closing = Promise.withResolvers();
      const sink = nodeSink({
        destroy(err, callback) {
          closing.promise.then(() => callback(err));
        },
      });
      const ac = new AbortController();
      let state = "pending";
      const promise = settled(pipelineP(source.stream, sink.stream, { signal: ac.signal })).then(err => {
        state = "settled";
        return err;
      });
      ac.abort();
      await source.cancelled;
      await turn();
      expect(state).toBe("pending");
      closing.resolve();
      expect(await promise).toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
      expect(sink.stream.closed).toBe(true);
    });

    it("{ end: false }: the pump stops and the destination stays open", async () => {
      const source = webSource();
      const sink = nodeSink();
      const ac = new AbortController();
      const promise = pipelineP(source.stream, sink.stream, { signal: ac.signal, end: false });
      source.push();
      await sink.firstWrite;
      ac.abort();
      expect(await settled(promise)).toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
      expect(await source.cancelled).toBeUndefined();
      expect({
        writes: sink.writes.length,
        destroyed: sink.stream.destroyed,
        closeListeners: sink.stream.listenerCount("close"),
      }).toEqual({ writes: 1, destroyed: false, closeListeners: 0 });
    });

    it("{ end: false }: a source that always has a chunk is not read again after the abort", async () => {
      const ac = new AbortController();
      let pulls = 0;
      const stream = new ReadableStream({
        pull(controller) {
          // Finite, so that a pump that does not stop still ends.
          if (++pulls > 1000) controller.close();
          else controller.enqueue(Buffer.from("x"));
        },
      });
      const sink = nodeSink({
        write(chunk, encoding, callback) {
          sink.writes.push(chunk);
          if (sink.writes.length === 3) ac.abort();
          callback();
        },
      });
      const promise = pipelineP(stream, sink.stream, { signal: ac.signal, end: false });
      expect(await settled(promise)).toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
      expect(sink.writes.length).toBe(3);
    });

    it("{ end: false }: a pump that waits for 'drain' is woken", async () => {
      const source = webSource();
      const writing = Promise.withResolvers();
      // The write never completes, so the pump waits for 'drain' after it.
      const sink = nodeSink({ highWaterMark: 1, write: () => writing.resolve() });
      const ac = new AbortController();
      const promise = pipelineP(source.stream, sink.stream, { signal: ac.signal, end: false });
      source.push();
      await writing.promise;
      ac.abort();
      expect(await settled(promise)).toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
      expect(await source.cancelled).toBeUndefined();
    });

    // As a socket whose peer has left: it reports its end, and is destroyed, before it closes.
    it("a pump that waits for 'drain' on a destination that has reported already is woken", async () => {
      const source = webSource();
      const sink = nodeSink({ destroy() {} });
      sink.stream.on("finish", () => sink.stream.destroy());
      const ac = new AbortController();
      const promise = pipelineP(source.stream, sink.stream, { signal: ac.signal });
      sink.stream.end();
      await once(sink.stream, "finish");
      // The write fails and reports nothing: the pump waits for a 'drain' that cannot come.
      source.push();
      await turn();
      ac.abort();
      expect(await settled(promise)).toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
      expect(await source.cancelled).toBeUndefined();
    });

    it("a source that the pump has not locked yet is cancelled too", async () => {
      const source = webSource();
      // The pump waits for 'drain' before it takes the lock.
      const sink = nodeSink({ highWaterMark: 1, write() {} });
      sink.stream.write("a");
      expect(sink.stream.writableNeedDrain).toBe(true);
      const ac = new AbortController();
      const promise = pipelineP(source.stream, sink.stream, { signal: ac.signal });
      ac.abort();
      expect(await settled(promise)).toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
      expect(await source.cancelled).toBeUndefined();
      expect(source.stream.locked).toBe(false);
    });

    it("a source of a subclass is cancelled through a reader, not through the cancel() of the subclass", async () => {
      let called = false;
      class Mine extends ReadableStream {
        // Returns no promise.
        cancel() {
          called = true;
        }
      }
      const cancelled = Promise.withResolvers();
      const stream = new Mine({ cancel: cancelled.resolve });
      // The pump waits for 'drain' before it takes the lock.
      const sink = nodeSink({ highWaterMark: 1, write() {} });
      sink.stream.write("a");
      const ac = new AbortController();
      const promise = pipelineP(stream, sink.stream, { signal: ac.signal });
      ac.abort();
      expect(await settled(promise)).toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
      expect(await cancelled.promise).toBeUndefined();
      expect(called).toBe(false);
    });

    // The 'close' of a destination that finished reports no error, and the teardown left the wait to that report.
    it("{ end: false }: a signal between the 'finish' and the 'close' of a destination that its owner ended", async () => {
      const source = webSource();
      const closing = Promise.withResolvers();
      let written;
      const sink = nodeSink({
        highWaterMark: 1,
        // The test completes the write, so the pump waits for 'drain' in between.
        write(chunk, encoding, callback) {
          written = callback;
        },
        destroy(err, callback) {
          closing.promise.then(() => callback(err));
        },
      });
      const ac = new AbortController();
      const promise = pipelineP(source.stream, sink.stream, { signal: ac.signal, end: false });
      source.push();
      while (written === undefined) await turn();
      sink.stream.end();
      written();
      await once(sink.stream, "finish");
      ac.abort();
      closing.resolve();
      expect(await settled(promise)).toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
      expect(await source.cancelled).toBeUndefined();
    });

    // The callback did not wait before either: the pump has not started to read.
    it("a destination that closes before the first read: the source is cancelled, and the callback does not wait", async () => {
      const source = webSource({ cancel: () => new Promise(() => {}) });
      // The pump waits for 'drain' before it takes the lock.
      const sink = nodeSink({ highWaterMark: 1, write() {} });
      sink.stream.write("a");
      const { promise, resolve } = Promise.withResolvers();
      pipeline(source.stream, sink.stream, resolve);
      sink.stream.destroy();
      expect(await promise).toMatchObject({ code: "ERR_STREAM_PREMATURE_CLOSE" });
      expect(await source.cancelled).toBeUndefined();
    });

    it("the teardown does not go through a setImmediate that the program replaced", async () => {
      const source = webSource();
      const ac = new AbortController();
      const promise = pipelineP(source.stream, nodeSink().stream, { signal: ac.signal });
      const real = globalThis.setImmediate;
      // As fake timers do.
      globalThis.setImmediate = () => {};
      try {
        ac.abort();
        expect(await settled(promise)).toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
        expect(await source.cancelled).toBeUndefined();
      } finally {
        globalThis.setImmediate = real;
      }
    });

    describe("the destination goes away while the source is idle", () => {
      const boom = new Error("boom");
      const aborted = Object.assign(new Error("aborted"), { name: "AbortError" });
      const destroy = sink => sink.stream.destroy();
      // The third element is what the callback gets: what the pump reports when a chunk meets that destination.
      const cases = [
        [
          "ReadableStream > Writable, destroy()",
          () => ({ source: webSource(), middle: [], sink: nodeSink(), kill: destroy }),
          { code: "ERR_STREAM_PREMATURE_CLOSE" },
        ],
        [
          "ReadableStream > Writable, destroy(err)",
          () => ({ source: webSource(), middle: [], sink: nodeSink(), kill: sink => sink.stream.destroy(boom) }),
          boom,
        ],
        [
          "ReadableStream > Writable, destroy(an AbortError of its owner)",
          () => ({ source: webSource(), middle: [], sink: nodeSink(), kill: sink => sink.stream.destroy(aborted) }),
          aborted,
        ],
        [
          "ReadableStream > Writable, end() by its owner",
          () => ({ source: webSource(), middle: [], sink: nodeSink(), kill: sink => sink.stream.end() }),
          { code: "ERR_STREAM_PREMATURE_CLOSE" },
        ],
        [
          "ReadableStream > TransformStream > Writable, destroy()",
          () => ({ source: webSource(), middle: [new TransformStream()], sink: nodeSink(), kill: destroy }),
          { code: "ERR_STREAM_PREMATURE_CLOSE" },
        ],
        [
          "ReadableStream > WritableStream, the sink errors",
          () => ({ source: webSource(), middle: [], sink: webSink(), kill: sink => sink.error(boom) }),
          boom,
        ],
        [
          "ReadableStream > WritableStream, the sink errors with no reason",
          () => ({ source: webSource(), middle: [], sink: webSink(), kill: sink => sink.error(undefined) }),
          undefined,
        ],
        [
          "ReadableStream > WritableStream, the sink errors with 0",
          () => ({ source: webSource(), middle: [], sink: webSink(), kill: sink => sink.error(0) }),
          undefined,
        ],
      ];

      it.each(cases)("%s", async (_, build, expected) => {
        const { source, middle, sink, kill } = build();
        const { promise, resolve } = Promise.withResolvers();
        pipeline(source.stream, ...middle, sink.stream, resolve);
        kill(sink);
        const err = await promise;
        if (expected instanceof Error || expected === undefined) expect(err).toBe(expected);
        else expect(err).toMatchObject(expected);
        expect(await source.cancelled).toBeUndefined();
      });

      it.each([
        ["Readable > CompressionStream > Writable, destroy()", () => new CompressionStream("gzip"), destroy],
        ["Readable > TransformStream > WritableStream, the sink errors", () => new TransformStream(), null],
      ])("%s: the node source is destroyed", async (_, middle, kill) => {
        const source = nodeSource();
        const sink = kill ? nodeSink() : webSink();
        const { promise, resolve } = Promise.withResolvers();
        pipeline(source.stream, middle(), sink.stream, resolve);
        if (kill) kill(sink);
        else sink.error(boom);
        const err = await promise;
        if (kill) expect(err).toMatchObject({ code: "ERR_STREAM_PREMATURE_CLOSE" });
        else expect(err).toBe(boom);
        expect(await source.destroyed).toBe(err);
      });

      // A node source gives this on main and in node. A web source resolved there when it ended later.
      it.each([
        ["Readable", () => new Readable({ read() {} })],
        ["ReadableStream", () => webSource().stream],
      ])("{ end: false }: %s > Writable that its owner ends", async (_, makeStream) => {
        const sink = nodeSink();
        const promise = pipelineP(makeStream(), sink.stream, { end: false });
        sink.stream.end();
        expect(await settled(promise)).toMatchObject({ code: "ERR_STREAM_PREMATURE_CLOSE" });
      });

      // As a socket whose peer has left: it reports its end, and is destroyed, before it closes.
      it.each([
        ["a chunk", source => source.push(), { code: "ERR_STREAM_PREMATURE_CLOSE" }],
        ["the end of the source", source => source.controller().close(), "resolved"],
      ])("%s for a destination that has ended and has not closed yet", async (_, feed, expected) => {
        const source = webSource();
        const closing = Promise.withResolvers();
        const sink = nodeSink({
          destroy(err, callback) {
            closing.promise.then(() => callback(err));
          },
        });
        sink.stream.on("finish", () => sink.stream.destroy());
        const promise = pipelineP(source.stream, sink.stream);
        sink.stream.end();
        await once(sink.stream, "finish");
        // The pump waits on the destination: for a 'drain' after the write that failed, or for its end.
        feed(source);
        await turn();
        closing.resolve();
        if (expected === "resolved") expect(await settled(promise)).toBe(expected);
        else expect(await settled(promise)).toMatchObject(expected);
      });

      it("ReadableStream > WritableStream that is closed already", async () => {
        const source = webSource();
        const sink = webSink();
        await sink.stream.close();
        const { promise, resolve } = Promise.withResolvers();
        pipeline(source.stream, sink.stream, resolve);
        // What close() on a closed sink gives when the source ends.
        expect(await promise).toMatchObject({ name: "TypeError", code: "ERR_INVALID_STATE" });
        expect(await source.cancelled).toBeUndefined();
      });
    });

    // The error that a compose() of node streams emits when it is destroyed before its end.
    it("compose() with a web stream in front of a node stream closes on destroy()", async () => {
      const composed = compose(new TransformStream(), new PassThrough());
      const errored = Promise.withResolvers();
      const closed = Promise.withResolvers();
      composed.on("error", errored.resolve).on("close", closed.resolve);
      composed.destroy();
      expect(await errored.promise).toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
      await closed.promise;
    });

    describe("a web sink that is locked already", () => {
      it("Readable > WritableStream: the callback gets the error", async () => {
        const source = nodeSource();
        const locked = new WritableStream();
        locked.getWriter();
        const { promise, resolve } = Promise.withResolvers();
        pipeline(source.stream, locked, resolve);
        const err = await promise;
        expect(err).toMatchObject({ name: "TypeError", code: "ERR_INVALID_STATE" });
        expect(await source.destroyed).toBe(err);
      });

      it("ReadableStream > WritableStream: the callback gets the error", async () => {
        const source = webSource();
        const locked = new WritableStream();
        locked.getWriter();
        const { promise, resolve } = Promise.withResolvers();
        pipeline(source.stream, locked, resolve);
        expect(await promise).toMatchObject({ name: "TypeError", code: "ERR_INVALID_STATE" });
        expect(await source.cancelled).toBeUndefined();
      });

      it("Readable > TransformStream > Writable: every member is torn down", async () => {
        const source = nodeSource();
        const transform = new TransformStream();
        transform.writable.getWriter();
        const sink = nodeSink();
        const { promise, resolve } = Promise.withResolvers();
        pipeline(source.stream, transform, sink.stream, resolve);
        const err = await promise;
        expect(err).toMatchObject({ name: "TypeError", code: "ERR_INVALID_STATE" });
        expect(await source.destroyed).toBe(err);
        expect(sink.stream.destroyed).toBe(true);
      });
    });

    describe("what node settles stays as node settles it", () => {
      // "a chunk after it": node settles these. The new cells settle the same way.
      const arrivals = [
        ["no chunk after it", false],
        ["a chunk after it", true],
      ];

      it.each(arrivals)(
        "the destination's own destroy error wins over the AbortError, %s (nodejs/node#62113)",
        async (_, chunk) => {
          const realboom = new Error("realboom");
          const source = webSource();
          const sink = nodeSink({
            destroy(err, callback) {
              callback(realboom);
            },
          });
          const ac = new AbortController();
          const promise = pipelineP(source.stream, sink.stream, { signal: ac.signal });
          ac.abort();
          if (chunk) source.push();
          expect(await settled(promise)).toBe(realboom);
        },
      );

      // An error that pipeline() does not take from the 'error' event: the pump has to report it.
      it.each(arrivals)("the destination's own premature close wins over the AbortError, %s", async (_, chunk) => {
        const closed = Object.assign(new Error("closed"), { code: "ERR_STREAM_PREMATURE_CLOSE" });
        const source = webSource();
        const sink = nodeSink({
          // Later, so that the pump has stopped before the destination reports.
          destroy(err, callback) {
            setImmediate(callback, closed);
          },
        });
        const ac = new AbortController();
        const promise = pipelineP(source.stream, sink.stream, { signal: ac.signal });
        ac.abort();
        if (chunk) source.push();
        expect(await settled(promise)).toBe(closed);
      });

      it.each([
        ["the AbortError", false],
        ["its own destroy error", true],
      ])("a signal while the destination finishes: the callback comes after its close, with %s", async (_, fails) => {
        const realboom = new Error("realboom");
        const source = webSource();
        const finishing = Promise.withResolvers();
        const closing = Promise.withResolvers();
        const sink = nodeSink({
          // Never completes: the pump has ended the destination and waits for it.
          final: () => finishing.resolve(),
          destroy(err, callback) {
            closing.promise.then(() => callback(fails ? realboom : err));
          },
        });
        const ac = new AbortController();
        let state = "pending";
        const promise = settled(pipelineP(source.stream, sink.stream, { signal: ac.signal })).then(err => {
          state = "settled";
          return err;
        });
        source.push();
        source.controller().close();
        await finishing.promise;
        ac.abort();
        await turn();
        expect(state).toBe("pending");
        closing.resolve();
        const err = await promise;
        if (fails) expect(err).toBe(realboom);
        else expect(err).toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
        expect(sink.stream.closed).toBe(true);
      });

      it("a signal while the pump waits for 'drain': the source is cancelled after the destination has closed", async () => {
        const order = [];
        const source = webSource({ cancel: () => void order.push("cancel") });
        const writing = Promise.withResolvers();
        const sink = nodeSink({
          highWaterMark: 1,
          // The write never completes, so the pump waits for 'drain' after it.
          write: () => writing.resolve(),
          // Two turns of the event loop later, as a socket or a file.
          destroy(err, callback) {
            turn()
              .then(turn)
              .then(() => callback(err));
          },
        });
        sink.stream.on("close", () => order.push("close"));
        const ac = new AbortController();
        const promise = pipelineP(source.stream, sink.stream, { signal: ac.signal });
        source.push();
        await writing.promise;
        ac.abort();
        expect(await settled(promise)).toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
        expect(order).toEqual(["close", "cancel"]);
      });

      it("a signal after the source has ended lets a WritableStream close", async () => {
        const source = webSource();
        const calls = [];
        const gate = Promise.withResolvers();
        const sink = webSink({
          // The pump waits for this write before it closes the sink.
          write: () => gate.promise,
          close: () => void calls.push("close"),
          abort: () => void calls.push("abort"),
        });
        const ac = new AbortController();
        const promise = pipelineP(source.stream, sink.stream, { signal: ac.signal });
        source.push();
        source.controller().close();
        // The pump has seen the end of the source.
        while (source.stream.locked) await turn();
        ac.abort();
        gate.resolve();
        expect(await settled(promise)).toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
        expect(calls).toEqual(["close"]);
      });

      // Node settles the second row. Into a WritableStream it takes the chunk and waits for the next.
      it.each([
        ["a Writable, no chunk after the abort", nodeSink, false],
        ["a Writable, a chunk after the abort", nodeSink, true],
        ["a WritableStream", webSink, false],
      ])("the callback waits for cancel() of the source, into %s", async (_, makeSink, chunk) => {
        const order = [];
        const gate = Promise.withResolvers();
        const source = webSource({
          cancel() {
            order.push("cancel");
            return gate.promise.then(() => order.push("cancel settled"));
          },
        });
        const ac = new AbortController();
        const promise = pipelineP(source.stream, makeSink().stream, { signal: ac.signal }).catch(() =>
          order.push("callback"),
        );
        ac.abort();
        if (chunk) source.push();
        await source.cancelled;
        await turn();
        // The lock is gone before the cancel settles, as when the stream's own iterator cancels.
        expect({ order, locked: source.stream.locked }).toEqual({ order: ["cancel"], locked: false });
        gate.resolve();
        await promise;
        expect(order).toEqual(["cancel", "cancel settled", "callback"]);
      });

      it.each(arrivals)(
        "a cancel() of the source that rejects does not replace the AbortError, %s",
        async (_, chunk) => {
          const source = webSource({ cancel: () => Promise.reject(new Error("cancel failed")) });
          const ac = new AbortController();
          const promise = pipelineP(source.stream, nodeSink().stream, { signal: ac.signal });
          ac.abort();
          if (chunk) source.push();
          expect(await settled(promise)).toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
        },
      );

      it.each([
        ["Writable", nodeSink],
        ["WritableStream", webSink],
      ])("a source error into a %s tears the sink down and unlocks the source", async (_, makeSink) => {
        const boom = new Error("boom");
        const source = webSource();
        const sink = makeSink();
        const { promise, resolve } = Promise.withResolvers();
        pipeline(source.stream, sink.stream, resolve);
        source.controller().error(boom);
        expect(await promise).toBe(boom);
        if (sink.aborted) expect(await sink.aborted).toBe(boom);
        else expect(sink.stream.destroyed).toBe(true);
        expect(source.stream.locked).toBe(false);
      });

      // Both pumps fail. The pump into the destination reports first, with the two errors that it has.
      it("a source error after the signal, through a TransformStream: the errors are reported together", async () => {
        const boom = new Error("boom");
        const source = webSource();
        const ac = new AbortController();
        const promise = pipelineP(source.stream, new TransformStream(), nodeSink().stream, { signal: ac.signal });
        ac.abort();
        // The destination has reported the AbortError.
        await new Promise(resolve => process.nextTick(resolve));
        source.controller().error(boom);
        const err = await settled(promise);
        expect(err).toBeInstanceOf(AggregateError);
        expect(err.errors).toContain(boom);
      });

      it.each(arrivals)(
        "cancel() of the source runs in the async context of the pipeline() call, %s",
        async (_, chunk) => {
          const als = new AsyncLocalStorage();
          const store = Promise.withResolvers();
          const source = webSource({ cancel: () => store.resolve(als.getStore()) });
          const ac = new AbortController();
          const promise = als.run("caller", () => pipelineP(source.stream, nodeSink().stream, { signal: ac.signal }));
          als.run("aborter", () => {
            ac.abort();
            if (chunk) source.push();
          });
          expect(await settled(promise)).toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
          expect(await store.promise).toBe("caller");
        },
      );

      // Node's documentation: a function stage has to handle `signal`. The pipeline does not cancel what it returned.
      it("a web stream that a function stage returned is left to that stage", async () => {
        const mine = new Error("mine");
        const ac = new AbortController();
        const promise = pipelineP(
          ({ signal }) =>
            new ReadableStream({
              start(controller) {
                // Two turns of the event loop later, as a stage that first releases what it holds.
                signal.addEventListener("abort", async () => {
                  await turn();
                  await turn();
                  controller.error(mine);
                });
              },
            }),
          nodeSink().stream,
          { signal: ac.signal },
        );
        ac.abort();
        // Two failures: the error of the stage, and the AbortError of the destination.
        const err = await settled(promise);
        expect(err).toBeInstanceOf(AggregateError);
        expect(err.errors).toContain(mine);
      });

      it.each([
        ["Readable", nodeSource],
        ["ReadableStream", webSource],
      ])("the error of the sink's abort() wins over the AbortError, %s source", async (_, makeSource) => {
        const boom = new Error("boom");
        const sink = webSink({
          abort() {
            throw boom;
          },
        });
        const ac = new AbortController();
        const promise = pipelineP(makeSource().stream, sink.stream, { signal: ac.signal });
        ac.abort();
        expect(await settled(promise)).toBe(boom);
      });

      it("a chunk that the destination rejects cancels the source and waits for it", async () => {
        const order = [];
        const source = webSource({ cancel: async () => void order.push("cancel settled") });
        const { promise, resolve } = Promise.withResolvers();
        pipeline(source.stream, nodeSink().stream, err => {
          order.push("callback");
          resolve(err);
        });
        source.controller().enqueue({});
        expect(await promise).toMatchObject({ code: "ERR_INVALID_ARG_TYPE" });
        expect(await source.cancelled).toBeUndefined();
        expect(order).toEqual(["cancel settled", "callback"]);
      });

      // The pipeline cancels the source in the next turn of the event loop. Until then its owner can end it.
      it.each([
        ["in its listener", close => close()],
        ["one microtask later", close => queueMicrotask(close)],
        ["after three awaits", async close => (await null, await null, await null, close())],
        ["on the next tick", close => process.nextTick(close)],
        ["two ticks later", close => process.nextTick(() => process.nextTick(close))],
      ])("a source that its owner closes on the same signal, %s", async (_, defer) => {
        const source = webSource();
        const ac = new AbortController();
        const promise = pipelineP(source.stream, nodeSink().stream, { signal: ac.signal });
        const owner = Promise.withResolvers();
        // Added after pipeline()'s own listener, so it runs after the pipeline has heard the signal.
        ac.signal.addEventListener("abort", () =>
          defer(() => {
            try {
              source.controller().close();
              owner.resolve("closed");
            } catch (err) {
              owner.resolve(err);
            }
          }),
        );
        ac.abort();
        expect(await settled(promise)).toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
        expect(await owner.promise).toBe("closed");
      });

      it("a source that someone else has locked is left to its holder", async () => {
        const source = webSource();
        const reader = source.stream.getReader();
        // The pump waits for 'drain' before it asks for the lock.
        const sink = nodeSink({ highWaterMark: 1, write() {} });
        sink.stream.write("a");
        const { promise, resolve } = Promise.withResolvers();
        pipeline(source.stream, sink.stream, resolve);
        sink.stream.destroy();
        expect(await promise).toMatchObject({ code: "ERR_STREAM_PREMATURE_CLOSE" });
        source.push();
        expect(await reader.read()).toEqual({ done: false, value: Buffer.from("x") });
      });

      it("{ end: false }: a signal does not wait for a destination that never reports its destroy", async () => {
        const source = webSource();
        const sink = nodeSink({ destroy() {} });
        sink.stream.destroy();
        const ac = new AbortController();
        const promise = pipelineP(source.stream, sink.stream, { signal: ac.signal, end: false });
        ac.abort();
        // In node this end of the source is what lets the pump call back.
        source.controller().close();
        expect(await settled(promise)).toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
      });

      it("a TransformStream whose writable is not a WritableStream is written through its getWriter()", async () => {
        const real = webSink();
        const transform = new TransformStream();
        Object.defineProperty(transform, "writable", { value: { getWriter: () => real.stream.getWriter() } });
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue("x");
            controller.close();
          },
        });
        const { promise, resolve } = Promise.withResolvers();
        pipeline(stream, transform, resolve);
        expect(await promise).toBeUndefined();
        expect(real.writes).toEqual(["x"]);
      });

      it.each([
        ["Writable", nodeSink],
        ["WritableStream", webSink],
      ])("a source whose [Symbol.asyncIterator] getter throws for the pump, into a %s", async (_, makeSink) => {
        const boom = new Error("boom");
        let reads = 0;
        class Broken extends ReadableStream {
          // pipeline() reads it once to check its argument. The pump reads it after that.
          get [Symbol.asyncIterator]() {
            if (++reads > 1) throw boom;
            return super[Symbol.asyncIterator];
          }
        }
        const { promise, resolve } = Promise.withResolvers();
        pipeline(new Broken(), makeSink().stream, resolve);
        expect(await promise).toBe(boom);
      });

      it("a source error still calls back when the destination never reports its close", async () => {
        const boom = new Error("boom");
        const source = webSource();
        const sink = nodeSink({ emitClose: false });
        const { promise, resolve } = Promise.withResolvers();
        pipeline(source.stream, sink.stream, resolve);
        sink.stream.destroy();
        source.controller().error(boom);
        expect(await promise).toBe(boom);
      });

      it("a function stage that stops early ends the pipeline without an error", async () => {
        const sink = nodeSink();
        await pipelineP(
          new Readable({
            highWaterMark: 1,
            read() {
              this.push("line1\nline2\n");
            },
          }),
          new TextDecoderStream(),
          async function* (source) {
            for await (const chunk of source) {
              yield chunk.split("\n")[0];
              break;
            }
          },
          sink.stream,
        );
        expect(sink.writes.map(String)).toEqual(["line1"]);
      });

      it("a ReadableStream with its own async iterator is read through that iterator", async () => {
        class Upper extends ReadableStream {
          async *[Symbol.asyncIterator]() {
            const reader = this.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) return;
              yield value.toUpperCase();
            }
          }
        }
        const stream = new Upper({
          start(controller) {
            controller.enqueue("a");
            controller.enqueue("b");
            controller.close();
          },
        });
        const sink = nodeSink();
        await pipelineP(stream, sink.stream);
        expect(sink.writes.map(String)).toEqual(["A", "B"]);
      });

      it("a generator source rejects with its own error", async () => {
        const mine = new Error("mine");
        const sink = nodeSink();
        const ac = new AbortController();
        const promise = pipelineP(
          async function* ({ signal }) {
            yield "a";
            await new Promise((_, reject) => signal.addEventListener("abort", () => reject(mine)));
          },
          sink.stream,
          { signal: ac.signal, end: false },
        );
        await sink.firstWrite;
        ac.abort();
        expect(await settled(promise)).toBe(mine);
      });

      it("the web source is unlocked when the pump ends the destination", async () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(Buffer.from("a"));
            controller.enqueue(Buffer.from("b"));
            controller.close();
          },
        });
        let lockedAtFinal;
        const sink = nodeSink({
          final(callback) {
            lockedAtFinal = stream.locked;
            callback();
          },
        });
        await pipelineP(stream, sink.stream);
        expect({ written: Buffer.concat(sink.writes).toString(), lockedAtFinal }).toEqual({
          written: "ab",
          lockedAtFinal: false,
        });
      });
    });
  });

  describe("over a socket", () => {
    it("a download with a signal: the file is closed and the server sees the client hang up", async () => {
      const hungUp = Promise.withResolvers();
      const sockets = [];
      const server = createServer(socket => {
        sockets.push(socket);
        socket.on("error", () => {}).on("close", hungUp.resolve);
        // 1000 of 1000000 bytes, then nothing.
        socket.once("data", () => {
          socket.write("HTTP/1.1 200 OK\r\nContent-Length: 1000000\r\n\r\n" + Buffer.alloc(1000, "x"));
        });
      }).listen(0, "127.0.0.1");
      using dir = tempDir("pipeline-web-source", {});
      try {
        await once(server, "listening");
        const file = createWriteStream(join(String(dir), "download"));
        const ac = new AbortController();
        const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
        const promise = pipelineP(response.body, file, { signal: ac.signal });
        // The pump has written all that the server sent and waits on the idle body.
        while (file.bytesWritten < 1000) await turn();
        ac.abort();
        expect(await settled(promise)).toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
        expect(file.closed).toBe(true);
        await hungUp.promise;
      } finally {
        for (const socket of sockets) socket.destroy();
        server.close();
      }
    });

    it("a client that leaves an http.ServerResponse", async () => {
      const source = webSource();
      const done = Promise.withResolvers();
      const server = createHttpServer((req, res) => {
        res.writeHead(200);
        res.write("first");
        pipeline(source.stream, res, done.resolve);
      }).listen(0, "127.0.0.1");
      try {
        await once(server, "listening");
        const client = connect(server.address().port, "127.0.0.1");
        client.on("error", () => {});
        client.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
        await once(client, "data");
        client.destroy();
        expect(await done.promise).toMatchObject({ code: "ERR_STREAM_PREMATURE_CLOSE" });
        expect(await source.cancelled).toBeUndefined();
      } finally {
        server.closeAllConnections();
        server.close();
      }
    });

    it("a client that leaves an Http2ServerResponse", async () => {
      const source = webSource();
      const done = Promise.withResolvers();
      const server = createHttp2Server((req, res) => {
        res.writeHead(200);
        pipeline(source.stream, res, done.resolve);
      }).listen(0, "127.0.0.1");
      let client;
      try {
        await once(server, "listening");
        client = connectHttp2(`http://127.0.0.1:${server.address().port}`);
        client.on("error", () => {});
        const request = client.request({ ":path": "/" });
        request.on("error", () => {});
        await once(request, "response");
        request.close(http2Constants.NGHTTP2_CANCEL);
        expect(await done.promise).toMatchObject({ code: "ERR_STREAM_PREMATURE_CLOSE" });
        expect(await source.cancelled).toBeUndefined();
      } finally {
        client?.destroy();
        server.close();
      }
    });

    it("a signal into an Http2ServerResponse rejects with the AbortError, as with a node source", async () => {
      const closed = Promise.withResolvers();
      // The response closes with no error while the pump waits for this cancel().
      const source = webSource({ cancel: () => closed.promise });
      const ac = new AbortController();
      const done = Promise.withResolvers();
      const server = createHttp2Server((req, res) => {
        res.writeHead(200);
        res.on("close", closed.resolve);
        done.resolve(settled(pipelineP(source.stream, res, { signal: ac.signal })));
      }).listen(0, "127.0.0.1");
      let client;
      try {
        await once(server, "listening");
        client = connectHttp2(`http://127.0.0.1:${server.address().port}`);
        client.on("error", () => {});
        const request = client.request({ ":path": "/" });
        request.on("error", () => {});
        await once(request, "response");
        ac.abort();
        expect(await done.promise).toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
      } finally {
        client?.destroy();
        server.close();
      }
    });
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
