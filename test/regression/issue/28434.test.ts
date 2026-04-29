import { expect, test } from "bun:test";

test("structuredClone with transferable ReadableStream", () => {
  const original = new ReadableStream();
  const transfer = structuredClone(original, { transfer: [original] });
  expect(transfer).toBeInstanceOf(ReadableStream);
  expect(Object.getPrototypeOf(transfer)).toBe(ReadableStream.prototype);
  expect(original.locked).toBe(true);
});

test("structuredClone with transferable WritableStream", () => {
  const original = new WritableStream();
  const transfer = structuredClone(original, { transfer: [original] });
  expect(transfer).toBeInstanceOf(WritableStream);
  expect(Object.getPrototypeOf(transfer)).toBe(WritableStream.prototype);
});

test("structuredClone with transferable TransformStream", () => {
  const original = new TransformStream();
  const transfer = structuredClone(original, { transfer: [original] });
  expect(transfer).toBeInstanceOf(TransformStream);
  expect(Object.getPrototypeOf(transfer)).toBe(TransformStream.prototype);
});

test("structuredClone ReadableStream with content transfers successfully", async () => {
  const original = new ReadableStream({
    start(controller) {
      controller.enqueue("hello");
      controller.close();
    },
  });
  const transfer = structuredClone(original, { transfer: [original] });
  expect(transfer).toBeInstanceOf(ReadableStream);
  expect(transfer).not.toBe(original);

  const reader = transfer.getReader();
  const first = await reader.read();
  expect(first.done).toBe(false);
  expect(first.value).toBe("hello");

  const second = await reader.read();
  expect(second.done).toBe(true);
});

test("structuredClone throws on locked ReadableStream", () => {
  const original = new ReadableStream();
  original.getReader(); // lock the stream
  expect(() => {
    structuredClone(original, { transfer: [original] });
  }).toThrow(/locked/i);
});

test("structuredClone throws on locked WritableStream", () => {
  const original = new WritableStream();
  original.getWriter(); // lock the stream
  expect(() => {
    structuredClone(original, { transfer: [original] });
  }).toThrow(/locked/i);
});

test("structuredClone throws on locked TransformStream readable side", () => {
  const original = new TransformStream();
  original.readable.getReader(); // lock readable side
  expect(() => {
    structuredClone(original, { transfer: [original] });
  }).toThrow(/locked/i);
});

test("structuredClone throws on locked TransformStream writable side", () => {
  const original = new TransformStream();
  original.writable.getWriter(); // lock writable side
  expect(() => {
    structuredClone(original, { transfer: [original] });
  }).toThrow(/locked/i);
});

test("structuredClone ReadableStream without transfer throws DataCloneError", () => {
  expect(() => structuredClone(new ReadableStream())).toThrow("The object can not be cloned.");
});

test("structuredClone WritableStream without transfer throws DataCloneError", () => {
  expect(() => structuredClone(new WritableStream())).toThrow("The object can not be cloned.");
});

test("structuredClone TransformStream without transfer throws DataCloneError", () => {
  expect(() => structuredClone(new TransformStream())).toThrow("The object can not be cloned.");
});

test("structuredClone with transferable ReadableStream in object", () => {
  const original = new ReadableStream();
  const result = structuredClone({ stream: original }, { transfer: [original] });
  expect(result.stream).toBeInstanceOf(ReadableStream);
});

test("structuredClone with mixed stream types in transfer list", () => {
  const rs = new ReadableStream();
  const ws = new WritableStream();
  const rs2 = new ReadableStream();
  const result = structuredClone({ a: rs, b: ws, c: rs2 }, { transfer: [rs, ws, rs2] });
  expect(result.a).toBeInstanceOf(ReadableStream);
  expect(result.b).toBeInstanceOf(WritableStream);
  expect(result.c).toBeInstanceOf(ReadableStream);
  expect(result.a).not.toBe(result.c);
});

test("structuredClone with all three stream types together", () => {
  const rs = new ReadableStream();
  const ws = new WritableStream();
  const ts = new TransformStream();
  const result = structuredClone({ readable: rs, writable: ws, transform: ts }, { transfer: [rs, ws, ts] });
  expect(result.readable).toBeInstanceOf(ReadableStream);
  expect(result.writable).toBeInstanceOf(WritableStream);
  expect(result.transform).toBeInstanceOf(TransformStream);
});
