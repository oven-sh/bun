import { describe, expect, test } from "bun:test";

describe("Promise.any AggregateError", () => {
  async function getRejection(iterable: Iterable<unknown>, ctor = Promise): Promise<AggregateError> {
    try {
      await ctor.any(iterable);
    } catch (e) {
      return e as AggregateError;
    }
    throw new Error("expected rejection");
  }

  test.concurrent("rejected promises (fast path, settled in microtask)", async () => {
    const err = await getRejection([Promise.reject(new Error("r1")), Promise.reject("r2")]);

    expect(err).toBeInstanceOf(AggregateError);
    expect(err.message).toBe("All promises were rejected");
    expect(Object.prototype.hasOwnProperty.call(err, "cause")).toBe(false);
    expect("cause" in err).toBe(false);
    expect(typeof err.stack).toBe("string");
    expect(err.stack).toStartWith("AggregateError: All promises were rejected");
    expect(err.errors).toHaveLength(2);
    expect((err.errors[0] as Error).message).toBe("r1");
    expect(err.errors[1]).toBe("r2");

    const own = Object.getOwnPropertyNames(err);
    expect(own).toContain("message");
    expect(own).toContain("errors");
    expect(own).toContain("stack");
    expect(own).not.toContain("cause");
  });

  test.concurrent("empty iterable (synchronous rejection)", async () => {
    const err = await getRejection([]);

    expect(err).toBeInstanceOf(AggregateError);
    expect(err.message).toBe("All promises were rejected");
    expect(Object.prototype.hasOwnProperty.call(err, "cause")).toBe(false);
    expect(typeof err.stack).toBe("string");
    expect(err.stack).toStartWith("AggregateError: All promises were rejected");
    expect(err.errors).toEqual([]);
  });

  test.concurrent("already-rejected non-promise values", async () => {
    const err = await getRejection([Promise.reject(1), Promise.reject(2), Promise.reject(3)]);

    expect(err.message).toBe("All promises were rejected");
    expect(Object.prototype.hasOwnProperty.call(err, "cause")).toBe(false);
    expect(typeof err.stack).toBe("string");
    expect(err.errors).toEqual([1, 2, 3]);
  });

  test.concurrent("Promise subclass (slow path)", async () => {
    class P<T> extends Promise<T> {}
    const err = await getRejection([P.reject(1), P.reject(2)], P);

    expect(err).toBeInstanceOf(AggregateError);
    expect(err.message).toBe("All promises were rejected");
    expect(Object.prototype.hasOwnProperty.call(err, "cause")).toBe(false);
    expect(typeof err.stack).toBe("string");
    expect(err.errors).toEqual([1, 2]);
  });

  test.concurrent("Promise subclass with empty iterable (slow path, synchronous)", async () => {
    class P<T> extends Promise<T> {}
    const err = await getRejection([], P);

    expect(err.message).toBe("All promises were rejected");
    expect(Object.prototype.hasOwnProperty.call(err, "cause")).toBe(false);
    expect(typeof err.stack).toBe("string");
  });

  test.concurrent("thenable rejection (onRejected function path)", async () => {
    const thenable = {
      then(_onFulfilled: unknown, onRejected: (reason: unknown) => void) {
        onRejected("from-thenable");
      },
    };
    const err = await getRejection([thenable]);

    expect(err.message).toBe("All promises were rejected");
    expect(Object.prototype.hasOwnProperty.call(err, "cause")).toBe(false);
    expect(typeof err.stack).toBe("string");
    expect(err.errors).toEqual(["from-thenable"]);
  });

  test.concurrent("user-constructed AggregateError is unaffected", () => {
    const withCause = new AggregateError([1], "msg", { cause: "c" });
    expect(withCause.message).toBe("msg");
    expect(withCause.cause).toBe("c");
    expect(Object.prototype.hasOwnProperty.call(withCause, "cause")).toBe(true);
    expect(typeof withCause.stack).toBe("string");

    const noCause = new AggregateError([1], "msg");
    expect(Object.prototype.hasOwnProperty.call(noCause, "cause")).toBe(false);

    const undefCause = new AggregateError([1], "msg", { cause: undefined });
    expect(Object.prototype.hasOwnProperty.call(undefCause, "cause")).toBe(true);
    expect(undefCause.cause).toBe(undefined);
  });
});
