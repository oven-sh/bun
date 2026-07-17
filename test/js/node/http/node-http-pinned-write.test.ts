import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";

// Large enough to overflow both the 16KB cork buffer and the kernel send
// buffer, so the write reports backpressure and the tail is held.
const CHUNK_SIZE = 4 * 1024 * 1024;

function makePayload(size: number): Buffer {
  const buf = Buffer.allocUnsafe(size);
  for (let i = 0; i < size; i++) buf[i] = i & 0xff;
  return buf;
}

describe("node:http large Buffer writes are sent zero-copy", () => {
  test("the buffer backing store is pinned while the write is pending, then released on drain", async () => {
    const payload = makePayload(CHUNK_SIZE);

    let detachedWhilePending: boolean | undefined;
    let detachedAfterDrain: boolean | undefined;
    let sawBackpressure = false;

    await using server = http.createServer(async (req, res) => {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });

      while (res.write(payload)) {
        // Loop until the kernel buffer fills and write() returns false.
      }
      sawBackpressure = true;

      // While the tail is in-flight, the underlying ArrayBuffer is pinned so a
      // transfer() copies instead of detaching. Without the pin the server
      // would serve garbage for the bytes still to be written.
      const copy = payload.buffer.transfer();
      detachedWhilePending = payload.buffer.detached;
      expect(copy.byteLength).toBe(payload.buffer.byteLength);

      await once(res, "drain");

      // After the tail has flushed, the pin is released and transfer() detaches.
      payload.buffer.transfer();
      detachedAfterDrain = payload.buffer.detached;

      res.end();
    });
    await once(server.listen(0), "listening");
    const port = (server.address() as AddressInfo).port;

    const response = await fetch(`http://localhost:${port}/`);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        // Every byte of the response is the 0..255 cycle; verify it arrived
        // unmolested across chunk-frame boundaries.
        const off = total % 256;
        let ok = true;
        for (let i = 0; i < value.byteLength; i++) {
          if (value[i] !== ((off + i) & 0xff)) {
            ok = false;
            break;
          }
        }
        expect(ok).toBe(true);
        total += value.byteLength;
      }
      if (done) break;
    }

    expect(sawBackpressure).toBe(true);
    expect(total % CHUNK_SIZE).toBe(0);
    expect(total).toBeGreaterThanOrEqual(CHUNK_SIZE);
    expect(detachedWhilePending).toBe(false);
    expect(detachedAfterDrain).toBe(true);
  });

  test("Content-Length (non-chunked) path delivers the exact bytes", async () => {
    const payload = makePayload(CHUNK_SIZE);
    const expectedHash = createHash("sha1").update(payload).digest("hex");

    await using server = http.createServer(async (req, res) => {
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(CHUNK_SIZE * 2),
      });
      if (!res.write(payload)) await once(res, "drain");
      if (!res.write(payload)) await once(res, "drain");
      res.end();
    });
    await once(server.listen(0), "listening");
    const port = (server.address() as AddressInfo).port;

    const response = await fetch(`http://localhost:${port}/`);
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.length).toBe(CHUNK_SIZE * 2);
    const h1 = createHash("sha1").update(body.subarray(0, CHUNK_SIZE)).digest("hex");
    const h2 = createHash("sha1").update(body.subarray(CHUNK_SIZE)).digest("hex");
    expect(h1).toBe(expectedHash);
    expect(h2).toBe(expectedHash);
  });

  test("a second write before drain is ordered after the pending tail", async () => {
    const first = makePayload(CHUNK_SIZE);
    const second = Buffer.alloc(1024, 0xee);

    await using server = http.createServer((req, res) => {
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(first.length + second.length),
      });
      res.write(first);
      // Deliberately do NOT wait for drain: the pending tail of `first` must
      // be spilled into backpressure so `second` lands after it.
      res.write(second);
      res.end();
    });
    await once(server.listen(0), "listening");
    const port = (server.address() as AddressInfo).port;

    const response = await fetch(`http://localhost:${port}/`);
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.length).toBe(first.length + second.length);
    expect(Buffer.compare(body.subarray(0, first.length), first)).toBe(0);
    expect(Buffer.compare(body.subarray(first.length), second)).toBe(0);
  });

  test("large string writes (latin1 ascii, utf8 encoding) are held by reference", async () => {
    const payload = Buffer.alloc(CHUNK_SIZE, "a").toString("latin1");

    await using server = http.createServer(async (req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      if (!res.write(payload)) await once(res, "drain");
      if (!res.write(payload)) await once(res, "drain");
      res.end();
    });
    await once(server.listen(0), "listening");
    const port = (server.address() as AddressInfo).port;

    const response = await fetch(`http://localhost:${port}/`);
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.length).toBe(CHUNK_SIZE * 2);
    const h = createHash("sha1").update(body).digest("hex");
    const expected = createHash("sha1")
      .update(Buffer.alloc(CHUNK_SIZE * 2, "a"))
      .digest("hex");
    expect(h).toBe(expected);
  });

  test("large string writes with latin1 encoding deliver the exact bytes", async () => {
    // Bytes 0xc0..0xff are valid latin1 but not ascii; the encode path owns
    // the transcoded slice, so the zero-copy holder keeps that Vec alive.
    const raw = Buffer.alloc(CHUNK_SIZE);
    for (let i = 0; i < CHUNK_SIZE; i++) raw[i] = 0xc0 + (i & 0x3f);
    const payload = raw.toString("latin1");

    await using server = http.createServer(async (req, res) => {
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": String(CHUNK_SIZE) });
      if (!res.write(payload, "latin1")) await once(res, "drain");
      res.end();
    });
    await once(server.listen(0), "listening");
    const port = (server.address() as AddressInfo).port;

    const response = await fetch(`http://localhost:${port}/`);
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.length).toBe(CHUNK_SIZE);
    expect(Buffer.compare(body, raw)).toBe(0);
  });

  test("a second write before drain releases the pin on the first buffer", async () => {
    let detachedAfterSecondWrite: boolean | undefined;
    const total = CHUNK_SIZE + 1024;

    await using server = http.createServer((req, res) => {
      const first = makePayload(CHUNK_SIZE);
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(total),
      });
      res.write(first);
      res.write(Buffer.alloc(1024, 0xee));
      // The second write spilled first's tail into uWS backpressure and
      // released the pin, so transfer() detaches again.
      first.buffer.transfer();
      detachedAfterSecondWrite = first.buffer.detached;
      res.end();
    });
    await once(server.listen(0), "listening");
    const port = (server.address() as AddressInfo).port;

    const body = await fetch(`http://localhost:${port}/`).then(r => r.arrayBuffer());
    expect(body.byteLength).toBe(total);
    expect(detachedAfterSecondWrite).toBe(true);
  });
});
