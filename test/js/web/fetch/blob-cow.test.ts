import { expect, test } from "bun:test";

test("Blob.arrayBuffer copy-on-write survives blob store being freed", async () => {
  // On Linux, large blobs are backed by a memfd. blob.arrayBuffer() creates a
  // MAP_PRIVATE mapping of that memfd; pages that haven't been COW'd yet still
  // read through to the underlying file. Freeing the blob's store must not
  // scribble into the MAP_SHARED mapping (and thus the memfd), or outstanding
  // arrayBuffer()/bytes() results will observe garbage.
  const size = 16 * 1024 * 1024;
  for (let i = 0; i < 3; i++) {
    let arr;
    {
      const src = new Uint8Array(size).fill(42);
      const blob = new Blob([src]);
      arr = await blob.arrayBuffer();
    }
    Bun.gc(true);
    const u8 = new Uint8Array(arr);
    expect(u8[0]).toBe(42);
    expect(u8[u8.length - 1]).toBe(42);
    expect(u8[u8.length >> 1]).toBe(42);
  }
});

test("Blob.bytes copy-on-write survives blob store being freed", async () => {
  const size = 16 * 1024 * 1024;
  let bytes;
  {
    const src = new Uint8Array(size).fill(42);
    const blob = new Blob([src]);
    bytes = await blob.bytes();
  }
  Bun.gc(true);
  expect(bytes[0]).toBe(42);
  expect(bytes[bytes.length - 1]).toBe(42);
});

test("Blob.arrayBuffer copy-on-write is not shared", async () => {
  // 8 MB is the threshold for copy-on-write without --smol.
  const bytes = new Uint8Array((1024 * 1024 * 8 * 1.5) | 0);
  bytes.fill(42);
  bytes[bytes.length - 100] = 43;
  const blob = new Blob([bytes]);
  bytes.fill(8);

  const buf = new Uint8Array(await blob.arrayBuffer());
  expect(buf.length).toBe(blob.size);
  expect(buf[0]).toBe(42);
  expect(buf[buf.length - 1]).toBe(42);

  buf[0] = 0;

  const buf2 = new Uint8Array(await blob.arrayBuffer());
  expect(buf2[0]).toBe(42);
  buf2[0] = 1;
  expect(buf2[buf.length - 1]).toBe(42);

  const buf3 = new Uint8Array(await blob.slice(0, 1).arrayBuffer());
  expect(buf3[0]).toBe(42);
  buf3[0] = 2;
  expect(buf3.length).toBe(1);

  const buf4 = new Uint8Array(await blob.slice(blob.size - 100).arrayBuffer());
  expect(buf4[0]).toBe(43);
  buf4[0] = 3;
  expect(buf4.length).toBe(100);

  expect(buf[0]).toBe(0);
  expect(buf2[0]).toBe(1);
  expect(buf3[0]).toBe(2);
  expect(buf4[0]).toBe(3);
});
