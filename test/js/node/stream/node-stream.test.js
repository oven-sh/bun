import { describe, expect, it, jest } from "bun:test";
import { bunEnv, bunExe, isGlibcVersionAtLeast, isMacOS, tmpdirSync } from "harness";
import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Duplex, finished, isDisturbed, isErrored, isReadable, isWritable, PassThrough, Readable, Stream, Transform, Writable } from "node:stream";
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

  it("should emit readable on end", () => {
    expect([join(import.meta.dir, "emit-readable-on-end.js")]).toRun();
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

// Node documents WHATWG web streams as valid operands for these helpers and brands its own
// web stream classes with Symbol.for("nodejs.stream.*") getters. Bun's streams are native and
// don't carry those symbols, so the helpers read the internal [[state]]/[[disturbed]] directly.
describe("isReadable/isWritable/isErrored/isDisturbed on WHATWG web streams", () => {
  const probe = stream => ({
    isReadable: isReadable(stream),
    isWritable: isWritable(stream),
    isErrored: isErrored(stream),
    isDisturbed: isDisturbed(stream),
  });

  it("ReadableStream: readable", () => {
    const rs = new ReadableStream({ start(c) { c.enqueue("x"); } });
    expect(probe(rs)).toEqual({ isReadable: true, isWritable: null, isErrored: false, isDisturbed: false });
  });

  it("ReadableStream: closed", () => {
    const rs = new ReadableStream({ start(c) { c.close(); } });
    expect(probe(rs)).toEqual({ isReadable: false, isWritable: null, isErrored: false, isDisturbed: false });
  });

  it("ReadableStream: errored + disturbed after read()", async () => {
    const rs = new ReadableStream({ start(c) { c.error(new Error("boom")); } });
    await rs.getReader().read().catch(() => {});
    expect(probe(rs)).toEqual({ isReadable: false, isWritable: null, isErrored: true, isDisturbed: true });
  });

  it("ReadableStream: disturbed after cancel()", async () => {
    const rs = new ReadableStream({ start(c) { c.enqueue("x"); } });
    await rs.cancel();
    expect(probe(rs)).toEqual({ isReadable: false, isWritable: null, isErrored: false, isDisturbed: true });
  });

  it("ReadableStream: disturbed after successful read(), still readable", async () => {
    const rs = new ReadableStream({ start(c) { c.enqueue("x"); } });
    const reader = rs.getReader();
    await reader.read();
    reader.releaseLock();
    expect(probe(rs)).toEqual({ isReadable: true, isWritable: null, isErrored: false, isDisturbed: true });
  });

  it("WritableStream: writable", () => {
    const ws = new WritableStream({ write() {} });
    expect(probe(ws)).toEqual({ isReadable: null, isWritable: true, isErrored: false, isDisturbed: false });
  });

  it("WritableStream: closed", async () => {
    const ws = new WritableStream({ write() {} });
    const writer = ws.getWriter();
    await writer.close();
    writer.releaseLock();
    expect(probe(ws)).toEqual({ isReadable: null, isWritable: false, isErrored: false, isDisturbed: false });
  });

  it("WritableStream: errored", async () => {
    const ws = new WritableStream({ start(c) { c.error(new Error("boom")); } });
    await ws.getWriter().closed.catch(() => {});
    expect(probe(ws)).toEqual({ isReadable: null, isWritable: false, isErrored: true, isDisturbed: false });
  });

  it("TransformStream falls through (no web-stream brand)", () => {
    const ts = new TransformStream();
    expect(probe(ts)).toEqual({ isReadable: null, isWritable: null, isErrored: false, isDisturbed: false });
  });

  it("Symbol.for('nodejs.stream.*') overrides still take precedence", () => {
    const rs = new ReadableStream({ start(c) { c.enqueue("x"); } });
    Object.defineProperty(rs, Symbol.for("nodejs.stream.readable"), { value: false });
    expect(isReadable(rs)).toBe(false);
  });

  it("node Readable/Writable operands are unaffected", () => {
    const r = new Readable({ read() {} });
    expect(isReadable(r)).toBe(true);
    expect(isErrored(r)).toBe(false);
    expect(isDisturbed(r)).toBe(false);
    r.destroy();

    const w = new Writable({ write(chunk, enc, cb) { cb(); } });
    expect(isWritable(w)).toBe(true);
    expect(isErrored(w)).toBe(false);
    w.destroy();
  });
});
