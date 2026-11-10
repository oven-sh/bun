import { deserialize as jscDeserialize, serialize as jscSerialize } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { BlockList } from "node:net";
import { types } from "node:util";
import v8 from "node:v8";

function thrownBy(fn: () => unknown): any {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

// What node throws from v8.serialize() and v8.deserialize(): an Error and no DOMException, with no code.
function expectPlainError(error: any, message: string | RegExp) {
  expect({
    name: error.name,
    code: error.code,
    prototypeIsErrorPrototype: Object.getPrototypeOf(error) === Error.prototype,
    isError: Error.isError(error),
    isNativeError: types.isNativeError(error),
  }).toEqual({ name: "Error", code: undefined, prototypeIsErrorPrototype: true, isError: true, isNativeError: true });
  expect(error.message).toMatch(message);
}

// Buffer identity through v8.serialize/deserialize, matching node v26.3.0's
// serializer delegate behavior (DefaultSerializer host objects). Non-Buffer
// payloads keep the bare JSC-serialized format for backward compatibility.
describe("v8 serialize/deserialize Buffer identity", () => {
  test("Buffer round-trips as Buffer", () => {
    const out = v8.deserialize(v8.serialize(Buffer.from("hi")));
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.toString()).toBe("hi");
  });

  test("Uint8Array stays Uint8Array (node preserves the distinction)", () => {
    const out = v8.deserialize(v8.serialize(new Uint8Array([1, 2])));
    expect(Buffer.isBuffer(out)).toBe(false);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out)).toEqual([1, 2]);
  });

  test("other typed arrays keep their type", () => {
    const out = v8.deserialize(v8.serialize(new Float64Array([1.5])));
    expect(out).toBeInstanceOf(Float64Array);
    expect(out[0]).toBe(1.5);
  });

  test("nested Buffers, aliasing preserved", () => {
    const b = Buffer.from("hello world").subarray(6, 9);
    const out = v8.deserialize(v8.serialize({ deep: { list: [b, b] } }));
    expect(Buffer.isBuffer(out.deep.list[0])).toBe(true);
    expect(out.deep.list[0]).toBe(out.deep.list[1]);
    expect(out.deep.list[0].toString()).toBe("wor");
    expect(out.deep.list[0].length).toBe(3);
  });

  test("Buffers as Map keys and values", () => {
    const m = new Map([[Buffer.from("k"), { v: Buffer.from("v") }]]);
    const out = v8.deserialize(v8.serialize(m)) as Map<any, any>;
    const [key, value] = [...out][0];
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(Buffer.isBuffer(value.v)).toBe(true);
  });

  test("Buffer-free payloads keep the bare format (old readers still work)", () => {
    const jsc = require("bun:jsc");
    const bytes = v8.serialize({ n: 1, s: "x" });
    // Bare JSC bytes deserialize directly — no envelope framing present.
    expect(jsc.deserialize(bytes)).toEqual({ n: 1, s: "x" });
    // And deserialize accepts pre-envelope output produced by jsc.serialize.
    const legacy = jsc.serialize({ buf: new Uint8Array([7]) }, { binaryType: "nodebuffer" });
    expect(v8.deserialize(legacy)).toEqual({ buf: new Uint8Array([7]) });
  });

  test("rejects an envelope whose buffer list holds a non-Uint8Array view", () => {
    // The envelope's buffer list gets Buffer.prototype applied to each entry.
    // A crafted payload can put any typed array there; only Uint8Arrays may
    // become Buffers.
    const jsc = require("bun:jsc");
    const f = new Float64Array([1.5]);
    const payload = jsc.serialize([{ b: f }, [f]], { binaryType: "nodebuffer" });
    const magic = Buffer.from([0xff, 0x42, 0x55, 0x4e, 0x01]);
    expect(() => v8.deserialize(Buffer.concat([magic, payload]))).toThrow("failed to parse serialized buffer envelope");
  });

  test("circular structures with Buffers", () => {
    const obj: any = { buf: Buffer.from("c") };
    obj.self = obj;
    const out = v8.deserialize(v8.serialize(obj));
    expect(out.self).toBe(out);
    expect(Buffer.isBuffer(out.buf)).toBe(true);
  });

  test("round-trip survives tampered globals and prototypes", async () => {
    // Everything the envelope framing touches is captured at module load, so
    // tampering after the module loads must not reach serialize/deserialize.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const v8 = require("node:v8");
        ArrayBuffer.isView = () => false;
        Buffer.allocUnsafe = () => { throw new Error("tampered allocUnsafe"); };
        Buffer.prototype.copy = () => { throw new Error("tampered copy"); };
        const TAProto = Object.getPrototypeOf(Uint8Array.prototype);
        for (const k of ["buffer", "byteOffset", "byteLength"]) {
          Object.defineProperty(TAProto, k, { get() { throw new Error("tampered " + k); } });
        }
        Uint8Array.prototype.subarray = () => { throw new Error("tampered subarray"); };
        Object.defineProperty(Uint8Array.prototype, "constructor", { get() { throw new Error("tampered constructor"); } });
        globalThis.Uint8Array = function Poisoned() { throw new Error("tampered ctor"); };
        const jsc = require("bun:jsc");
        jsc.serialize = () => { throw new Error("tampered bun:jsc serialize"); };
        jsc.deserialize = () => { throw new Error("tampered bun:jsc deserialize"); };
        const out = v8.deserialize(v8.serialize({ b: Buffer.from("hi") }));
        console.log(Buffer.isBuffer(out.b), out.b.toString());`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("true hi\n");
    expect(exitCode).toBe(0);
  });

  test("DataView and ArrayBuffer inputs survive tampered brand checks", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const v8 = require("node:v8");
        const bytes = v8.serialize({ b: Buffer.from("dv") });
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        ArrayBuffer.isView = () => false;
        Object.defineProperty(ArrayBuffer, Symbol.hasInstance, { value: () => false });
        Object.defineProperty(SharedArrayBuffer, Symbol.hasInstance, { value: () => false });
        const a = v8.deserialize(dv);
        const b = v8.deserialize(ab);
        console.log(Buffer.isBuffer(a.b), Buffer.isBuffer(b.b));`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("true true\n");
    expect(exitCode).toBe(0);
  });
});

