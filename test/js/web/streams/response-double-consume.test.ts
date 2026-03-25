import { expect, test } from "bun:test";

test("second .bytes() on async iterable Response rejects", async () => {
  async function* gen() {
    yield new Uint8Array([1, 2, 3]);
  }
  const r = new Response({ [Symbol.asyncIterator]: () => gen() });
  const first = await r.bytes();
  expect(first).toBeInstanceOf(Uint8Array);
  expect(first.length).toBe(3);
  expect(r.bodyUsed).toBe(true);
  await expect(r.bytes()).rejects.toThrow();
});

test("second .text() on async iterable Response rejects", async () => {
  async function* gen() {
    yield new Uint8Array([72, 105]);
  }
  const r = new Response({ [Symbol.asyncIterator]: () => gen() });
  const first = await r.text();
  expect(first).toBe("Hi");
  expect(r.bodyUsed).toBe(true);
  await expect(r.text()).rejects.toThrow();
});

test("second .arrayBuffer() on async iterable Response rejects", async () => {
  async function* gen() {
    yield new Uint8Array([1, 2, 3]);
  }
  const r = new Response({ [Symbol.asyncIterator]: () => gen() });
  const first = await r.arrayBuffer();
  expect(first).toBeInstanceOf(ArrayBuffer);
  expect(first.byteLength).toBe(3);
  expect(r.bodyUsed).toBe(true);
  await expect(r.arrayBuffer()).rejects.toThrow();
});
