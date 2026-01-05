import { describe, expect, test } from "bun:test";

describe("ReadableStream.from", () => {
  describe("basic functionality", () => {
    test("exists as a static method", () => {
      expect(typeof ReadableStream.from).toBe("function");
    });

    test("has correct function length (1 parameter)", () => {
      expect(ReadableStream.from.length).toBe(1);
    });
  });

  describe("sync iterables", () => {
    test("works with arrays", async () => {
      const stream = ReadableStream.from([1, 2, 3]);
      const reader = stream.getReader();

      const values: number[] = [];
      let result;
      while (!(result = await reader.read()).done) {
        values.push(result.value);
      }

      expect(values).toEqual([1, 2, 3]);
    });

    test("works with Set", async () => {
      const stream = ReadableStream.from(new Set(["a", "b", "c"]));
      const reader = stream.getReader();

      const values: string[] = [];
      let result;
      while (!(result = await reader.read()).done) {
        values.push(result.value);
      }

      expect(values).toEqual(["a", "b", "c"]);
    });

    test("works with Map", async () => {
      const stream = ReadableStream.from(
        new Map([
          ["a", 1],
          ["b", 2],
        ]),
      );
      const reader = stream.getReader();

      const values: [string, number][] = [];
      let result;
      while (!(result = await reader.read()).done) {
        values.push(result.value);
      }

      expect(values).toEqual([
        ["a", 1],
        ["b", 2],
      ]);
    });

    test("works with generator functions", async () => {
      function* gen() {
        yield 1;
        yield 2;
        yield 3;
      }

      const stream = ReadableStream.from(gen());
      const reader = stream.getReader();

      const values: number[] = [];
      let result;
      while (!(result = await reader.read()).done) {
        values.push(result.value);
      }

      expect(values).toEqual([1, 2, 3]);
    });

    test("works with string (iterating characters)", async () => {
      const stream = ReadableStream.from("abc");
      const reader = stream.getReader();

      const values: string[] = [];
      let result;
      while (!(result = await reader.read()).done) {
        values.push(result.value);
      }

      expect(values).toEqual(["a", "b", "c"]);
    });

    test("works with empty array", async () => {
      const stream = ReadableStream.from([]);
      const reader = stream.getReader();

      const result = await reader.read();
      expect(result.done).toBe(true);
    });
  });

  describe("async iterables", () => {
    test("works with async generators", async () => {
      async function* asyncGen() {
        yield "a";
        yield "b";
        yield "c";
      }

      const stream = ReadableStream.from(asyncGen());
      const reader = stream.getReader();

      const values: string[] = [];
      let result;
      while (!(result = await reader.read()).done) {
        values.push(result.value);
      }

      expect(values).toEqual(["a", "b", "c"]);
    });

    test("works with async generators that yield promises", async () => {
      async function* asyncGen() {
        yield Promise.resolve(1);
        yield Promise.resolve(2);
        yield Promise.resolve(3);
      }

      const stream = ReadableStream.from(asyncGen());
      const reader = stream.getReader();

      const values: number[] = [];
      let result;
      while (!(result = await reader.read()).done) {
        values.push(result.value);
      }

      // Promises should be yielded as-is, not awaited
      expect(values).toEqual([1, 2, 3]);
    });

    test("works with custom async iterable", async () => {
      const customAsyncIterable = {
        [Symbol.asyncIterator]() {
          let i = 0;
          return {
            async next() {
              if (i < 3) {
                return { value: i++, done: false };
              }
              return { done: true };
            },
          };
        },
      };

      const stream = ReadableStream.from(customAsyncIterable);
      const reader = stream.getReader();

      const values: number[] = [];
      let result;
      while (!(result = await reader.read()).done) {
        values.push(result.value);
      }

      expect(values).toEqual([0, 1, 2]);
    });
  });

  describe("ReadableStream passthrough", () => {
    test("returns the same ReadableStream when passed a ReadableStream", async () => {
      const original = new ReadableStream({
        start(controller) {
          controller.enqueue("test");
          controller.close();
        },
      });

      const result = ReadableStream.from(original);
      expect(result).toBe(original);
    });
  });

  describe("error handling", () => {
    test("throws TypeError for non-iterable values", () => {
      expect(() => ReadableStream.from(123 as any)).toThrow(TypeError);
      expect(() => ReadableStream.from(null as any)).toThrow(TypeError);
      expect(() => ReadableStream.from(undefined as any)).toThrow(TypeError);
      expect(() => ReadableStream.from({} as any)).toThrow(TypeError);
    });

    test("throws TypeError when Symbol.asyncIterator is not a function", () => {
      const badAsyncIterable = {
        [Symbol.asyncIterator]: "not a function",
      };

      expect(() => ReadableStream.from(badAsyncIterable as any)).toThrow(TypeError);
    });

    test("throws TypeError when Symbol.iterator is not a function", () => {
      const badIterable = {
        [Symbol.iterator]: "not a function",
      };

      expect(() => ReadableStream.from(badIterable as any)).toThrow(TypeError);
    });

    test("propagates errors from iterator.next()", async () => {
      const errorIterable = {
        [Symbol.iterator]() {
          return {
            next() {
              throw new Error("iterator error");
            },
          };
        },
      };

      const stream = ReadableStream.from(errorIterable);
      const reader = stream.getReader();

      await expect(reader.read()).rejects.toThrow("iterator error");
    });

    test("propagates errors from async iterator.next()", async () => {
      const errorAsyncIterable = {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              throw new Error("async iterator error");
            },
          };
        },
      };

      const stream = ReadableStream.from(errorAsyncIterable);
      const reader = stream.getReader();

      await expect(reader.read()).rejects.toThrow("async iterator error");
    });
  });

  describe("cancellation", () => {
    test("calls iterator.return() on cancel for sync iterables", async () => {
      let returnCalled = false;

      const customIterable = {
        [Symbol.iterator]() {
          let i = 0;
          return {
            next() {
              if (i++ < 10) return { value: i, done: false };
              return { done: true, value: undefined };
            },
            return() {
              returnCalled = true;
              return { done: true, value: undefined };
            },
          };
        },
      };

      const stream = ReadableStream.from(customIterable);
      const reader = stream.getReader();

      await reader.read();
      await reader.cancel();

      expect(returnCalled).toBe(true);
    });

    test("calls iterator.return() on cancel for async iterables", async () => {
      let returnCalled = false;

      const customAsyncIterable = {
        [Symbol.asyncIterator]() {
          let i = 0;
          return {
            async next() {
              if (i++ < 10) return { value: i, done: false };
              return { done: true, value: undefined };
            },
            async return() {
              returnCalled = true;
              return { done: true, value: undefined };
            },
          };
        },
      };

      const stream = ReadableStream.from(customAsyncIterable);
      const reader = stream.getReader();

      await reader.read();
      await reader.cancel();

      expect(returnCalled).toBe(true);
    });

    test("does not error when iterator has no return method", async () => {
      const customIterable = {
        [Symbol.iterator]() {
          let i = 0;
          return {
            next() {
              if (i++ < 10) return { value: i, done: false };
              return { done: true, value: undefined };
            },
            // No return method
          };
        },
      };

      const stream = ReadableStream.from(customIterable);
      const reader = stream.getReader();

      await reader.read();
      // Should not throw
      await reader.cancel();
    });
  });

  describe("for await...of consumption", () => {
    test("can be consumed with for await...of", async () => {
      const stream = ReadableStream.from([1, 2, 3]);
      const values: number[] = [];

      for await (const value of stream) {
        values.push(value);
      }

      expect(values).toEqual([1, 2, 3]);
    });
  });

  describe("Node.js compatibility", () => {
    test("works with array of promises (sync iterable with async values)", async () => {
      const stream = ReadableStream.from([Promise.resolve(1), Promise.resolve(2), Promise.resolve(3)]);

      const reader = stream.getReader();
      const values: number[] = [];
      let result;
      while (!(result = await reader.read()).done) {
        // Values should be promises that need to be awaited
        values.push(await result.value);
      }

      expect(values).toEqual([1, 2, 3]);
    });
  });
});
