import assert from "assert";
import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/941
test("assert as a function does not throw", () => assert(true));
test("assert as a function does throw", () => {
  try {
    assert(false);
    expect.unreachable();
  } catch (e) {}
});
