import { expect, test } from "bun:test";
import { resolve } from "path";
import PNG from "./test-png.png";

test("png import", () => {
  expect(PNG).toBe(resolve(__dirname, "./test-png.png"));
});
