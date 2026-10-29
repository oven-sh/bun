import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "node:path";
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

// Node's v8.serialize() returns a Buffer that owns a plain ArrayBuffer. A view
// on a SharedArrayBuffer is refused by WebCrypto, cannot be transferred, and
// is shared where a clone is expected.
describe("v8.serialize() returns a Buffer that owns a plain ArrayBuffer", () => {
  test.each([
    ["an object", { a: 1 }],
    ["a string", "text"],
    ["a number", 1],
    ["an array", [1, 2, 3]],
    ["undefined", undefined],
    ["a value with a Buffer inside", { b: Buffer.from("hi") }],
  ])("for %s", (_name, value) => {
    const bytes = v8.serialize(value);
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes.buffer).toBeInstanceOf(ArrayBuffer);
    expect({ byteOffset: bytes.byteOffset, byteLength: bytes.byteLength }).toEqual({
      byteOffset: 0,
      byteLength: bytes.buffer.byteLength,
    });
    expect(v8.serialize(value).buffer).not.toBe(bytes.buffer);
    expect(v8.deserialize(bytes)).toEqual(value);
  });

  describe.each([
    ["without a Buffer inside", { a: 1 }],
    ["with a Buffer inside", { a: 1, b: Buffer.from("hi") }],
  ])("of a value %s", (_name, value) => {
    test("WebCrypto accepts it", async () => {
      const digest = await crypto.subtle.digest("SHA-256", v8.serialize(value));
      expect(digest.byteLength).toBe(32);
    });

    test("structuredClone() copies it", () => {
      const bytes = v8.serialize(value);
      structuredClone(bytes).fill(0);
      expect(v8.deserialize(bytes)).toEqual(value);
    });

    test("its ArrayBuffer can be transferred", () => {
      const bytes = v8.serialize(value);
      const byteLength = bytes.byteLength;
      const moved = structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
      expect(bytes.byteLength).toBe(0);
      expect(moved.byteLength).toBe(byteLength);
      expect(v8.deserialize(Buffer.from(moved))).toEqual(value);
    });
  });

  // The Buffer adopts the bytes that the serializer allocated, and the last
  // owner frees them, here on the Worker's thread. Malloc=1 makes
  // AddressSanitizer see that allocation (bmalloc has no system heap on Windows).
  test("a Worker takes the ArrayBuffer by transfer and frees it", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "v8-serialize-transfer-fixture.js")],
      env: { ...bunEnv, ...(isWindows ? {} : { Malloc: "1" }) },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const rounds = [0, 1, 2, 3, 4, 5, 6, 7];
    expect(JSON.parse(stdout)).toEqual({ detached: true, moved: rounds, shared: rounds });
    expect(exitCode).toBe(0);
  });
});
