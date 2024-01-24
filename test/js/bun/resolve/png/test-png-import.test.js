import { expect, test } from "bun:test";
import { resolve } from "path";
import MyPNG from "./test-png.png";

test("png import", () => {
  expect(resolve(MyPNG)).toBe(resolve(__dirname, "./test-png.png"));
});
