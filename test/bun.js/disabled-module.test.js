import { describe, it, expect, beforeEach, afterEach, test } from "bun:test";

test("not implemented yet module masquerades as undefined and throws an error", () => {
  const worker_threads = import.meta.require("worker_threads");

  expect(typeof worker_threads).toBe("object");
  expect(typeof worker_threads.foo).toBe("undefined");
  expect(() => worker_threads.foo()).toThrow("Not implemented yet in Bun :(");
});
