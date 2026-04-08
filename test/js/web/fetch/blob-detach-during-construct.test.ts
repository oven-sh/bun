import { test, expect } from "bun:test";

test("new Blob copies ArrayBuffer bytes before later parts can detach the buffer", async () => {
  const buf = new Uint8Array(4096).fill(0x41);
  const evil = {
    toString() {
      new Uint8Array(buf.buffer.transfer()).fill(0x42);
      return "";
    },
  };
  const blob = new Blob([buf, evil]);
  const bytes = await blob.bytes();
  expect(bytes.length).toBe(4096);
  expect(bytes[0]).toBe(0x41);
  expect(bytes[bytes.length - 1]).toBe(0x41);
  expect(bytes.every(b => b === 0x41)).toBe(true);
});

test("new Blob does not read freed memory when a part's toString detaches an earlier buffer", async () => {
  const SIZE = 1 << 20;
  const buf = new Uint8Array(SIZE).fill(0x41);
  const evil = {
    toString() {
      buf.buffer.transfer(0);
      Bun.gc(true);
      return "";
    },
  };
  const blob = new Blob([buf, evil]);
  expect(blob.size).toBe(SIZE);
  const bytes = await blob.bytes();
  expect(bytes.length).toBe(SIZE);
  expect(bytes[0]).toBe(0x41);
  expect(bytes[SIZE - 1]).toBe(0x41);
});

test("new Blob copies nested Blob bytes before later parts can free the source", async () => {
  let inner: Blob | null = new Blob([new Uint8Array(4096).fill(0x43)]);
  const arr: any[] = [inner, null];
  arr[1] = {
    toString() {
      arr[0] = null;
      inner = null;
      Bun.gc(true);
      return "";
    },
  };
  const blob = new Blob(arr);
  const bytes = await blob.bytes();
  expect(bytes.length).toBe(4096);
  expect(bytes[0]).toBe(0x43);
});
