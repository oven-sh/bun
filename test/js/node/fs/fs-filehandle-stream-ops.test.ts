/**
 * A stream on a FileHandle (`handle.createReadStream()`, `fs.createWriteStream(null, { fd: handle })`) does its I/O
 * through the handle, as Node's FileHandleOperations does:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/streams.js#L86-L116
 *
 * - A read or a write that the handle refuses reaches the stream as an error, and the stream closes. Bun threw the
 *   error from inside `_read` / `_write` / `_writev`, and the stream then waited for an I/O callback that never came.
 * - The `fd` property of the stream is not the target of the I/O.
 * - `handle.read`, `handle.write` and `handle.writev` are the methods that the stream calls. While a handle has the
 *   built-in method, Bun makes that method's call to the binding itself. The stream must not show which of the two ran.
 *
 * The expected values are what Node.js v26.3.0 gives, and the last test runs this file in Node.js to check them. For
 * that the file uses node:test and node:assert, and takes nothing from "harness" outside the block for Bun at its end.
 * The tests under "only in Bun" say where Bun is not Node.
 *
 * Works with both:
 *   bun bd test test/js/node/fs/fs-filehandle-stream-ops.test.ts
 *   node --test test/js/node/fs/fs-filehandle-stream-ops.test.ts
 */
import assert from "node:assert";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { after, before, describe, test } from "node:test";
import { promisify } from "node:util";

type FileHandle = fs.promises.FileHandle;

let dir: string;
let source: string;
let files = 0;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-filehandle-stream-ops-"));
  source = newFile("0123456789");
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function newFile(content = "") {
  const file = path.join(dir, `file-${files++}.txt`);
  fs.writeFileSync(file, content);
  return file;
}

/** What the stream emits, in order. */
function record(stream: Readable | Writable) {
  const events: string[] = [];
  stream.on("error", (err: NodeJS.ErrnoException) => events.push(`error ${err.name} ${err.code}: ${err.message}`));
  stream.on("data", chunk => events.push(`data ${chunk}`));
  for (const name of ["end", "finish", "close"]) stream.on(name, () => events.push(name));
  return events;
}

/** For an error whose text in Bun is not the text of Node. */
const withoutMessages = (events: string[]) => events.map(event => event.replace(/: .*/, ""));

/** Unlike `events.once()`, this does not reject when the stream emits 'error' first. */
function closed(stream: Readable | Writable) {
  return new Promise(resolve => stream.once("close", resolve));
}

/** Resolves once the stream has written `chunk`: the stream is then constructed and idle. */
function written(stream: Writable, chunk: unknown) {
  return new Promise(resolve => stream.write(chunk, resolve));
}

/** Replaces `handle[name]` with a function that counts its calls and does the same. The stream then calls it. */
function countCalls(handle: FileHandle, name: "read" | "write" | "writev") {
  const method: Function = handle[name];
  const counter = { calls: 0 };
  (handle as any)[name] = function (this: unknown, ...args: unknown[]) {
    counter.calls++;
    return method.apply(this, args);
  };
  return counter;
}

const outOfRange = (position: string, must = ">= -1 && <= 9007199254740991") =>
  `error RangeError ERR_OUT_OF_RANGE: The value of "position" is out of range. It must be ${must}. Received ${position}`;
const notBytes = (received: string) =>
  `The "buffer" argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received ${received}`;
const badDescriptor = (syscall: string) => `error Error EBADF: EBADF: bad file descriptor, ${syscall}`;

