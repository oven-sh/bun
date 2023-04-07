import { expect, test } from "bun:test";
import { resolve, join } from "path";
import MyPNG from "./test-png.png";
import data from "./data.anything";
import moreData from "../more-data.any";
import js from "./no-extension-js";

test("png import", () => {
  expect(MyPNG).toBe(resolve(__dirname, "./test-png.png"));
});

test("random import", () => {
  expect(data).toBe(join(import.meta.dir, "data.anything"));
  expect(moreData).toBe(join(import.meta.dir, "../more-data.any"));
  expect(js()).toBe("success!");
});
