import { expect, test } from "bun:test";
import { tempDir } from "harness";

// Issue #16402: Blob.stream(), Response.body, and File.stream() should return
// byte streams (ReadableByteStreamController) per the W3C File API and Fetch
// specs, enabling BYOB reader support.

test("Blob.stream() supports BYOB reader", async () => {
  const blob = new Blob(["hello world"]);
  const stream = blob.stream();
  const reader = stream.getReader({ mode: "byob" });

  let buf = new Uint8Array(64);
  const result = await reader.read(buf);
  expect(result.done).toBe(false);
  expect(new TextDecoder().decode(result.value)).toBe("hello world");

  // Read again to get done signal
  buf = new Uint8Array(64);
  const result2 = await reader.read(buf);
  expect(result2.done).toBe(true);
  expect(result2.value!.byteLength).toBe(0);

  reader.releaseLock();
});

test("Blob.stream() still works with default reader", async () => {
  const blob = new Blob(["hello default"]);
  const stream = blob.stream();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const combined = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  expect(new TextDecoder().decode(combined)).toBe("hello default");
});

test("Response.body supports BYOB reader", async () => {
  const response = new Response("hello response");
  const reader = response.body!.getReader({ mode: "byob" });

  let buf = new Uint8Array(64);
  const result = await reader.read(buf);
  expect(result.done).toBe(false);
  expect(new TextDecoder().decode(result.value)).toBe("hello response");

  reader.releaseLock();
});

test("Response.body still works with default reader", async () => {
  const response = new Response("hello response default");
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const combined = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  expect(new TextDecoder().decode(combined)).toBe("hello response default");
});

test("empty Blob.stream() supports BYOB reader", async () => {
  const blob = new Blob([]);
  const stream = blob.stream();
  const reader = stream.getReader({ mode: "byob" });

  const buf = new Uint8Array(64);
  const result = await reader.read(buf);
  expect(result.done).toBe(true);

  reader.releaseLock();
});

test("Bun.file().stream() supports BYOB reader", async () => {
  using dir = tempDir("byob-test", {
    "test.txt": "hello from file",
  });

  const file = Bun.file(`${dir}/test.txt`);
  const stream = file.stream();
  const reader = stream.getReader({ mode: "byob" });

  let buf = new Uint8Array(64);
  const result = await reader.read(buf);
  expect(result.done).toBe(false);
  expect(new TextDecoder().decode(result.value)).toBe("hello from file");

  reader.releaseLock();
});

test("large Blob.stream() with BYOB reader reads all data", async () => {
  const data = new Uint8Array(1024 * 1024); // 1MB
  data.fill(42);
  const blob = new Blob([data]);
  const stream = blob.stream();
  const reader = stream.getReader({ mode: "byob" });

  let total = 0;
  while (true) {
    let buf = new Uint8Array(65536);
    const { done, value } = await reader.read(buf);
    if (done) break;
    total += value.byteLength;
    // Verify the data is correct
    for (let i = 0; i < value.byteLength; i++) {
      if (value[i] !== 42) {
        expect(value[i]).toBe(42); // will fail with helpful message
        return;
      }
    }
  }
  expect(total).toBe(1024 * 1024);
});

test("Blob.stream() BYOB reader works with music-metadata pattern", async () => {
  // This is the pattern used by strtok3/music-metadata that was failing
  const blob = new Blob([new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00])]);
  const stream = blob.stream();

  // First try BYOB reader (the preferred path in strtok3)
  const reader = stream.getReader({ mode: "byob" });
  const buf = new Uint8Array(5);
  const result = await reader.read(buf);

  expect(result.done).toBe(false);
  expect(result.value).toBeInstanceOf(Uint8Array);
  expect(result.value!.byteLength).toBe(5);
  expect(Array.from(result.value!)).toEqual([0x49, 0x44, 0x33, 0x04, 0x00]);
});

test("fetch Response.body supports BYOB reader", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("byob fetch test");
    },
  });

  const response = await fetch(server.url);
  const reader = response.body!.getReader({ mode: "byob" });

  let buf = new Uint8Array(64);
  const result = await reader.read(buf);
  expect(result.done).toBe(false);
  expect(new TextDecoder().decode(result.value)).toBe("byob fetch test");

  reader.releaseLock();
});