describe("a stream on a FileHandle reports a failed operation and closes", () => {
  const positions: [number, string][] = [
    [-5, outOfRange("-5")],
    [1.5, outOfRange("1.5", "an integer")],
    [2 ** 53, outOfRange("9_007_199_254_740_992")],
  ];
  for (const [position, error] of positions) {
    test(`read at the invalid position ${position}`, async () => {
      const handle = await fs.promises.open(source, "r");
      // `pos` and `fd` are public properties of a stream, but @types/node does not declare them writable.
      const stream: any = handle.createReadStream();
      const events = record(stream);
      stream.pos = position;
      await closed(stream);
      assert.deepStrictEqual(events, [error, "close"]);
      assert.strictEqual(handle.fd, -1);
    });
  }

  test("read through fs.createReadStream(null, { fd: handle })", async () => {
    const handle = await fs.promises.open(source, "r");
    const stream: any = fs.createReadStream(null as any, { fd: handle });
    const events = record(stream);
    stream.pos = -5;
    await closed(stream);
    assert.deepStrictEqual(events, [outOfRange("-5"), "close"]);
    assert.strictEqual(handle.fd, -1);
  });

  test("for await rejects", async () => {
    const handle = await fs.promises.open(source, "r");
    const stream: any = handle.createReadStream();
    stream.pos = -5;
    await assert.rejects(
      async () => {
        for await (const chunk of stream) void chunk;
      },
      { name: "RangeError", code: "ERR_OUT_OF_RANGE" },
    );
    // Settles only when the stream has given back its ref on the handle.
    await handle.close();
  });

  // handle.write() takes a string or an ArrayBufferView.
  const refused: [string, unknown, string][] = [
    ["an object", {}, "an instance of Object"],
    ["an array", [1, 2], "an instance of Array"],
    ["an ArrayBuffer", new ArrayBuffer(2), "an instance of ArrayBuffer"],
  ];
  for (const [name, chunk, received] of refused) {
    test(`write() of ${name} in objectMode does not throw`, async () => {
      const file = newFile();
      const handle = await fs.promises.open(file, "w");
      const stream: any = handle.createWriteStream({ objectMode: true } as any);
      const events = record(stream);
      await written(stream, Buffer.from("ok"));
      const { promise, resolve } = Promise.withResolvers<NodeJS.ErrnoException>();
      stream.write(chunk, resolve);
      const { name: errorName, code, message } = await promise;
      assert.deepStrictEqual(
        { name: errorName, code, message },
        { name: "TypeError", code: "ERR_INVALID_ARG_TYPE", message: notBytes(received) },
      );
      await closed(stream);
      assert.deepStrictEqual(events, [`error TypeError ERR_INVALID_ARG_TYPE: ${notBytes(received)}`, "close"]);
      assert.strictEqual(handle.fd, -1);
      assert.strictEqual(fs.readFileSync(file, "utf8"), "ok");
    });
  }

  test("uncork() of strings in objectMode does not throw", async () => {
    const file = newFile();
    const handle = await fs.promises.open(file, "w");
    const stream: any = fs.createWriteStream(null as any, { fd: handle, objectMode: true } as any);
    const events = record(stream);
    await written(stream, Buffer.from("ok"));
    stream.cork();
    stream.write("ab");
    stream.write("cd");
    stream.uncork();
    await closed(stream);
    // Node: `The "buffers" argument must be an ArrayBufferView[]. Received an instance of Array`.
    assert.deepStrictEqual(withoutMessages(events), ["error TypeError ERR_INVALID_ARG_TYPE", "close"]);
    assert.strictEqual(handle.fd, -1);
    assert.strictEqual(fs.readFileSync(file, "utf8"), "ok");
  });

  // handle.write() reads `byteLength` to see if there is anything to write.
  test("write() of a chunk whose byteLength throws does not throw", async () => {
    const file = newFile();
    const handle = await fs.promises.open(file, "w");
    const stream = handle.createWriteStream();
    const events = record(stream);
    await written(stream, Buffer.from("ok"));
    const chunk = Object.defineProperty(Buffer.from("abc"), "byteLength", {
      get() {
        throw new Error("no byteLength");
      },
    });
    const error = (await written(stream, chunk)) as Error;
    assert.strictEqual(error.message, "no byteLength");
    await closed(stream);
    assert.deepStrictEqual(events, ["error Error undefined: no byteLength", "close"]);
    assert.strictEqual(handle.fd, -1);
    assert.strictEqual(fs.readFileSync(file, "utf8"), "ok");
  });

  // The three tests below set `stream.fd`, so that the unfixed stream fails them too: it gave that value to the system.
  test("a read that the system refuses", async () => {
    const handle = await fs.promises.open(newFile("0123456789"), "w");
    const stream: any = handle.createReadStream();
    const events = record(stream);
    stream.fd = -1;
    await closed(stream);
    assert.deepStrictEqual(events, [badDescriptor("read"), "close"]);
    assert.strictEqual(handle.fd, -1);
  });

  test("a write that the system refuses", async () => {
    const handle = await fs.promises.open(source, "r");
    const stream: any = handle.createWriteStream();
    const events = record(stream);
    stream.fd = -1;
    const { promise, resolve } = Promise.withResolvers<NodeJS.ErrnoException>();
    stream.write("abc", resolve);
    assert.strictEqual((await promise).code, "EBADF");
    await closed(stream);
    assert.deepStrictEqual(events, [badDescriptor("write"), "close"]);
    assert.strictEqual(handle.fd, -1);
  });

  test("a writev that the system refuses", async () => {
    const handle = await fs.promises.open(source, "r");
    const stream: any = handle.createWriteStream();
    const events = record(stream);
    stream.fd = -1;
    stream.cork();
    stream.write("abc");
    const { promise, resolve } = Promise.withResolvers<NodeJS.ErrnoException>();
    stream.write("def", resolve);
    stream.uncork();
    assert.strictEqual((await promise).code, "EBADF");
    await closed(stream);
    // Node names the system call `write`, Bun `writev`.
    assert.deepStrictEqual(withoutMessages(events), ["error Error EBADF", "close"]);
    assert.strictEqual(handle.fd, -1);
  });
});

