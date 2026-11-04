// bytes, bytearray, memoryview and whatever else exports its memory in Python, where Bun takes a typed array or an ArrayBuffer.
import { $ } from "bun";
import { Database } from "bun:sqlite";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { isASAN, isDebug, tempDir } from "harness";
import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import array from "python:array";
import { BufferError, ValueError, bytearray, bytes, dict, exec, len, memoryview, slice } from "python:builtins";
import { getitem } from "python:operator";

// These builds take seconds to start Python.
if (isDebug || isASAN) setDefaultTimeout(60_000);

const text = "héllo";
const utf8 = [...new TextEncoder().encode(text)];
/** The same six bytes, each time in a new object. */
const kinds: [string, () => any][] = [
  ["bytes", () => bytes(utf8)],
  ["bytearray", () => bytearray(utf8)],
  ["memoryview", () => memoryview(bytes(utf8))],
  ["a part of a bytearray", () => getitem(memoryview(bytearray([0, ...utf8, 0])), slice(1, -1))],
  ["array.array", () => array.array("B", utf8)],
  ["a memoryview of a Uint8Array", () => memoryview(new Uint8Array(utf8))],
];
const released = () => {
  const view = memoryview(bytes(utf8));
  view.release();
  return view;
};
const strided = () => getitem(memoryview(bytes(utf8)), slice(undefined, undefined, 2));

