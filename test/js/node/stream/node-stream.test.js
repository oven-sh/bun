import { exposedInternals } from "bun:internal-for-testing";
import { describe, expect, it, jest } from "bun:test";
import { bunEnv, bunExe, bunRun, isGlibcVersionAtLeast, isMacOS, tempDir, tmpdirSync } from "harness";
import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
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

// compose() runs its members in an inner pipeline, and destroy() waits for that pipeline to call back.
// Deliberate divergence from Node v26.3.0, which stops a node tail only
// (https://github.com/nodejs/node/blob/v26.3.0/lib/internal/streams/compose.js#L223-L240). With a web stream or a
// function stage among the members nothing ends the inner pipeline there: 'close' never comes, and an outer
// pipeline() never settles. Bun stops the rest too. Such a compose() then reports an early destroy() as a
// compose() of node streams does on Node.
describe("compose() with a web stream or a function stage: destroy() ends the inner pipeline", () => {
  const turn = () => new Promise(resolve => setImmediate(resolve));
  const turns = async count => {
    for (let i = 0; i < count; i++) await turn();
  };
  // Without the fix nothing here settles, so a wait ends after a number of event loop turns, not after a time.
  const turnsUntil = async done => {
    for (let i = 0; i < 100 && !done(); i++) await turn();
    return done();
  };
  const watch = stream => {
    const events = [];
    stream.on("error", err => events.push(err));
    for (const name of ["end", "finish", "close"]) stream.on(name, () => events.push(name));
    return events;
  };
  const closed = events => () => events.includes("close");
  const outcomeOf = promise => {
    const outcome = { of: "pending" };
    promise.then(
      () => (outcome.of = "resolved"),
      err => (outcome.of = err),
    );
    return outcome;
  };
  const settled = outcome => () => outcome.of !== "pending";
  const abortError = expect.objectContaining({ name: "AbortError", code: "ABORT_ERR" });
  const sink = () =>
    new Writable({
      write(chunk, encoding, callback) {
        callback();
      },
    });
  // Ends its readable side after the first chunk and swallows the rest.
  const takeOne = () => {
    let taken = false;
    return new Transform({
      transform(chunk, encoding, callback) {
        if (!taken) {
          taken = true;
          this.push(chunk);
          this.push(null);
        }
        callback();
      },
    });
  };
  // Calls back two turns late, so it still works when a member behind it has ended the output.
  const slow = () =>
    new Transform({
      transform(chunk, encoding, callback) {
        setImmediate(() => setImmediate(() => callback(null, chunk)));
      },
    });
  // A function stage that waits on its signal, not on its source, and then fails with `failure(signal)`.
  const parked = failure =>
    async function* (source, { signal }) {
      await new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(failure(signal)), { once: true });
      });
      yield* source;
    };
  const stageError = () => Object.assign(new Error("stage"), { code: "STAGE" });
  // What pumpToNode() reports when a stage fails with its own error after its destination was destroyed.
  const stageAnd = code =>
    expect.objectContaining({
      name: "AggregateError",
      errors: [expect.objectContaining({ code: "STAGE" }), expect.objectContaining({ code })],
    });

  describe("by member shape", () => {
    const kinds = {
      T: () => new PassThrough(),
      W: () => new TransformStream(),
      WS: () => new WritableStream(),
      R: () => new Readable({ read() {} }),
      Wn: sink,
      G: () =>
        async function* (source) {
          yield* source;
        },
      Gsig: () => parked(signal => signal.reason),
      Gown: () => parked(stageError),
      take1: takeOne,
      slowT: slow,
    };
    const boom = new Error("boom");
    const build = shape => {
      const composed = Stream.compose(...shape.split(",").map(kind => kinds[kind]()));
      const seen = { closed: false, errors: [], data: "", events: [] };
      composed.on("close", () => (seen.closed = true)).on("error", err => seen.errors.push(err));
      // A stage that waits on its signal passes no chunk, so the events that need a chunk do not apply.
      return { composed, seen, passes: !/Gsig|Gown/.test(shape) };
    };
    const read = ({ composed, seen }) => composed.on("data", chunk => (seen.data += chunk));
    const events = [
      async ({ composed }) => (await turns(3), composed.destroy()),
      async ({ composed }) => (await turns(3), composed.destroy(boom)),
      async ({ composed }) => composed.destroy(),
      async ctx => {
        const { composed } = ctx;
        if (composed.writable) composed.write("x");
        if (composed.readable) read(ctx);
        await turns(3);
        composed.destroy();
      },
      async ctx => {
        const { composed } = ctx;
        if (!composed.writable) return false;
        if (composed.readable) read(ctx);
        composed.end("x");
        composed.destroy();
      },
      async ctx => {
        const { composed } = ctx;
        if (!composed.writable || !composed.readable || !ctx.passes) return false;
        read(ctx);
        composed.on("end", () => composed.destroy());
        composed.end("x");
      },
      async ctx => {
        const { composed } = ctx;
        if (!composed.writable || !ctx.passes) return false;
        if (composed.readable) read(ctx);
        composed.on("finish", () => composed.destroy(boom));
        composed.end("x");
      },
      async ctx => {
        const { composed, seen } = ctx;
        if (!composed.writable || !composed.readable || !ctx.passes) return false;
        read(ctx);
        for (const name of ["end", "finish"]) composed.on(name, () => seen.events.push(name));
        composed.write("a");
        composed.write("b");
        composed.end("c");
      },
    ];
    const letter = ({ seen }) => {
      if (!seen.closed) return ".";
      const [err] = seen.errors;
      if (seen.errors.length > 1) return "?";
      if (err === boom) return "B";
      if (err?.name === "AbortError" && err.code === "ABORT_ERR") return "A";
      if (err?.name === "AggregateError" && err.errors.map(e => e.code).join() === "STAGE,ABORT_ERR") return "G";
      if (err !== undefined) return "?";
      const completion = seen.events.sort().join() === "end,finish";
      return completion && seen.data === "abc" ? "D" : completion && seen.data === "a" ? "d" : "-";
    };

    // One row per member shape, one letter per event. The events, in order:
    //   destroy() | destroy(boom) | destroy() in the tick of compose() | write(), then destroy()
    //   | end(), then destroy() in the same tick | destroy() in the 'end' listener | destroy(boom) in the 'finish' listener
    //   | write(), end() and a reader, with no destroy()
    // The letters:
    //   A  'error' with an AbortError, then 'close'        B  'error' with boom itself, then 'close'
    //   G  'error' with an AggregateError of the stage's own error and the AbortError, then 'close'
    //   -  'close' and no error                            D  every chunk, 'end', 'finish', 'close', no error
    //   d  as D, with the first chunk only                 (space)  the event does not apply to the shape
    // A cell that never closes reads ".". On Node v26.3.0, and without the fix, every row but the last four
    // has such cells. The members: T PassThrough, W TransformStream, WS WritableStream, R Readable, Wn Writable,
    // G function stage, Gsig and Gown function stages that wait on their signal (Gown fails with its own error).
    it.each([
      ["T,W", "ABAAA-BD"],
      ["W,T", "ABAAA--D"],
      ["W,W", "ABAAA-BD"],
      ["T,W,T", "ABAAA--D"],
      ["W,T,W", "ABAAA-BD"],
      ["T,W,W,T", "ABAAA--D"],
      ["T,WS", "ABAAA B "],
      ["W,WS", "ABAAA B "],
      ["R,W", "ABAA    "],
      ["W,Wn", "ABAAA - "],
      ["R,WS", "ABAA    "],
      ["R,G,Wn", "ABAA    "],
      ["R,T,WS", "ABAA    "],
      ["T,G,T", "ABAAA--D"],
      ["W,G,W", "ABAAA-BD"],
      ["T,Gsig,T", "ABAAA   "],
      ["T,Gsig,W", "ABAAA   "],
      ["W,Gsig,T", "ABAAA   "],
      ["T,Gown,T", "GBGGG   "],
      ["W,Gown,W", "ABAAA   "],
      ["slowT,W,take1,T", "ABAAA--d"],
      ["T,W,take1", "ABAAAA-d"],
      ["W,take1,T", "ABAAA--d"],
      // No pump in the last three, and a pipe() behind the stage in the first of them: Node settles all four rows.
      ["T,Gown,T,T", "GBGGG   "],
      ["T,T", "ABAAA-BD"],
      ["T,T,T", "ABAAA-BD"],
    ])("compose(%s)", async (shape, row) => {
      let got = "";
      for (const event of events) {
        const ctx = build(shape);
        if ((await event(ctx)) === false) {
          got += " ";
          continue;
        }
        await turnsUntil(() => ctx.seen.closed);
        await turns(5);
        got += letter(ctx);
      }
      expect(got).toBe(row);
    });
  });

  it("destroy() destroys a node head and releases the reader of a web tail", async () => {
    const head = new PassThrough();
    const tail = new TransformStream();
    const composed = Stream.compose(head, tail);
    const events = watch(composed);
    expect(tail.readable.locked).toBe(true);
    composed.destroy();
    await turnsUntil(closed(events));
    expect({ headDestroyed: head.destroyed, tailLocked: tail.readable.locked }).toEqual({
      headDestroyed: true,
      tailLocked: false,
    });
  });

  it("destroy(error) aborts a web head with that error", async () => {
    let reason;
    const head = new TransformStream({
      cancel(why) {
        reason = why;
      },
    });
    const composed = Stream.compose(head, new PassThrough());
    const events = watch(composed);
    const boom = new Error("boom");
    composed.destroy(boom);
    await turnsUntil(closed(events));
    expect(events).toEqual([boom, "close"]);
    expect(reason).toBe(boom);
  });

  it("destroy(error) on compose(Readable, WritableStream) destroys the source and aborts the sink with that error", async () => {
    let reason;
    const source = new Readable({ read() {} });
    const composed = Stream.compose(
      source,
      new WritableStream({
        abort(why) {
          reason = why;
        },
      }),
    );
    const events = watch(composed);
    const boom = new Error("boom");
    composed.destroy(boom);
    await turnsUntil(closed(events));
    expect(events).toEqual([boom, "close"]);
    expect({ sourceDestroyed: source.destroyed, sameReason: reason === boom }).toEqual({
      sourceDestroyed: true,
      sameReason: true,
    });
  });

  // The inner pipeline reports this failure by itself, and nothing has read the web head. Node leaves it open.
  it("a function stage that fails before it reads aborts a web head with its error", async () => {
    let reason;
    const head = new TransformStream({
      cancel(why) {
        reason = why;
      },
    });
    const failed = new Error("stage failed");
    const composed = Stream.compose(
      head,
      async function* () {
        throw failed;
      },
      new PassThrough(),
    );
    const events = watch(composed);
    await turnsUntil(closed(events));
    expect(events).toEqual([failed, "close"]);
    expect(reason).toBe(failed);
  });

  // A read of the web tail is pending when destroy() runs. If destroy() ends that read with `done`,
  // the composed stream pushes null and emits 'end' in front of the error.
  it("a flowing stream emits no 'end' before the error", async () => {
    const composed = Stream.compose(new PassThrough(), new TransformStream());
    const events = watch(composed);
    composed.on("data", () => {});
    await turn();
    composed.destroy();
    await turnsUntil(closed(events));
    expect(events).toEqual([abortError, "close"]);
  });

  // User code can replace cancel() and abort(), for example with a wrapper that returns its own value.
  // The teardown must still report the error of destroy(), and not a TypeError about that value.
  it.each([
    [
      "cancel() of the web tail throws",
      () => [new PassThrough(), new TransformStream()],
      tail => tail.readable,
      "cancel",
      true,
    ],
    [
      "cancel() of the web tail returns no promise",
      () => [new PassThrough(), new TransformStream()],
      tail => tail.readable,
      "cancel",
      false,
    ],
    [
      "abort() of a writer throws",
      () => [new TransformStream(), new PassThrough()],
      () => WritableStreamDefaultWriter.prototype,
      "abort",
      true,
    ],
    [
      "abort() of a writer returns no promise",
      () => [new TransformStream(), new PassThrough()],
      () => WritableStreamDefaultWriter.prototype,
      "abort",
      false,
    ],
  ])("destroy(error) still emits that error when %s", async (_, members, owner, method, throws) => {
    const streams = members();
    const target = owner(streams.at(-1));
    const original = target[method];
    let calls = 0;
    target[method] = function (reason) {
      calls++;
      original.call(this, reason).catch(() => {});
      if (throws) throw new Error("replaced " + method);
      return 1;
    };
    try {
      const composed = Stream.compose(...streams);
      const events = watch(composed);
      const boom = new Error("boom");
      composed.destroy(boom);
      await turnsUntil(closed(events));
      expect(events).toEqual([boom, "close"]);
      expect(events[0]).toBe(boom);
      expect(calls).toBeGreaterThan(0);
    } finally {
      target[method] = original;
    }
  });

  describe("pipeline(source, compose(...), sink, { signal }) rejects with the AbortError", () => {
    it("when the signal has aborted before the call", async () => {
      const composed = Stream.compose(new PassThrough(), new TransformStream());
      const outcome = outcomeOf(
        Stream.promises.pipeline(Readable.from(["a"]), composed, sink(), { signal: AbortSignal.abort() }),
      );
      await turnsUntil(settled(outcome));
      expect(outcome.of).toEqual(abortError);
    });

    it.each([
      ["Transform, TransformStream", () => [new PassThrough(), new TransformStream()]],
      ["TransformStream, Transform", () => [new TransformStream(), new PassThrough()]],
      ["Transform, CompressionStream", () => [new PassThrough(), new CompressionStream("gzip")]],
    ])("when the signal aborts in the next turn: compose(%s)", async (_, members) => {
      const source = new Readable({ read() {} });
      source.push("a");
      const controller = new AbortController();
      const outcome = outcomeOf(
        Stream.promises.pipeline(source, Stream.compose(...members()), sink(), { signal: controller.signal }),
      );
      await turn();
      controller.abort();
      await turnsUntil(settled(outcome));
      expect(outcome.of).toEqual(abortError);
      expect(source.destroyed).toBe(true);
    });

    // The sink never completes a write, so every buffer up to the web tail fills. The inner pump then waits
    // on the web tail (writer.ready), not on its source: only a cancel of the tail's readable side wakes it.
    it("when the sink is slower than the source", async () => {
      const chunk = Buffer.alloc(65536, "a");
      const source = new Readable({
        read() {
          this.push(chunk);
        },
      });
      const slow = new Writable({ write() {} });
      const composed = Stream.compose(new PassThrough(), new TransformStream());
      const controller = new AbortController();
      const outcome = outcomeOf(Stream.promises.pipeline(source, composed, slow, { signal: controller.signal }));
      expect(await turnsUntil(() => composed.writableNeedDrain)).toBe(true);
      controller.abort();
      await turnsUntil(settled(outcome));
      expect(outcome.of).toEqual(abortError);
    });

    // The source has ended and the head has finished. Only the inner pipeline can reach the member in the middle.
    it("when a member in the middle never calls back", async () => {
      const head = new PassThrough();
      const busy = new Transform({ transform() {} });
      const composed = Stream.compose(head, busy, new TransformStream());
      const controller = new AbortController();
      const outcome = outcomeOf(
        Stream.promises.pipeline(Readable.from(["a"]), composed, sink(), { signal: controller.signal }),
      );
      expect(await turnsUntil(() => head.destroyed)).toBe(true);
      controller.abort();
      await turnsUntil(settled(outcome));
      expect(outcome.of).toEqual(abortError);
      expect(busy.destroyed).toBe(true);
    });

    // The readable side has ended and the writable side is still open: this is not a normal completion.
    // In the first shape the tail itself still takes input. In the second a member in front of the tail ended early.
    it.each([
      ["TransformStream, early end", () => [new TransformStream(), takeOne()]],
      ["TransformStream, early end, Transform", () => [new TransformStream(), takeOne(), new PassThrough()]],
    ])("when a member has ended the readable side early: compose(%s)", async (_, members) => {
      const source = new Readable({ read() {} });
      source.push("a");
      const composed = Stream.compose(...members());
      const controller = new AbortController();
      const outcome = outcomeOf(Stream.promises.pipeline(source, composed, sink(), { signal: controller.signal }));
      expect(await turnsUntil(() => composed.readableEnded)).toBe(true);
      controller.abort();
      await turnsUntil(settled(outcome));
      expect(outcome.of).toEqual(abortError);
    });

    // The cancel of the tail makes the flush that is in flight fail (it enqueues into a readable side that is
    // closed). That failure is the result of the abort, not of the program. This passes without the fix too.
    it("when the web tail is in its flush()", async () => {
      const flushing = Promise.withResolvers();
      const release = Promise.withResolvers();
      const tail = new TransformStream({
        async flush(controller) {
          flushing.resolve();
          await release.promise;
          controller.enqueue("trailer");
        },
      });
      const controller = new AbortController();
      const outcome = outcomeOf(
        Stream.promises.pipeline(Readable.from(["a"]), Stream.compose(new PassThrough(), tail), sink(), {
          signal: controller.signal,
        }),
      );
      await flushing.promise;
      controller.abort();
      await turn();
      release.resolve();
      await turnsUntil(settled(outcome));
      expect(outcome.of).toEqual(abortError);
    });
  });

  // The pump destroys the member that ended early, so the inner pipeline has an AbortError of its own when
  // destroy() runs. The cancel of the tail then makes its flush() fail. That TypeError is not the result.
  it.each([
    ["destroy()", undefined],
    ["destroy(error)", new Error("boom")],
  ])("%s while a web tail behind an early end is in its flush() emits the error of the destroy", async (_, error) => {
    const tail = new TransformStream({
      async flush(controller) {
        await turns(2);
        controller.enqueue("z");
      },
    });
    const composed = Stream.compose(slow(), takeOne(), tail);
    const events = watch(composed);
    composed.on("data", () => {});
    composed.write("a");
    composed.write("b");
    composed.end("c");
    await turns(3);
    composed.destroy(error);
    await turnsUntil(closed(events));
    expect(events).toEqual([error ?? abortError, "close"]);
  });

  // What a client that leaves does to an http response: the destination closes before the source has ended.
  describe("pipeline(source, compose(...), destination, callback) when the destination is destroyed", () => {
    it.each([
      ["Transform, TransformStream", () => [new PassThrough(), new TransformStream()]],
      ["TransformStream, Transform", () => [new TransformStream(), new PassThrough()]],
      [
        "Transform, function, Transform",
        () => [
          new PassThrough(),
          async function* (source) {
            yield* source;
          },
          new PassThrough(),
        ],
      ],
    ])("compose(%s): the callback gets ERR_STREAM_PREMATURE_CLOSE", async (_, members) => {
      const source = new Readable({ read() {} });
      const composed = Stream.compose(...members());
      const events = watch(composed);
      const destination = sink();
      const { promise, resolve } = Promise.withResolvers();
      let called = false;
      Stream.pipeline(source, composed, destination, err => {
        called = true;
        resolve(err);
      });
      await turn();
      destination.destroy();
      await turnsUntil(() => called);
      expect(called).toBe(true);
      const err = await promise;
      expect(err).toMatchObject({ code: "ERR_STREAM_PREMATURE_CLOSE" });
      expect(events).toEqual([err, "close"]);
      expect(source.destroyed).toBe(true);
    });

    // Without the fix the file stream is never destroyed: the callback never comes, and the descriptor stays open.
    it("a composed file read: the callback comes and the file closes", async () => {
      using dir = tempDir("compose-disconnect", { "data.txt": Buffer.alloc(1 << 20, "a") });
      const file = createReadStream(join(String(dir), "data.txt"));
      const closedFile = new Promise(resolve => file.once("close", resolve));
      const arrived = Promise.withResolvers();
      // Takes the first chunk and never calls back.
      const destination = new Writable({
        write() {
          arrived.resolve();
        },
      });
      const { promise, resolve } = Promise.withResolvers();
      Stream.pipeline(file.compose(new TextDecoderStream()), destination, resolve);
      await arrived.promise;
      destination.destroy();
      // The teardown reaches the file in a fixed number of turns. The callback then waits for the file to close.
      expect(await turnsUntil(() => file.destroyed)).toBe(true);
      expect(await promise).toMatchObject({ code: "ERR_STREAM_PREMATURE_CLOSE" });
      await closedFile;
    });
  });

  describe("a function stage", () => {
    // The stage waits on something other than its source. Only its signal can end it.
    it.each([
      ["destroy()", undefined, () => [new PassThrough(), new PassThrough()]],
      ["destroy(error)", new Error("boom"), () => [new PassThrough(), new PassThrough()]],
      // With a pipe() behind the stage the pipeline aborts the signal itself, before the deferred abort of stop().
      [
        "destroy(), with two members behind it",
        undefined,
        () => [new PassThrough(), new PassThrough(), new PassThrough()],
      ],
      [
        "destroy(error), with two members behind it",
        new Error("boom"),
        () => [new PassThrough(), new PassThrough(), new PassThrough()],
      ],
    ])("that waits on its signal gets the error of %s as the reason", async (_, error, around) => {
      let reason;
      const [head, ...rest] = around();
      const composed = Stream.compose(
        head,
        parked(signal => (reason = signal.reason)),
        ...rest,
      );
      const events = watch(composed);
      composed.destroy(error);
      await turnsUntil(closed(events));
      expect(events).toEqual([error ?? abortError, "close"]);
      expect(reason).toBe(events[0]);
    });

    it("between two web streams: destroy(error) emits that error", async () => {
      const composed = Stream.compose(
        new TransformStream(),
        async function* (source) {
          yield* source;
        },
        new TransformStream(),
      );
      const events = watch(composed);
      const boom = new Error("boom");
      composed.destroy(boom);
      await turnsUntil(closed(events));
      expect(events).toEqual([boom, "close"]);
      expect(events[0]).toBe(boom);
    });

    // stop() must not wait on a setImmediate that a program has replaced (fake timers).
    it("that waits on its signal is aborted when globalThis.setImmediate is replaced", async () => {
      const composed = Stream.compose(
        new PassThrough(),
        parked(signal => signal.reason),
        new PassThrough(),
      );
      const events = watch(composed);
      const original = globalThis.setImmediate;
      globalThis.setImmediate = () => {};
      try {
        composed.destroy();
      } finally {
        globalThis.setImmediate = original;
      }
      await turnsUntil(closed(events));
      expect(events).toEqual([abortError, "close"]);
    });

    describe("that fails with its own error when its signal aborts", () => {
      // destroy(error) reports the error it got, not the failure of the stage that the teardown caused.
      it("destroy(error) emits that error", async () => {
        const composed = Stream.compose(new TransformStream(), parked(stageError), new PassThrough());
        const events = watch(composed);
        const boom = new Error("boom");
        composed.destroy(boom);
        await turnsUntil(closed(events));
        expect(events).toEqual([boom, "close"]);
        expect(events[0]).toBe(boom);
      });

      // An AbortError does not hide another error: a pipeline() with a signal reports the same AggregateError.
      it("destroy() emits the AggregateError that pipeline() reports", async () => {
        const composed = Stream.compose(new PassThrough(), parked(stageError), new PassThrough());
        const events = watch(composed);
        composed.destroy();
        await turnsUntil(closed(events));
        expect(events).toEqual([stageAnd("ABORT_ERR"), "close"]);
      });

      it("a destination that is destroyed gives the AggregateError that pipeline() reports", async () => {
        const composed = Stream.compose(new PassThrough(), parked(stageError), new PassThrough());
        const destination = sink();
        const { promise, resolve } = Promise.withResolvers();
        let called = false;
        Stream.pipeline(new Readable({ read() {} }), composed, destination, err => {
          called = true;
          resolve(err);
        });
        await turn();
        destination.destroy();
        await turnsUntil(() => called);
        expect(called).toBe(true);
        expect(await promise).toEqual(stageAnd("ERR_STREAM_PREMATURE_CLOSE"));
      });

      // The signal aborts one turn after destroy(), so the result does not depend on where destroy() runs.
      // Node settles this shape (a pipe() is behind the stage), and this passes without the fix.
      it.each([
        ["a promise job", run => Promise.resolve().then(run)],
        ["a timer", run => setImmediate(run)],
        ["process.nextTick", run => process.nextTick(run)],
      ])("destroy() from %s emits the same AggregateError", async (_, schedule) => {
        const composed = Stream.compose(new PassThrough(), parked(stageError), new PassThrough(), new PassThrough());
        const events = watch(composed);
        schedule(() => composed.destroy());
        await turnsUntil(closed(events));
        expect(events).toEqual([stageAnd("ABORT_ERR"), "close"]);
      });
    });

    // The inner pipeline has an error of its own already. A pump that waits on the idle web head can keep it
    // from calling back. That error stays the result, as it does for a compose() of node streams.
    it.each([
      ["TransformStream, Transform", member => [new TransformStream(), member]],
      ["TransformStream, Transform, TransformStream", member => [new TransformStream(), member, new TransformStream()]],
    ])("a member that failed first keeps its error over destroy(error): compose(%s)", async (_, members) => {
      const failed = new Error("member failed");
      const member = new PassThrough();
      const composed = Stream.compose(...members(member));
      const events = watch(composed);
      member.destroy(failed);
      await turns(3);
      composed.destroy(new Error("boom"));
      await turnsUntil(closed(events));
      expect(events).toEqual([failed, "close"]);
    });

    // Deliberate divergence from Node v26.3.0: Node does not abort the signal of the stage here. It waits
    // for the work of the stage to end, and then emits the AbortError alone. Bun aborts the signal, the work
    // fails with an error of its own, and the result is the AggregateError that pipeline() reports for the
    // same stage.
    describe("that is busy with signal-aware work", () => {
      const busy = () =>
        async function* (source, { signal }) {
          for await (const chunk of source) {
            await new Promise((resolve, reject) => {
              const aborted = () => reject(new DOMException("The work was aborted", "AbortError"));
              signal.addEventListener("abort", aborted, { once: true });
              turns(10).then(resolve);
            });
            yield chunk;
          }
        };
      const workAnd = code =>
        expect.objectContaining({
          name: "AggregateError",
          errors: [expect.objectContaining({ name: "AbortError" }), expect.objectContaining({ code })],
        });

      it("destroy() emits an AggregateError that holds the AbortError", async () => {
        const composed = Stream.compose(new PassThrough(), busy(), new PassThrough());
        const events = watch(composed);
        composed.write("a");
        await turns(3);
        composed.destroy();
        await turnsUntil(closed(events));
        expect(events).toEqual([workAnd("ABORT_ERR"), "close"]);
      });

      it("pipeline() with a signal rejects with an AggregateError that holds the AbortError", async () => {
        const source = new Readable({ read() {} });
        source.push("a");
        const composed = Stream.compose(new PassThrough(), busy(), new PassThrough());
        const controller = new AbortController();
        const outcome = outcomeOf(Stream.promises.pipeline(source, composed, sink(), { signal: controller.signal }));
        await turns(3);
        controller.abort();
        await turnsUntil(settled(outcome));
        expect(outcome.of).toEqual(workAnd("ABORT_ERR"));
      });

      it("destroy(error) emits that error", async () => {
        const composed = Stream.compose(new PassThrough(), busy(), new PassThrough());
        const events = watch(composed);
        const boom = new Error("boom");
        composed.write("a");
        await turns(3);
        composed.destroy(boom);
        await turnsUntil(closed(events));
        expect(events).toEqual([boom, "close"]);
      });
    });
  });

  describe("every way to destroy compose(Transform, TransformStream) reaches 'close'", () => {
    const make = () => Stream.compose(new PassThrough(), new TransformStream());

    it("readable.compose(stream, { signal }) with a signal that has aborted", async () => {
      const composed = new Readable({ read() {} }).compose(new TransformStream(), { signal: AbortSignal.abort() });
      const events = watch(composed);
      await turnsUntil(closed(events));
      expect(events).toEqual([abortError, "close"]);
    });

    it("readable.compose(stream, { signal }) with a signal that aborts later", async () => {
      const controller = new AbortController();
      const composed = new Readable({ read() {} }).compose(new TransformStream(), { signal: controller.signal });
      const events = watch(composed);
      await turn();
      controller.abort();
      await turnsUntil(closed(events));
      expect(events).toEqual([abortError, "close"]);
    });

    it("addAbortSignal()", async () => {
      const controller = new AbortController();
      const composed = Stream.addAbortSignal(controller.signal, make());
      const events = watch(composed);
      controller.abort();
      await turnsUntil(closed(events));
      expect(events).toEqual([abortError, "close"]);
    });

    it("stream.destroy()", async () => {
      const composed = make();
      const events = watch(composed);
      Stream.destroy(composed);
      await turnsUntil(closed(events));
      expect(events).toEqual([abortError, "close"]);
    });

    it("Symbol.asyncDispose", async () => {
      const composed = make();
      const events = watch(composed);
      const outcome = outcomeOf(composed[Symbol.asyncDispose]());
      await turnsUntil(settled(outcome));
      expect({ disposed: outcome.of, events }).toEqual({ disposed: "resolved", events: [abortError, "close"] });
    });

    it("for await with a break", async () => {
      const composed = make();
      const events = watch(composed);
      composed.write("a");
      for await (const chunk of composed) {
        expect(chunk.toString()).toBe("a");
        break;
      }
      await turnsUntil(closed(events));
      expect(events).toEqual([abortError, "close"]);
    });

    it("take(1)", async () => {
      const composed = make();
      const events = watch(composed);
      composed.write("a");
      let taken;
      composed
        .take(1)
        .toArray()
        .then(chunks => (taken = chunks.map(String)));
      await turnsUntil(closed(events));
      expect({ taken, closed: events.at(-1) }).toEqual({ taken: ["a"], closed: "close" });
    });

    it("finished() calls back after destroy()", async () => {
      const composed = make();
      const events = watch(composed);
      const { promise, resolve } = Promise.withResolvers();
      Stream.finished(composed, resolve);
      composed.destroy();
      await turnsUntil(closed(events));
      expect(events).toEqual([abortError, "close"]);
      expect(await promise).toBe(events[0]);
    });

    it("Readable.toWeb(composed).cancel()", async () => {
      const composed = make();
      const events = watch(composed);
      await Readable.toWeb(composed).cancel();
      await turnsUntil(closed(events));
      expect(events.at(-1)).toBe("close");
    });

    it("destroy() of a compose() that holds it as a member", async () => {
      const outer = Stream.compose(new PassThrough(), make());
      const events = watch(outer);
      outer.destroy();
      await turnsUntil(closed(events));
      expect(events).toEqual([abortError, "close"]);
    });
  });

  // The file is larger than the buffers between it and the reader, so the file stream cannot end by itself.
  // Without the fix it is never destroyed, and its file descriptor stays open. With it the file stream gets
  // the AbortError of the composed stream, as a node member of any compose() does on Node.
  it("an early exit from a composed file read closes the file", async () => {
    using dir = tempDir("compose-destroy", { "data.txt": Buffer.alloc(1 << 20, "a") });
    const file = createReadStream(join(String(dir), "data.txt"));
    const events = watch(file);
    for await (const chunk of file.compose(new TextDecoderStream())) {
      expect(chunk.length).toBeGreaterThan(0);
      break;
    }
    expect(await turnsUntil(() => file.destroyed)).toBe(true);
    if (!events.includes("close")) await new Promise(resolve => file.once("close", resolve));
    expect(events).toEqual([abortError, "close"]);
  });

  // Node emits 'end' here and then waits forever: `for await` never returns, and the source stays open.
  // A compose() of node streams with the same tail emits this AbortError on Node too.
  it("a tail that ends early while the source is open: 'end', then the AbortError", async () => {
    const source = new Readable({ read() {} });
    source.push("a");
    source.push("b");
    const composed = Stream.compose(
      source,
      async function* (chunks) {
        yield* chunks;
      },
      takeOne(),
    );
    const events = watch(composed);
    const chunks = [];
    const outcome = outcomeOf(
      (async () => {
        for await (const chunk of composed) chunks.push(String(chunk));
      })(),
    );
    await turnsUntil(settled(outcome));
    expect({ chunks, events, loop: outcome.of, sourceDestroyed: source.destroyed }).toEqual({
      chunks: ["a"],
      events: ["end", abortError, "close"],
      loop: abortError,
      sourceDestroyed: true,
    });
  });

  // These cases settle on Node v26.3.0 too, with another result: its destroy() stops nothing, so the members
  // run to their end. Bun reports what a compose() of node streams reports for the same calls on Node.
  describe("destroy() after the input is complete and before 'end' is an abort", () => {
    // Node: 'end', 'close'.
    it("destroy() inside the 'data' listener of the last chunk", async () => {
      const composed = Stream.compose(new PassThrough(), new TransformStream());
      const events = watch(composed);
      const chunks = [];
      composed.on("data", chunk => {
        chunks.push(String(chunk));
        composed.destroy();
      });
      composed.end("x");
      await turnsUntil(closed(events));
      expect({ chunks, events }).toEqual({ chunks: ["x"], events: [abortError, "close"] });
    });

    // Node: 'end', 'close'.
    it("destroy() inside the flush() of a web tail", async () => {
      let composed;
      const tail = new TransformStream({
        flush() {
          composed.destroy();
        },
      });
      composed = Stream.compose(new PassThrough(), tail);
      const events = watch(composed);
      composed.on("data", () => {});
      composed.end("x");
      await turnsUntil(closed(events));
      expect(events).toEqual([abortError, "close"]);
    });

    // Node: 'close' and no error. The sink gets the chunk and closes.
    it("end(chunk), then destroy(), with a WritableStream as the last member", async () => {
      const state = { written: [], closed: false, aborted: undefined };
      const composed = Stream.compose(
        new PassThrough(),
        new WritableStream({
          write(chunk) {
            state.written.push(String(chunk));
          },
          close() {
            state.closed = true;
          },
          abort(reason) {
            state.aborted = reason;
          },
        }),
      );
      const events = watch(composed);
      composed.end("x");
      composed.destroy();
      await turnsUntil(closed(events));
      expect(events).toEqual([abortError, "close"]);
      expect(state).toEqual({ written: [], closed: false, aborted: events[0] });
    });

    // The inner pipeline has called back, so destroy() has nothing to stop. As on Node, the output that the
    // reader did not take is dropped with no error. This passes without the fix.
    it("destroy() after the inner pipeline has ended emits no error", async () => {
      const composed = Stream.compose(new PassThrough(), new TransformStream());
      const events = watch(composed);
      // With this listener the composed stream reads its tail, and the chunks stay in its buffer.
      composed.on("readable", () => {});
      composed.end("x");
      expect(await turnsUntil(() => events.includes("finish") && composed._readableState.ended)).toBe(true);
      await turns(3);
      composed.destroy();
      await turnsUntil(closed(events));
      expect(events).toEqual(["finish", "close"]);
    });
  });

  // Node v26.3.0 swallows these errors: the composed stream destroys itself with them and then waits forever,
  // or reports the success of the inner pipeline.
  describe("an error that destroys the composed stream itself is reported", () => {
    it("a web tail that gives an object to a byte stream", async () => {
      const tail = new TransformStream({
        transform(chunk, controller) {
          controller.enqueue({ not: "bytes" });
        },
      });
      const composed = Stream.compose(new PassThrough(), tail);
      const events = watch(composed);
      composed.on("data", () => {});
      composed.end("a");
      await turnsUntil(closed(events));
      expect(events).toEqual([expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }), "close"]);
    });

    it.each([
      [
        "end(chunk) on a compose() that is not writable",
        () => [new Readable({ read() {} }), new TransformStream()],
        composed => composed.end("x"),
      ],
      [
        "write() after end()",
        () => [new PassThrough(), new TransformStream()],
        composed => {
          composed.end("a");
          composed.write("b");
        },
      ],
    ])("%s", async (_, members, act) => {
      const composed = Stream.compose(...members());
      const events = watch(composed);
      act(composed);
      await turnsUntil(closed(events));
      expect(events).toEqual([expect.objectContaining({ code: "ERR_STREAM_WRITE_AFTER_END" }), "close"]);
    });
  });

  // As a compose() of node streams does on every runtime: 'error' with no listener is an uncaught exception.
  // Node v26.3.0 prints nothing here and exits 0, because its destroy() never completes.
  it("destroy() with no 'error' listener throws the AbortError", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { compose, PassThrough } = require("node:stream");
         compose(new PassThrough(), new TransformStream()).destroy();`,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(stderr).toContain("AbortError");
    expect(exitCode).toBe(1);
  });

  // destroy() also runs at the end of a stream that completed: autoDestroy calls it. Then nothing may be
  // stopped, because the inner pipeline is about to call back with its own result. These pass without the fix.
  describe("a composed stream that completes is left as Node leaves it", () => {
    const run = async (composed, act) => {
      const events = watch(composed);
      const chunks = [];
      composed.on("data", chunk => chunks.push(String(chunk)));
      act?.(composed);
      await turnsUntil(closed(events));
      return { chunks, events: events.map(event => (typeof event === "string" ? event : event.code)) };
    };

    it("an early end behind a slow head: 'end', 'finish', 'close' and no error", async () => {
      const composed = Stream.compose(slow(), new TransformStream(), takeOne(), new PassThrough());
      const result = await run(composed, () => {
        composed.write("a");
        composed.write("b");
        composed.end("c");
      });
      expect(result).toEqual({ chunks: ["a"], events: ["end", "finish", "close"] });
    });

    it("an early end behind a slow head: destroy() inside the 'end' listener emits no error", async () => {
      const composed = Stream.compose(slow(), new TransformStream(), takeOne(), new PassThrough());
      const result = await run(composed, () => {
        composed.on("end", () => composed.destroy());
        composed.write("a");
        composed.write("b");
        composed.end("c");
      });
      expect(result).toEqual({ chunks: ["a"], events: ["end", "close"] });
    });

    // The tail itself ends the output early. Its input has ended by the time of 'end', so it completes.
    it("an early end of the tail behind a slow head: destroy() inside the 'end' listener emits no error", async () => {
      const composed = Stream.compose(slow(), new TransformStream(), takeOne(), takeOne());
      const result = await run(composed, () => {
        composed.on("end", () => composed.destroy());
        composed.write("a");
        composed.write("b");
        composed.end("c");
      });
      expect(result).toEqual({ chunks: ["a"], events: ["end", "close"] });
    });

    // 'finish' comes when the tail is done, and the head still works then.
    it("a compose() with no readable side, an early end behind a slow head: 'finish', 'close' and no error", async () => {
      const composed = Stream.compose(slow(), new TransformStream(), takeOne(), sink());
      const result = await run(composed, () => {
        composed.write("a");
        composed.write("b");
        composed.end("c");
      });
      expect(result).toEqual({ chunks: [], events: ["finish", "close"] });
    });

    // After a turn this runs in a promise job. Then 'finish' comes before the inner pipeline has called back.
    it("destroy() inside the 'finish' listener, before 'end', emits no error", async () => {
      await turn();
      const composed = Stream.compose(
        new TransformStream(),
        async function* (source) {
          for await (const chunk of source) {
            yield chunk;
            return;
          }
        },
        new TransformStream(),
      );
      const { events } = await run(composed, () => {
        composed.on("finish", () => composed.destroy());
        composed.write("a");
        composed.write("b");
        composed.end("c");
      });
      expect(events.filter(event => event !== "end")).toEqual(["finish", "close"]);
    });

    it("an early end with a source that ends by itself: 'end', 'close' and no error", async () => {
      const composed = Stream.compose(
        Readable.from(["a", "b", "c"]),
        new TransformStream(),
        takeOne(),
        new PassThrough(),
      );
      expect(await run(composed)).toEqual({ chunks: ["a"], events: ["end", "close"] });
    });

    it("compose(Readable, WritableStream): 'close' only, and the sink gets every chunk", async () => {
      const state = { written: [], closed: false };
      const composed = Stream.compose(
        Readable.from(["a", "b"]),
        new WritableStream({
          write(chunk) {
            state.written.push(String(chunk));
          },
          close() {
            state.closed = true;
          },
        }),
      );
      const events = watch(composed);
      await turnsUntil(closed(events));
      expect({ events, state }).toEqual({ events: ["close"], state: { written: ["a", "b"], closed: true } });
    });

    // The two calls that destroy() makes for an early stop. A normal completion makes neither.
    it("no cancel() of a web tail and no abort() of the writer of a web head", async () => {
      const tail = new TransformStream();
      const calls = [];
      const cancel = tail.readable.cancel;
      tail.readable.cancel = function (reason) {
        calls.push("cancel");
        return cancel.call(this, reason);
      };
      const abort = WritableStreamDefaultWriter.prototype.abort;
      WritableStreamDefaultWriter.prototype.abort = function (reason) {
        calls.push("abort");
        return abort.call(this, reason);
      };
      try {
        const composed = Stream.compose(new TransformStream(), tail);
        const { chunks, events } = await run(composed, () => composed.end("a"));
        expect({ chunks, events: events.toSorted(), calls }).toEqual({
          chunks: ["a"],
          events: ["close", "end", "finish"],
          calls: [],
        });
      } finally {
        WritableStreamDefaultWriter.prototype.abort = abort;
      }
    });
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
