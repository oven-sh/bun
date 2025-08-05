import { test, expect } from "bun:test";
import { covered, ignored, alsoCovered } from "./test_istanbul_ignore.js";

test("should call all functions", () => {
  expect(covered()).toBe("covered");
  expect(ignored()).toBe("ignored");
  expect(alsoCovered()).toBe("also covered");
});