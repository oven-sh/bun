import { expect, test } from "bun:test";
import { resolve, join } from "path";
import MyPNG from "./test-png.png";
import theData from "./data.anything";
import js from "./no-extension-js";

test("png import", () => {
  expect(MyPNG).toBe(resolve(__dirname, "./test-png.png"));
});

test("random import", () => {
  expect(theData).toBe(join(import.meta.dir, "data.anything"));
  expect(js()).toBe("success!");
});
