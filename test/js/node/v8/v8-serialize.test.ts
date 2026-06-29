import { serialize as jscSerialize } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import v8 from "node:v8";

function roundTrip(value: any): any {
  return v8.deserialize(v8.serialize(value));
}

// Node's v8.serialize()/deserialize() (DefaultSerializer) round-trips Buffer as
// Buffer. structuredClone()/postMessage() deserialize Buffer as a plain
// Uint8Array in Node, so those must keep doing that.
describe("v8.serialize + v8.deserialize", () => {
  test("serialize returns a Buffer", () => {
    const serialized = v8.serialize(123);
    expect(Buffer.isBuffer(serialized)).toBe(true);
    expect(v8.deserialize(serialized)).toBe(123);
  });

  test("Buffer round-trips as Buffer", () => {
    const input = Buffer.from("hello");
    const output = roundTrip(input);
    expect(Buffer.isBuffer(output)).toBe(true);
    expect(output).toBeInstanceOf(Buffer);
    expect(output.constructor.name).toBe("Buffer");
    expect(output.toString("utf8")).toBe("hello");
    expect(output.equals(input)).toBe(true);
    expect(output).not.toBe(input);
  });

  test("empty Buffer round-trips as Buffer", () => {
    const output = roundTrip(Buffer.alloc(0));
    expect(Buffer.isBuffer(output)).toBe(true);
    expect(output.byteLength).toBe(0);
  });

  test("Buffers nested in objects, arrays, Maps and Sets round-trip as Buffer", () => {
    const output = roundTrip({
      b: Buffer.from("hello"),
      arr: [Buffer.from("y")],
      m: new Map([["k", Buffer.from("x")]]),
      s: new Set([Buffer.from("z")]),
    });
    expect(Buffer.isBuffer(output.b)).toBe(true);
    expect(Buffer.isBuffer(output.arr[0])).toBe(true);
    expect(Buffer.isBuffer(output.m.get("k"))).toBe(true);
    expect(Buffer.isBuffer([...output.s][0])).toBe(true);
    expect(output.b.toString("utf8")).toBe("hello");
    expect(output.m.get("k").toString("utf8")).toBe("x");
  });

  test("Buffer with a non-zero byteOffset keeps its contents", () => {
    const output = roundTrip(Buffer.from("abcdefgh").subarray(2, 5));
    expect(Buffer.isBuffer(output)).toBe(true);
    expect(output.byteLength).toBe(3);
    expect(output.toString("utf8")).toBe("cde");
  });

  test("deserialized Buffer supports Buffer methods", () => {
    const output = roundTrip(Buffer.from([0xde, 0xad, 0xbe, 0xef]));
    expect(output.toString("hex")).toBe("deadbeef");
    expect(output.readUInt32BE(0)).toBe(0xdeadbeef);
  });

  test("the same Buffer referenced twice deserializes to the same Buffer", () => {
    const buf = Buffer.from("dup");
    const output = roundTrip({ a: buf, b: buf });
    expect(Buffer.isBuffer(output.a)).toBe(true);
    expect(output.a).toBe(output.b);
  });

  test("Buffer backed by a resizable ArrayBuffer round-trips as Buffer", () => {
    const resizable = new ArrayBuffer(8, { maxByteLength: 16 });
    const input = Buffer.from(resizable, 0, 8);
    input.fill(7);
    const output = roundTrip(input);
    expect(Buffer.isBuffer(output)).toBe(true);
    expect([...output]).toEqual([7, 7, 7, 7, 7, 7, 7, 7]);
  });

  test("Uint8Array and other ArrayBufferViews do not become Buffers", () => {
    const output = roundTrip({
      u8: new Uint8Array([1, 2, 3]),
      u8c: new Uint8ClampedArray([4]),
      i32: new Int32Array([5, 6]),
      dv: new DataView(new ArrayBuffer(4)),
    });
    expect(Buffer.isBuffer(output.u8)).toBe(false);
    expect(output.u8.constructor.name).toBe("Uint8Array");
    expect(output.u8).toEqual(new Uint8Array([1, 2, 3]));
    expect(output.u8c.constructor.name).toBe("Uint8ClampedArray");
    expect(output.i32).toEqual(new Int32Array([5, 6]));
    expect(output.dv.constructor.name).toBe("DataView");
  });

  test("blobs without the Buffer tag still deserialize as Uint8Array", () => {
    // bun:jsc's serialize uses structured clone semantics: no Buffer tag.
    const output = v8.deserialize(jscSerialize({ b: Buffer.from("x") }, { binaryType: "nodebuffer" }));
    expect(Buffer.isBuffer(output.b)).toBe(false);
    expect(output.b.constructor.name).toBe("Uint8Array");
    expect(output.b).toEqual(new Uint8Array([120]));
  });

  test("structuredClone still produces Uint8Array, not Buffer", () => {
    const cloned = structuredClone({ b: Buffer.from("sc") });
    expect(Buffer.isBuffer(cloned.b)).toBe(false);
    expect(cloned.b.constructor.name).toBe("Uint8Array");
    expect(cloned.b).toEqual(new Uint8Array([115, 99]));
  });

  test("MessagePort.postMessage still delivers Uint8Array, not Buffer", async () => {
    const { port1, port2 } = new MessageChannel();
    try {
      const received = new Promise<any>((resolve, reject) => {
        port2.onmessage = event => resolve(event.data);
        port2.onmessageerror = reject;
      });
      port1.postMessage({ b: Buffer.from("pm") });
      const data = await received;
      expect(Buffer.isBuffer(data.b)).toBe(false);
      expect(data.b.constructor.name).toBe("Uint8Array");
      expect(data.b).toEqual(new Uint8Array([112, 109]));
    } finally {
      port1.close();
      port2.close();
    }
  });
});