describe("a stream on a FileHandle does its I/O on the handle, not on stream.fd", () => {
  test("read with stream.fd = -1", async () => {
    const handle = await fs.promises.open(source, "r");
    const stream: any = handle.createReadStream();
    const events = record(stream);
    stream.fd = -1;
    await closed(stream);
    assert.deepStrictEqual(events, ["data 0123456789", "end", "close"]);
    assert.strictEqual(handle.fd, -1);
  });

  test("read with stream.fd = the descriptor of another file", async () => {
    const other = fs.openSync(newFile("OTHER"), "r");
    try {
      const handle = await fs.promises.open(source, "r");
      const stream: any = handle.createReadStream();
      const events = record(stream);
      stream.fd = other;
      await closed(stream);
      assert.deepStrictEqual(events, ["data 0123456789", "end", "close"]);
      assert.strictEqual(handle.fd, -1);
      // The stream did not read from the other descriptor and did not close it.
      const buffer = Buffer.alloc(5);
      assert.strictEqual(fs.readSync(other, buffer, 0, 5, null), 5);
      assert.strictEqual(buffer.toString(), "OTHER");
    } finally {
      fs.closeSync(other);
    }
  });

  test("write and writev with stream.fd = -1", async () => {
    const file = newFile();
    const handle = await fs.promises.open(file, "w");
    const stream: any = handle.createWriteStream();
    const events = record(stream);
    stream.fd = -1;
    await written(stream, Buffer.from("ok"));
    stream.cork();
    stream.write("abc");
    stream.write("def");
    stream.end();
    await closed(stream);
    assert.deepStrictEqual(events, ["finish", "close"]);
    assert.strictEqual(handle.fd, -1);
    assert.strictEqual(fs.readFileSync(file, "utf8"), "okabcdef");
  });

  test("write and writev with stream.fd = the descriptor of another file", async () => {
    const otherFile = newFile();
    const other = fs.openSync(otherFile, "w");
    try {
      const file = newFile();
      const handle = await fs.promises.open(file, "w");
      const stream: any = handle.createWriteStream();
      const events = record(stream);
      stream.fd = other;
      await written(stream, Buffer.from("ok"));
      stream.cork();
      stream.write("abc");
      stream.write("def");
      stream.end();
      await closed(stream);
      assert.deepStrictEqual(events, ["finish", "close"]);
      assert.strictEqual(handle.fd, -1);
      assert.strictEqual(fs.readFileSync(file, "utf8"), "okabcdef");
      // The stream did not write to the other descriptor and did not close it.
      assert.strictEqual(fs.writeSync(other, "x"), 1);
      assert.strictEqual(fs.readFileSync(otherFile, "utf8"), "x");
    } finally {
      fs.closeSync(other);
    }
  });

  test("a stream that has to open a file reports that it cannot", async () => {
    const handle = await fs.promises.open(source, "r");
    const stream: any = handle.createReadStream();
    const events = record(stream);
    // A stream opens its path when `fd` is not a number at the time it is constructed, one tick from here.
    stream.fd = "x";
    await closed(stream);
    assert.deepStrictEqual(events, [
      "error Error ERR_METHOD_NOT_IMPLEMENTED: The open() method is not implemented",
      "close",
    ]);
    assert.strictEqual(handle.fd, -1);
  });
});

