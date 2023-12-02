import { expect, mock, test } from "bun:test";
import { foo } from "./second";
import { bar } from "./third";

test("mocks re-export from export list", () => {
  expect(foo).toBe("hello");
  mock.module("./second.ts", () => ({ foo: "world" }));
  expect(foo).toBe("world"); // success
});

test("mocks named re-export", () => {
  expect(bar).toBe("hello");
  mock.module("./third.ts", () => ({ bar: "world" }));
  expect(bar).toBe("world"); // success
});
