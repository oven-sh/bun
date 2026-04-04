import { readableStreamToArrayBuffer, readableStreamToBlob, readableStreamToBytes, readableStreamToText } from "bun";
import { describe, expect, test } from "bun:test";

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

  test("does not crash when the body's store was already detached", async () => {
    // Consuming the Response drains the underlying blob store
    // out from under the saved ReadableStream reference.
    for (const method of ["text", "bytes", "blob"] as const) {
      const resp = new Response("Hello World");
      const body = resp.body!;
      await resp.arrayBuffer();
      // Should not crash, just return empty content.
      const value = await body[method]();
      if (method === "text") expect(value).toBe("");
      if (method === "bytes") expect((value as Uint8Array).byteLength).toBe(0);
      if (method === "blob") expect((value as Blob).size).toBe(0);
    }
  });
});