// v8.serialize() has a native entry of its own. For a value without a Buffer it answers what bun:jsc's serialize() answers.
describe("v8.serialize of a value without a Buffer", () => {
  test.each([
    ["an object", () => ({ n: 1, s: "x" })],
    ["a string", () => "text"],
    ["undefined", () => undefined],
    ["a Map", () => new Map([[1, { b: 2 }]])],
    ["a Uint8Array", () => new Uint8Array([1, 2])],
    ["a SharedArrayBuffer", () => new SharedArrayBuffer(4)],
    ["a Blob", () => new Blob(["bytes"])],
    ["a BlockList", () => new BlockList()],
  ])("%s: a Buffer with the bytes of bun:jsc serialize", (_name, make) => {
    const value = make();
    const bytes = v8.serialize(value);
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes.toString("hex")).toBe(jscSerialize(value, { binaryType: "nodebuffer" }).toString("hex"));
  });
});

// node's DefaultSerializer throws an Error for a value that cannot be cloned, where
// structured clone throws a DataCloneError DOMException:
// https://github.com/nodejs/node/blob/v26.3.0/lib/v8.js#L379
describe("v8.serialize of a value that cannot be cloned", () => {
  const needsTransfer = "Object that needs transfer was found in message but not listed in transferList";
  // node names the value: "#<Object> could not be cloned."
  const couldNotBeCloned = /could not be cloned\.$/;

  function detachedArrayBuffer() {
    const buffer = new ArrayBuffer(8);
    structuredClone(buffer, { transfer: [buffer] });
    return buffer;
  }

  function onDetachedArrayBuffer<View>(make: (buffer: ArrayBuffer) => View): View {
    const buffer = new ArrayBuffer(8);
    const view = make(buffer);
    structuredClone(buffer, { transfer: [buffer] });
    return view;
  }

  function revokedProxy() {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    return proxy;
  }

  test.each([
    ["a Proxy", () => new Proxy({}, {})],
    ["a revoked Proxy", revokedProxy],
    ["a function", () => () => {}],
    ["a symbol", () => Symbol("s")],
    ["a nested function", () => ({ list: [function named() {}] })],
    ["a Map that holds a function", () => new Map([["key", () => {}]])],
    ["a detached ArrayBuffer", detachedArrayBuffer],
    // node throws a TypeError for a view on a detached ArrayBuffer: its DefaultSerializer cannot wrap the bytes.
    ["a Uint8Array on a detached ArrayBuffer", () => onDetachedArrayBuffer(buffer => new Uint8Array(buffer))],
    ["a DataView on a detached ArrayBuffer", () => onDetachedArrayBuffer(buffer => new DataView(buffer))],
  ])("%s throws an Error", (_name, make) => {
    expectPlainError(
      thrownBy(() => v8.serialize(make())),
      couldNotBeCloned,
    );
    // A Buffer in the value takes the envelope path.
    expectPlainError(
      thrownBy(() => v8.serialize({ value: make(), buffer: Buffer.from("x") })),
      couldNotBeCloned,
    );
  });

  test("a MessagePort throws an Error", () => {
    const { port1, port2 } = new MessageChannel();
    try {
      // The text is the serializer's. node's text here is "Unserializable host object: MessagePort ...".
      expectPlainError(
        thrownBy(() => v8.serialize({ port: port1 })),
        needsTransfer,
      );
      expectPlainError(
        thrownBy(() => v8.serialize({ port: port1, buffer: Buffer.from("x") })),
        needsTransfer,
      );
    } finally {
      port1.close();
      port2.close();
    }
  });

  test("no trap of a Proxy runs", () => {
    const trapsRun: string[] = [];
    const handler = Object.fromEntries(
      ["ownKeys", "getOwnPropertyDescriptor", "get", "has", "getPrototypeOf"].map(trap => [
        trap,
        () => {
          trapsRun.push(trap);
          throw new RangeError(`the ${trap} trap ran`);
        },
      ]),
    ) as ProxyHandler<object>;
    expectPlainError(
      thrownBy(() => v8.serialize(new Proxy({ key: 1 }, handler))),
      couldNotBeCloned,
    );
    expectPlainError(
      thrownBy(() => v8.serialize({ nested: new Proxy({ key: 1 }, handler), buffer: Buffer.from("x") })),
      couldNotBeCloned,
    );
    expect(trapsRun).toEqual([]);
  });

  test("a Proxy that the serializer does not come to stops nothing", () => {
    // Of a Date the serializer takes the time and no property.
    const date = Object.assign(new Date(0), { proxy: revokedProxy() });
    expect(v8.deserialize(v8.serialize(date))).toEqual(new Date(0));
    expect(v8.deserialize(v8.serialize({ date, buffer: Buffer.from("x") }))).toEqual({
      date: new Date(0),
      buffer: Buffer.from("x"),
    });
  });

  test("what a getter throws passes through", () => {
    // It has the look of the serializer's own error, and it is not that error.
    const own = new DOMException("thrown by a getter", "DataCloneError");
    const value = {
      get throws() {
        throw own;
      },
    };
    expect(thrownBy(() => v8.serialize(value))).toBe(own);
    expect(thrownBy(() => v8.serialize({ value, buffer: Buffer.from("x") }))).toBe(own);
  });

  test("a value that nests too deep throws a RangeError", () => {
    // The serializer stops at 40,000 levels. Sets are the cheapest containers to nest that deep.
    const root = new Set<unknown>();
    for (let i = 0, set = root; i < 41_000; i++) {
      const inner = new Set<unknown>();
      set.add(inner);
      set = inner;
    }
    expect(() => v8.serialize(root)).toThrow(RangeError);
  });

  test("a CryptoKey that is not extractable throws an Error", async () => {
    const secret = new TextEncoder().encode("THIS-IS-SECRET-KEY-MATERIAL-32B!");
    const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    // node's text here is "Unserializable host object: CryptoKey ...", and node refuses a key that is extractable too.
    expectPlainError(
      thrownBy(() => v8.serialize(key)),
      couldNotBeCloned,
    );
    expectPlainError(
      thrownBy(() => v8.serialize({ key, buffer: Buffer.from("x") })),
      couldNotBeCloned,
    );
  });

  test("structured clone still throws a DataCloneError", () => {
    const { port1, port2 } = new MessageChannel();
    const channel = new BroadcastChannel("v8-serialize-uncloneable");
    try {
      const uncloneable = () => {};
      for (const clone of [
        () => structuredClone(uncloneable),
        () => jscSerialize(uncloneable),
        () => jscSerialize(uncloneable, { binaryType: "arraybuffer" }),
        () => jscSerialize(uncloneable, { binaryType: "nodebuffer" }),
        () => port1.postMessage(uncloneable),
        () => channel.postMessage(uncloneable),
      ]) {
        const error = thrownBy(clone);
        expect(error).toBeInstanceOf(DOMException);
        expect({ name: error.name, code: error.code }).toEqual({ name: "DataCloneError", code: 25 });
      }
      // The serializer reports a port that no transfer list names. Each of these callers throws it with node's text.
      for (const clone of [
        () => structuredClone({ port: port2 }),
        () => jscSerialize({ port: port2 }),
        () => port1.postMessage({ port: port2 }),
      ]) {
        const error = thrownBy(clone);
        expect(error).toBeInstanceOf(DOMException);
        expect({ name: error.name, code: error.code, message: error.message }).toEqual({
          name: "DataCloneError",
          code: 25,
          message: needsTransfer,
        });
      }
    } finally {
      port1.close();
      port2.close();
      channel.close();
    }
  });
});