describe.each(kinds)("%s", (name, make) => {
  test("is the body of a Response, a Request and a Blob", async () => {
    expect(await new Response(make()).text()).toBe(text);
    expect([...(await new Response(make()).bytes())]).toEqual(utf8);
    expect(await new Request("http://a.example", { method: "POST", body: make() }).text()).toBe(text);
    expect(new Blob([make(), "!", make()]).size).toBe(13);
    expect(await new Blob([make(), "!"]).text()).toBe(text + "!");
    expect(await new File([make()], "name").text()).toBe(text);
  });

  test("is decoded, hashed and compressed", async () => {
    expect(new TextDecoder().decode(make())).toBe(text);
    expect(new StringDecoder("utf8").write(make())).toBe(text);
    expect(Bun.hash.crc32(make())).toBe(Bun.hash.crc32(text));
    expect(Bun.hash(make())).toBe(Bun.hash(text));
    expect(new Bun.CryptoHasher("sha1").update(make()).digest("hex")).toBe(Bun.SHA1.hash(text, "hex"));
    expect(Bun.SHA1.hash(make(), "hex")).toBe(Bun.SHA1.hash(text, "hex"));
    expect(crypto.createHash("sha1").update(make()).digest("hex")).toBe(Bun.SHA1.hash(text, "hex"));
    expect(crypto.createHmac("sha1", make()).update(make()).digest("hex")).toBe(
      crypto.createHmac("sha1", text).update(text).digest("hex"),
    );
    expect(Buffer.from(await crypto.subtle.digest("SHA-1", make())).toString("hex")).toBe(Bun.SHA1.hash(text, "hex"));
    expect(new TextDecoder().decode(Bun.gunzipSync(Bun.gzipSync(make())))).toBe(text);
    expect(new TextDecoder().decode(Bun.inflateSync(Bun.deflateSync(make())))).toBe(text);
    expect(crypto.timingSafeEqual(make(), make())).toBe(true);
  });

  test("is what Buffer compares, joins and looks for", () => {
    const buffer = Buffer.from(text);
    expect(Buffer.concat([make(), buffer, make()]).toString()).toBe(text.repeat(3));
    expect(Buffer.compare(make(), buffer)).toBe(0);
    expect(Buffer.compare(buffer, make())).toBe(0);
    expect(buffer.equals(make())).toBe(true);
    expect(buffer.compare(make())).toBe(0);
    expect(Buffer.from("-" + text).indexOf(make())).toBe(1);
    expect(Buffer.from("-" + text).includes(make())).toBe(true);
    expect(Buffer.byteLength(make())).toBe(6);
    expect(Buffer.alloc(12, make()).toString()).toBe(text + text);
    expect(Buffer.alloc(12).fill(make()).toString()).toBe(text + text);
    expect(Buffer.from(make()).toString()).toBe(text);
  });

  test("is written to files", async () => {
    using dir = tempDir("python-buffers", {});
    const file = path.join(String(dir), "file");
    expect(await Bun.write(file, make())).toBe(6);
    expect(fs.readFileSync(file, "utf8")).toBe(text);
    fs.writeFileSync(file, make());
    fs.appendFileSync(file, make());
    expect(fs.readFileSync(file, "utf8")).toBe(text + text);
    const writer = Bun.file(file).writer();
    writer.write(make());
    writer.write(make());
    await writer.end();
    expect(fs.readFileSync(file, "utf8")).toBe(text + text);
  });

  test("is a blob in SQLite", () => {
    using db = new Database(":memory:");
    db.run("create table t (b blob)");
    db.run("insert into t values (?)", [make()]);
    expect(db.query("select b, typeof(b) as type from t").get()).toEqual({ b: new Uint8Array(utf8), type: "blob" });
  });

  test("is a chunk of a stream", async () => {
    const stream = () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(make());
          controller.enqueue(make());
          controller.close();
        },
      });
    expect(await Bun.readableStreamToText(stream())).toBe(text + text);
    expect([...(await Bun.readableStreamToBytes(stream()))]).toEqual([...utf8, ...utf8]);
    expect(await new Response(stream()).text()).toBe(text + text);
    expect(await Array.fromAsync(stream().pipeThrough(new TextDecoderStream()))).toEqual([text, text]);
    expect(
      await new Response(
        stream().pipeThrough(new CompressionStream("gzip")).pipeThrough(new DecompressionStream("gzip")),
      ).text(),
    ).toBe(text + text);
  });

  test("goes over HTTP and WebSockets", async () => {
    const { promise: echoed, resolve } = Promise.withResolvers<unknown>();
    using server = Bun.serve({
      port: 0,
      async fetch(request, server) {
        if (server.upgrade(request)) return;
        expect(await request.text()).toBe(text);
        return new Response(make());
      },
      websocket: {
        message(socket, message) {
          expect(message).toEqual(Buffer.from(text));
          socket.send(make());
        },
      },
    });
    expect(await (await fetch(server.url, { method: "POST", body: make() })).text()).toBe(text);
    const socket = new WebSocket(server.url.href.replace("http", "ws"));
    socket.binaryType = "arraybuffer";
    socket.onopen = () => socket.send(make());
    socket.onmessage = event => resolve(event.data);
    expect(new TextDecoder().decode((await echoed) as ArrayBuffer)).toBe(text);
    socket.close();
  });

  // An array has items of a type, which a Uint8Array would lose.
  test.skipIf(name === "array.array")("is cloned as a Uint8Array", () => {
    expect(structuredClone(make())).toEqual(new Uint8Array(utf8));
  });
});

describe("memory that can be written to", () => {
  test("is filled where it is", () => {
    const target = bytearray(8);
    expect(crypto.getRandomValues(target)).toBe(target);
    expect(crypto.randomFillSync(target)).toBe(target);
    expect(new TextEncoder().encodeInto(text, target)).toEqual({ read: 5, written: 6 });
    expect([...target].slice(0, 6)).toEqual(utf8);

    using dir = tempDir("python-buffers", { file: "abcdef" });
    const fd = fs.openSync(path.join(String(dir), "file"), "r");
    const whole = bytearray(6);
    expect(fs.readSync(fd, getitem(memoryview(whole), slice(2, 5)), 0, 3, 0)).toBe(3);
    fs.closeSync(fd);
    expect(Buffer.from(whole).toString("latin1")).toBe("\0\0abc\0");
  });

  test("a view of a typed array writes to the typed array", () => {
    const array = new Uint8Array(6);
    new TextEncoder().encodeInto(text, memoryview(array));
    expect([...array]).toEqual(utf8);
  });

  test("bytes are not", () => {
    using dir = tempDir("python-buffers", { file: "abcdef" });
    const fd = fs.openSync(path.join(String(dir), "file"), "r");
    for (const target of [bytes(4), memoryview(bytes(4)), memoryview(bytearray(4)).toreadonly()]) {
      expect(() => crypto.getRandomValues(target)).toThrow();
      expect(() => crypto.randomFillSync(target)).toThrow();
      expect(() => new TextEncoder().encodeInto(text, target)).toThrow();
      expect(() => fs.readSync(fd, target, 0, 4, 0)).toThrow();
      expect(() => fs.read(fd, target, 0, 4, 0, () => {})).toThrow();
      expect([...target]).toEqual([0, 0, 0, 0]);
    }
    fs.closeSync(fd);
  });
});

