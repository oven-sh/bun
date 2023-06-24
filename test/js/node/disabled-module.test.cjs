test("not implemented yet module masquerades as undefined in cjs and throws an error", () => {
  const worker_threads = require("worker_threads");

  expect(typeof worker_threads).toBe("undefined");
  expect(typeof worker_threads.getEnvironmentData).toBe("undefined");
});
