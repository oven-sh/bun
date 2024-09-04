import { expect, test } from "bun:test";
import WithStatic from "./export-default-with-static-initializer";

test("static initializer", () => {
  expect(WithStatic.boop).toBe("boop");
});
