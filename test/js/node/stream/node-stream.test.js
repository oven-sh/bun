import { describe, expect, it, jest } from "bun:test";
import { bunEnv, bunExe, isGlibcVersionAtLeast, isMacOS, tmpdirSync } from "harness";
import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Duplex, PassThrough, Readable, Stream, Transform, Writable } from "node:stream";
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
    expect(await new Response(stdout).text()).toBe(`${ARRAY_SIZE}\n`);
  });
});

it.if(isMacOS || isGlibcVersionAtLeast("2.36.0"))("TTY streams", () => {
  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "test", join(import.meta.dir, "tty-streams.fixture.js")],
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  expect(stdout.toString()).toBe("");
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
  const err = await new Response(stderr).text();
  expect(err).toBeEmpty();
  const out = await new Response(stdout).text();
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