// V8 throws an Error for bytes that it cannot deserialize, where structured clone throws a TypeError:
// https://github.com/nodejs/node/blob/v26.3.0/deps/v8/src/objects/value-serializer.cc#L1631-L1633
describe("v8.deserialize of bytes that are no serialized value", () => {
  // The text is the serializer's. V8's text is "Unable to deserialize cloned data."
  const unable = "Unable to deserialize data.";
  const withoutLastBytes = (bytes: Buffer) => bytes.subarray(0, bytes.length - 3);

  test.each([
    ["bytes that stop early", () => withoutLastBytes(v8.serialize({ a: 1, b: "two" }))],
    ["bytes with a Buffer inside that stop early", () => withoutLastBytes(v8.serialize({ buffer: Buffer.from("x") }))],
    ["bytes of nothing", () => Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])],
    ["no bytes", () => Buffer.alloc(0)],
  ])("%s throw an Error", (_name, make) => {
    const bytes = make();
    const copy = new Uint8Array(bytes);
    for (const input of [bytes, copy, new DataView(copy.buffer), copy.buffer]) {
      expectPlainError(
        thrownBy(() => v8.deserialize(input as Uint8Array)),
        unable,
      );
    }
  });

  test("what is no buffer throws node's ERR_INVALID_ARG_TYPE", () => {
    for (const input of ["text", undefined, null, 1, {}, []]) {
      const error = thrownBy(() => v8.deserialize(input as any));
      expect(error).toBeInstanceOf(TypeError);
      expect({ code: error.code, message: error.message }).toEqual({
        code: "ERR_INVALID_ARG_TYPE",
        message: "buffer must be a TypedArray or a DataView",
      });
    }
  });

  test("an input whose ArrayBuffer is detached throws an Error", () => {
    for (const make of [
      (buffer: ArrayBuffer) => new Uint8Array(buffer),
      (buffer: ArrayBuffer) => Buffer.from(buffer),
      (buffer: ArrayBuffer) => new DataView(buffer),
      (buffer: ArrayBuffer) => buffer,
    ]) {
      const buffer = new ArrayBuffer(16);
      const input = make(buffer);
      structuredClone(buffer, { transfer: [buffer] });
      expectPlainError(
        thrownBy(() => v8.deserialize(input as Uint8Array)),
        unable,
      );
    }
  });

  test("bytes that nest too deep throw a RangeError", () => {
    const prefix = new Uint8Array(jscSerialize(undefined));
    const header = prefix.subarray(0, prefix.length - 1);
    // An array of one element, at index 0. The deserializer stops at 40,000 levels.
    const open = new Uint8Array([1, 1, 0, 0, 0, 0, 0, 0, 0]);
    const close = new Uint8Array([255, 255, 255, 255]);
    const depth = 41_000;
    const payload = new Uint8Array(header.length + open.length * depth + 1 + close.length * depth);
    payload.set(header, 0);
    let offset = header.length;
    for (let i = 0; i < depth; i++, offset += open.length) payload.set(open, offset);
    payload[offset++] = prefix[prefix.length - 1];
    for (let i = 0; i < depth; i++, offset += close.length) payload.set(close, offset);
    expect(() => v8.deserialize(payload)).toThrow(RangeError);
  });

  test("structured clone's own entry still throws a TypeError", () => {
    const error = thrownBy(() => jscDeserialize(withoutLastBytes(v8.serialize({ a: 1, b: "two" }))));
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe("Unable to deserialize data.");
  });
});
