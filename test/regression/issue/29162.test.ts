import { describe, expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";

// https://github.com/oven-sh/bun/issues/29162
//
// `fetch().body.getReader({ mode: "byob" })` must return a
// ReadableStreamBYOBReader instead of throwing
// `ReadableStreamBYOBReader needs a ReadableByteStreamController`.
// The native-backed fetch response body was previously created with the
// default controller, so BYOB was unavailable.

describe("issue #29162 — fetch().body BYOB reader", () => {
  test("getReader({ mode: 'byob' }) does not throw on fetch body", async () => {
    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("hello world");
      },
    });

    const res = await fetch(`http://${server.hostname}:${server.port}`);
    const reader = res.body!.getReader({ mode: "byob" });
    expect(reader).toBeDefined();
    reader.releaseLock();
  });

  test("read into a BYOB buffer then EOF on second read", async () => {
    const content = "hello world";
    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(content);
      },
    });

    const res = await fetch(`http://${server.hostname}:${server.port}`);
    const reader = res.body!.getReader({ mode: "byob" });

    const first = await reader.read(new Uint8Array(4096));
    expect(first.done).toBe(false);
    expect(first.value).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(first.value!).toString("utf8")).toBe(content);

    // Reusing the buffer from the first read, as in the bug report.
    const second = await reader.read(new Uint8Array(first.value!.buffer));
    expect(second.done).toBe(true);
    // Per spec, `value` is a zero-length typed array over the user buffer,
    // not undefined.
    expect(second.value).toBeInstanceOf(Uint8Array);
    expect(second.value!.byteLength).toBe(0);
  });

  test("BYOB reader.closed resolves after stream drains", async () => {
    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("abc");
      },
    });

    const res = await fetch(`http://${server.hostname}:${server.port}`);
    const reader = res.body!.getReader({ mode: "byob" });
    const closedPromise = reader.closed;

    let result: ReadableStreamReadResult<Uint8Array>;
    const collected: number[] = [];
    do {
      result = await reader.read(new Uint8Array(8));
      if (result.value) collected.push(...result.value);
    } while (!result.done);

    expect(Buffer.from(collected).toString("utf8")).toBe("abc");
    await closedPromise;
  });

  test("BYOB read drains a larger body across many reads", async () => {
    const content = Buffer.alloc(512 * 1024, "A").toString(); // 512KB
    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(content);
      },
    });

    const res = await fetch(`http://${server.hostname}:${server.port}`);
    const reader = res.body!.getReader({ mode: "byob" });

    let totalBytes = 0;
    let reads = 0;
    while (true) {
      const { done, value } = await reader.read(new Uint8Array(4096));
      reads++;
      if (done) break;
      totalBytes += value!.byteLength;
    }

    expect(totalBytes).toBe(content.length);
    expect(reads).toBeGreaterThan(1);
  });

  test("BYOB works on Bun.file() streams", async () => {
    const dir = tempDirWithFiles("issue-29162", {
      "payload.txt": "hello from Bun.file",
    });

    const file = Bun.file(`${dir}/payload.txt`);
    const reader = file.stream().getReader({ mode: "byob" });

    const first = await reader.read(new Uint8Array(1024));
    expect(first.done).toBe(false);
    expect(Buffer.from(first.value!).toString("utf8")).toBe("hello from Bun.file");

    const second = await reader.read(new Uint8Array(1024));
    expect(second.done).toBe(true);
  });

  test("BYOB works on new Response(body).body", async () => {
    const res = new Response("hello from Response");
    const reader = res.body!.getReader({ mode: "byob" });

    const first = await reader.read(new Uint8Array(1024));
    expect(first.done).toBe(false);
    expect(Buffer.from(first.value!).toString("utf8")).toBe("hello from Response");

    const second = await reader.read(new Uint8Array(1024));
    expect(second.done).toBe(true);
  });

  // https://github.com/oven-sh/bun/issues/6643 — Blob.stream() BYOB
  test("BYOB works on Blob.stream()", async () => {
    const blob = new Blob(["hello from blob"]);
    const reader = blob.stream().getReader({ mode: "byob" });

    const first = await reader.read(new Uint8Array(1024));
    expect(first.done).toBe(false);
    expect(Buffer.from(first.value!).toString("utf8")).toBe("hello from blob");

    const second = await reader.read(new Uint8Array(1024));
    expect(second.done).toBe(true);
  });

  // https://github.com/oven-sh/bun/issues/12908 — req.body BYOB on Bun.serve
  test("BYOB works on request.body inside Bun.serve", async () => {
    const clientBody = "client payload for byob";
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const reader = req.body!.getReader({ mode: "byob" });
        const parts: Buffer[] = [];
        while (true) {
          const { done, value } = await reader.read(new Uint8Array(256));
          if (done) break;
          parts.push(Buffer.from(value!));
        }
        return new Response("echo:" + Buffer.concat(parts).toString("utf8"));
      },
    });

    const res = await fetch(`http://${server.hostname}:${server.port}`, {
      method: "POST",
      body: clientBody,
    });
    expect(await res.text()).toBe("echo:" + clientBody);
  });

  test("default reader still works on fetch body (regression guard)", async () => {
    const content = "default reader still works";
    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(content);
      },
    });

    const res = await fetch(`http://${server.hostname}:${server.port}`);
    const reader = res.body!.getReader();

    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value!);
    }
    expect(Buffer.concat(chunks).toString("utf8")).toBe(content);
  });

  test("BYOB on a non-bytes user stream still throws", () => {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue("hello");
        c.close();
      },
    });
    expect(() => stream.getReader({ mode: "byob" })).toThrow(
      "ReadableStreamBYOBReader needs a ReadableByteStreamController",
    );
  });

  test("BYOB on a user-constructed bytes stream still works (regression guard)", async () => {
    const stream = new ReadableStream({
      type: "bytes",
      start(c) {
        c.enqueue(new Uint8Array([1, 2, 3, 4]));
        c.close();
      },
    });

    const reader = stream.getReader({ mode: "byob" });
    const first = await reader.read(new Uint8Array(8));
    expect(first.done).toBe(false);
    expect(Array.from(first.value!)).toEqual([1, 2, 3, 4]);

    const second = await reader.read(new Uint8Array(8));
    expect(second.done).toBe(true);
  });
});
