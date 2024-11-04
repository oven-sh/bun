import { test, expect } from "bun:test";
import { Request } from "node-fetch";

test("node fetch Request URL field is set even with a valid URL", () => {
  expect(new Request("/").url).toBe("/");
  expect(new Request("https://bun.sh/").url).toBe("https://bun.sh/");
  expect(new Request(new URL("https://bun.sh/")).url).toBe("https://bun.sh/");
});
