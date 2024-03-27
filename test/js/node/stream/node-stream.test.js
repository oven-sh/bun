import { expect, describe, it } from "bun:test";
import { Stream, Readable, Writable, Duplex, Transform, PassThrough } from "node:stream";
import { createReadStream } from "node:fs";
import { join } from "path";
import { bunExe, bunEnv } from "harness";
import { tmpdir } from "node:os";
import { writeFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";

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

const ttyStreamsTest = `
import tty from "tty";
import fs from "fs";

import { dlopen } from "bun:ffi";

const suffix = process.platform === "darwin" ? "dylib" : "so.6";

var lazyOpenpty;
export function openpty() {
  if (!lazyOpenpty) {
    lazyOpenpty = dlopen(\`libc.\${suffix}\`, {
      openpty: {
        args: ["ptr", "ptr", "ptr", "ptr", "ptr"],
        returns: "int",
      },
    }).symbols.openpty;
  }

  const parent_fd = new Int32Array(1).fill(0);
  const child_fd = new Int32Array(1).fill(0);
  const name_buf = new Int8Array(1000).fill(0);
  const term_buf = new Uint8Array(1000).fill(0);
  const win_buf = new Uint8Array(1000).fill(0);

  lazyOpenpty(parent_fd, child_fd, name_buf, term_buf, win_buf);

  return {
    parent_fd: parent_fd[0],
    child_fd: child_fd[0],
  };
}

var lazyClose;
export function close(fd) {
  if (!lazyClose) {
    lazyClose = dlopen(\`libc.\${suffix}\`, {
      close: {
        args: ["int"],
        returns: "int",
      },
    }).symbols.close;
  }

  lazyClose(fd);
}

describe("TTY", () => {
  it("ReadStream stdin", () => {
    const { parent_fd, child_fd } = openpty();
    const rs = new tty.ReadStream(parent_fd);
    const rs1 = tty.ReadStream(child_fd);
    expect(rs1 instanceof tty.ReadStream).toBe(true);
    expect(rs instanceof tty.ReadStream).toBe(true);
    expect(tty.isatty(rs.fd)).toBe(true);
    expect(tty.isatty(rs1.fd)).toBe(true);
    expect(rs.isRaw).toBe(false);
    expect(rs.isTTY).toBe(true);
    expect(rs.setRawMode).toBeInstanceOf(Function);
    expect(rs.setRawMode(true)).toBe(rs);
    expect(rs.isRaw).toBe(true);
    expect(rs.setRawMode(false)).toBe(rs);
    expect(rs.isRaw).toBe(false);
    close(parent_fd);
    close(child_fd);
  });
  it("WriteStream stdout", () => {
    const { child_fd, parent_fd } = openpty();
    const ws = new tty.WriteStream(child_fd);
    const ws1 = tty.WriteStream(parent_fd);
    expect(ws1 instanceof tty.WriteStream).toBe(true);
    expect(ws instanceof tty.WriteStream).toBe(true);
    expect(tty.isatty(ws.fd)).toBe(true);
    expect(ws.isTTY).toBe(true);

    // pseudo terminal, not the best test because cols and rows can be 0
    expect(ws.columns).toBeGreaterThanOrEqual(0);
    expect(ws.rows).toBeGreaterThanOrEqual(0);
    expect(ws.getColorDepth()).toBeGreaterThanOrEqual(0);
    expect(ws.hasColors(2)).toBe(true);
    close(parent_fd);
    close(child_fd);
  });
  it("process.stdio tty", () => {
    // this isnt run in a tty, so stdin will not appear to be a tty
    expect(process.stdin instanceof fs.ReadStream).toBe(true);
    expect(process.stdout instanceof tty.WriteStream).toBe(true);
    expect(process.stderr instanceof tty.WriteStream).toBe(true);
    expect(process.stdin.isTTY).toBeUndefined();

    if (tty.isatty(1)) {
      expect(process.stdout.isTTY).toBeDefined();
    } else {
      expect(process.stdout.isTTY).toBeUndefined();
    }

    if (tty.isatty(2)) {
      expect(process.stderr.isTTY).toBeDefined();
    } else {
      expect(process.stderr.isTTY).toBeUndefined();
    }
  });
  it("read and write stream prototypes", () => {
    expect(tty.ReadStream.prototype.setRawMode).toBeInstanceOf(Function);
    expect(tty.WriteStream.prototype.clearLine).toBeInstanceOf(Function);
    expect(tty.WriteStream.prototype.clearScreenDown).toBeInstanceOf(Function);
    expect(tty.WriteStream.prototype.cursorTo).toBeInstanceOf(Function);
    expect(tty.WriteStream.prototype.getColorDepth).toBeInstanceOf(Function);
    expect(tty.WriteStream.prototype.getWindowSize).toBeInstanceOf(Function);
    expect(tty.WriteStream.prototype.hasColors).toBeInstanceOf(Function);
    expect(tty.WriteStream.prototype.hasColors).toBeInstanceOf(Function);
    expect(tty.WriteStream.prototype.moveCursor).toBeInstanceOf(Function);
  });
});
`;

it.skipIf(isWindows)("TTY streams", () => {
  mkdirSync(join(tmpdir(), "tty-test"), { recursive: true });
  writeFileSync(join(tmpdir(), "tty-test/tty-streams.test.js"), ttyStreamsTest, {});

  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "test", "tty-streams.test.js"],
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
    cwd: join(tmpdir(), "tty-test"),
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
