import WithStatic from "./export-default-with-static-initializer";
import { test, expect } from "bun:test";

test("static initializer", () => {
  expect(WithStatic.boop).toBe("boop");
});
