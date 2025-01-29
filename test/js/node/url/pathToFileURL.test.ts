import { test, expect } from "bun:test";
import path from "path";
test("pathToFileURL doesn't leak memory", () => {
  expect([path.join(import.meta.dir, "pathToFileURL-leak-fixture.js")]).toRun();
});
