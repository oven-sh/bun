import { serialize as jscSerialize } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { types } from "node:util";
import v8 from "node:v8";

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
        globalThis.Uint8Array = function Poisoned() { throw new Error("tampered ctor"); };
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

// node's DefaultSerializer throws an Error for a value that cannot be cloned, where
// structured clone throws a DataCloneError DOMException:
// https://github.com/nodejs/node/blob/v26.3.0/lib/v8.js#L379
describe("v8.serialize of a value that cannot be cloned", () => {
  const needsTransfer = "Object that needs transfer was found in message but not listed in transferList";

  function thrownBy(fn: () => unknown): any {
    try {
      fn();
    } catch (error) {
      return error;
    }
    throw new Error("expected a throw");
  }

  // node names the value: "#<Object> could not be cloned."
  function expectPlainError(error: any, message: string | RegExp = /could not be cloned\.$/) {
    expect(Object.getPrototypeOf(error)).toBe(Error.prototype);
    expect({
      name: error.name,
      code: error.code,
      isError: Error.isError(error),
      isNativeError: types.isNativeError(error),
    }).toEqual({ name: "Error", code: undefined, isError: true, isNativeError: true });
    expect(error.message).toMatch(message);
  }

  function detachedArrayBuffer() {
    const buffer = new ArrayBuffer(8);
    structuredClone(buffer, { transfer: [buffer] });
    return buffer;
  }

  test.each([
    ["a Proxy", () => new Proxy({}, {})],
    ["a function", () => () => {}],
    ["a symbol", () => Symbol("s")],
    ["a nested function", () => ({ list: [function named() {}] })],
    ["a Map that holds a function", () => new Map([["key", () => {}]])],
    ["a detached ArrayBuffer", detachedArrayBuffer],
  ])("%s throws an Error", (_name, make) => {
    expectPlainError(thrownBy(() => v8.serialize(make())));
    // A Buffer in the value takes the envelope path.
    expectPlainError(thrownBy(() => v8.serialize({ value: make(), buffer: Buffer.from("x") })));
  });

  test("a MessagePort throws an Error", () => {
    const { port1, port2 } = new MessageChannel();
    try {
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

  test(
    "a value that nests too deep throws a RangeError",
    () => {
      const root: { next?: object } = {};
      for (let i = 0, object = root; i < 50_000; i++) object = object.next = {};
      expect(() => v8.serialize(root)).toThrow(RangeError);
    },
    // The walk of 40,000 levels takes about two seconds in a debug build.
    isDebug || isASAN ? 30_000 : undefined,
  );

  test("a CryptoKey that is not extractable throws an Error", async () => {
    const secret = new TextEncoder().encode("THIS-IS-SECRET-KEY-MATERIAL-32B!");
    const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    expectPlainError(thrownBy(() => v8.serialize(key)));
    expectPlainError(thrownBy(() => v8.serialize({ key, buffer: Buffer.from("x") })));
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
