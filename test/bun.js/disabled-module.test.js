import { expect, test } from "bun:test";

test("not implemented yet module masquerades as undefined and throws an error", () => {
  const worker_threads = import.meta.require("worker_threads");

  expect(typeof worker_threads).toBe("undefined");
  expect(typeof worker_threads.getEnvironmentData).toBe("undefined");
});
