import { expect, test } from "bun:test";
import * as fs from "node:fs";

// https://github.com/oven-sh/bun/issues/28644
// Async fs errors should have a .stack property matching Node.js format:
// "Error: <message>" (header only, no frames since error is created in threadpool)

test("fs.readFile async error has .stack", async () => {
  const { promise, resolve } = Promise.withResolvers<NodeJS.ErrnoException>();
  fs.readFile("/nonexistent-xyz-abc-123-bun-test", err => resolve(err!));
  const err = await promise;

  expect(err).toBeDefined();
  expect(err.code).toBe("ENOENT");
  expect(typeof err.stack).toBe("string");
  expect(err.stack).toStartWith("Error: ");
  expect(err.stack).toBe("Error: " + err.message);
  expect(err.stack).toContain("ENOENT");
});

test("fs.stat async error has .stack", async () => {
  const { promise, resolve } = Promise.withResolvers<NodeJS.ErrnoException>();
  fs.stat("/nonexistent-xyz-abc-123-bun-test", err => resolve(err!));
  const err = await promise;

  expect(err).toBeDefined();
  expect(err.code).toBe("ENOENT");
  expect(typeof err.stack).toBe("string");
  expect(err.stack).toStartWith("Error: ");
  expect(err.stack).toBe("Error: " + err.message);
});

test("fs.open async error has .stack", async () => {
  const { promise, resolve } = Promise.withResolvers<NodeJS.ErrnoException>();
  fs.open("/nonexistent-xyz-abc-123-bun-test", "r", err => resolve(err!));
  const err = await promise;

  expect(err).toBeDefined();
  expect(err.code).toBe("ENOENT");
  expect(typeof err.stack).toBe("string");
  expect(err.stack).toStartWith("Error: ");
  expect(err.stack).toBe("Error: " + err.message);
});
