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
  let threw = false;
  try {
    await r.bytes();
  } catch (e: any) {
    threw = true;
    expect(e.code).toBe("ERR_BODY_ALREADY_USED");
  }
  expect(threw).toBe(true);
});

test("second .text() on async iterable Response rejects", async () => {
  async function* gen() {
    yield new Uint8Array([72, 105]);
  }
  const r = new Response({ [Symbol.asyncIterator]: () => gen() });
  const first = await r.text();
  expect(first).toBe("Hi");
  expect(r.bodyUsed).toBe(true);
  let threw = false;
  try {
    await r.text();
  } catch (e: any) {
    threw = true;
    expect(e.code).toBe("ERR_BODY_ALREADY_USED");
  }
  expect(threw).toBe(true);
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
  let threw = false;
  try {
    await r.arrayBuffer();
  } catch (e: any) {
    threw = true;
    expect(e.code).toBe("ERR_BODY_ALREADY_USED");
  }
  expect(threw).toBe(true);
});
