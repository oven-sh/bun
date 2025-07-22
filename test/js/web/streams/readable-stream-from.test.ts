import { expect, test } from "bun:test";

test("ReadableStream.from", () => {
  expect(typeof ReadableStream.from).toBe("function");
  expect(ReadableStream.from.length).toBe(1);
});

test("ReadableStream.from() with array", async () => {
  const array = [1, 2, 3, 4, 5];
  const stream = ReadableStream.from(array);

  expect(stream).toBeInstanceOf(ReadableStream);

  const reader = stream.getReader();
  const results: number[] = [];

  let done = false;
  while (!done) {
    const { value, done: isDone } = await reader.read();
    done = isDone;
    if (!done) {
      results.push(value);
    }
  }

  expect(results).toEqual([1, 2, 3, 4, 5]);
});

test("ReadableStream.from() with empty array", async () => {
  const array: number[] = [];
  const stream = ReadableStream.from(array);

  const reader = stream.getReader();
  const { value, done } = await reader.read();

  expect(done).toBe(true);
  expect(value).toBeUndefined();
});

test("ReadableStream.from() with string (iterable)", async () => {
  const str = "hello";
  const stream = ReadableStream.from(str);

  const reader = stream.getReader();
  const results: string[] = [];

  let done = false;
  while (!done) {
    const { value, done: isDone } = await reader.read();
    done = isDone;
    if (!done) {
      results.push(value);
    }
  }

  expect(results).toEqual(["h", "e", "l", "l", "o"]);
});

test("ReadableStream.from() with Set", async () => {
  const set = new Set([1, 2, 3]);
  const stream = ReadableStream.from(set);

  const reader = stream.getReader();
  const results: number[] = [];

  let done = false;
  while (!done) {
    const { value, done: isDone } = await reader.read();
    done = isDone;
    if (!done) {
      results.push(value);
    }
  }

  expect(results).toEqual([1, 2, 3]);
});

test("ReadableStream.from() with Map", async () => {
  const map = new Map([
    ["a", 1],
    ["b", 2],
    ["c", 3],
  ]);
  const stream = ReadableStream.from(map);

  const reader = stream.getReader();
  const results: [string, number][] = [];

  let done = false;
  while (!done) {
    const { value, done: isDone } = await reader.read();
    done = isDone;
    if (!done) {
      results.push(value);
    }
  }

  expect(results).toEqual([
    ["a", 1],
    ["b", 2],
    ["c", 3],
  ]);
});

test("ReadableStream.from() with custom iterable", async () => {
  const customIterable = {
    *[Symbol.iterator]() {
      yield 1;
      yield 2;
      yield 3;
    },
  };

  const stream = ReadableStream.from(customIterable);

  const reader = stream.getReader();
  const results: number[] = [];

  let done = false;
  while (!done) {
    const { value, done: isDone } = await reader.read();
    done = isDone;
    if (!done) {
      results.push(value);
    }
  }

  expect(results).toEqual([1, 2, 3]);
});

test("ReadableStream.from() with async iterable", async () => {
  const asyncIterable = {
    async *[Symbol.asyncIterator]() {
      yield 1;
      yield 2;
      yield 3;
    },
  };

  const stream = ReadableStream.from(asyncIterable);

  const reader = stream.getReader();
  const results: number[] = [];

  let done = false;
  while (!done) {
    const { value, done: isDone } = await reader.read();
    done = isDone;
    if (!done) {
      results.push(value);
    }
  }

  expect(results).toEqual([1, 2, 3]);
});

test("ReadableStream.from() with existing ReadableStream", async () => {
  const originalStream = new ReadableStream({
    start(controller) {
      controller.enqueue(1);
      controller.enqueue(2);
      controller.enqueue(3);
      controller.close();
    },
  });

  const stream = ReadableStream.from(originalStream);

  // Should return the same stream
  expect(stream).toBe(originalStream);
});

test("ReadableStream.from() with null should throw", () => {
  expect(() => ReadableStream.from(null)).toThrow("ReadableStream.from() takes a non-null value");
});

test("ReadableStream.from() with undefined should throw", () => {
  expect(() => ReadableStream.from(undefined)).toThrow("ReadableStream.from() takes a non-null value");
});

test("ReadableStream.from() with non-iterable should throw", () => {
  const nonIterable = {};
  expect(() => ReadableStream.from(nonIterable)).toThrow(
    "ReadableStream.from() argument must be an iterable or async iterable",
  );
});

test("ReadableStream.from() with invalid iterator method should throw", () => {
  const invalidIterable = {
    [Symbol.iterator]: "not a function",
  };

  expect(() => ReadableStream.from(invalidIterable)).toThrow(
    "ReadableStream.from() argument's @@iterator method must be a function",
  );
});

test("ReadableStream.from() with invalid async iterator method should throw", () => {
  const invalidAsyncIterable = {
    [Symbol.asyncIterator]: "not a function",
  };

  expect(() => ReadableStream.from(invalidAsyncIterable)).toThrow(
    "ReadableStream.from() argument's @@asyncIterator method must be a function",
  );
});

test("ReadableStream.from() handles iterator that throws", async () => {
  const throwingIterable = {
    *[Symbol.iterator]() {
      yield 1;
      throw new Error("Iterator error");
    },
  };

  const stream = ReadableStream.from(throwingIterable);
  const reader = stream.getReader();

  // Should read first value successfully
  const { value } = await reader.read();
  expect(value).toBe(1);

  // The error should be reflected in the stream's errored state
  // Since the error happens synchronously during iteration, the stream becomes errored
  await expect(reader.read()).rejects.toThrow("Iterator error");
});

test("ReadableStream.from() handles async iterator that throws", async () => {
  const throwingAsyncIterable = {
    async *[Symbol.asyncIterator]() {
      yield 1;
      throw new Error("Async iterator error");
    },
  };

  const stream = ReadableStream.from(throwingAsyncIterable);
  const reader = stream.getReader();

  // Should read first value successfully
  const { value } = await reader.read();
  expect(value).toBe(1);

  // Should handle error from async iterator
  await expect(reader.read()).rejects.toThrow("Async iterator error");
});

test("ReadableStream.from() works with Array.from() like usage", async () => {
  // Test that it works similar to how Array.from() works
  const stream1 = ReadableStream.from("abc");
  const stream2 = ReadableStream.from([1, 2, 3]);
  const stream3 = ReadableStream.from(new Set(["x", "y", "z"]));

  const result1 = await new Response(stream1).text();
  const result2 = await streamToArray(stream2);
  const result3 = await streamToArray(stream3);

  // For string, each character should be a separate chunk
  expect(result1).toBe("abc");
  expect(result2).toEqual([1, 2, 3]);
  expect(result3).toEqual(["x", "y", "z"]);
});

// Helper function to convert stream to array
async function streamToArray(stream: ReadableStream) {
  const reader = stream.getReader();
  const results: any[] = [];

  let done = false;
  while (!done) {
    const { value, done: isDone } = await reader.read();
    done = isDone;
    if (!done) {
      results.push(value);
    }
  }

  return results;
}

test("ReadableStream.from() as static method", () => {
  // Test that it's actually a static method on the constructor
  expect(ReadableStream.hasOwnProperty("from")).toBe(true);
  expect(ReadableStream.from).toBe(ReadableStream.from);
  expect(typeof ReadableStream.from).toBe("function");
});

test("ReadableStream.from() integration with Response", async () => {
  // Test integration with other Web APIs that consume ReadableStream
  const stream = ReadableStream.from(["hello", " ", "world"]);
  const response = new Response(stream);
  const text = await response.text();

  expect(text).toBe("hello world");
});
