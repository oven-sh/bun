import { expect, test } from "bun:test";

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

test("new Blob with multiple ArrayBuffer parts concatenates correctly (fast path)", async () => {
  const a = new Uint8Array([1, 2, 3]);
  const b = new Uint8Array([4, 5]);
  const c = new DataView(new Uint8Array([6, 7, 8, 9]).buffer);
  const blob = new Blob([a, b, c]);
  expect(blob.size).toBe(9);
  expect(await blob.bytes()).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]));
});

test("new Blob with ArrayBuffer + in-memory Blob parts concatenates correctly (fast path)", async () => {
  const a = new Uint8Array([0xaa, 0xbb]);
  const inner = new Blob([new Uint8Array([0xcc, 0xdd, 0xee])]);
  const b = new Uint8Array([0xff]);
  const blob = new Blob([a, inner, b]);
  expect(blob.size).toBe(6);
  expect(await blob.bytes()).toEqual(new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]));
});

test("new Blob with mixed buffer + string parts concatenates correctly (slow path)", async () => {
  const a = new Uint8Array([0x68, 0x69]); // "hi"
  const blob = new Blob([a, "-", new Uint8Array([0x6f, 0x6b])]); // "ok"
  expect(await blob.text()).toBe("hi-ok");
});

test("new Blob with sparse array falls back to slow path", async () => {
  const arr: any[] = [new Uint8Array([1, 2]), , new Uint8Array([3, 4])];
  const blob = new Blob(arr);
  expect(blob.size).toBe(4);
  expect(await blob.bytes()).toEqual(new Uint8Array([1, 2, 3, 4]));
});

test("new Blob with indexed getter falls back to slow path (no UAF)", async () => {
  const buf = new Uint8Array(4096).fill(0x41);
  const buf2 = new Uint8Array(4).fill(0x42);
  const arr = [buf, buf2];
  Object.defineProperty(arr, 1, {
    get() {
      new Uint8Array(buf.buffer.transfer()).fill(0x43);
      return buf2;
    },
  });
  const blob = new Blob(arr);
  const bytes = await blob.bytes();
  expect(bytes.length).toBe(4100);
  expect(bytes[0]).toBe(0x41);
  expect(bytes[4095]).toBe(0x41);
  expect(bytes[4096]).toBe(0x42);
});
