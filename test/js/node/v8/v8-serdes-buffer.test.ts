import { describe, expect, test } from "bun:test";
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
});
