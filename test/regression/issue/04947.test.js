import { test, expect } from "bun:test";
import { Request } from "node-fetch";

test("new Request('/') works with node-fetch", () => {
  expect(() => new Request("/")).not.toThrow();
  expect(new Request("/").url).toBe("/");
});
