import { readableStreamToArrayBuffer, readableStreamToBlob, readableStreamToBytes, readableStreamToText } from "bun";
import { describe, expect, test } from "bun:test";
import { arrayBuffer as consumersArrayBuffer, bytes as consumersBytes } from "node:stream/consumers";

// Fetch's body-read algorithms ("get a byte sequence … create a Uint8Array from
// bytes" / "an ArrayBuffer whose contents are bytes") return fresh buffers. The
// single-chunk fast path used to hand back the producer's own backing store, so
// mutating/transferring the result aliased the producer. Multi-chunk paths have
// always copied; every single-chunk binary shape must too.
describe("single-chunk stream consumers return a fresh buffer", () => {
  const one = <T>(chunk: T) =>
    new ReadableStream<T>({
      start(c) {
        c.enqueue(chunk);
        c.close();
      },
    });

  const detached = () => {
    const buf = new Uint8Array([1, 2, 3]).buffer;
    structuredClone(buf, { transfer: [buf] });
    return buf;
  };
  const detachedChunkError = expect.objectContaining({
    name: "TypeError",
    message: "Cannot read a ReadableStream chunk whose ArrayBuffer has been detached",
  });

  describe.each([
    ["Response.bytes()", (s: ReadableStream) => new Response(s).bytes()],
    ["Request.bytes()", (s: ReadableStream) => new Request("http://x", { method: "POST", body: s }).bytes()],
    ["Bun.readableStreamToBytes", (s: ReadableStream) => readableStreamToBytes(s)],
    ["stream/consumers.bytes", (s: ReadableStream) => consumersBytes(s)],
  ] as const)("%s", (_, consume) => {
    test("Uint8Array chunk", async () => {
      const src = new Uint8Array([1, 2, 3]);
      const out = await consume(one(src));
      expect(out).not.toBe(src);
      expect(out.buffer).not.toBe(src.buffer);
      expect(Object.getPrototypeOf(out)).toBe(Uint8Array.prototype);
      expect([...out]).toEqual([1, 2, 3]);
      out[0] = 42;
      expect(src[0]).toBe(1);
    });

    test("Buffer chunk yields a plain Uint8Array copy", async () => {
      const src = Buffer.from([9, 8, 7]);
      const out = await consume(one(src));
      expect(out).not.toBe(src);
      expect(out.buffer).not.toBe(src.buffer);
      expect(Object.getPrototypeOf(out)).toBe(Uint8Array.prototype);
      expect([...out]).toEqual([9, 8, 7]);
    });

    test("ArrayBuffer chunk", async () => {
      const src = new Uint8Array([4, 5, 6]).buffer;
      const out = await consume(one(src));
      expect(out.buffer).not.toBe(src);
      expect([...out]).toEqual([4, 5, 6]);
      out[0] = 0;
      expect(new Uint8Array(src)[0]).toBe(4);
    });

    test("non-Uint8 view chunk", async () => {
      const src = new Float32Array([1.5]);
      const out = await consume(one(src));
      expect(out.buffer).not.toBe(src.buffer);
      expect(out).toEqual(new Uint8Array(new Float32Array([1.5]).buffer));
    });

    test("subarray over a larger backing store copies only the view", async () => {
      const backing = new Uint8Array(300).fill(0xee);
      const view = backing.subarray(100, 200).fill(0x11);
      const out = await consume(one(view));
      expect(out.byteLength).toBe(100);
      expect(out.buffer.byteLength).toBe(100);
      expect(out.buffer).not.toBe(backing.buffer);
      expect(out.every(x => x === 0x11)).toBe(true);
      out[0] = 0;
      expect(backing[100]).toBe(0x11);
    });

    test("detached chunk rejects", async () => {
      const src = detached();
      await expect(async () => consume(one(src))).toThrow(detachedChunkError);
    });

    test("transferring the result does not detach the producer", async () => {
      const src = new Uint8Array([1, 2, 3]);
      const out = await consume(one(src));
      structuredClone(out.buffer, { transfer: [out.buffer] });
      expect(src.byteLength).toBe(3);
      expect([...src]).toEqual([1, 2, 3]);
    });
  });

  describe.each([
    ["Response.arrayBuffer()", (s: ReadableStream) => new Response(s).arrayBuffer()],
    [
      "Request.arrayBuffer()",
      (s: ReadableStream) => new Request("http://x", { method: "POST", body: s }).arrayBuffer(),
    ],
    ["Bun.readableStreamToArrayBuffer", (s: ReadableStream) => readableStreamToArrayBuffer(s)],
    ["stream/consumers.arrayBuffer", (s: ReadableStream) => consumersArrayBuffer(s)],
  ] as const)("%s", (_, consume) => {
    test("Uint8Array chunk", async () => {
      const src = new Uint8Array([1, 2, 3]);
      const out = await consume(one(src));
      expect(out).toBeInstanceOf(ArrayBuffer);
      expect(out).not.toBe(src.buffer);
      expect([...new Uint8Array(out)]).toEqual([1, 2, 3]);
      new Uint8Array(out)[0] = 42;
      expect(src[0]).toBe(1);
    });

    test("Buffer chunk", async () => {
      const src = Buffer.from([9, 8, 7]);
      const out = await consume(one(src));
      expect(out).toBeInstanceOf(ArrayBuffer);
      expect(out).not.toBe(src.buffer);
      expect([...new Uint8Array(out)]).toEqual([9, 8, 7]);
    });

    test("ArrayBuffer chunk", async () => {
      const src = new Uint8Array([7, 7, 7]).buffer;
      const out = await consume(one(src));
      expect(out).toBeInstanceOf(ArrayBuffer);
      expect(out).not.toBe(src);
      expect([...new Uint8Array(out)]).toEqual([7, 7, 7]);
    });

    test("non-Uint8 view chunk", async () => {
      const src = new Float32Array([1.5]);
      const out = await consume(one(src));
      expect(out).toBeInstanceOf(ArrayBuffer);
      expect(out).not.toBe(src.buffer);
      expect(new Uint8Array(out)).toEqual(new Uint8Array(new Float32Array([1.5]).buffer));
    });

    test("subarray over a larger backing store copies only the view", async () => {
      const backing = new Uint8Array(300).fill(0xee);
      const view = backing.subarray(100, 200).fill(0x11);
      const out = await consume(one(view));
      expect(out).toBeInstanceOf(ArrayBuffer);
      expect(out.byteLength).toBe(100);
      expect(out).not.toBe(backing.buffer);
      expect(new Uint8Array(out).every(x => x === 0x11)).toBe(true);
      new Uint8Array(out)[0] = 0;
      expect(backing[100]).toBe(0x11);
    });

    test("detached chunk rejects", async () => {
      const src = detached();
      await expect(async () => consume(one(src))).toThrow(detachedChunkError);
    });

    test("transferring the result does not detach the producer", async () => {
      const src = new Uint8Array([1, 2, 3]);
      const out = await consume(one(src));
      structuredClone(out, { transfer: [out] });
      expect(src.byteLength).toBe(3);
      expect(src.buffer.byteLength).toBe(3);
    });
  });

  test("async single-chunk stream copies too", async () => {
    const src = new Uint8Array([5, 6, 7]);
    const stream = new ReadableStream({
      async start(c) {
        await Promise.resolve();
        c.enqueue(src);
        c.close();
      },
    });
    const out = await new Response(stream).bytes();
    expect(out).not.toBe(src);
    expect(out.buffer).not.toBe(src.buffer);
    out[0] = 0;
    expect(src[0]).toBe(5);
  });
});

