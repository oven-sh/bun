import { expect, test } from "bun:test";
import "harness";

// https://github.com/oven-sh/bun/issues/12070
test("bun repl", () => {
  expect(["repl", "-e", "process.exit(0)"]).toRun();
});