describe("for as long as Bun uses the memory", () => {
  test("of a bytearray, it cannot be resized", async () => {
    using dir = tempDir("python-buffers", {});
    const file = path.join(String(dir), "file");
    const data = bytearray(200_000);
    const { promise, resolve } = Promise.withResolvers<unknown>();
    fs.writeFile(file, data, resolve);
    expect(() => data.append(1)).toThrow(BufferError);
    expect(() => data.clear()).toThrow("Existing exports of data: object cannot be re-sized");
    expect(await promise).toBeNull();
    data.append(1);
    expect(len(data)).toBe(200_001);
    expect(fs.statSync(file).size).toBe(200_000);

    const target = bytearray(4);
    const fd = fs.openSync(file, "r");
    const read = Promise.withResolvers<unknown>();
    fs.read(fd, target, 0, 4, 0, (error, count, buffer) => read.resolve([error, count, buffer]));
    expect(() => target.clear()).toThrow(BufferError);
    expect(await read.promise).toEqual([null, 4, target]);
    fs.closeSync(fd);
    target.clear();
    expect(len(target)).toBe(0);
  });

  test("nothing else has to keep it", async () => {
    using dir = tempDir("python-buffers", {});
    const file = path.join(String(dir), "file");
    const { promise, resolve } = Promise.withResolvers<unknown>();
    fs.writeFile(file, bytearray(Buffer.alloc(200_000, "y")), resolve);
    Bun.gc(true);
    expect(await promise).toBeNull();
    expect(fs.readFileSync(file).equals(Buffer.alloc(200_000, "y"))).toBe(true);
  });

  test("a call that has returned holds nothing, and what is kept is a copy", async () => {
    const data = bytearray(utf8);
    const kept = [
      new Response(data),
      new Blob([data]),
      new Request("http://a.example", { method: "POST", body: data }),
    ];
    Bun.hash(data);
    new TextDecoder().decode(data);
    data.clear();
    data.extend(bytes(100));
    for (const body of kept) expect(await body.text()).toBe(text);
  });
});

describe("memory that cannot be had", () => {
  const takers: [string, (value: any) => unknown][] = [
    ["Response", value => new Response(value)],
    ["Blob", value => new Blob([value])],
    ["Bun.hash", value => Bun.hash(value)],
    ["TextDecoder", value => new TextDecoder().decode(value)],
    ["Buffer.concat", value => Buffer.concat([value])],
    ["createHash", value => crypto.createHash("sha1").update(value)],
    ["fs.writeFileSync", value => fs.writeFileSync("/dev/null", value)],
    ["structuredClone", value => structuredClone(value)],
  ];
  test.each(takers)("%s says what Python says", (_, take) => {
    expect(() => take(released())).toThrow(ValueError);
    expect(() => take(released())).toThrow("operation forbidden on released memoryview object");
    expect(() => take(strided())).toThrow(BufferError);
  });
});