describe("ByteBlobLoader", () => {
  const blobs = [
    ["Empty", new Blob()],
    ["Hello, world!", new Blob(["Hello, world!"], { type: "text/plain" })] as const,
    ["Bytes", new Blob([new Uint8Array([0x00, 0x01, 0x02, 0x03])], { type: "application/octet-stream" })] as const,
    [
      "Mixed",
      new Blob(["Hello, world!", new Uint8Array([0x00, 0x01, 0x02, 0x03])], { type: "multipart/mixed" }),
    ] as const,
  ] as const;

  describe.each([
    ["arrayBuffer", readableStreamToArrayBuffer] as const,
    ["bytes", readableStreamToBytes] as const,
    ["text", readableStreamToText] as const,
    ["blob", readableStreamToBlob] as const,
  ] as const)(`%s`, (name, fn) => {
    describe.each(blobs)(`%s`, (label, blob) => {
      test("works", async () => {
        const stream = blob.stream();
        const result = fn(stream);

        // TODO: figure out why empty is wasting a microtask.
        if (blob.size > 0) {
          // Don't waste microticks on this.
          if (result instanceof Promise) {
            expect(Bun.peek.status(result)).toBe("fulfilled");
          }
        }

        const awaited = await result;
        expect(awaited).toEqual(await new Response(blob)[name]());
      });
    });
  });

  test("json", async () => {
    const blob = new Blob(['"Hello, world!"'], { type: "application/json" });
    const stream = blob.stream();
    const result = stream.json();
    expect(result.then).toBeFunction();
    const awaited = await result;
    expect(awaited).toStrictEqual(await new Response(blob).json());
  });

  test("returns a rejected Promise for invalid JSON", async () => {
    const blob = new Blob(["I AM NOT JSON!"], { type: "application/json" });
    const stream = blob.stream();
    const result = stream.json();
    expect(result.then).toBeFunction();
    expect(async () => await result).toThrow();
  });
});
