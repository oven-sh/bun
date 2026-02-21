import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/12908
// BYOB reader on native ReadableStreams (req.body, fetch().body, Blob.stream(), Bun.file().stream())
// threw "ReadableStreamBYOBReader needs a ReadableByteStreamController"

test("req.body supports BYOB reader in Bun.serve", async () => {
  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const reader = req.body!.getReader({ mode: "byob" });
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read(new Uint8Array(1024));
        if (done) break;
        chunks.push(value);
      }
      reader.releaseLock();
      const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
      return new Response(`OK:${total}`);
    },
  });

  const body = "hello world";
  const resp = await fetch(`http://localhost:${server.port}/`, {
    method: "POST",
    body,
  });
  expect(resp.status).toBe(200);
  expect(await resp.text()).toBe(`OK:${body.length}`);
});

test("fetch() response body supports BYOB reader", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("hello from server");
    },
  });

  const resp = await fetch(`http://localhost:${server.port}/`);
  const reader = resp.body!.getReader({ mode: "byob" });
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read(new Uint8Array(1024));
    if (done) break;
    chunks.push(value);
  }
  reader.releaseLock();
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  expect(text).toBe("hello from server");
});

test("Blob.stream() supports BYOB reader", async () => {
  const blob = new Blob(["hello blob data"]);
  const stream = blob.stream();
  const reader = stream.getReader({ mode: "byob" });
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read(new Uint8Array(1024));
    if (done) break;
    chunks.push(value);
  }
  reader.releaseLock();
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  expect(text).toBe("hello blob data");
});

test("Bun.file().stream() supports BYOB reader", async () => {
  // Write a temp file
  const path = require("path").join(require("os").tmpdir(), `byob-test-${Date.now()}.txt`);
  const content = "hello file data";
  await Bun.write(path, content);
  try {
    const stream = Bun.file(path).stream();
    const reader = stream.getReader({ mode: "byob" });
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read(new Uint8Array(1024));
      if (done) break;
      chunks.push(value);
    }
    reader.releaseLock();
    const text = new TextDecoder().decode(Buffer.concat(chunks));
    expect(text).toBe(content);
  } finally {
    require("fs").unlinkSync(path);
  }
});

test("default reader still works on native streams after getReader fix", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("default reader test");
    },
  });

  const resp = await fetch(`http://localhost:${server.port}/`);
  const reader = resp.body!.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  reader.releaseLock();
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  expect(text).toBe("default reader test");
});