describe("a stream on a FileHandle calls the methods of the handle", () => {
  // A string goes to handle.write(string, position, encoding): the stream gives 0 for the position and the length for
  // the encoding. Up to Node.js v26 an unknown encoding means UTF-8, and so it does in Bun. Node.js v27 refuses one:
  // the two streams below then report ERR_UNKNOWN_ENCODING and write nothing. https://github.com/nodejs/node/pull/66247
  const unknownEncodingIsUtf8 = Number(process.versions.node.split(".")[0]) < 27;

  (unknownEncodingIsUtf8 ? test : test.skip)("each objectMode string is written at position 0", async () => {
    const file = newFile("..........");
    const handle = await fs.promises.open(file, "r+");
    const stream: any = handle.createWriteStream({ objectMode: true, start: 5 } as any);
    const events = record(stream);
    await written(stream, "abc");
    stream.end("XY");
    await closed(stream);
    assert.deepStrictEqual(events, ["finish", "close"]);
    assert.strictEqual(handle.fd, -1);
    // Not `start`, and the second string is over the first.
    assert.strictEqual(fs.readFileSync(file, "utf8"), "XYc.......");
  });

  // The stream counts a string in UTF-16 units and the handle answers in bytes, so the stream asks for a rest.
  (unknownEncodingIsUtf8 ? test : test.skip)("an objectMode string of more bytes than units fails", async () => {
    const file = newFile();
    const handle = await fs.promises.open(file, "w");
    const stream: any = handle.createWriteStream({ objectMode: true } as any);
    const events = record(stream);
    stream.end("\u00e9");
    await closed(stream);
    // Node: SystemError ERR_SYSTEM_ERROR, from `new ERR_SYSTEM_ERROR('write failed')`. Bun: Error, `write failed`.
    assert.deepStrictEqual(
      events.map(event => event.split(" ")[0]),
      ["error", "close"],
    );
    assert.strictEqual(handle.fd, -1);
    assert.strictEqual(fs.readFileSync(file, "utf8"), "\u00e9");
  });

  test("an objectMode DataView goes to handle.write(view, 0, undefined, position)", async () => {
    const file = newFile("..........");
    const handle = await fs.promises.open(file, "r+");
    const stream: any = handle.createWriteStream({ objectMode: true, start: 5 } as any);
    const events = record(stream);
    // A DataView has no `length`, and the stream passes that on.
    stream.end(new DataView(new Uint8Array([0x41, 0x42]).buffer));
    await closed(stream);
    assert.deepStrictEqual(events, ["finish", "close"]);
    assert.strictEqual(handle.fd, -1);
    assert.strictEqual(fs.readFileSync(file, "utf8"), ".....AB...");
  });

  for (const replaced of [false, true]) {
    test(`each write is at its position, with ${replaced ? "replaced" : "built-in"} methods`, async () => {
      const file = newFile("....................");
      const handle = await fs.promises.open(file, "r+");
      const counters = replaced ? [countCalls(handle, "write"), countCalls(handle, "writev")] : [];
      const stream: any = handle.createWriteStream({ start: 5 });
      const events = record(stream);
      stream.fd = -1;
      await written(stream, Buffer.from("AB"));
      stream.cork();
      stream.write("cd");
      stream.write("ef");
      stream.uncork();
      stream.end("GH");
      await closed(stream);
      assert.deepStrictEqual(events, ["finish", "close"]);
      assert.strictEqual(fs.readFileSync(file, "utf8"), ".....ABcdefGH.......");
      assert.deepStrictEqual(
        counters.map(counter => counter.calls),
        replaced ? [2, 1] : [],
      );
    });
  }

  test("handle.read replaced after the first read", async () => {
    const handle = await fs.promises.open(source, "r");
    const stream = handle.createReadStream({ highWaterMark: 5 });
    const events = record(stream);
    let read: { calls: number } | undefined;
    stream.once("data", () => (read = countCalls(handle, "read")));
    await closed(stream);
    assert.deepStrictEqual(events, ["data 01234", "data 56789", "end", "close"]);
    // One read for the second half, one for the end of the file.
    assert.strictEqual(read?.calls, 2);
  });

  test("handle.write replaced after the first write", async () => {
    const file = newFile();
    const handle = await fs.promises.open(file, "w");
    const stream = handle.createWriteStream();
    const events = record(stream);
    await written(stream, Buffer.from("ok"));
    const write = countCalls(handle, "write");
    stream.end("abc");
    await closed(stream);
    assert.deepStrictEqual(events, ["finish", "close"]);
    assert.strictEqual(write.calls, 1);
    assert.strictEqual(fs.readFileSync(file, "utf8"), "okabc");
  });

  test("handle.writev replaced before the stream exists, while handle.write is not", async () => {
    const file = newFile();
    const handle = await fs.promises.open(file, "w");
    const writev = countCalls(handle, "writev");
    const stream = handle.createWriteStream();
    const events = record(stream);
    stream.cork();
    stream.write("abc");
    stream.write("def");
    stream.end();
    await closed(stream);
    assert.deepStrictEqual(events, ["finish", "close"]);
    assert.strictEqual(writev.calls, 1);
    assert.strictEqual(fs.readFileSync(file, "utf8"), "abcdef");
  });

  test("handle.writev replaced after the first writev", async () => {
    const file = newFile();
    const handle = await fs.promises.open(file, "w");
    const stream = handle.createWriteStream();
    const events = record(stream);
    stream.cork();
    stream.write("ab");
    const { promise, resolve } = Promise.withResolvers<unknown>();
    stream.write("cd", resolve);
    stream.uncork();
    await promise;
    const writev = countCalls(handle, "writev");
    stream.cork();
    stream.write("ef");
    stream.write("gh");
    stream.end();
    await closed(stream);
    assert.deepStrictEqual(events, ["finish", "close"]);
    assert.strictEqual(writev.calls, 1);
    assert.strictEqual(fs.readFileSync(file, "utf8"), "abcdefgh");
  });

  for (const fails of [false, true]) {
    test(`a stream with the flush option calls handle.sync before it closes, and sync ${fails ? "fails" : "succeeds"}`, async () => {
      const file = newFile();
      const handle = await fs.promises.open(file, "w");
      const stream = handle.createWriteStream({ flush: true });
      const events = record(stream);
      const sync = handle.sync;
      handle.sync = function () {
        events.push("sync");
        return fails ? Promise.reject(new Error("no sync")) : sync.call(this);
      };
      stream.end("abc");
      await closed(stream);
      assert.deepStrictEqual(events, ["finish", "sync", ...(fails ? ["error Error undefined: no sync"] : []), "close"]);
      assert.strictEqual(handle.fd, -1);
      assert.strictEqual(fs.readFileSync(file, "utf8"), "abc");
    });
  }

  // The system writes a part of the chunk, and the stream has to write the rest of the same chunk.
  (process.platform === "linux" ? test : test.skip)(
    "a write and a writev that a file size limit cuts short",
    async () => {
      const script = `
      const fs = require("node:fs");
      const closed = stream => new Promise(resolve => stream.once("close", resolve));
      const megabyte = letter => Buffer.alloc(1 << 20, letter);
      async function run(file, use) {
        const handle = await fs.promises.open(file, "w");
        const stream = handle.createWriteStream();
        const events = [];
        stream.on("error", err => events.push("error " + err.code));
        stream.on("finish", () => events.push("finish"));
        use(stream);
        await closed(stream);
        const content = fs.readFileSync(file);
        const cut = content.length > 0 && content.length < 4 << 20;
        return { events, cut, allCounted: stream.bytesWritten === content.length, head: content.toString("latin1", 0, 4) };
      }
      (async () => {
        const write = await run(process.argv[1], stream => stream.end(Buffer.concat([..."ABCD"].map(megabyte))));
        const writev = await run(process.argv[2], stream => {
          stream.cork();
          for (const letter of "ABCD") stream.write(megabyte(letter));
          stream.end();
        });
        console.log(JSON.stringify({ write, writev }));
      })();
    `;
      // The unit of `ulimit -f` is 512 or 1024 bytes: the limit is 1 or 2 MiB, under the 4 MiB that each stream writes.
      // `process.execPath` is Bun or Node.js, whichever runs this test.
      const limited = ["-c", 'ulimit -f 2048; exec "$0" "$@"', process.execPath, "-e", script, newFile(), newFile()];
      const { stdout } = await promisify(execFile)("sh", limited);
      const expected = { events: ["error EFBIG"], cut: true, allCounted: true, head: "AAAA" };
      assert.deepStrictEqual(JSON.parse(stdout), { write: expected, writev: expected });
    },
  );
});

