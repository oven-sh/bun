import { describe, expect, test } from "bun:test";
import v8 from "node:v8";

const roundtrip = (value: any) => v8.deserialize(v8.serialize(value));

describe("v8.serialize / v8.deserialize", () => {
  test("a Buffer round-trips as a Buffer", () => {
    const out = roundtrip(Buffer.from("hello Bun serialize"));

    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.constructor).toBe(Buffer);
    expect(out.toString()).toBe("hello Bun serialize");
    expect(out.toString("hex")).toBe(Buffer.from("hello Bun serialize").toString("hex"));
  });

  test("an empty Buffer round-trips as a Buffer", () => {
    const out = roundtrip(Buffer.alloc(0));

    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.length).toBe(0);
  });

  test("Buffers nested in objects, arrays, Maps and Sets round-trip as Buffers", () => {
    const out = roundtrip({
      direct: Buffer.from("a"),
      list: [Buffer.from("b")],
      map: new Map([["key", Buffer.from("c")]]),
      set: new Set([Buffer.from("d")]),
    });

    expect(Buffer.isBuffer(out.direct)).toBe(true);
    expect(Buffer.isBuffer(out.list[0])).toBe(true);
    expect(Buffer.isBuffer(out.map.get("key"))).toBe(true);
    expect(Buffer.isBuffer([...out.set][0])).toBe(true);
    expect(out.direct.toString()).toBe("a");
    expect(out.list[0].toString()).toBe("b");
    expect(out.map.get("key").toString()).toBe("c");
    expect([...out.set][0].toString()).toBe("d");
  });

  test("a Buffer view into a larger ArrayBuffer keeps its contents and length", () => {
    const backing = Buffer.alloc(10, 1);
    backing[2] = 9;
    const out = roundtrip(backing.subarray(2, 6));

    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.length).toBe(4);
    expect([...out]).toEqual([9, 1, 1, 1]);
  });

  test("the same Buffer referenced twice deserializes to one Buffer", () => {
    const buf = Buffer.from("shared");
    const out = roundtrip({ first: buf, second: buf });

    expect(out.first).toBe(out.second);
    expect(Buffer.isBuffer(out.first)).toBe(true);
  });

  test("a plain Uint8Array stays a Uint8Array", () => {
    const out = roundtrip(new Uint8Array([1, 2, 3]));

    expect(Buffer.isBuffer(out)).toBe(false);
    expect(out.constructor).toBe(Uint8Array);
    expect([...out]).toEqual([1, 2, 3]);
  });

  test("a Buffer subclass degrades to Uint8Array, matching Node", () => {
    class MyBuffer extends Buffer {}
    const out = roundtrip(Object.setPrototypeOf(Buffer.from("abc"), MyBuffer.prototype));

    expect(Buffer.isBuffer(out)).toBe(false);
    expect(out.constructor).toBe(Uint8Array);
    expect([...out]).toEqual([97, 98, 99]);
  });

  test("a Buffer over a resizable ArrayBuffer round-trips as a length-tracking Buffer", () => {
    const out = roundtrip(Buffer.from(new ArrayBuffer(8, { maxByteLength: 16 })));

    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.buffer.resizable).toBe(true);
    expect(out.length).toBe(8);

    out.buffer.resize(16);
    expect(out.length).toBe(16);
  });

  test("a Buffer over a growable SharedArrayBuffer round-trips as a Buffer", () => {
    const out = roundtrip(Buffer.from(new SharedArrayBuffer(8, { maxByteLength: 16 })));

    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.length).toBe(8);
  });

  test.each([
    ["Int8Array", Int8Array],
    ["Uint8ClampedArray", Uint8ClampedArray],
    ["Int16Array", Int16Array],
    ["Uint16Array", Uint16Array],
    ["Int32Array", Int32Array],
    ["Uint32Array", Uint32Array],
    ["Float32Array", Float32Array],
    ["Float64Array", Float64Array],
    ["BigInt64Array", BigInt64Array],
    ["BigUint64Array", BigUint64Array],
  ])("%s is unaffected", (_name, Ctor: any) => {
    const out = roundtrip(new Ctor(4));

    expect(out.constructor).toBe(Ctor);
    expect(out.length).toBe(4);
  });

  test("DataView and ArrayBuffer are unaffected", () => {
    expect(roundtrip(new DataView(new ArrayBuffer(4))).constructor).toBe(DataView);
    expect(roundtrip(new ArrayBuffer(4)).constructor).toBe(ArrayBuffer);
  });

  test("structuredClone still yields a Uint8Array for a Buffer", () => {
    const out = structuredClone(Buffer.from("hello"));

    expect(Buffer.isBuffer(out)).toBe(false);
    expect(out.constructor).toBe(Uint8Array);
  });
});
