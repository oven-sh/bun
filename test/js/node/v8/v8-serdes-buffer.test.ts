import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
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
