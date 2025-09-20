import { test, expect } from "bun:test";

test("process.report.getReport() works", () => {
  expect(process.report.getReport().header.osName).toBeString();
});