// In Node.js both columns are one path. In Bun the first is the call to the binding and the second is the method.
describe("a stream on a FileHandle is the same with the built-in method and with a replaced one", () => {
  const bytes = <T extends ArrayBufferLike>(buffer: T) => (new Uint8Array(buffer).set([0x41, 0x42]), buffer);
  const chunks: [string, (calls: string[]) => unknown][] = [
    ["a Buffer", () => Buffer.from("AB")],
    ["an empty Buffer", () => Buffer.alloc(0)],
    ["an empty Float64Array", () => new Float64Array(0)],
    ["a Uint16Array", () => new Uint16Array([0x4241])],
    ["a Uint8Array with no length", () => Object.defineProperty(new Uint8Array([0x41, 0x42]), "length", {})],
    ["a DataView", () => new DataView(bytes(new ArrayBuffer(2)))],
    ["an ArrayBuffer", () => bytes(new ArrayBuffer(2))],
    ["an ArrayBuffer with a length", () => Object.assign(bytes(new ArrayBuffer(2)), { length: 2 })],
    ["a SharedArrayBuffer with a length", () => Object.assign(bytes(new SharedArrayBuffer(2)), { length: 2 })],
    ["a string", () => "AB"],
    ["a String object", () => new String("AB")],
    [
      "a String object with its own toString",
      calls => Object.assign(new String("AB"), { toString: () => (calls.push("toString"), "ZZ") }),
    ],
    ["an array", () => [0x41, 0x42]],
  ];

  async function write(flags: string, start: number | undefined, make: (calls: string[]) => unknown, replace: boolean) {
    const file = newFile("..........");
    const handle = await fs.promises.open(file, flags);
    if (replace) countCalls(handle, "write");
    const stream: any = handle.createWriteStream({ objectMode: true, start } as any);
    const events = record(stream);
    const calls: string[] = [];
    stream.end(make(calls));
    await closed(stream);
    const content = fs.readFileSync(file, "latin1");
    return { flags, start, events, calls, content, bytesWritten: stream.bytesWritten, fd: handle.fd };
  }

  for (const [name, make] of chunks) {
    test(`write of ${name}`, async () => {
      for (const flags of ["r+", "r"]) {
        for (const start of [undefined, 3]) {
          assert.deepStrictEqual(await write(flags, start, make, false), await write(flags, start, make, true));
        }
      }
    });
  }

  async function writev(flags: string, start: number | undefined, pair: () => unknown[], replace: boolean) {
    const file = newFile("..........");
    const handle = await fs.promises.open(file, flags);
    if (replace) countCalls(handle, "writev");
    const stream: any = handle.createWriteStream({ objectMode: true, start } as any);
    const events = record(stream);
    stream.cork();
    for (const chunk of pair()) stream.write(chunk);
    stream.end();
    await closed(stream);
    const content = fs.readFileSync(file, "latin1");
    return { flags, start, events, content, bytesWritten: stream.bytesWritten, fd: handle.fd };
  }

  const pairs: [string, () => unknown[]][] = [
    ["two Buffers", () => [Buffer.from("AB"), Buffer.from("CD")]],
    ["two empty Buffers", () => [Buffer.alloc(0), Buffer.alloc(0)]],
    ["a DataView and a Uint8Array", () => [new DataView(bytes(new ArrayBuffer(2))), new Uint8Array([0x43, 0x44])]],
    ["two strings", () => ["AB", "CD"]],
  ];
  for (const [name, pair] of pairs) {
    test(`writev of ${name}`, async () => {
      for (const flags of ["r+", "r"]) {
        for (const start of [undefined, 3]) {
          assert.deepStrictEqual(await writev(flags, start, pair, false), await writev(flags, start, pair, true));
        }
      }
    });
  }

  async function read(position: unknown, replace: boolean) {
    const handle = await fs.promises.open(source, "r");
    if (replace) countCalls(handle, "read");
    const stream: any = handle.createReadStream();
    const events = record(stream);
    stream.pos = position;
    await closed(stream);
    return { position, events, bytesRead: stream.bytesRead, fd: handle.fd };
  }

  test("read at each position", async () => {
    for (const position of [undefined, 0, 3, -1, -5, 1.5, "3", null]) {
      assert.deepStrictEqual(await read(position, false), await read(position, true));
    }
  });
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, bunExe, nodeExeAtLeast } = await import("harness");

  describe("only in Bun", () => {
    // Node.js refuses a closed handle in the constructor of the stream, with ERR_OUT_OF_RANGE. #34907 does that in Bun.
    test("a stream on a closed FileHandle reports EBADF and closes", async () => {
      const handle = await fs.promises.open(source, "r");
      for await (const chunk of fs.createReadStream(null as any, { fd: handle })) void chunk;
      assert.strictEqual(handle.fd, -1);
      await assert.rejects(
        async () => {
          for await (const chunk of fs.createReadStream(null as any, { fd: handle })) void chunk;
        },
        { name: "SystemError", code: "EBADF" },
      );
      // One chunk is a write. Two chunks that wait for the stream are a writev.
      for (const chunks of [["abc"], ["abc", "def"]]) {
        const stream = fs.createWriteStream(null as any, { fd: handle });
        const events = record(stream);
        for (const chunk of chunks) stream.write(chunk);
        await closed(stream);
        assert.deepStrictEqual(withoutMessages(events), ["error SystemError EBADF", "close"]);
      }
    });

    // In Node.js the callback of the read or the write is a promise job, and such a throw is an unhandled rejection.
    test("a throw from inside the callback of the binding is an uncaught exception in the AsyncLocalStorage context of the operation", async () => {
      const script = `
        const { AsyncLocalStorage } = require("node:async_hooks");
        const { open } = require("node:fs/promises");
        const als = new AsyncLocalStorage();
        const reports = [];
        let reported;
        const report = kind => err => {
          reports.push(kind + ": " + err.message + ", in " + als.getStore());
          reported();
        };
        process.on("uncaughtException", report("uncaughtException"));
        process.on("unhandledRejection", report("unhandledRejection"));
        const fail = message => () => {
          throw new Error(message);
        };
        // The handles stay referenced: one that is collected unclosed reports an error of its own.
        const handles = [];
        async function writer() {
          handles.push(await open(process.argv[2], "w"));
          const stream = handles.at(-1).createWriteStream();
          await new Promise(resolve => stream.write("a", resolve));
          return stream;
        }
        (async () => {
          handles.push(await open(process.argv[1]));
          let next = new Promise(resolve => (reported = resolve));
          als.run("the read", () => handles[0].createReadStream().once("data", fail("a 'data' listener")));
          await next;
          let stream = await writer();
          next = new Promise(resolve => (reported = resolve));
          als.run("the write", () => stream.write("b", fail("a write callback")));
          await next;
          stream = await writer();
          next = new Promise(resolve => (reported = resolve));
          als.run("the writev", () => {
            stream.cork();
            stream.write("b");
            stream.write("c", fail("a writev callback"));
            stream.uncork();
          });
          await next;
          console.log(reports.join("\\n"));
          process.exit(0);
        })();
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script, source, newFile()],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const reports = [
        "uncaughtException: a 'data' listener, in the read",
        "uncaughtException: a write callback, in the write",
        "uncaughtException: a writev callback, in the writev",
      ];
      assert.deepStrictEqual(
        { stdout, stderr, exitCode },
        { stdout: reports.join("\n") + "\n", stderr: "", exitCode: 0 },
      );
    });
  });

  // Before v24 Node.js cannot parse the `await using` of this block. From v24.0.0 to v26.13.0 it passes every test.
  const node = nodeExeAtLeast("24.0.0");
  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      await using proc = Bun.spawn({
        // A test that hangs in Node.js fails by name instead of running this one out of time.
        cmd: [node!, "--test-timeout=15000", "--test-force-exit", import.meta.filename],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
