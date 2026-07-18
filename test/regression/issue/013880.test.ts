import { expect, test } from "bun:test";

test("regression", () => {
  const original = Error.prepareStackTrace;
  try {
    expect(() => require("./013880-fixture.cjs")).not.toThrow();
  } finally {
    Error.prepareStackTrace = original;
  }
});