// Such an object gives its bytes by running code of the program.
describe("an instance of a class whose __buffer__() is written in Python", () => {
  const globals = dict();
  exec(
    `
class Exporter:
    def __init__(self, data, before=None):
        self.data, self.before, self.calls = data, before, 0
    def __buffer__(self, flags):
        self.calls += 1
        if self.before:
            self.before()
        return memoryview(self.data)
`,
    globals,
  );
  const Exporter = getitem(globals, "Exporter");

  test("is a buffer where arguments are converted before anything else is done", async () => {
    const make = () => Exporter(bytes(utf8));
    expect(await new Response(make()).text()).toBe(text);
    expect(await new Blob([make(), "!"]).text()).toBe(text + "!");
    expect(new TextDecoder().decode(make())).toBe(text);
    expect(new StringDecoder("utf8").write(make())).toBe(text);
    expect(Buffer.concat([make()]).toString()).toBe(text);
    expect(Bun.hash(make())).toBe(Bun.hash(text));
    expect(crypto.createHmac("sha1", make()).update(text).digest("hex")).toBe(
      crypto.createHmac("sha1", text).update(text).digest("hex"),
    );
  });

  test("is no buffer to what has looked at its own state already, and is not asked", () => {
    const hash = crypto.createHash("sha1");
    const finalizes = Exporter(bytes(utf8), () => hash.digest());
    expect(() => hash.update(finalizes)).toThrow(TypeError);
    expect(finalizes.calls).toBe(0);
    expect(hash.update(text).digest("hex")).toBe(Bun.SHA1.hash(text, "hex"));

    using db = new Database(":memory:");
    const statement = db.query("select ? as data");
    const closes = Exporter(bytes(utf8), () => statement.finalize());
    expect(() => statement.get(closes)).toThrow();
    expect(closes.calls).toBe(0);

    const target = Exporter(bytearray(4));
    expect(() => crypto.randomFillSync(target)).toThrow(TypeError);
    expect(() => crypto.getRandomValues(target)).toThrow(TypeError);
    expect(target.calls).toBe(0);
  });
});

test("the shell redirects from it and to it", async () => {
  for (const [echo, cat] of [
    ["echo", "cat"], // Built in.
    ["/bin/echo", "/bin/cat"],
  ]) {
    const target = bytearray(4);
    await $`${echo} hi > ${target}`;
    expect(Buffer.from(target).toString("latin1")).toBe("hi\n\0");
    expect(await $`${cat} < ${bytes(utf8)}`.text()).toBe(text);
    expect(async () => await $`${echo} hi > ${bytes(4)}`).toThrow("read-only");
  }
});

test("WebAssembly compiles bytes", async () => {
  // (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add)
  const wasm = [
    0, 97, 115, 109, 1, 0, 0, 0, 1, 7, 1, 96, 2, 127, 127, 1, 127, 3, 2, 1, 0, 7, 7, 1, 3, 97, 100, 100, 0, 0, 10, 9, 1,
    7, 0, 32, 0, 32, 1, 106, 11,
  ];
  expect(WebAssembly.validate(bytes(wasm))).toBe(true);
  const add = (module: WebAssembly.Module) => (new WebAssembly.Instance(module).exports.add as Function)(2, 3);
  expect(add(new WebAssembly.Module(bytearray(wasm)))).toBe(5);
  expect(add(await WebAssembly.compile(memoryview(bytes(wasm))))).toBe(5);
});

// fs.write() and fs.writeSync() look at the argument in JavaScript, with util.types.isArrayBufferView(), and read its byteLength.
test.failing("fs.writeSync", () => {
  using dir = tempDir("python-buffers", {});
  const fd = fs.openSync(path.join(String(dir), "file"), "w");
  try {
    expect(fs.writeSync(fd, bytes(utf8))).toBe(6);
  } finally {
    fs.closeSync(fd);
  }
});

test("to code written in JavaScript they are not typed arrays", () => {
  const data = bytes(utf8);
  expect(data instanceof Uint8Array).toBe(false);
  expect(ArrayBuffer.isView(data)).toBe(false);
  expect(Buffer.isBuffer(data)).toBe(false);
  expect(new Uint8Array(data)).toEqual(new Uint8Array(utf8));
});
